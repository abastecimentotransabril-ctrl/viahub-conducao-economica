import { supabase } from './supabase-client';

/**
 * Wrapper de fetch que injeta automaticamente o header
 * Authorization: Bearer <token> a partir da sessão ativa do Supabase.
 *
 * Use isso em vez de fetch() puro para chamar as rotas /api/** do projeto.
 */
export async function fetchAutenticado(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = new Headers(options.headers || {});
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
