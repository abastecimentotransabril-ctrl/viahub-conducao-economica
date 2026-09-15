import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal, ResultadoApuracao } from '@/lib/motor-apuracao';

export const dynamic = 'force-dynamic';

const LIMITE_LEITURAS_DETALHE = 100;
const LIMITE_PONTOS_MAPA = 1000;
const LIMITE_LEITURAS_PERIODO = 2000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const searchParams = request.nextUrl.searchParams;

    // Onda 1: autenticação (sequencial por necessidade — precisa do token
    // validado antes de qualquer outra coisa)
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

    // Onda 2: TUDO que só depende de usuario.empresa_id / resolvedParams.id
    // roda em paralelo — nenhuma dessas consultas depende do resultado de outra.
    const [
      { data: motorista },
      { data: alocacao },
      { data: versaoVigente },
      { data: leiturasRaw },
      { data: pontosTrajetoRaw },
      { data: leiturasPeriodoRaw },
      { data: agregadoPeriodo },
      { data: agregadosFrota },
      { data: atendimentos },
    ] = await Promise.all([
      supabaseServer.from('motoristas').select('*').eq('id', resolvedParams.id).eq('empresa_id', usuario.empresa_id).single(),
      supabaseServer.from('alocacoes_motorista_veiculo').select('veiculo_id').eq('motorista_id', resolvedParams.id).is('fim', null).order('inicio', { ascending: false }).limit(1).maybeSingle(),
      supabaseServer.from('versoes_config').select('id, nome').eq('empresa_id', usuario.empresa_id).eq('vigente', true).maybeSingle(),
      supabaseServer.from('leituras_telemetria').select('*').eq('motorista_id', resolvedParams.id).order('timestamp_leitura', { ascending: false }).limit(LIMITE_LEITURAS_DETALHE),
      supabaseServer
        .from('leituras_telemetria')
        .select('id, timestamp_leitura, latitude, longitude, velocidade_kmh, rpm')
        .eq('motorista_id', resolvedParams.id)
        .gte('timestamp_leitura', dataInicio)
        .lte('timestamp_leitura', dataFim)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('timestamp_leitura', { ascending: true })
        .limit(LIMITE_PONTOS_MAPA),
      // Todas as leituras REAIS do período exato selecionado (não as 100
      // mais recentes globais) — usadas para o detalhamento hora a hora.
      supabaseServer
        .from('leituras_telemetria')
        .select('id, timestamp_leitura, velocidade_kmh, rpm, indicadores_brutos')
        .eq('motorista_id', resolvedParams.id)
        .gte('timestamp_leitura', dataInicio)
        .lte('timestamp_leitura', dataFim)
        .order('timestamp_leitura', { ascending: true })
        .limit(LIMITE_LEITURAS_PERIODO),
      supabaseServer.rpc('apurar_periodo_motorista', { p_motorista_id: resolvedParams.id, p_data_inicio: dataInicio, p_data_fim: dataFim }),
      supabaseServer.rpc('apurar_periodo_frota', { p_empresa_id: usuario.empresa_id, p_data_inicio: dataInicio, p_data_fim: dataFim }),
      supabaseServer.from('atendimentos_master_drive').select('*').eq('motorista_id', resolvedParams.id).order('criado_em', { ascending: false }).limit(10),
    ]);

    if (!motorista) {
      return NextResponse.json({ sucesso: false, erro: 'Motorista não encontrado' }, { status: 404 });
    }

    // Onda 3: consultas que dependem de resultados da onda 2, mas são
    // independentes ENTRE SI — também rodam em paralelo.
    const veiculoIdsFrota = Array.from(new Set((agregadosFrota || []).map((a: any) => a.veiculo_id)));
    const motoristaIdsFrota = Array.from(new Set((agregadosFrota || []).map((a: any) => a.motorista_id).filter(Boolean)));

    // Preferir a alocação explícita (se existir); na falta dela — caso comum
    // para os motoristas reais, cujo vínculo é feito por CPF no pacote da
    // Maxtrack, não por alocação fixa — usar o veículo da leitura mais
    // recente desse motorista (leiturasRaw já vem ordenada da mais nova
    // para a mais antiga).
    const veiculoIdResolvido = alocacao?.veiculo_id || (leiturasRaw && leiturasRaw[0]?.veiculo_id) || null;

    const [
      { data: veiculo },
      { data: indicadores },
      { data: faixasNota },
      { data: faixasClassificacao },
      { data: regrasArr },
      { data: veiculosInfo },
      { data: motoristasInfo },
    ] = await Promise.all([
      veiculoIdResolvido
        ? supabaseServer.from('veiculos').select('*').eq('id', veiculoIdResolvido).single()
        : Promise.resolve({ data: null }),
      versaoVigente ? supabaseServer.from('indicadores').select('*').eq('versao_config_id', versaoVigente.id) : Promise.resolve({ data: [] as any[] }),
      versaoVigente ? supabaseServer.from('faixas_nota').select('*').eq('versao_config_id', versaoVigente.id) : Promise.resolve({ data: [] as any[] }),
      versaoVigente ? supabaseServer.from('faixas_classificacao').select('*').eq('versao_config_id', versaoVigente.id) : Promise.resolve({ data: [] as any[] }),
      versaoVigente ? supabaseServer.from('regras_apuracao').select('*').eq('versao_config_id', versaoVigente.id).maybeSingle() : Promise.resolve({ data: null }),
      veiculoIdsFrota.length > 0 ? supabaseServer.from('veiculos').select('id, placa').in('id', veiculoIdsFrota) : Promise.resolve({ data: [] as any[] }),
      motoristaIdsFrota.length > 0 ? supabaseServer.from('motoristas').select('id, nome').in('id', motoristaIdsFrota) : Promise.resolve({ data: [] as any[] }),
    ]);

    const indicadoresArr = indicadores || [];
    const faixasNotaArr = faixasNota || [];
    const regras = regrasArr || { sentinela: 1000, casas_decimais: 1, cobertura_minima_pct: 70 };

    const calcular = (indicadoresBrutos: Record<string, number | null> | null): ResultadoApuracao | null => {
      if (!indicadoresBrutos || indicadoresArr.length === 0) return null;
      return calcularNotaFinal(
        indicadoresBrutos,
        indicadoresArr,
        faixasNotaArr.map((f: any) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
    };

    // Leituras REAIS do período exato selecionado (não as 100 mais
    // recentes globais) — cada uma com sua nota momentânea calculada.
    const leiturasPeriodoComNota = (leiturasPeriodoRaw || []).map((l: any) => ({
      id: l.id,
      dataHoraISO: l.timestamp_leitura,
      velocidadeKmh: l.velocidade_kmh,
      rpm: l.rpm,
      resultado: calcular(l.indicadores_brutos),
    }));

    // Agrupamento por hora do dia (00h-23h) — só entram os blocos que
    // realmente têm leitura; nunca preenchemos hora sem dado.
    const blocosPorHora = new Map<string, { horaInicio: string; leituras: typeof leiturasPeriodoComNota }>();
    for (const l of leiturasPeriodoComNota) {
      const d = new Date(l.dataHoraISO);
      const chave = `${d.toISOString().slice(0, 10)}T${String(d.getHours()).padStart(2, '0')}`;
      if (!blocosPorHora.has(chave)) {
        blocosPorHora.set(chave, { horaInicio: chave, leituras: [] });
      }
      blocosPorHora.get(chave)!.leituras.push(l);
    }
    const detalhamentoPorHora = Array.from(blocosPorHora.values())
      .map((bloco) => {
        const comNota = bloco.leituras.filter((l) => l.resultado?.nota_final != null);
        const notaMedia = comNota.length > 0
          ? comNota.reduce((s, l) => s + (l.resultado!.nota_final as number), 0) / comNota.length
          : null;
        return {
          horaInicio: bloco.horaInicio,
          qtdLeituras: bloco.leituras.length,
          notaMedia,
          velocidadeMedia: bloco.leituras.filter((l) => l.velocidadeKmh != null).length > 0
            ? bloco.leituras.reduce((s, l) => s + (l.velocidadeKmh || 0), 0) / bloco.leituras.filter((l) => l.velocidadeKmh != null).length
            : null,
        };
      })
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

    const leituras = (leiturasRaw || [])
      .slice()
      .reverse()
      .map((l: any) => ({
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

    const leiturasComNota = leituras.map((l) => ({ leitura: l, resultado: calcular(l.indicadoresBrutos) }));
    const ultimaLeitura = leiturasComNota[leiturasComNota.length - 1] || null;
    const penultimaLeitura = leiturasComNota[leiturasComNota.length - 2] || null;

    let resultadoPeriodo: (ResultadoApuracao & { qtdLeituras: number; primeiraLeitura: string | null; ultimaLeituraPeriodo: string | null }) | null = null;
    const agregado = agregadoPeriodo?.[0];
    if (agregado && agregado.qtd_leituras > 0 && indicadoresArr.length > 0) {
      const indicadorBruto = {
        rpmZone: agregado.avg_rpmzone,
        inertiaUsage: agregado.avg_inertiausage,
        iddleTime: agregado.avg_iddletime,
        accelerationExcess: agregado.avg_accelerationexcess,
        throttleAgregation: agregado.avg_throttleagregation,
      };
      const r = calcularNotaFinal(
        indicadorBruto,
        indicadoresArr,
        faixasNotaArr.map((f: any) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
      resultadoPeriodo = {
        ...r,
        qtdLeituras: Number(agregado.qtd_leituras),
        primeiraLeitura: agregado.primeira_leitura,
        ultimaLeituraPeriodo: agregado.ultima_leitura,
      };
    }

    const ranking: Array<{ placa: string; nome: string | null; nota: number | null; faixa: string | null }> = [];
    if (indicadoresArr.length > 0 && agregadosFrota) {
      const placaPorVeiculo = new Map((veiculosInfo || []).map((v: any) => [v.id, v.placa]));
      const nomePorMotorista = new Map((motoristasInfo || []).map((m: any) => [m.id, m.nome]));

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
          indicadoresArr,
          faixasNotaArr.map((f: any) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
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

    let cpf: string | null = null;
    if (usuario.papel === 'rh' || usuario.papel === 'admin_gamificacao') {
      cpf = motorista.cpf;
    } else if (motorista.cpf) {
      cpf = motorista.cpf.replace(/(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})/, '$1.***.**$2');
    }

    const pontosTrajeto = (pontosTrajetoRaw || []).map((p: any) => ({
      id: p.id,
      dataHoraISO: p.timestamp_leitura,
      lat: p.latitude,
      lon: p.longitude,
      velocidadeKmh: p.velocidade_kmh,
      rpm: p.rpm,
    }));

    return NextResponse.json({
      sucesso: true,
      dados: {
        motorista: { ...motorista, cpf },
        veiculo,
        configVigente: versaoVigente,
        indicadores: indicadoresArr,
        faixasNota: faixasNotaArr,
        faixasClassificacao: faixasClassificacao || [],
        leiturasComNota,
        ultimaLeitura,
        penultimaLeitura,
        periodo: { inicio: dataInicio, fim: dataFim },
        resultadoPeriodo,
        pontosTrajeto,
        leiturasPeriodoComNota,
        detalhamentoPorHora,
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
