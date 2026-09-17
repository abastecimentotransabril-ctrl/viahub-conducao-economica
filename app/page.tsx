'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { fetchAutenticado } from '@/lib/fetch-autenticado';
import Sidebar from '@/app/components/Sidebar';
import DateRangePicker from '@/app/components/DateRangePicker';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import { corParaFaixa } from '@/lib/motor-apuracao';

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
  nota_geral_cobertura_pct: number | null;
}

function formatarKm(km: number | null): string {
  if (km === null || km === undefined) return '—';
  return `${km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function hojeSemHora(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Dashboard() {
  const router = useRouter();
  const { collapsed, toggle } = useSidebarCollapsed();
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [usuario, setUsuario] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [exportando, setExportando] = useState(false);

  const hoje = hojeSemHora();
  const trintaDiasAtras = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [periodoInicio, setPeriodoInicio] = useState<Date>(trintaDiasAtras);
  const [periodoFim, setPeriodoFim] = useState<Date>(hoje);

  useEffect(() => {
    const verificarLogin = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          router.push('/auth/login');
          return;
        }

        setUsuario(user);
        await carregarMotoristas();
      } catch (erro) {
        setError('Erro ao carregar dashboard');
        console.error(erro);
      } finally {
        setLoading(false);
      }
    };

    verificarLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) carregarMotoristas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoInicio, periodoFim]);

  async function carregarMotoristas() {
    try {
      const inicioIso = new Date(periodoInicio).toISOString();
      const fimIso = new Date(new Date(periodoFim).setHours(23, 59, 59, 999)).toISOString();
      const response = await fetchAutenticado(
        `/api/motoristas?inicio=${encodeURIComponent(inicioIso)}&fim=${encodeURIComponent(fimIso)}`
      );
      const json = await response.json();

      if (json.sucesso) {
        setMotoristas(json.dados);
        setError(null);
      } else {
        setError(json.erro || 'Erro ao buscar motoristas');
      }
    } catch (erro) {
      setError('Erro ao carregar dashboard');
      console.error(erro);
    }
  }

  async function exportarExcel() {
    setExportando(true);
    try {
      const inicioIso = new Date(periodoInicio).toISOString();
      const fimIso = new Date(new Date(periodoFim).setHours(23, 59, 59, 999)).toISOString();
      const params = new URLSearchParams({ inicio: inicioIso, fim: fimIso });
      if (busca.trim()) params.set('busca', busca.trim());
      const response = await fetchAutenticado(`/api/motoristas/exportar?${params.toString()}`);
      if (!response.ok) throw new Error('Falha ao gerar exportação');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `motoristas_conducao_economica_${periodoInicio.toISOString().slice(0, 10)}_a_${periodoFim.toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (erro) {
      console.error(erro);
      alert('Erro ao exportar. Tente novamente.');
    } finally {
      setExportando(false);
    }
  }

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22 }}>Motoristas</h1>
              <p className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
                {motoristas.length} motorista(s) cadastrado(s) · condução econômica · {filtrados.length} exibido(s) no período
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <DateRangePicker inicio={periodoInicio} fim={periodoFim} onChange={(i, f) => { setPeriodoInicio(i); setPeriodoFim(f); }} />
              <input
                placeholder="Buscar por nome ou placa…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ maxWidth: 240 }}
              />
              <button className="btn sm" onClick={exportarExcel} disabled={exportando}>
                {exportando ? 'Exportando…' : '📊 Exportar Excel'}
              </button>
            </div>
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
                {filtrados.map((motorista) => {
                  const corFaixa = corParaFaixa(motorista.nota_geral_faixa);
                  return (
                  <tr
                    key={motorista.id}
                    onClick={() => router.push(`/motorista/${motorista.id}?inicio=${periodoInicio.toISOString().slice(0, 10)}&fim=${periodoFim.toISOString().slice(0, 10)}`)}
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
                        <span className="pill" style={{ background: `${corFaixa}22`, color: corFaixa }} title={motorista.nota_geral_cobertura_pct != null ? `Cobertura: ${motorista.nota_geral_cobertura_pct.toFixed(1)}%` : undefined}>
                          {motorista.nota_geral.toFixed(0)} · {motorista.nota_geral_faixa || '—'}
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
                  );
                })}
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
