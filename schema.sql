-- ============================================================================
-- Módulo de Condução Econômica — Transabril / ViaHub
-- Schema Supabase (Postgres). Rodar no editor SQL do projeto Supabase
-- ou via `supabase db push`.
--
-- Convenções:
--   - Todas as tabelas com RLS habilitada desde a criação.
--   - `criado_em`/`atualizado_em` em toda tabela mutável.
--   - Chaves primárias em uuid (gen_random_uuid()).
--   - Nada aqui inventa dado de negócio: pesos, curvas e faixas são
--     inseridos via seed a partir de fixtures/dados-reais-exemplo.json,
--     não hardcoded neste arquivo.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Estrutura organizacional
-- ---------------------------------------------------------------------------

create table empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  criado_em timestamptz not null default now()
);

create table unidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text, -- pode ficar nulo: hoje só existe groupId numérico da Maxtrack, sem nome mapeado
  grupo_maxtrack_id integer, -- groupId bruto do pacote, até o nome ser cadastrado
  criado_em timestamptz not null default now()
);

create table veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  unidade_id uuid references unidades(id),
  placa text not null,
  modelo_equipamento text not null, -- ex.: 'MTC800-ADV', 'MTC800-ADV-LITE', 'MXT130V2'
  equipment_id integer, -- equipmentId bruto da Maxtrack
  capacidade text not null check (capacidade in ('com_can','sem_can')),
  criado_em timestamptz not null default now(),
  unique (empresa_id, placa)
);

create table motoristas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  cpf text, -- armazenado completo; nunca retornar em texto pleno para papéis sem necessidade (ver view motoristas_publico)
  matricula text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- vínculo motorista <-> veículo por período, porque o mesmo veículo troca de motorista
