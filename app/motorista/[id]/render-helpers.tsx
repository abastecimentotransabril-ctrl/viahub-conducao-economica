// Helpers de formatação e visual compartilhados pela tela do motorista

export function nf(v: number | null | undefined, casas = 0): string {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function sinal(v: number): string {
  return v > 0 ? '+' : '';
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(' ');
  const primeira = partes[0]?.[0] || '';
  const ultima = partes[partes.length - 1]?.[0] || '';
  return (primeira + ultima).toUpperCase();
}

export function corBanda(n: number | null): string {
  if (n === null) return '#a39d8c';
  if (n >= 80) return '#3f9d5d';
  if (n >= 40) return '#d9932f';
  return '#d1493c';
}

export function corFaixaNota(rotulo: string | null): string {
  switch (rotulo) {
    case 'Ouro': return '#d99a3f';
    case 'Prata': return '#8f9490';
    case 'Bronze': return '#c08457';
    default: return '#d1493c';
  }
}

/** Anel de progresso (usado nos indicadores individuais) */
export function RingSvg({ valor, tamanho = 74, cor }: { valor: number | null; tamanho?: number; cor?: string }) {
  const r = tamanho / 2 - 6;
  const circ = 2 * Math.PI * r;
  const frac = valor === null ? 0 : Math.max(0, Math.min(100, valor)) / 100;
  const strokeCor = cor || corBanda(valor);
  const center = tamanho / 2;
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`}>
      <circle cx={center} cy={center} r={r} fill="none" stroke="#e4e0d6" strokeWidth={7} />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={strokeCor}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${circ * frac} ${circ}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

/** Mini spark de 2 pontos (comparação anterior/atual) */
export function SparkMini({ v1, v2, w = 60, h = 16 }: { v1: number | null; v2: number | null; w?: number; h?: number }) {
  if (v1 === null || v2 === null) {
    return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} />;
  }
  const mn = Math.min(v1, v2) - 4;
  const mx = Math.max(v1, v2) + 4;
  const y = (v: number) => h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4);
  const cor = v2 < v1 ? '#d1493c' : '#3f9d5d';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line x1={4} y1={y(v1)} x2={w - 4} y2={y(v2)} stroke={cor} strokeWidth={1.5} />
      <circle cx={4} cy={y(v1)} r={1.6} fill="#a39d8c" />
      <circle cx={w - 4} cy={y(v2)} r={2} fill={cor} />
    </svg>
  );
}

/** Gráfico de linha grande para evolução (N pontos) */
export function SparkGrande({ valores, labels, w = 560, h = 180 }: { valores: (number | null)[]; labels: string[]; w?: number; h?: number }) {
  const validos = valores.filter((v): v is number => v !== null);
  if (validos.length === 0) {
    return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} />;
  }
  const mn = Math.min(...validos) - 6;
  const mx = Math.max(...validos) + 6;
  const range = mx - mn || 1;
  const marginX = 16;
  const step = valores.length > 1 ? (w - marginX * 2) / (valores.length - 1) : 0;
  const y = (v: number) => h - 20 - ((v - mn) / range) * (h - 36);
  const x = (i: number) => marginX + i * step;

  const pontosValidos = valores
    .map((v, i) => (v === null ? null : { x: x(i), y: y(v), v, i }))
    .filter((p): p is { x: number; y: number; v: number; i: number } => p !== null);

  const linha = pontosValidos.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const corLinha = pontosValidos.length >= 2 && pontosValidos[pontosValidos.length - 1].v < pontosValidos[0].v
    ? '#d1493c'
    : '#3f9d5d';

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <path d={linha} fill="none" stroke={corLinha} strokeWidth={2} />
      {pontosValidos.map((p, idx) => (
        <g key={idx}>
          <circle cx={p.x} cy={p.y} r={idx === pontosValidos.length - 1 ? 5 : 3.5}
            fill={idx === pontosValidos.length - 1 ? corLinha : '#a39d8c'} />
          <text x={p.x} y={p.y - 10} fill="#211f1a" fontSize={11} fontFamily="IBM Plex Mono" textAnchor="middle">
            {nf(p.v, 1)}
          </text>
        </g>
      ))}
      {labels.map((l, idx) => (
        <text key={idx} x={x(idx)} y={h - 4} fill="#a39d8c" fontSize={10} fontFamily="IBM Plex Mono" textAnchor="middle">
          {l}
        </text>
      ))}
    </svg>
  );
}

/** Donut de distribuição da frota por faixa */
export function DonutFrota({ contagem, total }: { contagem: Record<string, number>; total: number }) {
  const cores: Record<string, string> = { Ouro: '#d99a3f', Prata: '#8f9490', Bronze: '#c08457', 'Sem premiação': '#d1493c' };
  let acc = 0;
  const r = 40;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={120} height={120} viewBox="0 0 100 100">
      {Object.entries(contagem).map(([k, v]) => {
        const frac = total > 0 ? v / total : 0;
        const el = (
          <circle
            key={k}
            cx={50}
            cy={50}
            r={r}
            fill="none"
            stroke={cores[k] || '#a39d8c'}
            strokeWidth={16}
            strokeDasharray={`${circ * frac} ${circ}`}
            strokeDashoffset={-acc * circ}
            transform="rotate(-90 50 50)"
          />
        );
        acc += frac;
        return el;
      })}
      <text x={50} y={47} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize={18} fill="#211f1a">{total}</text>
      <text x={50} y={62} textAnchor="middle" fontFamily="IBM Plex Sans" fontSize={8.5} fill="#a39d8c">motoristas</text>
    </svg>
  );
}
