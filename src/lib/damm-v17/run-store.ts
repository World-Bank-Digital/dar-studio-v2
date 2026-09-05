/**
 * Persistence for pipeline runs. Thin by design: every rule that matters lives in
 * `runs.ts` where it can be tested without a database, and this file only moves rows.
 *
 * The one piece of logic that has to be here is the claim, because it must be atomic.
 * Two workers reading "is this claimable?" and then both writing "mine" would spend the
 * same country budget twice, so the read and the write are a single conditional update
 * and the loser gets no row back.
 */
import { createHash, randomUUID } from "node:crypto";

import { getSql, type Sql } from "../db.ts";

import type { FrozenWorkflowUpload } from "./workflow.ts";
import {
  DAMM_WORKFLOW_METHODOLOGY,
  methodologyMatchesCanonical,
  type WorkflowMethodologyIdentity,
} from "./methodology.ts";
import {
  DAR_WORKFLOW,
  DAR_WORKFLOW_SHA256,
  MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT,
  MAX_WORKFLOW_UPLOAD_CHARACTERS_TOTAL,
  MAX_WORKFLOW_UPLOAD_DOCUMENTS,
  MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_PER_DOCUMENT,
  MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_TOTAL,
} from "./workflow.ts";
import {
  CLAIM_LEASE_MS,
  defaultVendorFor,
  isCanonicalWorkflowVendor,
  type ClaimedRun,
  type Run,
  type RunPass,
  type RunStatus,
} from "./runs.ts";

const CANONICAL_UPLOAD_KINDS = DAR_WORKFLOW.optional_launch_inputs.map((input) => input.id);

interface RunRow {
  id: string;
  user_id: string;
  country_id: string | null;
  country_name: string;
  iso3: string;
  pass: string;
  status: string;
  ceiling_usd: number;
  spent_usd: number;
  rows_total: number | null;
  rows_done: number;
  vendor: string | null;
  out_basename: string;
  claimed_by: string | null;
  claim_token: string | null;
  heartbeat_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  stopped_reason: string | null;
}

interface WorkflowMethodologyRow {
  manifest_schema_version: string;
  model_id: string;
  model_version: string;
  model_revision: number;
  model_status: string;
  model_ratified: boolean;
  app_model_sha256: string;
  app_model_schema_sha256: string;
  source_repository: string;
  source_commit: string;
  source_model_path: string;
  source_model_sha256: string;
  source_schema_path: string;
  source_schema_sha256: string;
  census_revision: string;
  census_path: string;
  census_sha256: string;
  engine_version: string;
  engine_path: string;
  engine_sha256: string;
  renderer_version: string;
  renderer_path: string;
  renderer_sha256: string;
}

function toWorkflowMethodology(row: WorkflowMethodologyRow): WorkflowMethodologyIdentity {
  return {
    manifestSchemaVersion: row.manifest_schema_version as "damm.model-export/v1",
    modelId: row.model_id,
    modelVersion: row.model_version,
    modelRevision: Number(row.model_revision),
    modelStatus: row.model_status,
    modelRatified: row.model_ratified,
    appModelSha256: row.app_model_sha256,
    appModelSchemaSha256: row.app_model_schema_sha256,
    sourceRepository: row.source_repository,
    sourceCommit: row.source_commit,
    sourceModelPath: row.source_model_path,
    sourceModelSha256: row.source_model_sha256,
    sourceSchemaPath: row.source_schema_path,
    sourceSchemaSha256: row.source_schema_sha256,
    censusRevision: row.census_revision,
    censusPath: row.census_path,
    censusSha256: row.census_sha256,
    engineVersion: row.engine_version,
    enginePath: row.engine_path,
    engineSha256: row.engine_sha256,
    rendererVersion: row.renderer_version,
    rendererPath: row.renderer_path,
    rendererSha256: row.renderer_sha256,
  };
}

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    userId: r.user_id,
    countryId: r.country_id,
    countryName: r.country_name,
    iso3: r.iso3,
    pass: r.pass as RunPass,
    status: r.status as RunStatus,
    // Postgres numerics arrive as strings through some drivers; a silent string here
    // would make every budget comparison a lexicographic one.
    ceilingUsd: Number(r.ceiling_usd),
    spentUsd: Number(r.spent_usd),
    rowsTotal: r.rows_total,
    rowsDone: r.rows_done,
    vendor: r.vendor,
    outBasename: r.out_basename,
    claimedBy: r.claimed_by,
    heartbeatAt: r.heartbeat_at ? new Date(r.heartbeat_at) : null,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
    stoppedReason: r.stopped_reason,
  };
}

export class ActiveRunConflictError extends Error {
  readonly code = "ACTIVE_RUN_CONFLICT";

  constructor() {
    super("An active run already holds this country workflow slot.");
  }
}

