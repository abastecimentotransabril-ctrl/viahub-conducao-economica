'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { fetchAutenticado } from '@/lib/fetch-autenticado';
import { classificarPressao } from '@/lib/motor-apuracao';
import DateRangePicker from '@/app/components/DateRangePicker';
import MotoristaSelector from '@/app/components/MotoristaSelector';
import Sidebar from '@/app/components/Sidebar';
import { useSidebarCollapsed } from '@/lib/use-sidebar-collapsed';
import { nf, sinal, iniciais, corBanda, RingSvg, SparkMini, SparkGrande, DonutFrota } from './render-helpers';
import type { PontoTrajeto } from '@/app/components/MapaTrajeto';

const MapaTrajeto = dynamic(() => import('@/app/components/MapaTrajeto'), {
  ssr: false,
  loading: () => <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute)', fontSize: 12.5 }}>Carregando mapa…</div>,
});

type Role = 'gestor' | 'master';

interface LeituraApi {
  id: string; timestampUnix: number; dataHoraISO: string; velocidadeKmh: number | null;
  rpm: number | null; odometroKm: number | null; consumoBruto: number | null;
  posicao: { county?: string; rua?: string; uf?: string } | null;
  referenciaMaisProxima: { nome: string; grupo: string; distanciaKm: number } | null;
  eventoBruto: string | null; operationalLabel: string | null;
  indicadoresBrutos: Record<string, number | null> | null;
}

interface ResultadoApi {
  nota_final: number | null; cobertura_pct: number; elegivel: boolean;
  motivo_inelegibilidade: string | null; faixa_rotulo: string | null;
  detalhe: Array<{ indicador: string; valor: number | null; nota: number | null; peso: number; pontos: number | null; entrou: boolean }>;
}

interface LeituraComNota { leitura: LeituraApi; resultado: ResultadoApi | null }

interface ResultadoPeriodo extends ResultadoApi {
  qtdLeituras: number;
  primeiraLeitura: string | null;
  ultimaLeituraPeriodo: string | null;
}

interface DetalheHora {
  horaInicio: string;
  qtdLeituras: number;
  notaMedia: number | null;
  velocidadeMedia: number | null;
}

interface DetalheData {
  motorista: { id: string; nome: string; cpf: string | null; matricula: string | null; ativo: boolean };
  veiculo: { placa: string; modelo_equipamento: string; capacidade: string } | null;
  configVigente: { id: string; nome: string } | null;
  indicadores: Array<{
    id: string; mnemonico: string; nome: string; peso: number; tipo: string;
    campo_fonte: string | null; fonte_nota: string | null; nota0: number | null; nota100: number | null;
  }>;
  faixasNota: Array<{ nota_minima: number; rotulo: string; cor: string | null }>;
  faixasClassificacao: Array<{ ate: number; rotulo: string; cor: string | null }>;
  leiturasComNota: LeituraComNota[];
  ultimaLeitura: LeituraComNota | null;
  penultimaLeitura: LeituraComNota | null;
  periodo: { inicio: string; fim: string };
  resultadoPeriodo: ResultadoPeriodo | null;
  pontosTrajeto: PontoTrajeto[];
  detalhamentoPorHora: DetalheHora[];
  ranking: Array<{ placa: string; nome: string | null; nota: number | null; faixa: string | null }>;
  atendimentos: Array<{ id: string; resumo: string; resultado: string; indicador_mnemonico: string | null; criado_em: string }>;
  papelUsuario: string;
}

