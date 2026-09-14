'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { Motorista, Veiculo, ResultadoMotorista, LeituraTelemetria } from '@/lib/types';
import { classificarPressao, corParaFaixa } from '@/lib/motor-apuracao';

interface DadosMotorista {
  motorista: Motorista & { cpf: string | null };
  veiculo: Veiculo | null;
  leituraRecente: LeituraTelemetria | null;
  resultadoVigente: ResultadoMotorista | null;
  atendimentos: any[];
}

export default function MotoristaDetalhe() {
  const params = useParams();
  const router = useRouter();
  const motorista_id = params.id as string;

  const [dados, setDados] = useState<DadosMotorista | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDetalhe, setExpandedDetalhe] = useState(false);

  useEffect(() => {
    const carregarDados = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          router.push('/auth/login');
          return;
        }

        const response = await fetch(`/api/motoristas/${motorista_id}`);
        const json = await response.json();

        if (json.sucesso) {
          setDados(json.dados);
        } else {
          setError(json.erro || 'Erro ao carregar dados');
        }
      } catch (erro) {
        setError('Erro ao carregar motorista');
        console.error(erro);
      } finally {
        setLoading(false);
      }
    };

    carregarDados();
  }, [motorista_id, router]);

  if (loading) {
    return <div style={{ padding: '20px' }}>Carregando...</div>;
  }

  if (error || !dados) {
    return (
      <div style={{ padding: '20px' }}>
        <button onClick={() => router.back()} style={{
          background: 'var(--ink)',
          color: '#fff',
          padding: '8px 16px',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          marginBottom: '20px',
        }}>
          ← Voltar
        </button>
        <p style={{ color: 'var(--freio)' }}>{error}</p>
      </div>
    );
  }

  const { motorista, veiculo, resultadoVigente, leituraRecente } = dados;
  const corFaixa = resultadoVigente ? corParaFaixa(resultadoVigente.faixa_rotulo) : 'var(--mute)';
  const pressao = leituraRecente ? classificarPressao(leituraRecente.indicadores_brutos?.throttleAgregation || null) : null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ padding: '20px', maxWidth: '1280px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '30px' }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--sinal)',
              cursor: 'pointer',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            ← Voltar
          </button>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 300px',
            gap: '20px',
            marginBottom: '20px',
          }}>
            {/* Informações */}
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '14px',
              padding: '20px',
            }}>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'var(--brand)',
                  color: 'var(--brand-ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: '600',
                  flexShrink: 0,
                }}>
                  {motorista.nome.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <h1 style={{ fontSize: '22px', marginBottom: '4px' }}>
                    {motorista.nome}
                  </h1>
                  <p style={{ color: 'var(--sub)', fontSize: '12.5px', margin: 0 }}>
                    Motorista
                  </p>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
                marginTop: '16px',
                paddingTop: '16px',
                borderTop: '1px solid var(--line)',
              }}>
                <div>
                  <p style={{ fontSize: '11.5px', color: 'var(--mute)', margin: '0 0 4px 0' }}>Placa</p>
                  <p style={{ fontSize: '14px', fontFamily: 'var(--mono)', fontWeight: '500', margin: 0 }}>
                    {veiculo?.placa || '—'}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '11.5px', color: 'var(--mute)', margin: '0 0 4px 0' }}>Matrícula</p>
                  <p style={{ fontSize: '14px', fontFamily: 'var(--mono)', fontWeight: '500', margin: 0 }}>
                    {motorista.matricula || '—'}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '11.5px', color: 'var(--mute)', margin: '0 0 4px 0' }}>CPF</p>
                  <p style={{ fontSize: '14px', fontFamily: 'var(--mono)', fontWeight: '500', margin: 0 }}>
                    {motorista.cpf || '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Gauge de nota */}
            {resultadoVigente ? (
              <div style={{
                background: 'var(--gauge)',
                color: '#f2ede4',
                borderRadius: '16px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: '12px', color: '#8b9490', margin: '0 0 12px 0' }}>
                  Nota Final
                </p>
                <div style={{
                  fontSize: '46px',
                  fontWeight: '600',
                  fontFamily: 'var(--serif)',
                  marginBottom: '4px',
                  color: corFaixa,
                }}>
                  {resultadoVigente.nota_final?.toFixed(1) || '—'}
                </div>
                <p style={{
                  fontSize: '12px',
                  letterSpacing: '0.1em',
                  margin: 0,
                  color: 'var(--brand)',
                  fontFamily: 'var(--mono)',
                  marginTop: '6px',
                }}>
                  {resultadoVigente.faixa_rotulo || 'SEM PREMIAÇÃO'}
                </p>
                {!resultadoVigente.elegivel && (
                  <p style={{
                    fontSize: '10px',
                    color: '#8b9490',
                    marginTop: '12px',
                    lineHeight: '1.4',
                  }}>
                    {resultadoVigente.motivo_inelegibilidade || 'Inelegível'}
                  </p>
                )}
                <button
                  onClick={() => setExpandedDetalhe(!expandedDetalhe)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--brand)',
                    fontSize: '12px',
                    marginTop: '12px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: '3px',
                  }}
                >
                  {expandedDetalhe ? 'Ocultar' : 'Ver detalhe'}
                </button>
              </div>
            ) : (
              <div style={{
                background: 'var(--gauge)',
                color: '#f2ede4',
                borderRadius: '16px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: '12px', color: '#8b9490' }}>
                  Sem apuração disponível
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Detalhe expandido */}
        {expandedDetalhe && resultadoVigente && (
          <div style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: '14px',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <h3 style={{ fontSize: '12px', color: 'var(--sub)', marginBottom: '14px' }}>
              Composição da Nota
            </h3>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12.8px',
            }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: '500', color: 'var(--sub)', fontSize: '11px', paddingBottom: '7px', borderBottom: '1px solid var(--line)' }}>
                    Indicador
                  </th>
                  <th style={{ textAlign: 'right', fontWeight: '500', color: 'var(--sub)', fontSize: '11px', paddingBottom: '7px', borderBottom: '1px solid var(--line)' }}>
                    Valor
                  </th>
                  <th style={{ textAlign: 'right', fontWeight: '500', color: 'var(--sub)', fontSize: '11px', paddingBottom: '7px', borderBottom: '1px solid var(--line)' }}>
                    Nota
                  </th>
                  <th style={{ textAlign: 'right', fontWeight: '500', color: 'var(--sub)', fontSize: '11px', paddingBottom: '7px', borderBottom: '1px solid var(--line)' }}>
                    Peso
                  </th>
                  <th style={{ textAlign: 'right', fontWeight: '500', color: 'var(--sub)', fontSize: '11px', paddingBottom: '7px', borderBottom: '1px solid var(--line)' }}>
                    Pontos
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultadoVigente.detalhe.map((item, idx) => (
                  <tr key={idx}>
                    <td style={{ paddingTop: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)' }}>
                      {item.indicador}
                    </td>
                    <td style={{ paddingTop: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {item.valor !== null ? item.valor.toFixed(1) : '—'}
                    </td>
                    <td style={{ paddingTop: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: item.entrou ? '500' : '400' }}>
                      {item.nota !== null ? item.nota.toFixed(1) : '—'}
                    </td>
                    <td style={{ paddingTop: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {item.peso}
                    </td>
                    <td style={{ paddingTop: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: item.entrou ? '500' : '400', color: item.entrou ? 'var(--ink)' : 'var(--mute)' }}>
                      {item.pontos !== null ? item.pontos.toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: '1px solid var(--line)',
              fontSize: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ color: 'var(--sub)' }}>Cobertura: {resultadoVigente.cobertura_pct?.toFixed(1)}%</span>
              <span style={{ fontWeight: '500', fontFamily: 'var(--mono)' }}>
                Nota: {resultadoVigente.nota_final?.toFixed(1)}
              </span>
            </div>
          </div>
        )}

        {/* Pressão no acelerador */}
        {pressao && (
          <div style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: '14px',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <h3 style={{ fontSize: '12px', color: 'var(--sub)', marginBottom: '14px' }}>
              Pressão no Acelerador
            </h3>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
            }}>
              <div style={{
                fontSize: '24px',
                fontWeight: '600',
                fontFamily: 'var(--mono)',
                color: pressao === 'Ideal' ? 'var(--pista)' : pressao === 'Atenção' ? 'var(--ambar)' : 'var(--freio)',
              }}>
                {leituraRecente?.indicadores_brutos?.throttleAgregation?.toFixed(1) || '—'}%
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: '500', fontSize: '14px' }}>
                  {pressao}
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--mute)' }}>
                  {pressao === 'Ideal' && 'Até 60% - Excelente'}
                  {pressao === 'Atenção' && '61-70% - Requer atenção'}
                  {pressao === 'Crítico' && 'Acima de 70% - Crítico'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Atendimentos */}
        {dados.atendimentos.length > 0 && (
          <div style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: '14px',
            padding: '20px',
          }}>
            <h3 style={{ fontSize: '12px', color: 'var(--sub)', marginBottom: '14px' }}>
              Histórico de Atendimentos
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {dados.atendimentos.map((atend) => (
                <div
                  key={atend.id}
                  style={{
                    padding: '12px',
                    background: 'var(--bg)',
                    borderRadius: '8px',
                    borderLeft: '3px solid var(--sinal)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
                    <p style={{ margin: 0, fontWeight: '500', fontSize: '12px' }}>
                      {atend.resultado === 'sem_acao' && 'Sem ação'}
                      {atend.resultado === 'orientacao_registrada' && 'Orientação registrada'}
                      {atend.resultado === 'correcao_de_dado' && 'Correção de dado'}
                    </p>
                    <p style={{ margin: 0, fontSize: '11px', color: 'var(--mute)', fontFamily: 'var(--mono)' }}>
                      {new Date(atend.criado_em).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--sub)' }}>
                    {atend.resumo}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