/** Serialize every launch-time upload mutation and run launch for one country. */
export async function withCountryRunLock<T>(
  countryId: string,
  operation: (sql: Sql) => Promise<T>,
  database?: Sql,
): Promise<T> {
  const sql = database ?? (await getSql());
  return sql.transaction(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtextextended(${countryId}, 0))`;
    return operation(transaction);
  });
}

interface CreateRunInput {
  /** Minted by the caller so the run's basename can be derived from it. */
  id: string;
  userId: string;
  countryId: string | null;
  countryName: string;
  iso3: string;
  pass: RunPass;
  ceilingUsd: number;
  vendor?: string | null;
  outBasename: string;
}

async function createRunLocked(input: CreateRunInput, sql: Sql): Promise<Run> {
  if (input.pass === "workflow") {
    const methodology = DAMM_WORKFLOW_METHODOLOGY;
    const rows = await sql<RunRow>`
      with eligible as (
        select count(*)::int as document_count,
               coalesce(sum(chars), 0)::bigint as character_count,
               coalesce(sum(source_byte_size), 0)::bigint as source_bytes,
               coalesce(bool_and(
                 mime is not null and source_content is not null and source_sha256 is not null
                 and source_byte_size is not null and uploaded_by is not null
                 and extraction_status = 'extracted'
                 and kind = any(${CANONICAL_UPLOAD_KINDS}::text[])
                 and chars = char_length(content)
                 and source_byte_size = octet_length(source_content)
               ), true) as valid
        from uploads
        where country_id = ${input.countryId} and user_id = ${input.userId}
      ), created as (
        insert into runs (id, user_id, country_id, country_name, iso3, pass,
                          ceiling_usd, vendor, out_basename)
        select ${input.id}, ${input.userId}, ${input.countryId}, ${input.countryName},
               ${input.iso3}, ${input.pass}, ${input.ceilingUsd}, ${input.vendor ?? null},
               ${input.outBasename}
        from eligible
        where valid
          and document_count <= ${MAX_WORKFLOW_UPLOAD_DOCUMENTS}
          and character_count <= ${MAX_WORKFLOW_UPLOAD_CHARACTERS_TOTAL}
          and source_bytes <= ${MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_TOTAL}
          and not exists (
            select 1 from runs active
            where active.country_id = ${input.countryId}
              and active.user_id = ${input.userId}
              and active.status not in ('done', 'failed', 'cancelled')
          )
        returning id, user_id, country_id, country_name, iso3, pass, status,
                  ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
                  claimed_by, claim_token, heartbeat_at, started_at, finished_at,
                  stopped_reason
      ), methodology as (
        insert into workflow_run_methodology
          (run_id, manifest_schema_version, model_id, model_version, model_revision,
           model_status, model_ratified, app_model_sha256, app_model_schema_sha256,
           source_repository, source_commit, source_model_path, source_model_sha256,
           source_schema_path, source_schema_sha256, census_revision, census_path,
           census_sha256, engine_version, engine_path, engine_sha256, renderer_version,
           renderer_path, renderer_sha256)
        select created.id, ${methodology.manifestSchemaVersion}, ${methodology.modelId},
               ${methodology.modelVersion}, ${methodology.modelRevision},
               ${methodology.modelStatus}, ${methodology.modelRatified},
               ${methodology.appModelSha256}, ${methodology.appModelSchemaSha256},
               ${methodology.sourceRepository}, ${methodology.sourceCommit},
               ${methodology.sourceModelPath}, ${methodology.sourceModelSha256},
               ${methodology.sourceSchemaPath}, ${methodology.sourceSchemaSha256},
               ${methodology.censusRevision}, ${methodology.censusPath},
               ${methodology.censusSha256}, ${methodology.engineVersion},
               ${methodology.enginePath}, ${methodology.engineSha256},
               ${methodology.rendererVersion}, ${methodology.rendererPath},
               ${methodology.rendererSha256}
        from created
        returning run_id
      ), snapshotted as (
        insert into workflow_run_uploads
          (run_id, ordinal, upload_id, kind, filename, mime, chars, content,
           uploaded_at, source_content, source_sha256, source_byte_size,
           uploaded_by, extraction_status)
        select created.id,
               row_number() over (order by upload.uploaded_at, upload.id)::int,
               upload.id, upload.kind, upload.filename, upload.mime, upload.chars,
               upload.content, upload.uploaded_at, upload.source_content,
               upload.source_sha256, upload.source_byte_size, upload.uploaded_by,
               upload.extraction_status
        from created
        join methodology on methodology.run_id = created.id
        join uploads upload
          on upload.country_id = ${input.countryId} and upload.user_id = ${input.userId}
        returning run_id
      ), snapshot_count as (
        select count(*) from snapshotted
      )
      select created.* from created
      join methodology on methodology.run_id = created.id
      cross join snapshot_count`;
    if (!rows[0]) {
      const active = await sql<{ id: string }>`
        select id from runs
        where country_id = ${input.countryId} and user_id = ${input.userId}
          and status not in ('done', 'failed', 'cancelled')
        limit 1`;
      if (active.length) throw new ActiveRunConflictError();
      throw new Error("The workflow upload set is not provenance-complete.");
    }
    return toRun(rows[0]);
  }
  const rows = await sql<RunRow>`
    insert into runs (id, user_id, country_id, country_name, iso3, pass,
                      ceiling_usd, vendor, out_basename)
    select ${input.id}, ${input.userId}, ${input.countryId}, ${input.countryName},
           ${input.iso3}, ${input.pass}, ${input.ceilingUsd},
           ${input.vendor ?? null}, ${input.outBasename}
    where not exists (
      select 1 from runs active
      where active.country_id = ${input.countryId} and active.user_id = ${input.userId}
        and active.status not in ('done', 'failed', 'cancelled')
        and (active.pass = ${input.pass} or active.pass = 'workflow')
    )
    returning id, user_id, country_id, country_name, iso3, pass, status,
              ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
              claimed_by, claim_token, heartbeat_at, started_at, finished_at,
              stopped_reason`;
  if (!rows[0]) throw new ActiveRunConflictError();
  return toRun(rows[0]);
}

export async function createRun(input: CreateRunInput, database?: Sql): Promise<Run> {
  if (input.pass === "workflow" && !isCanonicalWorkflowVendor(input.vendor ?? null)) {
    throw new Error(
      `The canonical workflow vendor must be ${defaultVendorFor("workflow")}; received ${input.vendor}.`,
    );
  }
  const sql = database ?? (await getSql());
  return input.countryId
    ? withCountryRunLock(input.countryId, (transaction) => createRunLocked(input, transaction), sql)
    : createRunLocked(input, sql);
}

export interface PendingWorkflowUploadInput {
  id: string;
  userId: string;
  countryId: string;
  filename: string;
  kind: string;
  mime: string;
  chars: number;
  content: string;
  source: Uint8Array;
  sourceSha256: string;
}

export type PendingWorkflowUploadResult =
  | { ok: true; uploadedAt: Date }
  | {
      ok: false;
      reason: "country" | "active" | "documents" | "characters" | "source_bytes" | "invalid";
    };

/** Store one optional document only while no canonical snapshot exists for the country. */
export async function savePendingWorkflowUpload(
  input: PendingWorkflowUploadInput,
  database?: Sql,
): Promise<PendingWorkflowUploadResult> {
  return withCountryRunLock(
    input.countryId,
    async (sql) => {
      const country = await sql<{ id: string }>`
        select id from countries
        where id = ${input.countryId} and user_id = ${input.userId} and deleted_at is null`;
      if (!country.length) return { ok: false, reason: "country" } as const;
      const active = await sql<{ id: string }>`
        select id from runs
        where country_id = ${input.countryId} and user_id = ${input.userId}
          and pass = 'workflow' and status not in ('done', 'failed', 'cancelled')
        limit 1`;
      if (active.length) return { ok: false, reason: "active" } as const;
      const source = Buffer.from(input.source);
      const characters = Array.from(input.content).length;
      if (
        characters !== input.chars ||
        characters > MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT ||
        source.byteLength > MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_PER_DOCUMENT ||
        !/^[a-f0-9]{64}$/.test(input.sourceSha256) ||
        !CANONICAL_UPLOAD_KINDS.includes(input.kind)
      ) {
        return { ok: false, reason: "invalid" } as const;
      }
      const totals = await sql<{ count: number; characters: number; bytes: number }>`
        select count(*)::int as count,
               coalesce(sum(chars), 0)::bigint as characters,
               coalesce(sum(source_byte_size), 0)::bigint as bytes
        from uploads
        where country_id = ${input.countryId} and user_id = ${input.userId}`;
      if (Number(totals[0]?.count ?? 0) >= MAX_WORKFLOW_UPLOAD_DOCUMENTS) {
        return { ok: false, reason: "documents" } as const;
      }
      if (Number(totals[0]?.characters ?? 0) + characters > MAX_WORKFLOW_UPLOAD_CHARACTERS_TOTAL) {
        return { ok: false, reason: "characters" } as const;
      }
      if (
        Number(totals[0]?.bytes ?? 0) + source.byteLength >
        MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_TOTAL
      ) {
        return { ok: false, reason: "source_bytes" } as const;
      }
      const rows = await sql<{ uploaded_at: Date }>`
        insert into uploads
          (id, user_id, country_id, filename, kind, mime, chars, content,
           source_content, source_sha256, source_byte_size, uploaded_by, extraction_status)
        values
          (${input.id}, ${input.userId}, ${input.countryId}, ${input.filename}, ${input.kind},
           ${input.mime}, ${characters}, ${input.content}, ${source}, ${input.sourceSha256},
           ${source.byteLength}, ${input.userId}, 'extracted')
        returning uploaded_at`;
      return { ok: true, uploadedAt: rows[0].uploaded_at } as const;
    },
    database,
  );
}

export type DeletePendingWorkflowUploadResult =
  { ok: true } | { ok: false; reason: "active" | "not_found" };

/** Delete a mutable pre-launch document, serialized against the immutable launch. */
export async function deletePendingWorkflowUpload(
  userId: string,
  countryId: string,
  uploadId: string,
  database?: Sql,
): Promise<DeletePendingWorkflowUploadResult> {
  return withCountryRunLock(
    countryId,
    async (sql) => {
      const active = await sql<{ id: string }>`
        select id from runs
        where country_id = ${countryId} and user_id = ${userId}
          and pass = 'workflow' and status not in ('done', 'failed', 'cancelled')
        limit 1`;
      if (active.length) return { ok: false, reason: "active" } as const;
      const rows = await sql<{ id: string }>`
        delete from uploads
        where id = ${uploadId} and country_id = ${countryId} and user_id = ${userId}
        returning id`;
      return rows.length ? ({ ok: true } as const) : ({ ok: false, reason: "not_found" } as const);
    },
    database,
  );
}

/** Durable launch payload materialized by whichever host claims the workflow. */
export async function workflowUploadSnapshot(
  runId: string,
  database?: Sql,
): Promise<FrozenWorkflowUpload[] | null> {
  const sql = database ?? (await getSql());
  const rows = await sql<{
    upload_id: string;
    filename: string;
    kind: string;
    mime: string;
    chars: number;
    content: string;
    uploaded_at: Date;
    source_content: unknown;
    source_sha256: string;
    source_byte_size: number;
    uploaded_by: string;
    extraction_status: string;
  }>`
    select snapshot.upload_id, snapshot.filename, snapshot.kind, snapshot.mime,
           snapshot.chars, snapshot.content, snapshot.uploaded_at,
           snapshot.source_content, snapshot.source_sha256, snapshot.source_byte_size,
           snapshot.uploaded_by, snapshot.extraction_status
    from workflow_run_uploads snapshot
    join runs on runs.id = snapshot.run_id and runs.pass = 'workflow'
    where snapshot.run_id = ${runId}
    order by snapshot.ordinal`;
  const exists = await sql<{
    id: string;
  }>`select id from runs where id = ${runId} and pass = 'workflow'`;
  if (!exists.length) return null;
  return rows.map((row) => {
    const source = byteArray(row.source_content);
    return {
      id: row.upload_id,
      filename: row.filename,
      kind: row.kind,
      mime: row.mime,
      chars: row.chars,
      content: row.content,
      uploadedAt: new Date(row.uploaded_at).toISOString(),
      sourceSha256: row.source_sha256,
      sourceBytes: Number(row.source_byte_size),
      sourceBase64: source ? Buffer.from(source).toString("base64") : "",
      uploaderId: row.uploaded_by,
      extractionStatus: row.extraction_status as "extracted",
    };
  });
}

/** Methodology identity frozen atomically with the workflow run and optional uploads. */
export async function workflowMethodologySnapshot(
  runId: string,
  database?: Sql,
): Promise<WorkflowMethodologyIdentity | null> {
  const sql = database ?? (await getSql());
  const rows = await sql<WorkflowMethodologyRow>`
    select methodology.manifest_schema_version, methodology.model_id,
           methodology.model_version, methodology.model_revision, methodology.model_status,
           methodology.model_ratified, methodology.app_model_sha256,
           methodology.app_model_schema_sha256, methodology.source_repository,
           methodology.source_commit, methodology.source_model_path,
           methodology.source_model_sha256, methodology.source_schema_path,
           methodology.source_schema_sha256, methodology.census_revision,
           methodology.census_path, methodology.census_sha256, methodology.engine_version,
           methodology.engine_path, methodology.engine_sha256, methodology.renderer_version,
           methodology.renderer_path, methodology.renderer_sha256
    from workflow_run_methodology methodology
    join runs on runs.id = methodology.run_id and runs.pass = 'workflow'
    where methodology.run_id = ${runId}
    limit 1`;
  return rows[0] ? toWorkflowMethodology(rows[0]) : null;
}

export async function workflowRunUsesCanonicalMethodology(
  runId: string,
  database?: Sql,
): Promise<boolean> {
  const snapshot = await workflowMethodologySnapshot(runId, database);
  return snapshot !== null && methodologyMatchesCanonical(snapshot);
}

export interface WorkflowArtifactWrite {
  key: string;
  relativePath: string;
  filename: string;
  contentType: string;
  sha256: string;
  assessmentInputSha256: string;
  content: Uint8Array;
}

export interface PublishedWorkflowArtifact {
  runId: string;
  artifactSetId: string;
  completedAt: Date;
  contentVerifiedAt: Date | null;
  key: string;
  relativePath: string;
  filename: string;
  contentType: string;
  sha256: string;
  byteSize: number;
  content: Uint8Array;
  methodologyStatus: WorkflowMethodologyStatus;
}

/** Completed 0010 packages remain available, but are never represented as provenance-verified. */
export type WorkflowMethodologyStatus = "canonical" | "legacy_unverified";

interface LockedCanonicalWorkflowClaim {
  id: string;
  workflow_artifact_set_id: string | null;
}

/**
 * Serialize every application-owned artifact write through the parent run row.
 *
 * The lock order is deliberately run -> artifact. Publication and staging use the
 * same order, as does approval-package materialization, so a worker can never hold
 * an artifact row while waiting for the run row that a publisher already holds.
 */
async function lockCanonicalWorkflowClaim(
  runId: string,
  workerId: string,
  claimToken: string,
  sql: Sql,
): Promise<LockedCanonicalWorkflowClaim | null> {
  const canonicalMethodology = DAMM_WORKFLOW_METHODOLOGY;
  const rows = await sql<LockedCanonicalWorkflowClaim>`
    select run.id, run.workflow_artifact_set_id
    from runs run
    join workflow_run_methodology methodology on methodology.run_id = run.id
    where run.id = ${runId} and run.pass = 'workflow' and run.status = 'running'
      and run.claimed_by = ${workerId} and run.claim_token = ${claimToken}
      and methodology.manifest_schema_version = ${canonicalMethodology.manifestSchemaVersion}
      and methodology.model_id = ${canonicalMethodology.modelId}
      and methodology.model_version = ${canonicalMethodology.modelVersion}
      and methodology.model_revision = ${canonicalMethodology.modelRevision}
      and methodology.model_status = ${canonicalMethodology.modelStatus}
      and methodology.model_ratified = ${canonicalMethodology.modelRatified}
      and methodology.app_model_sha256 = ${canonicalMethodology.appModelSha256}
      and methodology.app_model_schema_sha256 = ${canonicalMethodology.appModelSchemaSha256}
      and methodology.source_repository = ${canonicalMethodology.sourceRepository}
      and methodology.source_commit = ${canonicalMethodology.sourceCommit}
      and methodology.source_model_path = ${canonicalMethodology.sourceModelPath}
      and methodology.source_model_sha256 = ${canonicalMethodology.sourceModelSha256}
      and methodology.source_schema_path = ${canonicalMethodology.sourceSchemaPath}
      and methodology.source_schema_sha256 = ${canonicalMethodology.sourceSchemaSha256}
      and methodology.census_revision = ${canonicalMethodology.censusRevision}
      and methodology.census_path = ${canonicalMethodology.censusPath}
      and methodology.census_sha256 = ${canonicalMethodology.censusSha256}
      and methodology.engine_version = ${canonicalMethodology.engineVersion}
      and methodology.engine_path = ${canonicalMethodology.enginePath}
      and methodology.engine_sha256 = ${canonicalMethodology.engineSha256}
      and methodology.renderer_version = ${canonicalMethodology.rendererVersion}
      and methodology.renderer_path = ${canonicalMethodology.rendererPath}
      and methodology.renderer_sha256 = ${canonicalMethodology.rendererSha256}
    for update of run`;
  return rows[0] ?? null;
}

/**
 * Stage one verified artifact under the worker's current claim token. A stale worker can
 * leave an incomplete set, but can never publish it: only the set selected on `runs` is
 * visible to web hosts.
 */
export async function saveWorkflowArtifact(
  runId: string,
  workerId: string,
  claimToken: string,
  artifact: WorkflowArtifactWrite,
  database?: Sql,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(artifact.assessmentInputSha256)) return false;
  const sql = database ?? (await getSql());
  const bytes = Buffer.from(artifact.content);
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) return false;
  return sql.transaction(async (transaction) => {
    const held = await lockCanonicalWorkflowClaim(runId, workerId, claimToken, transaction);
    // Once this claim's set is selected, it is append-closed even while finishRun is pending.
    // A recovered worker with a different claim may still stage its replacement set.
    if (!held || held.workflow_artifact_set_id === claimToken) return false;
    const rows = await transaction<{ artifact_key: string }>`
      insert into workflow_run_artifacts
        (run_id, artifact_set_id, artifact_key, relative_path, filename, content_type,
         sha256, byte_size, workflow_id, workflow_version, workflow_contract_sha256,
         damm_model_version, damm_model_revision, damm_model_sha256, damm_source_commit,
         assessment_input_sha256, content_verified_at, content)
      select run.id, ${claimToken}, ${artifact.key}, ${artifact.relativePath}, ${artifact.filename},
             ${artifact.contentType}, ${artifact.sha256}, ${bytes.length},
             ${DAR_WORKFLOW.workflow_id}, ${DAR_WORKFLOW.workflow_version},
             ${DAR_WORKFLOW_SHA256}, methodology.model_version, methodology.model_revision,
             methodology.app_model_sha256, methodology.source_commit,
             ${artifact.assessmentInputSha256}, now(), ${bytes}
      from runs run
      join workflow_run_methodology methodology on methodology.run_id = run.id
      where run.id = ${runId} and run.pass = 'workflow' and run.status = 'running'
        and run.claimed_by = ${workerId} and run.claim_token = ${claimToken}
        and run.workflow_artifact_set_id is distinct from ${claimToken}
      on conflict (run_id, artifact_set_id, artifact_key) do update set
        relative_path = excluded.relative_path,
        filename = excluded.filename,
        content_type = excluded.content_type,
        sha256 = excluded.sha256,
        byte_size = excluded.byte_size,
        workflow_id = excluded.workflow_id,
        workflow_version = excluded.workflow_version,
        workflow_contract_sha256 = excluded.workflow_contract_sha256,
        damm_model_version = excluded.damm_model_version,
        damm_model_revision = excluded.damm_model_revision,
        damm_model_sha256 = excluded.damm_model_sha256,
        damm_source_commit = excluded.damm_source_commit,
        assessment_input_sha256 = excluded.assessment_input_sha256,
        content_verified_at = excluded.content_verified_at,
        content = excluded.content,
        created_at = now()
      returning artifact_key`;
    return rows.length === 1;
  });
}

interface LockedWorkflowArtifactPublicationRow {
  artifact_key: string;
  workflow_id: string;
  workflow_version: string;
  workflow_contract_sha256: string;
  damm_model_version: string | null;
  damm_model_revision: number | null;
  damm_model_sha256: string | null;
  damm_source_commit: string | null;
  assessment_input_sha256: string | null;
  content_verified_at: Date | null;
}

/** Select a complete staged set while the claim is still held. */
export async function publishWorkflowArtifactSet(
  runId: string,
  workerId: string,
  claimToken: string,
  expectedKeys: readonly string[],
  database?: Sql,
): Promise<boolean> {
  if (expectedKeys.length === 0 || new Set(expectedKeys).size !== expectedKeys.length) return false;
  const sql = database ?? (await getSql());
  const canonicalMethodology = DAMM_WORKFLOW_METHODOLOGY;
  return sql.transaction(async (transaction) => {
    const held = await lockCanonicalWorkflowClaim(runId, workerId, claimToken, transaction);
    if (!held) return false;

    // Lock the complete selected set in a stable order before validating it. Because
    // staging first locks the same run row, this also closes the insert/phantom window:
    // a save begun earlier commits before this read, and a later save observes the
    // selected pointer and refuses to write.
    const artifacts = await transaction.query<LockedWorkflowArtifactPublicationRow>(
      `select artifact_key, workflow_id, workflow_version, workflow_contract_sha256,
              damm_model_version, damm_model_revision, damm_model_sha256,
              damm_source_commit, assessment_input_sha256, content_verified_at
       from workflow_run_artifacts
       where run_id = $1 and artifact_set_id = $2
       order by artifact_key
       for update`,
      [runId, claimToken],
    );
    const expected = new Set(expectedKeys);
    const assessmentInputs = new Set<string>();
    const complete =
      artifacts.length === expected.size &&
      artifacts.every((artifact) => {
        if (artifact.assessment_input_sha256) {
          assessmentInputs.add(artifact.assessment_input_sha256);
        }
        return (
          expected.has(artifact.artifact_key) &&
          artifact.workflow_id === DAR_WORKFLOW.workflow_id &&
          artifact.workflow_version === DAR_WORKFLOW.workflow_version &&
          artifact.workflow_contract_sha256 === DAR_WORKFLOW_SHA256 &&
          artifact.damm_model_version === canonicalMethodology.modelVersion &&
          Number(artifact.damm_model_revision) === canonicalMethodology.modelRevision &&
          artifact.damm_model_sha256 === canonicalMethodology.appModelSha256 &&
          artifact.damm_source_commit === canonicalMethodology.sourceCommit &&
          artifact.assessment_input_sha256 !== null &&
          artifact.content_verified_at !== null
        );
      }) &&
      assessmentInputs.size === 1;
    if (!complete) return false;

    const published = await transaction<{ id: string }>`
      update runs set workflow_artifact_set_id = ${claimToken}, updated_at = now()
      where id = ${runId} and pass = 'workflow' and status = 'running'
        and claimed_by = ${workerId} and claim_token = ${claimToken}
      returning id`;
    if (published.length !== 1) return false;
    await transaction`
      delete from workflow_run_artifacts
      where run_id = ${runId} and artifact_set_id <> ${claimToken}`;
    return true;
  });
}

function byteArray(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string" && /^\\x[0-9a-f]*$/i.test(value)) {
    return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  }
  return null;
}

interface PublishedWorkflowArtifactRow {
  run_id: string;
  artifact_set_id: string;
  completed_at: Date;
  artifact_key: string;
  relative_path: string;
  filename: string;
  content_type: string;
  sha256: string;
  byte_size: number;
  content_verified_at: Date | null;
  methodology_status: WorkflowMethodologyStatus;
}

export type PublishedWorkflowArtifactMetadata = Omit<PublishedWorkflowArtifact, "content">;

function publishedWorkflowArtifactMetadata(
  row: PublishedWorkflowArtifactRow,
): PublishedWorkflowArtifactMetadata {
  return {
    runId: row.run_id,
    artifactSetId: row.artifact_set_id,
    completedAt: new Date(row.completed_at),
    contentVerifiedAt: row.content_verified_at ? new Date(row.content_verified_at) : null,
    key: row.artifact_key,
    relativePath: row.relative_path,
    filename: row.filename,
    contentType: row.content_type,
    sha256: row.sha256,
    byteSize: Number(row.byte_size),
    methodologyStatus: row.methodology_status,
  };
}

async function readVerifiedPublishedWorkflowArtifact(
  input: {
    runId: string;
    key: string;
    userId: string;
    countryId?: string;
    artifactSetId?: string;
    sha256?: string;
    lock?: boolean;
  },
  sql: Sql,
): Promise<PublishedWorkflowArtifactMetadata | null> {
  const lockClause = input.lock ? "for update of workflow_run, artifact" : "";
  const rows = await sql.query<PublishedWorkflowArtifactRow>(
    `select workflow_run.id as run_id,
            workflow_run.workflow_artifact_set_id as artifact_set_id,
            workflow_run.finished_at as completed_at,
            artifact.artifact_key, artifact.relative_path, artifact.filename,
            artifact.content_type, artifact.sha256, artifact.byte_size,
            artifact.content_verified_at,
            case when methodology.run_id is null then 'legacy_unverified'
                 else 'canonical' end as methodology_status
     from runs workflow_run
     left join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
     join workflow_run_artifacts artifact
       on artifact.run_id = workflow_run.id
      and artifact.artifact_set_id = workflow_run.workflow_artifact_set_id
     where workflow_run.id = $1 and workflow_run.user_id = $2
       and workflow_run.pass = 'workflow' and workflow_run.status = 'done'
       and workflow_run.workflow_artifact_set_id is not null
       and workflow_run.finished_at is not null
       and artifact.artifact_key = $3
       and ($4::text is null or workflow_run.country_id = $4)
       and ($5::text is null or workflow_run.workflow_artifact_set_id = $5)
       and ($6::text is null or artifact.sha256 = $6)
       and artifact.workflow_id = $7
       and artifact.workflow_version = $8
       and artifact.workflow_contract_sha256 = $9
       and (
         (
           methodology.run_id is not null
           and artifact.damm_model_version = methodology.model_version
           and artifact.damm_model_revision = methodology.model_revision
           and artifact.damm_model_sha256 = methodology.app_model_sha256
           and artifact.damm_source_commit = methodology.source_commit
           and artifact.assessment_input_sha256 is not null
           and artifact.content_verified_at is not null
         )
         or (
           methodology.run_id is null
           and artifact.damm_model_version is null
           and artifact.damm_model_revision is null
           and artifact.damm_model_sha256 is null
           and artifact.damm_source_commit is null
           and artifact.assessment_input_sha256 is null
         )
       )
     limit 1
     ${lockClause}`,
    [
      input.runId,
      input.userId,
      input.key,
      input.countryId ?? null,
      input.artifactSetId ?? null,
      input.sha256 ?? null,
      DAR_WORKFLOW.workflow_id,
      DAR_WORKFLOW.workflow_version,
      DAR_WORKFLOW_SHA256,
    ],
  );
  return rows[0] ? publishedWorkflowArtifactMetadata(rows[0]) : null;
}

async function readVerifiedPublishedWorkflowArtifactContent(
  metadata: PublishedWorkflowArtifactMetadata,
  sql: Sql,
): Promise<Uint8Array | null> {
  const rows = await sql.query<{ content: unknown }>(
    `select content from workflow_run_artifacts
     where run_id = $1 and artifact_set_id = $2 and artifact_key = $3 and sha256 = $4
     limit 1`,
    [metadata.runId, metadata.artifactSetId, metadata.key, metadata.sha256],
  );
  const content = byteArray(rows[0]?.content);
  if (
    !content ||
    content.byteLength !== metadata.byteSize ||
    createHash("sha256").update(content).digest("hex") !== metadata.sha256
  ) {
    return null;
  }
  if (!metadata.contentVerifiedAt) {
    await sql.query(
      `update workflow_run_artifacts set content_verified_at = now()
       where run_id = $1 and artifact_set_id = $2 and artifact_key = $3
         and content_verified_at is null`,
      [metadata.runId, metadata.artifactSetId, metadata.key],
    );
  }
  return content;
}

/** Authorize and read immutable artifact identity without loading its potentially huge bytes. */
export async function getPublishedWorkflowArtifactMetadata(
  runId: string,
  key: string,
  userId: string,
  database?: Sql,
): Promise<PublishedWorkflowArtifactMetadata | null> {
  const sql = database ?? (await getSql());
  return readVerifiedPublishedWorkflowArtifact({ runId, key, userId }, sql);
}

/** Load and re-hash bytes for local delivery after metadata authorization. */
export async function getPublishedWorkflowArtifactContent(
  metadata: PublishedWorkflowArtifactMetadata,
  database?: Sql,
): Promise<Uint8Array | null> {
  const sql = database ?? (await getSql());
  return readVerifiedPublishedWorkflowArtifactContent(metadata, sql);
}

/** Read only the artifact set atomically published by a completed canonical run. */
export async function getPublishedWorkflowArtifact(
  runId: string,
  key: string,
  userId: string,
  database?: Sql,
): Promise<PublishedWorkflowArtifact | null> {
  const sql = database ?? (await getSql());
  const metadata = await getPublishedWorkflowArtifactMetadata(runId, key, userId, sql);
  if (!metadata) return null;
  const content = await getPublishedWorkflowArtifactContent(metadata, sql);
  if (!content) return null;
  return { ...metadata, content };
}

export async function listPublishedWorkflowArtifactDownloads(
  runId: string,
  userId: string,
  database?: Sql,
): Promise<{ key: string; byteSize: number }[]> {
  const sql = database ?? (await getSql());
  const rows = await sql<{
    artifact_key: string;
    byte_size: number;
    content_verified_at: Date | null;
  }>`
    select artifact.artifact_key, artifact.byte_size, artifact.content_verified_at
    from runs
    left join workflow_run_methodology methodology on methodology.run_id = runs.id
    join workflow_run_artifacts artifact
      on artifact.run_id = runs.id
     and artifact.artifact_set_id = runs.workflow_artifact_set_id
    where runs.id = ${runId} and runs.user_id = ${userId}
      and runs.pass = 'workflow' and runs.status = 'done'
      and artifact.workflow_id = ${DAR_WORKFLOW.workflow_id}
      and artifact.workflow_version = ${DAR_WORKFLOW.workflow_version}
      and artifact.workflow_contract_sha256 = ${DAR_WORKFLOW_SHA256}
      and (
        (
          methodology.run_id is not null
          and artifact.damm_model_version = methodology.model_version
          and artifact.damm_model_revision = methodology.model_revision
          and artifact.damm_model_sha256 = methodology.app_model_sha256
          and artifact.damm_source_commit = methodology.source_commit
          and artifact.assessment_input_sha256 is not null
          and artifact.content_verified_at is not null
        )
        or (
          methodology.run_id is null
          and artifact.damm_model_version is null
          and artifact.damm_model_revision is null
          and artifact.damm_model_sha256 is null
          and artifact.damm_source_commit is null
          and artifact.assessment_input_sha256 is null
        )
      )
    order by artifact.artifact_key`;
  const verified: { key: string; byteSize: number }[] = [];
  for (const row of rows) {
    if (
      row.content_verified_at ||
      (await getPublishedWorkflowArtifact(runId, row.artifact_key, userId, sql))
    ) {
      verified.push({ key: row.artifact_key, byteSize: Number(row.byte_size) });
    }
  }
  return verified;
}

export async function listPublishedWorkflowArtifactKeys(
  runId: string,
  userId: string,
  database?: Sql,
): Promise<string[]> {
  return (await listPublishedWorkflowArtifactDownloads(runId, userId, database)).map(
    (item) => item.key,
  );
}

export type WorkflowReviewOutcome = "reviewed" | "revisions_required";

export interface WorkflowReviewTarget {
  runId: string;
  artifactSetId: string;
  bundleSha256: string;
  completedAt: Date;
  methodologyStatus: WorkflowMethodologyStatus;
}

export interface WorkflowReviewRecord extends WorkflowReviewTarget {
  id: string;
  reviewerId: string;
  outcome: WorkflowReviewOutcome;
  notes: string;
  reviewedAt: Date;
}

/** Latest owner-visible Draft package that has completed and been atomically published. */
export async function latestWorkflowReviewTarget(
  countryId: string,
  userId: string,
  database?: Sql,
): Promise<WorkflowReviewTarget | null> {
  const sql = database ?? (await getSql());
  const candidates = await sql<{ run_id: string }>`
    select run.id as run_id
    from runs run
    where run.country_id = ${countryId} and run.user_id = ${userId}
      and run.pass = 'workflow' and run.status = 'done'
      and run.workflow_artifact_set_id is not null and run.finished_at is not null
    order by run.finished_at desc, run.created_at desc
    `;
  for (const candidate of candidates) {
    const bundle = await readVerifiedPublishedWorkflowArtifact(
      { runId: candidate.run_id, key: "bundle", userId, countryId },
      sql,
    );
    if (
      bundle &&
      (bundle.contentVerifiedAt ||
        (await readVerifiedPublishedWorkflowArtifactContent(bundle, sql)))
    ) {
      return {
        runId: bundle.runId,
        artifactSetId: bundle.artifactSetId,
        bundleSha256: bundle.sha256,
        completedAt: bundle.completedAt,
        methodologyStatus: bundle.methodologyStatus,
      };
    }
  }
  return null;
}

export async function listWorkflowReviews(
  countryId: string,
  userId: string,
  database?: Sql,
): Promise<WorkflowReviewRecord[]> {
  const sql = database ?? (await getSql());
  const rows = await sql<{
    id: string;
    run_id: string;
    artifact_set_id: string;
    bundle_sha256: string;
    reviewer_id: string;
    outcome: string;
    notes: string;
    reviewed_at: Date;
    completed_at: Date;
    methodology_status: WorkflowMethodologyStatus;
  }>`
    select review.id, review.run_id, review.artifact_set_id, review.bundle_sha256,
           review.reviewer_id, review.outcome, review.notes, review.reviewed_at,
           run.finished_at as completed_at,
           case when methodology.run_id is null then 'legacy_unverified'
                else 'canonical' end as methodology_status
    from workflow_run_reviews review
    join runs run on run.id = review.run_id
    left join workflow_run_methodology methodology on methodology.run_id = run.id
    where run.country_id = ${countryId} and run.user_id = ${userId}
      and run.pass = 'workflow'
    order by review.reviewed_at desc`;
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    artifactSetId: row.artifact_set_id,
    bundleSha256: row.bundle_sha256,
    reviewerId: row.reviewer_id,
    outcome: row.outcome as WorkflowReviewOutcome,
    notes: row.notes,
    reviewedAt: new Date(row.reviewed_at),
    completedAt: new Date(row.completed_at),
    methodologyStatus: row.methodology_status,
  }));
}

/** Persist review only for the owner's exact, currently published completed package. */
export async function recordWorkflowReview(
  input: {
    id: string;
    runId: string;
    countryId: string;
    reviewerId: string;
    artifactSetId: string;
    bundleSha256: string;
    outcome: WorkflowReviewOutcome;
    notes: string;
  },
  database?: Sql,
): Promise<WorkflowReviewRecord | null> {
  if (!(["reviewed", "revisions_required"] as const).includes(input.outcome)) return null;
  if (input.notes.length > 5000) return null;
  const sql = database ?? (await getSql());
  return sql.transaction(async (transaction) => {
    const bundle = await readVerifiedPublishedWorkflowArtifact(
      {
        runId: input.runId,
        key: "bundle",
        userId: input.reviewerId,
        countryId: input.countryId,
        artifactSetId: input.artifactSetId,
        sha256: input.bundleSha256,
        lock: true,
      },
      transaction,
    );
    if (!bundle) return null;
    if (
      !bundle.contentVerifiedAt &&
      !(await readVerifiedPublishedWorkflowArtifactContent(bundle, transaction))
    ) {
      return null;
    }

    const rows = await transaction<{
      id: string;
      reviewed_at: Date;
    }>`
      insert into workflow_run_reviews
        (id, run_id, artifact_set_id, bundle_sha256, reviewer_id, outcome, notes)
      values (${input.id}, ${bundle.runId}, ${bundle.artifactSetId}, ${bundle.sha256},
              ${input.reviewerId}, ${input.outcome}, ${input.notes})
      returning id, reviewed_at`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          runId: bundle.runId,
          artifactSetId: bundle.artifactSetId,
          bundleSha256: bundle.sha256,
          reviewerId: input.reviewerId,
          outcome: input.outcome,
          notes: input.notes,
          reviewedAt: new Date(row.reviewed_at),
          completedAt: bundle.completedAt,
          methodologyStatus: bundle.methodologyStatus,
        }
      : null;
  });
}

export async function getRun(id: string, userId: string, database?: Sql): Promise<Run | null> {
  const sql = database ?? (await getSql());
  const rows = await sql<RunRow>`
    select id, user_id, country_id, country_name, iso3, pass, status,
           ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at, finished_at, stopped_reason
    from runs where id = ${id} and user_id = ${userId}`;
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRuns(userId: string, limit = 50): Promise<Run[]> {
  const sql = await getSql();
  const rows = await sql<RunRow>`
    select id, user_id, country_id, country_name, iso3, pass, status,
           ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at, finished_at, stopped_reason
    from runs where user_id = ${userId}
    order by created_at desc limit ${limit}`;
  return rows.map(toRun);
}

/**
 * Take the oldest claimable run, atomically.
 *
 * Claimable means queued, or running with a heartbeat older than the lease — a worker
 * that died. The `where` clause re-checks both conditions inside the update, so the
 * decision and the write cannot be separated by another worker.
 */
export async function claimNextRun(workerId: string, database?: Sql): Promise<ClaimedRun | null> {
  const sql = database ?? (await getSql());
  const claimToken = randomUUID();
  const rows = await sql<RunRow>`
    update runs set
      status = 'running',
      claimed_by = ${workerId},
      claim_token = ${claimToken},
      heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where id = (
      select id from runs
      where status = 'queued'
         or (status = 'running'
             and (heartbeat_at is null
                  or heartbeat_at < now() - (${CLAIM_LEASE_MS}::bigint * interval '1 millisecond')))
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, user_id, country_id, country_name, iso3, pass, status,
              ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
              claimed_by, claim_token, heartbeat_at, started_at, finished_at,
              stopped_reason`;
  return rows[0] ? { ...toRun(rows[0]), claimToken } : null;
}

/**
 * Return a claim acquired concurrently with shutdown before its pipeline starts.
 *
 * The worker/claim-token/status guard is the same ownership boundary as heartbeat and
 * finish. A stale process therefore cannot replay an old release against a newer claim.
 * The status event makes the brief claim/requeue transition durable without inventing a
 * completed or failed run.
 */
export async function releaseClaim(
  runId: string,
  workerId: string,
  claimToken: string,
  database?: Sql,
): Promise<boolean> {
  const sql = database ?? (await getSql());
  const rows = await sql<{ run_id: string }>`
    with released as (
      update runs set status = 'queued', claimed_by = null, claim_token = null,
                      heartbeat_at = null, finished_at = null, stopped_reason = null,
                      updated_at = now()
      where id = ${runId} and status = 'running'
        and claimed_by = ${workerId} and claim_token = ${claimToken}
      returning id
    )
    insert into run_events (run_id, kind, message)
    select id, 'status',
           'Worker shutdown arrived during queue claim; returned to queue before execution.'
    from released
    returning run_id`;
  return rows.length > 0;
}

/** Say the worker is still alive. Returns false if the claim was taken from it. */
export async function heartbeat(
  runId: string,
  workerId: string,
  claimToken: string,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update runs set heartbeat_at = now(), updated_at = now()
    where id = ${runId} and claimed_by = ${workerId} and claim_token = ${claimToken}
      and status = 'running'
    returning id`;
  return rows.length > 0;
}

/** Progress from a row event. Spend is cumulative, so it is set rather than added. */
export async function recordRow(
  runId: string,
  workerId: string,
  claimToken: string,
  e: {
    indicatorId: string;
    rowsDone: number;
    rowsTotal: number;
    spentUsd: number | null;
    outcome: string;
  },
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    with held as (
      update runs set rows_done = ${e.rowsDone}, rows_total = ${e.rowsTotal},
                      spent_usd = coalesce(${e.spentUsd}, spent_usd),
                      heartbeat_at = now(), updated_at = now()
      where id = ${runId} and status = 'running'
        and claimed_by = ${workerId} and claim_token = ${claimToken}
      returning id
    ), recorded as (
      insert into run_events (run_id, kind, indicator_id, message, payload)
      select id, 'row', ${e.indicatorId}, ${e.outcome},
             ${JSON.stringify({ rowsDone: e.rowsDone, rowsTotal: e.rowsTotal, spentUsd: e.spentUsd })}::jsonb
      from held
    )
    select id from held`;
  return rows.length > 0;
}

export async function setRowsTotal(
  runId: string,
  workerId: string,
  claimToken: string,
  rowsTotal: number,
  vendor: string | null,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update runs set rows_total = ${rowsTotal},
                    vendor = coalesce(${vendor}, vendor), updated_at = now()
    where id = ${runId} and status = 'running'
      and claimed_by = ${workerId} and claim_token = ${claimToken}
    returning id`;
  return rows.length > 0;
}

export async function noteEvent(runId: string, userId: string, kind: string, message: string) {
  const sql = await getSql();
  await sql`
    insert into run_events (run_id, kind, message)
    select id, ${kind}, ${message} from runs
    where id = ${runId} and user_id = ${userId}`;
}

export async function noteWorkerEvent(
  runId: string,
  workerId: string,
  claimToken: string,
  kind: string,
  message: string,
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ run_id: string }>`
    insert into run_events (run_id, kind, message)
    select id, ${kind}, ${message} from runs
    where id = ${runId} and status = 'running'
      and claimed_by = ${workerId} and claim_token = ${claimToken}
    returning run_id`;
  return rows.length > 0;
}

