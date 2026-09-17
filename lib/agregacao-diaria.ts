import { supabaseServer } from './supabase-server';
import { calcularNotaFinal, ResultadoApuracao } from './motor-apuracao';
import { Indicador } from './types';

export interface FaixaNota {
  nota_minima: number;
  rotulo: string;
}

export interface RegrasApuracao {
  sentinela: number;
  casas_decimais: number;
  cobertura_minima_pct: number;
}

export interface DetalheDia {
  dia: string; // yyyy-mm-dd
  qtdLeituras: number;
  primeiraLeitura: string | null;
  ultimaLeitura: string | null;
  resultado: ResultadoApuracao;
}

/**
 * Detalhamento dia a dia de um motorista: para cada dia com leitura, agrega os
 * indicadores brutos com a mesma ponderação por tempo usada no cálculo do
 * período inteiro (apurar_periodo_motorista) e aplica o motor de apuração,
 * expondo a nota de cada critério (não só a nota final).
 */
export async function detalharPorDia(
  motoristaId: string,
  dataInicio: string,
  dataFim: string,
  indicadores: Indicador[],
  faixasNota: FaixaNota[],
  regras: RegrasApuracao
): Promise<DetalheDia[]> {
  if (indicadores.length === 0) return [];

  const { data, error } = await supabaseServer.rpc('apurar_por_dia_motorista', {
    p_motorista_id: motoristaId,
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
  });

  if (error || !data) return [];

  return (data as any[]).map((linha) => {
    const indicadorBruto = {
      rpmZone: linha.avg_rpmzone,
      inertiaUsage: linha.avg_inertiausage,
      iddleTime: linha.avg_iddletime,
      accelerationExcess: linha.avg_accelerationexcess,
      throttleAgregation: linha.avg_throttleagregation,
    };
    const resultado = calcularNotaFinal(indicadorBruto, indicadores, faixasNota, regras);
    return {
      dia: linha.dia,
      qtdLeituras: Number(linha.qtd_leituras),
      primeiraLeitura: linha.primeira_leitura,
      ultimaLeitura: linha.ultima_leitura,
      resultado,
    };
  });
}