export default function MotoristaDetalhe() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const motoristaId = params.id as string;
  const { collapsed, toggle } = useSidebarCollapsed();

  const [dados, setDados] = useState<DetalheData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('gestor');
  const [leituraSelecionada, setLeituraSelecionada] = useState<string | null>(null);
  const [mostrarComposicao, setMostrarComposicao] = useState(false);
  const [mdFormAberto, setMdFormAberto] = useState(false);
  const [exportarAberto, setExportarAberto] = useState(false);
  const [exportando, setExportando] = useState(false);

  const [mdIndicador, setMdIndicador] = useState('');
  const [mdResultado, setMdResultado] = useState<'sem_acao' | 'orientacao_registrada' | 'correcao_de_dado'>('sem_acao');
  const [mdResumo, setMdResumo] = useState('');
  const [mdEnviando, setMdEnviando] = useState(false);
  const [mdErro, setMdErro] = useState<string | null>(null);

  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [dataInicio, setDataInicio] = useState(searchParams.get('inicio') || trintaDiasAtras.toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(searchParams.get('fim') || hoje.toISOString().slice(0, 10));

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motoristaId, dataInicio, dataFim]);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const inicioIso = new Date(dataInicio + 'T00:00:00').toISOString();
      const fimIso = new Date(dataFim + 'T23:59:59').toISOString();
      const response = await fetchAutenticado(
        `/api/motoristas/${motoristaId}/detalhe-completo?inicio=${encodeURIComponent(inicioIso)}&fim=${encodeURIComponent(fimIso)}`
      );
      const json = await response.json();
      if (json.sucesso) {
        setDados(json.dados);
        const ultima = json.dados.leiturasComNota[json.dados.leiturasComNota.length - 1];
        if (ultima) setLeituraSelecionada(ultima.leitura.id);
      } else {
        setError(json.erro || 'Erro ao carregar dados');
      }
    } catch (e) {
      setError('Erro ao carregar motorista');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function exportarCsv() {
    setExportando(true);
    setExportarAberto(false);
    try {
      const inicioIso = new Date(dataInicio + 'T00:00:00').toISOString();
      const fimIso = new Date(dataFim + 'T23:59:59').toISOString();
      const response = await fetchAutenticado(
        `/api/motoristas/${motoristaId}/exportar?inicio=${encodeURIComponent(inicioIso)}&fim=${encodeURIComponent(fimIso)}`
      );
      if (!response.ok) throw new Error('Falha ao gerar exportação');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conducao-economica-${motoristaId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Erro ao exportar. Tente novamente.');
    } finally {
      setExportando(false);
    }
  }

  async function salvarAtendimento() {
    if (!mdResumo.trim()) {
      setMdErro('Descreva, em uma frase, o que foi conversado.');
      return;
    }
    setMdEnviando(true);
    setMdErro(null);
    try {
      const response = await fetchAutenticado('/api/atendimentos', {
        method: 'POST',
        body: JSON.stringify({
          motorista_id: motoristaId,
          indicador_mnemonico: mdIndicador || null,
          resumo: mdResumo.trim(),
          resultado: mdResultado,
        }),
      });
      const json = await response.json();
      if (json.sucesso) {
        setMdResumo('');
        setMdIndicador('');
        setMdResultado('sem_acao');
        setMdFormAberto(false);
        carregar();
      } else {
        setMdErro(json.erro || 'Erro ao salvar atendimento');
      }
    } catch {
      setMdErro('Erro ao salvar atendimento');
    } finally {
      setMdEnviando(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, fontFamily: 'var(--sans)' }}>Carregando…</div>;
  }

  if (error || !dados) {
    return (
      <div style={{ padding: 40, fontFamily: 'var(--sans)' }}>
        <button className="btn" onClick={() => router.back()} style={{ marginBottom: 16 }}>← Voltar</button>
        <p style={{ color: 'var(--freio)' }}>{error}</p>
      </div>
    );
  }

  const { motorista, veiculo, indicadores, faixasNota, faixasClassificacao, leiturasComNota, ultimaLeitura, penultimaLeitura, resultadoPeriodo, ranking, atendimentos } = dados;

  // Nota principal = cálculo acumulado do período selecionado (não mais só a última leitura)
  const atual = resultadoPeriodo;
  // Tendência recente = comparação das duas últimas leituras individuais (visão em tempo real, complementar)
  const tendenciaAtual = ultimaLeitura?.resultado || null;
  const tendenciaAnterior = penultimaLeitura?.resultado || null;
  const deltaTendencia = tendenciaAtual?.nota_final != null && tendenciaAnterior?.nota_final != null
    ? tendenciaAtual.nota_final - tendenciaAnterior.nota_final
    : null;

  const pontuaIndicadores = indicadores.filter((i) => i.tipo === 'pontua').sort((a, b) => b.peso - a.peso);
  const classificaIndicador = indicadores.find((i) => i.tipo === 'classifica');

  const leituraDetalheAtual = leituraSelecionada
    ? leiturasComNota.find((l) => l.leitura.id === leituraSelecionada) || ultimaLeitura
    : ultimaLeitura;

  const rankOrdenado = [...ranking].sort((a, b) => (b.nota || 0) - (a.nota || 0));
  const meuIndex = veiculo ? rankOrdenado.findIndex((r) => r.placa === veiculo.placa) : -1;

  const pressaoValor = ultimaLeitura?.leitura.indicadoresBrutos?.throttleAgregation ?? null;
  const pressaoFaixa = pressaoValor !== null ? classificarPressao(pressaoValor) : null;
  const corFaixaPressao = faixasClassificacao.find((f) => f.rotulo === pressaoFaixa)?.cor || '#a39d8c';

  // Desempenho no período (dados reais, agregados de todas as leituras do período)
  let distanciaPercorridaPeriodo: number | null = null;
  const odometros = leiturasComNota.map((l) => l.leitura.odometroKm).filter((v): v is number => v != null);
  if (odometros.length >= 2) {
    distanciaPercorridaPeriodo = Math.max(...odometros) - Math.min(...odometros);
  }
  const velocidades = leiturasComNota.map((l) => l.leitura.velocidadeKmh).filter((v): v is number => v != null);
  const velocidadeMediaPeriodo = velocidades.length > 0 ? velocidades.reduce((a, b) => a + b, 0) / velocidades.length : null;

  // Distribuição das notas — das leituras individuais deste motorista no período (não da frota)
  const bandasProprias = { Verde: 0, Amarelo: 0, Laranja: 0, Vermelho: 0 } as Record<string, number>;
  leiturasComNota.forEach((l) => {
    const n = l.resultado?.nota_final;
    if (n == null) return;
    if (n >= 85) bandasProprias['Verde']++;
    else if (n >= 70) bandasProprias['Amarelo']++;
    else if (n >= 60) bandasProprias['Laranja']++;
    else bandasProprias['Vermelho']++;
  });
  const totalBandasProprias = Object.values(bandasProprias).reduce((a, b) => a + b, 0);
  const corBandaLegenda: Record<string, string> = { Verde: '#3f9d5d', Amarelo: '#d9932f', Laranja: '#e0793f', Vermelho: '#d1493c' };

  let diagPior: { nome: string; contrib: number } | null = null;
  let diagMaior: { nome: string; gap: number } | null = null;
  if (tendenciaAtual && tendenciaAnterior) {
    const somaPeso = tendenciaAtual.detalhe.filter((x) => x.entrou).reduce((s, x) => s + x.peso, 0);
    const comp = tendenciaAtual.detalhe
      .filter((d) => d.entrou)
      .map((d) => {
        const dp = tendenciaAnterior.detalhe.find((x) => x.indicador === d.indicador);
        const dv = d.valor != null && dp?.valor != null ? d.valor - dp.valor : null;
        const contrib = dv == null || somaPeso === 0 ? null : (d.peso * dv) / somaPeso;
        const gap = d.nota != null ? ((100 - d.nota) * d.peso) / 100 : 0;
        const indDef = indicadores.find((i) => i.mnemonico === d.indicador);
        return { nome: indDef?.nome || d.indicador, contrib, gap };
      });
    const piorCandidato = comp.filter((c) => c.contrib != null && c.contrib < -0.05).sort((a, b) => (a.contrib || 0) - (b.contrib || 0))[0];
    if (piorCandidato) diagPior = { nome: piorCandidato.nome, contrib: piorCandidato.contrib! };
    const maiorCandidato = [...comp].sort((a, b) => b.gap - a.gap)[0];
    if (maiorCandidato && maiorCandidato.gap > 0.5) diagMaior = { nome: maiorCandidato.nome, gap: maiorCandidato.gap };
  }

  const dataUltimaLeitura = ultimaLeitura ? new Date(ultimaLeitura.leitura.dataHoraISO) : null;
  const horaUltima = dataUltimaLeitura?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) || '—';
  const horaPenultima = penultimaLeitura ? new Date(penultimaLeitura.leitura.dataHoraISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

  const circ = 2 * Math.PI * 80;
  const fracGauge = (atual?.nota_final || 0) / 100;
  const corGauge = corBanda(atual?.nota_final ?? null);
  const faixaAtualObj = faixasNota.find((f) => f.rotulo === atual?.faixa_rotulo);

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      <main>
        <div className="topbar">
          <span className="trilha">
            <Link href="/" style={{ color: 'var(--sub)', textDecoration: 'none' }}>‹ Motoristas</Link>
            &nbsp;›&nbsp; <b>{motorista.nome}</b>
          </span>
          <span className="spacer"></span>
          <MotoristaSelector
            motoristaAtualId={motorista.id}
            nome={motorista.nome}
            placa={veiculo?.placa || null}
            cpf={motorista.cpf}
            dataInicio={dataInicio}
            dataFim={dataFim}
          />
          <DateRangePicker
            inicio={new Date(dataInicio + 'T00:00:00')}
            fim={new Date(dataFim + 'T00:00:00')}
            onChange={(i, f) => {
              setDataInicio(i.toISOString().slice(0, 10));
              setDataFim(f.toISOString().slice(0, 10));
            }}
          />
          <span className="chip">🏢 Transabril</span>
          <div className="role" role="group" aria-label="Visualizar como">
            <button aria-pressed={role === 'gestor'} onClick={() => setRole('gestor')}>Gestor</button>
            <button aria-pressed={role === 'master'} onClick={() => setRole('master')}>Master Drive</button>
          </div>
          <div className="drp-wrap">
            <button className="btn sm" onClick={() => setExportarAberto(!exportarAberto)} disabled={exportando}>
              {exportando ? 'Exportando…' : 'Exportar'} ▾
            </button>
            {exportarAberto && (
              <div className="export-menu">
                <button onClick={exportarCsv}>📊 Exportar Excel (.csv)</button>
                <button onClick={() => { setExportarAberto(false); window.print(); }}>🖨️ Imprimir / PDF</button>
              </div>
            )}
          </div>
        </div>

        <div className="wrap">
          <div className="hdr">
            <div className="hdr-card">
              <div className="hdr-top">
                <div className="mh-avatar">{iniciais(motorista.nome)}</div>
                <div className="hdr-name">
                  <span className="mh-status-pill"><i></i>{ultimaLeitura?.leitura.operationalLabel || 'Status desconhecido'}</span>
                  <h1>{motorista.nome}</h1>
                  <div className="role-txt">Motorista {motorista.matricula ? <>· matrícula <span className="n">{motorista.matricula}</span></> : ''}</div>
                </div>
              </div>
              <div className="mh-meta-row">
                <span>🚛 <b>{veiculo?.modelo_equipamento || '—'}</b></span>
                <span>Placa <b>{veiculo?.placa || '—'}</b></span>
                <span>CPF <b>{motorista.cpf || '—'}</b></span>
                <span>🏢 <b>Transabril</b> <span className="tag">unidade a nomear no cadastro</span></span>
                {ultimaLeitura?.leitura.posicao ? (
                  <span>📍 último ponto: <b>{new Date(ultimaLeitura.leitura.dataHoraISO).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b></span>
                ) : null}
              </div>
              <p className="hdr-note">
                Configuração vigente: <b style={{ color: 'var(--ink)' }}>{dados.configVigente?.nome || 'nenhuma configuração ativa'}</b> · Cálculo acumulado de {new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} a {new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}, com {atual?.qtdLeituras ?? 0} leitura(s) real(is) de telemetria.
              </p>
            </div>
            <div className="hero-panel">
              <svg viewBox="0 0 300 220" preserveAspectRatio="xMidYMax slice">
                <defs><radialGradient id="sun" cx="70%" cy="30%" r="45%"><stop offset="0%" stopColor="#d99a3f" /><stop offset="100%" stopColor="#d99a3f" stopOpacity="0" /></radialGradient></defs>
                <rect width="300" height="220" fill="#141a20" />
                <circle cx="210" cy="70" r="90" fill="url(#sun)" />
                <path d="M0 150 L60 90 L100 130 L150 60 L200 120 L240 80 L300 150 L300 220 L0 220 Z" fill="#1b232c" />
                <path d="M0 190 L80 150 L140 175 L190 145 L260 178 L300 160 L300 220 L0 220 Z" fill="#11161b" />
                <path d="M-20 220 L120 150 L300 220" stroke="#d99a3f" strokeWidth="2" fill="none" opacity=".5" />
              </svg>
              <div className="hero-line">Cada leitura conta.</div>
            </div>
          </div>

          <div className="secoes-nav">
            <a href="#secao-resumo">Resumo</a>
            <a href="#secao-indicadores">Indicadores</a>
            <a href="#secao-evolucao">Evolução</a>
            <a href="#secao-mapa">Mapa</a>
            <a href="#secao-masterdrive">Master Drive</a>
          </div>

          <div className="painel show" id="secao-resumo">
            <h2 className="secao-titulo">Resumo</h2>
            <div className="g2" style={{ marginBottom: 16 }}>
                <div className="gauge-card">
                  <h3>NOTA DE CONDUÇÃO</h3>
                  <div className="gauge-delta">
                    {atual && atual.qtdLeituras > 0 ? (
                      <span style={{ color: '#8b9490' }}>{atual.qtdLeituras} leitura(s) no período</span>
                    ) : deltaTendencia !== null ? (
                      <>
                        <span style={{ color: deltaTendencia < 0 ? '#e08a7d' : '#7cc79a' }}>
                          {deltaTendencia < 0 ? '↓' : '↑'} {sinal(deltaTendencia)}{nf(deltaTendencia, 1)}
                        </span>
                        &nbsp;<span style={{ color: '#6b716e' }}>vs. leitura de {horaPenultima}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="ring-wrap">
                    <svg viewBox="0 0 186 186">
                      <circle cx="93" cy="93" r="80" fill="none" stroke="#262b2c" strokeWidth="8" />
                      <circle cx="93" cy="93" r="80" fill="none" stroke={corGauge} strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={`${circ * fracGauge} ${circ}`} transform="rotate(-90 93 93)" />
                    </svg>
                    <div className="ring-num">
                      <span className="v">{nf(atual?.nota_final ?? null, 1)}</span>
                      <span className="f">{atual?.faixa_rotulo?.toUpperCase() || (atual?.motivo_inelegibilidade ? 'INELEGÍVEL' : '—')}</span>
                    </div>
                  </div>
                  <div className="gauge-msg">
                    {atual?.motivo_inelegibilidade || (faixaAtualObj ? `Faixa: ${faixaAtualObj.rotulo}` : '')}
                  </div>
                  {(!atual || atual.qtdLeituras === 0) && ultimaLeitura && (
                    <div style={{ fontSize: 11.5, color: '#8b9490', marginTop: 4, lineHeight: 1.5 }}>
                      Sem leituras entre {new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} e {new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')} para este veículo.
                      <br />Última leitura registrada: <b style={{ color: '#f2ede4' }}>{new Date(ultimaLeitura.leitura.dataHoraISO).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b>
                      <br />
                      <button
                        className="gauge-link"
                        style={{ marginTop: 4 }}
                        onClick={() => {
                          const dataUltima = new Date(ultimaLeitura.leitura.dataHoraISO);
                          const trintaAntes = new Date(dataUltima.getTime() - 30 * 24 * 60 * 60 * 1000);
                          setDataInicio(trintaAntes.toISOString().slice(0, 10));
                          setDataFim(dataUltima.toISOString().slice(0, 10));
                        }}
                      >
                        Ver últimos 30 dias até a última leitura →
                      </button>
                    </div>
                  )}
                  {(!atual || atual.qtdLeituras === 0) && !ultimaLeitura && (
                    <div style={{ fontSize: 11.5, color: '#8b9490', marginTop: 4 }}>
                      Nenhuma leitura de telemetria encontrada para este motorista, em nenhum período.
                    </div>
                  )}
                  <button className="gauge-link" onClick={() => setMostrarComposicao(!mostrarComposicao)}>
                    {mostrarComposicao ? 'Ocultar composição' : 'Ver como esta nota foi calculada'}
                  </button>
                  {mostrarComposicao && atual && (
                    <div className="composicao show" style={{ width: '100%', textAlign: 'left' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: '#8b9490' }}>
                            <th style={{ color: '#8b9490', borderColor: '#262b2c' }}>Indicador</th>
                            <th className="num" style={{ color: '#8b9490', borderColor: '#262b2c' }}>Valor</th>
                            <th className="num" style={{ color: '#8b9490', borderColor: '#262b2c' }}>Nota</th>
                            <th className="num" style={{ color: '#8b9490', borderColor: '#262b2c' }}>Peso</th>
                            <th className="num" style={{ color: '#8b9490', borderColor: '#262b2c' }}>Pontos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {atual.detalhe.map((d, idx) => {
                            const indDef = indicadores.find((i) => i.mnemonico === d.indicador);
                            return (
                              <tr key={idx}>
                                <td style={{ color: '#f2ede4', borderColor: '#262b2c' }}>{indDef?.nome || d.indicador}</td>
                                <td className="num" style={{ color: '#f2ede4', borderColor: '#262b2c' }}>{d.valor == null ? '—' : nf(d.valor, 1)}</td>
                                <td className="num" style={{ color: '#f2ede4', borderColor: '#262b2c' }}>{d.nota == null ? '—' : nf(d.nota, 1)}</td>
                                <td className="num" style={{ color: '#f2ede4', borderColor: '#262b2c' }}>{d.peso}</td>
                                <td className="num" style={{ color: '#f2ede4', borderColor: '#262b2c' }}>{d.pontos == null ? 'sem dado' : nf(d.pontos, 1)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3>🌱 INDICADORES DE BOA CONDUÇÃO <a href="#secao-indicadores" className="link-mais">Ver detalhes →</a></h3>
                  <div className="rings-v2">
                    {pontuaIndicadores.map((ind) => {
                      const da = atual?.detalhe.find((d) => d.indicador === ind.mnemonico);
                      const dp = tendenciaAnterior?.detalhe.find((d) => d.indicador === ind.mnemonico);
                      if (!ind.campo_fonte) {
                        return (
                          <div className="ring-card pend" key={ind.id}>
                            <div className="rc-svg">
                              <RingSvg valor={0} cor="#d7d2c4" />
                              <span className="rc-val mute">—</span>
                            </div>
                            <div className="rc-label">{ind.nome}</div>
                            <div className="rc-meta">peso {ind.peso}% · pendente</div>
                          </div>
                        );
                      }
                      return (
                        <div className="ring-card" key={ind.id}>
                          <div className="rc-svg">
                            <RingSvg valor={da?.nota ?? null} />
                            <span className="rc-val" style={{ color: corBanda(da?.nota ?? null) }}>
                              {nf(da?.nota ?? null, 0)}%
                            </span>
                          </div>
                          <div className="rc-label">{ind.nome}</div>
                          <div className="rc-meta">Meta ≥ {ind.nota100}%</div>
                          <div className="rc-spark"><SparkMini v1={dp?.nota ?? null} v2={da?.nota ?? null} /></div>
                        </div>
                      );
                    })}
                    {classificaIndicador && (
                      <div className="ring-card" key={classificaIndicador.id}>
                        <div className="rc-svg">
                          <RingSvg valor={pressaoValor !== null ? 100 - pressaoValor : null} cor={corFaixaPressao} />
                          <span className="rc-val" style={{ color: corFaixaPressao }}>
                            {nf(pressaoValor, 0)}%
                          </span>
                        </div>
                        <div className="rc-label">{classificaIndicador.nome}</div>
                        <div className="rc-meta">Meta ≤ 60%</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="g3" style={{ marginBottom: 16 }}>
                <div className="card">
                  <h3>🏆 MASTER DRIVE <span className="tag">ranking do período</span></h3>
                  {rankOrdenado.length === 0 ? (
                    <p className="sub" style={{ fontSize: 12.5 }}>Sem ranking disponível ainda no período selecionado.</p>
                  ) : (
                    <>
                      <p className="sub" style={{ fontSize: 12.5, marginBottom: 10 }}>
                        {meuIndex >= 0 ? <>Você está em <b style={{ color: 'var(--ink)' }}>{meuIndex + 1}º</b> de {rankOrdenado.length} motoristas</> : `${rankOrdenado.length} motoristas elegíveis no período`}
                      </p>
                      <div className="podio-wrap">
                        {[1, 0, 2].map((idx) => {
                          const r = rankOrdenado[idx];
                          if (!r) return <div key={idx} style={{ flex: 1 }} />;
                          const posicao = idx + 1;
                          const souEu = veiculo && r.placa === veiculo.placa;
                          return (
                            <div className={`podio-item pos${posicao}${souEu ? ' me' : ''}`} key={r.placa}>
                              <div className="podio-av">{iniciais(r.nome || r.placa)}</div>
                              <div className="podio-nm">{r.nome || r.placa}</div>
                              <div className="podio-bar">{nf(r.nota, 1)}</div>
                              <div className="podio-pos">{posicao}º</div>
                            </div>
                          );
                        })}
                      </div>
                      {meuIndex >= 3 && (
                        <div className="rank-row me" style={{ marginTop: 8 }}>
                          <span className="pos">{meuIndex + 1}º</span>
                          <span className="av">{iniciais(motorista.nome)}</span>
                          <span className="nm">{motorista.nome} (você)</span>
                          <span className="val">{nf(rankOrdenado[meuIndex]?.nota ?? null, 1)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="card">
                  <h3>EVOLUÇÃO DA NOTA <a href="#secao-evolucao" className="link-mais">ver seção →</a></h3>
                  <div style={{ height: 90 }}>
                    <SparkGrande
                      valores={leiturasComNota.slice(-8).map((l) => l.resultado?.nota_final ?? null)}
                      labels={leiturasComNota.slice(-8).map((l) => new Date(l.leitura.dataHoraISO).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))}
                      w={260} h={90}
                    />
                  </div>
                  <div className="evo-note">{leiturasComNota.length} leitura(s) disponível(is) neste motorista no período.</div>
                </div>
                <div className="card">
                  <h3>DISTRIBUIÇÃO DAS NOTAS <span className="tag">leituras deste motorista no período</span></h3>
                  {totalBandasProprias === 0 ? (
                    <p className="sub" style={{ fontSize: 12.5 }}>Sem leituras suficientes no período para distribuir.</p>
                  ) : (
                    <div className="dist-wrap">
                      <div><DonutFrota contagem={bandasProprias} total={totalBandasProprias} /></div>
                      <div className="donut-legend">
                        {Object.entries(bandasProprias).map(([k, v]) => (
                          <div className="row" key={k}>
                            <span className="dot" style={{ background: corBandaLegenda[k] }}></span>
                            <span className="lbl">{k} {k === 'Verde' ? '(≥85)' : k === 'Amarelo' ? '(70–84)' : k === 'Laranja' ? '(60–69)' : '(<60)'}</span>
                            <span className="pct n">{totalBandasProprias > 0 ? Math.round((v / totalBandasProprias) * 100) : 0}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="g3">
                <div className="card">
                  <h3>🚚 DESEMPENHO NO PERÍODO</h3>
                  <div className="desemp-grid">
                    <div className="desemp-item">
                      <div className="ic">📏</div>
                      <div className="val">{distanciaPercorridaPeriodo != null ? nf(distanciaPercorridaPeriodo, 0) : '—'}</div>
                      <div className="lbl">km percorridos</div>
                    </div>
                    <div className="desemp-item">
                      <div className="ic">⚡</div>
                      <div className="val">{velocidadeMediaPeriodo != null ? nf(velocidadeMediaPeriodo, 0) : '—'}</div>
                      <div className="lbl">km/h média</div>
                    </div>
                    <div className="desemp-item">
                      <div className="ic">⛽</div>
                      <div className="val pend">pendente</div>
                      <div className="lbl">consumo total<br /><small style={{ fontSize: 9.5 }}>unidade não confirmada</small></div>
                    </div>
                    <div className="desemp-item">
                      <div className="ic">🌱</div>
                      <div className="val pend">pendente</div>
                      <div className="lbl">km/L média<br /><small style={{ fontSize: 9.5 }}>depende do consumo</small></div>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <h3>📍 LEITURA MAIS RECENTE <span className="tag">sem tripID no pacote</span></h3>
                  {ultimaLeitura ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span className="n" style={{ fontSize: 13 }}>{horaUltima} · {ultimaLeitura.leitura.posicao?.rua || '—'}</span>
                        <span className="pill" style={{ background: 'var(--ambar-fx)', color: 'var(--ambar)' }}>Nota {nf(atual?.nota_final ?? null, 1)}</span>
                      </div>
                      <p className="sub" style={{ fontSize: 12.5 }}>
                        {ultimaLeitura.leitura.posicao?.county || '—'}/{ultimaLeitura.leitura.posicao?.uf || '—'}
                        {ultimaLeitura.leitura.referenciaMaisProxima ? <> · referência mais próxima: {ultimaLeitura.leitura.referenciaMaisProxima.nome} ({ultimaLeitura.leitura.referenciaMaisProxima.grupo}, a {nf(ultimaLeitura.leitura.referenciaMaisProxima.distanciaKm, 1)} km)</> : null}
                      </p>
                    </div>
                  ) : <p className="sub" style={{ fontSize: 12.5 }}>Sem leituras disponíveis.</p>}
                </div>
                <div className="card">
                  <h3>🔔 DIAGNÓSTICO</h3>
                  {diagPior || diagMaior ? (
                    <>
                      {diagPior && (
                        <div className="alert-row">
                          <span className="alert-ic" style={{ background: '#fbeae7', color: '#d1493c' }}>🔻</span>
                          <div><div className="t">Principal queda</div><div className="d">{diagPior.nome} respondeu pela maior parte da perda de pontos</div></div>
                          <span className="val" style={{ color: '#d1493c' }}>-{nf(Math.abs(diagPior.contrib), 1)} pts</span>
                        </div>
                      )}
                      {diagMaior && (
                        <div className="alert-row">
                          <span className="alert-ic" style={{ background: '#faf1e0', color: '#d9932f' }}>📈</span>
                          <div><div className="t">Maior potencial</div><div className="d">{diagMaior.nome} pode agregar até {nf(diagMaior.gap, 1)} pontos se chegar ao topo da curva</div></div>
                          <span className="val" style={{ color: '#d9932f' }}>+{nf(diagMaior.gap, 1)} pts</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="sub" style={{ fontSize: 12.5 }}>Dado insuficiente para gerar diagnóstico automático — são necessárias ao menos 2 leituras com indicadores completos.</p>
                  )}
                </div>
              </div>
            </div>

          <div className="painel show" id="secao-indicadores">
            <h2 className="secao-titulo">Indicadores</h2>
              <div className="card">
                <h3>COMPOSIÇÃO COMPLETA</h3>
                <div className="tbox">
                  <table>
                    <thead>
                      <tr>
                        <th>Indicador</th><th>Fonte</th><th className="num">Valor</th><th className="num">Nota</th><th className="num">Meta</th><th className="num">Peso</th><th className="num">Pontos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pontuaIndicadores.filter((i) => i.campo_fonte).map((ind) => {
                        const d = atual?.detalhe.find((x) => x.indicador === ind.mnemonico);
                        const pts = d?.entrou ? (d.nota! * ind.peso) / 100 : null;
                        return (
                          <tr key={ind.id}>
                            <td>{ind.nome}<div className="tag" style={{ marginTop: 3, display: 'inline-block' }}>{ind.fonte_nota}</div></td>
                            <td className="n mute">{ind.campo_fonte}</td>
                            <td className="num n">{nf(d?.valor ?? null, 1)}</td>
                            <td className="num n" style={{ color: corBanda(d?.nota ?? null) }}>{nf(d?.nota ?? null, 1)}</td>
                            <td className="num n">{ind.nota100}</td>
                            <td className="num n">{ind.peso}</td>
                            <td className="num n">{pts == null ? '—' : nf(pts, 1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {classificaIndicador && (
                  <div style={{ marginTop: 16 }}>
                    <div className="card" style={{ background: 'var(--bg)' }}>
                      <h3 style={{ marginBottom: 8 }}>{classificaIndicador.nome} <span className="tag">sem peso na nota</span></h3>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="n" style={{ fontSize: 20, color: corFaixaPressao }}>{nf(pressaoValor, 1)}%</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {faixasClassificacao.map((f) => (
                            <span key={f.rotulo} className="tag" style={{
                              color: pressaoFaixa === f.rotulo ? (f.cor || undefined) : 'var(--mute)',
                              borderColor: pressaoFaixa === f.rotulo ? (f.cor || undefined) : 'var(--line2)',
                            }}>
                              {f.rotulo} {f.ate === 60 ? '≤60%' : f.ate === 70 ? '61–70%' : '71–100%'}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="sub" style={{ fontSize: 11.5, marginTop: 8 }}>
                        Faixa atual: <b style={{ color: corFaixaPressao }}>{pressaoFaixa || '—'}</b> — rótulo corrigido em relação à referência original (61–70% é a faixa de Atenção, não a meta ideal).
                      </p>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  {pontuaIndicadores.filter((i) => !i.campo_fonte).map((ind) => (
                    <div key={ind.id} style={{ border: '1px dashed var(--line2)', borderRadius: 10, padding: '13px 16px', marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <b>{ind.nome}</b><span className="tag">peso {ind.peso} · aguardando integração</span>
                      </div>
                      <p className="sub" style={{ fontSize: 12, marginTop: 4 }}>{ind.fonte_nota}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          <div className="painel show" id="secao-evolucao">
            <h2 className="secao-titulo">Evolução</h2>
              <div className="g2">
                <div className="card">
                  <h3>EVOLUÇÃO DA NOTA</h3>
                  <div style={{ height: 180 }}>
                    <SparkGrande
                      valores={leiturasComNota.map((l) => l.resultado?.nota_final ?? null)}
                      labels={leiturasComNota.map((l) => new Date(l.leitura.dataHoraISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}
                    />
                  </div>
                  <p className="evo-note">{leiturasComNota.length} leitura(s) real(is) — histórico mais longo aparece conforme novas leituras forem processadas.</p>
                </div>
                <div className="card">
                  <h3>LEITURAS</h3>
                  <div>
                    {leiturasComNota.map((l) => (
                      <div key={l.leitura.id} className="leitura-row" aria-selected={leituraSelecionada === l.leitura.id} onClick={() => setLeituraSelecionada(l.leitura.id)}>
                        <span className="n">{new Date(l.leitura.dataHoraISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="sub">{l.leitura.posicao?.rua || '—'}, {l.leitura.posicao?.county || '—'}/{l.leitura.posicao?.uf || '—'}</span>
                        <span className="n">{nf(l.resultado?.nota_final ?? null, 1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="card" style={{ marginTop: 16 }}>
                <h3>DETALHE DA LEITURA SELECIONADA</h3>
                {leituraDetalheAtual ? (
                  <div className="kv">
                    <div><div className="i">Velocidade</div><div className="o">{leituraDetalheAtual.leitura.velocidadeKmh ?? '—'} km/h</div></div>
                    <div><div className="i">Rotação</div><div className="o">{leituraDetalheAtual.leitura.rpm ?? '—'} rpm</div></div>
                    <div><div className="i">Odômetro</div><div className="o">{nf(leituraDetalheAtual.leitura.odometroKm, 1)} km</div></div>
                    <div><div className="i">Referência mais próxima</div><div className="o" style={{ fontSize: 12.5 }}>
                      {leituraDetalheAtual.leitura.referenciaMaisProxima?.nome || '—'}
                      <small>{leituraDetalheAtual.leitura.referenciaMaisProxima ? `${leituraDetalheAtual.leitura.referenciaMaisProxima.grupo} · a ${nf(leituraDetalheAtual.leitura.referenciaMaisProxima.distanciaKm, 1)} km` : ''}</small>
                    </div></div>
                    <div><div className="i">Consumo bruto do sensor</div><div className="o">{nf(leituraDetalheAtual.leitura.consumoBruto, 0)}<small>unidade pendente de confirmação</small></div></div>
                    <div><div className="i">Evento no pacote</div><div className="o" style={{ fontSize: 12, fontFamily: 'var(--sans)' }}>{leituraDetalheAtual.leitura.eventoBruto || '—'}</div></div>
                  </div>
                ) : <p className="sub" style={{ fontSize: 12.5 }}>Selecione uma leitura na lista ao lado.</p>}
              </div>

              <div className="card" style={{ marginTop: 16 }}>
                <h3>🕐 DETALHAMENTO POR HORA <span className="tag">{new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} a {new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}</span></h3>
                {dados.detalhamentoPorHora.length === 0 ? (
                  <p className="sub" style={{ fontSize: 12.5 }}>Nenhuma leitura real no período selecionado para detalhar por hora.</p>
                ) : (
                  <>
                    <div className="tbox">
                      <table>
                        <thead>
                          <tr>
                            <th>Dia / Hora</th>
                            <th className="num">Leituras</th>
                            <th className="num">Nota média</th>
                            <th className="num">Velocidade média</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dados.detalhamentoPorHora.map((b) => {
                            const [dia, hora] = b.horaInicio.split('T');
                            return (
                              <tr key={b.horaInicio}>
                                <td className="n">{new Date(dia + 'T00:00:00').toLocaleDateString('pt-BR')} — {hora}h</td>
                                <td className="num n">{b.qtdLeituras}</td>
                                <td className="num n" style={{ color: corBanda(b.notaMedia), fontWeight: 500 }}>{nf(b.notaMedia, 1)}</td>
                                <td className="num n">{b.velocidadeMedia != null ? `${nf(b.velocidadeMedia, 0)} km/h` : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="mute" style={{ fontSize: 11, marginTop: 10 }}>
                      Só aparecem aqui as horas em que o equipamento realmente enviou telemetria — a Maxtrack não transmite em intervalo fixo, então horas sem leitura simplesmente não têm linha (não preenchemos com dado inventado).
                    </p>
                  </>
                )}
              </div>
            </div>

          <div className="painel show" id="secao-mapa">
            <h2 className="secao-titulo">Mapa</h2>
              <div className="card">
                <h3>🗺️ TRAJETO NO PERÍODO <span className="tag">{dados.pontosTrajeto.length} ponto(s) com GPS válido</span></h3>
                <p className="sub" style={{ fontSize: 12.5, marginBottom: 14 }}>
                  {new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} a {new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')} · pontos conectados na ordem cronológica das leituras reais de telemetria — sem interpolação de rota entre eles.
                </p>
                <MapaTrajeto pontos={dados.pontosTrajeto} />
                <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 11.5, color: 'var(--sub)', flexWrap: 'wrap' }}>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#3f9d5d', marginRight: 5 }}></span>Início do trajeto</span>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#d1493c', marginRight: 5 }}></span>Fim do trajeto</span>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#d9932f', marginRight: 5 }}></span>Ponto intermediário (cor pela velocidade)</span>
                </div>
                <p className="mute" style={{ fontSize: 11, marginTop: 10 }}>
                  Clique em um ponto para ver data/hora, velocidade e rotação registradas. Coordenadas fora do intervalo válido (bug conhecido de escala em ~4% dos pacotes) já foram filtradas antes de chegar aqui.
                </p>
              </div>
            </div>

          <div className="painel show" id="secao-masterdrive">
            <h2 className="secao-titulo">Master Drive</h2>
              <div className="card">
                <div className="md-head">
                  <div>
                    <h3 style={{ margin: 0 }}>ATENDIMENTO DO MASTER DRIVE</h3>
                    <p className="sub" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {role === 'master' ? 'Papel atual: Master Drive — pode registrar atendimento e corrigir dado de origem.' : 'Papel atual: Gestor — pode consultar o histórico, não pode registrar.'}
                    </p>
                  </div>
                  <button className="btn pri sm" disabled={role !== 'master'} onClick={() => setMdFormAberto(true)}>Registrar atendimento</button>
                </div>
                <p className="sub" style={{ fontSize: 12.5, maxWidth: '70ch', marginBottom: 14 }}>
                  A conversa com o motorista acontece fora do sistema — WhatsApp, reunião, o canal que já existe na operação. Este espaço só registra o resultado depois. Não é um canal de contestação: o motorista não vê status de análise nem decisão aqui.
                </p>
                {role !== 'master' && !mdFormAberto && (
                  <div className="md-locked">Alterne para o papel Master Drive, no topo da tela, para registrar um atendimento.</div>
                )}
                {mdFormAberto && (
                  <div className="md-form show">
                    <div className="row r2">
                      <div className="field">
                        <label>Indicador (opcional)</label>
                        <select value={mdIndicador} onChange={(e) => setMdIndicador(e.target.value)}>
                          <option value="">Geral, sem indicador específico</option>
                          {indicadores.filter((i) => i.campo_fonte).map((i) => (
                            <option key={i.mnemonico} value={i.mnemonico}>{i.nome}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Resultado da conversa</label>
                        <select value={mdResultado} onChange={(e) => setMdResultado(e.target.value as 'sem_acao' | 'orientacao_registrada' | 'correcao_de_dado')}>
                          <option value="sem_acao">Sem necessidade de ação</option>
                          <option value="orientacao_registrada">Orientação registrada</option>
                          <option value="correcao_de_dado">Correção de dado de origem</option>
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>O que foi conversado</label>
                      <textarea rows={2} placeholder="Resumo curto" value={mdResumo} onChange={(e) => setMdResumo(e.target.value)} />
                    </div>
                    {mdErro && <p style={{ color: 'var(--freio)', fontSize: 12.5, marginBottom: 10 }}>{mdErro}</p>}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn pri" disabled={mdEnviando} onClick={salvarAtendimento}>{mdEnviando ? 'Salvando…' : 'Registrar'}</button>
                      <button className="btn" onClick={() => setMdFormAberto(false)}>Cancelar</button>
                    </div>
                  </div>
                )}
                <div>
                  {atendimentos.length === 0 ? (
                    <p className="sub" style={{ fontSize: 12.5, marginTop: 14 }}>Nenhum atendimento registrado ainda para este motorista.</p>
                  ) : (
                    atendimentos.map((a) => {
                      const d = new Date(a.criado_em);
                      const res = a.resultado === 'correcao_de_dado' ? 'Correção de dado' : a.resultado === 'orientacao_registrada' ? 'Orientação registrada' : 'Sem necessidade de ação';
                      return (
                        <div className="hist-item" key={a.id}>
                          <span className="t">{d.toLocaleDateString('pt-BR')} {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                          <span><b>{res}</b>{a.indicador_mnemonico ? ` · ${a.indicador_mnemonico}` : ''} — {a.resumo}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

          <p className="mute" style={{ fontSize: 11.5, marginTop: 26, maxWidth: '82ch' }}>
            Piloto automático e excesso de velocidade entram na regra com peso 5 cada, mas a integração Maxtrack ainda não confirma o campo de percentual de viagem para nenhum dos dois neste modelo de equipamento — por isso aparecem como pendentes de integração, nunca como zero.
          </p>
        </div>
      </main>
    </div>
  );
}
