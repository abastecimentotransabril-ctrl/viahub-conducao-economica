'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-client';
import { fetchAutenticado } from '@/lib/fetch-autenticado';

interface Motorista {
  id: string;
  nome: string;
  matricula: string | null;
  cpf: string | null;
  ativo: boolean;
}

export default function Dashboard() {
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [usuario, setUsuario] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verificarLogin = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          window.location.href = '/auth/login';
          return;
        }

        setUsuario(user);

        // Buscar motoristas
        const response = await fetchAutenticado('/api/motoristas');
        const json = await response.json();

        if (json.sucesso) {
          setMotoristas(json.dados);
        } else {
          setError(json.erro || 'Erro ao buscar motoristas');
        }
      } catch (erro) {
        setError('Erro ao carregar dashboard');
        console.error(erro);
      } finally {
        setLoading(false);
      }
    };

    verificarLogin();
  }, []);

  if (loading) {
    return <div style={{ padding: '20px' }}>Carregando...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ marginBottom: '30px' }}>Condução Econômica</h1>
        
        {error && (
          <div style={{
            background: 'var(--freio-fx)',
            color: 'var(--freio)',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '20px',
          }}>
            {error}
          </div>
        )}

        {usuario && (
          <p style={{ marginBottom: '20px', color: 'var(--sub)' }}>
            Conectado como: <strong>{usuario.email}</strong>
          </p>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          {motoristas.map((motorista) => (
            <Link
              key={motorista.id}
              href={`/motorista/${motorista.id}`}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: '12px',
                padding: '16px',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--line)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'var(--brand)',
                  color: 'var(--brand-ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  fontWeight: '600',
                  flexShrink: 0,
                }}>
                  {motorista.nome.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '14px', marginBottom: '4px' }}>
                    {motorista.nome}
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--mute)', margin: 0 }}>
                    {motorista.matricula ? `Mat. ${motorista.matricula}` : 'Sem matrícula'}
                  </p>
                </div>
              </div>
              {!motorista.ativo && (
                <p style={{
                  fontSize: '11px',
                  color: 'var(--freio)',
                  background: 'var(--freio-fx)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  margin: 0,
                  display: 'inline-block',
                }}>
                  Inativo
                </p>
              )}
            </Link>
          ))}
        </div>

        {motoristas.length === 0 && !error && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--mute)',
          }}>
            <p>Nenhum motorista encontrado</p>
          </div>
        )}
      </div>
    </div>
  );
}
