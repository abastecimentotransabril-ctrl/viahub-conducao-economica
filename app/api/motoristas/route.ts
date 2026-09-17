import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal } from '@/lib/motor-apuracao';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticação
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      return NextResponse.json(
        { sucesso: false, erro: authError || 'Não autenticado' },
        { status: 401 }
      );
    }

    // Obter empresa do usuário
    const { data: usuario } = await supabaseServer
      .from('usuarios')
      .select('empresa_id, papel')
      .eq('id', user.id)
      .single();

    if (!usuario) {
      return NextResponse.json(
        { sucesso: false, erro: 'Usuário não encontrado' },
        { status: 404 }
      );
    }

    // Período selecionado (mesmo padrão usado no detalhe do motorista):
    // por padrão, últimos 30 dias.
    const searchParams = request.nextUrl.searchParams;
    const agora = new Date();
    const trintaDiasAtras = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dataInicio = searchParams.get('inicio') || trintaDiasAtras.toISOString();
    const dataFim = searchParams.get('fim') || agora.toISOString();

    // Listar motoristas da empresa + tudo que só depende de empresa_id/período,
    // em paralelo.
    const [
      { data: motoristas, error },
      { data: placasAtuais },
      { data: kmRodado },
      { data: versaoVigente },
      { data: agregadosFrota },
    ] = await Promise.all([
      supabaseServer
        .from('motoristas')
        .select('id, nome, cpf, matricula, ativo')
        .eq('empresa_id', usuario.empresa_id)
        .order('nome'),
      supabaseServer.rpc('motoristas_com_placa_atual', { p_empresa_id: usuario.empresa_id }),
      // KM rodado no período selecionado (aproximação via leituras de telemetria,
      // enquanto alocacoes_motorista_veiculo não registra login/logout)
      supabaseServer.rpc('motoristas_km_rodado_periodo', {
        p_empresa_id: usuario.empresa_id,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
      }),
      supabaseServer
        .from('versoes_config')
        .select('id, nome')
        .eq('empresa_id', usuario.empresa_id)
        .eq('vigente', true)
        .maybeSingle(),
      // Indicadores brutos agregados por motorista/veículo no período — a
      // mesma fonte usada no ranking da página de detalhe do motorista.
      supabaseServer.rpc('apurar_periodo_frota', {
        p_empresa_id: usuario.empresa_id,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
      }),
    ]);

    if (error) {
      return NextResponse.json(
        { sucesso: false, erro: error.message },
        { status: 500 }
      );
    }

    // Nota geral: calculada ao vivo com o mesmo motor de apuração usado na
    // página de detalhe do motorista (não depende de resultados_motorista,
    // que só é preenchida quando alguém salva uma apuração manualmente).
    let indicadores: any[] = [];
    let faixasNota: any[] = [];
    let regras = { sentinela: 1000, casas_decimais: 1, cobertura_minima_pct: 70 };

    if (versaoVigente) {
      const [{ data: ind }, { data: fn }, { data: rg }] = await Promise.all([
        supabaseServer.from('indicadores').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('faixas_nota').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('regras_apuracao').select('*').eq('versao_config_id', versaoVigente.id).maybeSingle(),
      ]);
      indicadores = ind || [];
      faixasNota = fn || [];
      if (rg) regras = rg;
    }

    // Um motorista pode ter usado mais de um veículo no período — combina os
    // agregados por peso de quantidade de leituras antes de calcular a nota,
    // uma única vez por motorista.
    const agregadoPorMotorista = new Map<string, { pesoTotal: number; somas: Record<string, number>; qtdLeituras: number }>();
    for (const a of agregadosFrota || []) {
      if (!a.motorista_id) continue;
      const peso = Number(a.qtd_leituras) || 0;
      if (peso === 0) continue;
      const atual = agregadoPorMotorista.get(a.motorista_id) || {
        pesoTotal: 0,
        somas: { rpmZone: 0, inertiaUsage: 0, iddleTime: 0, accelerationExcess: 0, throttleAgregation: 0 },
        qtdLeituras: 0,
      };
      atual.pesoTotal += peso;
      atual.qtdLeituras += peso;
      for (const [campo, chaveDestino] of [
        ['avg_rpmzone', 'rpmZone'],
        ['avg_inertiausage', 'inertiaUsage'],
        ['avg_iddletime', 'iddleTime'],
        ['avg_accelerationexcess', 'accelerationExcess'],
        ['avg_throttleagregation', 'throttleAgregation'],
      ] as const) {
        const valor = a[campo];
        if (valor !== null && valor !== undefined) {
          atual.somas[chaveDestino] += Number(valor) * peso;
        }
      }
      agregadoPorMotorista.set(a.motorista_id, atual);
    }

    const notaPorMotorista = new Map<string, { nota_final: number | null; faixa_rotulo: string | null; cobertura_pct: number }>();
    if (indicadores.length > 0) {
      for (const [motoristaId, agregado] of agregadoPorMotorista.entries()) {
        const indicadorBruto: Record<string, number | null> = {};
        for (const [campo, soma] of Object.entries(agregado.somas)) {
          indicadorBruto[campo] = agregado.pesoTotal > 0 ? soma / agregado.pesoTotal : null;
        }
        const resultado = calcularNotaFinal(
          indicadorBruto,
          indicadores,
          faixasNota.map((f: any) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
          regras
        );
        notaPorMotorista.set(motoristaId, {
          nota_final: resultado.nota_final,
          faixa_rotulo: resultado.faixa_rotulo,
          cobertura_pct: resultado.cobertura_pct,
        });
      }
    }

    const placaPorMotorista = new Map((placasAtuais || []).map((p: any) => [p.motorista_id, p]));
    const kmPorMotorista = new Map((kmRodado || []).map((k: any) => [k.motorista_id, k]));

    // Mascarar CPF para papéis que não são RH/admin
    const motoristasPublicos = motoristas.map(m => {
      const veiculoAtual = placaPorMotorista.get(m.id) as any;
      const kmInfo = kmPorMotorista.get(m.id) as any;
      const notaInfo = notaPorMotorista.get(m.id);
      const base = {
        ...m,
        placa: veiculoAtual?.placa || null,
        modelo_equipamento: veiculoAtual?.modelo_equipamento || null,
        km_rodado: kmInfo?.km_rodado ?? null,
        km_rodado_ultima_leitura: kmInfo?.ultima_leitura ?? null,
        nota_geral: notaInfo?.nota_final ?? null,
        nota_geral_faixa: notaInfo?.faixa_rotulo ?? null,
        nota_geral_cobertura_pct: notaInfo?.cobertura_pct ?? null,
      };
      if (usuario.papel === 'rh' || usuario.papel === 'admin_gamificacao') {
        return base;
      }
      return {
        ...base,
        cpf: m.cpf ? m.cpf.replace(/(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})/, '$1.***.**$2') : null,
      };
    });

    return NextResponse.json({
      sucesso: true,
      dados: motoristasPublicos,
      periodo: { inicio: dataInicio, fim: dataFim },
    });
  } catch (erro) {
    console.error('Erro ao listar motoristas:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
