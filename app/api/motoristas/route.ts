import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAuthenticatedUser } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';


export async function GET(request: NextRequest) {
  try {
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

    // Listar motoristas da empresa
    const [{ data: motoristas, error }, { data: placasAtuais }] = await Promise.all([
      supabaseServer
        .from('motoristas')
        .select('id, nome, cpf, matricula, ativo')
        .eq('empresa_id', usuario.empresa_id)
        .order('nome'),
      supabaseServer.rpc('motoristas_com_placa_atual', { p_empresa_id: usuario.empresa_id }),
    ]);

    if (error) {
      return NextResponse.json(
        { sucesso: false, erro: error.message },
        { status: 500 }
      );
    }

    const placaPorMotorista = new Map((placasAtuais || []).map((p: any) => [p.motorista_id, p]));

    // Mascarar CPF para papéis que não são RH/admin
    const motoristasPublicos = motoristas.map(m => {
      const veiculoAtual = placaPorMotorista.get(m.id) as any;
      const base = {
        ...m,
        placa: veiculoAtual?.placa || null,
        modelo_equipamento: veiculoAtual?.modelo_equipamento || null,
      };
      if (usuario.papel === 'rh' || usuario.papel === 'admin_gamificacao') {
        return base;
      }
      return {
        ...base,
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
