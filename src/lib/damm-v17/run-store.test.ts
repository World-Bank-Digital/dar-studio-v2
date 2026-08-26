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
  workflowUploadSnapshot,
} from "./run-store.ts";
import { MAX_WORKFLOW_UPLOAD_DOCUMENTS } from "./workflow.ts";
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

async function migratedDatabase(): Promise<{ pg: PGlite; sql: Sql }> {
  const pg = new PGlite();
  await pg.waitReady;
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  return { pg, sql: sqlFor(pg) };
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
      await sql.query(
        `insert into runs
          (id, user_id, country_name, iso3, pass, status, ceiling_usd, out_basename,
           claimed_by, claim_token)
         values ($1, $2, $3, $4, 'workflow', 'running', 500, $5, $6, $7)`,
        ["artifact-run", "user-1", "Egypt", "EGY", "EGY_artifact", "worker-new", "claim-new"],
      );
      const content = new TextEncoder().encode("verified manifest bytes");
      const artifact = {
        key: "manifest",
        relativePath: "workflow-manifest.json",
        filename: "workflow-manifest.json",
        contentType: "application/json",
        sha256: createHash("sha256").update(content).digest("hex"),
        content,
      };

      assert.equal(
        await saveWorkflowArtifact("artifact-run", "worker-old", "claim-old", artifact, sql),
        false,
        "a stale worker cannot stage bytes",
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
      await sql.query(
        `insert into runs
          (id, user_id, country_id, country_name, iso3, pass, status, ceiling_usd,
           out_basename, claimed_by, claim_token)
         values ('run-review', 'user-1', 'country-review', 'Egypt', 'EGY', 'workflow',
                 'running', 500, 'EGY_review', 'worker-review', 'claim-review')`,
      );
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
      assert.equal((await listWorkflowReviews("country-review", "user-1", sql)).length, 1);
      assert.deepEqual(await listWorkflowReviews("country-review", "user-2", sql), []);
    } finally {
      await pg.close();
    }
  });
});
