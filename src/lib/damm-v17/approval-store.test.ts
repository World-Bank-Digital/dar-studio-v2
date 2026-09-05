import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../db.ts";
import {
  assignApprovalReviewer,
  ensureApprovalPackage,
  getApprovalArtifactAccess,
  getAssignedReview,
  getOwnerApprovalState,
  openOwnerApprovalState,
  submitAssignedReview,
  submitCountryOwnerSignoff,
  type ApprovalAssignment,
  type ApprovalPackage,
  type ApprovalStoreResult,
} from "./approval-store.ts";
import {
  buildG2ReviewScope,
  canonicalizeMachineFilledObservationRows,
  G3_AFFIRMATION_IDS,
  HUMAN_REVIEW_AFFIRMATIONS,
  type G3AffirmationChecklist,
} from "./approvals.ts";
import { DAMM_WORKFLOW_METHODOLOGY } from "./methodology.ts";
import {
  buildSyntheticStoredStage8Package,
  type SyntheticStoredStage8Package,
} from "./stage8-boundary.test-helper.ts";

function sqlFor(pg: PGlite): Sql {
  type Queryable = {
    query<T>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
  const wrap = (queryable: Queryable): Sql => {
    const sql = (async <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> => {
      let query = strings[0];
      for (let index = 0; index < values.length; index += 1) {
        query += `$${index + 1}${strings[index + 1]}`;
      }
      return (await queryable.query<T>(query, values)).rows;
    }) as Sql;
    sql.query = async <T = Record<string, unknown>>(query: string, values: unknown[] = []) =>
      (await queryable.query<T>(query, values)).rows;
    sql.transaction = async (callback) => callback(sql);
    return sql;
  };
  const sql = wrap(pg);
  sql.transaction = (callback) => pg.transaction((transaction) => callback(wrap(transaction)));
  return sql;
}

function observeSql(
  database: Sql,
  hooks: { onQuery: (text: string) => void; onTransaction: () => void },
): Sql {
  const wrap = (delegate: Sql): Sql => {
    const observed = (async <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> => {
      hooks.onQuery(strings.join("$?"));
      return delegate<T>(strings, ...values);
    }) as Sql;
    observed.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      hooks.onQuery(text);
      return delegate.query<T>(text, params);
    };
    observed.transaction = <T>(callback: (sql: Sql) => Promise<T>) => {
      hooks.onTransaction();
      return delegate.transaction((transaction) => callback(wrap(transaction)));
    };
    return observed;
  };
  return wrap(database);
}

async function migratedDatabase(): Promise<{ pg: PGlite; sql: Sql }> {
  const pg = new PGlite();
  await pg.waitReady;
  const migrations = new URL("../../../migrations/", import.meta.url);
  const names = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) await pg.exec(await readFile(new URL(name, migrations), "utf8"));
  return { pg, sql: sqlFor(pg) };
}

function unwrap<T>(result: ApprovalStoreResult<T>): T {
  if (!result.ok) assert.fail(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function assertMethodologyRefusal<T>(result: ApprovalStoreResult<T>): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "METHODOLOGY_UNVERIFIED");
    assert.match(result.error.message, /historical|current methodology|methodology-unverified/i);
  }
}

function allAffirmations(): G3AffirmationChecklist {
  return Object.fromEntries(G3_AFFIRMATION_IDS.map((id) => [id, true])) as G3AffirmationChecklist;
}

const USERS = {
  owner: { id: "owner-user", name: "Country TTL", email: "ttl@example.test" },
  assessor: { id: "assessor-user", name: "Named Assessor", email: "assessor@example.test" },
  peer: { id: "peer-user", name: "Independent Peer", email: "peer@example.test" },
  other: { id: "other-user", name: "Other Reviewer", email: "other@example.test" },
} as const;

const PRE_0014_DAMM_SOURCE_COMMIT = "92c6ffe8b331347bc05f345785fe409753401a24";
const PRE_0015_DAMM_SOURCE_COMMIT = "d4c659f5873f3a891634c8edf6b7166cb2eb374c";
const PRE_0016_DAMM_SOURCE_COMMIT = "2efb26607acc29a687a82a56edc85f53c4a6da69";
const PRE_0017_DAMM_SOURCE_COMMIT = "1b1734c8a8017cda488b77cf0594b0ca82dae6ee";
const PRE_0018_DAMM_SOURCE_COMMIT = "4b97b2c9090204dfba3aa7c44f41d558005982ee";
const PRE_0020_DAMM_SOURCE_COMMIT = "386ccb90904de4109b64b7c62d4ed7beed8daede";
const PRE_0020_DAMM_RENDERER_SHA256 =
  "9dc5d6169c2ae6694d9a0dbc165e61d6557b2589075b962e8def98ec13fd6ba8";
const PRE_0021_DAMM_SOURCE_COMMIT = "e866e7a1fffd5edb14f53da5e038f69b2ec29af2";
const PRE_0021_DAMM_RENDERER_SHA256 =
  "95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be";
const PRE_0022_DAMM_SOURCE_COMMIT = "f7dfbbb647e0a45d996e94f62d49f2218d518c94";
const PRE_0022_DAMM_RENDERER_SHA256 =
  "95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be";
const PRE_0023_DAMM_SOURCE_COMMIT = "ff5aecbfec5c2694a61f282c27db74ea8b99b28c";
const PRE_0023_DAMM_RENDERER_SHA256 =
  "95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be";
const PRE_0024_DAMM_SOURCE_COMMIT = "68e1994b5facfaaf0ddc49ba3bec108d9bde2c55";
const PRE_0024_DAMM_RENDERER_SHA256 = PRE_0023_DAMM_RENDERER_SHA256;
const PRE_0027_DAMM_SOURCE_COMMIT = "d708dbd0129cfb7f37dcf003875c439367b7c97d";
const PRE_0027_DAMM_RENDERER_SHA256 = PRE_0023_DAMM_RENDERER_SHA256;
const PRE_0028_DAMM_SOURCE_COMMIT = "7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb";
const PRE_0028_DAMM_RENDERER_SHA256 = PRE_0023_DAMM_RENDERER_SHA256;
const PRE_0026_DAMM_SOURCE_COMMIT = "d81d267133eed52b5fdcc599bfecf8d72496f292";
const PRE_0026_DAMM_RENDERER_SHA256 = PRE_0023_DAMM_RENDERER_SHA256;
const PRE_0025_DAMM_SOURCE_COMMIT = "76ca33d97f0809a6be7477447786953317aa41b5";
const PRE_0025_DAMM_RENDERER_SHA256 = PRE_0023_DAMM_RENDERER_SHA256;

interface Fixture {
  pg: PGlite;
  sql: Sql;
  countryId: string;
  runId: string;
  artifactSetId: string;
  bundle: Uint8Array;
  observations: Uint8Array;
  assessmentInput: Uint8Array;
  approvalPackage: ApprovalPackage;
}

function canonicalJson(value: unknown): string {
  const sort = (child: unknown): unknown => {
    if (Array.isArray(child)) return child.map(sort);
    if (child && typeof child === "object") {
      return Object.fromEntries(
        Object.entries(child as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sort(nested)]),
      );
    }
    return child;
  };
  return JSON.stringify(sort(value));
}

function historicalRendererSha256(sourceCommit: string): string {
  return sourceCommit === PRE_0028_DAMM_SOURCE_COMMIT ||
    sourceCommit === PRE_0027_DAMM_SOURCE_COMMIT ||
    sourceCommit === PRE_0026_DAMM_SOURCE_COMMIT ||
    sourceCommit === PRE_0025_DAMM_SOURCE_COMMIT ||
    sourceCommit === PRE_0023_DAMM_SOURCE_COMMIT ||
    sourceCommit === PRE_0022_DAMM_SOURCE_COMMIT ||
    sourceCommit === PRE_0021_DAMM_SOURCE_COMMIT
    ? PRE_0022_DAMM_RENDERER_SHA256
    : PRE_0020_DAMM_RENDERER_SHA256;
}

function historicalTargetIdentity(
  approvalPackage: ApprovalPackage,
  sourceCommit = PRE_0023_DAMM_SOURCE_COMMIT,
  rendererSha256 = historicalRendererSha256(sourceCommit),
): {
  methodology: ApprovalPackage["methodology"];
  targetIdentitySha256: string;
} {
  const methodology = Object.freeze({
    ...approvalPackage.methodology,
    sourceCommit,
    rendererSha256,
  });
  const identity = {
    schemaVersion: "damm.approval-package/v1",
    workflowRunId: approvalPackage.runId,
    artifactSetId: approvalPackage.artifactSetId,
    completeBundleSha256: approvalPackage.bundleSha256,
    observationsArtifactKey: "data-damm_diagnostic-damm_observations-json",
    observationsSha256: approvalPackage.observationsSha256,
    workflow: {
      id: approvalPackage.workflowId,
      version: approvalPackage.workflowVersion,
      contractSha256: approvalPackage.workflowContractSha256,
    },
    methodology,
    assessmentInputArtifactKey: approvalPackage.assessmentInputArtifactKey,
    assessmentInputSourcePath: approvalPackage.assessmentInputSourcePath,
    assessmentInputSha256: approvalPackage.assessmentInputSha256,
    machineRowCount: approvalPackage.machineRowCount,
    machineRowSetSha256: approvalPackage.machineRowSetSha256,
    g1ScopeSha256: approvalPackage.g1ScopeSha256,
    g2ScopeSha256: approvalPackage.g2ScopeSha256,
    completedAt: approvalPackage.completedAt,
  };
  return {
    methodology,
    targetIdentitySha256: createHash("sha256").update(canonicalJson(identity)).digest("hex"),
  };
}

/**
 * Reconstruct the immutable identity an already-materialized package had immediately
 * before a source-pin migration. Trigger bypass is test setup only: production rows
 * were written under an earlier immutable pin and cutovers intentionally never rewrite them.
 */
async function makePackageHistorical(
  fx: Fixture,
  sourceCommit = PRE_0023_DAMM_SOURCE_COMMIT,
  rendererSha256 = historicalRendererSha256(sourceCommit),
): Promise<Fixture> {
  const { methodology, targetIdentitySha256 } = historicalTargetIdentity(
    fx.approvalPackage,
    sourceCommit,
    rendererSha256,
  );
  await fx.sql.query("set session_replication_role = replica");
  try {
    await fx.sql.query(
      `update workflow_run_methodology
       set source_commit = $2, renderer_sha256 = $3
       where run_id = $1`,
      [fx.runId, sourceCommit, rendererSha256],
    );
    await fx.sql.query(
      "update workflow_run_artifacts set damm_source_commit = $2 where run_id = $1",
      [fx.runId, sourceCommit],
    );
    for (const table of [
      "workflow_approval_rows",
      "workflow_approval_assignments",
      "workflow_approval_assignment_supersessions",
      "workflow_approval_decisions",
    ]) {
      await fx.sql.query(`update ${table} set target_identity_sha256 = $2 where package_id = $1`, [
        fx.approvalPackage.id,
        targetIdentitySha256,
      ]);
    }
    const releases = await fx.sql.query<{ id: string; manifest_json: Record<string, unknown> }>(
      `select id, manifest_json from workflow_approval_releases where package_id = $1`,
      [fx.approvalPackage.id],
    );
    for (const release of releases) {
      const manifest = structuredClone(release.manifest_json);
      manifest.targetIdentitySha256 = targetIdentitySha256;
      const manifestMethodology = manifest.methodology as Record<string, unknown>;
      manifestMethodology.sourceCommit = sourceCommit;
      manifestMethodology.rendererSha256 = rendererSha256;
      await fx.sql.query(
        `update workflow_approval_releases
         set target_identity_sha256 = $2, manifest_json = $3::jsonb,
             manifest_sha256 = $4
         where id = $1`,
        [
          release.id,
          targetIdentitySha256,
          JSON.stringify(manifest),
          createHash("sha256").update(canonicalJson(manifest)).digest("hex"),
        ],
      );
    }
    await fx.sql.query(
      `update workflow_approval_packages
       set damm_source_commit = $2, renderer_sha256 = $3, target_identity_sha256 = $4
       where id = $1`,
      [fx.approvalPackage.id, sourceCommit, rendererSha256, targetIdentitySha256],
    );
  } finally {
    await fx.sql.query("set session_replication_role = origin");
  }
  return {
    ...fx,
    approvalPackage: Object.freeze({
      ...fx.approvalPackage,
      methodology,
      targetIdentitySha256,
    }),
  };
}

