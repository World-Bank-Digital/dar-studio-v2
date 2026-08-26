-- Post-completion human control chain for an immutable Stage 8 Draft package.
--
-- The older workflow_run_reviews table is intentionally not referenced here. Those
-- records predate named gate assignments and exact methodology/row binding, so they
-- remain informal history and can never satisfy G1, G2, or G3.

-- These columns already form the artifact primary key except for sha256. The extra
-- unique identity lets approval packages hold restrictive, exact-artifact foreign keys.
create unique index if not exists workflow_run_artifacts_exact_identity
  on workflow_run_artifacts (run_id, artifact_set_id, artifact_key, sha256);

create table if not exists workflow_approval_packages (
  id text primary key,
  run_id text not null references runs(id) on delete restrict,
  country_id text not null references countries(id) on delete restrict,
  owner_user_id text not null references "user"("id") on delete restrict,
  artifact_set_id text not null,
  bundle_artifact_key text not null default 'bundle'
    check (bundle_artifact_key = 'bundle'),
  bundle_sha256 text not null check (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  observations_artifact_key text not null
    default 'data-damm_diagnostic-damm_observations-json'
    check (observations_artifact_key = 'data-damm_diagnostic-damm_observations-json'),
  observations_sha256 text not null check (observations_sha256 ~ '^[a-f0-9]{64}$'),

  workflow_id text not null,
  workflow_version text not null,
  workflow_contract_sha256 text not null check (
    workflow_contract_sha256 ~ '^[a-f0-9]{64}$'
  ),
  manifest_schema_version text not null,
  damm_model_id text not null,
  damm_model_version text not null,
  damm_model_revision int not null check (damm_model_revision > 0),
  damm_model_status text not null,
  damm_model_ratified boolean not null,
  damm_model_sha256 text not null check (damm_model_sha256 ~ '^[a-f0-9]{64}$'),
  damm_model_schema_sha256 text not null check (
    damm_model_schema_sha256 ~ '^[a-f0-9]{64}$'
  ),
  damm_source_repository text not null,
  damm_source_commit text not null check (damm_source_commit ~ '^[a-f0-9]{40}$'),
  damm_source_model_path text not null,
  damm_source_model_sha256 text not null check (
    damm_source_model_sha256 ~ '^[a-f0-9]{64}$'
  ),
  damm_source_schema_path text not null,
  damm_source_schema_sha256 text not null check (
    damm_source_schema_sha256 ~ '^[a-f0-9]{64}$'
  ),
  census_revision text not null,
  census_path text not null,
  census_sha256 text not null check (census_sha256 ~ '^[a-f0-9]{64}$'),
  engine_version text not null,
  engine_path text not null,
  engine_sha256 text not null check (engine_sha256 ~ '^[a-f0-9]{64}$'),
  renderer_version text not null,
  renderer_path text not null,
  renderer_sha256 text not null check (renderer_sha256 ~ '^[a-f0-9]{64}$'),

  assessment_input_artifact_key text not null default 'assessment-input'
    check (assessment_input_artifact_key = 'assessment-input'),
  assessment_input_source_path text not null check (
    char_length(trim(assessment_input_source_path)) > 0
  ),
  assessment_input_sha256 text not null check (
    assessment_input_sha256 ~ '^[a-f0-9]{64}$'
  ),
  machine_row_count int not null check (machine_row_count > 0),
  machine_row_set_sha256 text not null check (
    machine_row_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  g1_scope_rows jsonb not null check (jsonb_typeof(g1_scope_rows) = 'array'),
  g1_scope_row_count int not null check (g1_scope_row_count > 0),
  g1_scope_sha256 text not null check (g1_scope_sha256 ~ '^[a-f0-9]{64}$'),
  g2_scope_rows jsonb not null check (jsonb_typeof(g2_scope_rows) = 'array'),
  g2_scope_row_count int not null check (g2_scope_row_count > 0),
  g2_scope_sha256 text not null check (g2_scope_sha256 ~ '^[a-f0-9]{64}$'),
  g2_mandatory_row_count int not null check (g2_mandatory_row_count >= 0),
  g2_remainder_row_count int not null check (g2_remainder_row_count >= 0),
  g2_sample_row_count int not null check (g2_sample_row_count >= 0),
  target_identity_sha256 text not null check (
    target_identity_sha256 ~ '^[a-f0-9]{64}$'
  ),
  completed_at timestamptz not null,
  materialized_at timestamptz,
  created_at timestamptz not null default now(),

  unique (run_id, artifact_set_id),
  unique (target_identity_sha256),
  unique (id, target_identity_sha256),
  foreign key (run_id, artifact_set_id, bundle_artifact_key, bundle_sha256)
    references workflow_run_artifacts(run_id, artifact_set_id, artifact_key, sha256)
    on delete restrict,
  foreign key (run_id, artifact_set_id, observations_artifact_key, observations_sha256)
    references workflow_run_artifacts(run_id, artifact_set_id, artifact_key, sha256)
    on delete restrict,
  foreign key (run_id, artifact_set_id, assessment_input_artifact_key, assessment_input_sha256)
    references workflow_run_artifacts(run_id, artifact_set_id, artifact_key, sha256)
    on delete restrict
);

create table if not exists workflow_approval_rows (
  package_id text not null,
  target_identity_sha256 text not null,
  ordinal int not null check (ordinal > 0),
  indicator_id text not null check (char_length(trim(indicator_id)) > 0),
  row_sha256 text not null check (row_sha256 ~ '^[a-f0-9]{64}$'),
  classification text not null check (
    classification in ('Measured', 'Documented', 'Judged', 'Gap')
  ),
  prerequisite boolean not null,
  row_payload jsonb not null check (jsonb_typeof(row_payload) = 'object'),
  primary key (package_id, indicator_id),
  unique (package_id, ordinal),
  unique (package_id, indicator_id, row_sha256),
  foreign key (package_id, target_identity_sha256)
    references workflow_approval_packages(id, target_identity_sha256)
    on delete restrict
);

create table if not exists workflow_approval_assignments (
  id text primary key,
  package_id text not null,
  target_identity_sha256 text not null,
  gate text not null check (gate in ('g1', 'g2')),
  reviewer_user_id text not null references "user"("id") on delete restrict,
  reviewer_name text not null check (char_length(trim(reviewer_name)) > 0),
  reviewer_email text not null check (char_length(trim(reviewer_email)) > 0),
  declared_role text not null check (declared_role in ('assessor', 'independent_reviewer')),
  assigned_by_user_id text not null references "user"("id") on delete restrict,
  assigned_by_name text not null check (char_length(trim(assigned_by_name)) > 0),
  assigned_by_email text not null check (char_length(trim(assigned_by_email)) > 0),
  scope_rows jsonb not null check (jsonb_typeof(scope_rows) = 'array'),
  scope_row_count int not null check (scope_row_count > 0),
  scope_sha256 text not null check (scope_sha256 ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  unique (id, active),
  unique (id, package_id, target_identity_sha256, gate, reviewer_user_id),
  foreign key (package_id, target_identity_sha256)
    references workflow_approval_packages(id, target_identity_sha256)
    on delete restrict
);

-- Remove the obsolete one-assignment-ever constraint when this unshipped migration
-- is manually replayed against a scratch database created from an earlier draft.
-- Active uniqueness is now enforced by the partial unique index below.
alter table workflow_approval_assignments
  drop constraint if exists workflow_approval_assignments_package_id_gate_key;
alter table workflow_approval_assignments
  add column if not exists active boolean not null default true;

-- Reviewer availability must not deadlock a Draft forever. Reassignment is therefore
-- represented as a separate append-only supersession record; assignment identity and
-- scope are never updated or deleted. Only its constrained operational active marker
-- changes. The successor foreign key is deferred because an atomic replacement revokes
-- the old assignment before inserting the new active assignment.
create table if not exists workflow_approval_assignment_supersessions (
  id text primary key,
  revoked_assignment_id text not null unique
    references workflow_approval_assignments(id) on delete restrict,
  superseding_assignment_id text not null unique
    references workflow_approval_assignments(id) on delete restrict
    deferrable initially deferred,
  package_id text not null,
  target_identity_sha256 text not null,
  gate text not null check (gate in ('g1', 'g2')),
  revoked_by_user_id text not null references "user"("id") on delete restrict,
  revoked_by_name text not null check (char_length(trim(revoked_by_name)) > 0),
  revoked_by_email text not null check (char_length(trim(revoked_by_email)) > 0),
  reason text not null check (
    char_length(trim(reason)) > 0 and char_length(reason) <= 5000
  ),
  revoked_at timestamptz not null default now(),
  check (revoked_assignment_id <> superseding_assignment_id),
  foreign key (package_id, target_identity_sha256)
    references workflow_approval_packages(id, target_identity_sha256)
    on delete restrict
);

create table if not exists workflow_approval_decisions (
  id text primary key,
  package_id text not null,
  target_identity_sha256 text not null,
  assignment_id text,
  assignment_was_active boolean not null default true check (assignment_was_active),
  gate text not null check (gate in ('g1', 'g2', 'g3')),
  actor_kind text not null check (actor_kind = 'human'),
  reviewer_user_id text not null references "user"("id") on delete restrict,
  reviewer_name text not null check (char_length(trim(reviewer_name)) > 0),
  reviewer_email text not null check (char_length(trim(reviewer_email)) > 0),
  declared_role text not null check (
    declared_role in ('assessor', 'independent_reviewer', 'ttl_country_owner')
  ),
  decision text not null check (decision in ('approved', 'revisions_required')),
  notes text not null default '' check (char_length(notes) <= 5000),
  reviewer_affirmation boolean not null,
  reviewer_affirmation_version text,
  reviewer_affirmation_text text,
  reviewer_affirmation_sha256 text check (
    reviewer_affirmation_sha256 is null
    or reviewer_affirmation_sha256 ~ '^[a-f0-9]{64}$'
  ),
  row_reviews jsonb not null default '[]'::jsonb check (jsonb_typeof(row_reviews) = 'array'),
  affirmations jsonb not null default '{}'::jsonb check (jsonb_typeof(affirmations) = 'object'),
  decided_at timestamptz not null default now(),
  check (
    (gate in ('g1', 'g2')
      and reviewer_affirmation_version is not null
      and reviewer_affirmation_text is not null
      and reviewer_affirmation_sha256 is not null)
    or
    (gate = 'g3'
      and reviewer_affirmation_version is null
      and reviewer_affirmation_text is null
      and reviewer_affirmation_sha256 is null)
  ),
  unique (package_id, gate),
  unique (id, package_id, target_identity_sha256, gate),
  foreign key (package_id, target_identity_sha256)
    references workflow_approval_packages(id, target_identity_sha256)
    on delete restrict,
  foreign key (assignment_id, assignment_was_active)
    references workflow_approval_assignments(id, active)
    on update restrict on delete restrict
);

create table if not exists workflow_approval_releases (
  id text primary key,
  package_id text not null,
  target_identity_sha256 text not null,
  country_id text not null references countries(id) on delete restrict,
  version_number int not null check (version_number > 0),
  lifecycle text not null check (lifecycle in ('approved_draft', 'canonical_final')),
  external_circulation_authorized boolean not null check (external_circulation_authorized),
  g1_decision_id text not null,
  g2_decision_id text not null,
  g3_decision_id text not null,
  manifest_json jsonb not null check (jsonb_typeof(manifest_json) = 'object'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (package_id),
  unique (country_id, version_number),
  foreign key (package_id, target_identity_sha256)
    references workflow_approval_packages(id, target_identity_sha256)
    on delete restrict
);

-- The release table's three decision references need three fixed gate values. SQL
-- foreign keys cannot contain constants, so a trigger below verifies all three exact
-- records and their gates.

create index if not exists workflow_approval_packages_country_idx
  on workflow_approval_packages (country_id, completed_at desc);
create index if not exists workflow_approval_assignments_reviewer_idx
  on workflow_approval_assignments (reviewer_user_id, assigned_at desc);
create unique index if not exists workflow_approval_assignments_one_active_gate_idx
  on workflow_approval_assignments (package_id, gate) where active;
create index if not exists workflow_approval_assignment_supersessions_package_idx
  on workflow_approval_assignment_supersessions (package_id, gate, revoked_at desc);
create index if not exists workflow_approval_decisions_package_idx
  on workflow_approval_decisions (package_id, decided_at);

-- The application hashes JSON after recursively sorting object keys while preserving
-- array order. jsonb equality is semantic, but jsonb's text representation does not
-- promise that same key order, so approval digests use this explicit canonical form.
-- Current approval payload keys are ASCII; C collation therefore matches JavaScript's
-- code-unit ordering exactly and avoids deployment-locale drift.
create or replace function canonical_human_approval_json_v1(input_value jsonb)
returns text
language plpgsql
immutable
strict
as $$
declare
  rendered text;
begin
  case jsonb_typeof(input_value)
    when 'object' then
      select '{' || coalesce(
        string_agg(
          to_jsonb(member.key)::text || ':' || canonical_human_approval_json_v1(member.value),
          ',' order by member.key collate "C"
        ),
        ''
      ) || '}'
      into rendered
      from jsonb_each(input_value) member;
      return rendered;
    when 'array' then
      select '[' || coalesce(
        string_agg(
          canonical_human_approval_json_v1(element.value),
          ',' order by element.ordinal
        ),
        ''
      ) || ']'
      into rendered
      from jsonb_array_elements(input_value) with ordinality element(value, ordinal);
      return rendered;
    when 'string' then
      return to_jsonb(input_value #>> '{}')::text;
    else
      -- boolean, number, and JSON null already have canonical scalar spellings.
      return input_value::text;
  end case;
end;
$$;

-- Compatibility aliases are intentionally outside the immutable identity chain.
-- Historical package schemas call the numbered function directly; a future default
-- may advance without changing v1 row, scope, target, or release digests.
create or replace function canonical_human_approval_json(input_value jsonb)
returns text
language sql
immutable
strict
as $$
  select canonical_human_approval_json_v1(input_value)
$$;

-- node-postgres exposes timestamptz values as millisecond-precision Date objects and
-- release manifests use Date#toISOString(). Keep the database reconstruction byte-for-
-- byte compatible while fixing the timezone independently of the database session.
create or replace function human_approval_js_iso_v1(input_value timestamptz)
returns text
language sql
immutable
strict
as $$
  select to_char(
    input_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

create or replace function human_approval_js_iso(input_value timestamptz)
returns text
language sql
immutable
strict
as $$
  select human_approval_js_iso_v1(input_value)
$$;

-- Approval rows are not trusted application input. Re-derive them from the exact
-- assessment-input bytes at commit using the indicator census pinned above. Returning
-- NULL distinguishes an unknown indicator from a known non-prerequisite indicator.
create or replace function human_approval_indicator_prerequisite_v1(indicator_id text)
returns boolean
language sql
immutable
strict
as $$
  select case
    when indicator_id = any(array[
      '2.1', '2.9', '3.3', '3.11', '4.1', '4.5', '4.7', '4.9', '5.5', '5.7',
      '6.14', '7.12'
    ]::text[]) then true
    when indicator_id = any(array[
      '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8',
      '2.4', '2.5', '2.7', '2.11',
      '3.1', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9', '3.10',
      '4.2', '4.3', '4.4', '4.6',
      '5.2', '5.3', '5.4', '5.8', '5.12',
      '6.1', '6.3', '6.4', '6.9', '6.12', '6.13',
      '7.2',
      '8.1', '8.2', '8.4', '8.5', '8.6', '8.9', '8.11', '8.12', '8.17'
    ]::text[]) then false
    -- The model pinned to this migration carries matching candidates beside the
    -- assessment. They remain unscored and can never gate a prerequisite, but G1
    -- still reviews every machine-filled candidate row.
    when indicator_id ~ '^(A1|C1|C2|C3|C4|E1|O1)-CAND-[A-Z0-9-]+$' then false
    else null
  end
$$;

create or replace function human_approval_indicator_prerequisite(indicator_id text)
returns boolean
language sql
immutable
strict
as $$
  select human_approval_indicator_prerequisite_v1(indicator_id)
$$;

create or replace function expected_human_approval_rows_v1(assessment_input_content bytea)
returns table (
  ordinal int,
  indicator_id text,
  row_sha256 text,
  classification text,
  prerequisite boolean,
  row_payload jsonb
)
language plpgsql
stable
strict
as $$
declare
  assessment_input jsonb;
  artifact_entry record;
  canonical_indicator_id text;
  canonical_row jsonb;
  pinned_prerequisite boolean;
  row_number int := 0;
begin
  begin
    assessment_input := convert_from(assessment_input_content, 'UTF8')::jsonb;
  exception
    when others then
      raise exception 'assessment input is not valid UTF-8 JSON'
        using errcode = '22000';
  end;
  if jsonb_typeof(assessment_input) <> 'object' then
    raise exception 'assessment input must be a JSON object'
      using errcode = '22000';
  end if;
  if exists (
    select 1
    from jsonb_each(assessment_input) entry
    group by trim(entry.key)
    having trim(entry.key) = '' or count(*) > 1
  ) then
    raise exception 'assessment input contains a blank or duplicate canonical indicator ID'
      using errcode = '22000';
  end if;

  for artifact_entry in
    select entry.key, entry.value
    from jsonb_each(assessment_input) entry
    order by entry.key collate "C"
  loop
    canonical_indicator_id := trim(artifact_entry.key);
    pinned_prerequisite := human_approval_indicator_prerequisite_v1(canonical_indicator_id);
    if pinned_prerequisite is null then
      raise exception 'assessment input contains unknown DAMM indicator %', canonical_indicator_id
        using errcode = '22000';
    end if;
    if jsonb_typeof(artifact_entry.value) <> 'object' then
      raise exception 'indicator % does not contain a machine-filled row', canonical_indicator_id
        using errcode = '22000';
    end if;
    if artifact_entry.value ? 'row' then
      canonical_row := artifact_entry.value -> 'row';
      if jsonb_typeof(canonical_row) <> 'object' then
        raise exception 'indicator % has an invalid nested machine-filled row',
          canonical_indicator_id using errcode = '22000';
      end if;
    else
      canonical_row := artifact_entry.value;
    end if;
    if not canonical_row ? 'value' then
      raise exception 'indicator % has no machine-filled observation value',
        canonical_indicator_id using errcode = '22000';
    end if;
    classification := canonical_row ->> 'cls';
    if classification is null
       or classification not in ('Measured', 'Documented', 'Judged', 'Gap') then
      raise exception 'indicator % has no valid assessment classification',
        canonical_indicator_id using errcode = '22000';
    end if;

    row_number := row_number + 1;
    ordinal := row_number;
    indicator_id := canonical_indicator_id;
    prerequisite := pinned_prerequisite;
    row_payload := canonical_row;
    row_sha256 := encode(
      sha256(
        convert_to(
          canonical_human_approval_json_v1(
            jsonb_build_object(
              'classification', classification,
              'indicator_id', indicator_id,
              'prerequisite', prerequisite,
              'row', row_payload
            )
          ),
          'UTF8'
        )
      ),
      'hex'
    );
    return next;
  end loop;
end;
$$;

create or replace function reject_human_approval_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'human approval records are append-only and immutable'
    using errcode = '55000';
end;
$$;

create or replace function restrict_approval_package_mutation()
returns trigger
language plpgsql
as $$
declare
  marker_copy workflow_approval_packages%rowtype;
begin
  if tg_op = 'UPDATE'
     and old.materialized_at is null
     and new.materialized_at is not null then
    marker_copy := old;
    marker_copy.materialized_at := new.materialized_at;
    if new is not distinct from marker_copy then return new; end if;
  end if;
  raise exception 'human approval package identity is immutable'
    using errcode = '55000';
end;
$$;

create or replace function restrict_approval_assignment_mutation()
returns trigger
language plpgsql
as $$
declare
  inactive_copy workflow_approval_assignments%rowtype;
begin
  -- A pending assignment's only permitted mutation is the false active marker
  -- written by an already-inserted immutable supersession audit record. All identity,
  -- scope, and time fields remain byte-for-byte unchanged. Decided assignments can
  -- never acquire such a record, so completed identities remain immutable.
  if tg_op = 'UPDATE' and old.active and not new.active then
    inactive_copy := old;
    inactive_copy.active := false;
    if new is not distinct from inactive_copy and exists (
      select 1
      from workflow_approval_assignment_supersessions supersession
      where supersession.revoked_assignment_id = old.id
        and supersession.package_id = old.package_id
        and supersession.target_identity_sha256 = old.target_identity_sha256
        and supersession.gate = old.gate
    ) then
      return new;
    end if;
  end if;
  raise exception 'human approval assignment identity is append-only and immutable'
    using errcode = '55000';
end;
$$;

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
    -- Issue 4 cannot elevate an arbitrary or legacy methodology snapshot. This
    -- allowlist is the exact app-pinned methodology shipped with this migration;
    -- a later genuinely ratified revision requires its own migration/version.
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
    and new.damm_source_commit = '141ebd4db7fb8ebb0d21ed64ead6aef24a7d7027'
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
    and new.renderer_sha256 = '98f2a52e0be7f54ff38095db86a3f01525527661a4e6993f7c2ee0da1d2cb9c3'
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

create or replace function validate_approval_row_insert()
returns trigger
language plpgsql
as $$
declare
  package_record workflow_approval_packages%rowtype;
  existing_count int;
begin
  select * into strict package_record
  from workflow_approval_packages
  where id = new.package_id and target_identity_sha256 = new.target_identity_sha256
  for update;

  if package_record.materialized_at is not null then
    raise exception 'approval package row materialization is closed and immutable'
      using errcode = '55000';
  end if;
  if exists (select 1 from workflow_approval_assignments where package_id = new.package_id)
     or exists (select 1 from workflow_approval_decisions where package_id = new.package_id)
     or exists (select 1 from workflow_approval_releases where package_id = new.package_id) then
    raise exception 'approval rows cannot be added after human review begins'
      using errcode = '55000';
  end if;
  select count(*)::int into existing_count
  from workflow_approval_rows where package_id = new.package_id;
  if existing_count >= package_record.machine_row_count then
    raise exception 'approval package already contains its exact machine-row count'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function require_complete_approval_package_rows()
returns trigger
language plpgsql
as $$
declare
  actual_count int;
  expected_row_count int;
  g1_actual_count int;
  g1_distinct_count int;
  g2_actual_count int;
  g2_distinct_count int;
  mandatory_count int;
  remainder_count int;
  expected_sample_count int;
  current_materialized_at timestamptz;
  assessment_input_content bytea;
  expected_machine_row_set jsonb;
  expected_g1_scope jsonb;
  expected_g2_scope jsonb;
  expected_target_identity jsonb;
  expected_digest text;
begin
  select materialized_at into current_materialized_at
  from workflow_approval_packages where id = new.id;
  if current_materialized_at is null then
    raise exception 'approval package materialization marker is required'
      using errcode = '55000';
  end if;
  select count(*)::int into actual_count
  from workflow_approval_rows row_record
  where row_record.package_id = new.id
    and row_record.target_identity_sha256 = new.target_identity_sha256;
  if actual_count <> new.machine_row_count then
    raise exception 'approval package row materialization is incomplete'
      using errcode = '55000';
  end if;

  select artifact.content into strict assessment_input_content
  from workflow_run_artifacts artifact
  where artifact.run_id = new.run_id
    and artifact.artifact_set_id = new.artifact_set_id
    and artifact.artifact_key = new.assessment_input_artifact_key
    and artifact.sha256 = new.assessment_input_sha256
  for share;

  -- Recompute every row from immutable assessment-input bytes. Merely supplying a
  -- self-consistent row hash, machine-set hash, and target hash is insufficient.
  select count(*)::int into expected_row_count
  from expected_human_approval_rows_v1(assessment_input_content);
  if expected_row_count = 0 or expected_row_count <> new.machine_row_count then
    raise exception 'machine-row count does not match the exact assessment input'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from expected_human_approval_rows_v1(assessment_input_content) expected
    left join workflow_approval_rows persisted
      on persisted.package_id = new.id
     and persisted.ordinal = expected.ordinal
    where persisted.indicator_id is null
       or persisted.target_identity_sha256 <> new.target_identity_sha256
       or persisted.indicator_id <> expected.indicator_id
       or persisted.row_sha256 <> expected.row_sha256
       or persisted.classification <> expected.classification
       or persisted.prerequisite <> expected.prerequisite
       or persisted.row_payload <> expected.row_payload
  ) then
    raise exception 'approval rows are not the exact canonical assessment-input rows'
      using errcode = '55000';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'indicatorId', expected.indicator_id,
             'rowSha256', expected.row_sha256,
             'classification', expected.classification,
             'prerequisite', expected.prerequisite
           ) order by expected.ordinal
         )
    into expected_machine_row_set
  from expected_human_approval_rows_v1(assessment_input_content) expected;
  expected_digest := encode(
    sha256(convert_to(canonical_human_approval_json_v1(expected_machine_row_set), 'UTF8')),
    'hex'
  );
  if new.machine_row_set_sha256 <> expected_digest then
    raise exception 'machine-row set digest does not match the exact assessment input'
      using errcode = '55000';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'indicatorId', expected.indicator_id,
             'rowSha256', expected.row_sha256
           ) order by expected.ordinal
         )
    into expected_g1_scope
  from expected_human_approval_rows_v1(assessment_input_content) expected;
  expected_digest := encode(
    sha256(convert_to(canonical_human_approval_json_v1(expected_g1_scope), 'UTF8')),
    'hex'
  );
  if new.g1_scope_rows <> expected_g1_scope
     or new.g1_scope_row_count <> expected_row_count
     or new.g1_scope_sha256 <> expected_digest then
    raise exception 'frozen G1 scope is not the exact complete assessment-input row set'
      using errcode = '55000';
  end if;

  select count(*)::int into mandatory_count
  from expected_human_approval_rows_v1(assessment_input_content) expected
  where expected.prerequisite or expected.classification = 'Judged';
  remainder_count := expected_row_count - mandatory_count;
  expected_sample_count := ceil(remainder_count * 0.15)::int;
  with expected_rows as (
    select * from expected_human_approval_rows_v1(assessment_input_content)
  ), sampled_remainder as (
    select expected.indicator_id,
           row_number() over (
             order by
               encode(
                 sha256(
                   convert_to(new.bundle_sha256, 'UTF8')
                   || decode('00', 'hex')
                   || convert_to(expected.indicator_id, 'UTF8')
                   || decode('00', 'hex')
                   || convert_to(expected.row_sha256, 'UTF8')
                 ),
                 'hex'
               ),
               expected.indicator_id collate "C"
           ) as sample_rank
    from expected_rows expected
    where not expected.prerequisite and expected.classification <> 'Judged'
  ), scoped_rows as (
    select expected.*,
           sampled.sample_rank is not null
             and sampled.sample_rank <= expected_sample_count as sampled
    from expected_rows expected
    left join sampled_remainder sampled on sampled.indicator_id = expected.indicator_id
    where expected.prerequisite
       or expected.classification = 'Judged'
       or sampled.sample_rank <= expected_sample_count
  )
  select jsonb_agg(
           jsonb_build_object(
             'indicatorId', scoped.indicator_id,
             'rowSha256', scoped.row_sha256,
             'reasons',
               (case when scoped.prerequisite
                 then jsonb_build_array('prerequisite') else '[]'::jsonb end)
               || (case when scoped.classification = 'Judged'
                 then jsonb_build_array('judged') else '[]'::jsonb end)
               || (case when scoped.sampled
                 then jsonb_build_array('sample') else '[]'::jsonb end)
           ) order by scoped.indicator_id collate "C"
         )
    into expected_g2_scope
  from scoped_rows scoped;
  expected_digest := encode(
    sha256(convert_to(canonical_human_approval_json_v1(expected_g2_scope), 'UTF8')),
    'hex'
  );
  if new.g2_scope_rows <> expected_g2_scope
     or new.g2_scope_row_count <> mandatory_count + expected_sample_count
     or new.g2_scope_sha256 <> expected_digest
     or new.g2_mandatory_row_count <> mandatory_count
     or new.g2_remainder_row_count <> remainder_count
     or new.g2_sample_row_count <> expected_sample_count then
    raise exception 'frozen G2 scope is not the exact deterministic protocol scope'
      using errcode = '55000';
  end if;

  expected_target_identity := jsonb_build_object(
    'schemaVersion', 'damm.approval-package/v1',
    'workflowRunId', new.run_id,
    'artifactSetId', new.artifact_set_id,
    'completeBundleSha256', new.bundle_sha256,
    'observationsArtifactKey', new.observations_artifact_key,
    'observationsSha256', new.observations_sha256,
    'workflow', jsonb_build_object(
      'id', new.workflow_id,
      'version', new.workflow_version,
      'contractSha256', new.workflow_contract_sha256
    ),
    'methodology', jsonb_build_object(
      'manifestSchemaVersion', new.manifest_schema_version,
      'modelId', new.damm_model_id,
      'modelVersion', new.damm_model_version,
      'modelRevision', new.damm_model_revision,
      'modelStatus', new.damm_model_status,
      'modelRatified', new.damm_model_ratified,
      'appModelSha256', new.damm_model_sha256,
      'appModelSchemaSha256', new.damm_model_schema_sha256,
      'sourceRepository', new.damm_source_repository,
      'sourceCommit', new.damm_source_commit,
      'sourceModelPath', new.damm_source_model_path,
      'sourceModelSha256', new.damm_source_model_sha256,
      'sourceSchemaPath', new.damm_source_schema_path,
      'sourceSchemaSha256', new.damm_source_schema_sha256,
      'censusRevision', new.census_revision,
      'censusPath', new.census_path,
      'censusSha256', new.census_sha256,
      'engineVersion', new.engine_version,
      'enginePath', new.engine_path,
      'engineSha256', new.engine_sha256,
      'rendererVersion', new.renderer_version,
      'rendererPath', new.renderer_path,
      'rendererSha256', new.renderer_sha256
    ),
    'assessmentInputArtifactKey', new.assessment_input_artifact_key,
    'assessmentInputSourcePath', new.assessment_input_source_path,
    'assessmentInputSha256', new.assessment_input_sha256,
    'machineRowCount', new.machine_row_count,
    'machineRowSetSha256', new.machine_row_set_sha256,
    'g1ScopeSha256', new.g1_scope_sha256,
    'g2ScopeSha256', new.g2_scope_sha256,
    'completedAt', human_approval_js_iso_v1(new.completed_at)
  );
  expected_digest := encode(
    sha256(convert_to(canonical_human_approval_json_v1(expected_target_identity), 'UTF8')),
    'hex'
  );
  if new.target_identity_sha256 <> expected_digest
     or new.id <> ('approval-package-' || expected_digest) then
    raise exception 'approval target identity does not match its exact package boundary'
      using errcode = '55000';
  end if;

  select count(*)::int, count(distinct scope_row ->> 'indicatorId')::int
    into g1_actual_count, g1_distinct_count
  from jsonb_array_elements(new.g1_scope_rows) scope_row;
  if g1_actual_count <> new.g1_scope_row_count
     or g1_distinct_count <> new.g1_scope_row_count
     or new.g1_scope_row_count <> new.machine_row_count
     or exists (
       select 1 from jsonb_array_elements(new.g1_scope_rows) scope_row
       where not exists (
         select 1 from workflow_approval_rows package_row
         where package_row.package_id = new.id
           and package_row.indicator_id = scope_row ->> 'indicatorId'
           and package_row.row_sha256 = scope_row ->> 'rowSha256'
       )
     ) then
    raise exception 'frozen G1 scope must be the exact complete machine-row set'
      using errcode = '55000';
  end if;
  if encode(
       sha256(convert_to(canonical_human_approval_json_v1(new.g1_scope_rows), 'UTF8')),
       'hex'
     ) is distinct from new.g1_scope_sha256 then
    raise exception 'frozen G1 scope digest does not match its exact rows'
      using errcode = '55000';
  end if;

  select count(*)::int, count(distinct scope_row ->> 'indicatorId')::int
    into g2_actual_count, g2_distinct_count
  from jsonb_array_elements(new.g2_scope_rows) scope_row;
  select count(*)::int into mandatory_count
  from workflow_approval_rows package_row
  where package_row.package_id = new.id
    and (package_row.prerequisite or package_row.classification = 'Judged');
  remainder_count := new.machine_row_count - mandatory_count;
  expected_sample_count := ceil(remainder_count * 0.15)::int;
  if g2_actual_count <> new.g2_scope_row_count
     or g2_distinct_count <> new.g2_scope_row_count
     or new.g2_mandatory_row_count <> mandatory_count
     or new.g2_remainder_row_count <> remainder_count
     or new.g2_sample_row_count <> expected_sample_count
     or new.g2_scope_row_count <> mandatory_count + expected_sample_count
     or exists (
       select 1 from jsonb_array_elements(new.g2_scope_rows) scope_row
       where not exists (
         select 1 from workflow_approval_rows package_row
         where package_row.package_id = new.id
           and package_row.indicator_id = scope_row ->> 'indicatorId'
           and package_row.row_sha256 = scope_row ->> 'rowSha256'
       )
     )
     or exists (
       select 1 from workflow_approval_rows mandatory_row
       where mandatory_row.package_id = new.id
         and (mandatory_row.prerequisite or mandatory_row.classification = 'Judged')
         and not exists (
           select 1 from jsonb_array_elements(new.g2_scope_rows) scope_row
           where scope_row ->> 'indicatorId' = mandatory_row.indicator_id
             and scope_row ->> 'rowSha256' = mandatory_row.row_sha256
         )
     )
     or exists (
       -- The TypeScript policy ranks only remainder rows by
       -- SHA-256(bundle || NUL || indicator || NUL || row hash), then indicator ID.
       -- Text cannot contain NUL in PostgreSQL, so build the seed as bytea pieces.
       select 1
       from (
         select remainder_row.indicator_id, remainder_row.row_sha256
         from workflow_approval_rows remainder_row
         where remainder_row.package_id = new.id
           and not remainder_row.prerequisite
           and remainder_row.classification <> 'Judged'
         order by
           encode(
             sha256(
               convert_to(new.bundle_sha256, 'UTF8')
               || decode('00', 'hex')
               || convert_to(remainder_row.indicator_id, 'UTF8')
               || decode('00', 'hex')
               || convert_to(remainder_row.row_sha256, 'UTF8')
             ),
             'hex'
           ),
           remainder_row.indicator_id collate "C"
         limit expected_sample_count
       ) expected_sample
       where not exists (
         select 1 from jsonb_array_elements(new.g2_scope_rows) scope_row
         where scope_row ->> 'indicatorId' = expected_sample.indicator_id
           and scope_row ->> 'rowSha256' = expected_sample.row_sha256
       )
     ) then
    raise exception 'frozen G2 scope does not satisfy the independent-review protocol'
      using errcode = '55000';
  end if;
  if encode(
       sha256(convert_to(canonical_human_approval_json_v1(new.g2_scope_rows), 'UTF8')),
       'hex'
     ) is distinct from new.g2_scope_sha256 then
    raise exception 'frozen G2 scope digest does not match its exact rows'
      using errcode = '55000';
  end if;
  return null;
end;
$$;

create or replace function validate_approval_assignment_insert()
returns trigger
language plpgsql
as $$
declare
  package_record workflow_approval_packages%rowtype;
  actual_scope_count int;
  distinct_scope_count int;
begin
  select * into strict package_record
  from workflow_approval_packages
  where id = new.package_id and target_identity_sha256 = new.target_identity_sha256
  for update;

  new.active := true;
  new.assigned_at := transaction_timestamp();

  if package_record.materialized_at is null then
    raise exception 'approval package materialization is not complete'
      using errcode = '55000';
  end if;

  -- The package-row lock above serializes all assignment and replacement attempts.
  -- Historical assignments remain present, but exactly one non-superseded assignment
  -- may be active for a package/gate at a time.
  if exists (
    select 1
    from workflow_approval_assignments active_assignment
    where active_assignment.package_id = new.package_id
      and active_assignment.gate = new.gate
      and active_assignment.active
      and not exists (
        select 1
        from workflow_approval_assignment_supersessions supersession
        where supersession.revoked_assignment_id = active_assignment.id
      )
  ) then
    raise exception 'an active reviewer assignment already exists for this gate'
      using errcode = '23505';
  end if;

  if new.assigned_by_user_id = 'dev-user' or new.reviewer_user_id = 'dev-user' then
    raise exception 'human approval requires registered authenticated users'
      using errcode = '28000';
  end if;
  if new.assigned_by_user_id <> package_record.owner_user_id then
    raise exception 'only the country owner may assign package reviewers'
      using errcode = '42501';
  end if;
  perform 1 from countries country
  where country.id = package_record.country_id
    and country.user_id = package_record.owner_user_id
    and country.deleted_at is null
  for update;
  if not found then
    raise exception 'package owner is no longer the active country owner'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from "user"
    where "id" = new.assigned_by_user_id
      and "name" = new.assigned_by_name
      and "email" = new.assigned_by_email
  ) or not exists (
    select 1 from "user"
    where "id" = new.reviewer_user_id
      and "name" = new.reviewer_name
      and "email" = new.reviewer_email
  ) then
    raise exception 'assignment identity snapshot does not match registered users'
      using errcode = '28000';
  end if;
  if (new.gate = 'g1' and new.declared_role <> 'assessor')
     or (new.gate = 'g2' and new.declared_role <> 'independent_reviewer') then
    raise exception 'reviewer role is incompatible with the assigned gate'
      using errcode = '22000';
  end if;
  if new.gate = 'g2' and not exists (
    select 1 from workflow_approval_assignments prior
    where prior.package_id = new.package_id and prior.gate = 'g1'
      and prior.active
      and not exists (
        select 1 from workflow_approval_assignment_supersessions supersession
        where supersession.revoked_assignment_id = prior.id
      )
  ) then
    raise exception 'G2 assignment requires the immutable G1 assignment first'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from workflow_approval_assignments prior
    where prior.package_id = new.package_id and prior.gate <> new.gate
      and prior.reviewer_user_id = new.reviewer_user_id
  ) then
    raise exception 'G2 reviewer must be independent from the G1 assessor'
      using errcode = '42501';
  end if;
  if new.gate = 'g2' and exists (
    select 1 from workflow_approval_decisions prior
    where prior.package_id = new.package_id and prior.gate = 'g1'
      and prior.reviewer_user_id = new.reviewer_user_id
  ) then
    raise exception 'G2 reviewer must be independent from the G1 assessor'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from workflow_approval_decisions decision_record
    where decision_record.package_id = new.package_id
      and (
        decision_record.decision = 'revisions_required'
        or decision_record.gate = new.gate
        or (new.gate = 'g1')
        or decision_record.gate = 'g3'
      )
  ) or exists (
    select 1 from workflow_approval_releases release_record
    where release_record.package_id = new.package_id
  ) then
    raise exception 'this immutable review assignment can no longer be created'
      using errcode = '55000';
  end if;

  select count(*)::int, count(distinct scope_row ->> 'indicatorId')::int
    into actual_scope_count, distinct_scope_count
  from jsonb_array_elements(new.scope_rows) scope_row;
  if actual_scope_count <> new.scope_row_count
     or distinct_scope_count <> new.scope_row_count then
    raise exception 'review scope count or identity is invalid' using errcode = '22000';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.scope_rows) scope_row
    where not exists (
      select 1 from workflow_approval_rows package_row
      where package_row.package_id = new.package_id
        and package_row.indicator_id = scope_row ->> 'indicatorId'
        and package_row.row_sha256 = scope_row ->> 'rowSha256'
    )
  ) then
    raise exception 'review scope is not bound to exact package rows'
      using errcode = '22000';
  end if;
  if new.gate = 'g1' and (
    new.scope_row_count <> package_record.g1_scope_row_count
    or new.scope_sha256 <> package_record.g1_scope_sha256
    or new.scope_rows <> package_record.g1_scope_rows
  ) then
    raise exception 'G1 assignment must use the immutable complete package scope'
      using errcode = '22000';
  end if;
  if new.gate = 'g2' and (
    new.scope_row_count <> package_record.g2_scope_row_count
    or new.scope_sha256 <> package_record.g2_scope_sha256
    or new.scope_rows <> package_record.g2_scope_rows
  ) then
    raise exception 'G2 assignment must use the immutable protocol scope'
      using errcode = '22000';
  end if;
  if exists (
    select 1
    from workflow_approval_assignment_supersessions supersession
    where supersession.superseding_assignment_id = new.id
      and (
        supersession.package_id <> new.package_id
        or supersession.target_identity_sha256 <> new.target_identity_sha256
        or supersession.gate <> new.gate
        or supersession.revoked_by_user_id <> new.assigned_by_user_id
        or supersession.revoked_by_name <> new.assigned_by_name
        or supersession.revoked_by_email <> new.assigned_by_email
      )
  ) then
    raise exception 'superseding assignment does not match its immutable owner audit record'
      using errcode = '22000';
  end if;
  return new;