/**
 * End a run. `spentUsd` comes from the pipeline's own ledger file when it can be read,
 * because stdout is for liveness and the ledger is the source of record.
 */
export async function finishRun(
  runId: string,
  workerId: string,
  claimToken: string,
  status: RunStatus,
  reason: string,
  spentUsd?: number,
  database?: Sql,
): Promise<boolean> {
  const sql = database ?? (await getSql());
  const rows = await sql<{ id: string }>`
    with held as (
      update runs set status = ${status},
                      stopped_reason = ${reason || null},
                      spent_usd = coalesce(${spentUsd ?? null}, spent_usd),
                      workflow_artifact_set_id = case
                        when ${status} = 'done' and pass = 'workflow'
                          then workflow_artifact_set_id
                        when pass = 'workflow' then null
                        else workflow_artifact_set_id
                      end,
                      finished_at = now(),
                      claimed_by = null,
                      claim_token = null,
                      updated_at = now()
      where id = ${runId} and status = 'running'
        and claimed_by = ${workerId} and claim_token = ${claimToken}
        and (
          ${status} <> 'done'
          or pass <> 'workflow'
          or workflow_artifact_set_id = ${claimToken}
        )
      returning id
    ), recorded as (
      insert into run_events (run_id, kind, message)
      select id, 'status', ${status + (reason ? `: ${reason}` : "")} from held
    )
    select id from held`;
  return rows.length > 0;
}