async function approvalAuditSnapshot(fx: Fixture): Promise<unknown> {
  const snapshots = await fx.sql.query<{ snapshot: unknown }>(
    `select jsonb_build_object(
       'run', (select to_jsonb(workflow_run) from runs workflow_run where id = $1),
       'methodology', (
         select to_jsonb(methodology) from workflow_run_methodology methodology
         where run_id = $1
       ),
       'artifacts', coalesce((
         select jsonb_agg(
           (to_jsonb(artifact) - 'content') || jsonb_build_object(
             'stored_content_sha256', encode(sha256(artifact.content), 'hex')
           ) order by artifact.artifact_key
         )
         from workflow_run_artifacts artifact where artifact.run_id = $1
       ), '[]'::jsonb),
       'package', (
         select to_jsonb(package) from workflow_approval_packages package where id = $2
       ),
       'rows', coalesce((
         select jsonb_agg(to_jsonb(package_row) order by package_row.ordinal)
         from workflow_approval_rows package_row where package_row.package_id = $2
       ), '[]'::jsonb),
       'assignments', coalesce((
         select jsonb_agg(to_jsonb(assignment) order by assignment.id)
         from workflow_approval_assignments assignment where assignment.package_id = $2
       ), '[]'::jsonb),
       'supersessions', coalesce((
         select jsonb_agg(to_jsonb(supersession) order by supersession.id)
         from workflow_approval_assignment_supersessions supersession
         where supersession.package_id = $2
       ), '[]'::jsonb),
       'decisions', coalesce((
         select jsonb_agg(to_jsonb(decision_record) order by decision_record.id)
         from workflow_approval_decisions decision_record
         where decision_record.package_id = $2
       ), '[]'::jsonb),
       'releases', coalesce((
         select jsonb_agg(to_jsonb(release_record) order by release_record.id)
         from workflow_approval_releases release_record
         where release_record.package_id = $2
       ), '[]'::jsonb)
     ) as snapshot`,
    [fx.runId, fx.approvalPackage.id],
  );
  return snapshots[0].snapshot;
}

async function insertMethodology(sql: Sql, runId: string): Promise<void> {
  const value = DAMM_WORKFLOW_METHODOLOGY;
  await sql.query(
    `insert into workflow_run_methodology
      (run_id, manifest_schema_version, model_id, model_version, model_revision,
       model_status, model_ratified, app_model_sha256, app_model_schema_sha256,
       source_repository, source_commit, source_model_path, source_model_sha256,
       source_schema_path, source_schema_sha256, census_revision, census_path,
       census_sha256, engine_version, engine_path, engine_sha256, renderer_version,
       renderer_path, renderer_sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      runId,
      value.manifestSchemaVersion,
      value.modelId,
      value.modelVersion,
      value.modelRevision,
      value.modelStatus,
      value.modelRatified,
      value.appModelSha256,
      value.appModelSchemaSha256,
      value.sourceRepository,
      value.sourceCommit,
      value.sourceModelPath,
      value.sourceModelSha256,
      value.sourceSchemaPath,
      value.sourceSchemaSha256,
      value.censusRevision,
      value.censusPath,
      value.censusSha256,
      value.engineVersion,
      value.enginePath,
      value.engineSha256,
      value.rendererVersion,
      value.rendererPath,
      value.rendererSha256,
    ],
  );
}

function observationBytes(seed: string): Uint8Array {
  const rows = {
    "1.1": { value: `${seed}-1`, cls: "Measured", level: 2, src: "Source 1", year: 2025 },
    "1.2": { row: { value: `${seed}-2`, cls: "Judged", level: 3, src: "Human source" } },
    "1.3": { value: `${seed}-3`, cls: "Documented", level: 2, src: "Source 3" },
    "1.4": { value: `${seed}-4`, cls: "Gap", level: null, src: "Search trail" },
    "1.5": { value: `${seed}-5`, cls: "Measured", level: 4, src: "Source 5" },
    "1.6": { value: `${seed}-6`, cls: "Documented", level: 3, src: "Source 6" },
    "1.7": { value: `${seed}-7`, cls: "Measured", level: 1, src: "Source 7" },
    "1.8": { value: `${seed}-8`, cls: "Documented", level: 2, src: "Source 8" },
    "2.1": { value: `${seed}-9`, cls: "Measured", level: 5, src: "Prerequisite source" },
    "2.4": { value: `${seed}-10`, cls: "Documented", level: 4, src: "Source 10" },
  };
  return new TextEncoder().encode(JSON.stringify(rows));
}

function exactNumericCandidateBytes(seed: string): Uint8Array {
  const base = new TextDecoder().decode(observationBytes(seed));
  return new TextEncoder().encode(
    `${base.slice(0, -1)},` +
      `"A1-CAND-IMP":{"value":18.0,"ratio":1e-7,"cls":"Judged","level":null,"src":"Candidate source"},` +
      `"A1-CAND-IRR":{"value":9007199254740993,"reported":7402.00,"cls":"Measured","level":null,"src":"Candidate source"}}`,
  );
}

async function insertCompletedWorkflow(
  sql: Sql,
  input: {
    countryId: string;
    countryName: string;
    iso3: string;
    runId: string;
    artifactSetId: string;
    outBasename: string;
    observations: Uint8Array;
    assessmentInput?: Uint8Array;
    completedAt: string;
  },
): Promise<SyntheticStoredStage8Package> {
  const synthetic = await buildSyntheticStoredStage8Package({
    runId: input.runId,
    artifactSetId: input.artifactSetId,
    countryName: input.countryName,
    iso3: input.iso3,
    ceilingUsd: 100,
    vendor: null,
    observationsBytes: input.observations,
    assessmentInputBytes: input.assessmentInput,
  });
  await sql.transaction(async (transaction) => {
    await transaction.query(
      `insert into runs
        (id, user_id, country_id, country_name, iso3, pass, status, ceiling_usd,
         out_basename, claim_token, claimed_by)
       values ($1, $2, $3, $4, $5, 'workflow', 'running', 100, $6, $7, 'worker')`,
      [
        input.runId,
        USERS.owner.id,
        input.countryId,
        input.countryName,
        input.iso3,
        input.outBasename,
        input.artifactSetId,
      ],
    );
    await insertMethodology(transaction, input.runId);
    for (const artifact of synthetic.artifacts) {
      await transaction.query(
        `insert into workflow_run_artifacts
          (run_id, artifact_set_id, artifact_key, relative_path, filename, content_type,
           sha256, byte_size, workflow_id, workflow_version, workflow_contract_sha256,
           damm_model_version, damm_model_revision, damm_model_sha256,
           damm_source_commit, assessment_input_sha256, content_verified_at, content)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, now(), $17)`,
        [
          artifact.runId,
          artifact.artifactSetId,
          artifact.artifactKey,
          artifact.relativePath,
          artifact.filename,
          artifact.contentType,
          artifact.sha256,
          artifact.byteSize,
          artifact.workflowId,
          artifact.workflowVersion,
          artifact.workflowContractSha256,
          DAMM_WORKFLOW_METHODOLOGY.modelVersion,
          DAMM_WORKFLOW_METHODOLOGY.modelRevision,
          DAMM_WORKFLOW_METHODOLOGY.appModelSha256,
          DAMM_WORKFLOW_METHODOLOGY.sourceCommit,
          synthetic.assessmentInputSha256,
          artifact.content,
        ],
      );
    }
    await transaction.query(
      `update runs set status = 'done', workflow_artifact_set_id = $2,
                       finished_at = $3::timestamptz, updated_at = now()
       where id = $1`,
      [input.runId, input.artifactSetId, input.completedAt],
    );
  });
  return synthetic;
}

async function fixture(
  suffix = "one",
  inputs: { observations?: Uint8Array; assessmentInput?: Uint8Array } = {},
): Promise<Fixture> {
  const { pg, sql } = await migratedDatabase();
  const countryId = `country-${suffix}`;
  const runId = `run-${suffix}`;
  const artifactSetId = `set-${suffix}`;
  const observations = inputs.observations ?? observationBytes(suffix);
  const assessmentInput = inputs.assessmentInput ?? observations;
  const countryName = `Country ${suffix}`;

  for (const user of Object.values(USERS)) {
    await sql.query(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, true, now(), now())`,
      [user.id, user.name, user.email],
    );
  }
  await sql.query(`insert into countries (id, user_id, name, iso3) values ($1, $2, $3, $4)`, [
    countryId,
    USERS.owner.id,
    countryName,
    "TST",
  ]);
  const synthetic = await insertCompletedWorkflow(sql, {
    countryId,
    countryName,
    iso3: "TST",
    runId,
    artifactSetId,
    outBasename: `TST_${suffix}`,
    observations,
    assessmentInput,
    completedAt: "2026-08-27T00:00:00.123456Z",
  });
  const bundle = synthetic.artifacts.find((artifact) => artifact.artifactKey === "bundle")?.content;
  assert.ok(bundle);
  const approvalPackage = unwrap(await ensureApprovalPackage(countryId, USERS.owner.id, sql));
  return {
    pg,
    sql,
    countryId,
    runId,
    artifactSetId,
    bundle,
    observations,
    assessmentInput,
    approvalPackage,
  };
}

async function publishAdditionalWorkflow(fx: Fixture, suffix: string): Promise<Fixture> {
  const runId = `run-${suffix}`;
  const artifactSetId = `set-${suffix}`;
  const observations = observationBytes(suffix);
  const assessmentInput = observations;
  const synthetic = await insertCompletedWorkflow(fx.sql, {
    countryId: fx.countryId,
    countryName: "Country",
    iso3: "TST",
    runId,
    artifactSetId,
    outBasename: `TST_${suffix}`,
    observations,
    assessmentInput,
    completedAt: "2026-08-27T00:00:01.654321Z",
  });
  const bundle = synthetic.artifacts.find((artifact) => artifact.artifactKey === "bundle")?.content;
  assert.ok(bundle);
  const approvalPackage = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
  return { ...fx, runId, artifactSetId, bundle, observations, assessmentInput, approvalPackage };
}

async function assignBoth(
  fx: Fixture,
): Promise<{ g1: ApprovalAssignment; g2: ApprovalAssignment }> {
  const g1 = unwrap(
    await assignApprovalReviewer(
      {
        packageId: fx.approvalPackage.id,
        expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
        expectedBundleSha256: fx.approvalPackage.bundleSha256,
        gate: "g1",
        reviewerEmail: USERS.assessor.email,
        declaredRole: "assessor",
        ownerUserId: USERS.owner.id,
      },
      fx.sql,
    ),
  );
  const g2 = unwrap(
    await assignApprovalReviewer(
      {
        packageId: fx.approvalPackage.id,
        expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
        expectedBundleSha256: fx.approvalPackage.bundleSha256,
        gate: "g2",
        reviewerEmail: USERS.peer.email,
        declaredRole: "independent_reviewer",
        ownerUserId: USERS.owner.id,
      },
      fx.sql,
    ),
  );
  return { g1, g2 };
}

async function approveAssignment(fx: Fixture, assignment: ApprovalAssignment) {
  return submitAssignedReview(
    {
      assignmentId: assignment.id,
      reviewerUserId: assignment.reviewerUserId,
      decision: "approved",
      notes: `${assignment.gate.toUpperCase()} reviewed`,
      affirmation: true,
      expectedAffirmationVersion: HUMAN_REVIEW_AFFIRMATIONS[assignment.gate].version,
      expectedAffirmationSha256: HUMAN_REVIEW_AFFIRMATIONS[assignment.gate].sha256,
      rows: assignment.scope.map((row) => ({ indicatorId: row.indicatorId, decision: "approved" })),
    },
    fx.sql,
  );
}

async function replaceAssignment(
  fx: Fixture,
  active: ApprovalAssignment,
  reviewerEmail: string,
  reason = "The originally assigned reviewer is unavailable",
  id?: string,
) {
  return assignApprovalReviewer(
    {
      packageId: fx.approvalPackage.id,
      expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
      expectedBundleSha256: fx.approvalPackage.bundleSha256,
      gate: active.gate,
      reviewerEmail,
      declaredRole: active.declaredRole,
      ownerUserId: USERS.owner.id,
      expectedActiveAssignmentId: active.id,
      replacementReason: reason,
      ...(id ? { id } : {}),
    },
    fx.sql,
  );
}

