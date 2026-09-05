import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../db.ts";
import {
  claimNextRun,
  createRun,
  deletePendingWorkflowUpload,
  finishRun,
  getPublishedWorkflowArtifact,
  getRun,
  latestWorkflowReviewTarget,
  listPublishedWorkflowArtifactKeys,
  listWorkflowReviews,
  publishWorkflowArtifactSet,
  recordWorkflowReview,
  releaseClaim,
  savePendingWorkflowUpload,
  saveWorkflowArtifact,
  workflowMethodologySnapshot,
  workflowRunUsesCanonicalMethodology,
  workflowUploadSnapshot,
} from "./run-store.ts";
import { DAMM_WORKFLOW_METHODOLOGY, type WorkflowMethodologyIdentity } from "./methodology.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256, MAX_WORKFLOW_UPLOAD_DOCUMENTS } from "./workflow.ts";
import { CLAIM_LEASE_MS, defaultVendorFor } from "./runs.ts";

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

function instrumentSql(
  database: Sql,
  hooks: {
    onTransaction?: () => void;
    beforeQuery?: (text: string) => void | Promise<void>;
    afterQuery?: (text: string) => void | Promise<void>;
  },
): Sql {
  const wrap = (delegate: Sql): Sql => {
    const instrumented = (async <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> => {
      const text = strings.join("$?");
      await hooks.beforeQuery?.(text);
      const rows = await delegate<T>(strings, ...values);
      await hooks.afterQuery?.(text);
      return rows;
    }) as Sql;
    instrumented.query = async <T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
    ) => {
      await hooks.beforeQuery?.(text);
      const rows = await delegate.query<T>(text, values);
      await hooks.afterQuery?.(text);
      return rows;
    };
    instrumented.transaction = (callback) =>
      delegate.transaction((transaction) => {
        hooks.onTransaction?.();
        return callback(wrap(transaction));
      });
    return instrumented;
  };
  return wrap(database);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function databaseThroughMigration(lastMigration?: string): Promise<{ pg: PGlite; sql: Sql }> {
  const pg = new PGlite();
  await pg.waitReady;
  const migrations = new URL("../../../migrations/", import.meta.url);
  const names = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    if (lastMigration && name > lastMigration) break;
    await pg.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  return { pg, sql: sqlFor(pg) };
}

async function migratedDatabase(): Promise<{ pg: PGlite; sql: Sql }> {
  return databaseThroughMigration();
}

function uploadInput(id: string, countryId: string, content = `document ${id}`) {
  const source = new TextEncoder().encode(`original ${id}`);
  return {
    id,
    userId: "user-1",
    countryId,
    filename: `${id}.txt`,
    kind: "country_context_documents",
    mime: "text/plain",
    chars: Array.from(content).length,
    content,
    source,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  };
}

async function insertCountry(sql: Sql, id: string) {
  await sql.query("insert into countries (id, user_id, name, iso3) values ($1, $2, $3, $4)", [
    id,
    "user-1",
    "Egypt",
    "EGY",
  ]);
}

function workflowRunInput(id: string, countryId: string) {
  return {
    id,
    userId: "user-1",
    countryId,
    countryName: "Egypt",
    iso3: "EGY",
    pass: "workflow" as const,
    ceilingUsd: 500,
    vendor: null,
    outBasename: `EGY_${id}`,
  };
}

const ASSESSMENT_INPUT_SHA256 = "a".repeat(64);
const PRE_0013_DAMM_SOURCE_COMMIT = "141ebd4db7fb8ebb0d21ed64ead6aef24a7d7027";
const PRE_0013_DAMM_RENDERER_SHA256 =
  "98f2a52e0be7f54ff38095db86a3f01525527661a4e6993f7c2ee0da1d2cb9c3";
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
const POST_0024_DAMM_SOURCE_COMMIT = "76ca33d97f0809a6be7477447786953317aa41b5";
const POST_0025_DAMM_SOURCE_COMMIT = "d81d267133eed52b5fdcc599bfecf8d72496f292";
const POST_0026_DAMM_SOURCE_COMMIT = "d708dbd0129cfb7f37dcf003875c439367b7c97d";
const POST_0027_DAMM_SOURCE_COMMIT = "397f78b400b24b0e60b0d0be880113935d1d90c7";

