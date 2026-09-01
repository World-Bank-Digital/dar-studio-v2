import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../db.ts";
import {
  listCompletedStageArtifacts,
  reconcileCompletedStageArtifacts,
  resolveCompletedStageArtifactDownload,
} from "./completed-stage-artifacts.server.ts";
import { MAX_WORKFLOW_ARTIFACT_BYTES } from "./artifact-limits.ts";
import { createRun, finishRun } from "./run-store.ts";
import { type ClaimedRun } from "./runs.ts";
import { workflowRunDir } from "./worker.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "./workflow.ts";
import stageManifestFixture from "./fixtures/damm-workflow-stage-v1.json" with { type: "json" };

const execFileAsync = promisify(execFile);

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
  const names = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) await pg.exec(await readFile(new URL(name, migrations), "utf8"));
  return { pg, sql: sqlFor(pg) };
}

async function sha256(filename: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
}

async function writeCompletedStageOne(run: ClaimedRun): Promise<string> {
  const root = workflowRunDir(run);
  const inputs = path.join(root, "inputs");
  const stageDir = path.join(root, "stages/01-damm_diagnostic");
  await mkdir(inputs, { recursive: true });
  await mkdir(stageDir, { recursive: true });

  const uploadsPath = path.join(inputs, "uploads-manifest.json");
  await writeFile(
    uploadsPath,
    `${JSON.stringify({ schema_version: "damm.uploads-manifest/v1", documents: [] })}\n`,
  );
  const uploads = {
    path: "inputs/uploads-manifest.json",
    sha256: await sha256(uploadsPath),
    document_count: 0,
  };
  const snapshotPath = path.join(inputs, "input-snapshot.json");
  await writeFile(
    snapshotPath,
    `${JSON.stringify({
      schema_version: "damm.workflow-input-snapshot/v1",
      country: run.countryName,
      iso3: run.iso3,
      contract_sha256: DAR_WORKFLOW_SHA256,
      uploads_manifest: uploads,
      ceiling_usd: run.ceilingUsd,
      vendor: run.vendor,
    })}\n`,
  );
  const snapshotSha256 = await sha256(snapshotPath);

  const stage = DAR_WORKFLOW.stages[0];
  const artifacts: Array<{ key: string; path: string; sha256: string; media_type: string }> = [];
  for (const [index, key] of stage.required_artifacts
    .filter((candidate) => candidate !== "stage_manifest")
    .entries()) {
    const extension = key === "diagnostic_report" ? "md" : "json";
    const filename = path.join(
      stageDir,
      `${String(index + 1).padStart(2, "0")}-${key}.${extension}`,
    );
    const content =
      key === "diagnostic_report"
        ? "# Nigeria DAMM diagnostic\n\nVerified stage report.\n"
        : `${JSON.stringify({ key })}\n`;
    await writeFile(filename, content);
    artifacts.push({
      key,
      path: path.relative(root, filename).split(path.sep).join("/"),
      sha256: await sha256(filename),
      media_type: extension === "md" ? "text/markdown" : "application/json",
    });
  }
  const engineInput = path.join(stageDir, "engine_input.json");
  await writeFile(engineInput, `${JSON.stringify({ "1.1": { value: 1, cls: "Measured" } })}\n`);
  artifacts.push({
    key: "engine_input",
    path: path.relative(root, engineInput).split(path.sep).join("/"),
    sha256: await sha256(engineInput),
    media_type: "application/json",
  });

  const stageManifestPath = path.join(stageDir, "stage-manifest.json");
  await writeFile(
    stageManifestPath,
    `${JSON.stringify({
      ...structuredClone(stageManifestFixture),
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      run_id: run.id,
      stage_id: stage.id,
      ordinal: stage.ordinal,
      attempt: 1,
      execution_mode: "handler",
      input_snapshot: { path: "inputs/input-snapshot.json", sha256: snapshotSha256 },
      input_hashes: {
        input_snapshot: snapshotSha256,
        checkpoint_binding: null,
        upstream_stage_manifests: {},
      },
      artifacts,
      output_hashes: Object.fromEntries(
        artifacts.map((artifact) => [artifact.key, artifact.sha256]),
      ),
      source_inventory: [],
      quality_checks: stageManifestFixture.quality_checks,
      spend_usd: 0,
      status: "complete",
    })}\n`,
  );
  artifacts.push({
    key: "stage_manifest",
    path: path.relative(root, stageManifestPath).split(path.sep).join("/"),
    sha256: await sha256(stageManifestPath),
    media_type: "application/json",
  });

  const stages = DAR_WORKFLOW.stages.map((candidate) =>
    candidate.ordinal === 1
      ? {
          ordinal: candidate.ordinal,
          id: candidate.id,
          status: "complete",
          attempts: 1,
          completed_at: "2026-09-02T01:02:03.000Z",
          artifacts,
        }
      : {
          ordinal: candidate.ordinal,
          id: candidate.id,
          status: "queued",
          attempts: 0,
          completed_at: null,
          artifacts: [],
        },
  );
  await writeFile(
    path.join(root, "workflow-manifest.json"),
    `${JSON.stringify({
      schema_version: "damm.workflow-run/v1",
      run_id: run.id,
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      contract_sha256: DAR_WORKFLOW_SHA256,
      country: run.countryName,
      iso3: run.iso3,
      status: "running",
      current_stage: "country_research",
      input_snapshot: { path: "inputs/input-snapshot.json", sha256: snapshotSha256 },
      uploads_manifest: uploads,
      stages,
    })}\n`,
  );
  return root;
}

