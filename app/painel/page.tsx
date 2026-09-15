'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { fetchAutenticado } from '@/lib/fetch-autenticado';
import DateRangePicker from '@/app/components/DateRangePicker';

interface ResultadoPainel {
  motorista_id: string | null;
  veiculo_id: string | null;
  nome: string | null;
  matricula: string | null;
  placa: string | null;
  modelo_equipamento: string | null;
  qtd_leituras: number;
  nota_final: number | null;
  cobertura_pct: number;
  elegivel: boolean;
  motivo_inelegibilidade: string | null;
  faixa_rotulo: string | null;
}

function corFaixa(rotulo: string | null): string {
  switch (rotulo) {
    case 'Ouro': return '#d99a3f';
    case 'Prata': return '#8f9490';
    case 'Bronze': return '#c08457';
    default: return '#d1493c';
  }
}

export default function PainelVisaoGeral() {
  const router = useRouter();
  const [resultados, setResultados] = useState<ResultadoPainel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agrupar, setAgrupar] = useState<'motorista' | 'veiculo'>('motorista');
  const [busca, setBusca] = useState('');

  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [dataInicio, setDataInicio] = useState(trintaDiasAtras.toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(hoje.toISOString().slice(0, 10));

  useEffect(() => {
    const verificar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      carregar();
    };
    verificar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agrupar, dataInicio, dataFim]);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const inicioIso = new Date(dataInicio + 'T00:00:00').toISOString();
      const fimIso = new Date(dataFim + 'T23:59:59').toISOString();
      const response = await fetchAutenticado(
        `/api/painel/visao-geral?agrupar=${agrupar}&inicio=${encodeURIComponent(inicioIso)}&fim=${encodeURIComponent(fimIso)}`
      );
      const json = await response.json();
      if (json.sucesso) {
        setResultados(json.dados.resultados);
      } else {
        setError(json.erro || 'Erro ao carregar painel');
      }
    } catch (e) {
      setError('Erro ao carregar painel');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const filtrados = resultados.filter((r) =>
    (r.nome || r.placa || '').toLowerCase().includes(busca.toLowerCase())
  );

  const elegiveis = filtrados.filter((r) => r.elegivel);
  const contagemFaixas = { Ouro: 0, Prata: 0, Bronze: 0, 'Sem premiação': 0 } as Record<string, number>;
  elegiveis.forEach((r) => {
    if (r.nota_final == null) return;
    if (r.nota_final >= 90) contagemFaixas['Ouro']++;
    else if (r.nota_final >= 80) contagemFaixas['Prata']++;
    else if (r.nota_final >= 70) contagemFaixas['Bronze']++;
    else contagemFaixas['Sem premiação']++;
  });

  return (
    <div className="shell">
      <aside>
        <div className="brandmark">
          <svg width="30" height="30" viewBox="0 0 30 30"><path d="M4 22 L14 6 L18 6 L10 22 Z" fill="#d99a3f" /><path d="M15 22 L23 8 L27 8 L19 22 Z" fill="#f2ede4" /></svg>
          <div><div className="t">ViaHub</div><div className="s">TELEMETRIA &amp; PERFORMANCE</div></div>
        </div>
        <nav>
          <Link href="/painel" className="on">Painel geral</Link>
          <Link href="/">Motoristas</Link>
          <a href="#">Indicadores</a>
          <a href="#">Recálculo</a>
          <a href="#">Master Drive</a>
          <a href="#">Versões</a>
          <a href="#">Diagnóstico</a>
          <a href="#">Relatórios</a>
        </nav>
        <div className="side-foot">DADO CERTO, DECISÃO RÁPIDA</div>
      </aside>

      <main>
        <div className="topbar">
          <span className="trilha"><b>Painel geral</b> &nbsp;›&nbsp; Visão Geral</span>
          <span className="spacer"></span>
          <DateRangePicker
            inicio={new Date(dataInicio + 'T00:00:00')}
            fim={new Date(dataFim + 'T00:00:00')}
            onChange={(i, f) => {
              setDataInicio(i.toISOString().slice(0, 10));
              setDataFim(f.toISOString().slice(0, 10));
            }}
          />
          <div className="role" role="group" aria-label="Agrupar por">
            <button aria-pressed={agrupar === 'motorista'} onClick={() => setAgrupar('motorista')}>Por motorista</button>
            <button aria-pressed={agrupar === 'veiculo'} onClick={() => setAgrupar('veiculo')}>Por veículo</button>
          </div>
        </div>

        <div className="wrap">
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 22 }}>Visão Geral — Condução Econômica</h1>
            <p className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
              Cálculo acumulado de {new Date(dataInicio).toLocaleDateString('pt-BR')} a {new Date(dataFim).toLocaleDateString('pt-BR')} · {filtrados.length} {agrupar === 'motorista' ? 'motorista(s)' : 'veículo(s)'} com telemetria no período
            </p>
          </div>

          {error && (
            <div style={{ background: 'var(--freio-fx)', color: 'var(--freio)', padding: '12px 16px', borderRadius: 8, marginBottom: 20 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mute)' }}>Calculando notas do período…</div>
          ) : (
            <>
              {/* Cards de resumo */}
              <div className="g3" style={{ marginBottom: 20 }}>
                <div className="card">
                  <h3>ELEGÍVEIS NA APURAÇÃO</h3>
                  <div style={{ fontSize: 32, fontFamily: 'var(--serif)', fontWeight: 600 }}>{elegiveis.length}</div>
                  <p className="sub" style={{ fontSize: 12 }}>de {filtrados.length} com telemetria no período (cobertura mínima 70%)</p>
                </div>
                <div className="card">
                  <h3>MÉDIA GERAL</h3>
                  <div style={{ fontSize: 32, fontFamily: 'var(--serif)', fontWeight: 600 }}>
                    {elegiveis.length > 0
                      ? (elegiveis.reduce((s, r) => s + (r.nota_final || 0), 0) / elegiveis.length).toFixed(1)
                      : '—'}
                  </div>
                  <p className="sub" style={{ fontSize: 12 }}>pontos, entre os elegíveis</p>
                </div>
                <div className="card">
                  <h3>DISTRIBUIÇÃO POR FAIXA</h3>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                    {Object.entries(contagemFaixas).map(([k, v]) => (
                      <span key={k} className="pill" style={{ background: `${corFaixa(k)}22`, color: corFaixa(k) }}>
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <input
                  placeholder={agrupar === 'motorista' ? 'Buscar por motorista…' : 'Buscar por placa…'}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  style={{ maxWidth: 280 }}
                />
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="tbox">
                <table>
                  <thead>
                    <tr>
                      <th style={{ padding: '12px 16px' }}>Pos.</th>
                      <th>{agrupar === 'motorista' ? 'Motorista' : 'Veículo'}</th>
                      <th>Placa</th>
                      <th className="num">Leituras</th>
                      <th className="num">Cobertura</th>
                      <th className="num">Nota</th>
                      <th>Faixa</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((r, idx) => (
                      <tr
                        key={r.motorista_id || r.veiculo_id || idx}
                        style={{ cursor: r.motorista_id ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (r.motorista_id) {
                            router.push(`/motorista/${r.motorista_id}?inicio=${dataInicio}&fim=${dataFim}`);
                          }
                        }}
                      >
                        <td className="n mute" style={{ padding: '10px 16px' }}>{r.elegivel ? idx + 1 : '—'}</td>
                        <td style={{ fontWeight: 500 }}>{r.nome || <span className="mute">sem motorista alocado</span>}</td>
                        <td className="n">{r.placa || '—'}</td>
                        <td className="num n">{r.qtd_leituras}</td>
                        <td className="num n">{r.cobertura_pct?.toFixed(0)}%</td>
                        <td className="num n" style={{ fontWeight: 500 }}>
                          {r.nota_final != null ? r.nota_final.toFixed(1) : '—'}
                        </td>
                        <td>
                          {r.elegivel ? (
                            <span className="pill" style={{ background: `${corFaixa(r.faixa_rotulo)}22`, color: corFaixa(r.faixa_rotulo) }}>
                              {r.faixa_rotulo}
                            </span>
                          ) : (
                            <span className="tag" title={r.motivo_inelegibilidade || ''}>inelegível</span>
                          )}
                        </td>
                        <td className="num" style={{ color: 'var(--sinal)' }}>{r.motorista_id ? 'Ver →' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {filtrados.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--mute)' }}>
                  <p>Nenhum resultado no período selecionado.</p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
