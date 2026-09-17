'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { fetchAutenticado } from '@/lib/fetch-autenticado';
import Sidebar from '@/app/components/Sidebar';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';

interface Motorista {
  id: string;
  nome: string;
  matricula: string | null;
  cpf: string | null;
  ativo: boolean;
  placa: string | null;
  km_rodado: number | null;
  nota_geral: number | null;
  nota_geral_faixa: string | null;
}

function formatarKm(km: number | null): string {
  if (km === null || km === undefined) return '—';
  return `${km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

export default function Dashboard() {
  const router = useRouter();
  const { collapsed, toggle } = useSidebarCollapsed();
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [usuario, setUsuario] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    const verificarLogin = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          router.push('/auth/login');
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

  const filtrados = motoristas.filter((m) =>
    m.nome.toLowerCase().includes(busca.toLowerCase()) ||
    (m.placa || '').toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      <main>
        <div className="topbar">
          <span className="trilha"><b>Painel geral</b> &nbsp;›&nbsp; Motoristas</span>
          <span className="spacer"></span>
          <span className="chip">🏢 Transabril</span>
          {usuario && <span className="chip">👤 {usuario.email}</span>}
        </div>

        <div className="wrap">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22 }}>Motoristas</h1>
              <p className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
                {motoristas.length} motorista(s) cadastrado(s) · condução econômica
              </p>
            </div>
            <input
              placeholder="Buscar por nome ou placa…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ maxWidth: 260 }}
            />
          </div>

          {error && (
            <div style={{ background: 'var(--freio-fx)', color: 'var(--freio)', padding: '12px 16px', borderRadius: 8, marginBottom: 20 }}>
              {error}
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="tbox">
            <table>
              <thead>
                <tr>
                  <th style={{ padding: '12px 16px' }}>Motorista</th>
                  <th>Placa</th>
                  <th>Matrícula</th>
                  <th>KM Rodado</th>
                  <th>Nota Geral</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((motorista) => (
                  <tr
                    key={motorista.id}
                    onClick={() => router.push(`/motorista/${motorista.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', background: 'var(--brand)', color: 'var(--brand-ink)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0,
                        }}>
                          {motorista.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500 }}>{motorista.nome}</span>
                      </div>
                    </td>
                    <td className="n">{motorista.placa || '—'}</td>
                    <td className="n">{motorista.matricula || '—'}</td>
                    <td className="n">{formatarKm(motorista.km_rodado)}</td>
                    <td>
                      {motorista.nota_geral !== null ? (
                        <span className="pill" style={{ background: 'var(--pista-fx)', color: 'var(--pista)' }}>
                          {motorista.nota_geral.toFixed(0)} · {motorista.nota_geral_faixa || ''}
                        </span>
                      ) : (
                        <span className="pill" style={{ background: 'var(--line)', color: 'var(--mute)' }}>
                          Sem apuração
                        </span>
                      )}
                    </td>
                    <td>
                      {motorista.ativo ? (
                        <span className="pill" style={{ background: 'var(--pista-fx)', color: 'var(--pista)' }}>Ativo</span>
                      ) : (
                        <span className="pill" style={{ background: 'var(--freio-fx)', color: 'var(--freio)' }}>Inativo</span>
                      )}
                    </td>
                    <td className="num" style={{ color: 'var(--sinal)' }}>Ver detalhes →</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {filtrados.length === 0 && !error && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--mute)' }}>
              <p>Nenhum motorista encontrado</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