end;
$$;

create or replace function validate_approval_assignment_supersession_insert()
returns trigger
language plpgsql
as $$
declare
  package_record workflow_approval_packages%rowtype;
  revoked_assignment workflow_approval_assignments%rowtype;
begin
  select * into strict package_record
  from workflow_approval_packages
  where id = new.package_id and target_identity_sha256 = new.target_identity_sha256
  for update;

  select * into strict revoked_assignment
  from workflow_approval_assignments
  where id = new.revoked_assignment_id
    and package_id = new.package_id
    and target_identity_sha256 = new.target_identity_sha256
    and gate = new.gate
    and active
  for update;

  new.revoked_at := transaction_timestamp();
  if package_record.materialized_at is null then
    raise exception 'approval package materialization is not complete'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from workflow_approval_assignment_supersessions prior
    where prior.revoked_assignment_id = revoked_assignment.id
  ) then
    raise exception 'expected reviewer assignment is no longer active'
      using errcode = '55000';
  end if;
  if new.revoked_by_user_id = 'dev-user'
     or new.revoked_by_user_id <> package_record.owner_user_id then
    raise exception 'only the country owner may replace an active reviewer assignment'
      using errcode = '42501';
  end if;
  perform 1 from countries country
  where country.id = package_record.country_id
    and country.user_id = package_record.owner_user_id
    and country.deleted_at is null
  for update;
  if not found then
    raise exception 'package owner is no longer the active country owner'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from "user"
    where "id" = new.revoked_by_user_id
      and "name" = new.revoked_by_name
      and "email" = new.revoked_by_email
  ) then
    raise exception 'assignment revocation identity does not match the authenticated owner'
      using errcode = '28000';
  end if;
  if char_length(trim(new.reason)) = 0 or char_length(new.reason) > 5000 then
    raise exception 'reviewer replacement requires a reason of at most 5,000 characters'
      using errcode = '22000';
  end if;
  if exists (
    select 1 from workflow_approval_decisions decision_record
    where decision_record.package_id = new.package_id
      and (
        decision_record.assignment_id = revoked_assignment.id
        or decision_record.gate = revoked_assignment.gate
        or decision_record.decision = 'revisions_required'
        or decision_record.gate = 'g3'
      )
  ) or exists (
    select 1 from workflow_approval_releases release_record
    where release_record.package_id = new.package_id
  ) then
    raise exception 'a decided or released reviewer assignment cannot be replaced'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function mark_superseded_assignment_inactive()
