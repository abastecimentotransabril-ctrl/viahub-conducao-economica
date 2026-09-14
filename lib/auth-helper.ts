import { NextRequest } from 'next/server';
import { getSupabaseServer } from './supabase-server';

/**
 * Extrai e valida o usuário autenticado a partir do header
 * Authorization: Bearer <access_token> enviado pelo frontend.
 *
 * As rotas de API rodam no servidor e não têm acesso automático à
 * sessão armazenada no navegador — por isso o token precisa ser
 * enviado explicitamente em cada chamada fetch() do frontend.
 */
export async function getAuthenticatedUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Token de autenticação ausente' };
  }

  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return { user: null, error: 'Token de autenticação vazio' };
  }

  const supabaseServer = getSupabaseServer();
  const { data: { user }, error } = await supabaseServer.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: error?.message || 'Token inválido' };
  }

  return { user, error: null };
}
