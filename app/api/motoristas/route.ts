import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabase } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticação
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { sucesso: false, erro: 'Não autenticado' },
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

    // Listar motoristas da empresa
    const { data: motoristas, error } = await supabaseServer
      .from('motoristas')
      .select('id, nome, cpf, matricula, ativo')
      .eq('empresa_id', usuario.empresa_id)
      .order('nome');

    if (error) {
      return NextResponse.json(
        { sucesso: false, erro: error.message },
        { status: 500 }
      );
    }

    // Mascarar CPF para papéis que não são RH/admin
    const motoristasPublicos = motoristas.map(m => {
      if (usuario.papel === 'rh' || usuario.papel === 'admin_gamificacao') {
        return m;
      }
      return {
        ...m,
        cpf: m.cpf ? m.cpf.replace(/(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})/, '$1.***.**$2') : null,
      };
    });

    return NextResponse.json({
      sucesso: true,
      dados: motoristasPublicos,
    });
  } catch (erro) {
    console.error('Erro ao listar motoristas:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