returns trigger
language plpgsql
as $$
begin
  update workflow_approval_assignments
  set active = false
  where id = new.revoked_assignment_id and active;
  if not found then
    raise exception 'expected reviewer assignment is no longer active'
      using errcode = '55000';
  end if;
  return null;
end;
$$;

create or replace function require_exact_superseding_assignment()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from workflow_approval_assignments successor
    where successor.id = new.superseding_assignment_id
      and successor.package_id = new.package_id
      and successor.target_identity_sha256 = new.target_identity_sha256
      and successor.gate = new.gate
      and successor.active
      and successor.assigned_by_user_id = new.revoked_by_user_id
      and successor.assigned_by_name = new.revoked_by_name
      and successor.assigned_by_email = new.revoked_by_email
  ) then
    raise exception 'assignment revocation and its exact successor must commit atomically'
      using errcode = '55000';
  end if;
  return null;
end;
$$;

create or replace function validate_approval_decision_insert()
returns trigger
language plpgsql
as $$
declare
  package_record workflow_approval_packages%rowtype;
  assignment_record workflow_approval_assignments%rowtype;
  expected_count int;
  actual_count int;
  distinct_count int;
  g1_record workflow_approval_decisions%rowtype;
  g2_record workflow_approval_decisions%rowtype;
  expected_affirmation_version text;
  expected_affirmation_text text;
