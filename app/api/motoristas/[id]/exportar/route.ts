import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal, ResultadoApuracao } from '@/lib/motor-apuracao';
import { detalharPorDia } from '@/lib/agregacao-diaria';
import { gerarXlsx, nomeArquivoXlsx, Celula } from '@/lib/xlsx-helper';

export const dynamic = 'force-dynamic';

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

    const agora = new Date();
    const trintaDiasAtras = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dataInicio = searchParams.get('inicio') || trintaDiasAtras.toISOString();
    const dataFim = searchParams.get('fim') || agora.toISOString();

    const [
      { data: motorista },
      { data: versaoVigente },
      { data: leiturasRaw },
      { data: agregadoPeriodo },
    ] = await Promise.all([
      supabaseServer.from('motoristas').select('*').eq('id', resolvedParams.id).eq('empresa_id', usuario.empresa_id).single(),
      supabaseServer.from('versoes_config').select('id, nome').eq('empresa_id', usuario.empresa_id).eq('vigente', true).maybeSingle(),
      supabaseServer.from('leituras_telemetria').select('*').eq('motorista_id', resolvedParams.id).order('timestamp_leitura', { ascending: true }).limit(2000),
      supabaseServer.rpc('apurar_periodo_motorista', { p_motorista_id: resolvedParams.id, p_data_inicio: dataInicio, p_data_fim: dataFim }),
    ]);

    if (!motorista) {
      return NextResponse.json({ sucesso: false, erro: 'Motorista não encontrado' }, { status: 404 });
    }

    let indicadores: any[] = [];
    let faixasNota: any[] = [];
    let regras = { sentinela: 1000, casas_decimais: 1, cobertura_minima_pct: 70 };

    if (versaoVigente) {
      const [{ data: ind }, { data: fn }, { data: rg }] = await Promise.all([
        supabaseServer.from('indicadores').select('*').eq('versao_config_id', versaoVigente.id).order('ordem'),
        supabaseServer.from('faixas_nota').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('regras_apuracao').select('*').eq('versao_config_id', versaoVigente.id).maybeSingle(),
      ]);
      indicadores = ind || [];
      faixasNota = fn || [];
      if (rg) regras = rg;
    }

    const faixasNotaSimples = faixasNota.map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo }));

    // Resultado acumulado do período
    let resultadoPeriodo: ResultadoApuracao | null = null;
    const agregado = agregadoPeriodo?.[0];
    if (agregado && agregado.qtd_leituras > 0 && indicadores.length > 0) {
      resultadoPeriodo = calcularNotaFinal(
        {
          rpmZone: agregado.avg_rpmzone,
          inertiaUsage: agregado.avg_inertiausage,
          iddleTime: agregado.avg_iddletime,
          accelerationExcess: agregado.avg_accelerationexcess,
          throttleAgregation: agregado.avg_throttleagregation,
        },
        indicadores,
        faixasNotaSimples,
        regras
      );
    }

    // Detalhamento dia a dia (nota + composição por critério, por dia)
    const detalhamentoPorDia = await detalharPorDia(
      resolvedParams.id,
      dataInicio,
      dataFim,
      indicadores,
      faixasNotaSimples,
      regras
    );

    // Leituras dentro do período selecionado
    const leiturasNoPeriodo = (leiturasRaw || []).filter((l: any) => {
      const t = new Date(l.timestamp_leitura).getTime();
      return t >= new Date(dataInicio).getTime() && t <= new Date(dataFim).getTime();
    });

    const nomeIndicador = (mnemonico: string) => indicadores.find((i) => i.mnemonico === mnemonico)?.nome || mnemonico;
    const indicadoresPontuaveis = indicadores.filter((i) => i.tipo === 'pontua' && i.campo_fonte);

    // ===== Aba: Resumo =====
    const resumo: Celula[][] = [
      ['RESUMO — CONDUÇÃO ECONÔMICA', ''],
      ['Motorista', motorista.nome],
      ['Matrícula', motorista.matricula || '—'],
      ['Configuração vigente', versaoVigente?.nome || '—'],
      ['Período', `${new Date(dataInicio).toLocaleDateString('pt-BR')} a ${new Date(dataFim).toLocaleDateString('pt-BR')}`],
      ['Leituras no período', resultadoPeriodo ? (agregado?.qtd_leituras ?? 0) : 0],
      ['Nota final (acumulada)', resultadoPeriodo?.nota_final != null ? Number(resultadoPeriodo.nota_final.toFixed(1)) : null],
      ['Faixa', resultadoPeriodo?.faixa_rotulo || (resultadoPeriodo?.motivo_inelegibilidade ? 'Inelegível' : '—')],
      ['Cobertura (%)', resultadoPeriodo ? Number(resultadoPeriodo.cobertura_pct.toFixed(1)) : null],
      ['Motivo de inelegibilidade', resultadoPeriodo?.motivo_inelegibilidade || '—'],
    ];

    // ===== Aba: Composição da nota (período acumulado) =====
    const composicao: Celula[][] = [
      ['Indicador', 'Valor médio', 'Nota', 'Peso', 'Pontos', 'Entrou no cálculo?'],
    ];
    if (resultadoPeriodo) {
      for (const d of resultadoPeriodo.detalhe) {
        composicao.push([
          nomeIndicador(d.indicador),
          d.valor != null ? Number(d.valor.toFixed(1)) : null,
          d.nota != null ? Number(d.nota.toFixed(1)) : null,
          d.peso,
          d.pontos != null ? Number(d.pontos.toFixed(1)) : null,
          d.entrou ? 'Sim' : 'Não',
        ]);
      }
    }

    // ===== Aba: Detalhamento diário =====
    const cabecalhoDiario: Celula[] = ['Dia', 'Leituras', 'Nota do dia', 'Faixa', 'Cobertura (%)'];
    for (const ind of indicadoresPontuaveis) cabecalhoDiario.push(ind.nome);
    const diario: Celula[][] = [cabecalhoDiario];
    for (const d of detalhamentoPorDia) {
      const linha: Celula[] = [
        new Date(d.dia + 'T00:00:00').toLocaleDateString('pt-BR'),
        d.qtdLeituras,
        d.resultado.nota_final != null ? Number(d.resultado.nota_final.toFixed(1)) : null,
        d.resultado.faixa_rotulo || (d.resultado.motivo_inelegibilidade ? 'Inelegível' : '—'),
        Number(d.resultado.cobertura_pct.toFixed(1)),
      ];
      for (const ind of indicadoresPontuaveis) {
        const item = d.resultado.detalhe.find((x) => x.indicador === ind.mnemonico);
        linha.push(item?.entrou && item.nota != null ? Number(item.nota.toFixed(1)) : null);
      }
      diario.push(linha);
    }

    // ===== Aba: Leituras brutas =====
    const leituras: Celula[][] = [
      ['Data/Hora', 'Velocidade (km/h)', 'RPM', 'Odômetro (km)', 'Início faixa verde', 'Aprov. embalo', 'Motor parado', 'Acim. verde', 'Pressão acelerador'],
    ];
    for (const l of leiturasNoPeriodo) {
      const ind = l.indicadores_brutos || {};
      leituras.push([
        new Date(l.timestamp_leitura).toLocaleString('pt-BR'),
        l.velocidade_kmh != null ? Number(l.velocidade_kmh) : null,
        l.rpm != null ? Number(l.rpm) : null,
        l.odometro_km != null ? Number(Number(l.odometro_km).toFixed(1)) : null,
        ind.rpmZone ?? null,
        ind.inertiaUsage ?? null,
        ind.iddleTime ?? null,
        ind.accelerationExcess ?? null,
        ind.throttleAgregation ?? null,
      ]);
    }

    const buffer = gerarXlsx([
      { nome: 'Resumo', linhas: resumo, largurasColunas: [26, 30] },
      { nome: 'Composição da nota', linhas: composicao, largurasColunas: [28, 14, 10, 8, 10, 16] },
      { nome: 'Detalhamento diário', linhas: diario, largurasColunas: [14, 10, 12, 14, 14, ...indicadoresPontuaveis.map(() => 18)] },
      { nome: 'Leituras', linhas: leituras, largurasColunas: [20, 16, 8, 14, 16, 14, 14, 14, 16] },
    ]);

    const nomeArquivo = nomeArquivoXlsx(`conducao_economica_${motorista.nome}_${dataInicio.slice(0, 10)}_a_${dataFim.slice(0, 10)}`);

    const corpo = new Uint8Array(buffer).buffer as ArrayBuffer;

    return new NextResponse(corpo, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(nomeArquivo)}"`,
      },
    });
  } catch (erro) {
    console.error('Erro ao exportar motorista:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor', detalhe: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