/** Change status without ending the run — pause, cancel, or re-queue after a top-up. */
export async function setStatus(
  runId: string,
  userId: string,
  status: RunStatus,
  opts: { ceilingUsd?: number; reason?: string; expectedStatus?: RunStatus } = {},
): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    with changed as (
      update runs set status = ${status},
                      ceiling_usd = coalesce(${opts.ceilingUsd ?? null}, ceiling_usd),
                      stopped_reason = ${opts.reason ?? null},
                      claimed_by = case when ${status} in ('queued', 'paused', 'cancelled') then null else claimed_by end,
                      claim_token = case when ${status} in ('queued', 'paused', 'cancelled') then null else claim_token end,
                      finished_at = case when ${status} = 'cancelled' then now() else null end,
                      updated_at = now()
      where id = ${runId} and user_id = ${userId}
        and (${opts.expectedStatus ?? null}::text is null or status = ${opts.expectedStatus ?? null})
      returning id
    ), recorded as (
      insert into run_events (run_id, kind, message)
      select id, 'status', ${status} from changed
    )
    select id from changed`;
  return rows.length === 1;
}

export interface RunEventRow {
  id: number;
  at: Date;
  kind: string;
  indicatorId: string | null;
  message: string | null;
}

export async function listEvents(
  runId: string,
  userId: string,
  sinceId = 0,
  limit = 200,
): Promise<RunEventRow[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    at: Date;
    kind: string;
    indicator_id: string | null;
    message: string | null;
  }>`
    select event.id, event.at, event.kind, event.indicator_id, event.message
    from run_events event
    join runs on runs.id = event.run_id
    where event.run_id = ${runId} and runs.user_id = ${userId} and event.id > ${sinceId}
    order by event.id limit ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at),
    kind: r.kind,
    indicatorId: r.indicator_id,
    message: r.message,
  }));
}