begin
  select * into strict package_record
  from workflow_approval_packages
  where id = new.package_id and target_identity_sha256 = new.target_identity_sha256
  for update;
  new.decided_at := transaction_timestamp();

  if package_record.materialized_at is null then
    raise exception 'approval package materialization is not complete'
      using errcode = '55000';
  end if;

  if new.actor_kind <> 'human' or new.reviewer_user_id = 'dev-user' then
    raise exception 'automated actors cannot satisfy a human approval gate'
      using errcode = '28000';
  end if;
  if not exists (
    select 1 from "user"
    where "id" = new.reviewer_user_id
  ) then
    raise exception 'decision identity does not match a registered user'
      using errcode = '28000';
  end if;
  if new.gate = 'g3' and not exists (
    select 1 from "user"
    where "id" = new.reviewer_user_id
      and "name" = new.reviewer_name
      and "email" = new.reviewer_email
  ) then
    raise exception 'G3 signer snapshot does not match the authenticated owner'
      using errcode = '28000';
  end if;
  if new.decision = 'revisions_required' and char_length(trim(new.notes)) = 0 then
    raise exception 'a revisions-required decision needs notes' using errcode = '22000';
  end if;
  if exists (
    select 1 from workflow_approval_decisions terminal
    where terminal.package_id = new.package_id
      and terminal.decision = 'revisions_required'
  ) then
    raise exception 'a revisions-required decision terminates this approval chain'
      using errcode = '55000';
  end if;

  if new.gate in ('g1', 'g2') then
    if new.assignment_id is null then
      raise exception 'G1 and G2 require an exact reviewer assignment' using errcode = '22000';
    end if;
    select * into strict assignment_record
    from workflow_approval_assignments
    where id = new.assignment_id
      and package_id = new.package_id
      and target_identity_sha256 = new.target_identity_sha256
      and gate = new.gate
      and reviewer_user_id = new.reviewer_user_id
      and active
      and not exists (
        select 1
        from workflow_approval_assignment_supersessions supersession
        where supersession.revoked_assignment_id = workflow_approval_assignments.id
      );
    if new.declared_role <> assignment_record.declared_role
       or new.reviewer_name <> assignment_record.reviewer_name
       or new.reviewer_email <> assignment_record.reviewer_email then
      raise exception 'decision role does not match the immutable assignment'
        using errcode = '22000';
    end if;
    if not new.reviewer_affirmation then
      raise exception 'a human G1/G2 decision requires reviewer affirmation'
        using errcode = '22000';
    end if;
    if new.gate = 'g1' then
      expected_affirmation_version := 'damm.g1-human-affirmation/v1';
      expected_affirmation_text := 'I affirm that I am the named, authenticated human assessor assigned to G1; I personally reviewed every displayed machine-filled row, and no automated vendor review or machine QC is being represented as my review.';
    else
      expected_affirmation_version := 'damm.g2-human-affirmation/v1';
      expected_affirmation_text := 'I affirm that I am the named, authenticated independent human reviewer assigned to G2; I am not the G1 assessor; for every displayed scoped row I personally verified that the cited source resolves to the stated evidence, the evidence class is correctly derived, and the ladder level is justified by evidence quality and scale, resolving disagreements by evidence; and no automated vendor review or machine QC is being represented as my review.';
    end if;
    if new.reviewer_affirmation_version is distinct from expected_affirmation_version
       or new.reviewer_affirmation_text is distinct from expected_affirmation_text
       or new.reviewer_affirmation_sha256 is distinct from encode(
         sha256(convert_to(expected_affirmation_text, 'UTF8')), 'hex'
       ) then
      raise exception 'G1/G2 decision does not attest to the exact versioned QC affirmation'
        using errcode = '22000';
    end if;

    expected_count := assignment_record.scope_row_count;
    select count(*)::int, count(distinct review_row ->> 'indicatorId')::int
      into actual_count, distinct_count
    from jsonb_array_elements(new.row_reviews) review_row;
    if actual_count <> expected_count or distinct_count <> expected_count then
      raise exception 'decision does not cover the exact assigned row scope'
        using errcode = '22000';
    end if;
    if exists (
      select 1 from jsonb_array_elements(new.row_reviews) review_row
      where jsonb_typeof(review_row) is distinct from 'object'
         or not (review_row ? 'indicatorId')
         or not (review_row ? 'rowSha256')
         or not (review_row ? 'decision')
         or not (review_row ? 'notes')
         or jsonb_typeof(review_row -> 'indicatorId') is distinct from 'string'
         or jsonb_typeof(review_row -> 'rowSha256') is distinct from 'string'
         or jsonb_typeof(review_row -> 'decision') is distinct from 'string'
         or jsonb_typeof(review_row -> 'notes') is distinct from 'string'
         or review_row ->> 'decision' is null
         or review_row ->> 'decision' not in ('approved', 'revisions_required')
         or (select count(*) from jsonb_object_keys(review_row)) <> 4
         or exists (
           select 1 from jsonb_object_keys(review_row) review_key
           where review_key not in ('indicatorId', 'rowSha256', 'decision', 'notes')
         )
         or not exists (
           select 1 from jsonb_array_elements(assignment_record.scope_rows) scope_row
           where scope_row ->> 'indicatorId' = review_row ->> 'indicatorId'
             and scope_row ->> 'rowSha256' = review_row ->> 'rowSha256'
         )
         or (
           review_row ->> 'decision' = 'revisions_required'
           and char_length(trim(coalesce(review_row ->> 'notes', ''))) = 0
         )
    ) then
      raise exception 'row decisions are invalid or not bound to the assigned scope'
        using errcode = '22000';
    end if;
    if new.decision = 'approved' and exists (
      select 1 from jsonb_array_elements(new.row_reviews) review_row
      where review_row ->> 'decision' <> 'approved'
    ) then
      raise exception 'an approved gate cannot contain a revisions-required row'
        using errcode = '22000';
    end if;
    if new.decision = 'revisions_required' and not exists (
      select 1 from jsonb_array_elements(new.row_reviews) review_row
      where review_row ->> 'decision' = 'revisions_required'
    ) then
      raise exception 'a revisions-required gate must identify a row requiring revision'
        using errcode = '22000';
    end if;
  else
    if new.assignment_id is not null or jsonb_array_length(new.row_reviews) <> 0 then
      raise exception 'G3 is a country-owner sign-off, not an assigned row review'
        using errcode = '22000';
    end if;
    if new.reviewer_user_id <> package_record.owner_user_id
       or new.declared_role <> 'ttl_country_owner' then
      raise exception 'only the authenticated country owner may record G3'
        using errcode = '42501';
    end if;
    perform 1 from countries country
    where country.id = package_record.country_id
      and country.user_id = package_record.owner_user_id
      and country.deleted_at is null
    for update;
    if not found then
      raise exception 'package owner is no longer the active country owner'
        using errcode = '42501';
    end if;
  end if;

  select * into g1_record from workflow_approval_decisions
  where package_id = new.package_id and gate = 'g1' and decision = 'approved';
  if new.gate in ('g2', 'g3') and g1_record.id is null then
    raise exception 'G2 and G3 require accepted G1 first' using errcode = '55000';
  end if;
  if new.gate = 'g2' and new.reviewer_user_id = g1_record.reviewer_user_id then
    raise exception 'G2 reviewer must be independent from the G1 assessor'
      using errcode = '42501';
  end if;
  if new.gate = 'g3' then
    select * into g2_record from workflow_approval_decisions
    where package_id = new.package_id and gate = 'g2' and decision = 'approved';
    if g2_record.id is null then
      raise exception 'G3 requires accepted independent G2 first' using errcode = '55000';
    end if;
    if new.decision = 'approved' and (
      not new.reviewer_affirmation
      or (select count(*) from jsonb_each(new.affirmations)) <> 7
      or exists (select 1 from jsonb_each(new.affirmations) affirmation where affirmation.value <> 'true'::jsonb)
      or exists (
        select 1 from jsonb_object_keys(new.affirmations) affirmation_id
        where affirmation_id not in (
          'no_cross_country_ranking',
          'no_band_as_financing_condition',
          'no_automatic_financing_decisions',
          'no_public_claim_before_human_review',
          'parenthesized_bands_acknowledged',
          'register_rows_source_tier_verified',
          'qc_footer_accurate'
        )
      )
    ) then
      raise exception 'approved G3 requires all seven QC affirmations'
        using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

