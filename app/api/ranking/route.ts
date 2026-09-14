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
      .select('empresa_id')
      .eq('id', user.id)
      .single();

    if (!usuario) {
      return NextResponse.json(
        { sucesso: false, erro: 'Usuário não encontrado' },
        { status: 404 }
      );
    }

    // Obter ranking vigente
    const { data: ranking } = await supabaseServer
      .from('resultados_motorista')
      .select(`
        id,
        motorista_id,
        nota_final,
        faixa_rotulo,
        cobertura_pct,
        vigente,
        motoristas!motorista_id (
          nome,
          id
        ),
        veiculos:alocacoes_motorista_veiculo!motorista_id (
          veiculo_id,
          veiculos (
            placa
          )
        )
      `)
      .eq('vigente', true)
      .order('nota_final', { ascending: false })
      .limit(20);

    if (!ranking) {
      return NextResponse.json({
        sucesso: true,
        dados: [],
      });
    }

    // Formatar resposta
    const rankingFormatado = ranking
      .filter((r: any) => r.nota_final !== null && r.motoristas)
      .map((r: any, index: number) => ({
        posicao: index + 1,
        motorista_id: r.motorista_id,
        nome: r.motoristas.nome,
        placa: r.veiculos?.[0]?.veiculos?.placa || 'N/A',
        nota: r.nota_final,
        faixa: r.faixa_rotulo,
        cobertura_pct: r.cobertura_pct,
      }));

    return NextResponse.json({
      sucesso: true,
      dados: rankingFormatado,
    });
  } catch (erro) {
    console.error('Erro ao obter ranking:', erro);
    return NextResponse.json(
      { sucesso: false, erro: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
