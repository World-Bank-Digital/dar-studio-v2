create table if not exists countries (
  id text primary key,
  user_id text not null,
  name text not null,
  iso3 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  current_step int not null default 1,
  step1_completed_at timestamptz,
  ingest_status text not null default 'idle',
  ingest_progress int not null default 0,
  ingest_total int not null default 0,
  ingest_message text,
  cms double precision,
  ems double precision,
  oes double precision,
  cms_coverage double precision,
  ems_coverage double precision,
  oes_coverage double precision,
  stage_code text,
  stage_label text,
  levelled_count int not null default 0,
  imported_count int not null default 0,
  named_gap_count int not null default 0,
  stale_count int not null default 0,
  validated_count int not null default 0,
  core_unmeasured int not null default 0,
  core_failures int not null default 0,
  deleted_at timestamptz
);

create index if not exists countries_user_idx on countries (user_id) where deleted_at is null;

create table if not exists evidence (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  indicator_id text not null,
  value double precision,
  observation_year int,
  source_name text,
  source_url text,
  confidence text,
  provenance text,
  is_proxy boolean not null default false,
  proxy_note text,
  data_gap boolean not null default false,
  gap_steward text,
  gap_source text,
  suggested_level int,
  assessor_level int,
  assessor_role text,
  assessor_name text,
  assessed_at timestamptz,
  notes text,
  unique (country_id, indicator_id)
);

create index if not exists evidence_country_idx on evidence (country_id);

create table if not exists decisions (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  step int not null,
  option_name text not null,
  decider_name text not null,
  role text not null,
  notes text,
  rejected text,
  payload text,
  created_at timestamptz not null default now(),
  unique (country_id, step)
);

create table if not exists audit (
  id text primary key,
  user_id text not null,
  country_id text,
  at timestamptz not null default now(),
  role text not null,
  actor_name text not null,
  action text not null,
  detail text
);

create index if not exists audit_country_idx on audit (country_id, at desc);

create table if not exists drafts (
  id text primary key,
  user_id text not null,
  country_id text not null,
  kind text not null,
  chapter text,
  body text not null,
  model_name text,
  drafted_at timestamptz not null default now()
);

create table if not exists api_keys (
  id text primary key,
  user_id text not null,
  provider text not null,
  key_value text not null,
  fingerprint text not null,
  last4 text not null,
  model_name text not null,
  created_at timestamptz not null default now(),
  last_tested_at timestamptz,
  last_test_ok boolean
);

create table if not exists user_settings (
  user_id text primary key,
  active_provider text,
  acting_role text not null default 'TTL',
  actor_name text
);

create table if not exists targeting (
  country_id text primary key,
  user_id text not null,
  chains text,
  rejected text,
  notes text
);