create or replace function validate_approval_release_insert()
returns trigger
language plpgsql
as $$
declare
  package_record workflow_approval_packages%rowtype;
  g1_record workflow_approval_decisions%rowtype;
  g2_record workflow_approval_decisions%rowtype;
  g3_record workflow_approval_decisions%rowtype;
  expected_lifecycle text;
  expected_version int;
  expected_manifest jsonb;
  expected_manifest_sha256 text;
begin
  select * into strict package_record
  from workflow_approval_packages
  where id = new.package_id and target_identity_sha256 = new.target_identity_sha256
  for update;
  new.created_at := transaction_timestamp();
  if package_record.materialized_at is null then
    raise exception 'approval package materialization is not complete'
      using errcode = '55000';
  end if;
  perform 1 from countries country
  where country.id = package_record.country_id
    and country.user_id = package_record.owner_user_id
    and country.deleted_at is null
  for update;
  if not found then
    raise exception 'release package owner is no longer the active country owner'
      using errcode = '42501';
  end if;
  if new.country_id <> package_record.country_id then
    raise exception 'release country does not match its exact approval package'
      using errcode = '22000';
  end if;
  if not exists (
    select 1 from workflow_approval_decisions
    where id = new.g1_decision_id and package_id = new.package_id
      and target_identity_sha256 = new.target_identity_sha256
      and gate = 'g1' and decision = 'approved' and actor_kind = 'human'
  ) or not exists (
    select 1 from workflow_approval_decisions
    where id = new.g2_decision_id and package_id = new.package_id
      and target_identity_sha256 = new.target_identity_sha256
      and gate = 'g2' and decision = 'approved' and actor_kind = 'human'
  ) or not exists (
    select 1 from workflow_approval_decisions
    where id = new.g3_decision_id and package_id = new.package_id
      and target_identity_sha256 = new.target_identity_sha256
      and gate = 'g3' and decision = 'approved' and actor_kind = 'human'
      and reviewer_user_id = package_record.owner_user_id
  ) then
    raise exception 'release requires the exact accepted G1, G2, and G3 decisions'
      using errcode = '55000';
  end if;
  select * into strict g1_record from workflow_approval_decisions
  where id = new.g1_decision_id and package_id = new.package_id
    and target_identity_sha256 = new.target_identity_sha256
    and gate = 'g1' and decision = 'approved' and actor_kind = 'human';
  select * into strict g2_record from workflow_approval_decisions
  where id = new.g2_decision_id and package_id = new.package_id
    and target_identity_sha256 = new.target_identity_sha256
    and gate = 'g2' and decision = 'approved' and actor_kind = 'human';
  select * into strict g3_record from workflow_approval_decisions
  where id = new.g3_decision_id and package_id = new.package_id
    and target_identity_sha256 = new.target_identity_sha256
    and gate = 'g3' and decision = 'approved' and actor_kind = 'human'
    and reviewer_user_id = package_record.owner_user_id;

  expected_lifecycle := case
    when package_record.damm_model_ratified
      and lower(package_record.damm_model_status) = 'ratified'
      then 'canonical_final'
    else 'approved_draft'
  end;
  if new.lifecycle <> expected_lifecycle then
    raise exception 'release lifecycle is incompatible with methodology ratification'
      using errcode = '22000';
  end if;
  select coalesce(max(version_number), 0) + 1 into expected_version
  from workflow_approval_releases where country_id = new.country_id;
  if new.version_number <> expected_version then
    raise exception 'release version is not the next country release version'
      using errcode = '40001';
  end if;

  expected_manifest := jsonb_build_object(
    'schemaVersion', 'damm.approval-release/v1',
    'releaseId', new.id,
    'packageId', new.package_id,
    'targetIdentitySha256', new.target_identity_sha256,
    'countryId', new.country_id,
    'version', new.version_number,
    'lifecycle', new.lifecycle,
    'externalCirculationAuthorized', true,
    'runId', package_record.run_id,
    'artifactSetId', package_record.artifact_set_id,
    'bundleSha256', package_record.bundle_sha256,
    'observationsSha256', package_record.observations_sha256,
    'workflowContractVersion', package_record.workflow_version,
    'workflowContractSha256', package_record.workflow_contract_sha256,
    'methodology', jsonb_build_object(
      'manifestSchemaVersion', package_record.manifest_schema_version,
      'modelId', package_record.damm_model_id,
      'modelVersion', package_record.damm_model_version,
      'modelRevision', package_record.damm_model_revision,
      'modelStatus', package_record.damm_model_status,
      'modelRatified', package_record.damm_model_ratified,
      'appModelSha256', package_record.damm_model_sha256,
      'appModelSchemaSha256', package_record.damm_model_schema_sha256,
      'sourceRepository', package_record.damm_source_repository,
      'sourceCommit', package_record.damm_source_commit,
      'sourceModelPath', package_record.damm_source_model_path,
      'sourceModelSha256', package_record.damm_source_model_sha256,
      'sourceSchemaPath', package_record.damm_source_schema_path,
      'sourceSchemaSha256', package_record.damm_source_schema_sha256,
      'censusRevision', package_record.census_revision,
      'censusPath', package_record.census_path,
      'censusSha256', package_record.census_sha256,
      'engineVersion', package_record.engine_version,
      'enginePath', package_record.engine_path,
      'engineSha256', package_record.engine_sha256,
      'rendererVersion', package_record.renderer_version,
      'rendererPath', package_record.renderer_path,
      'rendererSha256', package_record.renderer_sha256
    ),
    'assessmentInputArtifactKey', package_record.assessment_input_artifact_key,
    'assessmentInputSourcePath', package_record.assessment_input_source_path,
    'assessmentInputSha256', package_record.assessment_input_sha256,
    'g1DecisionId', g1_record.id,
    'g2DecisionId', g2_record.id,
    'g3DecisionId', g3_record.id,
    'approvals', jsonb_build_object(
      'g1', jsonb_build_object(
        'decisionId', g1_record.id,
        'decision', g1_record.decision,
        'reviewerUserId', g1_record.reviewer_user_id,
        'reviewerName', g1_record.reviewer_name,
        'reviewerEmail', g1_record.reviewer_email,
        'declaredRole', g1_record.declared_role,
        'decidedAt', human_approval_js_iso_v1(g1_record.decided_at),
        'notes', g1_record.notes,
        'affirmationVersion', g1_record.reviewer_affirmation_version,
        'affirmationText', g1_record.reviewer_affirmation_text,
        'affirmationSha256', g1_record.reviewer_affirmation_sha256
      ),
      'g2', jsonb_build_object(
        'decisionId', g2_record.id,
        'decision', g2_record.decision,
        'reviewerUserId', g2_record.reviewer_user_id,
        'reviewerName', g2_record.reviewer_name,
        'reviewerEmail', g2_record.reviewer_email,
        'declaredRole', g2_record.declared_role,
        'decidedAt', human_approval_js_iso_v1(g2_record.decided_at),
        'notes', g2_record.notes,
        'affirmationVersion', g2_record.reviewer_affirmation_version,
        'affirmationText', g2_record.reviewer_affirmation_text,
        'affirmationSha256', g2_record.reviewer_affirmation_sha256
      ),
      'g3', jsonb_build_object(
        'decisionId', g3_record.id,
        'decision', g3_record.decision,
        'reviewerUserId', g3_record.reviewer_user_id,
        'reviewerName', g3_record.reviewer_name,
        'reviewerEmail', g3_record.reviewer_email,
        'declaredRole', g3_record.declared_role,
        'decidedAt', human_approval_js_iso_v1(g3_record.decided_at),
        'notes', g3_record.notes,
        'affirmations', g3_record.affirmations
      )
    )
  );
  expected_manifest_sha256 := encode(
    sha256(convert_to(canonical_human_approval_json_v1(expected_manifest), 'UTF8')),
    'hex'
  );

  if new.manifest_json is distinct from expected_manifest then
    raise exception 'release manifest is not bound to its exact package and decisions'
      using errcode = '22000';
  end if;
  if new.manifest_sha256 is distinct from expected_manifest_sha256 then
    raise exception 'release manifest digest does not match its canonical exact contents'
      using errcode = '22000';
  end if;
  return new;
