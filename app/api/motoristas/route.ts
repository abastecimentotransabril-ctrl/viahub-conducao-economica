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
    const [{ data: motoristas, error }, { data: placasAtuais }, { data: kmRodado }, { data: notas }] = await Promise.all([
      supabaseServer
        .from('motoristas')
        .select('id, nome, cpf, matricula, ativo')
        .eq('empresa_id', usuario.empresa_id)
        .order('nome'),
      supabaseServer.rpc('motoristas_com_placa_atual', { p_empresa_id: usuario.empresa_id }),
      // KM rodado nos últimos 30 dias (aproximação via leituras de telemetria,
      // enquanto alocacoes_motorista_veiculo não registra login/logout)
      supabaseServer.rpc('motoristas_km_rodado', { p_empresa_id: usuario.empresa_id, p_dias: 30 }),
      // Nota geral vigente (apuração mais recente marcada como vigente)
      supabaseServer
        .from('resultados_motorista')
        .select('motorista_id, nota_final, faixa_rotulo')
        .eq('vigente', true),
    ]);

    if (error) {
      return NextResponse.json(
        { sucesso: false, erro: error.message },
        { status: 500 }
      );
    }

    const placaPorMotorista = new Map((placasAtuais || []).map((p: any) => [p.motorista_id, p]));
    const kmPorMotorista = new Map((kmRodado || []).map((k: any) => [k.motorista_id, k]));
    const notaPorMotorista = new Map((notas || []).map((n: any) => [n.motorista_id, n]));

    // Mascarar CPF para papéis que não são RH/admin
    const motoristasPublicos = motoristas.map(m => {
      const veiculoAtual = placaPorMotorista.get(m.id) as any;
      const kmInfo = kmPorMotorista.get(m.id) as any;
      const notaInfo = notaPorMotorista.get(m.id) as any;
      const base = {
        ...m,
        placa: veiculoAtual?.placa || null,
        modelo_equipamento: veiculoAtual?.modelo_equipamento || null,
        km_rodado: kmInfo?.km_rodado ?? null,
        km_rodado_ultima_leitura: kmInfo?.ultima_leitura ?? null,
        nota_geral: notaInfo?.nota_final ?? null,
        nota_geral_faixa: notaInfo?.faixa_rotulo ?? null,
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
