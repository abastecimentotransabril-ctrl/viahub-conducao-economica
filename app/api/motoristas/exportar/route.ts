import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal } from '@/lib/motor-apuracao';
import { gerarXlsx, nomeArquivoXlsx, Celula } from '@/lib/xlsx-helper';

export const dynamic = 'force-dynamic';

type Somas = { rpmZone: number; inertiaUsage: number; iddleTime: number; accelerationExcess: number; throttleAgregation: number };

function novaSoma(): Somas {
  return { rpmZone: 0, inertiaUsage: 0, iddleTime: 0, accelerationExcess: 0, throttleAgregation: 0 };
}

function acumular(somas: Somas, a: any, peso: number) {
  const pares: Array<[keyof Somas, string]> = [
    ['rpmZone', 'avg_rpmzone'],
    ['inertiaUsage', 'avg_inertiausage'],
    ['iddleTime', 'avg_iddletime'],
    ['accelerationExcess', 'avg_accelerationexcess'],
    ['throttleAgregation', 'avg_throttleagregation'],
  ];
  for (const [destino, origem] of pares) {
    const valor = a[origem];
    if (valor !== null && valor !== undefined) {
      somas[destino] += Number(valor) * peso;
    }
  }
}

function mediaDe(somas: Somas, pesoTotal: number): Record<string, number | null> {
  const r: Record<string, number | null> = {};
  for (const chave of Object.keys(somas) as (keyof Somas)[]) {
    r[chave] = pesoTotal > 0 ? somas[chave] / pesoTotal : null;
  }
  return r;
}

