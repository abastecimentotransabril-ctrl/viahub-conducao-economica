/**
 * Parser de payloads brutos da Maxtrack (tabela maxtrack_mensagens_raw).
 *
 * Aplica as correções documentadas no CLAUDE.md seção 6:
 * - Sentinela 1000 em driverScore = ausência de dado, tratar como null
 * - Latitude/longitude vêm ×1e7, dividir e validar intervalo
 * - MXT130V2 não tem CAN, não deve gerar indicadores de condução econômica
 */

export interface LeituraNormalizada {
  id: string;
  timestampUnix: number;
  dataHoraISO: string;
  velocidadeKmh: number | null;
  rpm: number | null;
  odometroKm: number | null;
  consumoBruto: number | null;
  posicao: { lat: number; lon: number; county?: string; rua?: string; uf?: string } | null;
  posicaoInvalida: boolean;
  referenciaMaisProxima: { nome: string; grupo: string; distanciaKm: number } | null;
  eventoBruto: string | null;
  operationalLabel: string | null;
  modeloEquipamento: string | null;
  capacidade: 'com_can' | 'sem_can';
  indicadoresBrutos: {
    global: number | null;
    rpmZone: number | null;
    inertiaUsage: number | null;
    iddleTime: number | null;
    accelerationExcess: number | null;
    throttleAgregation: number | null;
  } | null;
  motoristaNome: string | null;
  motoristaCpf: string | null;
}

const SENTINELA = 1000;
const MODELOS_SEM_CAN = ['MXT130V2'];

function tratarSentinela(v: unknown): number | null {
  if (typeof v !== 'number') return null;
  if (v === SENTINELA) return null;
  return v;
}

/**
 * Normaliza um payload bruto (já parseado como objeto JS, já que o
 * Supabase retorna colunas jsonb como objetos) em uma leitura utilizável.
 */
export function normalizarPayload(id: string, payload: any, recebidoEm: string): LeituraNormalizada | null {
  try {
    const customerData = payload?.customerData || {};
    const report = payload?.newReportData || {};
    const telemetry = report?.telemetry || {};
    const driverScoreBruto = telemetry?.driverScore;
    const modeloEquipamento: string | null = customerData?.deviceModel || null;
    const capacidade: 'com_can' | 'sem_can' =
      modeloEquipamento && MODELOS_SEM_CAN.includes(modeloEquipamento) ? 'sem_can' : 'com_can';

    // Posição: vem ×1e7, precisa dividir e validar
    const posInfo = Array.isArray(report?.positionInfo) ? report.positionInfo[0] : null;
    let posicao: LeituraNormalizada['posicao'] = null;
    let posicaoInvalida = false;
    if (posInfo && typeof posInfo.latitude === 'number' && typeof posInfo.longitude === 'number') {
      const lat = posInfo.latitude / 1e7;
      const lon = posInfo.longitude / 1e7;
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        posicao = {
          lat,
          lon,
          county: posInfo.addressInfo?.county,
          rua: posInfo.addressInfo?.street,
          uf: posInfo.addressInfo?.region,
        };
      } else {
        posicaoInvalida = true;
      }
    }

    // Referência geográfica mais próxima
    const geoObj = Array.isArray(report?.geoObjects) ? report.geoObjects[0] : null;
    const referenciaMaisProxima = geoObj
      ? {
          nome: geoObj.geoObjectName || '—',
          grupo: geoObj.geoObjectGroupName || '—',
          distanciaKm: typeof geoObj.distance === 'number' ? geoObj.distance / 1000 : 0,
        }
      : null;

    // Evento bruto (ex.: "Fim acelerador excessivo")
    const eventosTelemetria = report?.events?.telemetry;
    const eventoBruto =
      Array.isArray(eventosTelemetria) && eventosTelemetria[0]
        ? `${eventosTelemetria[0].platformData?.name || 'Evento'} (duração ${eventosTelemetria[0].duration ?? '?'} s)`
        : null;

    // Usuário/motorista identificado no pacote
    const userArr = report?.user;
    const user = Array.isArray(userArr) ? userArr[0] : null;

    // Indicadores brutos — só faz sentido se o equipamento tem CAN
    let indicadoresBrutos: LeituraNormalizada['indicadoresBrutos'] = null;
    if (capacidade === 'com_can' && driverScoreBruto) {
      indicadoresBrutos = {
        global: tratarSentinela(driverScoreBruto.global),
        rpmZone: tratarSentinela(driverScoreBruto.rpmZone),
        inertiaUsage: tratarSentinela(driverScoreBruto.inertiaUsage),
        iddleTime: tratarSentinela(driverScoreBruto.iddleTime),
        accelerationExcess: tratarSentinela(driverScoreBruto.accelerationExcess),
        throttleAgregation: tratarSentinela(driverScoreBruto.throttleAgregation),
      };
    }

    const dateTime = report?.dateTime;
    const dataHoraISO = typeof dateTime === 'number'
      ? new Date(dateTime * 1000).toISOString()
      : recebidoEm;

    return {
      id,
      timestampUnix: typeof dateTime === 'number' ? dateTime : 0,
      dataHoraISO,
      velocidadeKmh: typeof telemetry?.speed?.can === 'number' ? telemetry.speed.can : (typeof telemetry?.speed?.gps === 'number' ? telemetry.speed.gps : null),
      rpm: typeof telemetry?.rpm?.can === 'number' ? telemetry.rpm.can : null,
      odometroKm: typeof telemetry?.odometer?.can === 'number' ? telemetry.odometer.can / 1000 : null,
      consumoBruto: typeof telemetry?.fuel?.fuelConsumption === 'number' ? telemetry.fuel.fuelConsumption : null,
      posicao,
      posicaoInvalida,
      referenciaMaisProxima,
      eventoBruto,
      operationalLabel: report?.operational?.actualOperationalLabel || null,
      modeloEquipamento,
      capacidade,
      indicadoresBrutos,
      motoristaNome: user?.userName || null,
      motoristaCpf: user?.userCpf || null,
    };
  } catch {
    return null;
  }
}
