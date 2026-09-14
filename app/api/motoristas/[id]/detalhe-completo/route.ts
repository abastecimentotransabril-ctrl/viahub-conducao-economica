import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { normalizarPayload, LeituraNormalizada } from '@/lib/maxtrack-parser';
import { calcularNotaFinal, ResultadoApuracao } from '@/lib/motor-apuracao';

export const dynamic = 'force-dynamic';

const LIMITE_LEITURAS = 50;
const LIMITE_RANKING_SCAN = 4000; // heurística: últimas N mensagens da empresa p/ montar ranking

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json(
        { sucesso: false, erro: authError || 'Não autenticado' },
        { status: 401 }
      );
    }

    const { data: usuario } = await supabaseServer
      .from('usuarios')
      .select('empresa_id, papel')
      .eq('id', user.id)
      .single();

    if (!usuario) {
      return NextResponse.json({ sucesso: false, erro: 'Usuário não encontrado' }, { status: 404 });
    }

    // Motorista
    const { data: motorista } = await supabaseServer
      .from('motoristas')
      .select('*')
      .eq('id', resolvedParams.id)
      .eq('empresa_id', usuario.empresa_id)
      .single();

    if (!motorista) {
      return NextResponse.json({ sucesso: false, erro: 'Motorista não encontrado' }, { status: 404 });
    }

    // Veículo alocado atualmente
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
      const { data: v } = await supabaseServer
        .from('veiculos')
        .select('*')
        .eq('id', alocacao.veiculo_id)
        .single();
      veiculo = v;
    }

    // Configuração vigente (indicadores, faixas, regras)
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

    // Telemetria real: buscar leituras da placa do motorista
    let leituras: LeituraNormalizada[] = [];
    if (veiculo?.placa) {
      const { data: mensagens } = await supabaseServer
        .from('maxtrack_mensagens_raw')
        .select('id, payload, recebido_em')
        .eq('empresa_id', usuario.empresa_id)
        .filter('payload->customerData->>plate', 'eq', veiculo.placa)
        .order('recebido_em', { ascending: false })
        .limit(LIMITE_LEITURAS);

      if (mensagens) {
        leituras = mensagens
          .map((m) => normalizarPayload(m.id, m.payload, m.recebido_em))
          .filter((l): l is LeituraNormalizada => l !== null && l.indicadoresBrutos !== null)
          .sort((a, b) => a.timestampUnix - b.timestampUnix); // cronológico
      }
    }

    // Calcular nota para cada leitura (usando config vigente)
    const calcular = (leitura: LeituraNormalizada): ResultadoApuracao | null => {
      if (!leitura.indicadoresBrutos || indicadores.length === 0) return null;
      return calcularNotaFinal(
        leitura.indicadoresBrutos as Record<string, number | null>,
        indicadores,
        faixasNota.map((f) => ({ nota_minima: f.nota_minima, rotulo: f.rotulo })),
        regras
      );
    };

    const leiturasComNota = leituras.map((l) => ({ leitura: l, resultado: calcular(l) }));
    const ultimaLeitura = leiturasComNota[leiturasComNota.length - 1] || null;
    const penultimaLeitura = leiturasComNota[leiturasComNota.length - 2] || null;

    // Ranking: heurística — pega as últimas N mensagens da empresa e calcula
    // a nota mais recente por placa. Não é um ranking oficial (isso viria de
    // uma execucoes_apuracao fechada), é uma visão em tempo real para a tela.
    let ranking: Array<{ placa: string; nome: string | null; nota: number | null; faixa: string | null }> = [];
    if (indicadores.length > 0) {
      const { data: mensagensRecentes } = await supabaseServer
        .from('maxtrack_mensagens_raw')
        .select('payload, recebido_em')
        .eq('empresa_id', usuario.empresa_id)
        .order('recebido_em', { ascending: false })
        .limit(LIMITE_RANKING_SCAN);

      if (mensagensRecentes) {
        const porPlaca = new Map<string, LeituraNormalizada>();
        for (const m of mensagensRecentes) {
          const placa = m.payload?.customerData?.plate;
          if (!placa || porPlaca.has(placa)) continue;
          const norm = normalizarPayload('x', m.payload, m.recebido_em);
          if (norm && norm.indicadoresBrutos) {
            porPlaca.set(placa, norm);
          }
        }

        // Buscar nomes dos motoristas por placa
        const placas = Array.from(porPlaca.keys());
        const { data: veiculosRank } = await supabaseServer
          .from('veiculos')
          .select('id, placa')
          .eq('empresa_id', usuario.empresa_id)
          .in('placa', placas);

        const veiculoIdPorPlaca = new Map((veiculosRank || []).map((v) => [v.placa, v.id]));
        const veiculoIds = Array.from(veiculoIdPorPlaca.values());

        const { data: alocacoesRank } = await supabaseServer
          .from('alocacoes_motorista_veiculo')
          .select('veiculo_id, motorista_id')
          .in('veiculo_id', veiculoIds)
          .is('fim', null);

        const motoristaIdPorVeiculo = new Map((alocacoesRank || []).map((a) => [a.veiculo_id, a.motorista_id]));
        const motoristaIds = Array.from(motoristaIdPorVeiculo.values());

        const { data: motoristasRank } = await supabaseServer
          .from('motoristas')
          .select('id, nome')
          .in('id', motoristaIds.length > 0 ? motoristaIds : ['00000000-0000-0000-0000-000000000000']);

        const nomePorMotorista = new Map((motoristasRank || []).map((m) => [m.id, m.nome]));

        for (const [placa, leitura] of porPlaca.entries()) {
          const resultado = calcular(leitura);
          const veiculoId = veiculoIdPorPlaca.get(placa);
          const motoristaId = veiculoId ? motoristaIdPorVeiculo.get(veiculoId) : null;
          const nome = motoristaId ? nomePorMotorista.get(motoristaId) : null;
          if (resultado?.elegivel) {
            ranking.push({
              placa,
              nome: nome || null,
              nota: resultado.nota_final,
              faixa: resultado.faixa_rotulo,
            });
          }
        }
        ranking.sort((a, b) => (b.nota || 0) - (a.nota || 0));
      }
    }

    // Atendimentos
    const { data: atendimentos } = await supabaseServer
      .from('atendimentos_master_drive')
      .select('*')
      .eq('motorista_id', resolvedParams.id)
      .order('criado_em', { ascending: false })
      .limit(10);

    // CPF mascarado
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
