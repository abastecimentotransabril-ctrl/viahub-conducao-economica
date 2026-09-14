import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabaseServer: SupabaseClient | null = null;

/**
 * Cliente Supabase server-side (service role).
 * Inicialização lazy para não quebrar o build quando as variáveis
 * de ambiente ainda não estão configuradas (ex.: build na Vercel
 * antes de definir Environment Variables).
 */
export function getSupabaseServer(): SupabaseClient {
  if (_supabaseServer) return _supabaseServer;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Variáveis de ambiente do Supabase não configuradas: ' +
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.'
    );
  }

  _supabaseServer = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _supabaseServer;
}

// Mantido por compatibilidade com código existente que importa `supabaseServer`
// diretamente. Vira um Proxy que só cria o client de fato no primeiro uso.
export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseServer();
    // @ts-expect-error - acesso dinâmico de propriedade do client real
    return client[prop];
  },
});
