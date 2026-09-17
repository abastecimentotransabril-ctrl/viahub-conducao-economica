import * as XLSX from 'xlsx';

export type Celula = string | number | null;

export interface DefinicaoAba {
  nome: string; // até 31 caracteres, sem : \ / ? * [ ]
  linhas: Celula[][]; // primeira linha = cabeçalho
  largurasColunas?: number[];
}

/**
 * Monta um workbook .xlsx com uma ou mais abas a partir de matrizes simples
 * de linhas/colunas, e retorna os bytes prontos para resposta HTTP.
 */
export function gerarXlsx(abas: DefinicaoAba[]): Buffer {
  const wb = XLSX.utils.book_new();

  for (const aba of abas) {
    const ws = XLSX.utils.aoa_to_sheet(aba.linhas);
    if (aba.largurasColunas) {
      ws['!cols'] = aba.largurasColunas.map((w) => ({ wch: w }));
    }
    const nomeSeguro = aba.nome.replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, nomeSeguro);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function nomeArquivoXlsx(base: string): string {
  const limpo = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${limpo}.xlsx`;
}