end;
$$;

create or replace function require_approved_g3_release()
returns trigger
language plpgsql
as $$
begin
  if new.gate = 'g3' and new.decision = 'approved' and not exists (
    select 1 from workflow_approval_releases release_record
    where release_record.package_id = new.package_id
      and release_record.target_identity_sha256 = new.target_identity_sha256
      and release_record.g3_decision_id = new.id
  ) then
    raise exception 'accepted G3 and its versioned release must commit atomically'
      using errcode = '55000';
  end if;
  return null;
end;
$$;

drop trigger if exists workflow_approval_package_validate on workflow_approval_packages;
create trigger workflow_approval_package_validate
before insert on workflow_approval_packages
for each row execute function validate_approval_package_insert();

drop trigger if exists workflow_approval_package_rows_complete on workflow_approval_packages;
create constraint trigger workflow_approval_package_rows_complete
after insert on workflow_approval_packages
deferrable initially deferred
for each row execute function require_complete_approval_package_rows();

drop trigger if exists workflow_approval_assignment_validate on workflow_approval_assignments;
create trigger workflow_approval_assignment_validate
before insert on workflow_approval_assignments
for each row execute function validate_approval_assignment_insert();

drop trigger if exists workflow_approval_assignment_supersession_validate
  on workflow_approval_assignment_supersessions;
