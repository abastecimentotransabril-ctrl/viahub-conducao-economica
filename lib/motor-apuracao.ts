import { Indicador } from './types';

const SENTINELA = 1000;
const COBERTURA_MINIMA_PCT = 70;
const CASAS_DECIMAIS = 1;

export interface ResultadoApuracao {
  nota_final: number | null;
  cobertura_pct: number;
  elegivel: boolean;
  motivo_inelegibilidade: string | null;
  faixa_rotulo: string | null;
  detalhe: Array<{
    indicador: string;
    valor: number | null;
    nota: number | null;
    peso: number;
    pontos: number | null;
    entrou: boolean;
  }>;
}

interface FaixaNota {
  nota_minima: number;
  rotulo: string;
}

interface RegrasApuracao {
  sentinela: number;
  casas_decimais: number;
  cobertura_minima_pct: number;
}

/**
 * Calcula a nota final de um motorista baseado nos indicadores e dados brutos
 */
export function calcularNotaFinal(
  indicadorBruto: Record<string, number | null>,
  indicadores: Indicador[],
  faixas: FaixaNota[],
  regras: RegrasApuracao
): ResultadoApuracao {
  const detalhe: ResultadoApuracao['detalhe'] = [];
  let somaValorPonderado = 0;
  let somaPesoBruto = 0;
  let somaPesoComDado = 0;

  // Indicadores de tipo 'pontua' para cálculo de cobertura
  const indicadoresNotua = indicadores.filter(ind => ind.tipo === 'pontua' && ind.ativo);
  const somaPesoIndicadoresValidos = indicadoresNotua.reduce((sum, ind) => sum + ind.peso, 0);

  // Processar cada indicador
  for (const ind of indicadores.filter(i => i.ativo)) {
    const valorBruto = indicadorBruto[ind.campo_fonte || ind.mnemonico] || null;
    let entrou = false;
    let nota: number | null = null;
    let pontos: number | null = null;

    // Verificar se é sentinela (ausência de dado)
    if (valorBruto !== null && valorBruto !== undefined) {
      if (ind.tipo === 'pontua') {
        // Validar sentinela
        if (valorBruto === regras.sentinela) {
          // Ausência de dado
          nota = null;
        } else if (ind.nota0 !== null && ind.nota100 !== null) {
          // Calcular nota: clamp((valor - nota0) / (nota100 - nota0) * 100, 0, 100)
          const notaCalculada = (valorBruto - ind.nota0) / (ind.nota100 - ind.nota0) * 100;
          nota = Math.max(0, Math.min(100, notaCalculada));
          somaPesoBruto += ind.peso;
          somaPesoComDado += ind.peso;
          pontos = nota * ind.peso;
          somaValorPonderado += pontos;
          entrou = true;
        }
      } else if (ind.tipo === 'classifica') {
        // Classificação não entra em nota, só para rotulação
        nota = valorBruto;
        entrou = false;
      }
    }

    detalhe.push({
      indicador: ind.mnemonico,
      valor: valorBruto,
      nota,
      peso: ind.peso,
      pontos,
      entrou,
    });
  }

  // Calcular cobertura
  const cobertura_pct = somaPesoIndicadoresValidos > 0
    ? (somaPesoComDado / somaPesoIndicadoresValidos) * 100
    : 0;

  // Calcular nota final
  let nota_final: number | null = null;
  let elegivel = false;
  let motivo_inelegibilidade: string | null = null;
  let faixa_rotulo: string | null = null;

  if (somaPesoBruto > 0 && cobertura_pct >= regras.cobertura_minima_pct) {
    nota_final = parseFloat((somaValorPonderado / somaPesoBruto).toFixed(regras.casas_decimais));
    elegivel = true;

    // Encontrar faixa
    const faixaEncontrada = faixas
      .sort((a, b) => b.nota_minima - a.nota_minima)
      .find(f => nota_final! >= f.nota_minima);

    if (faixaEncontrada) {
      faixa_rotulo = faixaEncontrada.rotulo;
    }
  } else if (cobertura_pct < regras.cobertura_minima_pct) {
    motivo_inelegibilidade = `Cobertura insuficiente: ${cobertura_pct.toFixed(1)}% (mínimo ${regras.cobertura_minima_pct}%)`;
  }

  return {
    nota_final,
    cobertura_pct: parseFloat(cobertura_pct.toFixed(1)),
    elegivel,
    motivo_inelegibilidade,
    faixa_rotulo,
    detalhe,
  };
}

/**
 * Classifica a pressão no acelerador (indicador de tipo 'classifica')
 */
export function classificarPressao(valor: number | null): string | null {
  if (valor === null) return null;

  if (valor <= 60) return 'Ideal';
  if (valor <= 70) return 'Atenção';
  return 'Crítico';
}

/**
 * Retorna a cor para uma faixa de nota
 */
export function corParaFaixa(faixa: string | null): string {
  switch (faixa?.toLowerCase()) {
    case 'ouro':
      return '#3f9d5d'; // pista
    case 'prata':
      return '#3f7ea8'; // sinal
    case 'bronze':
      return '#d9932f'; // ambar
    default:
      return '#6f6a5c'; // sub
  }
}
