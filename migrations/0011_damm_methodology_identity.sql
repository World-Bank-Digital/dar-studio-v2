-- Bind every canonical workflow run and its published artifact set to one explicit
-- DAMM model/runtime revision. Nullable artifact columns identify already-published
-- legacy rows as unverified; current code only publishes rows with a complete methodology
-- record.

-- Do not cross the methodology boundary while the prior release owns active workflow
-- runs. Failing the migration leaves both schema and runs untouched, so the prior worker
-- can finish them end to end; deployment can retry after they become terminal. The lock
-- also closes the check/install gap: an old-version launch that was waiting here resumes
-- only after the deferred invariant below exists, and its transaction is then rejected.
lock table runs in share row exclusive mode;

do $$
begin
  if exists (
    select 1 from runs
    where pass = 'workflow' and status not in ('done', 'failed', 'cancelled')
  ) then
    raise exception using
      errcode = '55000',
      message = 'Cannot install DAMM methodology identity while pre-methodology workflows are active; allow them to finish and retry the deployment.';
  end if;
end;
$$;

create table if not exists workflow_run_methodology (
  run_id text primary key references runs(id) on delete cascade,
  manifest_schema_version text not null,
  model_id text not null,
  model_version text not null,
  model_revision int not null check (model_revision > 0),
  model_status text not null,
  model_ratified boolean not null,
  app_model_sha256 text not null check (app_model_sha256 ~ '^[a-f0-9]{64}$'),
  app_model_schema_sha256 text not null check (
    app_model_schema_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_repository text not null,
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  source_model_path text not null,
  source_model_sha256 text not null check (source_model_sha256 ~ '^[a-f0-9]{64}$'),
  source_schema_path text not null,
  source_schema_sha256 text not null check (source_schema_sha256 ~ '^[a-f0-9]{64}$'),
  census_revision text not null,
  census_path text not null,
  census_sha256 text not null check (census_sha256 ~ '^[a-f0-9]{64}$'),
  engine_version text not null,
  engine_path text not null,
  engine_sha256 text not null check (engine_sha256 ~ '^[a-f0-9]{64}$'),
  renderer_version text not null,
  renderer_path text not null,
  renderer_sha256 text not null check (renderer_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

-- A run's methodology is an append-once launch snapshot. Direct mutation is forbidden;
-- deleting the parent run remains possible because the FK cascade fires after the parent
-- row is no longer visible to this trigger.
create or replace function reject_workflow_run_methodology_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from runs where id = old.run_id) then
    return old;
  end if;
  raise exception 'workflow run methodology is immutable' using errcode = '55000';
end;
$$;

drop trigger if exists workflow_run_methodology_immutable on workflow_run_methodology;
create trigger workflow_run_methodology_immutable
before update or delete on workflow_run_methodology
for each row execute function reject_workflow_run_methodology_mutation();

-- During a rolling deployment, an older app process does not know how to write the
-- methodology snapshot. Reject that launch at commit instead of allowing a queued run
-- that a new worker would later have to fail. Deferral permits the current launch CTE to
-- insert the run and its methodology in either execution order inside one transaction.
create or replace function require_active_workflow_methodology()
returns trigger
language plpgsql
as $$
begin
  if new.pass = 'workflow'
     and new.status not in ('done', 'failed', 'cancelled')
     and not exists (
       select 1 from workflow_run_methodology methodology
       where methodology.run_id = new.id
     ) then
    raise exception 'A nonterminal workflow run requires a launch-frozen DAMM methodology.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists active_workflow_requires_methodology on runs;
create constraint trigger active_workflow_requires_methodology
after insert or update on runs
deferrable initially deferred
for each row execute function require_active_workflow_methodology();

alter table workflow_run_artifacts add column if not exists damm_model_version text;
alter table workflow_run_artifacts add column if not exists damm_model_revision int;
alter table workflow_run_artifacts add column if not exists damm_model_sha256 text;
alter table workflow_run_artifacts add column if not exists damm_source_commit text;
alter table workflow_run_artifacts add column if not exists assessment_input_sha256 text;
alter table workflow_run_artifacts add column if not exists content_verified_at timestamptz;

alter table workflow_run_artifacts drop constraint if exists workflow_artifact_model_revision;
alter table workflow_run_artifacts add constraint workflow_artifact_model_revision
  check (damm_model_revision is null or damm_model_revision > 0);
alter table workflow_run_artifacts drop constraint if exists workflow_artifact_model_sha256;
alter table workflow_run_artifacts add constraint workflow_artifact_model_sha256
  check (damm_model_sha256 is null or damm_model_sha256 ~ '^[a-f0-9]{64}$');
alter table workflow_run_artifacts drop constraint if exists workflow_artifact_source_commit;
alter table workflow_run_artifacts add constraint workflow_artifact_source_commit
  check (damm_source_commit is null or damm_source_commit ~ '^[a-f0-9]{40}$');
alter table workflow_run_artifacts drop constraint if exists workflow_artifact_assessment_sha256;
alter table workflow_run_artifacts add constraint workflow_artifact_assessment_sha256
  check (assessment_input_sha256 is null or assessment_input_sha256 ~ '^[a-f0-9]{64}$');

-- A completed package is addressed through the selected set on its run. Freezing only
-- the child rows is insufficient: moving this pointer away, editing those rows, and
-- restoring it would make an old verification marker attest new bytes. Running workers
-- may replace a pre-completion set after stale-claim recovery; the identity freezes when
-- the workflow becomes done and visible to downloads/review.
create or replace function reject_completed_workflow_publication_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.pass = 'workflow'
     and old.status = 'done'
     and (
       new.pass is distinct from old.pass
       or new.status is distinct from old.status
       or new.workflow_artifact_set_id is distinct from old.workflow_artifact_set_id
     ) then
    raise exception 'completed workflow publication identity is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists completed_workflow_publication_immutable on runs;
create trigger completed_workflow_publication_immutable
before update on runs
for each row execute function reject_completed_workflow_publication_mutation();

-- Artifact bytes are checked by the worker before staging. Once a set is selected on
-- the run it becomes append-closed, so review metadata can trust the recorded identity
-- without pulling and hashing a bundle as large as 250 MB on every page load. Downloads
-- still hash the stored bytes before serving them.
create or replace function reject_published_workflow_artifact_mutation()
returns trigger
language plpgsql
as $$
declare
  old_is_published boolean := false;
  new_is_published boolean := false;
  verified_copy workflow_run_artifacts%rowtype;
begin
  if tg_op = 'DELETE' and not exists (select 1 from runs where id = old.run_id) then
    return old;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    old_is_published := exists (
      select 1 from runs
      where id = old.run_id and workflow_artifact_set_id = old.artifact_set_id
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_is_published := exists (
      select 1 from runs
      where id = new.run_id and workflow_artifact_set_id = new.artifact_set_id
    );
  end if;
  if old_is_published or new_is_published then
    if tg_op = 'UPDATE'
       and old.content_verified_at is null
       and new.content_verified_at is not null then
      verified_copy := old;
      verified_copy.content_verified_at := new.content_verified_at;
      if new is not distinct from verified_copy then return new; end if;
    end if;
    raise exception 'published workflow artifacts are immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists published_workflow_artifact_immutable on workflow_run_artifacts;
create trigger published_workflow_artifact_immutable
before insert or update or delete on workflow_run_artifacts
for each row execute function reject_published_workflow_artifact_mutation();