create trigger workflow_approval_assignment_supersession_validate
before insert on workflow_approval_assignment_supersessions
for each row execute function validate_approval_assignment_supersession_insert();

drop trigger if exists workflow_approval_assignment_supersession_marks_inactive
  on workflow_approval_assignment_supersessions;
create trigger workflow_approval_assignment_supersession_marks_inactive
after insert on workflow_approval_assignment_supersessions
for each row execute function mark_superseded_assignment_inactive();

drop trigger if exists workflow_approval_assignment_supersession_requires_successor
  on workflow_approval_assignment_supersessions;
create constraint trigger workflow_approval_assignment_supersession_requires_successor
after insert on workflow_approval_assignment_supersessions
deferrable initially deferred
for each row execute function require_exact_superseding_assignment();

drop trigger if exists workflow_approval_row_validate on workflow_approval_rows;
create trigger workflow_approval_row_validate
before insert on workflow_approval_rows
for each row execute function validate_approval_row_insert();

drop trigger if exists workflow_approval_decision_validate on workflow_approval_decisions;
create trigger workflow_approval_decision_validate
before insert on workflow_approval_decisions
for each row execute function validate_approval_decision_insert();

drop trigger if exists workflow_approval_release_validate on workflow_approval_releases;
create trigger workflow_approval_release_validate
before insert on workflow_approval_releases
for each row execute function validate_approval_release_insert();

