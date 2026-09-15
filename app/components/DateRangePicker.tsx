'use client';

import { useEffect, useRef, useState } from 'react';
import {
  format, startOfMonth, endOfMonth, addMonths, subMonths, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isWithinInterval, isBefore, isAfter,
  differenceInCalendarDays, subDays,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface DateRangePickerProps {
  inicio: Date;
  fim: Date;
  onChange: (inicio: Date, fim: Date) => void;
}

const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

function hojeSemHora(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function DateRangePicker({ inicio, fim, onChange }: DateRangePickerProps) {
  const [aberto, setAberto] = useState(false);
  const [mesEsquerda, setMesEsquerda] = useState(startOfMonth(inicio));
  const [tempInicio, setTempInicio] = useState<Date>(inicio);
  const [tempFim, setTempFim] = useState<Date | null>(fim);
  const [presetAtivo, setPresetAtivo] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  function abrir() {
    setTempInicio(inicio);
    setTempFim(fim);
    setMesEsquerda(startOfMonth(inicio));
    setPresetAtivo(null);
    setAberto(true);
  }

  function aplicarPreset(nome: string, ini: Date, f: Date) {
    setPresetAtivo(nome);
    setTempInicio(ini);
    setTempFim(f);
    setMesEsquerda(startOfMonth(ini));
  }

  const hoje = hojeSemHora();
  const presets: Array<{ nome: string; calc: () => [Date, Date] }> = [
    { nome: 'Últimos 7 dias', calc: () => [subDays(hoje, 6), hoje] },
    { nome: 'Últimos 30 dias', calc: () => [subDays(hoje, 29), hoje] },
    { nome: 'Mês atual', calc: () => [startOfMonth(hoje), endOfMonth(hoje)] },
    { nome: 'Mês anterior', calc: () => { const m = subMonths(hoje, 1); return [startOfMonth(m), endOfMonth(m)]; } },
  ];

  function clicarDia(dia: Date) {
    setPresetAtivo(null);
    if (!tempFim || (tempInicio && tempFim && !isSameDay(tempInicio, dia))) {
      // já tem range fechado ou nada selecionado -> começa novo range
      if (tempFim && tempInicio) {
        setTempInicio(dia);
        setTempFim(null);
        return;
      }
    }
    if (!tempFim) {
      if (isBefore(dia, tempInicio)) {
        setTempFim(tempInicio);
        setTempInicio(dia);
      } else {
        setTempFim(dia);
      }
    } else {
      setTempInicio(dia);
      setTempFim(null);
    }
  }

  function redefinir() {
    setTempInicio(inicio);
    setTempFim(fim);
    setPresetAtivo(null);
  }

  function aplicar() {
    if (tempInicio && tempFim) {
      onChange(tempInicio, tempFim);
      setAberto(false);
    }
  }

  function renderMes(mesBase: Date) {
    const inicioMes = startOfMonth(mesBase);
    const fimMes = endOfMonth(mesBase);
    const inicioGrade = startOfWeek(inicioMes);
    const fimGrade = endOfWeek(fimMes);
    const dias = eachDayOfInterval({ start: inicioGrade, end: fimGrade });

    return (
      <div className="drp-month">
        <div className="drp-month-title">{format(mesBase, 'MMMM yyyy', { locale: ptBR })}</div>
        <div className="drp-weekdays">
          {DIAS_SEMANA.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="drp-days">
          {dias.map((dia) => {
            const foraDoMes = !isSameMonth(dia, mesBase);
            const emRange = tempInicio && tempFim && isWithinInterval(dia, { start: tempInicio, end: tempFim });
            const ehInicio = tempInicio && isSameDay(dia, tempInicio);
            const ehFim = tempFim && isSameDay(dia, tempFim);
            const ehHoje = isSameDay(dia, hoje);
            const classes = [
              'drp-day',
              foraDoMes ? 'fora-mes' : '',
              emRange ? 'em-range' : '',
              ehInicio ? 'range-inicio' : '',
              ehFim ? 'range-fim' : '',
              ehHoje ? 'hoje' : '',
            ].filter(Boolean).join(' ');
            return (
              <button key={dia.toISOString()} type="button" className={classes} onClick={() => clicarDia(dia)}>
                {dia.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const qtdDias = differenceInCalendarDays(fim, inicio) + 1;

  return (
    <div className="drp-wrap" ref={ref}>
      <button type="button" className="chip drp-trigger" onClick={() => (aberto ? setAberto(false) : abrir())}>
        📅 {format(inicio, 'dd/MM/yy')} – {format(fim, 'dd/MM/yy')}
        <span className="tag">{qtdDias}D</span>
      </button>

      {aberto && (
        <div className="drp-popover">
          <div className="drp-body">
            <div className="drp-presets">
              <div className="drp-presets-title">PERÍODOS</div>
              {presets.map((p) => {
                const [pi, pf] = p.calc();
                const ativo = presetAtivo === p.nome;
                return (
                  <button
                    key={p.nome}
                    type="button"
                    className={`drp-preset-btn${ativo ? ' ativo' : ''}`}
                    onClick={() => aplicarPreset(p.nome, pi, pf)}
                  >
                    {p.nome}
                  </button>
                );
              })}
            </div>
            <div className="drp-calendars">
              <div className="drp-calendars-nav">
                <button type="button" onClick={() => setMesEsquerda(subMonths(mesEsquerda, 1))}>‹</button>
                <button type="button" onClick={() => setMesEsquerda(addMonths(mesEsquerda, 1))}>›</button>
              </div>
              <div className="drp-calendars-grid">
                {renderMes(mesEsquerda)}
                {renderMes(addMonths(mesEsquerda, 1))}
              </div>
            </div>
          </div>
          <div className="drp-footer">
            <span className="drp-range-txt">
              {tempInicio ? format(tempInicio, "dd 'de' MMM yyyy", { locale: ptBR }) : '—'}
              {' → '}
              {tempFim ? format(tempFim, "dd 'de' MMM yyyy", { locale: ptBR }) : '—'}
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="drp-link" onClick={redefinir}>Redefinir</button>
              <button type="button" className="drp-aplicar" onClick={aplicar} disabled={!tempInicio || !tempFim}>Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
