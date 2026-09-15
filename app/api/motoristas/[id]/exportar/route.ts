import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal, ResultadoApuracao } from '@/lib/motor-apuracao';
import { gerarCsv } from '@/lib/csv-helper';

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
      supabaseServer.from('leituras_telemetria').select('*').eq('motorista_id', resolvedParams.id).order('timestamp_leitura', { ascending: true }).limit(500),
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
        supabaseServer.from('indicadores').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('faixas_nota').select('*').eq('versao_config_id', versaoVigente.id),
        supabaseServer.from('regras_apuracao').select('*').eq('versao_config_id', versaoVigente.id).maybeSingle(),
      ]);
      indicadores = ind || [];
      faixasNota = fn || [];
      if (rg) regras = rg;
    }

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
        faixasNota.map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
    }

    // Leituras dentro do período selecionado (para a aba de detalhe)
    const leiturasNoPeriodo = (leiturasRaw || []).filter((l: any) => {
      const t = new Date(l.timestamp_leitura).getTime();
      return t >= new Date(dataInicio).getTime() && t <= new Date(dataFim).getTime();
    });

    // ===== Montar CSV =====
    const linhas: string[][] = [];

    linhas.push(['RESUMO — CONDUÇÃO ECONÔMICA']);
    linhas.push(['Motorista', motorista.nome]);
    linhas.push(['Matrícula', motorista.matricula || '—']);
    linhas.push(['Configuração vigente', versaoVigente?.nome || '—']);
    linhas.push(['Período', `${new Date(dataInicio).toLocaleDateString('pt-BR')} a ${new Date(dataFim).toLocaleDateString('pt-BR')}`]);
    linhas.push(['Leituras no período', String(resultadoPeriodo ? (agregado?.qtd_leituras ?? 0) : 0)]);
    linhas.push(['Nota final (acumulada)', resultadoPeriodo?.nota_final != null ? resultadoPeriodo.nota_final.toFixed(1) : '—']);
    linhas.push(['Faixa', resultadoPeriodo?.faixa_rotulo || (resultadoPeriodo?.motivo_inelegibilidade ? 'Inelegível' : '—')]);
    linhas.push(['Cobertura', resultadoPeriodo ? `${resultadoPeriodo.cobertura_pct.toFixed(1)}%` : '—']);
    linhas.push([]);

    linhas.push(['COMPOSIÇÃO DA NOTA (período acumulado)']);
    linhas.push(['Indicador', 'Valor médio', 'Nota', 'Peso', 'Pontos']);
    if (resultadoPeriodo) {
      for (const d of resultadoPeriodo.detalhe) {
        const indDef = indicadores.find((i) => i.mnemonico === d.indicador);
        linhas.push([
          indDef?.nome || d.indicador,
          d.valor != null ? d.valor.toFixed(1) : '—',
          d.nota != null ? d.nota.toFixed(1) : '—',
          String(d.peso),
          d.pontos != null ? d.pontos.toFixed(1) : 'sem dado',
        ]);
      }
    }
    linhas.push([]);

    linhas.push(['LEITURAS NO PERÍODO SELECIONADO']);
    linhas.push(['Data/Hora', 'Velocidade (km/h)', 'RPM', 'Odômetro (km)', 'Início faixa verde', 'Aprov. embalo', 'Motor parado', 'Acim. verde', 'Pressão acelerador']);
    for (const l of leiturasNoPeriodo) {
      const ind = l.indicadores_brutos || {};
      linhas.push([
        new Date(l.timestamp_leitura).toLocaleString('pt-BR'),
        l.velocidade_kmh != null ? String(l.velocidade_kmh) : '—',
        l.rpm != null ? String(l.rpm) : '—',
        l.odometro_km != null ? Number(l.odometro_km).toFixed(1) : '—',
        ind.rpmZone != null ? String(ind.rpmZone) : '—',
        ind.inertiaUsage != null ? String(ind.inertiaUsage) : '—',
        ind.iddleTime != null ? String(ind.iddleTime) : '—',
        ind.accelerationExcess != null ? String(ind.accelerationExcess) : '—',
        ind.throttleAgregation != null ? String(ind.throttleAgregation) : '—',
      ]);
    }

    const csv = gerarCsv(linhas);
    const nomeArquivo = `condução-econômica_${motorista.nome.replace(/\s+/g, '_')}_${dataInicio.slice(0, 10)}_a_${dataFim.slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
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
