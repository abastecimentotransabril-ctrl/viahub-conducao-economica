// Papéis de usuário
export type UserRole = 'gestor' | 'master_drive' | 'admin_gamificacao' | 'rh' | 'auditoria';

// Indicadores
export interface Indicador {
  id: string;
  versao_config_id: string;
  mnemonico: string;
  nome: string;
  ordem: number;
  peso: number;
  ativo: boolean;
  tipo: 'pontua' | 'classifica';
  campo_fonte: string | null;
  fonte_nota: string | null;
  nota0: number | null;
  nota100: number | null;
  curva: 'linear' | 'degrau';
  criado_em: string;
}

// Telemetria
export interface LeituraTelemetria {
  id: string;
  veiculo_id: string;
  motorista_id: string | null;
  timestamp_leitura: string;
  capacidade: 'com_can' | 'sem_can';
  latitude: number | null;
  longitude: number | null;
  velocidade_kmh: number | null;
  rpm: number | null;
  odometro_km: number | null;
  em_movimento: boolean | null;
  motor_ligado: boolean | null;
  indicadores_brutos: Record<string, number | null>;
  consumo_bruto: number | null;
  criado_em: string;
}

// Apuração
export interface ResultadoMotorista {
  id: string;
  execucao_id: string;
  motorista_id: string;
  nota_final: number | null;
  cobertura_pct: number | null;
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
  vigente: boolean;
  criado_em: string;
}

// Motorista
export interface Motorista {
  id: string;
  empresa_id: string;
  nome: string;
  cpf: string | null;
  matricula: string | null;
  ativo: boolean;
  criado_em: string;
}

// Veículo
export interface Veiculo {
  id: string;
  empresa_id: string;
  unidade_id: string | null;
  placa: string;
  modelo_equipamento: string;
  capacidade: 'com_can' | 'sem_can';
  criado_em: string;
}

// Usuário
export interface Usuario {
  id: string;
  empresa_id: string;
  nome: string;
  papel: UserRole;
  criado_em: string;
}

// Configuração
export interface VersaoConfig {
  id: string;
  empresa_id: string;
  nome: string;
  hash: string | null;
  vigente: boolean;
  criado_em: string;
}

// Master Drive
export interface AtendimentoMasterDrive {
  id: string;
  motorista_id: string;
  master_drive_usuario_id: string;
  indicador_mnemonico: string | null;
  resumo: string;
  resultado: 'sem_acao' | 'orientacao_registrada' | 'correcao_de_dado';
  criado_em: string;
}

// Resposta da API
export interface ApiResponse<T> {
  sucesso: boolean;
  dados?: T;
  erro?: string;
}
