-- Canonical workflow launch integrity.
--
alter table runs add column if not exists claim_token text;

-- A completed workflow publishes one immutable, verified artifact set. The token is
-- assigned only by the finishing worker while it still owns the claim; web hosts never
-- need access to the worker filesystem.
alter table runs add column if not exists workflow_artifact_set_id text;

-- Preserve the source file as well as its canonical UTF-8 extraction. These columns are
-- nullable only for uploads created before this migration; canonical launch rejects an
-- incomplete provenance record and asks for a pre-launch re-upload.
alter table uploads add column if not exists source_content bytea;
alter table uploads add column if not exists source_sha256 text;
alter table uploads add column if not exists source_byte_size bigint;
alter table uploads add column if not exists uploaded_by text;
alter table uploads add column if not exists extraction_status text;

alter table uploads drop constraint if exists uploads_source_sha256_shape;
alter table uploads add constraint uploads_source_sha256_shape
  check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$');
alter table uploads drop constraint if exists uploads_source_byte_size_nonnegative;
alter table uploads add constraint uploads_source_byte_size_nonnegative
  check (source_byte_size is null or source_byte_size >= 0);

-- The application performs a friendly preflight check, but only a database constraint
-- closes the race between two simultaneous launch requests.
create unique index if not exists runs_one_active_workflow_per_country
  on runs (country_id)
  where pass = 'workflow'
    and status not in ('done', 'failed', 'cancelled');

create table if not exists workflow_run_artifacts (
  run_id text not null references runs(id) on delete cascade,
  artifact_set_id text not null,
  artifact_key text not null,
  relative_path text not null,
  filename text not null,
  content_type text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  workflow_id text not null,
  workflow_version text not null,
  workflow_contract_sha256 text not null check (
    workflow_contract_sha256 ~ '^[a-f0-9]{64}$'
  ),
  content bytea not null,
  created_at timestamptz not null default now(),
  primary key (run_id, artifact_set_id, artifact_key),
  unique (run_id, artifact_set_id, relative_path)
);

create index if not exists workflow_run_artifacts_published_idx
  on workflow_run_artifacts (run_id, artifact_set_id);

-- Immutable launch-time copy. Source bytes live in rows fetched only by the claiming
-- worker, never in `runs` (which powers portfolio/list/claim queries).
create table if not exists workflow_run_uploads (
  run_id text not null references runs(id) on delete cascade,
  ordinal int not null check (ordinal > 0),
  upload_id text not null,
  kind text not null,
  filename text not null,
  mime text not null,
  chars int not null check (chars >= 0),
  content text not null,
  uploaded_at timestamptz not null,
  source_content bytea not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_byte_size bigint not null check (source_byte_size >= 0),
  uploaded_by text not null,
  extraction_status text not null check (extraction_status = 'extracted'),
  primary key (run_id, ordinal),
  unique (run_id, upload_id)
);

-- Human review is deliberately downstream of the autonomous run. Every review is bound
-- to the exact immutable artifact set and complete-bundle digest it assessed.
create table if not exists workflow_run_reviews (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  artifact_set_id text not null,
  bundle_sha256 text not null check (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  reviewer_id text not null,
  outcome text not null check (outcome in ('reviewed', 'revisions_required')),
  notes text not null default '' check (char_length(notes) <= 5000),
  reviewed_at timestamptz not null default now()
);

create index if not exists workflow_run_reviews_run_idx
  on workflow_run_reviews (run_id, artifact_set_id, reviewed_at desc);