drop trigger if exists workflow_approval_g3_requires_release on workflow_approval_decisions;
create constraint trigger workflow_approval_g3_requires_release
after insert on workflow_approval_decisions
deferrable initially deferred
for each row execute function require_approved_g3_release();

drop trigger if exists workflow_approval_packages_immutable on workflow_approval_packages;
create trigger workflow_approval_packages_immutable
before update or delete on workflow_approval_packages
for each row execute function restrict_approval_package_mutation();

drop trigger if exists workflow_approval_rows_immutable on workflow_approval_rows;
create trigger workflow_approval_rows_immutable
before update or delete on workflow_approval_rows
for each row execute function reject_human_approval_mutation();

drop trigger if exists workflow_approval_assignments_immutable on workflow_approval_assignments;
create trigger workflow_approval_assignments_immutable
before update or delete on workflow_approval_assignments
for each row execute function restrict_approval_assignment_mutation();

drop trigger if exists workflow_approval_assignment_supersessions_immutable
  on workflow_approval_assignment_supersessions;
create trigger workflow_approval_assignment_supersessions_immutable
before update or delete on workflow_approval_assignment_supersessions
for each row execute function reject_human_approval_mutation();

drop trigger if exists workflow_approval_decisions_immutable on workflow_approval_decisions;
create trigger workflow_approval_decisions_immutable
before update or delete on workflow_approval_decisions
for each row execute function reject_human_approval_mutation();

drop trigger if exists workflow_approval_releases_immutable on workflow_approval_releases;
create trigger workflow_approval_releases_immutable
before update or delete on workflow_approval_releases
for each row execute function reject_human_approval_mutation();