async function insertWorkflowMethodology(
  sql: Sql,
  runId: string,
  overrides: Partial<WorkflowMethodologyIdentity> = {},
) {
  // Source-only cutovers 0014-0018 retained the pre-0020 renderer; the later
  // source-only cutovers retain the v1.7 renderer. Replaying a migration after the
  // app manifest advances therefore needs the complete historical pair, not a
  // mixed identity assembled from today's renderer.
  const historicalRenderer =
    overrides.sourceCommit &&
    overrides.sourceCommit !== DAMM_WORKFLOW_METHODOLOGY.sourceCommit &&
    overrides.rendererSha256 === undefined
      ? {
          rendererSha256:
            overrides.sourceCommit === POST_0024_DAMM_SOURCE_COMMIT ||
            overrides.sourceCommit === PRE_0024_DAMM_SOURCE_COMMIT ||
            overrides.sourceCommit === PRE_0023_DAMM_SOURCE_COMMIT ||
            overrides.sourceCommit === PRE_0022_DAMM_SOURCE_COMMIT ||
            overrides.sourceCommit === PRE_0021_DAMM_SOURCE_COMMIT
              ? PRE_0023_DAMM_RENDERER_SHA256
              : PRE_0020_DAMM_RENDERER_SHA256,
        }
      : {};
  const value = { ...DAMM_WORKFLOW_METHODOLOGY, ...historicalRenderer, ...overrides };
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

describe("0011 methodology upgrade", () => {
  it("waits for active legacy workflows and preserves completed packages as unverified", async () => {
    const { pg, sql } = await databaseThroughMigration("0010_canonical_workflow.sql");
    try {
      await insertCountry(sql, "country-upgrade");
      await insertCountry(sql, "country-corrupt");
      await sql.query(
        `insert into runs
          (id, user_id, country_id, country_name, iso3, pass, status, ceiling_usd,
           out_basename, workflow_artifact_set_id, finished_at)
         values ($1, $2, $3, $4, $5, 'workflow', 'done', 500, $6, $7, now())`,
        [
          "legacy-complete",
          "user-1",
          "country-upgrade",
          "Egypt",
          "EGY",
          "EGY_legacy_complete",
          "legacy-set",
        ],
      );
      await sql.query(
        `insert into runs
          (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
         values ($1, $2, $3, $4, 'workflow', 'queued', 500, $5),
                ($6, $2, $3, $4, 'workflow', 'running', 500, $7)`,
        [
          "legacy-queued",
          "user-1",
          "Egypt",
          "EGY",
          "EGY_legacy_queued",
          "legacy-running",
          "EGY_legacy_running",
        ],
      );
      const bundle = Buffer.from("legacy bundle bytes");
      const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
      await sql.query(
        `insert into workflow_run_artifacts
          (run_id, artifact_set_id, artifact_key, relative_path, filename, content_type,
           sha256, byte_size, workflow_id, workflow_version, workflow_contract_sha256,
           content)
         values ($1, $2, 'bundle', 'legacy/bundle.zip', 'legacy-bundle.zip',
                 'application/zip', $3, $4, $5, $6, $7, $8)`,
        [
          "legacy-complete",
          "legacy-set",
          bundleSha256,
          bundle.byteLength,
          DAR_WORKFLOW.workflow_id,
          DAR_WORKFLOW.workflow_version,
          DAR_WORKFLOW_SHA256,
          bundle,
        ],
      );
      const corruptBundle = Buffer.from("legacy corrupt bytes");
      const expectedBundle = Buffer.from("legacy expected byte");
      const corruptBundleSha256 = createHash("sha256").update(expectedBundle).digest("hex");
      assert.equal(corruptBundle.byteLength, expectedBundle.byteLength);
      await sql.query(
        `insert into runs
          (id, user_id, country_id, country_name, iso3, pass, status, ceiling_usd,
           out_basename, workflow_artifact_set_id, finished_at)
         values ('legacy-corrupt', 'user-1', 'country-corrupt', 'Egypt', 'EGY',
                 'workflow', 'done', 500, 'EGY_legacy_corrupt', 'legacy-corrupt-set', now())`,
      );
      await sql.query(
        `insert into workflow_run_artifacts
          (run_id, artifact_set_id, artifact_key, relative_path, filename, content_type,
           sha256, byte_size, workflow_id, workflow_version, workflow_contract_sha256,
           content)
         values ('legacy-corrupt', 'legacy-corrupt-set', 'bundle', 'legacy/corrupt.zip',
                 'legacy-corrupt.zip', 'application/zip', $1, $2, $3, $4, $5, $6)`,
        [
          corruptBundleSha256,
          corruptBundle.byteLength,
          DAR_WORKFLOW.workflow_id,
          DAR_WORKFLOW.workflow_version,
          DAR_WORKFLOW_SHA256,
          corruptBundle,
        ],
      );

      const migration = await readFile(
        new URL("../../../migrations/0011_damm_methodology_identity.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /pre-methodology workflows are active/i);

      const statuses = await sql.query<{
        id: string;
        status: string;
        stopped_reason: string | null;
        claim_token: string | null;
      }>(
        `select id, status, stopped_reason, claim_token from runs
         where id in ('legacy-complete', 'legacy-queued', 'legacy-running') order by id`,
      );
      assert.equal(statuses.find((row) => row.id === "legacy-complete")?.status, "done");
      for (const [id, status] of [
        ["legacy-queued", "queued"],
        ["legacy-running", "running"],
      ] as const) {
        const row = statuses.find((candidate) => candidate.id === id);
        assert.equal(row?.status, status);
        assert.equal(row?.stopped_reason, null);
      }
      const migrationTable = await sql.query<{ name: string | null }>(
        "select to_regclass('workflow_run_methodology')::text as name",
      );
      assert.equal(
        migrationTable[0].name,
        null,
        "a blocked migration must leave no partial schema",
      );
      const statusEvents = await sql.query<{ count: number }>(
        `select count(*)::int as count from run_events
         where run_id in ('legacy-queued', 'legacy-running') and kind = 'status'`,
      );
      assert.equal(statusEvents[0].count, 0);

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id in ('legacy-queued', 'legacy-running')`,
      );
      await pg.exec(migration);

      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ($1, $2, $3, $4, 'workflow', 'queued', 500, $5)`,
          ["old-version-launch", "user-1", "Egypt", "EGY", "EGY_old_version"],
        ),
        /requires a launch-frozen DAMM methodology/i,
      );
      assert.equal(
        (
          await sql.query<{ count: number }>(
            "select count(*)::int as count from runs where id = 'old-version-launch'",
          )
        )[0].count,
        0,
        "an old app process must not commit an unattributed workflow during a rolling deploy",
      );

      const published = await getPublishedWorkflowArtifact(
        "legacy-complete",
        "bundle",
        "user-1",
        sql,
      );
      assert.ok(published);
      assert.equal(published.methodologyStatus, "legacy_unverified");
      assert.equal(new TextDecoder().decode(published.content), "legacy bundle bytes");
      assert.deepEqual(await listPublishedWorkflowArtifactKeys("legacy-complete", "user-1", sql), [
        "bundle",
      ]);
      assert.deepEqual(
        await listPublishedWorkflowArtifactKeys("legacy-corrupt", "user-1", sql),
        [],
        "legacy artifacts are exposed only after their stored bytes pass SHA-256 verification",
      );
      assert.equal(
        await getPublishedWorkflowArtifact("legacy-corrupt", "bundle", "user-1", sql),
        null,
      );
      assert.equal(
        await latestWorkflowReviewTarget("country-corrupt", "user-1", sql),
        null,
        "a corrupt legacy bundle cannot become a review target",
      );
      assert.equal(
        await recordWorkflowReview(
          {
            id: "corrupt-legacy-review",
            runId: "legacy-corrupt",
            countryId: "country-corrupt",
            reviewerId: "user-1",
            artifactSetId: "legacy-corrupt-set",
            bundleSha256: corruptBundleSha256,
            outcome: "reviewed",
            notes: "This review must never be stored.",
          },
          sql,
        ),
        null,
        "a corrupt legacy bundle cannot be reviewed by exact identity either",
      );
      assert.equal(await workflowMethodologySnapshot("legacy-complete", sql), null);

      const target = await latestWorkflowReviewTarget("country-upgrade", "user-1", sql);
      assert.ok(target);
      assert.equal(target.methodologyStatus, "legacy_unverified");
      const review = await recordWorkflowReview(
        {
          id: "legacy-review",
          runId: target.runId,
          countryId: "country-upgrade",
          reviewerId: "user-1",
          artifactSetId: target.artifactSetId,
          bundleSha256: target.bundleSha256,
          outcome: "reviewed",
          notes: "Historical package reviewed with its legacy warning.",
        },
        sql,
      );
      assert.equal(review?.methodologyStatus, "legacy_unverified");
      assert.equal(
        (await listWorkflowReviews("country-upgrade", "user-1", sql))[0].methodologyStatus,
        "legacy_unverified",
      );

      await assert.rejects(
        sql.query(
          "update workflow_run_artifacts set damm_model_version = '1.7' where run_id = $1",
          ["legacy-complete"],
        ),
        /published workflow artifacts are immutable/i,
      );
      assert.ok(await getPublishedWorkflowArtifact("legacy-complete", "bundle", "user-1", sql));
    } finally {
      await pg.close();
    }
  });
});

describe("0013 methodology pin cutover", () => {
  it("waits for stale active workflows and rejects stale or missing launch pins afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0012_human_approval_chain.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-cutover-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_cutover_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-cutover-active", {
          sourceCommit: PRE_0013_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0013_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0013_damm_methodology_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM methodology pin/i);
      assert.equal(
        (
          await sql.query<{ status: string }>(
            "select status from runs where id = 'pre-cutover-active'",
          )
        )[0].status,
        "queued",
        "a blocked cutover must not rewrite or terminate the older workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-cutover-active'`,
      );
      await pg.exec(migration);

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-version-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_version_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-version-launch", {
            sourceCommit: PRE_0013_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0013_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-pin-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_pin_launch')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0013-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0013_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0013-launch", {
          sourceCommit: PRE_0014_DAMM_SOURCE_COMMIT,
        });
      });
      assert.equal(
        (await workflowMethodologySnapshot("current-0013-launch", sql))?.sourceCommit,
        PRE_0014_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0014 DAMM source pin cutover", () => {
  it("waits for active workflows at the previous pin and rejects stale or missing pins afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0013_damm_methodology_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0014-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0014_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0014-active", {
          sourceCommit: PRE_0014_DAMM_SOURCE_COMMIT,
        });
      });
      await sql.query(
        `insert into runs
          (id, user_id, country_name, iso3, pass, status, ceiling_usd,
           out_basename, finished_at)
         values ('pre-0014-missing-terminal', 'user-1', 'Egypt', 'EGY', 'workflow',
                 'failed', 500, 'EGY_pre_0014_missing_terminal', now())`,
      );

      const migration = await readFile(
        new URL("../../../migrations/0014_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0014-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0014_DAMM_SOURCE_COMMIT,
        },
        "a blocked cutover must not rewrite or terminate the previous workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0014-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0014-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0014_DAMM_SOURCE_COMMIT,
        },
        "the cutover must preserve the terminal workflow's frozen identity",
      );

      await assert.rejects(
        sql.query(
          `update runs set status = 'done', updated_at = now()
           where id = 'pre-0014-active'`,
        ),
        /terminal workflow.*immutable|current DAMM methodology pin/i,
        "a historical terminal row cannot be turned into a newly completed workflow",
      );
      assert.equal(
        (
          await sql.query<{ status: string }>(
            "select status from runs where id = 'pre-0014-active'",
          )
        )[0].status,
        "cancelled",
      );

      await assert.rejects(
        insertWorkflowMethodology(sql, "pre-0014-missing-terminal"),
        /append-once launch snapshot/i,
        "a terminal pre-cutover row cannot be retrofitted with the current pin",
      );
      await assert.rejects(
        sql.query(
          `update runs set status = 'queued', finished_at = null, updated_at = now()
           where id = 'pre-0014-missing-terminal'`,
        ),
        /terminal workflow.*immutable/i,
        "a terminal pre-cutover row cannot move through an active state to evade the pin guard",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd,
               out_basename, finished_at)
             values ('stale-0014-terminal', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'done', 500, 'EGY_stale_0014_terminal', now())`,
          );
          await insertWorkflowMethodology(transaction, "stale-0014-terminal", {
            sourceCommit: PRE_0014_DAMM_SOURCE_COMMIT,
          });
        }),
        /current DAMM methodology pin/i,
        "new terminal rows cannot bypass the repin invariant",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0014-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0014_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0014-launch", {
            sourceCommit: PRE_0014_DAMM_SOURCE_COMMIT,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0014-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0014_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0014-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0014_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0014-launch", {
          sourceCommit: PRE_0015_DAMM_SOURCE_COMMIT,
        });
      });
      assert.equal(
        (await workflowMethodologySnapshot("current-0014-launch", sql))?.sourceCommit,
        PRE_0015_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0015 DAMM source pin cutover", () => {
  it("waits for active workflows at the previous pin and rejects stale or missing pins afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0014_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0015-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0015_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0015-active", {
          sourceCommit: PRE_0015_DAMM_SOURCE_COMMIT,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0015_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0015-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0015_DAMM_SOURCE_COMMIT,
        },
        "a blocked cutover must not rewrite or terminate the previous workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0015-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0015-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0015_DAMM_SOURCE_COMMIT,
        },
        "the cutover must preserve the terminal workflow's frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0015-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0015_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0015-launch", {
            sourceCommit: PRE_0015_DAMM_SOURCE_COMMIT,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0015-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0015_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0015-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0015_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0015-launch", {
          sourceCommit: PRE_0016_DAMM_SOURCE_COMMIT,
        });
      });
      assert.equal(
        (await workflowMethodologySnapshot("current-0015-launch", sql))?.sourceCommit,
        PRE_0016_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0016 DAMM source pin cutover", () => {
  it("waits for active workflows at the previous pin and rejects stale or missing pins afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0015_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0016-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0016_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0016-active", {
          sourceCommit: PRE_0016_DAMM_SOURCE_COMMIT,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0016_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0016-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0016_DAMM_SOURCE_COMMIT,
        },
        "a blocked cutover must not rewrite or terminate the previous workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0016-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0016-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0016_DAMM_SOURCE_COMMIT,
        },
        "the cutover must preserve the terminal workflow's frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0016-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0016_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0016-launch", {
            sourceCommit: PRE_0016_DAMM_SOURCE_COMMIT,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0016-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0016_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0016-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0016_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0016-launch", {
          sourceCommit: PRE_0017_DAMM_SOURCE_COMMIT,
        });
      });
      assert.equal(
        (await workflowMethodologySnapshot("current-0016-launch", sql))?.sourceCommit,
        PRE_0017_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0017 DAMM source pin cutover", () => {
  it("waits for active workflows at the previous pin and rejects stale or missing pins afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0016_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0017-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0017_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0017-active", {
          sourceCommit: PRE_0017_DAMM_SOURCE_COMMIT,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0017_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0017-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0017_DAMM_SOURCE_COMMIT,
        },
        "a blocked cutover must not rewrite or terminate the previous workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0017-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0017-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0017_DAMM_SOURCE_COMMIT,
        },
        "the cutover must preserve the terminal workflow's frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0017-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0017_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0017-launch", {
            sourceCommit: PRE_0017_DAMM_SOURCE_COMMIT,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0017-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0017_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0017-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0017_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0017-launch", {
          sourceCommit: PRE_0018_DAMM_SOURCE_COMMIT,
        });
      });
      assert.equal(
        (await workflowMethodologySnapshot("current-0017-launch", sql))?.sourceCommit,
        PRE_0018_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0018 DAMM source pin cutover", () => {
  it("waits for active workflows at the previous pin and rejects stale or missing pins afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0017_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0018-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0018_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0018-active", {
          sourceCommit: PRE_0018_DAMM_SOURCE_COMMIT,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0018_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0018-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0018_DAMM_SOURCE_COMMIT,
        },
        "a blocked cutover must not rewrite or terminate the previous workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0018-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0018-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0018_DAMM_SOURCE_COMMIT,
        },
        "the cutover must preserve the terminal workflow's frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0018-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0018_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0018-launch", {
            sourceCommit: PRE_0018_DAMM_SOURCE_COMMIT,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0018-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0018_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0018-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0018_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0018-launch", {
          sourceCommit: PRE_0020_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0020_DAMM_RENDERER_SHA256,
        });
      });
      assert.deepEqual(await workflowMethodologySnapshot("current-0018-launch", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: PRE_0020_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0020_DAMM_RENDERER_SHA256,
      });
    } finally {
      await pg.close();
    }
  });
});

describe("0020 DAMM source and renderer pin cutover", () => {
  it("waits for the preceding pin and admits only the merged source-renderer identity afterward", async () => {
    const { pg, sql } = await databaseThroughMigration("0019_progressive_stage_artifacts.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0020-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0020_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0020-active", {
          sourceCommit: PRE_0020_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0020_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0020_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0020-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0020_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0020_DAMM_RENDERER_SHA256,
        },
        "a blocked cutover must not rewrite or terminate the preceding workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0020-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0020-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0020_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0020_DAMM_RENDERER_SHA256,
        },
        "the cutover must preserve the terminal workflow's complete frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0020-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0020_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0020-launch", {
            sourceCommit: PRE_0020_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0020_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0020-renderer', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0020_renderer')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0020-renderer", {
            rendererSha256: PRE_0020_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0020-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0020_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0020-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0020_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0020-launch", {
          sourceCommit: PRE_0021_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0021_DAMM_RENDERER_SHA256,
        });
      });
      assert.deepEqual(await workflowMethodologySnapshot("current-0020-launch", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: PRE_0021_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0021_DAMM_RENDERER_SHA256,
      });
    } finally {
      await pg.close();
    }
  });
});

describe("0021 DAMM source pin cutover", () => {
  it("waits for the preceding pin and admits only the new source with the unchanged renderer", async () => {
    const { pg, sql } = await databaseThroughMigration("0020_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0021-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0021_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0021-active", {
          sourceCommit: PRE_0021_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0021_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0021_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0021-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0021_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0021_DAMM_RENDERER_SHA256,
        },
        "a blocked cutover must not rewrite or terminate the preceding workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0021-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0021-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0021_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0021_DAMM_RENDERER_SHA256,
        },
        "the cutover must preserve the terminal workflow's complete frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0021-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0021_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0021-launch", {
            sourceCommit: PRE_0021_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0021_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0021-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0021_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0021-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0021_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0021-launch", {
          sourceCommit: PRE_0022_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0022_DAMM_RENDERER_SHA256,
        });
      });
      assert.deepEqual(await workflowMethodologySnapshot("current-0021-launch", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: PRE_0022_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0022_DAMM_RENDERER_SHA256,
      });
    } finally {
      await pg.close();
    }
  });
});

describe("0022 DAMM source pin cutover", () => {
  it("waits for the preceding pin and admits only the new source with the unchanged renderer", async () => {
    const { pg, sql } = await databaseThroughMigration("0021_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0022-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0022_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0022-active", {
          sourceCommit: PRE_0022_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0022_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0022_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0022-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0022_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0022_DAMM_RENDERER_SHA256,
        },
        "a blocked cutover must not rewrite or terminate the preceding workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0022-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0022-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0022_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0022_DAMM_RENDERER_SHA256,
        },
        "the cutover must preserve the terminal workflow's complete frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0022-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0022_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0022-launch", {
            sourceCommit: PRE_0022_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0022_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0022-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0022_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0022-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0022_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0022-launch", {
          sourceCommit: PRE_0023_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });
      assert.deepEqual(await workflowMethodologySnapshot("current-0022-launch", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: PRE_0023_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
      });
    } finally {
      await pg.close();
    }
  });
});

describe("0023 DAMM source pin cutover", () => {
  it("waits for the preceding pin and admits only the new source with the unchanged renderer", async () => {
    const { pg, sql } = await databaseThroughMigration("0022_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0023-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0023_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0023-active", {
          sourceCommit: PRE_0023_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0023_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0023-active'`,
          )
        )[0],
        {
          status: "queued",
          source_commit: PRE_0023_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0023_DAMM_RENDERER_SHA256,
        },
        "a blocked cutover must not rewrite or terminate the preceding workflow",
      );

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0023-active'`,
      );
      await pg.exec(migration);

      assert.deepEqual(
        (
          await sql.query<{
            status: string;
            source_commit: string;
            renderer_sha256: string;
          }>(
            `select workflow_run.status, methodology.source_commit,
                    methodology.renderer_sha256
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0023-active'`,
          )
        )[0],
        {
          status: "cancelled",
          source_commit: PRE_0023_DAMM_SOURCE_COMMIT,
          renderer_sha256: PRE_0023_DAMM_RENDERER_SHA256,
        },
        "the cutover must preserve the terminal workflow's complete frozen identity",
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0023-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0023_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0023-launch", {
            sourceCommit: PRE_0023_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );
      await assert.rejects(
        sql.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('missing-0023-pin', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_missing_0023_pin')`,
        ),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0023-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0023_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0023-launch", {
          sourceCommit: PRE_0024_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });
      assert.equal(await workflowRunUsesCanonicalMethodology("current-0023-launch", sql), false);
      assert.deepEqual(await workflowMethodologySnapshot("current-0023-launch", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: PRE_0024_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
      });
    } finally {
      await pg.close();
    }
  });
});

