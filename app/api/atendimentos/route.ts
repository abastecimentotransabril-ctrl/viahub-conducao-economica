import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabase } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';


export async function POST(request: NextRequest) {
  try {
    const {
      motorista_id,
      indicador_mnemonico,
      resumo,
      resultado,
    } = await request.json();

    // Verificar autenticação
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { sucesso: false, erro: 'Não autenticado' },
        { status: 401 }
      );
    }

    // Verificar se é Master Drive
    const { data: usuario } = await supabaseServer
      .from('usuarios')
      .select('empresa_id, papel')
      .eq('id', user.id)
      .single();

    if (!usuario || usuario.papel !== 'master_drive') {
      return NextResponse.json(
        { sucesso: false, erro: 'Permissão negada' },
        { status: 403 }
      );
    }

    // Verificar escopo do Master Drive
    const { data: escopo } = await supabaseServer
      .from('master_drive_escopos')
      .select('*')
      .eq('usuario_id', user.id)
      .eq('ativo', true)
      .single();

    if (!escopo) {
      return NextResponse.json(
        { sucesso: false, erro: 'Nenhum escopo configurado' },
        { status: 403 }
      );
    }

    // Verificar se motorista está no escopo
    const { data: motorista } = await supabaseServer
      .from('motoristas')
      .select('empresa_id')
      .eq('id', motorista_id)
      .eq('empresa_id', escopo.empresa_id)
      .single();

    if (!motorista) {
      return NextResponse.json(
        { sucesso: false, erro: 'Motorista não encontrado no escopo' },
        { status: 404 }
      );
    }

    // Criar atendimento
    const { data: atendimento, error } = await supabaseServer
      .from('atendimentos_master_drive')
      .insert({
        motorista_id,
        master_drive_usuario_id: user.id,
        indicador_mnemonico,
        resumo,
        resultado,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { sucesso: false, erro: error.message },
        { status: 500 }
      );
    }

    // Registrar em auditoria
    await supabaseServer
      .from('log_auditoria')
      .insert({
        empresa_id: usuario.empresa_id,
        usuario_id: user.id,
        tabela_afetada: 'atendimentos_master_drive',
        registro_id: atendimento.id,
        acao: 'criacao',
        valor_depois: atendimento,
      });

    return NextResponse.json({
      sucesso: true,
      dados: atendimento,
    });
  } catch (erro) {
    console.error('Erro ao criar atendimento:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const motorista_id = request.nextUrl.searchParams.get('motorista_id');

    if (!motorista_id) {
      return NextResponse.json(
        { sucesso: false, erro: 'motorista_id é obrigatório' },
        { status: 400 }
      );
    }

    // Verificar autenticação
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { sucesso: false, erro: 'Não autenticado' },
        { status: 401 }
      );
    }

    // Obter atendimentos
    const { data: atendimentos, error } = await supabaseServer
      .from('atendimentos_master_drive')
      .select('*')
      .eq('motorista_id', motorista_id)
      .order('criado_em', { ascending: false });

    if (error) {
      return NextResponse.json(
        { sucesso: false, erro: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      sucesso: true,
      dados: atendimentos,
    });
  } catch (erro) {
    console.error('Erro ao listar atendimentos:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
