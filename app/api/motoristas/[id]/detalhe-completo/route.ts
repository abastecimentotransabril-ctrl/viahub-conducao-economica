import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal, ResultadoApuracao } from '@/lib/motor-apuracao';

export const dynamic = 'force-dynamic';

const LIMITE_LEITURAS_DETALHE = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const searchParams = request.nextUrl.searchParams;

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ sucesso: false, erro: authError || 'Não autenticado' }, { status: 401 });
    }

    const { data: usuario } = await supabaseServer
      .from('usuarios')
      .select('empresa_id, papel')
      .eq('id', user.id)
      .single();

    if (!usuario) {
      return NextResponse.json({ sucesso: false, erro: 'Usuário não encontrado' }, { status: 404 });
    }

    const { data: motorista } = await supabaseServer
      .from('motoristas')
      .select('*')
      .eq('id', resolvedParams.id)
      .eq('empresa_id', usuario.empresa_id)
      .single();

    if (!motorista) {
      return NextResponse.json({ sucesso: false, erro: 'Motorista não encontrado' }, { status: 404 });
    }

    const { data: alocacao } = await supabaseServer
      .from('alocacoes_motorista_veiculo')
      .select('veiculo_id')
      .eq('motorista_id', resolvedParams.id)
      .is('fim', null)
      .order('inicio', { ascending: false })
      .limit(1)
      .maybeSingle();

    let veiculo = null;
    if (alocacao) {
      const { data: v } = await supabaseServer.from('veiculos').select('*').eq('id', alocacao.veiculo_id).single();
      veiculo = v;
    }

    const { data: versaoVigente } = await supabaseServer
      .from('versoes_config')
      .select('id, nome')
      .eq('empresa_id', usuario.empresa_id)
      .eq('vigente', true)
      .maybeSingle();

    let indicadores: any[] = [];
    let faixasNota: any[] = [];
    let faixasClassificacao: any[] = [];
    let regras = { sentinela: 1000, casas_decimais: 1, cobertura_minima_pct: 70 };

    if (versaoVigente) {
      const [{ data: ind }, { data: fn }, { data: fc }, { data: rg }] = await Promise.all([
        supabaseServer.from('indicadores').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('faixas_nota').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('faixas_classificacao').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('regras_apuracao').select('*').eq('versao_config_id', versaoVigente.id).maybeSingle(),
      ]);
      indicadores = ind || [];
      faixasNota = fn || [];
      faixasClassificacao = fc || [];
      if (rg) regras = rg;
    }

    // Leituras individuais — lidas da tabela INDEXADA (rápida), não mais
    // escaneando o JSON bruto de maxtrack_mensagens_raw a cada request.
    const { data: leiturasRaw } = await supabaseServer
      .from('leituras_telemetria')
      .select('*')
      .eq('motorista_id', resolvedParams.id)
      .order('timestamp_leitura', { ascending: false })
      .limit(LIMITE_LEITURAS_DETALHE);

    const leituras = (leiturasRaw || [])
      .slice()
      .reverse()
      .map((l) => ({
        id: l.id,
        timestampUnix: Math.floor(new Date(l.timestamp_leitura).getTime() / 1000),
        dataHoraISO: l.timestamp_leitura,
        velocidadeKmh: l.velocidade_kmh,
        rpm: l.rpm,
        odometroKm: l.odometro_km,
        consumoBruto: l.consumo_bruto,
        posicao: l.latitude != null && l.longitude != null ? { lat: l.latitude, lon: l.longitude } : null,
        referenciaMaisProxima: null as any,
        eventoBruto: null as string | null,
        operationalLabel: l.motor_ligado ? 'CONDUÇÃO' : 'PARADO',
        indicadoresBrutos: l.indicadores_brutos,
      }));

    const calcular = (indicadoresBrutos: Record<string, number | null> | null): ResultadoApuracao | null => {
      if (!indicadoresBrutos || indicadores.length === 0) return null;
      return calcularNotaFinal(
        indicadoresBrutos,
        indicadores,
        faixasNota.map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
    };

    const leiturasComNota = leituras.map((l) => ({ leitura: l, resultado: calcular(l.indicadoresBrutos) }));
    const ultimaLeitura = leiturasComNota[leiturasComNota.length - 1] || null;
    const penultimaLeitura = leiturasComNota[leiturasComNota.length - 2] || null;

    // Cálculo acumulado por período (padrão: últimos 30 dias, ou o que vier na query)
    const agora = new Date();
    const trintaDiasAtras = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dataInicio = searchParams.get('inicio') || trintaDiasAtras.toISOString();
    const dataFim = searchParams.get('fim') || agora.toISOString();

    let resultadoPeriodo: (ResultadoApuracao & { qtdLeituras: number; primeiraLeitura: string | null; ultimaLeituraPeriodo: string | null }) | null = null;

    const { data: agregadoPeriodo } = await supabaseServer.rpc('apurar_periodo_motorista', {
      p_motorista_id: resolvedParams.id,
      p_data_inicio: dataInicio,
      p_data_fim: dataFim,
    });

    const agregado = agregadoPeriodo?.[0];
    if (agregado && agregado.qtd_leituras > 0 && indicadores.length > 0) {
      const indicadorBruto = {
        rpmZone: agregado.avg_rpmzone,
        inertiaUsage: agregado.avg_inertiausage,
        iddleTime: agregado.avg_iddletime,
        accelerationExcess: agregado.avg_accelerationexcess,
        throttleAgregation: agregado.avg_throttleagregation,
      };
      const r = calcularNotaFinal(
        indicadorBruto,
        indicadores,
        faixasNota.map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
      resultadoPeriodo = {
        ...r,
        qtdLeituras: Number(agregado.qtd_leituras),
        primeiraLeitura: agregado.primeira_leitura,
        ultimaLeituraPeriodo: agregado.ultima_leitura,
      };
    }

    // Ranking do período (via função agregada indexada — não escaneia JSON bruto)
    const ranking: Array<{ placa: string; nome: string | null; nota: number | null; faixa: string | null }> = [];
    if (indicadores.length > 0) {
      const { data: agregadosFrota } = await supabaseServer.rpc('apurar_periodo_frota', {
        p_empresa_id: usuario.empresa_id,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
      });

      if (agregadosFrota && agregadosFrota.length > 0) {
        const veiculoIds = Array.from(new Set(agregadosFrota.map((a: any) => a.veiculo_id)));
        const motoristaIds = Array.from(new Set(agregadosFrota.map((a: any) => a.motorista_id).filter(Boolean)));

        const [{ data: veiculosInfo }, { data: motoristasInfo }] = await Promise.all([
          supabaseServer.from('veiculos').select('id, placa').in('id', veiculoIds),
          motoristaIds.length > 0
            ? supabaseServer.from('motoristas').select('id, nome').in('id', motoristaIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const placaPorVeiculo = new Map((veiculosInfo || []).map((v) => [v.id, v.placa]));
        const nomePorMotorista = new Map((motoristasInfo || []).map((m) => [m.id, m.nome]));

        for (const a of agregadosFrota) {
          const indicadorBruto = {
            rpmZone: a.avg_rpmzone,
            inertiaUsage: a.avg_inertiausage,
            iddleTime: a.avg_iddletime,
            accelerationExcess: a.avg_accelerationexcess,
            throttleAgregation: a.avg_throttleagregation,
          };
          const r = calcularNotaFinal(
            indicadorBruto,
            indicadores,
            faixasNota.map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
            regras
          );
          if (r.elegivel) {
            ranking.push({
              placa: placaPorVeiculo.get(a.veiculo_id) || '—',
              nome: a.motorista_id ? nomePorMotorista.get(a.motorista_id) || null : null,
              nota: r.nota_final,
              faixa: r.faixa_rotulo,
            });
          }
        }
        ranking.sort((a, b) => (b.nota || 0) - (a.nota || 0));
      }
    }

    const { data: atendimentos } = await supabaseServer
      .from('atendimentos_master_drive')
      .select('*')
      .eq('motorista_id', resolvedParams.id)
      .order('criado_em', { ascending: false })
      .limit(10);

    let cpf: string | null = null;
    if (usuario.papel === 'rh' || usuario.papel === 'admin_gamificacao') {
      cpf = motorista.cpf;
    } else if (motorista.cpf) {
      cpf = motorista.cpf.replace(/(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})/, '$1.***.**$2');
    }

    return NextResponse.json({
      sucesso: true,
      dados: {
        motorista: { ...motorista, cpf },
        veiculo,
        configVigente: versaoVigente,
        indicadores,
        faixasNota,
        faixasClassificacao,
        leiturasComNota,
        ultimaLeitura,
        penultimaLeitura,
        periodo: { inicio: dataInicio, fim: dataFim },
        resultadoPeriodo,
        ranking,
        atendimentos: atendimentos || [],
        papelUsuario: usuario.papel,
      },
    });
  } catch (erro) {
    console.error('Erro ao obter detalhe completo do motorista:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor', detalhe: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
