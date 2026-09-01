-- Immutable, owner-visible publications for canonical stages 1-7.
--
-- These rows are deliberately separate from workflow_run_artifacts. That older table
-- is mutable claim-token staging selected only after Stage 8; reusing it would either
-- hide completed stages after a later failure or let recovery overwrite already
-- published bytes. A stage publication is append-once and remains available whatever
-- terminal outcome a later stage reaches. This migration performs no historical
-- backfill and therefore does not mutate any existing run.

create table if not exists workflow_stage_publications (
  run_id text not null references runs(id) on delete restrict,
  stage_id text not null,
  stage_ordinal int not null check (stage_ordinal between 1 and 7),
  stage_title text not null check (char_length(trim(stage_title)) > 0),
  completed_at timestamptz not null,
  published_at timestamptz not null default now(),
  stage_manifest_sha256 text not null check (stage_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  input_snapshot_sha256 text not null check (input_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_count int not null check (artifact_count > 0),
  workflow_id text not null,
  workflow_version text not null,
  workflow_contract_sha256 text not null check (
    workflow_contract_sha256 ~ '^[a-f0-9]{64}$'
  ),
  damm_model_version text not null,
  damm_model_revision int not null check (damm_model_revision > 0),
  damm_model_sha256 text not null check (damm_model_sha256 ~ '^[a-f0-9]{64}$'),
  damm_source_commit text not null check (damm_source_commit ~ '^[a-f0-9]{40}$'),
  primary key (run_id, stage_id),
  unique (run_id, stage_ordinal),
  unique (run_id, stage_id, stage_manifest_sha256)
);

create table if not exists workflow_stage_artifacts (
  run_id text not null,
  stage_id text not null,
  artifact_id text not null check (artifact_id ~ '^[a-f0-9]{64}$'),
  artifact_key text not null check (char_length(trim(artifact_key)) > 0),
  relative_path text not null check (char_length(trim(relative_path)) > 0),
  filename text not null check (char_length(trim(filename)) > 0),
  content_type text not null check (char_length(trim(content_type)) > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  content_verified_at timestamptz not null default now(),
  content bytea not null,
  created_at timestamptz not null default now(),
  primary key (run_id, artifact_id),
  unique (run_id, stage_id, artifact_key, relative_path),
  foreign key (run_id, stage_id)
    references workflow_stage_publications(run_id, stage_id)
    on delete restrict
);

create index if not exists workflow_stage_artifacts_catalog_idx
  on workflow_stage_artifacts (run_id, stage_id, artifact_key);

create or replace function reject_completed_stage_publication_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Completed stage artifacts are immutable.' using errcode = '55000';
end;
$$;

drop trigger if exists completed_stage_publications_immutable on workflow_stage_publications;
create trigger completed_stage_publications_immutable
before update or delete on workflow_stage_publications
for each row execute function reject_completed_stage_publication_mutation();

drop trigger if exists completed_stage_artifacts_immutable on workflow_stage_artifacts;
create trigger completed_stage_artifacts_immutable
before update or delete on workflow_stage_artifacts
for each row execute function reject_completed_stage_publication_mutation();

-- Publication and its declared artifact set are one append-only transaction. The
-- row lock serializes concurrent inserts; once artifact_count rows exist, even a
-- direct SQL client cannot append another byte record to the verified publication.
create or replace function reject_completed_stage_artifact_overflow()
returns trigger
language plpgsql
as $$
declare
  declared_count int;
  existing_count int;
begin
  select artifact_count into declared_count
    from workflow_stage_publications
   where run_id = new.run_id and stage_id = new.stage_id
   for update;
  if declared_count is null then
    raise exception 'Completed stage publication is missing.' using errcode = '23503';
  end if;
  select count(*) into existing_count
    from workflow_stage_artifacts
   where run_id = new.run_id and stage_id = new.stage_id;
  if existing_count >= declared_count then
    raise exception 'Completed stage artifacts are immutable; the declared set is sealed.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists completed_stage_artifact_count_guard on workflow_stage_artifacts;
create trigger completed_stage_artifact_count_guard
before insert on workflow_stage_artifacts
for each row execute function reject_completed_stage_artifact_overflow();

-- Deferred validation lets the application insert the publication first (for its
-- foreign key) and then its exact artifacts in the same transaction, but rejects
-- any incomplete publication at commit.
create or replace function assert_completed_stage_publication_complete()
returns trigger
language plpgsql
as $$
declare
  actual_count int;
begin
  select count(*) into actual_count
    from workflow_stage_artifacts
   where run_id = new.run_id and stage_id = new.stage_id;
  if actual_count <> new.artifact_count then
    raise exception 'Completed stage publication must contain exactly % artifacts; found %.',
      new.artifact_count, actual_count using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists completed_stage_publication_complete on workflow_stage_publications;
create constraint trigger completed_stage_publication_complete
after insert on workflow_stage_publications
deferrable initially deferred
for each row execute function assert_completed_stage_publication_complete();