/**
 * The unfinished run holding a country's place for a pass.
 *
 * Everything that is not terminal counts, exhausted included. An exhausted run is not
 * finished — it can be continued from where it stopped — so starting a second pass beside
 * it would research the rows the first one already paid for.
 */
export async function findActiveRun(
  countryId: string,
  pass: RunPass,
  userId: string,
  database?: Sql,
): Promise<Run | null> {
  const sql = database ?? (await getSql());
  const rows = await sql<RunRow>`
    select id, user_id, country_id, country_name, iso3, pass, status,
           ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at, finished_at, stopped_reason
    from runs
    where country_id = ${countryId} and user_id = ${userId} and pass = ${pass}
      and status not in ('done', 'failed', 'cancelled')
    order by created_at desc limit 1`;
  return rows[0] ? toRun(rows[0]) : null;
}

/** One canonical workflow owns the country while it is active, across all legacy passes. */
export async function findActiveCountryRun(
  countryId: string,
  userId: string,
  database?: Sql,
): Promise<Run | null> {
  const sql = database ?? (await getSql());
  const rows = await sql<RunRow>`
    select id, user_id, country_id, country_name, iso3, pass, status,
           ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at, finished_at, stopped_reason
    from runs
    where country_id = ${countryId} and user_id = ${userId}
      and status not in ('done', 'failed', 'cancelled')
    order by created_at desc limit 1`;
  return rows[0] ? toRun(rows[0]) : null;
}

/**
 * The country's most recent research pass that produced output. Later passes read its
 * files, so its basename is what they must be given.
 */
export async function latestCompletedResearch(
  countryId: string,
  userId: string,
  database?: Sql,
): Promise<Run | null> {
  const sql = database ?? (await getSql());
  const rows = await sql<RunRow>`
    select id, user_id, country_id, country_name, iso3, pass, status,
           ceiling_usd, spent_usd, rows_total, rows_done, vendor, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at, finished_at, stopped_reason
    from runs
    where country_id = ${countryId} and user_id = ${userId}
      and pass = 'research' and status = 'done'
    order by finished_at desc nulls last, created_at desc limit 1`;
  return rows[0] ? toRun(rows[0]) : null;
}
