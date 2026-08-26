import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../db.ts";
import {
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
  savePendingWorkflowUpload,
  saveWorkflowArtifact,
  workflowMethodologySnapshot,
  workflowRunUsesCanonicalMethodology,
  workflowUploadSnapshot,
} from "./run-store.ts";
import { DAMM_WORKFLOW_METHODOLOGY, type WorkflowMethodologyIdentity } from "./methodology.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256, MAX_WORKFLOW_UPLOAD_DOCUMENTS } from "./workflow.ts";
import { defaultVendorFor } from "./runs.ts";

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

async function insertWorkflowMethodology(
  sql: Sql,
  runId: string,
  overrides: Partial<WorkflowMethodologyIdentity> = {},
) {
  const value = { ...DAMM_WORKFLOW_METHODOLOGY, ...overrides };
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
      assert.equal(migrationTable[0].name, null, "a blocked migration must leave no partial schema");
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
          [
            "artifact-run",
            "user-1",
            "Egypt",
            "EGY",
            "EGY_artifact",
            "worker-new",
            "claim-new",
          ],
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
      assert.deepEqual(
        await listPublishedWorkflowArtifactKeys("artifact-run", "user-1", sql),
        ["manifest"],
      );
      assert.equal(await getRun("artifact-run", "user-2", sql), null);
      assert.equal(
        await getPublishedWorkflowArtifact("artifact-run", "manifest", "user-2", sql),
        null,
      );
      assert.deepEqual(
        await listPublishedWorkflowArtifactKeys("artifact-run", "user-2", sql),
        [],
      );
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
          await transaction.query(
            "update runs set workflow_artifact_set_id = null where id = $1",
            ["artifact-run"],
          );
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

  it("atomically rejects artifact staging and publication for a noncanonical snapshot", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await sql.transaction(async (transaction) => {
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
      });
      const content = Buffer.from("stale methodology artifact");
      const sha256 = createHash("sha256").update(content).digest("hex");
      const artifact = {
        key: "manifest",
        relativePath: "workflow-manifest.json",
        filename: "workflow-manifest.json",
        contentType: "application/json",
        sha256,
        assessmentInputSha256: ASSESSMENT_INPUT_SHA256,
        content,
      };
      assert.equal(
        await saveWorkflowArtifact("stale-method-run", "worker-1", "claim-1", artifact, sql),
        false,
      );

      await sql.query(
        `insert into workflow_run_artifacts
          (run_id, artifact_set_id, artifact_key, relative_path, filename, content_type,
           sha256, byte_size, workflow_id, workflow_version, workflow_contract_sha256,
           damm_model_version, damm_model_revision, damm_model_sha256, damm_source_commit,
           assessment_input_sha256, content)
         values ($1, $2, 'manifest', 'workflow-manifest.json', 'workflow-manifest.json',
                 'application/json', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          "stale-method-run",
          "claim-1",
          sha256,
          content.byteLength,
          DAR_WORKFLOW.workflow_id,
          DAR_WORKFLOW.workflow_version,
          DAR_WORKFLOW_SHA256,
          DAMM_WORKFLOW_METHODOLOGY.modelVersion,
          DAMM_WORKFLOW_METHODOLOGY.modelRevision,
          DAMM_WORKFLOW_METHODOLOGY.appModelSha256,
          DAMM_WORKFLOW_METHODOLOGY.sourceCommit,
          ASSESSMENT_INPUT_SHA256,
          content,
        ],
      );
      assert.equal(
        await publishWorkflowArtifactSet(
          "stale-method-run",
          "worker-1",
          "claim-1",
          ["manifest"],
          sql,
        ),
        false,
      );
      await sql.query("delete from runs where id = $1", ["stale-method-run"]);
      assert.equal(
        (
          await sql.query<{ count: number }>(
            "select count(*)::int as count from workflow_run_methodology where run_id = $1",
            ["stale-method-run"],
          )
        )[0].count,
        0,
        "parent deletion must retain its normal cascading cleanup",
      );
    } finally {
      await pg.close();
    }
  });
});

describe("serialized canonical launch inputs", () => {
  it("never reports a successful late upload that the launch snapshot omitted", async () => {
    const { pg, sql } = await migratedDatabase();
    try {
      await insertCountry(sql, "country-race");
      assert.equal((await savePendingWorkflowUpload(uploadInput("before", "country-race"), sql)).ok, true);

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
      assert.equal(results.filter((result) => !result.ok && result.reason === "documents").length, 1);
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
        await finishRun(
          "run-review",
          "worker-review",
          "claim-review",
          "done",
          "",
          undefined,
          sql,
        ),
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
