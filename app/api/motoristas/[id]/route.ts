import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    
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

    // Obter motorista
    const { data: motorista } = await supabaseServer
      .from('motoristas')
      .select('*')
      .eq('id', resolvedParams.id)
      .eq('empresa_id', usuario.empresa_id)
      .single();

    if (!motorista) {
      return NextResponse.json(
        { sucesso: false, erro: 'Motorista não encontrado' },
        { status: 404 }
      );
    }

    // Obter veículo atual
    const { data: alocacao } = await supabaseServer
      .from('alocacoes_motorista_veiculo')
      .select('veiculo_id, inicio, fim')
      .eq('motorista_id', resolvedParams.id)
      .is('fim', null)
      .single();

    let veiculo = null;
    if (alocacao) {
      const { data: v } = await supabaseServer
        .from('veiculos')
        .select('*')
        .eq('id', alocacao.veiculo_id)
        .single();
      veiculo = v;
    }

    // Obter leitura mais recente
    const { data: leituraRecente } = await supabaseServer
      .from('leituras_telemetria')
      .select('*')
      .eq('motorista_id', resolvedParams.id)
      .order('timestamp_leitura', { ascending: false })
      .limit(1)
      .single();

    // Obter resultado vigente
    const { data: resultadoVigente } = await supabaseServer
      .from('resultados_motorista')
      .select('*')
      .eq('motorista_id', resolvedParams.id)
      .eq('vigente', true)
      .single();

    // Obter atendimentos recentes
    const { data: atendimentos } = await supabaseServer
      .from('atendimentos_master_drive')
      .select('*')
      .eq('motorista_id', resolvedParams.id)
      .order('criado_em', { ascending: false })
      .limit(5);

    // Mascarar CPF se não for RH/admin
    let cpf = null;
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
        leituraRecente,
        resultadoVigente,
        atendimentos: atendimentos || [],
      },
    });
  } catch (erro) {
    console.error('Erro ao obter motorista:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