export async function GET(request: NextRequest) {
  try {
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

    const searchParams = request.nextUrl.searchParams;
    const agora = new Date();
    const trintaDiasAtras = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dataInicio = searchParams.get('inicio') || trintaDiasAtras.toISOString();
    const dataFim = searchParams.get('fim') || agora.toISOString();
    const busca = (searchParams.get('busca') || '').trim().toLowerCase();

    const [
      { data: motoristas },
      { data: placasAtuais },
      { data: kmRodado },
      { data: versaoVigente },
      { data: agregadosFrota },
      { data: agregadosPorDia },
    ] = await Promise.all([
      supabaseServer.from('motoristas').select('id, nome, cpf, matricula, ativo').eq('empresa_id', usuario.empresa_id).order('nome'),
      supabaseServer.rpc('motoristas_com_placa_atual', { p_empresa_id: usuario.empresa_id }),
      supabaseServer.rpc('motoristas_km_rodado_periodo', { p_empresa_id: usuario.empresa_id, p_data_inicio: dataInicio, p_data_fim: dataFim }),
      supabaseServer.from('versoes_config').select('id, nome').eq('empresa_id', usuario.empresa_id).eq('vigente', true).maybeSingle(),
      supabaseServer.rpc('apurar_periodo_frota', { p_empresa_id: usuario.empresa_id, p_data_inicio: dataInicio, p_data_fim: dataFim }),
      supabaseServer.rpc('apurar_por_dia_frota', { p_empresa_id: usuario.empresa_id, p_data_inicio: dataInicio, p_data_fim: dataFim }),
    ]);

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
    const faixasNotaSimples = faixasNota.map((f: any) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo }));
    const indicadoresPontuaveis = indicadores.filter((i) => i.tipo === 'pontua' && i.campo_fonte);
    const nomeIndicador = (mnemonico: string) => indicadores.find((i) => i.mnemonico === mnemonico)?.nome || mnemonico;

    const placaPorMotorista = new Map((placasAtuais || []).map((p: any) => [p.motorista_id, p]));
    const kmPorMotorista = new Map((kmRodado || []).map((k: any) => [k.motorista_id, k]));

    // Nota geral por motorista (combina múltiplos veículos no período)
    const somaPorMotorista = new Map<string, { somas: Somas; peso: number }>();
    for (const a of agregadosFrota || []) {
      if (!a.motorista_id) continue;
      const peso = Number(a.qtd_leituras) || 0;
      if (peso === 0) continue;
      const atual = somaPorMotorista.get(a.motorista_id) || { somas: novaSoma(), peso: 0 };
      acumular(atual.somas, a, peso);
      atual.peso += peso;
      somaPorMotorista.set(a.motorista_id, atual);
    }
    const notaPorMotorista = new Map<string, ReturnType<typeof calcularNotaFinal>>();
    if (indicadores.length > 0) {
      for (const [motoristaId, { somas, peso }] of somaPorMotorista.entries()) {
        notaPorMotorista.set(motoristaId, calcularNotaFinal(mediaDe(somas, peso), indicadores, faixasNotaSimples, regras));
      }
    }

    // Notas diárias por motorista (combina múltiplos veículos no mesmo dia)
    const somaPorMotoristaDia = new Map<string, Map<string, { somas: Somas; peso: number; qtdLeituras: number }>>();
    for (const a of agregadosPorDia || []) {
      if (!a.motorista_id) continue;
      const peso = Number(a.qtd_leituras) || 0;
      if (peso === 0) continue;
      const porDia = somaPorMotoristaDia.get(a.motorista_id) || new Map();
      const atual = porDia.get(a.dia) || { somas: novaSoma(), peso: 0, qtdLeituras: 0 };
      acumular(atual.somas, a, peso);
      atual.peso += peso;
      atual.qtdLeituras += peso;
      porDia.set(a.dia, atual);
      somaPorMotoristaDia.set(a.motorista_id, porDia);
    }

    // Filtro de busca (nome ou placa), mesmo comportamento da tela
    const motoristasFiltrados = (motoristas || []).filter((m: any) => {
      if (!busca) return true;
      const placa = (placaPorMotorista.get(m.id) as any)?.placa || '';
      return m.nome.toLowerCase().includes(busca) || placa.toLowerCase().includes(busca);
    });

    const podeVerCpf = usuario.papel === 'rh' || usuario.papel === 'admin_gamificacao';

    // ===== Aba: Motoristas =====
    const abaMotoristas: Celula[][] = [
      ['Motorista', 'Matrícula', 'Placa', 'Status', 'KM Rodado', 'Nota Geral', 'Faixa', 'Cobertura (%)'],
    ];
    // ===== Aba: Notas diárias por motorista =====
    const cabecalhoDiario: Celula[] = ['Motorista', 'Placa', 'Dia', 'Leituras', 'Nota do dia', 'Faixa'];
    for (const ind of indicadoresPontuaveis) cabecalhoDiario.push(ind.nome);
    const abaDiaria: Celula[][] = [cabecalhoDiario];

    for (const m of motoristasFiltrados) {
      const veiculoAtual = placaPorMotorista.get(m.id) as any;
      const kmInfo = kmPorMotorista.get(m.id) as any;
      const resultado = notaPorMotorista.get(m.id);

      abaMotoristas.push([
        m.nome,
        m.matricula || '—',
        veiculoAtual?.placa || '—',
        m.ativo ? 'Ativo' : 'Inativo',
        kmInfo?.km_rodado != null ? Number(Number(kmInfo.km_rodado).toFixed(1)) : null,
        resultado?.nota_final != null ? Number(resultado.nota_final.toFixed(1)) : null,
        resultado?.faixa_rotulo || (resultado?.motivo_inelegibilidade ? 'Inelegível' : '—'),
        resultado ? Number(resultado.cobertura_pct.toFixed(1)) : null,
      ]);

      const porDia = somaPorMotoristaDia.get(m.id);
      if (porDia) {
        const dias = Array.from(porDia.keys()).sort();
        for (const dia of dias) {
          const { somas, peso, qtdLeituras } = porDia.get(dia)!;
          const resultadoDia = indicadores.length > 0
            ? calcularNotaFinal(mediaDe(somas, peso), indicadores, faixasNotaSimples, regras)
            : null;
          const linha: Celula[] = [
            m.nome,
            veiculoAtual?.placa || '—',
            new Date(dia + 'T00:00:00').toLocaleDateString('pt-BR'),
            qtdLeituras,
            resultadoDia?.nota_final != null ? Number(resultadoDia.nota_final.toFixed(1)) : null,
            resultadoDia?.faixa_rotulo || (resultadoDia?.motivo_inelegibilidade ? 'Inelegível' : '—'),
          ];
          for (const ind of indicadoresPontuaveis) {
            const item = resultadoDia?.detalhe.find((x) => x.indicador === ind.mnemonico);
            linha.push(item?.entrou && item.nota != null ? Number(item.nota.toFixed(1)) : null);
          }
          abaDiaria.push(linha);
        }
      }
    }

    // ===== Aba: Resumo da exportação =====
    const abaResumo: Celula[][] = [
      ['RELATÓRIO — CONDUÇÃO ECONÔMICA (FROTA)', ''],
      ['Empresa', 'Transabril'],
      ['Configuração vigente', versaoVigente?.nome || '—'],
      ['Período', `${new Date(dataInicio).toLocaleDateString('pt-BR')} a ${new Date(dataFim).toLocaleDateString('pt-BR')}`],
      ['Filtro de busca aplicado', busca || '(nenhum)'],
      ['Motoristas no relatório', motoristasFiltrados.length],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      [],
      ['Metodologia', ''],
      ['KM rodado: maior odômetro - menor odômetro registrado no período, por motorista e veículo.', ''],
      ['Nota geral: média dos indicadores de condução ponderada pelo tempo entre leituras (capado em 15 min), no período selecionado.', ''],
      ['Notas diárias: mesma metodologia, aplicada dia a dia.', ''],
    ];

    if (!podeVerCpf) {
      abaResumo.push([]);
      abaResumo.push(['Observação: CPF não incluído neste relatório (perfil sem permissão de RH/gestão de gamificação).', '']);
    }

    const buffer = gerarXlsx([
      { nome: 'Resumo', linhas: abaResumo, largurasColunas: [70, 20] },
      { nome: 'Motoristas', linhas: abaMotoristas, largurasColunas: [30, 12, 12, 10, 14, 12, 14, 14] },
      { nome: 'Notas diárias', linhas: abaDiaria, largurasColunas: [30, 12, 12, 10, 12, 14, ...indicadoresPontuaveis.map(() => 18)] },
    ]);

    const nomeArquivo = nomeArquivoXlsx(`motoristas_conducao_economica_${dataInicio.slice(0, 10)}_a_${dataFim.slice(0, 10)}`);

    const corpo = new Uint8Array(buffer).buffer as ArrayBuffer;

    return new NextResponse(corpo, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(nomeArquivo)}"`,
      },
    });
  } catch (erro) {
    console.error('Erro ao exportar frota:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor', detalhe: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