describe("post-completion human approval store", () => {
  it("materializes exact immutable Stage 1 rows and closes the package to later inserts", async () => {
    const fx = await fixture("materialize");
    try {
      assert.equal(fx.approvalPackage.machineRowCount, 10);
      assert.ok(fx.approvalPackage.materializedAt);
      assert.equal(fx.approvalPackage.methodology.modelRatified, false);
      assert.equal(fx.approvalPackage.g1Scope.length, 10);
      assert.ok(fx.approvalPackage.g2Scope.length < 10);
      const completion = await fx.sql.query<{
        run_completed_at: string;
        package_completed_at: string;
      }>(
        `select workflow_run.finished_at::text as run_completed_at,
                package.completed_at::text as package_completed_at
         from runs workflow_run
         join workflow_approval_packages package on package.run_id = workflow_run.id
         where workflow_run.id = $1`,
        [fx.runId],
      );
      assert.equal(completion[0].package_completed_at, completion[0].run_completed_at);
      assert.match(completion[0].run_completed_at, /\.123456/);
      assert.match(fx.approvalPackage.completedAt, /\.123Z$/);
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_rows
            (package_id, target_identity_sha256, ordinal, indicator_id, row_sha256,
             classification, prerequisite, row_payload)
           values ($1, $2, 11, '9.9', $3, 'Measured', false, '{"value":1}'::jsonb)`,
          [fx.approvalPackage.id, fx.approvalPackage.targetIdentitySha256, "f".repeat(64)],
        ),
        /materialization is closed|immutable/,
      );
      assert.ok(
        unwrap(
          await assignApprovalReviewer(
            {
              packageId: fx.approvalPackage.id,
              expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
              expectedBundleSha256: fx.approvalPackage.bundleSha256,
              gate: "g1",
              reviewerEmail: USERS.assessor.email,
              declaredRole: "assessor",
              ownerUserId: USERS.owner.id,
            },
            fx.sql,
          ),
        ),
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps the prior-pin package, decisions, and release audit-readable after repinning", async () => {
    let fx = await fixture("historical-complete");
    try {
      const originalTarget = fx.approvalPackage.targetIdentitySha256;
      const { g1, g2 } = await assignBoth(fx);
      const g1Decision = unwrap(await approveAssignment(fx, g1));
      const g2Decision = unwrap(await approveAssignment(fx, g2));
      const signed = unwrap(
        await submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "Completed under the preceding deployment pin",
            affirmations: allAffirmations(),
          },
          fx.sql,
        ),
      );
      assert.ok(signed.release);

      fx = await makePackageHistorical(
        fx,
        PRE_0024_DAMM_SOURCE_COMMIT,
        PRE_0024_DAMM_RENDERER_SHA256,
      );
      const beforeCutover = await approvalAuditSnapshot(fx);
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0024_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      assert.deepEqual(
        await approvalAuditSnapshot(fx),
        beforeCutover,
        "the append-only cutover must not rewrite any historical run, artifact, approval, or release identity",
      );
      const reopened = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(reopened.id, fx.approvalPackage.id);
      assert.equal(reopened.methodology.sourceCommit, PRE_0024_DAMM_SOURCE_COMMIT);
      assert.equal(reopened.methodology.rendererSha256, PRE_0024_DAMM_RENDERER_SHA256);
      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(state.package.methodology.sourceCommit, PRE_0024_DAMM_SOURCE_COMMIT);
      assert.equal(state.package.methodology.rendererSha256, PRE_0024_DAMM_RENDERER_SHA256);
      assert.notEqual(state.package.targetIdentitySha256, originalTarget);
      assert.deepEqual(
        state.decisions.map((decision) => decision.id),
        [g1Decision.id, g2Decision.id, signed.decision.id],
      );
      assert.equal(state.release?.id, signed.release.id);
      assert.equal(state.release?.targetIdentitySha256, state.package.targetIdentitySha256);
      assert.equal(
        (state.release?.manifest.methodology as Record<string, unknown>).sourceCommit,
        PRE_0024_DAMM_SOURCE_COMMIT,
      );
      assert.equal(
        (state.release?.manifest.methodology as Record<string, unknown>).rendererSha256,
        PRE_0024_DAMM_RENDERER_SHA256,
      );
      assert.equal(state.lifecycle, "approved_draft");

      const historicalReview = unwrap(await getAssignedReview(g1.id, USERS.assessor.id, fx.sql));
      assert.equal(historicalReview.ownDecision?.id, g1Decision.id);
      assert.equal(historicalReview.canSubmit, false);
      assert.match(historicalReview.lockedReason ?? "", /historical|no longer current/i);

      // The fixture exercises 0024 directly, which temporarily restores its 76ca
      // launch guard. Reinstall the current 0028 guard before materializing
      // a workflow using the current manifest below.
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0028_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      const historicalPackageId = fx.approvalPackage.id;
      const currentFx = await publishAdditionalWorkflow(fx, "historical-complete-current");
      const latest = unwrap(
        await getOwnerApprovalState(currentFx.countryId, USERS.owner.id, currentFx.sql),
      );
      assert.equal(latest.package.id, currentFx.approvalPackage.id);
      assert.deepEqual(
        latest.packageHistory.map((item) => [item.packageId, item.currentMethodology]),
        [
          [currentFx.approvalPackage.id, true],
          [historicalPackageId, false],
        ],
      );

      const selectedHistorical = unwrap(
        await getOwnerApprovalState(
          currentFx.countryId,
          USERS.owner.id,
          currentFx.sql,
          historicalPackageId,
        ),
      );
      assert.equal(selectedHistorical.package.id, historicalPackageId);
      assert.deepEqual(
        selectedHistorical.decisions.map((item) => item.id),
        [g1Decision.id, g2Decision.id, signed.decision.id],
      );
      assert.equal(selectedHistorical.release?.id, signed.release.id);
      assert.equal(selectedHistorical.packageHistory.length, 2);
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps the 0024 source-pin package immutable and audit-readable after the 0025 cutover", async () => {
    let fx = await fixture("historical-0025-complete");
    try {
      fx = await makePackageHistorical(
        fx,
        PRE_0025_DAMM_SOURCE_COMMIT,
        PRE_0025_DAMM_RENDERER_SHA256,
      );
      const beforeCutover = await approvalAuditSnapshot(fx);
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0025_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      assert.deepEqual(
        await approvalAuditSnapshot(fx),
        beforeCutover,
        "the 0025 cutover must not rewrite a completed preceding-pin package or its artifacts",
      );

      const historical = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(historical.package.methodology.sourceCommit, PRE_0025_DAMM_SOURCE_COMMIT);
      assert.equal(historical.package.methodology.rendererSha256, PRE_0025_DAMM_RENDERER_SHA256);
      assert.equal(historical.packageHistory[0].currentMethodology, false);
      assertMethodologyRefusal(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );

      const historicalPackageId = fx.approvalPackage.id;
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0028_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      const currentFx = await publishAdditionalWorkflow(fx, "historical-0025-current");
      const latest = unwrap(
        await getOwnerApprovalState(currentFx.countryId, USERS.owner.id, currentFx.sql),
      );
      assert.deepEqual(
        latest.packageHistory.map((item) => [item.packageId, item.currentMethodology]),
        [
          [currentFx.approvalPackage.id, true],
          [historicalPackageId, false],
        ],
      );
    } finally {
      await fx.pg.close();
    }
  });
  it("keeps the 0025 source-pin package immutable and audit-readable after the 0026 cutover", async () => {
    let fx = await fixture("historical-0026-complete");
    try {
      fx = await makePackageHistorical(
        fx,
        PRE_0026_DAMM_SOURCE_COMMIT,
        PRE_0026_DAMM_RENDERER_SHA256,
      );
      const beforeCutover = await approvalAuditSnapshot(fx);
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0026_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      assert.deepEqual(
        await approvalAuditSnapshot(fx),
        beforeCutover,
        "the 0026 cutover must not rewrite a completed preceding-pin package or its artifacts",
      );

      const historical = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(historical.package.methodology.sourceCommit, PRE_0026_DAMM_SOURCE_COMMIT);
      assert.equal(historical.package.methodology.rendererSha256, PRE_0026_DAMM_RENDERER_SHA256);
      assert.equal(historical.packageHistory[0].currentMethodology, false);
      assertMethodologyRefusal(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );

      const historicalPackageId = fx.approvalPackage.id;
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0028_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      const currentFx = await publishAdditionalWorkflow(fx, "historical-0026-current");
      const latest = unwrap(
        await getOwnerApprovalState(currentFx.countryId, USERS.owner.id, currentFx.sql),
      );
      assert.deepEqual(
        latest.packageHistory.map((item) => [item.packageId, item.currentMethodology]),
        [
          [currentFx.approvalPackage.id, true],
          [historicalPackageId, false],
        ],
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps the 0026 source-pin package immutable and audit-readable after the 0027 cutover", async () => {
    let fx = await fixture("historical-0027-complete");
    try {
      fx = await makePackageHistorical(
        fx,
        PRE_0027_DAMM_SOURCE_COMMIT,
        PRE_0027_DAMM_RENDERER_SHA256,
      );
      const beforeCutover = await approvalAuditSnapshot(fx);
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0027_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      assert.deepEqual(
        await approvalAuditSnapshot(fx),
        beforeCutover,
        "the 0027 cutover must not rewrite a completed preceding-pin package or its artifacts",
      );

      const reopened = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(reopened.id, fx.approvalPackage.id);
      const historical = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(historical.package.methodology.sourceCommit, PRE_0027_DAMM_SOURCE_COMMIT);
      assert.equal(historical.package.methodology.rendererSha256, PRE_0027_DAMM_RENDERER_SHA256);
      assert.equal(historical.packageHistory[0].currentMethodology, false);
      assertMethodologyRefusal(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );

      const historicalPackageId = fx.approvalPackage.id;
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0028_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      const currentFx = await publishAdditionalWorkflow(fx, "historical-0027-current");
      const latest = unwrap(
        await getOwnerApprovalState(currentFx.countryId, USERS.owner.id, currentFx.sql),
      );
      assert.deepEqual(
        latest.packageHistory.map((item) => [item.packageId, item.currentMethodology]),
        [
          [currentFx.approvalPackage.id, true],
          [historicalPackageId, false],
        ],
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps the 0027 source-pin package immutable and audit-readable after the 0028 cutover", async () => {
    let fx = await fixture("historical-0028-complete");
    try {
      fx = await makePackageHistorical(
        fx,
        PRE_0028_DAMM_SOURCE_COMMIT,
        PRE_0028_DAMM_RENDERER_SHA256,
      );
      const beforeCutover = await approvalAuditSnapshot(fx);
      await fx.pg.exec(
        await readFile(
          new URL("../../../migrations/0028_damm_source_pin_cutover.sql", import.meta.url),
          "utf8",
        ),
      );
      assert.deepEqual(
        await approvalAuditSnapshot(fx),
        beforeCutover,
        "the 0028 cutover must not rewrite a completed preceding-pin package or its artifacts",
      );

      const reopened = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(reopened.id, fx.approvalPackage.id);
      const historical = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(historical.package.methodology.sourceCommit, PRE_0028_DAMM_SOURCE_COMMIT);
      assert.equal(historical.package.methodology.rendererSha256, PRE_0028_DAMM_RENDERER_SHA256);
      assert.equal(historical.packageHistory[0].currentMethodology, false);
      assertMethodologyRefusal(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );

      const historicalPackageId = fx.approvalPackage.id;
      const currentFx = await publishAdditionalWorkflow(fx, "historical-0028-current");
      const latest = unwrap(
        await getOwnerApprovalState(currentFx.countryId, USERS.owner.id, currentFx.sql),
      );
      assert.deepEqual(
        latest.packageHistory.map((item) => [item.packageId, item.currentMethodology]),
        [
          [currentFx.approvalPackage.id, true],
          [historicalPackageId, false],
        ],
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps older recognized packages addressable without reopening approval activity", async () => {
    for (const [generation, sourceCommit, rendererSha256] of [
      ["one", PRE_0025_DAMM_SOURCE_COMMIT, PRE_0025_DAMM_RENDERER_SHA256],
      ["two", PRE_0022_DAMM_SOURCE_COMMIT, PRE_0022_DAMM_RENDERER_SHA256],
      ["three", PRE_0021_DAMM_SOURCE_COMMIT, PRE_0021_DAMM_RENDERER_SHA256],
      ["four", PRE_0020_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
      ["five", PRE_0018_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
      ["six", PRE_0017_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
      ["seven", PRE_0016_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
      ["eight", PRE_0015_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
      ["nine", PRE_0014_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
    ] as const) {
      let fx = await fixture(`historical-${generation}-generations`);
      try {
        fx = await makePackageHistorical(fx, sourceCommit, rendererSha256);

        const reopened = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
        assert.equal(reopened.id, fx.approvalPackage.id);
        assert.equal(reopened.methodology.sourceCommit, sourceCommit);
        assert.equal(reopened.methodology.rendererSha256, rendererSha256);

        const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
        assert.equal(state.package.id, fx.approvalPackage.id);
        assert.equal(state.package.methodology.sourceCommit, sourceCommit);
        assert.equal(state.packageHistory[0].currentMethodology, false);

        assertMethodologyRefusal(
          await assignApprovalReviewer(
            {
              packageId: fx.approvalPackage.id,
              expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
              expectedBundleSha256: fx.approvalPackage.bundleSha256,
              gate: "g1",
              reviewerEmail: USERS.assessor.email,
              declaredRole: "assessor",
              ownerUserId: USERS.owner.id,
            },
            fx.sql,
          ),
        );
      } finally {
        await fx.pg.close();
      }
    }
  });

  it("refuses recognized source and renderer hashes when they form an unrecognized pair", async () => {
    for (const [suffix, sourceCommit, rendererSha256] of [
      ["new-source-old-renderer", PRE_0021_DAMM_SOURCE_COMMIT, PRE_0020_DAMM_RENDERER_SHA256],
      ["old-source-new-renderer", PRE_0020_DAMM_SOURCE_COMMIT, PRE_0021_DAMM_RENDERER_SHA256],
    ] as const) {
      let fx = await fixture(`historical-mismatch-${suffix}`);
      try {
        fx = await makePackageHistorical(fx, sourceCommit, rendererSha256);
        assertMethodologyRefusal(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
      } finally {
        await fx.pg.close();
      }
    }
  });

  it("keeps an incomplete prior-pin chain readable but rejects every new API decision", async () => {
    let fx = await fixture("historical-pending");
    try {
      const { g1, g2 } = await assignBoth(fx);
      fx = await makePackageHistorical(fx);

      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(state.package.methodology.sourceCommit, PRE_0023_DAMM_SOURCE_COMMIT);
      assert.equal(state.package.methodology.rendererSha256, PRE_0023_DAMM_RENDERER_SHA256);
      assert.deepEqual(state.decisions, []);
      assert.equal(state.lifecycle, "g1_pending");

      for (const assignment of [g1, g2]) {
        const review = unwrap(
          await getAssignedReview(assignment.id, assignment.reviewerUserId, fx.sql),
        );
        assert.equal(review.canSubmit, false);
        assert.match(review.lockedReason ?? "", /historical|no longer current/i);
        assertMethodologyRefusal(await approveAssignment(fx, assignment));
      }

      assertMethodologyRefusal(
        await replaceAssignment(
          fx,
          g1,
          USERS.other.email,
          "A historical assignment must not be transferred to another reviewer",
        ),
      );
      assertMethodologyRefusal(
        await submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "Historical G3 must remain closed",
            affirmations: allAffirmations(),
          },
          fx.sql,
        ),
      );

      const persisted = await fx.sql.query<{
        assignments: number;
        supersessions: number;
        decisions: number;
        releases: number;
      }>(
        `select
           (select count(*)::int from workflow_approval_assignments
            where package_id = $1) as assignments,
           (select count(*)::int from workflow_approval_assignment_supersessions
            where package_id = $1) as supersessions,
           (select count(*)::int from workflow_approval_decisions
            where package_id = $1) as decisions,
           (select count(*)::int from workflow_approval_releases
            where package_id = $1) as releases`,
        [fx.approvalPackage.id],
      );
      assert.deepEqual(persisted[0], {
        assignments: 2,
        supersessions: 0,
        decisions: 0,
        releases: 0,
      });
    } finally {
      await fx.pg.close();
    }
  });

  it("does not let a newer unmaterialized prior-pin Draft mask package history", async () => {
    let fx = await fixture("historical-masked");
    try {
      fx = await makePackageHistorical(fx);
      const historicalPackageId = fx.approvalPackage.id;
      const newerRunId = "run-historical-unmaterialized-newer";
      const newerArtifactSetId = "set-historical-unmaterialized-newer";
      const newerObservations = observationBytes("historical-unmaterialized-newer");
      await insertCompletedWorkflow(fx.sql, {
        countryId: fx.countryId,
        countryName: "Country",
        iso3: "TST",
        runId: newerRunId,
        artifactSetId: newerArtifactSetId,
        outBasename: "TST_historical_unmaterialized_newer",
        observations: newerObservations,
        assessmentInput: newerObservations,
        completedAt: "2026-08-27T00:00:02.654321Z",
      });
      await fx.sql.query("set session_replication_role = replica");
      try {
        await fx.sql.query(
          `update workflow_run_methodology
           set source_commit = $2, renderer_sha256 = $3
           where run_id = $1`,
          [newerRunId, PRE_0023_DAMM_SOURCE_COMMIT, PRE_0023_DAMM_RENDERER_SHA256],
        );
        await fx.sql.query(
          "update workflow_run_artifacts set damm_source_commit = $2 where run_id = $1",
          [newerRunId, PRE_0023_DAMM_SOURCE_COMMIT],
        );
      } finally {
        await fx.sql.query("set session_replication_role = origin");
      }

      const unmaterialized = await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql);
      assert.equal(unmaterialized.ok, false);
      if (!unmaterialized.ok) assert.equal(unmaterialized.error.code, "HISTORICAL_SOURCE_PIN");
      const opened = unwrap(await openOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(opened.package.id, historicalPackageId);
      assert.equal(opened.packageHistory.length, 1);
      assert.equal(opened.packageHistory[0].currentMethodology, false);
      assert.equal(opened.packageHistory[0].packageId, historicalPackageId);
    } finally {
      await fx.pg.close();
    }
  });

  it("does not hide a corrupt current-pin Draft behind older valid package history", async () => {
    const fx = await fixture("current-corrupt-masked");
    try {
      const historicalPackageId = fx.approvalPackage.id;
      const newerRunId = "run-current-corrupt-newer";
      const newerArtifactSetId = "set-current-corrupt-newer";
      const newerObservations = observationBytes("current-corrupt-newer");
      await insertCompletedWorkflow(fx.sql, {
        countryId: fx.countryId,
        countryName: "Country",
        iso3: "TST",
        runId: newerRunId,
        artifactSetId: newerArtifactSetId,
        outBasename: "TST_current_corrupt_newer",
        observations: newerObservations,
        assessmentInput: newerObservations,
        completedAt: "2026-08-27T00:00:02.654321Z",
      });
      await fx.sql.query("set session_replication_role = replica");
      try {
        await fx.sql.query(
          `update workflow_run_artifacts
           set damm_source_commit = $3
           where run_id = $1 and artifact_set_id = $2 and artifact_key = 'bundle'`,
          [newerRunId, newerArtifactSetId, PRE_0020_DAMM_SOURCE_COMMIT],
        );
      } finally {
        await fx.sql.query("set session_replication_role = origin");
      }

      const opened = await openOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql);
      assert.equal(opened.ok, false);
      if (!opened.ok) assert.equal(opened.error.code, "METHODOLOGY_UNVERIFIED");
      const explicitlySelected = unwrap(
        await openOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql, historicalPackageId),
      );
      assert.equal(explicitlySelected.package.id, historicalPackageId);
    } finally {
      await fx.pg.close();
    }
  });

  it("blocks direct-SQL approval decisions and releases for a prior-pin package", async () => {
    let fx = await fixture("historical-sql");
    try {
      const { g1, g2 } = await assignBoth(fx);
      fx = await makePackageHistorical(fx);
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_assignments
            (id, package_id, target_identity_sha256, gate, reviewer_user_id,
             reviewer_name, reviewer_email, declared_role, assigned_by_user_id,
             assigned_by_name, assigned_by_email, scope_rows, scope_row_count,
             scope_sha256)
           values ('historical-sql-assignment', $1, $2, 'g1', $3, $4, $5,
                   'assessor', $6, $7, $8, $9::jsonb, $10, $11)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.other.id,
            USERS.other.name,
            USERS.other.email,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
            JSON.stringify(fx.approvalPackage.g1Scope),
            fx.approvalPackage.g1Scope.length,
            fx.approvalPackage.g1ScopeSha256,
          ],
        ),
        /current DAMM methodology/i,
      );
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_assignment_supersessions
            (id, revoked_assignment_id, superseding_assignment_id, package_id,
             target_identity_sha256, gate, revoked_by_user_id, revoked_by_name,
             revoked_by_email, reason)
           values ('historical-sql-supersession', $1, 'historical-sql-successor',
                   $2, $3, 'g1', $4, $5, $6, 'Historical replacement is forbidden')`,
          [
            g1.id,
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
          ],
        ),
        /current DAMM methodology/i,
      );

      for (const assignment of [g1, g2]) {
        const affirmation = HUMAN_REVIEW_AFFIRMATIONS[assignment.gate];
        const rowReviews = assignment.scope.map((row) => ({
          indicatorId: row.indicatorId,
          rowSha256: row.rowSha256,
          decision: "approved",
          notes: "",
        }));
        await assert.rejects(
          fx.sql.query(
            `insert into workflow_approval_decisions
            (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
             reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
             notes, reviewer_affirmation, reviewer_affirmation_version,
             reviewer_affirmation_text, reviewer_affirmation_sha256, row_reviews,
             affirmations)
           values ($1, $2, $3, $4, $5, 'human', $6, $7, $8,
                   $9, 'approved', '', true, $10, $11, $12, $13::jsonb,
                   '{}'::jsonb)`,
            [
              `historical-sql-${assignment.gate}`,
              fx.approvalPackage.id,
              fx.approvalPackage.targetIdentitySha256,
              assignment.id,
              assignment.gate,
              assignment.reviewerUserId,
              assignment.reviewerName,
              assignment.reviewerEmail,
              assignment.declaredRole,
              affirmation.version,
              affirmation.text,
              affirmation.sha256,
              JSON.stringify(rowReviews),
            ],
          ),
          /current DAMM methodology/i,
        );
      }
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_decisions
            (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
             reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
             notes, reviewer_affirmation, row_reviews, affirmations)
           values ('historical-sql-g3', $1, $2, null, 'g3', 'human', $3, $4, $5,
                   'ttl_country_owner', 'approved', 'No historical sign-off', true,
                   '[]'::jsonb, $6::jsonb)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
            JSON.stringify(allAffirmations()),
          ],
        ),
        /current DAMM methodology/i,
      );
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_releases
            (id, package_id, target_identity_sha256, country_id, version_number,
             lifecycle, external_circulation_authorized, g1_decision_id,
             g2_decision_id, g3_decision_id, manifest_json, manifest_sha256)
           values ('historical-sql-release', $1, $2, $3, 1, 'approved_draft', true,
                   'missing-g1', 'missing-g2', 'missing-g3', '{}'::jsonb, $4)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            fx.countryId,
            "f".repeat(64),
          ],
        ),
        /current DAMM methodology/i,
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("locks the run before the complete selected artifact set during materialization", async () => {
    const fx = await fixture("artifact-lock-order");
    try {
      const queries: string[] = [];
      const observed = observeSql(fx.sql, {
        onQuery(text) {
          queries.push(text.replace(/\s+/g, " ").trim());
        },
        onTransaction() {},
      });
      const approvalPackage = unwrap(
        await ensureApprovalPackage(fx.countryId, USERS.owner.id, observed),
      );
      assert.equal(approvalPackage.id, fx.approvalPackage.id);

      const runLock = queries.findIndex(
        (query) =>
          /from runs workflow_run/i.test(query) && /for update of workflow_run$/i.test(query),
      );
      const completeSetLock = queries.findIndex(
        (query) =>
          /from workflow_run_artifacts/i.test(query) &&
          /where run_id = \$1 and artifact_set_id = \$2 order by artifact_key for update$/i.test(
            query,
          ),
      );
      assert.ok(runLock >= 0, "materialization must first lock the selected run");
      assert.ok(
        completeSetLock > runLock,
        "materialization must next lock every row in the selected artifact set",
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("derives G1 rows from the exact scored engine input rather than raw observations", async () => {
    const observations = observationBytes("raw-research");
    const assessmentInput = observationBytes("scored-input");
    const fx = await fixture("assessment-binding", { observations, assessmentInput });
    try {
      const assessmentSha256 = createHash("sha256").update(assessmentInput).digest("hex");
      const observationsSha256 = createHash("sha256").update(observations).digest("hex");
      assert.equal(fx.approvalPackage.assessmentInputArtifactKey, "assessment-input");
      assert.match(fx.approvalPackage.assessmentInputSourcePath, /engine_input\.json$/);
      assert.equal(fx.approvalPackage.assessmentInputSha256, assessmentSha256);
      assert.equal(fx.approvalPackage.observationsSha256, observationsSha256);
      assert.notEqual(assessmentSha256, observationsSha256);

      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(
        state.rows.find((row) => row.indicatorId === "1.1")?.payload.value,
        "scored-input-1",
      );
      assert.notEqual(
        state.rows.find((row) => row.indicatorId === "1.1")?.payload.value,
        "raw-research-1",
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("reviews carried candidates and preserves exact JSON numerics without JavaScript rounding", async () => {
    const assessmentInput = exactNumericCandidateBytes("numeric-candidates");
    const fx = await fixture("numeric-candidates", { assessmentInput });
    try {
      const repeated = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(repeated.id, fx.approvalPackage.id);
      assert.equal(repeated.targetIdentitySha256, fx.approvalPackage.targetIdentitySha256);

      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      const candidateImp = state.rows.find((row) => row.indicatorId === "A1-CAND-IMP");
      const candidateIrr = state.rows.find((row) => row.indicatorId === "A1-CAND-IRR");
      assert.ok(candidateImp);
      assert.ok(candidateIrr);
      assert.equal(candidateImp.prerequisite, false);
      assert.equal(candidateIrr.prerequisite, false);
      assert.match(candidateImp.indicatorName, /Unscored carried candidate/);
      assert.equal(candidateImp.payload.value, "18.0");
      assert.equal(candidateImp.payload.ratio, "0.0000001");
      assert.equal(candidateIrr.payload.value, "9007199254740993");
      assert.equal(candidateIrr.payload.reported, "7402.00");
      assert.ok(
        state.package.g1Scope.some(
          (row) =>
            row.indicatorId === candidateImp.indicatorId &&
            row.rowSha256 === candidateImp.rowSha256,
        ),
      );
      assert.ok(
        state.package.g1Scope.some(
          (row) =>
            row.indicatorId === candidateIrr.indicatorId &&
            row.rowSha256 === candidateIrr.rowSha256,
        ),
      );
      assert.ok(
        state.package.g2Scope.some(
          (row) => row.indicatorId === "A1-CAND-IMP" && row.reasons?.includes("judged"),
        ),
      );

      const databaseComparison = await fx.sql.query<{
        exact_count: number;
        persisted_count: number;
        all_exact: boolean;
      }>(
        `select
           (select count(*)::int from expected_human_approval_rows_v1($1::bytea)) as exact_count,
           (select count(*)::int from workflow_approval_rows where package_id = $2) as persisted_count,
           not exists (
             select 1
             from expected_human_approval_rows_v1($1::bytea) expected
             left join workflow_approval_rows persisted
               on persisted.package_id = $2 and persisted.ordinal = expected.ordinal
             where persisted.indicator_id is null
                or persisted.indicator_id <> expected.indicator_id
                or persisted.row_sha256 <> expected.row_sha256
                or persisted.classification <> expected.classification
                or persisted.prerequisite <> expected.prerequisite
                or persisted.row_payload <> expected.row_payload
           ) as all_exact`,
        [assessmentInput, fx.approvalPackage.id],
      );
      assert.deepEqual(databaseComparison[0], {
        exact_count: state.rows.length,
        persisted_count: state.rows.length,
        all_exact: true,
      });
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps v1 package and release identities stable when compatibility helpers advance", async () => {
    const fx = await fixture("version-frozen-helpers", {
      assessmentInput: exactNumericCandidateBytes("version-frozen-helpers"),
    });
    try {
      const before = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      await fx.pg.exec(`
        create or replace function canonical_human_approval_json(input_value jsonb)
        returns text language sql immutable strict
        as $$ select 'compatibility-v2'::text $$;

        create or replace function human_approval_indicator_prerequisite(indicator_id text)
        returns boolean language sql immutable strict
        as $$ select false $$;

        create or replace function human_approval_js_iso(input_value timestamptz)
        returns text language sql immutable strict
        as $$ select '2099-01-01T00:00:00.000Z'::text $$;
      `);

      const repeated = unwrap(await ensureApprovalPackage(fx.countryId, USERS.owner.id, fx.sql));
      const after = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(repeated.id, before.package.id);
      assert.equal(after.package.targetIdentitySha256, before.package.targetIdentitySha256);
      assert.deepEqual(
        after.rows.map((row) => [row.indicatorId, row.rowSha256, row.payload]),
        before.rows.map((row) => [row.indicatorId, row.rowSha256, row.payload]),
      );

      const { g1, g2 } = await assignBoth(fx);
      unwrap(await approveAssignment(fx, g1));
      unwrap(await approveAssignment(fx, g2));
      const signed = unwrap(
        await submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "Version-frozen release",
            affirmations: allAffirmations(),
          },
          fx.sql,
        ),
      );
      assert.equal(signed.release?.lifecycle, "approved_draft");
    } finally {
      await fx.pg.close();
    }
  });

  it("rejects a self-consistent approval package fabricated through direct SQL", async () => {
    const fx = await fixture("direct-sql-template");
    try {
      const runId = "run-direct-sql-forgery";
      const artifactSetId = "set-direct-sql-forgery";
      const observations = observationBytes("direct-sql-real-input");
      const completedAt = "2026-08-27T00:00:09.123456Z";
      const synthetic = await insertCompletedWorkflow(fx.sql, {
        countryId: fx.countryId,
        countryName: "Country direct-sql-template",
        iso3: "TST",
        runId,
        artifactSetId,
        outBasename: "TST_direct_sql_forgery",
        observations,
        completedAt,
      });
      const bundle = synthetic.artifacts.find((artifact) => artifact.artifactKey === "bundle");
      const assessmentInput = synthetic.artifacts.find(
        (artifact) => artifact.artifactKey === "assessment-input",
      );
      assert.ok(bundle);
      assert.ok(assessmentInput);

      const forgedAssessment = JSON.parse(new TextDecoder().decode(observations)) as Record<
        string,
        unknown
      >;
      forgedAssessment["1.1"] = {
        value: "not present in the assessment input",
        cls: "Measured",
        level: 2,
        src: "Forged source",
      };
      const forgedRows = canonicalizeMachineFilledObservationRows(
        forgedAssessment,
        Object.fromEntries(
          Object.keys(forgedAssessment).map((indicatorId) => [
            indicatorId,
            { prerequisite: indicatorId === "2.1" },
          ]),
        ),
      );
      const forgedG2Protocol = buildG2ReviewScope(forgedRows, bundle.sha256);
      const forgedG1Scope = forgedRows.map((row) => ({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
      }));
      const forgedG2Scope = forgedG2Protocol.rows.map((row) => ({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
        reasons: [...row.reasons],
      }));
      const forgedMachineSetSha256 = createHash("sha256")
        .update(
          canonicalJson(
            forgedRows.map((row) => ({
              indicatorId: row.indicatorId,
              rowSha256: row.rowSha256,
              classification: row.classification,
              prerequisite: row.prerequisite,
            })),
          ),
        )
        .digest("hex");
      const forgedG1ScopeSha256 = createHash("sha256")
        .update(canonicalJson(forgedG1Scope))
        .digest("hex");
      const forgedG2ScopeSha256 = createHash("sha256")
        .update(canonicalJson(forgedG2Scope))
        .digest("hex");
      const observationsSha256 = createHash("sha256").update(observations).digest("hex");
      const forgedTarget = {
        schemaVersion: "damm.approval-package/v1",
        workflowRunId: runId,
        artifactSetId,
        completeBundleSha256: bundle.sha256,
        observationsArtifactKey: "data-damm_diagnostic-damm_observations-json",
        observationsSha256,
        workflow: {
          id: fx.approvalPackage.workflowId,
          version: fx.approvalPackage.workflowVersion,
          contractSha256: fx.approvalPackage.workflowContractSha256,
        },
        methodology: fx.approvalPackage.methodology,
        assessmentInputArtifactKey: "assessment-input",
        assessmentInputSourcePath: assessmentInput.relativePath,
        assessmentInputSha256: assessmentInput.sha256,
        machineRowCount: forgedRows.length,
        machineRowSetSha256: forgedMachineSetSha256,
        g1ScopeSha256: forgedG1ScopeSha256,
        g2ScopeSha256: forgedG2ScopeSha256,
        completedAt: new Date(completedAt).toISOString(),
      };
      const forgedTargetSha256 = createHash("sha256")
        .update(canonicalJson(forgedTarget))
        .digest("hex");
      const forgedPackageId = `approval-package-${forgedTargetSha256}`;

      await assert.rejects(
        fx.sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into workflow_approval_packages
              (id, run_id, country_id, owner_user_id, artifact_set_id,
               bundle_artifact_key, bundle_sha256, observations_artifact_key,
               observations_sha256, workflow_id, workflow_version,
               workflow_contract_sha256, manifest_schema_version, damm_model_id,
               damm_model_version, damm_model_revision, damm_model_status,
               damm_model_ratified, damm_model_sha256, damm_model_schema_sha256,
               damm_source_repository, damm_source_commit, damm_source_model_path,
               damm_source_model_sha256, damm_source_schema_path,
               damm_source_schema_sha256, census_revision, census_path, census_sha256,
               engine_version, engine_path, engine_sha256, renderer_version,
               renderer_path, renderer_sha256, assessment_input_artifact_key,
               assessment_input_source_path, assessment_input_sha256,
               machine_row_count, machine_row_set_sha256, g1_scope_rows,
               g1_scope_row_count, g1_scope_sha256, g2_scope_rows, g2_scope_row_count,
               g2_scope_sha256, g2_mandatory_row_count, g2_remainder_row_count,
               g2_sample_row_count, target_identity_sha256, completed_at)
             select $1, $2, template.country_id, template.owner_user_id, $3,
                    'bundle', bundle.sha256, template.observations_artifact_key,
                    observations.sha256, template.workflow_id, template.workflow_version,
                    template.workflow_contract_sha256, template.manifest_schema_version,
                    template.damm_model_id, template.damm_model_version,
                    template.damm_model_revision, template.damm_model_status,
                    template.damm_model_ratified, template.damm_model_sha256,
                    template.damm_model_schema_sha256, template.damm_source_repository,
                    template.damm_source_commit, template.damm_source_model_path,
                    template.damm_source_model_sha256, template.damm_source_schema_path,
                    template.damm_source_schema_sha256, template.census_revision,
                    template.census_path, template.census_sha256, template.engine_version,
                    template.engine_path, template.engine_sha256, template.renderer_version,
                    template.renderer_path, template.renderer_sha256, 'assessment-input',
                    assessment.relative_path, assessment.sha256, $4, $5, $6::jsonb, $4, $7,
                    $8::jsonb, $9, $10, $11, $12, $13, $14, workflow_run.finished_at
             from workflow_approval_packages template
             join runs workflow_run on workflow_run.id = $2
             join workflow_run_artifacts bundle
               on bundle.run_id = $2 and bundle.artifact_set_id = $3
              and bundle.artifact_key = 'bundle'
             join workflow_run_artifacts observations
               on observations.run_id = $2 and observations.artifact_set_id = $3
              and observations.artifact_key = template.observations_artifact_key
             join workflow_run_artifacts assessment
               on assessment.run_id = $2 and assessment.artifact_set_id = $3
              and assessment.artifact_key = 'assessment-input'
             where template.id = $15`,
            [
              forgedPackageId,
              runId,
              artifactSetId,
              forgedRows.length,
              forgedMachineSetSha256,
              JSON.stringify(forgedG1Scope),
              forgedG1ScopeSha256,
              JSON.stringify(forgedG2Scope),
              forgedG2Scope.length,
              forgedG2ScopeSha256,
              new Set([...forgedG2Protocol.prerequisiteRowIds, ...forgedG2Protocol.judgedRowIds])
                .size,
              forgedG2Protocol.remainderCount,
              forgedG2Protocol.sampleSize,
              forgedTargetSha256,
              fx.approvalPackage.id,
            ],
          );
          for (const [index, row] of forgedRows.entries()) {
            await transaction.query(
              `insert into workflow_approval_rows
                (package_id, target_identity_sha256, ordinal, indicator_id, row_sha256,
                 classification, prerequisite, row_payload)
               values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
              [
                forgedPackageId,
                forgedTargetSha256,
                index + 1,
                row.indicatorId,
                row.rowSha256,
                row.classification,
                row.prerequisite,
                JSON.stringify(row.payload),
              ],
            );
          }
          await transaction.query(
            `update workflow_approval_packages set materialized_at = now() where id = $1`,
            [forgedPackageId],
          );
          await transaction.query(
            `insert into workflow_approval_assignments
              (id, package_id, target_identity_sha256, gate, reviewer_user_id,
               reviewer_name, reviewer_email, declared_role, assigned_by_user_id,
               assigned_by_name, assigned_by_email, scope_rows, scope_row_count, scope_sha256)
             values ('forged-g1-assignment', $1, $2, 'g1', $3, $4, $5, 'assessor',
                     $6, $7, $8, $9::jsonb, $10, $11)`,
            [
              forgedPackageId,
              forgedTargetSha256,
              USERS.assessor.id,
              USERS.assessor.name,
              USERS.assessor.email,
              USERS.owner.id,
              USERS.owner.name,
              USERS.owner.email,
              JSON.stringify(forgedG1Scope),
              forgedG1Scope.length,
              forgedG1ScopeSha256,
            ],
          );
        }),
        /canonical assessment-input rows/,
      );
      const persisted = await fx.sql.query<{ packages: number; assignments: number }>(
        `select
           (select count(*)::int from workflow_approval_packages where id = $1) as packages,
           (select count(*)::int from workflow_approval_assignments
             where package_id = $1) as assignments`,
        [forgedPackageId],
      );
      assert.deepEqual(persisted[0], { packages: 0, assignments: 0 });
    } finally {
      await fx.pg.close();
    }
  });

  it("rejects dev, automated, vendor, and machine actors at store and database boundaries", async () => {
    const fx = await fixture("actors");
    try {
      const dev = await ensureApprovalPackage(fx.countryId, "dev-user", fx.sql);
      assert.equal(dev.ok, false);
      if (!dev.ok) assert.equal(dev.error.code, "AUTH_REQUIRED");
      const { g1 } = await assignBoth(fx);
      const scopeReviews = g1.scope.map((row) => ({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
        decision: "approved",
        notes: "",
      }));
      for (const actorKind of ["automated", "vendor", "machine"]) {
        await assert.rejects(
          fx.sql.query(
            `insert into workflow_approval_decisions
              (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
               reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
               notes, reviewer_affirmation, reviewer_affirmation_version,
               reviewer_affirmation_text, reviewer_affirmation_sha256, row_reviews,
               affirmations)
             values ($1, $2, $3, $4, 'g1', $5, $6, $7, $8, 'assessor', 'approved',
                     '', true, $9, $10, $11, $12::jsonb, '{}'::jsonb)`,
            [
              `bad-${actorKind}`,
              fx.approvalPackage.id,
              fx.approvalPackage.targetIdentitySha256,
              g1.id,
              actorKind,
              USERS.assessor.id,
              USERS.assessor.name,
              USERS.assessor.email,
              HUMAN_REVIEW_AFFIRMATIONS.g1.version,
              HUMAN_REVIEW_AFFIRMATIONS.g1.text,
              HUMAN_REVIEW_AFFIRMATIONS.g1.sha256,
              JSON.stringify(scopeReviews),
            ],
          ),
          /actor_kind|automated actors|human/,
        );
      }
    } finally {
      await fx.pg.close();
    }
  });

  it("enforces G2 independence, deterministic locked scope, and accepted G1 ordering", async () => {
    const fx = await fixture("independence");
    try {
      const g1 = unwrap(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );
      const samePerson = await assignApprovalReviewer(
        {
          packageId: fx.approvalPackage.id,
          expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
          expectedBundleSha256: fx.approvalPackage.bundleSha256,
          gate: "g2",
          reviewerEmail: USERS.assessor.email,
          declaredRole: "independent_reviewer",
          ownerUserId: USERS.owner.id,
        },
        fx.sql,
      );
      assert.equal(samePerson.ok, false);
      const g2 = unwrap(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g2",
            reviewerEmail: USERS.peer.email,
            declaredRole: "independent_reviewer",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );
      const beforeG1 = unwrap(await getAssignedReview(g2.id, USERS.peer.id, fx.sql));
      assert.equal(beforeG1.canSubmit, false);
      assert.match(beforeG1.lockedReason ?? "", /G1/);
      const earlyG2 = await approveAssignment(fx, g2);
      assert.equal(earlyG2.ok, false);
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_assignments
            (id, package_id, target_identity_sha256, gate, reviewer_user_id,
             reviewer_name, reviewer_email, declared_role, assigned_by_user_id,
             assigned_by_name, assigned_by_email, scope_rows, scope_row_count, scope_sha256)
           values ('under-scope', $1, $2, 'g2', $3, $4, $5, 'independent_reviewer',
                   $6, $7, $8, $9::jsonb, 1, $10)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.other.id,
            USERS.other.name,
            USERS.other.email,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
            JSON.stringify([fx.approvalPackage.g2Scope[0]]),
            createHash("sha256").update("forged").digest("hex"),
          ],
        ),
        /protocol scope|immutable|duplicate|unique|active reviewer assignment/,
      );
      unwrap(await approveAssignment(fx, g1));
      const g2AfterG1 = unwrap(await getAssignedReview(g2.id, USERS.peer.id, fx.sql));
      assert.equal(g2AfterG1.canSubmit, true);
      assert.equal(g2AfterG1.ownDecision, null);
      assert.equal("priorDecisions" in g2AfterG1, false);
      const g2Reviews = g2.scope.map((row) => ({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
        decision: "approved",
        notes: "",
      }));
      const staleDisplayedAffirmation = await submitAssignedReview(
        {
          assignmentId: g2.id,
          reviewerUserId: g2.reviewerUserId,
          decision: "approved",
          notes: "G2 independently reviewed",
          affirmation: true,
          expectedAffirmationVersion: "damm.g2-human-affirmation/stale",
          expectedAffirmationSha256: HUMAN_REVIEW_AFFIRMATIONS.g2.sha256,
          rows: g2.scope.map((row) => ({
            indicatorId: row.indicatorId,
            decision: "approved",
          })),
        },
        fx.sql,
      );
      assert.equal(staleDisplayedAffirmation.ok, false);
      if (!staleDisplayedAffirmation.ok) {
        assert.equal(staleDisplayedAffirmation.error.code, "CONFLICT");
      }
      const genericAffirmation = "I reviewed the rows.";
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_decisions
            (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
             reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
             notes, reviewer_affirmation, reviewer_affirmation_version,
             reviewer_affirmation_text, reviewer_affirmation_sha256, row_reviews,
             affirmations)
           values ('generic-g2-affirmation', $1, $2, $3, 'g2', 'human', $4, $5, $6,
                   'independent_reviewer', 'approved', '', true, $7, $8, $9,
                   $10::jsonb, '{}'::jsonb)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            g2.id,
            USERS.peer.id,
            USERS.peer.name,
            USERS.peer.email,
            HUMAN_REVIEW_AFFIRMATIONS.g2.version,
            genericAffirmation,
            createHash("sha256").update(genericAffirmation).digest("hex"),
            JSON.stringify(g2Reviews),
          ],
        ),
        /exact versioned QC affirmation/,
      );
      const g2Decision = unwrap(await approveAssignment(fx, g2));
      assert.equal(g2Decision.reviewerAffirmationVersion, HUMAN_REVIEW_AFFIRMATIONS.g2.version);
      assert.equal(g2Decision.reviewerAffirmationText, HUMAN_REVIEW_AFFIRMATIONS.g2.text);
      assert.equal(g2Decision.reviewerAffirmationSha256, HUMAN_REVIEW_AFFIRMATIONS.g2.sha256);
      assert.match(g2Decision.reviewerAffirmationText ?? "", /source resolves/);
      assert.match(g2Decision.reviewerAffirmationText ?? "", /evidence quality and scale/);
      const g2Completed = unwrap(await getAssignedReview(g2.id, USERS.peer.id, fx.sql));
      assert.equal(g2Completed.ownDecision?.id, g2Decision.id);
      assert.equal(g2Completed.ownDecision?.reviewerUserId, USERS.peer.id);
    } finally {
      await fx.pg.close();
    }
  });

  it("atomically supersedes an unavailable reviewer and revokes every old access path", async () => {
    const fx = await fixture("supersede-access");
    try {
      const unassignedArtifactAccess = await getApprovalArtifactAccess(
        fx.runId,
        "bundle",
        USERS.peer.id,
        fx.sql,
      );
      assert.equal(unassignedArtifactAccess.ok, false);
      if (!unassignedArtifactAccess.ok) {
        assert.equal(unassignedArtifactAccess.error.code, "FORBIDDEN");
      }
      const original = unwrap(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );
      const originalArtifactAccess = unwrap(
        await getApprovalArtifactAccess(fx.runId, "bundle", USERS.assessor.id, fx.sql),
      );
      assert.equal(originalArtifactAccess.accessAs, "assigned_reviewer");
      assert.equal(originalArtifactAccess.reviewerAssignmentId, original.id);

      const missingReason = await assignApprovalReviewer(
        {
          packageId: fx.approvalPackage.id,
          expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
          expectedBundleSha256: fx.approvalPackage.bundleSha256,
          gate: "g1",
          reviewerEmail: USERS.other.email,
          declaredRole: "assessor",
          ownerUserId: USERS.owner.id,
          expectedActiveAssignmentId: original.id,
        },
        fx.sql,
      );
      assert.equal(missingReason.ok, false);
      if (!missingReason.ok) assert.equal(missingReason.error.code, "INVALID_INPUT");

      const staleExpected = await replaceAssignment(
        fx,
        { ...original, id: "stale-assignment-id" },
        USERS.other.email,
      );
      assert.equal(staleExpected.ok, false);
      if (!staleExpected.ok) assert.equal(staleExpected.error.code, "CONFLICT");

      await assert.rejects(
        fx.sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into workflow_approval_assignment_supersessions
              (id, revoked_assignment_id, superseding_assignment_id, package_id,
               target_identity_sha256, gate, revoked_by_user_id, revoked_by_name,
               revoked_by_email, reason)
             values ('orphaned-supersession', $1, 'missing-successor', $2, $3, 'g1',
                     $4, $5, $6, 'This must roll back without a successor')`,
            [
              original.id,
              fx.approvalPackage.id,
              fx.approvalPackage.targetIdentitySha256,
              USERS.owner.id,
              USERS.owner.name,
              USERS.owner.email,
            ],
          );
        }),
        /successor|foreign key/,
      );
      const rolledBackRevocation = await fx.sql.query<{ active: boolean; audits: number }>(
        `select
           (select active from workflow_approval_assignments where id = $1) as active,
           (select count(*)::int from workflow_approval_assignment_supersessions
            where revoked_assignment_id = $1) as audits`,
        [original.id],
      );
      assert.deepEqual(rolledBackRevocation[0], { active: true, audits: 0 });

      const replacement = unwrap(
        await replaceAssignment(
          fx,
          original,
          USERS.other.email,
          "Assessor confirmed they cannot complete the row review",
          "replacement-assignment",
        ),
      );
      assert.equal(replacement.reviewerUserId, USERS.other.id);
      const audit = await fx.sql.query<{
        revoked_assignment_id: string;
        superseding_assignment_id: string;
        revoked_by_user_id: string;
        revoked_by_name: string;
        revoked_by_email: string;
        reason: string;
        revoked_at: string;
      }>(
        `select revoked_assignment_id, superseding_assignment_id, revoked_by_user_id,
                revoked_by_name, revoked_by_email, reason, revoked_at::text as revoked_at
         from workflow_approval_assignment_supersessions where package_id = $1`,
        [fx.approvalPackage.id],
      );
      assert.deepEqual(audit, [
        {
          revoked_assignment_id: original.id,
          superseding_assignment_id: replacement.id,
          revoked_by_user_id: USERS.owner.id,
          revoked_by_name: USERS.owner.name,
          revoked_by_email: USERS.owner.email,
          reason: "Assessor confirmed they cannot complete the row review",
          revoked_at: audit[0].revoked_at,
        },
      ]);
      assert.ok(audit[0].revoked_at);
      const activity = await fx.sql.query<{ id: string; active: boolean }>(
        `select id, active from workflow_approval_assignments
         where package_id = $1 and gate = 'g1' order by id`,
        [fx.approvalPackage.id],
      );
      assert.deepEqual(
        Object.fromEntries(activity.map((assignment) => [assignment.id, assignment.active])),
        { [original.id]: false, [replacement.id]: true },
      );

      const oldReview = await getAssignedReview(original.id, USERS.assessor.id, fx.sql);
      assert.equal(oldReview.ok, false);
      if (!oldReview.ok) assert.equal(oldReview.error.code, "NOT_FOUND");
      const oldSubmission = await approveAssignment(fx, original);
      assert.equal(oldSubmission.ok, false);
      if (!oldSubmission.ok) assert.equal(oldSubmission.error.code, "NOT_FOUND");
      const oldArtifactAccess = await getApprovalArtifactAccess(
        fx.runId,
        "bundle",
        USERS.assessor.id,
        fx.sql,
      );
      assert.equal(oldArtifactAccess.ok, false);
      if (!oldArtifactAccess.ok) assert.equal(oldArtifactAccess.error.code, "FORBIDDEN");

      const activeReview = unwrap(await getAssignedReview(replacement.id, USERS.other.id, fx.sql));
      assert.equal(activeReview.ownDecision, null);
      assert.equal("priorDecisions" in activeReview, false);
      const replacementArtifactAccess = unwrap(
        await getApprovalArtifactAccess(fx.runId, "bundle", USERS.other.id, fx.sql),
      );
      assert.equal(replacementArtifactAccess.accessAs, "assigned_reviewer");
      assert.equal(replacementArtifactAccess.reviewerAssignmentId, replacement.id);
      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.deepEqual(
        state.assignments.map((assignment) => assignment.id),
        [replacement.id],
      );
      assert.deepEqual(
        state.assignmentSupersessions.map((supersession) => ({
          revokedAssignmentId: supersession.revokedAssignmentId,
          supersedingAssignmentId: supersession.supersedingAssignmentId,
          revokedByUserId: supersession.revokedByUserId,
          reason: supersession.reason,
        })),
        [
          {
            revokedAssignmentId: original.id,
            supersedingAssignmentId: replacement.id,
            revokedByUserId: USERS.owner.id,
            reason: "Assessor confirmed they cannot complete the row review",
          },
        ],
      );
      const historicalG1AsG2 = await assignApprovalReviewer(
        {
          packageId: fx.approvalPackage.id,
          expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
          expectedBundleSha256: fx.approvalPackage.bundleSha256,
          gate: "g2",
          reviewerEmail: USERS.assessor.email,
          declaredRole: "independent_reviewer",
          ownerUserId: USERS.owner.id,
        },
        fx.sql,
      );
      assert.equal(historicalG1AsG2.ok, false);
      if (!historicalG1AsG2.ok) assert.equal(historicalG1AsG2.error.code, "FORBIDDEN");

      const reviews = original.scope.map((row) => ({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
        decision: "approved",
        notes: "",
      }));
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_decisions
            (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
             reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
             notes, reviewer_affirmation, reviewer_affirmation_version,
             reviewer_affirmation_text, reviewer_affirmation_sha256, row_reviews,
             affirmations)
           values ('revoked-decision', $1, $2, $3, 'g1', 'human', $4, $5, $6,
                   'assessor', 'approved', '', true, $7, $8, $9, $10::jsonb,
                   '{}'::jsonb)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            original.id,
            USERS.assessor.id,
            USERS.assessor.name,
            USERS.assessor.email,
            HUMAN_REVIEW_AFFIRMATIONS.g1.version,
            HUMAN_REVIEW_AFFIRMATIONS.g1.text,
            HUMAN_REVIEW_AFFIRMATIONS.g1.sha256,
            JSON.stringify(reviews),
          ],
        ),
        /assignment|query returned no rows|revoked/,
      );
      await assert.rejects(
        fx.sql.query(
          `update workflow_approval_assignment_supersessions set reason = 'Changed'
           where revoked_assignment_id = $1`,
          [original.id],
        ),
        /append-only|immutable/,
      );
      await assert.rejects(
        fx.sql.query("delete from workflow_approval_assignments where id = $1", [original.id]),
        /append-only|immutable/,
      );
      await assert.rejects(
        fx.sql.query("update workflow_approval_assignments set active = false where id = $1", [
          replacement.id,
        ]),
        /append-only|immutable/,
      );
      const otherPackage = await publishAdditionalWorkflow(fx, "supersede-access-other-package");
      const crossPackageAccess = await getApprovalArtifactAccess(
        otherPackage.runId,
        "bundle",
        USERS.other.id,
        fx.sql,
      );
      assert.equal(crossPackageAccess.ok, false);
      if (!crossPackageAccess.ok) assert.equal(crossPackageAccess.error.code, "FORBIDDEN");
    } finally {
      await fx.pg.close();
    }
  });

  it("serializes competing replacements and permits only one active assignment", async () => {
    const fx = await fixture("supersede-race");
    try {
      const { g1 } = await assignBoth(fx);
      const replacements = await Promise.all([
        replaceAssignment(fx, g1, USERS.other.email, "First replacement intent", "successor-a"),
        replaceAssignment(fx, g1, USERS.peer.email, "Second replacement intent", "successor-b"),
      ]);
      assert.equal(replacements.filter((result) => result.ok).length, 1);
      assert.equal(replacements.filter((result) => !result.ok).length, 1);
      const rejected = replacements.find((result) => !result.ok);
      if (rejected && !rejected.ok) assert.equal(rejected.error.code, "CONFLICT");
      const counts = await fx.sql.query<{
        assignments: number;
        supersessions: number;
        active: number;
      }>(
        `select
           (select count(*)::int from workflow_approval_assignments
            where package_id = $1 and gate = 'g1') as assignments,
           (select count(*)::int from workflow_approval_assignment_supersessions
            where package_id = $1 and gate = 'g1') as supersessions,
           (select count(*)::int
            from workflow_approval_assignments assignment
            where assignment.package_id = $1 and assignment.gate = 'g1'
              and not exists (
                select 1 from workflow_approval_assignment_supersessions supersession
                where supersession.revoked_assignment_id = assignment.id
              )) as active`,
        [fx.approvalPackage.id],
      );
      assert.deepEqual(counts[0], { assignments: 2, supersessions: 1, active: 1 });

      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_assignments
            (id, package_id, target_identity_sha256, gate, reviewer_user_id,
             reviewer_name, reviewer_email, declared_role, assigned_by_user_id,
             assigned_by_name, assigned_by_email, scope_rows, scope_row_count, scope_sha256)
           values ('second-active', $1, $2, 'g1', $3, $4, $5, 'assessor',
                   $6, $7, $8, $9::jsonb, $10, $11)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.assessor.id,
            USERS.assessor.name,
            USERS.assessor.email,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
            JSON.stringify(fx.approvalPackage.g1Scope),
            fx.approvalPackage.g1Scope.length,
            fx.approvalPackage.g1ScopeSha256,
          ],
        ),
        /active reviewer assignment/,
      );
    } finally {
      await fx.pg.close();
    }
  });

  it("serializes a decision racing the assignment's replacement", async () => {
    const fx = await fixture("supersede-decision-race");
    try {
      const g1 = unwrap(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );
      const raced = await Promise.all([
        replaceAssignment(
          fx,
          g1,
          USERS.other.email,
          "Reviewer availability changed while review was being completed",
          "decision-race-successor",
        ),
        approveAssignment(fx, g1),
      ]);
      assert.equal(raced.filter((result) => result.ok).length, 1);
      const invariant = await fx.sql.query<{
        decisions: number;
        supersessions: number;
        original_active: boolean;
      }>(
        `select
           (select count(*)::int from workflow_approval_decisions
            where assignment_id = $1) as decisions,
           (select count(*)::int from workflow_approval_assignment_supersessions
            where revoked_assignment_id = $1) as supersessions,
           (select active from workflow_approval_assignments where id = $1) as original_active`,
        [g1.id],
      );
      assert.equal(invariant[0].decisions + invariant[0].supersessions, 1);
      assert.equal(invariant[0].original_active, invariant[0].decisions === 1);
    } finally {
      await fx.pg.close();
    }
  });

  it("keeps completed assignments usable and rejects their later replacement", async () => {
    const fx = await fixture("supersede-complete");
    try {
      const { g1, g2 } = await assignBoth(fx);
      const decision = unwrap(await approveAssignment(fx, g1));
      const completed = unwrap(await getAssignedReview(g1.id, USERS.assessor.id, fx.sql));
      assert.equal(completed.ownDecision?.id, decision.id);
      assert.equal(completed.canSubmit, false);
      assert.equal(
        unwrap(await getApprovalArtifactAccess(fx.runId, "bundle", USERS.assessor.id, fx.sql))
          .accessAs,
        "assigned_reviewer",
      );
      const afterDecision = await replaceAssignment(fx, g1, USERS.other.email);
      assert.equal(afterDecision.ok, false);
      if (!afterDecision.ok) assert.equal(afterDecision.error.code, "INVALID_STATE");

      unwrap(await approveAssignment(fx, g2));
      unwrap(
        await submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "Release blocks all later reassignment",
            affirmations: allAffirmations(),
          },
          fx.sql,
        ),
      );
      const afterRelease = await replaceAssignment(fx, g2, USERS.other.email);
      assert.equal(afterRelease.ok, false);
      if (!afterRelease.ok) assert.equal(afterRelease.error.code, "INVALID_STATE");
      const persisted = await fx.sql.query<{ supersessions: number }>(
        `select count(*)::int as supersessions
         from workflow_approval_assignment_supersessions where package_id = $1`,
        [fx.approvalPackage.id],
      );
      assert.equal(persisted[0].supersessions, 0);
    } finally {
      await fx.pg.close();
    }
  });

  it("requires the immutable package owner to remain the active country owner for replacement", async () => {
    const fx = await fixture("supersede-owner");
    try {
      const g1 = unwrap(
        await assignApprovalReviewer(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.owner.id,
          },
          fx.sql,
        ),
      );
      await fx.sql.query("update countries set user_id = $2 where id = $1", [
        fx.countryId,
        USERS.other.id,
      ]);
      const staleOwner = await replaceAssignment(fx, g1, USERS.peer.email);
      assert.equal(staleOwner.ok, false);
      if (!staleOwner.ok) assert.equal(staleOwner.error.code, "FORBIDDEN");
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_assignment_supersessions
            (id, revoked_assignment_id, superseding_assignment_id, package_id,
             target_identity_sha256, gate, revoked_by_user_id, revoked_by_name,
             revoked_by_email, reason)
           values ('stale-owner-supersession', $1, 'stale-owner-successor', $2, $3, 'g1',
                   $4, $5, $6, 'Stale country ownership must fail')`,
          [
            g1.id,
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
          ],
        ),
        /active country owner/,
      );
      const persisted = await fx.sql.query<{ active: boolean; audits: number }>(
        `select
           (select active from workflow_approval_assignments where id = $1) as active,
           (select count(*)::int from workflow_approval_assignment_supersessions
            where revoked_assignment_id = $1) as audits`,
        [g1.id],
      );
      assert.deepEqual(persisted[0], { active: true, audits: 0 });
    } finally {
      await fx.pg.close();
    }
  });

  it("rejects early G3 and package/assignment replay against another bundle", async () => {
    const first = await fixture("replay-a");
    try {
      const early = await submitCountryOwnerSignoff(
        {
          packageId: first.approvalPackage.id,
          expectedTargetIdentitySha256: first.approvalPackage.targetIdentitySha256,
          expectedBundleSha256: first.approvalPackage.bundleSha256,
          ownerUserId: USERS.owner.id,
          decision: "approved",
          notes: "too early",
          affirmations: allAffirmations(),
        },
        first.sql,
      );
      assert.equal(early.ok, false);
      const earlyRows = await first.sql.query<{ decisions: number; releases: number }>(
        `select
           (select count(*)::int from workflow_approval_decisions where package_id = $1) as decisions,
           (select count(*)::int from workflow_approval_releases where package_id = $1) as releases`,
        [first.approvalPackage.id],
      );
      assert.deepEqual(earlyRows[0], { decisions: 0, releases: 0 });

      const secondCountry = "country-replay-b";
      const secondRun = "run-replay-b";
      const secondSet = "set-replay-b";
      const secondObservations = observationBytes("replay-b");
      await first.sql.query(
        `insert into countries (id, user_id, name, iso3) values ($1, $2, 'Second', 'TSB')`,
        [secondCountry, USERS.owner.id],
      );
      await insertCompletedWorkflow(first.sql, {
        countryId: secondCountry,
        countryName: "Second",
        iso3: "TSB",
        runId: secondRun,
        artifactSetId: secondSet,
        outBasename: "second",
        observations: secondObservations,
        completedAt: "2026-08-27T00:00:02.987654Z",
      });
      const secondPackage = unwrap(
        await ensureApprovalPackage(secondCountry, USERS.owner.id, first.sql),
      );
      const staleIntent = await assignApprovalReviewer(
        {
          packageId: first.approvalPackage.id,
          expectedTargetIdentitySha256: secondPackage.targetIdentitySha256,
          expectedBundleSha256: secondPackage.bundleSha256,
          gate: "g1",
          reviewerEmail: USERS.assessor.email,
          declaredRole: "assessor",
          ownerUserId: USERS.owner.id,
        },
        first.sql,
      );
      assert.equal(staleIntent.ok, false);
      if (!staleIntent.ok) assert.equal(staleIntent.error.code, "CONFLICT");
      const { g1 } = await assignBoth(first);
      const reviews = g1.scope.map((row) => ({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
        decision: "approved",
        notes: "",
      }));
      await assert.rejects(
        first.sql.query(
          `insert into workflow_approval_decisions
            (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
             reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
             notes, reviewer_affirmation, reviewer_affirmation_version,
             reviewer_affirmation_text, reviewer_affirmation_sha256, row_reviews,
             affirmations)
           values ('replay', $1, $2, $3, 'g1', 'human', $4, $5, $6, 'assessor',
                   'approved', '', true, $7, $8, $9, $10::jsonb, '{}'::jsonb)`,
          [
            secondPackage.id,
            secondPackage.targetIdentitySha256,
            g1.id,
            USERS.assessor.id,
            USERS.assessor.name,
            USERS.assessor.email,
            HUMAN_REVIEW_AFFIRMATIONS.g1.version,
            HUMAN_REVIEW_AFFIRMATIONS.g1.text,
            HUMAN_REVIEW_AFFIRMATIONS.g1.sha256,
            JSON.stringify(reviews),
          ],
        ),
        /assignment|query returned no rows|foreign key|exact/,
      );
    } finally {
      await first.pg.close();
    }
  });

  it("rejects stale owner assignment and G3 after country deletion or ownership transfer", async () => {
    const fx = await fixture("stale-owner");
    try {
      await fx.sql.query("update countries set deleted_at = now() where id = $1", [fx.countryId]);
      const staleAssignment = await assignApprovalReviewer(
        {
          packageId: fx.approvalPackage.id,
          expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
          expectedBundleSha256: fx.approvalPackage.bundleSha256,
          gate: "g1",
          reviewerEmail: USERS.assessor.email,
          declaredRole: "assessor",
          ownerUserId: USERS.owner.id,
        },
        fx.sql,
      );
      assert.equal(staleAssignment.ok, false);
      if (!staleAssignment.ok) assert.equal(staleAssignment.error.code, "FORBIDDEN");
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_assignments
            (id, package_id, target_identity_sha256, gate, reviewer_user_id,
             reviewer_name, reviewer_email, declared_role, assigned_by_user_id,
             assigned_by_name, assigned_by_email, scope_rows, scope_row_count, scope_sha256)
           values ('stale-assignment', $1, $2, 'g1', $3, $4, $5, 'assessor',
                   $6, $7, $8, $9::jsonb, $10, $11)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.assessor.id,
            USERS.assessor.name,
            USERS.assessor.email,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
            JSON.stringify(fx.approvalPackage.g1Scope),
            fx.approvalPackage.g1Scope.length,
            fx.approvalPackage.g1ScopeSha256,
          ],
        ),
        /active country owner/,
      );

      await fx.sql.query("update countries set deleted_at = null where id = $1", [fx.countryId]);
      const { g1, g2 } = await assignBoth(fx);
      unwrap(await approveAssignment(fx, g1));
      unwrap(await approveAssignment(fx, g2));
      await fx.sql.query("update countries set user_id = $2 where id = $1", [
        fx.countryId,
        USERS.other.id,
      ]);
      const staleG3 = await submitCountryOwnerSignoff(
        {
          packageId: fx.approvalPackage.id,
          expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
          expectedBundleSha256: fx.approvalPackage.bundleSha256,
          ownerUserId: USERS.owner.id,
          decision: "approved",
          notes: "Stale owner must not authorize circulation",
          affirmations: allAffirmations(),
        },
        fx.sql,
      );
      assert.equal(staleG3.ok, false);
      if (!staleG3.ok) assert.equal(staleG3.error.code, "FORBIDDEN");
      await assert.rejects(
        fx.sql.query(
          `insert into workflow_approval_decisions
            (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
             reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
             notes, reviewer_affirmation, row_reviews, affirmations)
           values ('stale-g3', $1, $2, null, 'g3', 'human', $3, $4, $5,
                   'ttl_country_owner', 'approved', 'Stale', true, '[]'::jsonb, $6::jsonb)`,
          [
            fx.approvalPackage.id,
            fx.approvalPackage.targetIdentitySha256,
            USERS.owner.id,
            USERS.owner.name,
            USERS.owner.email,
            JSON.stringify(allAffirmations()),
          ],
        ),
        /active country owner/,
      );
      const persisted = await fx.sql.query<{ g3: number; releases: number }>(
        `select
           (select count(*)::int from workflow_approval_decisions
            where package_id = $1 and gate = 'g3') as g3,
           (select count(*)::int from workflow_approval_releases
            where package_id = $1) as releases`,
        [fx.approvalPackage.id],
      );
      assert.deepEqual(persisted[0], { g3: 0, releases: 0 });
    } finally {
      await fx.pg.close();
    }
  });

  it("does not reveal whether an owner-only package probe names another owner's package", async () => {
    const fx = await fixture("owner-probe");
    try {
      const assignmentProbe = (packageId: string) =>
        assignApprovalReviewer(
          {
            packageId,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            gate: "g1",
            reviewerEmail: USERS.assessor.email,
            declaredRole: "assessor",
            ownerUserId: USERS.other.id,
          },
          fx.sql,
        );
      const g3Probe = (packageId: string) =>
        submitCountryOwnerSignoff(
          {
            packageId,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.other.id,
            decision: "approved",
            notes: "Unauthorized package probe",
            affirmations: allAffirmations(),
          },
          fx.sql,
        );

      const missingId = "approval-package-that-does-not-exist";
      const [
        existingAssignment,
        missingAssignment,
        existingG3,
        missingG3,
        existingState,
        missingState,
      ] = await Promise.all([
        assignmentProbe(fx.approvalPackage.id),
        assignmentProbe(missingId),
        g3Probe(fx.approvalPackage.id),
        g3Probe(missingId),
        getOwnerApprovalState(fx.countryId, USERS.other.id, fx.sql, fx.approvalPackage.id),
        getOwnerApprovalState(fx.countryId, USERS.other.id, fx.sql, missingId),
      ]);
      for (const result of [
        existingAssignment,
        missingAssignment,
        existingG3,
        missingG3,
        existingState,
        missingState,
      ]) {
        assert.equal(result.ok, false);
      }
      if (
        !existingAssignment.ok &&
        !missingAssignment.ok &&
        !existingG3.ok &&
        !missingG3.ok &&
        !existingState.ok &&
        !missingState.ok
      ) {
        assert.deepEqual(existingAssignment.error, missingAssignment.error);
        assert.deepEqual(existingG3.error, missingG3.error);
        assert.deepEqual(existingState.error, missingState.error);
        assert.equal(existingAssignment.error.code, "NOT_FOUND");
        assert.equal(existingG3.error.code, "NOT_FOUND");
        assert.equal(existingState.error.code, "NOT_FOUND");
      }
    } finally {
      await fx.pg.close();
    }
  });

  it("makes first decision win and freezes completed reviewer identity", async () => {
    const fx = await fixture("concurrency");
    try {
      const { g1 } = await assignBoth(fx);
      const raced = await Promise.all([approveAssignment(fx, g1), approveAssignment(fx, g1)]);
      assert.equal(raced.filter((result) => result.ok).length, 1);
      assert.equal(raced.filter((result) => !result.ok).length, 1);
      const first = unwrap(raced.find((result) => result.ok) as (typeof raced)[number]);
      const persisted = await fx.sql.query<{ count: number }>(
        `select count(*)::int as count from workflow_approval_decisions
         where package_id = $1 and gate = 'g1'`,
        [fx.approvalPackage.id],
      );
      assert.equal(persisted[0].count, 1);
      await assert.rejects(
        fx.sql.query(
          `update workflow_approval_decisions set reviewer_name = 'Changed'
           where id = $1`,
          [first.id],
        ),
        /append-only|immutable/,
      );
      await assert.rejects(
        fx.sql.query("delete from workflow_approval_decisions where id = $1", [first.id]),
        /append-only|immutable/,
      );
      await fx.sql.query(`update "user" set "name" = 'Renamed user' where "id" = $1`, [
        USERS.assessor.id,
      ]);
      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(state.decisions[0].reviewerName, USERS.assessor.name);
    } finally {
      await fx.pg.close();
    }
  });

  it("rolls back an approved G3 when no versioned release commits with it", async () => {
    const fx = await fixture("atomic-g3");
    try {
      const { g1, g2 } = await assignBoth(fx);
      unwrap(await approveAssignment(fx, g1));
      unwrap(await approveAssignment(fx, g2));
      await assert.rejects(
        fx.sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into workflow_approval_decisions
              (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
               reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
               notes, reviewer_affirmation, row_reviews, affirmations)
             values ('orphan-g3', $1, $2, null, 'g3', 'human', $3, $4, $5,
                     'ttl_country_owner', 'approved', 'Attempted without release', true,
                     '[]'::jsonb, $6::jsonb)`,
            [
              fx.approvalPackage.id,
              fx.approvalPackage.targetIdentitySha256,
              USERS.owner.id,
              USERS.owner.name,
              USERS.owner.email,
              JSON.stringify(allAffirmations()),
            ],
          );
        }),
        /release must commit atomically/,
      );
      const persisted = await fx.sql.query<{ count: number }>(
        `select count(*)::int as count from workflow_approval_decisions
         where package_id = $1 and gate = 'g3'`,
        [fx.approvalPackage.id],
      );
      assert.equal(persisted[0].count, 0);
    } finally {
      await fx.pg.close();
    }
  });

  it("reads the exact decisions and their atomic release in one repeatable transaction", async () => {
    const fx = await fixture("consistent-read");
    try {
      const { g1, g2 } = await assignBoth(fx);
      unwrap(await approveAssignment(fx, g1));
      unwrap(await approveAssignment(fx, g2));
      const signed = unwrap(
        await submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "Consistent aggregate read",
            affirmations: allAffirmations(),
          },
          fx.sql,
        ),
      );
      const statements: string[] = [];
      let transactions = 0;
      const observed = observeSql(fx.sql, {
        onQuery: (text) => statements.push(text.replace(/\s+/g, " ").trim()),
        onTransaction: () => {
          transactions += 1;
        },
      });

      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, observed));
      assert.equal(transactions, 1);
      assert.match(
        statements[0] ?? "",
        /^set transaction isolation level repeatable read read only$/i,
      );
      assert.equal(
        state.decisions.find((decision) => decision.gate === "g3")?.id,
        signed.decision.id,
      );
      assert.equal(state.release?.g3DecisionId, signed.decision.id);
      assert.equal(state.lifecycle, "approved_draft");
    } finally {
      await fx.pg.close();
    }
  });

  it("rejects a self-hashed release manifest whose semantics do not match the decisions", async () => {
    const fx = await fixture("semantic-release");
    try {
      const { g1, g2 } = await assignBoth(fx);
      const g1Decision = unwrap(await approveAssignment(fx, g1));
      const g2Decision = unwrap(await approveAssignment(fx, g2));
      const g3Id = "semantic-g3";
      const releaseId = "semantic-release";
      const manifest = {
        schemaVersion: "damm.approval-release/v1",
        releaseId,
        packageId: fx.approvalPackage.id,
        targetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
        countryId: fx.countryId,
        version: 1,
        lifecycle: "approved_draft",
        externalCirculationAuthorized: true,
        runId: fx.runId,
        artifactSetId: fx.artifactSetId,
        bundleSha256: fx.approvalPackage.bundleSha256,
        observationsSha256: fx.approvalPackage.observationsSha256,
        workflowContractVersion: fx.approvalPackage.workflowVersion,
        workflowContractSha256: fx.approvalPackage.workflowContractSha256,
        methodology: fx.approvalPackage.methodology,
        assessmentInputSha256: fx.approvalPackage.assessmentInputSha256,
        g1DecisionId: g1Decision.id,
        g2DecisionId: g2Decision.id,
        g3DecisionId: g3Id,
        approvals: { tampered: true },
      };
      const manifestSha256 = createHash("sha256").update(canonicalJson(manifest)).digest("hex");
      await assert.rejects(
        fx.sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into workflow_approval_decisions
              (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
               reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
               notes, reviewer_affirmation, row_reviews, affirmations)
             values ($1, $2, $3, null, 'g3', 'human', $4, $5, $6,
                     'ttl_country_owner', 'approved', 'Signed', true, '[]'::jsonb, $7::jsonb)`,
            [
              g3Id,
              fx.approvalPackage.id,
              fx.approvalPackage.targetIdentitySha256,
              USERS.owner.id,
              USERS.owner.name,
              USERS.owner.email,
              JSON.stringify(allAffirmations()),
            ],
          );
          await transaction.query(
            `insert into workflow_approval_releases
              (id, package_id, target_identity_sha256, country_id, version_number,
               lifecycle, external_circulation_authorized, g1_decision_id, g2_decision_id,
               g3_decision_id, manifest_json, manifest_sha256)
             values ($1, $2, $3, $4, 1, 'approved_draft', true, $5, $6, $7, $8::jsonb, $9)`,
            [
              releaseId,
              fx.approvalPackage.id,
              fx.approvalPackage.targetIdentitySha256,
              fx.countryId,
              g1Decision.id,
              g2Decision.id,
              g3Id,
              JSON.stringify(manifest),
              manifestSha256,
            ],
          );
        }),
        /release manifest is not bound to its exact package and decisions/,
      );
      const persisted = await fx.sql.query<{ decisions: number; releases: number }>(
        `select
           (select count(*)::int from workflow_approval_decisions where id = $1) as decisions,
           (select count(*)::int from workflow_approval_releases where id = $2) as releases`,
        [g3Id, releaseId],
      );
      assert.deepEqual(persisted[0], { decisions: 0, releases: 0 });
    } finally {
      await fx.pg.close();
    }
  });

  it("serializes country-wide release versions across two concurrently signed packages", async () => {
    const first = await fixture("versions-one");
    try {
      const second = await publishAdditionalWorkflow(first, "versions-two");
      const firstAssignments = await assignBoth(first);
      const secondAssignments = await assignBoth(second);
      unwrap(await approveAssignment(first, firstAssignments.g1));
      unwrap(await approveAssignment(first, firstAssignments.g2));
      unwrap(await approveAssignment(second, secondAssignments.g1));
      unwrap(await approveAssignment(second, secondAssignments.g2));
      const sign = (fx: Fixture) =>
        submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "Country release version test",
            affirmations: allAffirmations(),
          },
          fx.sql,
        );
      const signed = await Promise.all([sign(first), sign(second)]);
      assert.equal(signed.filter((result) => result.ok).length, 2);
      const releases = signed.map(unwrap).map((result) => result.release);
      assert.deepEqual(releases.map((release) => release?.version).sort(), [1, 2]);
      assert.deepEqual(
        new Set(releases.map((release) => release?.packageId)),
        new Set([first.approvalPackage.id, second.approvalPackage.id]),
      );
      for (const release of releases) {
        assert.equal(release?.manifest.packageId, release?.packageId);
        assert.equal(release?.manifest.lifecycle, "approved_draft");
      }
    } finally {
      await first.pg.close();
    }
  });

  it("creates only a versioned approved-Draft release and leaves Stage 8 bytes untouched", async () => {
    const fx = await fixture("release");
    try {
      const before = await fx.sql.query<{ artifact_key: string; sha256: string; content: unknown }>(
        `select artifact_key, sha256, content from workflow_run_artifacts
         where run_id = $1 and artifact_set_id = $2 order by artifact_key`,
        [fx.runId, fx.artifactSetId],
      );
      const { g1, g2 } = await assignBoth(fx);
      unwrap(await approveAssignment(fx, g1));
      unwrap(await approveAssignment(fx, g2));
      const signed = unwrap(
        await submitCountryOwnerSignoff(
          {
            packageId: fx.approvalPackage.id,
            expectedTargetIdentitySha256: fx.approvalPackage.targetIdentitySha256,
            expectedBundleSha256: fx.approvalPackage.bundleSha256,
            ownerUserId: USERS.owner.id,
            decision: "approved",
            notes: "External circulation authorized as an approved Draft release",
            affirmations: allAffirmations(),
          },
          fx.sql,
        ),
      );
      assert.equal(signed.lifecycle, "approved_draft");
      assert.equal(signed.release?.externalCirculationAuthorized, true);
      assert.equal(signed.release?.lifecycle, "approved_draft");
      assert.equal(signed.decision.declaredRole, "ttl_country_owner");
      const after = await fx.sql.query<{ artifact_key: string; sha256: string; content: unknown }>(
        `select artifact_key, sha256, content from workflow_run_artifacts
         where run_id = $1 and artifact_set_id = $2 order by artifact_key`,
        [fx.runId, fx.artifactSetId],
      );
      assert.deepEqual(after, before);
      const state = unwrap(await getOwnerApprovalState(fx.countryId, USERS.owner.id, fx.sql));
      assert.equal(state.lifecycle, "approved_draft");
      assert.equal(state.release?.manifest.bundleSha256, fx.approvalPackage.bundleSha256);
      await assert.rejects(
        fx.sql.query(
          "update workflow_approval_releases set lifecycle='canonical_final' where id=$1",
          [signed.release?.id],
        ),
        /append-only|immutable/,
      );
    } finally {
      await fx.pg.close();
    }
  });
});