describe("completed workflow stage artifacts", () => {
  it("keeps a verified completed stage immutable and owner-downloadable after a later failure", async () => {
    const { pg, sql } = await migratedDatabase();
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-progressive-artifacts-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      await mkdir(path.join(temp, "gauntlet/loop-1"), { recursive: true });
      await sql.query("insert into countries (id, user_id, name, iso3) values ($1, $2, $3, $4)", [
        "country-1",
        "owner-1",
        "Nigeria",
        "NGA",
      ]);
      const created = await createRun(
        {
          id: "run-progressive-1",
          userId: "owner-1",
          countryId: "country-1",
          countryName: "Nigeria",
          iso3: "NGA",
          pass: "workflow",
          ceilingUsd: 500,
          vendor: null,
          outBasename: "NGA_progressive_1",
        },
        sql,
      );
      await sql.query(
        `update runs
         set status = 'running', claimed_by = $2, claim_token = $3, started_at = now()
         where id = $1`,
        [created.id, "worker-1", "claim-1"],
      );
      const claimed: ClaimedRun = {
        ...created,
        status: "running",
        claimedBy: "worker-1",
        claimToken: "claim-1",
      };
      const workerRoot = await writeCompletedStageOne(claimed);

      const rootManifest = JSON.parse(
        await readFile(path.join(workerRoot, "workflow-manifest.json"), "utf8"),
      ) as { stages: Array<{ artifacts: Array<{ key: string; path: string }> }> };
      const reportRecord = rootManifest.stages[0].artifacts.find(
        (artifact) => artifact.key === "diagnostic_report",
      );
      assert.ok(reportRecord);
      const reportPath = path.join(workerRoot, ...reportRecord.path.split("/"));
      const reportBytes = await readFile(reportPath);
      const outsideReport = path.join(temp, "outside-stage-report.md");
      await writeFile(outsideReport, reportBytes);
      await rm(reportPath);
      await symlink(outsideReport, reportPath);
      await assert.rejects(
        reconcileCompletedStageArtifacts(claimed, "worker-1", sql),
        /invalid artifact record/i,
        "hash-identical bytes reached through a symlink must not enter the immutable archive",
      );
      await rm(reportPath);
      await writeFile(reportPath, reportBytes);

      await rm(reportPath);
      await execFileAsync("mkfifo", [reportPath]);
      let writer: Promise<void> | undefined;
      const unblock = setTimeout(() => {
        writer = open(reportPath, "w")
          .then((handle) => handle.close())
          .catch(() => undefined);
      }, 2_000);
      const fifoAttempt = reconcileCompletedStageArtifacts(claimed, "worker-1", sql);
      const fifoOutcome = await Promise.race([
        fifoAttempt.then(
          () => ({ kind: "resolved" as const, error: null }),
          (error: unknown) => ({ kind: "rejected" as const, error }),
        ),
        new Promise<{ kind: "timeout"; error: null }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout", error: null }), 500),
        ),
      ]);
      if (fifoOutcome.kind === "timeout") await fifoAttempt.catch(() => undefined);
      clearTimeout(unblock);
      await writer;
      assert.equal(
        fifoOutcome.kind,
        "rejected",
        "a FIFO must be rejected without waiting for another process to open it",
      );
      assert.match(String(fifoOutcome.error), /invalid artifact record/i);
      await rm(reportPath);
      await writeFile(reportPath, reportBytes);

      const reconciliation = await reconcileCompletedStageArtifacts(claimed, "worker-1", sql);
      assert.deepEqual(reconciliation, {
        publishedStageIds: ["damm_diagnostic"],
        alreadyPublishedStageIds: [],
      });
      assert.deepEqual(
        await reconcileCompletedStageArtifacts(claimed, "worker-1", sql),
        {
          publishedStageIds: [],
          alreadyPublishedStageIds: ["damm_diagnostic"],
        },
        "claim recovery must be idempotent for the exact same stage bytes",
      );
      await rm(workerRoot, { recursive: true, force: true });
      assert.equal(
        await finishRun(
          claimed.id,
          "worker-1",
          "claim-1",
          "failed",
          "Stage 2 later failed.",
          undefined,
          sql,
        ),
        true,
      );

      const catalog = await listCompletedStageArtifacts(claimed.id, "owner-1", sql);
      assert.equal(catalog.length, artifactsPerStageOne());
      const report = catalog.find((artifact) => artifact.key === "diagnostic_report");
      assert.ok(report);
      assert.equal(report.stageId, "damm_diagnostic");
      assert.equal(report.stageOrdinal, 1);
      assert.equal(report.contentType, "text/markdown");

      const download = await resolveCompletedStageArtifactDownload(
        claimed.id,
        report.artifactId,
        "owner-1",
        sql,
      );
      assert.ok(download);
      assert.equal(
        new TextDecoder().decode(download.content),
        "# Nigeria DAMM diagnostic\n\nVerified stage report.\n",
      );
      assert.deepEqual(await listCompletedStageArtifacts(claimed.id, "stranger", sql), []);
      assert.equal(
        await resolveCompletedStageArtifactDownload(claimed.id, report.artifactId, "stranger", sql),
        null,
      );

      await assert.rejects(
        sql.query(
          "update workflow_stage_artifacts set content = $1 where run_id = $2 and artifact_id = $3",
          [Buffer.from("tampered"), claimed.id, report.artifactId],
        ),
        /completed stage artifacts are immutable/i,
      );
      await assert.rejects(
        sql.query("delete from workflow_stage_artifacts where run_id = $1 and artifact_id = $2", [
          claimed.id,
          report.artifactId,
        ]),
        /completed stage artifacts are immutable/i,
      );
      await assert.rejects(
        sql.query(
          `insert into workflow_stage_artifacts
             (run_id, stage_id, artifact_id, artifact_key, relative_path, filename,
              content_type, sha256, byte_size, content)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            claimed.id,
            "damm_diagnostic",
            "f".repeat(64),
            "late_append",
            "stages/01-damm_diagnostic/late.txt",
            "late.txt",
            "text/plain",
            createHash("sha256").update("late").digest("hex"),
            4,
            Buffer.from("late"),
          ],
        ),
        /declared set is sealed/i,
        "a completed publication must reject later INSERTs as well as updates and deletes",
      );
      await assert.rejects(
        sql.transaction(async (transaction) => {
          await transaction.query(
            `insert into workflow_stage_publications
               (run_id, stage_id, stage_ordinal, stage_title, completed_at,
                stage_manifest_sha256, input_snapshot_sha256, artifact_count,
                workflow_id, workflow_version, workflow_contract_sha256,
                damm_model_version, damm_model_revision, damm_model_sha256,
                damm_source_commit)
             select run_id, 'country_research', 2, 'Country research', now(),
                    $2, input_snapshot_sha256, 1,
                    workflow_id, workflow_version, workflow_contract_sha256,
                    damm_model_version, damm_model_revision, damm_model_sha256,
                    damm_source_commit
               from workflow_stage_publications
              where run_id = $1 and stage_id = 'damm_diagnostic'`,
            [claimed.id, "e".repeat(64)],
          );
        }),
        /must contain exactly 1 artifacts; found 0/i,
        "an incomplete publication must fail at transaction commit",
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
      await pg.close();
    }
  });

  it("stops sequential verification as soon as the aggregate archive allowance is exhausted", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-progressive-artifact-limit-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    const claimed: ClaimedRun = {
      id: "run-progressive-limit",
      userId: "owner-1",
      countryId: "country-1",
      countryName: "Nigeria",
      iso3: "NGA",
      pass: "workflow",
      status: "running",
      ceilingUsd: 500,
      spentUsd: 0,
      rowsTotal: 8,
      rowsDone: 0,
      vendor: null,
      outBasename: "NGA_progressive_limit",
      claimedBy: "worker-1",
      claimToken: "claim-1",
      heartbeatAt: new Date("2026-09-02T00:00:00.000Z"),
      startedAt: new Date("2026-09-02T00:00:00.000Z"),
      finishedAt: null,
      stoppedReason: null,
    };
    try {
      await mkdir(path.join(temp, "gauntlet/loop-1"), { recursive: true });
      const root = await writeCompletedStageOne(claimed);
      const largePath = path.join(root, "stages/01-damm_diagnostic/aggregate-padding.bin");
      const large = await open(largePath, "w");
      await large.truncate(MAX_WORKFLOW_ARTIFACT_BYTES);
      await large.close();

      const rootManifestPath = path.join(root, "workflow-manifest.json");
      const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8")) as {
        stages: Array<{
          artifacts: Array<{ key: string; path: string; sha256: string; media_type: string }>;
        }>;
      };
      const stageArtifacts = rootManifest.stages[0].artifacts;
      const stageManifest = stageArtifacts.find((artifact) => artifact.key === "stage_manifest");
      assert.ok(stageManifest);
      const ordinary = stageArtifacts.filter((artifact) => artifact.key !== "stage_manifest");
      const relativeLarge = path.relative(root, largePath).split(path.sep).join("/");
      const padding = Array.from({ length: 8 }, (_, index) => ({
        key: `aggregate_padding_${index + 1}`,
        path: relativeLarge,
        sha256: "8565a714dca840f8652c5bae9249ab05f5fb5a4f9f13fbe23304b10f68252da2",
        media_type: "application/octet-stream",
      }));
      rootManifest.stages[0].artifacts = [
        ...ordinary,
        ...padding,
        {
          key: "must_not_be_read_after_limit",
          path: "stages/01-damm_diagnostic/missing-after-limit.bin",
          sha256: "0".repeat(64),
          media_type: "application/octet-stream",
        },
        stageManifest,
      ];
      await writeFile(rootManifestPath, `${JSON.stringify(rootManifest)}\n`);

      const unreachable = (async () => {
        throw new Error("aggregate rejection must happen before database access");
      }) as unknown as Sql;
      unreachable.query = async () => {
        throw new Error("aggregate rejection must happen before database access");
      };
      unreachable.transaction = async () => {
        throw new Error("aggregate rejection must happen before database access");
      };

      await assert.rejects(
        reconcileCompletedStageArtifacts(claimed, "worker-1", unreachable),
        /completed-stage archive exceeds its bounded storage limit/i,
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });
});

function artifactsPerStageOne(): number {
  return DAR_WORKFLOW.stages[0].required_artifacts.length + 1;
}
