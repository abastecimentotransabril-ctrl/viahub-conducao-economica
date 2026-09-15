'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAutenticado } from '@/lib/fetch-autenticado';

interface MotoristaResumo {
  id: string;
  nome: string;
  matricula: string | null;
  ativo: boolean;
  placa: string | null;
}

interface MotoristaSelectorProps {
  motoristaAtualId: string;
  nome: string;
  placa: string | null;
  cpf: string | null;
  dataInicio: string;
  dataFim: string;
}

export default function MotoristaSelector({ motoristaAtualId, nome, placa, cpf, dataInicio, dataFim }: MotoristaSelectorProps) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [motoristas, setMotoristas] = useState<MotoristaResumo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  async function abrir() {
    setAberto(true);
    if (!motoristas) {
      setCarregando(true);
      try {
        const response = await fetchAutenticado('/api/motoristas');
        const json = await response.json();
        if (json.sucesso) setMotoristas(json.dados);
      } catch (e) {
        console.error(e);
      } finally {
        setCarregando(false);
      }
    }
  }

  function selecionar(id: string) {
    setAberto(false);
    router.push(`/motorista/${id}?inicio=${dataInicio}&fim=${dataFim}`);
  }

  const filtrados = (motoristas || []).filter((m) =>
    m.nome.toLowerCase().includes(busca.toLowerCase()) ||
    (m.placa || '').toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className="drp-wrap" ref={ref}>
      <button type="button" className="veic-sel-trigger" onClick={() => (aberto ? setAberto(false) : abrir())}>
        <span className="veic-sel-ic">🚛</span>
        <span className="veic-sel-info">
          <span className="veic-sel-nome">{nome}</span>
          <span className="veic-sel-meta">Placa {placa || '—'} · CPF {cpf || '—'}</span>
        </span>
        <span className="veic-sel-chevron">▾</span>
      </button>

      {aberto && (
        <div className="veic-sel-popover">
          <input
            autoFocus
            placeholder="Buscar por nome ou placa…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ margin: '10px 10px 6px' }}
          />
          <div className="veic-sel-lista">
            {carregando && <div className="veic-sel-item mute">Carregando…</div>}
            {!carregando && filtrados.length === 0 && <div className="veic-sel-item mute">Nenhum motorista encontrado</div>}
            {!carregando && filtrados.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`veic-sel-item${m.id === motoristaAtualId ? ' atual' : ''}`}
                onClick={() => selecionar(m.id)}
              >
                <span>
                  {m.nome}
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--mute)', fontWeight: 400 }}>
                    Placa {m.placa || '—'}
                  </span>
                </span>
                {m.id === motoristaAtualId && <span className="tag">atual</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
