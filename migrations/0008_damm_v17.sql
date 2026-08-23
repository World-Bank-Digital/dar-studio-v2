-- DAMM v1.7: the domain layer is rebuilt on the canonical model.
--
-- The v1.5 indicator census (102 indicators) is superseded by the v1.7 census
-- (57 indicators, different identities and semantics), so stored v1.5 evidence
-- rows cannot be reinterpreted — the table is recreated in the v1.7 shape.
-- v1.7 removed stages, the CMS/EMS/OES composites, coverage arithmetic and
-- confidence weights from the model, so the columns that carried them go too.
-- The derived assessment is stored whole as jsonb: it is recomputed from the
-- evidence rows on every change, and the stored copy only serves list views.

drop table if exists evidence;

create table evidence (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  indicator_id text not null,
  -- The recorded value, exactly as the instrument takes it: a number scores a
  -- threshold row; prose plus a source at an admissible tier reads Documented;
  -- a search trail beginning "DATA GAP" records a gap. The evidence class is
  -- derived from this at scoring time, never stored.
  value_raw text,
  observation_year int,
  source_name text,
  source_url text,
  source_tier text,
  -- 1-5, honoured only where the class is not Measured (threshold rows with a
  -- numeric value score themselves).
  assessor_level int,
  -- A withheld level: the row's evidence measures a different construct from
  -- what the indicator names, pending a section-13.5 ruling. Held rows keep
  -- their evidence class but sit outside every mean.
  ratification_hold boolean not null default false,
  assessor_role text,
  assessor_name text,
  assessed_at timestamptz,
  notes text,
  unique (country_id, indicator_id)
);

create index if not exists evidence_country_idx on evidence (country_id);

alter table countries
  drop column if exists cms,
  drop column if exists ems,
  drop column if exists oes,
  drop column if exists cms_coverage,
  drop column if exists ems_coverage,
  drop column if exists oes_coverage,
  drop column if exists stage_code,
  drop column if exists stage_label,
  drop column if exists levelled_count,
  drop column if exists imported_count,
  drop column if exists named_gap_count,
  drop column if exists stale_count,
  drop column if exists validated_count,
  drop column if exists core_unmeasured,
  drop column if exists core_failures,
  drop column if exists current_step,
  drop column if exists step1_completed_at,
  drop column if exists ingest_status,
  drop column if exists ingest_progress,
  drop column if exists ingest_total,
  drop column if exists ingest_message;

alter table countries add column if not exists assessment jsonb;
alter table countries add column if not exists model_version text;
