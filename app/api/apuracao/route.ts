import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';
import { calcularNotaFinal } from '@/lib/motor-apuracao';

export const dynamic = 'force-dynamic';


export async function POST(request: NextRequest) {
  try {
    const { motorista_id, periodo_inicio, periodo_fim } = await request.json();

    // Verificar autenticação e permissão
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json(
        { sucesso: false, erro: authError || 'Não autenticado' },
        { status: 401 }
      );
    }

    // Obter usuário e verificar se é admin_gamificacao
    const { data: usuario } = await supabaseServer
      .from('usuarios')
      .select('empresa_id, papel')
      .eq('id', user.id)
      .single();

    if (!usuario || (usuario.papel !== 'admin_gamificacao' && usuario.papel !== 'gestor')) {
      return NextResponse.json(
        { sucesso: false, erro: 'Permissão negada' },
        { status: 403 }
      );
    }

    // Obter indicadores vigentes
    const { data: versaoVigente } = await supabaseServer
      .from('versoes_config')
      .select('id')
      .eq('empresa_id', usuario.empresa_id)
      .eq('vigente', true)
      .single();

    if (!versaoVigente) {
      return NextResponse.json(
        { sucesso: false, erro: 'Nenhuma configuração vigente' },
        { status: 400 }
      );
    }

    // Obter indicadores
    const { data: indicadores } = await supabaseServer
      .from('indicadores')
      .select('*')
      .eq('versao_config_id', versaoVigente.id);

    // Obter faixas de nota
    const { data: faixas } = await supabaseServer
      .from('faixas_nota')
      .select('nota_minima, rotulo')
      .eq('versao_config_id', versaoVigente.id)
      .order('nota_minima', { ascending: false });

    // Obter regras
    const { data: regras } = await supabaseServer
      .from('regras_apuracao')
      .select('sentinela, casas_decimais, cobertura_minima_pct')
      .eq('versao_config_id', versaoVigente.id)
      .single();

    // Obter leituras do período
    const { data: leituras } = await supabaseServer
      .from('leituras_telemetria')
      .select('indicadores_brutos')
      .eq('motorista_id', motorista_id)
      .gte('timestamp_leitura', periodo_inicio)
      .lte('timestamp_leitura', periodo_fim);

    // Agregar indicadores
    const indicadoresAgregados: Record<string, number[]> = {};
    
    if (leituras && leituras.length > 0) {
      for (const leitura of leituras) {
        for (const [chave, valor] of Object.entries(leitura.indicadores_brutos)) {
          if (!indicadoresAgregados[chave]) {
            indicadoresAgregados[chave] = [];
          }
          if (typeof valor === 'number') {
            indicadoresAgregados[chave].push(valor);
          }
        }
      }
    }

    // Calcular média
    const indicadoresMediana: Record<string, number | null> = {};
    for (const [chave, valores] of Object.entries(indicadoresAgregados)) {
      if (valores.length > 0) {
        indicadoresMediana[chave] = valores.reduce((a, b) => a + b, 0) / valores.length;
      } else {
        indicadoresMediana[chave] = null;
      }
    }

    // Calcular nota
    const resultado = calcularNotaFinal(
      indicadoresMediana,
      indicadores || [],
      faixas || [],
      regras || { sentinela: 1000, casas_decimais: 1, cobertura_minima_pct: 70 }
    );

    // Criar execução de apuração
    const { data: execucao } = await supabaseServer
      .from('execucoes_apuracao')
      .insert({
        versao_config_id: versaoVigente.id,
        motorista_id,
        periodo_inicio,
        periodo_fim,
        modo: 'simulacao',
        executado_por: user.id,
      })
      .select()
      .single();

    // Criar resultado
    if (execucao) {
      await supabaseServer
        .from('resultados_motorista')
        .insert({
          execucao_id: execucao.id,
          motorista_id,
          ...resultado,
          vigente: false,
        });
    }

    return NextResponse.json({
      sucesso: true,
      dados: {
        ...resultado,
        execucao_id: execucao?.id,
      },
    });
  } catch (erro) {
    console.error('Erro ao calcular apuração:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
