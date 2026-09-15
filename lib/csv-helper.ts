/**
 * Gera um CSV compatível com Excel (separador ; para pt-BR, BOM UTF-8
 * para acentuação correta, sem depender de bibliotecas externas).
 */
export function gerarCsv(linhas: string[][]): string {
  const BOM = '\uFEFF';
  const corpo = linhas
    .map((linha) =>
      linha
        .map((celula) => {
          const texto = celula ?? '';
          // Escapar aspas e envolver em aspas se tiver ; , quebra de linha ou aspas
          if (/[;",\n]/.test(texto)) {
            return `"${texto.replace(/"/g, '""')}"`;
          }
          return texto;
        })
        .join(';')
    )
    .join('\r\n');
  return BOM + corpo;
}
