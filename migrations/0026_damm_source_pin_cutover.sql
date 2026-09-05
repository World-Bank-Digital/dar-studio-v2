-- Cut active workflows and new approval packages over to the reviewed DAMM source
-- revision with bounded Jina source fallback, conservative malformed-response
-- settlement, durable no-replay outcomes, and safe workflow diagnostics.
-- Existing terminal Draft packages and their immutable approval records remain untouched.

-- Serialize the deployment boundary against launch/update transactions. A workflow
-- pinned to the preceding source revision must finish end to end under that revision;
-- the migration can then be retried without rewriting or terminating the run.
lock table runs in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from runs workflow_run
    left join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
    where workflow_run.pass = 'workflow'
      and workflow_run.status not in ('done', 'failed', 'cancelled')
      and (
        methodology.run_id is null
        or methodology.manifest_schema_version is distinct from 'damm.model-export/v1'
        or methodology.model_id is distinct from 'DAMM'
        or methodology.model_version is distinct from '1.7'
        or methodology.model_revision is distinct from 2
        or methodology.model_status is distinct from 'draft for review'
        or methodology.model_ratified is distinct from false
        or methodology.app_model_sha256 is distinct from '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
        or methodology.app_model_schema_sha256 is distinct from '5c90d9ed67b18e128f0aae2cf60efd3de8cf0573868b71fcbe605a2f7b579463'
        or methodology.source_repository is distinct from 'https://github.com/World-Bank-Digital/DAMM'
        or methodology.source_commit is distinct from 'd708dbd0129cfb7f37dcf003875c439367b7c97d'
        or methodology.source_model_path is distinct from 'model/DAMM-v1.7-model.json'
        or methodology.source_model_sha256 is distinct from '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
        or methodology.source_schema_path is distinct from 'model/DAMM-v1.7-model.schema.json'
        or methodology.source_schema_sha256 is distinct from '20abd0d06355d7426610158cc5c799b17229e00defff0ebb35044c18c946df93'
        or methodology.census_revision is distinct from 'DAMM-v1.7-r2'
        or methodology.census_path is distinct from 'generated:model_v1_7.json#indicators'
        or methodology.census_sha256 is distinct from 'f42b21112ae383aabb40c71331ee4c0071f6b5aed99aba747a7087e3db3eaac1'
        or methodology.engine_version is distinct from '1.7'
        or methodology.engine_path is distinct from 'gauntlet/loop-1/engine_v17.py'
        or methodology.engine_sha256 is distinct from '8a133af8653e9933c14b09b2897aa89be4dedc18446d9395f021a12183e27062'
        or methodology.renderer_version is distinct from '1.7'
        or methodology.renderer_path is distinct from 'gauntlet/loop-1/render_v17.py'
        or methodology.renderer_sha256 is distinct from '95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be'
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Cannot install the current DAMM source pin while stale or missing-pin workflows are active; allow them to finish and retry the deployment.';
  end if;
end;
$$;

-- Close the rolling-deployment window after this migration commits. Older app
-- processes may still try to launch with the preceding pin; the deferred check sees
-- the complete launch transaction and rejects it instead of leaving an unexecutable run.
-- Terminal historical rows already present at cutover remain untouched, but a caller
-- cannot manufacture one afterward or turn a failed/cancelled historical run into a
-- newly publishable completed workflow.
create or replace function require_active_workflow_methodology()
returns trigger
language plpgsql
as $$
begin
  if new.pass = 'workflow'
     and (
       tg_op = 'INSERT'
       or new.status not in ('done', 'failed', 'cancelled')
       or (
         tg_op = 'UPDATE'
         and (
           old.pass is distinct from 'workflow'
           or (old.status is distinct from 'done' and new.status = 'done')
         )
       )
     )
     and not exists (
       select 1
       from workflow_run_methodology methodology
       where methodology.run_id = new.id
         and methodology.manifest_schema_version = 'damm.model-export/v1'
         and methodology.model_id = 'DAMM'
         and methodology.model_version = '1.7'
         and methodology.model_revision = 2
         and methodology.model_status = 'draft for review'
         and methodology.model_ratified = false
         and methodology.app_model_sha256 = '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
         and methodology.app_model_schema_sha256 = '5c90d9ed67b18e128f0aae2cf60efd3de8cf0573868b71fcbe605a2f7b579463'
         and methodology.source_repository = 'https://github.com/World-Bank-Digital/DAMM'
         and methodology.source_commit = 'd708dbd0129cfb7f37dcf003875c439367b7c97d'
         and methodology.source_model_path = 'model/DAMM-v1.7-model.json'
         and methodology.source_model_sha256 = '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
         and methodology.source_schema_path = 'model/DAMM-v1.7-model.schema.json'
         and methodology.source_schema_sha256 = '20abd0d06355d7426610158cc5c799b17229e00defff0ebb35044c18c946df93'
         and methodology.census_revision = 'DAMM-v1.7-r2'
         and methodology.census_path = 'generated:model_v1_7.json#indicators'
         and methodology.census_sha256 = 'f42b21112ae383aabb40c71331ee4c0071f6b5aed99aba747a7087e3db3eaac1'
         and methodology.engine_version = '1.7'
         and methodology.engine_path = 'gauntlet/loop-1/engine_v17.py'
         and methodology.engine_sha256 = '8a133af8653e9933c14b09b2897aa89be4dedc18446d9395f021a12183e27062'
         and methodology.renderer_version = '1.7'
         and methodology.renderer_path = 'gauntlet/loop-1/render_v17.py'
         and methodology.renderer_sha256 = '95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be'
     ) then
    raise exception 'A new, active, or newly completed workflow run requires the current DAMM methodology pin.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Methodology is a launch snapshot, not metadata that may be retrofitted after a
-- workflow has stopped. This also closes an upgrade edge for legacy terminal rows
-- that predate methodology capture: they remain honest historical records and cannot
-- be given the new pin later to make them appear canonically completed.
create or replace function require_workflow_launch_for_methodology_insert()
returns trigger
language plpgsql
as $$
declare
  workflow_pass text;
  workflow_status text;
begin
  select pass, status into workflow_pass, workflow_status
  from runs
  where id = new.run_id;

  if workflow_pass is distinct from 'workflow'
     or workflow_status in ('done', 'failed', 'cancelled') then
    raise exception 'The current DAMM methodology pin is an append-once launch snapshot and cannot be inserted for a non-workflow or terminal workflow run.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_methodology_requires_active_launch on workflow_run_methodology;
create trigger workflow_methodology_requires_active_launch
before insert on workflow_run_methodology
for each row execute function require_workflow_launch_for_methodology_insert();

-- Application state transitions already treat done, failed, and cancelled as final.
-- Enforce that invariant in Postgres so a legacy terminal row cannot be moved through
-- a temporary active state, retrofitted with the new pin, and then promoted to done.
create or replace function reject_terminal_workflow_reactivation()
returns trigger
language plpgsql
as $$
begin
  if old.pass = 'workflow'
     and old.status in ('done', 'failed', 'cancelled')
     and (
       new.pass is distinct from old.pass
       or new.status is distinct from old.status
     ) then
    raise exception 'Terminal workflow status and pass are immutable.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists terminal_workflow_status_immutable on runs;
create trigger terminal_workflow_status_immutable
before update on runs
for each row execute function reject_terminal_workflow_reactivation();

-- Replace the insert-time canonical allowlist without mutating any package, decision,
-- assignment, or release that was already materialized under its immutable identity.
create or replace function validate_approval_package_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_at := transaction_timestamp();
  if new.owner_user_id = 'dev-user' then
    raise exception 'human approval requires a registered authenticated user'
      using errcode = '28000';
  end if;

  -- Keep the selected publication pointer and every artifact row stable through the
  -- insert-time attestation and the deferred row/target recomputation at commit. The
  -- fixed ordering prevents two materializers from taking set locks in opposite order.
  perform workflow_run.id
  from runs workflow_run
  where workflow_run.id = new.run_id
  for share;
  perform artifact.artifact_key
  from workflow_run_artifacts artifact
  where artifact.run_id = new.run_id
    and artifact.artifact_set_id = new.artifact_set_id
  order by artifact.artifact_key
  for share;

  perform 1
  from runs workflow_run
  join countries country
    on country.id = workflow_run.country_id
   and country.id = new.country_id
   and country.user_id = new.owner_user_id
   and country.deleted_at is null
  join "user" owner_user
    on owner_user."id" = new.owner_user_id
   and owner_user."id" <> 'dev-user'
  join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
  join workflow_run_artifacts bundle
    on bundle.run_id = workflow_run.id
   and bundle.artifact_set_id = workflow_run.workflow_artifact_set_id
   and bundle.artifact_key = new.bundle_artifact_key
  join workflow_run_artifacts observations
    on observations.run_id = workflow_run.id
   and observations.artifact_set_id = workflow_run.workflow_artifact_set_id
   and observations.artifact_key = new.observations_artifact_key
  join workflow_run_artifacts assessment_input
    on assessment_input.run_id = workflow_run.id
   and assessment_input.artifact_set_id = workflow_run.workflow_artifact_set_id
   and assessment_input.artifact_key = new.assessment_input_artifact_key
  where workflow_run.id = new.run_id
    and workflow_run.user_id = new.owner_user_id
    and workflow_run.pass = 'workflow'
    and workflow_run.status = 'done'
    and workflow_run.workflow_artifact_set_id = new.artifact_set_id
    and workflow_run.finished_at = new.completed_at
    and bundle.sha256 = new.bundle_sha256
    and observations.sha256 = new.observations_sha256
    and assessment_input.sha256 = new.assessment_input_sha256
    and assessment_input.relative_path = new.assessment_input_source_path
    and bundle.content_verified_at is not null
    and observations.content_verified_at is not null
    and assessment_input.content_verified_at is not null
    and bundle.byte_size = octet_length(bundle.content)
    and observations.byte_size = octet_length(observations.content)
    and assessment_input.byte_size = octet_length(assessment_input.content)
    and bundle.sha256 = encode(sha256(bundle.content), 'hex')
    and observations.sha256 = encode(sha256(observations.content), 'hex')
    and assessment_input.sha256 = encode(sha256(assessment_input.content), 'hex')
    and bundle.workflow_id = new.workflow_id
    and observations.workflow_id = new.workflow_id
    and assessment_input.workflow_id = new.workflow_id
    and bundle.workflow_version = new.workflow_version
    and observations.workflow_version = new.workflow_version
    and assessment_input.workflow_version = new.workflow_version
    and bundle.workflow_contract_sha256 = new.workflow_contract_sha256
    and observations.workflow_contract_sha256 = new.workflow_contract_sha256
    and assessment_input.workflow_contract_sha256 = new.workflow_contract_sha256
    and bundle.assessment_input_sha256 = new.assessment_input_sha256
    and observations.assessment_input_sha256 = new.assessment_input_sha256
    and assessment_input.assessment_input_sha256 = new.assessment_input_sha256
    and bundle.damm_model_version = new.damm_model_version
    and observations.damm_model_version = new.damm_model_version
    and assessment_input.damm_model_version = new.damm_model_version
    and bundle.damm_model_revision = new.damm_model_revision
    and observations.damm_model_revision = new.damm_model_revision
    and assessment_input.damm_model_revision = new.damm_model_revision
    and bundle.damm_model_sha256 = new.damm_model_sha256
    and observations.damm_model_sha256 = new.damm_model_sha256
    and assessment_input.damm_model_sha256 = new.damm_model_sha256
    and bundle.damm_source_commit = new.damm_source_commit
    and observations.damm_source_commit = new.damm_source_commit
    and assessment_input.damm_source_commit = new.damm_source_commit
    and methodology.manifest_schema_version = new.manifest_schema_version
    and methodology.model_id = new.damm_model_id
    and methodology.model_version = new.damm_model_version
    and methodology.model_revision = new.damm_model_revision
    and methodology.model_status = new.damm_model_status
    and methodology.model_ratified = new.damm_model_ratified
    and methodology.app_model_sha256 = new.damm_model_sha256
    and methodology.app_model_schema_sha256 = new.damm_model_schema_sha256
    and methodology.source_repository = new.damm_source_repository
    and methodology.source_commit = new.damm_source_commit
    and methodology.source_model_path = new.damm_source_model_path
    and methodology.source_model_sha256 = new.damm_source_model_sha256
    and methodology.source_schema_path = new.damm_source_schema_path
    and methodology.source_schema_sha256 = new.damm_source_schema_sha256
    and methodology.census_revision = new.census_revision
    and methodology.census_path = new.census_path
    and methodology.census_sha256 = new.census_sha256
    and methodology.engine_version = new.engine_version
    and methodology.engine_path = new.engine_path
    and methodology.engine_sha256 = new.engine_sha256
    and methodology.renderer_version = new.renderer_version
    and methodology.renderer_path = new.renderer_path
    and methodology.renderer_sha256 = new.renderer_sha256
    -- This remains a draft, unratified DAMM identity. The cutover updates source/runtime
    -- provenance only; it does not claim methodological ratification.
    and new.workflow_id = 'dar-canonical-v1'
    and new.workflow_version = '1.0.0'
    and new.workflow_contract_sha256 = '5ed40dece48f24e60cbca00bcf1a9c75616ca03e7bcc5ee502dcc5b5ed1d82ba'
    and new.manifest_schema_version = 'damm.model-export/v1'
    and new.damm_model_id = 'DAMM'
    and new.damm_model_version = '1.7'
    and new.damm_model_revision = 2
    and new.damm_model_status = 'draft for review'
    and new.damm_model_ratified = false
    and new.damm_model_sha256 = '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
    and new.damm_model_schema_sha256 = '5c90d9ed67b18e128f0aae2cf60efd3de8cf0573868b71fcbe605a2f7b579463'
    and new.damm_source_repository = 'https://github.com/World-Bank-Digital/DAMM'
    and new.damm_source_commit = 'd708dbd0129cfb7f37dcf003875c439367b7c97d'
    and new.damm_source_model_path = 'model/DAMM-v1.7-model.json'
    and new.damm_source_model_sha256 = '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
    and new.damm_source_schema_path = 'model/DAMM-v1.7-model.schema.json'
    and new.damm_source_schema_sha256 = '20abd0d06355d7426610158cc5c799b17229e00defff0ebb35044c18c946df93'
    and new.census_revision = 'DAMM-v1.7-r2'
    and new.census_path = 'generated:model_v1_7.json#indicators'
    and new.census_sha256 = 'f42b21112ae383aabb40c71331ee4c0071f6b5aed99aba747a7087e3db3eaac1'
    and new.engine_version = '1.7'
    and new.engine_path = 'gauntlet/loop-1/engine_v17.py'
    and new.engine_sha256 = '8a133af8653e9933c14b09b2897aa89be4dedc18446d9395f021a12183e27062'
    and new.renderer_version = '1.7'
    and new.renderer_path = 'gauntlet/loop-1/render_v17.py'
    and new.renderer_sha256 = '95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be'
    -- Treat content_verified_at as an artifact-set attestation, not a three-row
    -- package hint: every stored row must still match its bytes and the same frozen
    -- workflow/methodology identity when the approval package is materialized.
    and not exists (
      select 1
      from workflow_run_artifacts artifact
      where artifact.run_id = new.run_id
        and artifact.artifact_set_id = new.artifact_set_id
        and (
          artifact.content_verified_at is null
          or artifact.byte_size is distinct from octet_length(artifact.content)
          or artifact.sha256 is distinct from encode(sha256(artifact.content), 'hex')
          or artifact.workflow_id is distinct from new.workflow_id
          or artifact.workflow_version is distinct from new.workflow_version
          or artifact.workflow_contract_sha256 is distinct from new.workflow_contract_sha256
          or artifact.damm_model_version is distinct from new.damm_model_version
          or artifact.damm_model_revision is distinct from new.damm_model_revision
          or artifact.damm_model_sha256 is distinct from new.damm_model_sha256
          or artifact.damm_source_commit is distinct from new.damm_source_commit
          or artifact.assessment_input_sha256 is distinct from new.assessment_input_sha256
        )
    )
    and not exists (
      select 1
      from unnest(array[
        'assessment-input', 'methodology-manifest', 'model-export-manifest',
        'canonical-model', 'canonical-model-schema', 'canonical-indicator-census',
        'manifest', 'events', 'package-manifest', 'bundle',
        'data-damm_diagnostic-damm_observations-json'
      ]::text[]) required(artifact_key)
      where not exists (
        select 1
        from workflow_run_artifacts artifact
        where artifact.run_id = new.run_id
          and artifact.artifact_set_id = new.artifact_set_id
          and artifact.artifact_key = required.artifact_key
      )
    );

  if not found then
    raise exception 'approval package is not an exact verified canonical published Draft'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Historical packages remain immutable audit records, but a source repin must not
-- allow their unfinished approval chains to continue under a different deployment.
-- Compare the complete package methodology identity, not only the changed source
-- commit, so neither a partial pin nor a future identity can inherit this release's
-- authority accidentally.
create or replace function approval_package_uses_current_methodology(
  input_package_id text,
  input_target_identity_sha256 text
)
returns boolean
language sql
stable
strict
as $$
  select exists (
    select 1
    from workflow_approval_packages package
    where package.id = input_package_id
      and package.target_identity_sha256 = input_target_identity_sha256
      and package.manifest_schema_version = 'damm.model-export/v1'
      and package.damm_model_id = 'DAMM'
      and package.damm_model_version = '1.7'
      and package.damm_model_revision = 2
      and package.damm_model_status = 'draft for review'
      and package.damm_model_ratified = false
      and package.damm_model_sha256 = '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
      and package.damm_model_schema_sha256 = '5c90d9ed67b18e128f0aae2cf60efd3de8cf0573868b71fcbe605a2f7b579463'
      and package.damm_source_repository = 'https://github.com/World-Bank-Digital/DAMM'
      and package.damm_source_commit = 'd708dbd0129cfb7f37dcf003875c439367b7c97d'
      and package.damm_source_model_path = 'model/DAMM-v1.7-model.json'
      and package.damm_source_model_sha256 = '043effc0c097f8daf3c62405e3e4a46ad5b1668294b6e75a8041fb632392e0d4'
      and package.damm_source_schema_path = 'model/DAMM-v1.7-model.schema.json'
      and package.damm_source_schema_sha256 = '20abd0d06355d7426610158cc5c799b17229e00defff0ebb35044c18c946df93'
      and package.census_revision = 'DAMM-v1.7-r2'
      and package.census_path = 'generated:model_v1_7.json#indicators'
      and package.census_sha256 = 'f42b21112ae383aabb40c71331ee4c0071f6b5aed99aba747a7087e3db3eaac1'
      and package.engine_version = '1.7'
      and package.engine_path = 'gauntlet/loop-1/engine_v17.py'
      and package.engine_sha256 = '8a133af8653e9933c14b09b2897aa89be4dedc18446d9395f021a12183e27062'
      and package.renderer_version = '1.7'
      and package.renderer_path = 'gauntlet/loop-1/render_v17.py'
      and package.renderer_sha256 = '95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be'
  )
$$;

create or replace function require_current_approval_package_activity()
returns trigger
language plpgsql
as $$
begin
  if not approval_package_uses_current_methodology(
    new.package_id,
    new.target_identity_sha256
  ) then
    raise exception 'new approval activity requires a package with the current DAMM methodology'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_approval_assignment_current_methodology
  on workflow_approval_assignments;
create trigger workflow_approval_assignment_current_methodology
before insert on workflow_approval_assignments
for each row execute function require_current_approval_package_activity();

drop trigger if exists workflow_approval_supersession_current_methodology
  on workflow_approval_assignment_supersessions;
create trigger workflow_approval_supersession_current_methodology
before insert on workflow_approval_assignment_supersessions
for each row execute function require_current_approval_package_activity();

drop trigger if exists workflow_approval_decision_current_methodology
  on workflow_approval_decisions;
create trigger workflow_approval_decision_current_methodology
before insert on workflow_approval_decisions
for each row execute function require_current_approval_package_activity();

drop trigger if exists workflow_approval_release_current_methodology
  on workflow_approval_releases;
create trigger workflow_approval_release_current_methodology
before insert on workflow_approval_releases
for each row execute function require_current_approval_package_activity();
