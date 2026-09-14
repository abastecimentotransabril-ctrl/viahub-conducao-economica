import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal } from '@/lib/motor-apuracao';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ sucesso: false, erro: authError || 'Não autenticado' }, { status: 401 });
    }

    const { data: usuario } = await supabaseServer
      .from('usuarios')
      .select('empresa_id')
      .eq('id', user.id)
      .single();

    if (!usuario) {
      return NextResponse.json({ sucesso: false, erro: 'Usuário não encontrado' }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const agrupar = searchParams.get('agrupar') === 'veiculo' ? 'veiculo' : 'motorista';

    const agora = new Date();
    const trintaDiasAtras = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dataInicio = searchParams.get('inicio') || trintaDiasAtras.toISOString();
    const dataFim = searchParams.get('fim') || agora.toISOString();

    // Configuração vigente
    const { data: versaoVigente } = await supabaseServer
      .from('versoes_config')
      .select('id, nome')
      .eq('empresa_id', usuario.empresa_id)
      .eq('vigente', true)
      .maybeSingle();

    if (!versaoVigente) {
      return NextResponse.json({ sucesso: false, erro: 'Nenhuma configuração de indicadores vigente para esta empresa' }, { status: 400 });
    }

    const [{ data: indicadores }, { data: faixasNota }, { data: regrasArr }] = await Promise.all([
      supabaseServer.from('indicadores').select('*').eq('versao_config_id', versaoVigente.id),
      supabaseServer.from('faixas_nota').select('*').eq('versao_config_id', versaoVigente.id),
      supabaseServer.from('regras_apuracao').select('*').eq('versao_config_id', versaoVigente.id),
    ]);
    const regras = regrasArr?.[0] || { sentinela: 1000, casas_decimais: 1, cobertura_minima_pct: 70 };

    // Agregação rápida via função SQL (indexada) — uma única query
    const rpcNome = agrupar === 'veiculo' ? 'apurar_periodo_veiculos' : 'apurar_periodo_frota';
    const { data: agregados, error: rpcError } = await supabaseServer.rpc(rpcNome, {
      p_empresa_id: usuario.empresa_id,
      p_data_inicio: dataInicio,
      p_data_fim: dataFim,
    });

    if (rpcError) {
      return NextResponse.json(
        { sucesso: false, erro: 'Erro ao agregar telemetria do período', detalhe: rpcError.message },
        { status: 500 }
      );
    }

    if (!agregados || agregados.length === 0) {
      return NextResponse.json({
        sucesso: true,
        dados: { periodo: { inicio: dataInicio, fim: dataFim }, agrupar, resultados: [], configVigente: versaoVigente },
      });
    }

    // Nomes de motoristas e placas para exibição
    const motoristaIds = Array.from(new Set(agregados.map((a: any) => a.motorista_id).filter(Boolean)));
    const veiculoIds = Array.from(new Set(agregados.map((a: any) => a.veiculo_id).filter(Boolean)));

    const [{ data: motoristasInfo }, { data: veiculosInfo }] = await Promise.all([
      motoristaIds.length > 0
        ? supabaseServer.from('motoristas').select('id, nome, matricula').in('id', motoristaIds)
        : Promise.resolve({ data: [] as any[] }),
      veiculoIds.length > 0
        ? supabaseServer.from('veiculos').select('id, placa, modelo_equipamento').in('id', veiculoIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const motoristaPorId = new Map((motoristasInfo || []).map((m) => [m.id, m]));
    const veiculoPorId = new Map((veiculosInfo || []).map((v) => [v.id, v]));

    const resultados = agregados.map((a: any) => {
      const indicadorBruto = {
        rpmZone: a.avg_rpmzone,
        inertiaUsage: a.avg_inertiausage,
        iddleTime: a.avg_iddletime,
        accelerationExcess: a.avg_accelerationexcess,
        throttleAgregation: a.avg_throttleagregation,
      };
      const resultado = calcularNotaFinal(
        indicadorBruto,
        indicadores || [],
        (faixasNota || []).map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
      const motorista = a.motorista_id ? motoristaPorId.get(a.motorista_id) : null;
      const veiculo = a.veiculo_id ? veiculoPorId.get(a.veiculo_id) : null;

      return {
        motorista_id: a.motorista_id || null,
        veiculo_id: a.veiculo_id || null,
        nome: motorista?.nome || null,
        matricula: motorista?.matricula || null,
        placa: veiculo?.placa || null,
        modelo_equipamento: veiculo?.modelo_equipamento || null,
        qtd_leituras: a.qtd_leituras,
        nota_final: resultado.nota_final,
        cobertura_pct: resultado.cobertura_pct,
        elegivel: resultado.elegivel,
        motivo_inelegibilidade: resultado.motivo_inelegibilidade,
        faixa_rotulo: resultado.faixa_rotulo,
      };
    });

    resultados.sort((a: typeof resultados[0], b: typeof resultados[0]) => {
      if (a.elegivel && !b.elegivel) return -1;
      if (!a.elegivel && b.elegivel) return 1;
      return (b.nota_final || 0) - (a.nota_final || 0);
    });

    return NextResponse.json({
      sucesso: true,
      dados: {
        periodo: { inicio: dataInicio, fim: dataFim },
        agrupar,
        resultados,
        configVigente: versaoVigente,
      },
    });
  } catch (erro) {
    console.error('Erro no painel visão geral:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor', detalhe: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