describe("0024 DAMM source pin cutover", () => {
  it("blocks an active preceding pin, preserves it when terminal, and admits only the reviewed source", async () => {
    const { pg, sql } = await databaseThroughMigration("0023_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0024-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0024_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0024-active", {
          sourceCommit: PRE_0024_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0024_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(await workflowMethodologySnapshot("pre-0024-active", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: PRE_0024_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
      });

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0024-active'`,
      );
      await pg.exec(migration);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0024-active'`,
          )
        )[0],
        { status: "cancelled", source_commit: PRE_0024_DAMM_SOURCE_COMMIT },
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0024-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0024_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0024-launch", {
            sourceCommit: PRE_0024_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0024-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0024_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0024-launch", {
          sourceCommit: POST_0024_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });
      assert.equal(
        await workflowRunUsesCanonicalMethodology("current-0024-launch", sql),
        false,
        "a later manifest may retain this source historically without treating it as current",
      );
      assert.equal(
        (await workflowMethodologySnapshot("current-0024-launch", sql))?.sourceCommit,
        POST_0024_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0025 DAMM source pin cutover", () => {
  it("blocks an active preceding pin, preserves it when terminal, and admits only the fail-closed vendor source", async () => {
    const { pg, sql } = await databaseThroughMigration("0024_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0025-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0025_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0025-active", {
          sourceCommit: POST_0024_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0025_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(await workflowMethodologySnapshot("pre-0025-active", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: POST_0024_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
      });

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0025-active'`,
      );
      await pg.exec(migration);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0025-active'`,
          )
        )[0],
        { status: "cancelled", source_commit: POST_0024_DAMM_SOURCE_COMMIT },
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0025-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0025_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0025-launch", {
            sourceCommit: POST_0024_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0025-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0025_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0025-launch", {
          sourceCommit: POST_0025_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });
      assert.equal(
        (await workflowMethodologySnapshot("current-0025-launch", sql))?.sourceCommit,
        POST_0025_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0026 DAMM source pin cutover", () => {
  it("blocks an active preceding pin, preserves it when terminal, and admits only the bounded Reader repair source", async () => {
    const { pg, sql } = await databaseThroughMigration("0025_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0026-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0026_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0026-active", {
          sourceCommit: POST_0025_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0026_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(await workflowMethodologySnapshot("pre-0026-active", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: POST_0025_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
      });

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0026-active'`,
      );
      await pg.exec(migration);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0026-active'`,
          )
        )[0],
        { status: "cancelled", source_commit: POST_0025_DAMM_SOURCE_COMMIT },
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0026-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0026_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0026-launch", {
            sourceCommit: POST_0025_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0026-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0026_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0026-launch", {
          sourceCommit: POST_0026_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });
      assert.equal(await workflowRunUsesCanonicalMethodology("current-0026-launch", sql), false);
      assert.equal(
        (await workflowMethodologySnapshot("current-0026-launch", sql))?.sourceCommit,
        POST_0026_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("0027 DAMM source pin cutover", () => {
  it("blocks an active preceding pin, preserves it when terminal, and admits only the reviewed workflow reliability source", async () => {
    assert.equal(DAMM_WORKFLOW_METHODOLOGY.sourceCommit, POST_0027_DAMM_SOURCE_COMMIT);
    const { pg, sql } = await databaseThroughMigration("0026_damm_source_pin_cutover.sql");
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('pre-0027-active', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_pre_0027_active')`,
        );
        await insertWorkflowMethodology(transaction, "pre-0027-active", {
          sourceCommit: POST_0026_DAMM_SOURCE_COMMIT,
          rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
        });
      });

      const migration = await readFile(
        new URL("../../../migrations/0027_damm_source_pin_cutover.sql", import.meta.url),
        "utf8",
      );
      await assert.rejects(pg.exec(migration), /current DAMM source pin/i);
      assert.deepEqual(await workflowMethodologySnapshot("pre-0027-active", sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
        sourceCommit: POST_0026_DAMM_SOURCE_COMMIT,
        rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
      });

      await sql.query(
        `update runs set status = 'cancelled', finished_at = now(), updated_at = now()
         where id = 'pre-0027-active'`,
      );
      await pg.exec(migration);
      assert.deepEqual(
        (
          await sql.query<{ status: string; source_commit: string }>(
            `select workflow_run.status, methodology.source_commit
             from runs workflow_run
             join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
             where workflow_run.id = 'pre-0027-active'`,
          )
        )[0],
        { status: "cancelled", source_commit: POST_0026_DAMM_SOURCE_COMMIT },
      );

      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
             values ('stale-0027-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                     'queued', 500, 'EGY_stale_0027_launch')`,
          );
          await insertWorkflowMethodology(transaction, "stale-0027-launch", {
            sourceCommit: POST_0026_DAMM_SOURCE_COMMIT,
            rendererSha256: PRE_0023_DAMM_RENDERER_SHA256,
          });
        }),
        /current DAMM methodology pin/i,
      );

      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename)
           values ('current-0027-launch', 'user-1', 'Egypt', 'EGY', 'workflow',
                   'queued', 500, 'EGY_current_0027_launch')`,
        );
        await insertWorkflowMethodology(transaction, "current-0027-launch");
      });
      assert.equal(await workflowRunUsesCanonicalMethodology("current-0027-launch", sql), true);
      assert.equal(
        (await workflowMethodologySnapshot("current-0027-launch", sql))?.sourceCommit,
        POST_0027_DAMM_SOURCE_COMMIT,
      );
    } finally {
      await pg.close();
    }
  });
});

describe("claim-fenced shared workflow artifacts", () => {
  it("atomically freezes upload bytes outside the lightweight run row", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await sql.query("insert into countries (id, user_id, name, iso3) values ($1, $2, $3, $4)", [
        "country-freeze",
        "user-1",
        "Egypt",
        "EGY",
      ]);
      const source = Buffer.from("original bytes");
      const sourceSha256 = createHash("sha256").update(source).digest("hex");
      const extracted = "Country plan 🌾\n";
      await sql.query(
        `insert into uploads
          (id, user_id, country_id, filename, kind, mime, chars, content,
           source_content, source_sha256, source_byte_size, uploaded_by, extraction_status)
         values ($1, $2, $3, $4, $5, $6, char_length($7), $7, $8, $9, $10, $2, 'extracted')`,
        [
          "upload-freeze",
          "user-1",
          "country-freeze",
          "plan.doc",
          "country_context_documents",
          "application/msword",
          extracted,
          source,
          sourceSha256,
          source.byteLength,
        ],
      );
      const frozenRun = await createRun(
        {
          id: "run-freeze",
          userId: "user-1",
          countryId: "country-freeze",
          countryName: "Egypt",
          iso3: "EGY",
          pass: "workflow",
          ceilingUsd: 500,
          vendor: defaultVendorFor("workflow"),
          outBasename: "EGY_freeze",
        },
        sql,
      );
      assert.equal(frozenRun.vendor, "anthropic/claude-opus-5");
      assert.deepEqual(await workflowMethodologySnapshot(frozenRun.id, sql), {
        ...DAMM_WORKFLOW_METHODOLOGY,
      });
      assert.equal(await workflowRunUsesCanonicalMethodology(frozenRun.id, sql), true);
      await sql.query("delete from uploads where id = $1", ["upload-freeze"]);
      const frozen = await workflowUploadSnapshot("run-freeze", sql);
      assert.equal(frozen?.length, 1);
      assert.equal(frozen?.[0].content, extracted);
      assert.equal(frozen?.[0].sourceSha256, sourceSha256);
      assert.equal(
        Buffer.from(frozen?.[0].sourceBase64 ?? "", "base64").toString(),
        "original bytes",
      );

      const columns = await sql.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'runs' and column_name = 'workflow_upload_snapshot'`,
      );
      assert.deepEqual(
        columns,
        [],
        "large source bytes must not hydrate with run list/claim queries",
      );
    } finally {
      await pg.close();
    }
  });

  it("publishes verified bytes to a web host only after the current claim finishes", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename,
             claimed_by, claim_token)
           values ($1, $2, $3, $4, 'workflow', 'running', 500, $5, $6, $7)`,
          ["artifact-run", "user-1", "Egypt", "EGY", "EGY_artifact", "worker-new", "claim-new"],
        );
        await insertWorkflowMethodology(transaction, "artifact-run");
      });
      const content = new TextEncoder().encode("verified manifest bytes");
      const artifact = {
        key: "manifest",
        relativePath: "workflow-manifest.json",
        filename: "workflow-manifest.json",
        contentType: "application/json",
        sha256: createHash("sha256").update(content).digest("hex"),
        assessmentInputSha256: ASSESSMENT_INPUT_SHA256,
        content,
      };

      assert.equal(
        await saveWorkflowArtifact("artifact-run", "worker-old", "claim-old", artifact, sql),
        false,
        "a stale worker cannot stage bytes",
      );
      assert.equal(
        await saveWorkflowArtifact(
          "artifact-run",
          "worker-new",
          "claim-new",
          { ...artifact, sha256: "f".repeat(64) },
          sql,
        ),
        false,
        "a caller-provided digest cannot disagree with the stored bytes",
      );
      assert.equal(
        await saveWorkflowArtifact("artifact-run", "worker-new", "claim-new", artifact, sql),
        true,
      );
      assert.equal(
        await publishWorkflowArtifactSet(
          "artifact-run",
          "worker-new",
          "claim-new",
          ["manifest"],
          sql,
        ),
        true,
      );
      assert.equal(
        await getPublishedWorkflowArtifact("artifact-run", "manifest", "user-1", sql),
        null,
        "the web side cannot see a merely staged set",
      );
      assert.equal(
        await finishRun("artifact-run", "worker-old", "claim-old", "done", "", undefined, sql),
        false,
      );
      assert.equal(
        await finishRun("artifact-run", "worker-new", "claim-new", "done", "", undefined, sql),
        true,
      );

      // No worker path is read here: this simulates the web host sharing only Postgres.
      const fromWebHost = await getPublishedWorkflowArtifact(
        "artifact-run",
        "manifest",
        "user-1",
        sql,
      );
      assert.ok(fromWebHost);
      assert.equal(new TextDecoder().decode(fromWebHost.content), "verified manifest bytes");
      assert.deepEqual(await listPublishedWorkflowArtifactKeys("artifact-run", "user-1", sql), [
        "manifest",
      ]);
      assert.equal(await getRun("artifact-run", "user-2", sql), null);
      assert.equal(
        await getPublishedWorkflowArtifact("artifact-run", "manifest", "user-2", sql),
        null,
      );
      assert.deepEqual(await listPublishedWorkflowArtifactKeys("artifact-run", "user-2", sql), []);
      await assert.rejects(
        sql.query(
          "update workflow_run_methodology set model_revision = model_revision + 1 where run_id = $1",
          ["artifact-run"],
        ),
        /methodology is immutable/i,
      );
      await assert.rejects(
        sql.query("delete from workflow_run_methodology where run_id = $1", ["artifact-run"]),
        /methodology is immutable/i,
      );
      assert.equal(await workflowRunUsesCanonicalMethodology("artifact-run", sql), true);

      const corrupted = Buffer.from("tampered manifest bytes");
      assert.equal(corrupted.byteLength, content.byteLength);
      await assert.rejects(
        sql.query(
          "update workflow_run_artifacts set content = $1 where run_id = $2 and artifact_key = 'manifest'",
          [corrupted, "artifact-run"],
        ),
        /published workflow artifacts are immutable/i,
      );
      await assert.rejects(
        sql.query(
          `update workflow_run_artifacts set assessment_input_sha256 = $1
           where run_id = $2 and artifact_key = 'manifest'`,
          ["b".repeat(64), "artifact-run"],
        ),
        /published workflow artifacts are immutable/i,
      );
      await assert.rejects(
        sql.query(
          `update workflow_run_artifacts set artifact_set_id = 'moved-set'
           where run_id = $1 and artifact_key = 'manifest'`,
          ["artifact-run"],
        ),
        /published workflow artifacts are immutable/i,
      );
      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query("update runs set workflow_artifact_set_id = null where id = $1", [
            "artifact-run",
          ]);
          await transaction.query(
            "update workflow_run_artifacts set content = $1 where run_id = $2",
            [corrupted, "artifact-run"],
          );
          await transaction.query(
            "update runs set workflow_artifact_set_id = 'claim-new' where id = $1",
            ["artifact-run"],
          );
        }),
        /publication identity is immutable/i,
      );
      assert.ok(await getPublishedWorkflowArtifact("artifact-run", "manifest", "user-1", sql));
    } finally {
      await pg.close();
    }
  });

  it("serializes an in-flight staged update before locking and publishing the complete set", async () => {
    const { pg, sql } = await migratedDatabase();
    const staged = deferred();
    const releaseStagingCommit = deferred();
    try {
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename,
             claimed_by, claim_token)
           values ($1, $2, $3, $4, 'workflow', 'running', 500, $5, $6, $7)`,
          [
            "artifact-race-run",
            "user-1",
            "Egypt",
            "EGY",
            "EGY_artifact_race",
            "worker-1",
            "claim-1",
          ],
        );
        await insertWorkflowMethodology(transaction, "artifact-race-run");
      });
      const originalContent = Buffer.from("original staged bytes");
      const artifact = {
        key: "manifest",
        relativePath: "workflow-manifest.json",
        filename: "workflow-manifest.json",
        contentType: "application/json",
        sha256: createHash("sha256").update(originalContent).digest("hex"),
        assessmentInputSha256: ASSESSMENT_INPUT_SHA256,
        content: originalContent,
      };
      assert.equal(
        await saveWorkflowArtifact("artifact-race-run", "worker-1", "claim-1", artifact, sql),
        true,
      );

      const replacementContent = Buffer.from("replacement staged bytes");
      const replacement = {
        ...artifact,
        sha256: createHash("sha256").update(replacementContent).digest("hex"),
        content: replacementContent,
      };
      let pauseStaging = true;
      const stagingSql = instrumentSql(sql, {
        async afterQuery(text) {
          if (pauseStaging && /insert into workflow_run_artifacts/i.test(text)) {
            pauseStaging = false;
            staged.resolve();
            await releaseStagingCommit.promise;
          }
        },
      });
      const saving = saveWorkflowArtifact(
        "artifact-race-run",
        "worker-1",
        "claim-1",
        replacement,
        stagingSql,
      );
      await staged.promise;

      const publicationQueries: string[] = [];
      let publicationTransactionEntered = false;
      const publicationSql = instrumentSql(sql, {
        onTransaction() {
          publicationTransactionEntered = true;
        },
        beforeQuery(text) {
          publicationQueries.push(text.replace(/\s+/g, " ").trim());
        },
      });
      const publishing = publishWorkflowArtifactSet(
        "artifact-race-run",
        "worker-1",
        "claim-1",
        ["manifest"],
        publicationSql,
      );

      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(
        publicationTransactionEntered,
        false,
        "publication must wait for the staging transaction to commit",
      );
      releaseStagingCommit.resolve();
      assert.equal(await saving, true);
      assert.equal(await publishing, true);

      const runLock = publicationQueries.findIndex(
        (query) => /from runs run/i.test(query) && /for update of run$/i.test(query),
      );
      const artifactSetLock = publicationQueries.findIndex(
        (query) =>
          /from workflow_run_artifacts/i.test(query) &&
          /order by artifact_key for update$/i.test(query),
      );
      const pointerUpdate = publicationQueries.findIndex((query) =>
        /^update runs set workflow_artifact_set_id/i.test(query),
      );
      assert.ok(runLock >= 0, "publication must lock the run first");
      assert.ok(artifactSetLock > runLock, "publication must next lock every staged row");
      assert.ok(pointerUpdate > artifactSetLock, "publication pointer must be written last");

      const stored = await sql.query<{ content: unknown; sha256: string }>(
        `select content, sha256 from workflow_run_artifacts
         where run_id = $1 and artifact_set_id = $2 and artifact_key = $3`,
        ["artifact-race-run", "claim-1", "manifest"],
      );
      assert.deepEqual(Buffer.from(stored[0].content as Uint8Array), replacementContent);
      assert.equal(stored[0].sha256, replacement.sha256);

      const laterContent = Buffer.from("too-late staged bytes");
      assert.equal(
        await saveWorkflowArtifact(
          "artifact-race-run",
          "worker-1",
          "claim-1",
          {
            ...artifact,
            sha256: createHash("sha256").update(laterContent).digest("hex"),
            content: laterContent,
          },
          sql,
        ),
        false,
        "the selected set is append-closed before finishRun",
      );
    } finally {
      releaseStagingCommit.resolve();
      await pg.close();
    }
  });

  it("atomically rejects a noncanonical methodology before the workflow can launch", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into runs
              (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename,
               claimed_by, claim_token)
             values ($1, $2, $3, $4, 'workflow', 'running', 500, $5, $6, $7)`,
            ["stale-method-run", "user-1", "Egypt", "EGY", "EGY_stale", "worker-1", "claim-1"],
          );
          await insertWorkflowMethodology(transaction, "stale-method-run", {
            engineSha256: "b".repeat(64),
          });
        }),
        /current DAMM methodology pin/i,
      );
      assert.equal(
        (
          await sql.query<{ count: number }>(
            "select count(*)::int as count from runs where id = $1",
            ["stale-method-run"],
          )
        )[0].count,
        0,
        "the run and stale methodology must roll back together",
      );
    } finally {
      await pg.close();
    }
  });
});

describe("worker claim leases", () => {
  it("uses the database clock to distinguish fresh and stale heartbeats", async () => {
    const { pg, sql } = await migratedDatabase();
    const realDateNow = Date.now;
    const claimWithFutureApplicationClock = async () => {
      let databaseQueryStarted = false;
      const databaseClockSql = instrumentSql(sql, {
        beforeQuery() {
          databaseQueryStarted = true;
          Date.now = realDateNow;
        },
      });
      Date.now = () => realDateNow() + 365 * 24 * 60 * 60 * 1000;
      const claimed = await claimNextRun("worker-new", databaseClockSql);
      assert.equal(databaseQueryStarted, true);
      return claimed;
    };
    try {
      await sql.query(
        `insert into runs
          (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at)
         values ('fresh-lease', 'user-1', 'Egypt', 'EGY', 'research', 'running', 500,
                 'EGY_fresh_lease', 'worker-current', 'claim-current', now(), now())`,
      );
      assert.equal(
        await claimWithFutureApplicationClock(),
        null,
        "a future-skewed application clock must not make a fresh database heartbeat stale",
      );

      await sql.query(
        `insert into runs
          (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename,
           claimed_by, claim_token, heartbeat_at, started_at)
         values ('stale-lease', 'user-1', 'Egypt', 'EGY', 'research', 'running', 500,
                 'EGY_stale_lease', 'worker-dead', 'claim-dead',
                 now() - ($1::bigint * interval '1 millisecond'), now())`,
        [CLAIM_LEASE_MS + 1_000],
      );

      const reclaimed = await claimWithFutureApplicationClock();
      assert.equal(reclaimed?.id, "stale-lease");
      assert.equal(reclaimed?.claimedBy, "worker-new");
      assert.ok(reclaimed?.claimToken);
    } finally {
      Date.now = realDateNow;
      await pg.close();
    }
  });
});

describe("worker claim release", () => {
  it("requeues only the exact live claim and records one durable status event", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-release");
      await sql.query(
        `insert into runs
          (id, user_id, country_id, country_name, iso3, pass, status, ceiling_usd,
           out_basename, claimed_by, claim_token, heartbeat_at, started_at)
         values ('release-run', 'user-1', 'country-release', 'Egypt', 'EGY', 'research',
                 'running', 500, 'EGY_release', 'worker-current', 'claim-current', now(), now())`,
      );

      assert.equal(await releaseClaim("release-run", "worker-stale", "claim-current", sql), false);
      assert.equal(await releaseClaim("release-run", "worker-current", "claim-stale", sql), false);
      assert.deepEqual(
        await sql.query<{ status: string; claimed_by: string; claim_token: string }>(
          "select status, claimed_by, claim_token from runs where id = $1",
          ["release-run"],
        ),
        [{ status: "running", claimed_by: "worker-current", claim_token: "claim-current" }],
        "neither a different worker nor a replayed token may release the claim",
      );

      assert.equal(await releaseClaim("release-run", "worker-current", "claim-current", sql), true);
      assert.deepEqual(
        await sql.query<{
          status: string;
          claimed_by: string | null;
          claim_token: string | null;
          heartbeat_at: Date | null;
          finished_at: Date | null;
          stopped_reason: string | null;
        }>(
          `select status, claimed_by, claim_token, heartbeat_at, finished_at, stopped_reason
           from runs where id = $1`,
          ["release-run"],
        ),
        [
          {
            status: "queued",
            claimed_by: null,
            claim_token: null,
            heartbeat_at: null,
            finished_at: null,
            stopped_reason: null,
          },
        ],
      );
      assert.deepEqual(
        await sql.query<{ kind: string; message: string }>(
          "select kind, message from run_events where run_id = $1 order by id",
          ["release-run"],
        ),
        [
          {
            kind: "status",
            message:
              "Worker shutdown arrived during queue claim; returned to queue before execution.",
          },
        ],
      );

      assert.equal(
        await releaseClaim("release-run", "worker-current", "claim-current", sql),
        false,
        "a consumed claim token cannot replay the release",
      );
      assert.equal(
        (
          await sql.query<{ count: number }>(
            "select count(*)::int as count from run_events where run_id = $1",
            ["release-run"],
          )
        )[0].count,
        1,
        "a rejected replay cannot append another audit event",
      );
    } finally {
      await pg.close();
    }
  });
});

describe("serialized canonical launch inputs", () => {
  it("does not persist a canonical workflow with an unapproved vendor", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-vendor-guard");
      await assert.rejects(
        createRun(
          {
            ...workflowRunInput("run-vendor-guard", "country-vendor-guard"),
            vendor: "gemini/gemini-3.1-pro-preview",
          },
          sql,
        ),
        /canonical workflow vendor/i,
      );
      const [{ count }] = await sql.query<{ count: number }>(
        "select count(*)::int as count from runs where id = $1",
        ["run-vendor-guard"],
      );
      assert.equal(Number(count), 0);
    } finally {
      await pg.close();
    }
  });

  it("never reports a successful late upload that the launch snapshot omitted", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-race");
      assert.equal(
        (await savePendingWorkflowUpload(uploadInput("before", "country-race"), sql)).ok,
        true,
      );

      const [launch, upload] = await Promise.all([
        createRun(workflowRunInput("run-race", "country-race"), sql),
        savePendingWorkflowUpload(uploadInput("during", "country-race"), sql),
      ]);
      assert.equal(launch.id, "run-race");
      const snapshot = await workflowUploadSnapshot(launch.id, sql);
      assert.ok(snapshot?.some((document) => document.id === "before"));
      if (upload.ok) {
        assert.ok(snapshot?.some((document) => document.id === "during"));
      } else {
        assert.equal(upload.reason, "active");
        assert.ok(!snapshot?.some((document) => document.id === "during"));
      }
    } finally {
      await pg.close();
    }
  });

  it("serializes upload totals so concurrent requests cannot exceed the document cap", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-cap");
      for (let index = 0; index < MAX_WORKFLOW_UPLOAD_DOCUMENTS - 1; index += 1) {
        const result = await savePendingWorkflowUpload(
          uploadInput(`existing-${index}`, "country-cap"),
          sql,
        );
        assert.equal(result.ok, true);
      }
      const results = await Promise.all([
        savePendingWorkflowUpload(uploadInput("final-a", "country-cap"), sql),
        savePendingWorkflowUpload(uploadInput("final-b", "country-cap"), sql),
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(
        results.filter((result) => !result.ok && result.reason === "documents").length,
        1,
      );
      const [{ count }] = await sql.query<{ count: number }>(
        "select count(*)::int as count from uploads where country_id = $1",
        ["country-cap"],
      );
      assert.equal(Number(count), MAX_WORKFLOW_UPLOAD_DOCUMENTS);
    } finally {
      await pg.close();
    }
  });

  it("never deletes a document after it has been frozen into a launched run", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-delete-race");
      assert.equal(
        (await savePendingWorkflowUpload(uploadInput("mutable", "country-delete-race"), sql)).ok,
        true,
      );
      const [launch, deletion] = await Promise.all([
        createRun(workflowRunInput("run-delete-race", "country-delete-race"), sql),
        deletePendingWorkflowUpload("user-1", "country-delete-race", "mutable", sql),
      ]);
      const snapshot = await workflowUploadSnapshot(launch.id, sql);
      if (deletion.ok) assert.deepEqual(snapshot, []);
      else {
        assert.equal(deletion.reason, "active");
        assert.ok(snapshot?.some((document) => document.id === "mutable"));
      }
    } finally {
      await pg.close();
    }
  });

  it("quarantines visible legacy kinds until they are removed, never snapshotting them", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-legacy");
      const source = Buffer.from("legacy original");
      await sql.query(
        `insert into uploads
          (id, user_id, country_id, filename, kind, mime, chars, content,
           source_content, source_sha256, source_byte_size, uploaded_by, extraction_status)
         values ($1, 'user-1', $2, 'old-ai.txt', 'ai', 'text/plain',
                 char_length('legacy text'), 'legacy text', $3, $4, $5, 'user-1', 'extracted')`,
        [
          "legacy-ai",
          "country-legacy",
          source,
          createHash("sha256").update(source).digest("hex"),
          source.byteLength,
        ],
      );
      await assert.rejects(
        createRun(workflowRunInput("run-legacy-rejected", "country-legacy"), sql),
        /provenance-complete/,
      );
      assert.deepEqual(
        await deletePendingWorkflowUpload("user-1", "country-legacy", "legacy-ai", sql),
        { ok: true },
      );
      const run = await createRun(workflowRunInput("run-after-legacy", "country-legacy"), sql);
      assert.deepEqual(await workflowUploadSnapshot(run.id, sql), []);
    } finally {
      await pg.close();
    }
  });
});

describe("post-completion Draft DAR review", () => {
  it("opens only for the exact published Stage 8 bundle and persists that identity", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-review");
      await sql.transaction(async (transaction) => {
        await transaction.query(
          `insert into runs
            (id, user_id, country_id, country_name, iso3, pass, status, ceiling_usd,
             out_basename, claimed_by, claim_token)
           values ('run-review', 'user-1', 'country-review', 'Egypt', 'EGY', 'workflow',
                   'running', 500, 'EGY_review', 'worker-review', 'claim-review')`,
        );
        await insertWorkflowMethodology(transaction, "run-review");
      });
      assert.equal(await latestWorkflowReviewTarget("country-review", "user-1", sql), null);

      const content = new TextEncoder().encode("verified complete bundle");
      const bundleSha256 = createHash("sha256").update(content).digest("hex");
      assert.equal(
        await saveWorkflowArtifact(
          "run-review",
          "worker-review",
          "claim-review",
          {
            key: "bundle",
            relativePath: "exports/dar-complete-bundle.zip",
            filename: "dar-complete-bundle.zip",
            contentType: "application/zip",
            sha256: bundleSha256,
            assessmentInputSha256: ASSESSMENT_INPUT_SHA256,
            content,
          },
          sql,
        ),
        true,
      );
      assert.equal(
        await publishWorkflowArtifactSet(
          "run-review",
          "worker-review",
          "claim-review",
          ["bundle"],
          sql,
        ),
        true,
      );
      assert.equal(
        await finishRun("run-review", "worker-review", "claim-review", "done", "", undefined, sql),
        true,
      );
      const target = await latestWorkflowReviewTarget("country-review", "user-1", sql);
      assert.ok(target);
      assert.equal(target.bundleSha256, bundleSha256);
      assert.equal(target.methodologyStatus, "canonical");
      assert.equal(await latestWorkflowReviewTarget("country-review", "user-2", sql), null);
      assert.equal(
        await recordWorkflowReview(
          {
            id: "review-wrong-set",
            runId: target.runId,
            countryId: "country-review",
            reviewerId: "user-1",
            artifactSetId: "not-the-published-set",
            bundleSha256,
            outcome: "reviewed",
            notes: "",
          },
          sql,
        ),
        null,
      );
      const review = await recordWorkflowReview(
        {
          id: "review-1",
          runId: target.runId,
          countryId: "country-review",
          reviewerId: "user-1",
          artifactSetId: target.artifactSetId,
          bundleSha256: target.bundleSha256,
          outcome: "revisions_required",
          notes: "Clarify the AI investment sequence.",
        },
        sql,
      );
      assert.ok(review);
      assert.equal(review.bundleSha256, bundleSha256);
      assert.equal(review.methodologyStatus, "canonical");
      assert.equal((await listWorkflowReviews("country-review", "user-1", sql)).length, 1);
      assert.deepEqual(await listWorkflowReviews("country-review", "user-2", sql), []);

      const corruptedContent = Uint8Array.from(content);
      corruptedContent[0] ^= 0xff;
      assert.equal(corruptedContent.byteLength, content.byteLength);
      await assert.rejects(
        sql.query(
          "update workflow_run_artifacts set content = $1 where run_id = $2 and artifact_key = 'bundle'",
          [corruptedContent, "run-review"],
        ),
        /published workflow artifacts are immutable/i,
      );
      assert.ok(await latestWorkflowReviewTarget("country-review", "user-1", sql));
      assert.equal((await listWorkflowReviews("country-review", "user-1", sql)).length, 1);
    } finally {
      await pg.close();
    }
  });
});