create table alocacoes_motorista_veiculo (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references motoristas(id) on delete cascade,
  veiculo_id uuid not null references veiculos(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Usuários e papéis
-- ---------------------------------------------------------------------------

create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references empresas(id),
  nome text not null,
  papel text not null check (papel in ('gestor','master_drive','admin_gamificacao','rh','auditoria')),
  criado_em timestamptz not null default now()
);

-- um usuário master_drive pode ter escopo empresa (unidade_id nulo) ou escopo unidade
create table master_drive_escopos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  unidade_id uuid references unidades(id) on delete cascade, -- nulo = escopo empresa inteira
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Regras de negócio — indicadores e versionamento
-- ---------------------------------------------------------------------------

create table versoes_config (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome text not null,
  origem_nota text, -- descrição livre de onde veio essa versão
  hash text, -- hash de conteúdo, calculado na aplicação ao salvar
  vigente boolean not null default false,
  aprovada_por uuid references usuarios(id),
  aprovada_em timestamptz,
  criado_por uuid references usuarios(id),
  criado_em timestamptz not null default now()
);

-- garante no máximo uma versão vigente por empresa
create unique index versoes_config_vigente_unica
  on versoes_config (empresa_id)
  where vigente;

create table indicadores (
  id uuid primary key default gen_random_uuid(),
  versao_config_id uuid not null references versoes_config(id) on delete cascade,
  mnemonico text not null,
  nome text not null,
  ordem integer not null default 0,
  peso numeric not null default 0,
  ativo boolean not null default true,
  tipo text not null check (tipo in ('pontua','classifica')),
  campo_fonte text, -- nulo = sem fonte confirmada na integração (ex.: PILOTO, EXC_VEL)
  fonte_nota text, -- texto explicando a origem/limitação do campo, exibido na interface
  nota0 numeric,
  nota100 numeric,
  curva text not null default 'linear' check (curva in ('linear','degrau')),
  politica_sem_dado text check (politica_sem_dado in ('redistribuir','zero','excluir')), -- nulo = usa a regra geral da empresa
  criado_em timestamptz not null default now(),
  unique (versao_config_id, mnemonico)
);

create table faixas_nota (
  id uuid primary key default gen_random_uuid(),
  versao_config_id uuid not null references versoes_config(id) on delete cascade,
  nota_minima numeric not null,
  rotulo text not null,
  cor text,
  premio text
);

create table faixas_classificacao (
  id uuid primary key default gen_random_uuid(),
  versao_config_id uuid not null references versoes_config(id) on delete cascade,
  indicador_mnemonico text not null, -- referencia indicadores.mnemonico da mesma versão
  ate numeric not null,
  rotulo text not null,
  cor text
);

create table regras_apuracao (
  id uuid primary key default gen_random_uuid(),
  versao_config_id uuid not null references versoes_config(id) on delete cascade,
  sentinela numeric not null default 1000,
  casas_decimais integer not null default 1,
  cobertura_minima_pct numeric not null default 70,
  politica_sem_dado_padrao text not null default 'redistribuir'
    check (politica_sem_dado_padrao in ('redistribuir','zero','excluir')),
  min_jornada_minutos numeric default 0,
  desempate_mnemonico text
);

-- ---------------------------------------------------------------------------
-- 4. Telemetria — leituras canônicas normalizadas
-- ---------------------------------------------------------------------------

create table leituras_telemetria (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references veiculos(id),
  motorista_id uuid references motoristas(id),
  timestamp_leitura timestamptz not null,
  origem_fabricante text not null default 'maxtrack',
  capacidade text not null check (capacidade in ('com_can','sem_can')),
  latitude numeric,
  longitude numeric,
  precisao_posicao_m numeric,
  velocidade_kmh numeric,
  rpm numeric,
  odometro_km numeric,
  em_movimento boolean,
  motor_ligado boolean, -- pode ser nulo quando o pacote não confirma (ver conflito moving/engineOn documentado no CLAUDE.md)
  dado_indisponivel boolean not null default false,
  indicadores_brutos jsonb not null default '{}'::jsonb, -- {rpmZone, inertiaUsage, iddleTime, accelerationExcess, throttleAgregation, global}
  consumo_bruto numeric, -- valor cru do sensor; unidade não confirmada, nunca converter
  pacote_bruto jsonb, -- payload original completo, para auditoria/depuração
  criado_em timestamptz not null default now(),

  constraint latitude_valida check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint longitude_valida check (longitude is null or (longitude >= -180 and longitude <= 180))
);

create index leituras_telemetria_veiculo_ts on leituras_telemetria (veiculo_id, timestamp_leitura desc);
create index leituras_telemetria_motorista_ts on leituras_telemetria (motorista_id, timestamp_leitura desc);

-- correções do Master Drive sobre um campo específico de uma leitura,
-- preservando o valor anterior (nunca sobrescreve destrutivamente)
create table correcoes_leitura (
  id uuid primary key default gen_random_uuid(),
  leitura_id uuid not null references leituras_telemetria(id) on delete cascade,
  campo text not null, -- ex.: 'rpmZone', dentro de indicadores_brutos
  valor_anterior numeric,
  valor_novo numeric not null,
  motivo text not null,
  corrigido_por uuid not null references usuarios(id),
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Apuração — execuções e resultados
-- ---------------------------------------------------------------------------

create table execucoes_apuracao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  versao_config_id uuid not null references versoes_config(id),
  escopo text not null check (escopo in ('geral','motorista_pontual')),
  motorista_id uuid references motoristas(id), -- preenchido só quando escopo = motorista_pontual
  periodo_inicio date not null,
  periodo_fim date not null,
  modo text not null check (modo in ('simulacao','aplicada')),
  motivo text,
  lote_pagamento_id uuid, -- reservado para quando a integração de folha entrar em escopo; nulo por enquanto
  executado_por uuid references usuarios(id),
  executado_em timestamptz not null default now()
);

-- append-only por design: nenhuma role de aplicação deve ter GRANT UPDATE/DELETE aqui
create table resultados_motorista (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references execucoes_apuracao(id) on delete cascade,
  motorista_id uuid not null references motoristas(id),
  nota_final numeric,
  cobertura_pct numeric,
  elegivel boolean not null,
  motivo_inelegibilidade text,
  faixa_rotulo text,
  detalhe jsonb not null default '[]'::jsonb, -- [{indicador, valor, nota, peso, pontos, entrou}]
  vigente boolean not null default false, -- true = é o resultado oficialmente publicado para este motorista/período
  criado_em timestamptz not null default now()
);

create index resultados_motorista_vigente
  on resultados_motorista (motorista_id)
  where vigente;

-- ---------------------------------------------------------------------------
-- 6. Master Drive — atendimentos (não confundir com contestação)
-- ---------------------------------------------------------------------------

create table atendimentos_master_drive (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references motoristas(id),
  master_drive_usuario_id uuid not null references usuarios(id),
  indicador_mnemonico text, -- opcional, nulo = atendimento geral
  resumo text not null,
  resultado text not null check (resultado in ('sem_acao','orientacao_registrada','correcao_de_dado')),
  correcao_id uuid references correcoes_leitura(id), -- preenchido quando resultado = correcao_de_dado
  execucao_gerada_id uuid references execucoes_apuracao(id), -- recálculo pontual disparado, se houver
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. LGPD
-- ---------------------------------------------------------------------------

create table consentimentos_lgpd (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references motoristas(id) on delete cascade,
  finalidade text not null, -- ex.: 'seguranca_patrimonial', 'apuracao_premiacao', 'manutencao_preditiva'
  base_legal text not null check (base_legal in ('legitimo_interesse','consentimento')),
  concedido_em timestamptz,
  revogado_em timestamptz,
  criado_em timestamptz not null default now()
);

create table solicitacoes_titular (
  id uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references motoristas(id),
  tipo text not null check (tipo in ('acesso','correcao','exclusao')),
  descricao text,
  status text not null default 'aberta' check (status in ('aberta','em_andamento','concluida')),
  prazo_legal date, -- calculado na aplicação conforme a LGPD
  criado_em timestamptz not null default now(),
  concluida_em timestamptz
);

-- ---------------------------------------------------------------------------
-- 8. Auditoria — append-only
-- ---------------------------------------------------------------------------

create table log_auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario_id uuid references usuarios(id),
  tabela_afetada text not null,
  registro_id uuid,
  acao text not null check (acao in ('criacao','atualizacao','exclusao')),
  valor_antes jsonb,
  valor_depois jsonb,
  criado_em timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table empresas enable row level security;
alter table unidades enable row level security;
alter table veiculos enable row level security;
alter table motoristas enable row level security;
alter table alocacoes_motorista_veiculo enable row level security;
alter table usuarios enable row level security;
alter table master_drive_escopos enable row level security;
alter table versoes_config enable row level security;
alter table indicadores enable row level security;
alter table faixas_nota enable row level security;
alter table faixas_classificacao enable row level security;
alter table regras_apuracao enable row level security;
alter table leituras_telemetria enable row level security;
alter table correcoes_leitura enable row level security;
alter table execucoes_apuracao enable row level security;
alter table resultados_motorista enable row level security;
alter table atendimentos_master_drive enable row level security;
alter table consentimentos_lgpd enable row level security;
alter table solicitacoes_titular enable row level security;
alter table log_auditoria enable row level security;

-- helper: papel e empresa do usuário autenticado
create or replace function auth_papel() returns text
language sql stable as $$
  select papel from usuarios where id = auth.uid()
$$;

create or replace function auth_empresa_id() returns uuid
language sql stable as $$
  select empresa_id from usuarios where id = auth.uid()
$$;

-- leitura geral por empresa (gestor, admin_gamificacao, rh, auditoria)
create policy leitura_por_empresa on motoristas for select
  using (empresa_id = auth_empresa_id());

create policy leitura_por_empresa on veiculos for select
  using (empresa_id = auth_empresa_id());

create policy leitura_resultados on resultados_motorista for select
  using (exists (
    select 1 from motoristas m where m.id = resultados_motorista.motorista_id and m.empresa_id = auth_empresa_id()
  ));

-- indicadores e versoes_config: leitura para todos os papéis da empresa, escrita só admin_gamificacao
create policy leitura_config on indicadores for select
  using (exists (
    select 1 from versoes_config v where v.id = indicadores.versao_config_id and v.empresa_id = auth_empresa_id()
  ));

create policy escrita_config on indicadores for all
  using (auth_papel() = 'admin_gamificacao' and exists (
    select 1 from versoes_config v where v.id = indicadores.versao_config_id and v.empresa_id = auth_empresa_id()
  ))
  with check (auth_papel() = 'admin_gamificacao');

-- atendimentos_master_drive: master_drive grava só dentro do próprio escopo; gestor só lê
create policy leitura_atendimentos on atendimentos_master_drive for select
  using (exists (
    select 1 from motoristas m where m.id = atendimentos_master_drive.motorista_id and m.empresa_id = auth_empresa_id()
  ));

create policy escrita_atendimentos on atendimentos_master_drive for insert
  with check (
    auth_papel() = 'master_drive'
    and exists (
      select 1
      from motoristas m
      join master_drive_escopos e on e.usuario_id = auth.uid() and e.ativo
      where m.id = atendimentos_master_drive.motorista_id
        and m.empresa_id = e.empresa_id
    )
  );

-- log_auditoria: leitura só para auditoria/admin; nenhum papel tem update/delete (nem política criada para isso)
create policy leitura_auditoria on log_auditoria for select
  using (auth_papel() in ('auditoria','admin_gamificacao') and empresa_id = auth_empresa_id());

create policy escrita_auditoria on log_auditoria for insert
  with check (empresa_id = auth_empresa_id());

-- ============================================================================
-- View de motoristas com CPF mascarado — usar esta view nas rotas de API
-- consumidas pelo frontend de Gestor/Master Drive; nunca expor a tabela
-- motoristas crua para esses papéis.
-- ============================================================================

create view motoristas_publico as
select
  id, empresa_id, nome, matricula, ativo, criado_em,
  case
    when cpf is null then null
    else regexp_replace(cpf, '(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})', '\1.***.**\2')
  end as cpf_mascarado
from motoristas;
