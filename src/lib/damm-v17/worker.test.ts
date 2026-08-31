import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  argsFor,
  artifactPath,
  CANONICAL_PIPELINE_METHODOLOGY_FILES,
  defaultDeps,
  degradationNotes,
  isSimulationIdentity,
  passFilePaths,
  drain,
  collectWorkflowArtifacts,
  runOne,
  verifyPipelineMethodology,
  verifyWorkflowCompletion,
  workflowRunDir,
  workflowUploadManifestPath,
  writeWorkflowUploadSnapshot,
  type RowProgress,
  type RunStore,
  type SpawnedProcess,
  type WorkerDeps,
  type PipelineMethodologyFile,
} from "./worker.ts";
import { defaultVendorFor, type ClaimedRun, type Run } from "./runs.ts";
import { verifyStoredStage8Boundary } from "./stage8-boundary.server.ts";
import { artifactsFor } from "./worker-artifacts.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "./workflow.ts";
import dammStageManifestFixture from "./fixtures/damm-workflow-stage-v1.json" with { type: "json" };

function run(over: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    id: "r1",
    userId: "u1",
    countryId: "c1",
    countryName: "Egypt",
    iso3: "EGY",
    pass: "research",
    status: "running",
    ceilingUsd: 500,
    spentUsd: 0,
    rowsTotal: null,
    rowsDone: 0,
    vendor: "anthropic/claude-opus-5",
    outBasename: "EGY_run1",
    claimedBy: "w1",
    claimToken: "claim-1",
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    stoppedReason: null,
    ...over,
  };
}

describe("how the worker invokes the pipeline", () => {
  it("reserves simulation identities outside the production worker and verifier", async () => {
    const simulated = run({
      id: "sim-nigeria-stage6-overlength-v1-aaaaaaaaaaaa",
      pass: "workflow",
      vendor: "fixture/nigeria-stage6-overlength-v1",
    });
    assert.equal(isSimulationIdentity(simulated), true);
    assert.deepEqual(verifyWorkflowCompletion(simulated), {
      ok: false,
      reason: "Simulation output is not eligible for workflow acceptance or artifact publication.",
    });
    const f = fakeStore();
    const p = fakeProcess([], 0);
    await assert.rejects(
      runOne(simulated, "w1", deps(f.store, p.proc)),
      /Simulation identities cannot enter the production worker/,
    );
    assert.equal(f.calls.finished.length, 0);

    const misclassified = run({
      id: "sim-misclassified-aaaaaaaaaaaa",
      pass: "research",
      vendor: "anthropic/claude-opus-5",
    });
    let spawned = false;
    const blockedDeps = deps(f.store, p.proc);
    blockedDeps.spawnPipeline = () => {
      spawned = true;
      return p.proc;
    };
    await assert.rejects(
      runOne(misclassified, "w1", blockedDeps),
      /Simulation identities cannot enter the production worker/,
    );
    assert.equal(spawned, false);
  });

  it("always passes --resume, on a first run as much as a retaken one", () => {
    // One code path rather than a decision about whether this is a fresh start. On a
    // first run there is no state file and the pipeline begins at zero; on a retaken
    // claim it continues from the last checkpointed row. Choosing between them is a
    // chance to choose wrong.
    assert.ok(argsFor(run()).args.includes("--resume"));
    assert.ok(argsFor(run({ pass: "g2" })).args.includes("--resume"));
  });

  it("calls the research orchestrator with --out for a first pass", () => {
    const { script, args } = argsFor(run());
    assert.match(script, /research_orchestrator\.py$/);
    assert.equal(args[args.indexOf("--out") + 1], "EGY_run1");
    assert.equal(args[args.indexOf("--country") + 1], "Egypt");
    assert.equal(args[args.indexOf("--iso") + 1], "EGY");
  });

  it("calls the automated vendor challenge with --run for the inherited name", () => {
    // The canonical script is machine QC, not G2 human review. It takes --run because it
    // reads an existing pass rather than naming a new one.
    const { script, args } = argsFor(run({ pass: "g2" }));
    assert.match(script, /automated_challenge\.py$/);
    assert.equal(args[args.indexOf("--run") + 1], "EGY_run1");
    assert.ok(!args.includes("--out"));
    assert.ok(!args.includes("--legacy-g2-output-names"));
  });

  it("passes the ceiling so the pipeline enforces the same budget the app displays", () => {
    const { args } = argsFor(run({ ceilingUsd: 250 }));
    assert.equal(args[args.indexOf("--ceiling") + 1], "250");
  });

  it("omits the vendor flag when none is chosen, rather than passing an empty one", () => {
    const { args } = argsFor(run({ vendor: null }));
    assert.ok(!args.includes("--vendor"));
    assert.ok(argsFor(run({ vendor: "openai/gpt-5.6-terra" })).args.includes("--vendor"));
  });

  it("launches the whole workflow once and enables automatic checkpoint recovery", () => {
    const workflow = run({ pass: "workflow", vendor: defaultVendorFor("workflow") });
    const { script, args } = argsFor(workflow);
    assert.match(script, /run_workflow\.py$/);
    assert.equal(args[args.indexOf("--out") + 1], workflowRunDir(workflow));
    assert.equal(args[args.indexOf("--run-id") + 1], workflow.id);
    assert.equal(
      args[args.indexOf("--uploads-manifest") + 1],
      workflowUploadManifestPath(workflow),
    );
    assert.equal(args[args.indexOf("--ceiling") + 1], "500");
    assert.equal(args[args.indexOf("--vendor") + 1], defaultVendorFor("workflow"));
    assert.ok(args.includes("--resume"), "a reclaimed worker resumes without a human gate");
  });
});

describe("freezing optional uploads at launch", () => {
  it("writes extracted text under the workflow workspace with verified hashes", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workflow-test-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      await mkdir(path.join(temp, "gauntlet/loop-1"), { recursive: true });
      const workflow = run({ pass: "workflow", outBasename: "EGY_snapshot" });
      const original = Buffer.from("original pdf bytes");
      const manifestPath = await writeWorkflowUploadSnapshot(workflow, [
        {
          id: "upload-1",
          filename: "national-ai-strategy.pdf",
          kind: "ai",
          mime: "application/pdf",
          chars: 14,
          content: "Extracted text",
          uploadedAt: "2026-08-26T01:02:03Z",
          sourceSha256: createHash("sha256").update(original).digest("hex"),
          sourceBytes: original.byteLength,
          sourceBase64: original.toString("base64"),
          uploaderId: "user-1",
          extractionStatus: "extracted",
        },
      ]);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(manifest.schema_version, "damm.uploads-manifest/v1");
      assert.equal(manifest.documents.length, 1);
      const document = manifest.documents[0];
      assert.equal(document.kind, "ai_documents");
      assert.equal(document.original_filename, "national-ai-strategy.pdf");
      assert.equal(document.content_media_type, "text/plain");
      assert.equal(document.source_mime_type, undefined);
      assert.equal(document.uploaded_at, undefined);
      assert.equal(document.metadata.source_mime_type, "application/pdf");
      assert.equal(document.metadata.uploaded_at, "2026-08-26T01:02:03Z");
      assert.equal(document.metadata.extracted_characters, 14);
      assert.equal(document.metadata.app_upload_kind, "ai_documents");
      assert.equal(document.metadata.app_upload_kind_original, "ai");
      assert.equal(document.metadata.uploaded_by, "user-1");
      assert.equal(document.metadata.extraction_status, "extracted");
      assert.equal(document.original_size_bytes, original.byteLength);
      assert.equal(document.original_sha256, createHash("sha256").update(original).digest("hex"));
      assert.equal(
        document.content_sha256,
        createHash("sha256").update("Extracted text").digest("hex"),
      );
      const contentPath = path.resolve(workflowRunDir(workflow), document.content_path);
      assert.ok(contentPath.startsWith(`${workflowRunDir(workflow)}${path.sep}`));
      assert.equal(await readFile(contentPath, "utf8"), "Extracted text");
      assert.deepEqual(
        await readFile(path.resolve(workflowRunDir(workflow), document.original_path)),
        original,
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("writes a valid empty snapshot, because uploads are never a launch requirement", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workflow-empty-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      await mkdir(path.join(temp, "gauntlet/loop-1"), { recursive: true });
      const manifestPath = await writeWorkflowUploadSnapshot(
        run({ pass: "workflow", outBasename: "EGY_empty" }),
        [],
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.deepEqual(manifest.documents, []);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("refuses symlinked upload directories and the final launch manifest", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workflow-input-symlink-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const loopRoot = path.join(temp, "gauntlet/loop-1");
      await mkdir(loopRoot, { recursive: true });

      const directoryRun = run({ pass: "workflow", outBasename: "EGY_input_link" });
      const directoryRoot = workflowRunDir(directoryRun);
      const externalDirectory = path.join(temp, "outside-upload-content");
      await mkdir(path.join(directoryRoot, "inputs"), { recursive: true });
      await mkdir(externalDirectory);
      await symlink(externalDirectory, path.join(directoryRoot, "inputs/upload-content"), "dir");
      await assert.rejects(
        writeWorkflowUploadSnapshot(directoryRun, []),
        /real contained directory/i,
      );
      assert.deepEqual(await readdir(externalDirectory), []);

      const manifestRun = run({ pass: "workflow", outBasename: "EGY_manifest_link" });
      const manifestRoot = workflowRunDir(manifestRun);
      const externalManifest = path.join(temp, "outside-launch-manifest.json");
      await mkdir(manifestRoot);
      await writeFile(externalManifest, "external bytes");
      await symlink(externalManifest, path.join(manifestRoot, "launch-uploads-manifest.json"));
      await assert.rejects(writeWorkflowUploadSnapshot(manifestRun, []));
      assert.equal(await readFile(externalManifest, "utf8"), "external bytes");
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Following a run to its end.
// ---------------------------------------------------------------------------

/** A store that records what it was told rather than writing it anywhere. */
function fakeStore(queue: ClaimedRun[] = []) {
  const calls = {
    rowsTotal: [] as Array<[number, string | null]>,
    rows: [] as RowProgress[],
    notes: [] as string[],
    finished: [] as Array<{ status: string; reason: string; spentUsd?: number }>,
    claims: 0,
    released: [] as Array<{ runId: string; workerId: string; claimToken: string }>,
    heartbeats: 0,
  };
  let claimHeld = true;
  const store: RunStore = {
    async claimNextRun() {
      calls.claims++;
      return queue.shift() ?? null;
    },
    async releaseClaim(runId, workerId, claimToken) {
      calls.released.push({ runId, workerId, claimToken });
      return claimHeld;
    },
    async setRowsTotal(_id, _workerId, _claimToken, n, v) {
      calls.rowsTotal.push([n, v]);
      return true;
    },
    async recordRow(_id, _workerId, _claimToken, e) {
      calls.rows.push(e);
      return true;
    },
    async noteEvent(_id, _workerId, _claimToken, _kind, message) {
      calls.notes.push(message);
      return true;
    },
    async heartbeat() {
      calls.heartbeats++;
      return claimHeld;
    },
    async finishRun(_id, _workerId, _claimToken, status, reason, spentUsd) {
      calls.finished.push({ status, reason, spentUsd });
      return true;
    },
  };
  return { store, calls, loseClaim: () => (claimHeld = false) };
}

/** A pipeline that emits the chunks it is given and then exits. */
function fakeProcess(chunks: string[], exitCode: number | null, opts: { stderr?: string[] } = {}) {
  let outCb: (c: string) => void = () => {};
  let errCb: (c: string) => void = () => {};
  const killed = { yes: false };
  const proc: SpawnedProcess = {
    onStdout: (cb) => (outCb = cb),
    onStderr: (cb) => (errCb = cb),
    async wait() {
      for (const c of chunks) outCb(c);
      for (const c of opts.stderr ?? []) errCb(c);
      // Let the queued store writes settle the way they would across real I/O.
      await new Promise((r) => setTimeout(r, 0));
      return exitCode;
    },
    kill: () => (killed.yes = true),
  };
  return { proc, killed };
}

const RESEARCH_OUT = `Egypt (EGY) · 59 rows · vendor anthropic/claude-opus-5

  [ 1/59] 1.4          pass   Measured   L3 109.1                                $  0.47   51s
G [ 5/59] 1.6          gap    Gap        LNone DATA GAP — Read all nine supplied    $  1.51   78s

wrote EGY_shadow_input.json — 59 rows, 23 gaps, 10 held
`;

function deps(store: RunStore, proc: SpawnedProcess, ledger: number | null = null): WorkerDeps {
  return {
    store,
    spawnPipeline: () => proc,
    readLedger: async () => ledger,
    verifyWorkflow: () => ({ ok: true }),
    prepareWorkflowInputs: async () => {},
    publishWorkflowArtifacts: async () => {},
    heartbeatMs: 5,
  };
}

describe("following a run", () => {
  it("records the total, every row, and a clean ending", async () => {
    const f = fakeStore();
    const p = fakeProcess([RESEARCH_OUT], 0);
    const status = await runOne(run(), "w1", deps(f.store, p.proc));

    assert.equal(status, "done");
    assert.deepEqual(f.calls.rowsTotal, [[59, "anthropic/claude-opus-5"]]);
    assert.equal(f.calls.rows.length, 2);
    assert.equal(f.calls.rows[1].indicatorId, "1.6");
    assert.equal(f.calls.rows[1].spentUsd, 1.51);
    assert.equal(f.calls.finished[0].status, "done");
  });

  it("reassembles a row that arrives split across two chunks", async () => {
    // Stdout arrives in arbitrary pieces. Parsing each chunk as it lands would see half
    // a row, drop it, and the progress bar would silently skip an indicator.
    const f = fakeStore();
    const mid = RESEARCH_OUT.indexOf("109.1") + 2;
    const p = fakeProcess([RESEARCH_OUT.slice(0, mid), RESEARCH_OUT.slice(mid)], 0);
    await runOne(run(), "w1", deps(f.store, p.proc));

    assert.equal(f.calls.rows.length, 2, "the split row should still be recorded once");
    assert.equal(f.calls.rows[0].indicatorId, "1.4");
  });

  it("takes the final spend from the ledger, not from stdout", async () => {
    // The last line said $1.51. The ledger is the source of record for money, and the
    // two differ whenever a row's cost lands after its progress line.
    const f = fakeStore();
    const p = fakeProcess([RESEARCH_OUT], 0);
    await runOne(run(), "w1", deps(f.store, p.proc, 15.14));
    assert.equal(f.calls.finished[0].spentUsd, 15.14);
  });

  it("leaves the stdout figure standing when there is no ledger to read", async () => {
    const f = fakeStore();
    const p = fakeProcess([RESEARCH_OUT], 0);
    await runOne(run(), "w1", deps(f.store, p.proc, null));
    assert.equal(f.calls.finished[0].spentUsd, undefined);
  });

  it("records exhaustion as exhaustion even though the pipeline exits cleanly", async () => {
    const f = fakeStore();
    const p = fakeProcess(
      [RESEARCH_OUT + "!! budget exhausted in pass 'research': $200.00 of $200.00\n"],
      0,
    );
    const status = await runOne(run(), "w1", deps(f.store, p.proc));
    assert.equal(status, "exhausted");
    assert.match(f.calls.finished[0].reason, /not recorded as gaps/);
  });

  it("treats a traceback on stderr as the failure reason", async () => {
    const f = fakeStore();
    const p = fakeProcess(["Egypt (EGY) · 59 rows · vendor anthropic/claude-opus-5\n"], 1, {
      stderr: ["Traceback (most recent call last):\nKeyError: 'mean'\n"],
    });
    const status = await runOne(run(), "w1", deps(f.store, p.proc));
    assert.equal(status, "failed");
    assert.match(f.calls.finished[0].reason, /KeyError|Traceback/);
  });

  it("does not treat the word Error on stdout as a failure", async () => {
    // Search trails and page titles reach stdout. Only stderr is a failure signal.
    const f = fakeStore();
    const p = fakeProcess([RESEARCH_OUT.replace("DATA GAP", "ValueError: in title")], 0);
    const status = await runOne(run(), "w1", deps(f.store, p.proc));
    assert.equal(status, "done");
  });

  it("stops the pipeline when its claim has been taken by another worker", async () => {
    // A lost claim means this worker was presumed dead and something else is now running
    // the same country. Two pipelines against one ceiling spend the budget twice.
    const f = fakeStore();
    f.loseClaim();
    let outCb: (c: string) => void = () => {};
    const killed = { yes: false };
    const proc: SpawnedProcess = {
      onStdout: (cb) => (outCb = cb),
      onStderr: () => {},
      async wait() {
        outCb(RESEARCH_OUT);
        await new Promise((r) => setTimeout(r, 30)); // long enough for a heartbeat
        return 0;
      },
      kill: () => (killed.yes = true),
    };
    await runOne(run(), "w1", deps(f.store, proc));
    assert.ok(f.calls.heartbeats > 0, "should have checked its claim");
    assert.ok(killed.yes, "should have stopped rather than run alongside the new claimant");
  });

  it("maps the coordinator's eight stage completions to one finished run", async () => {
    const f = fakeStore();
    const base = {
      schema_version: "damm.workflow-event/v1",
      run_id: "r1",
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
    };
    const lines = [
      JSON.stringify({
        ...base,
        sequence: 1,
        timestamp: "2026-08-26T00:00:01Z",
        event: "start",
      }),
    ];
    for (const stage of DAR_WORKFLOW.stages) {
      lines.push(
        JSON.stringify({
          ...base,
          sequence: stage.ordinal + 1,
          timestamp: `2026-08-26T00:00:${String(stage.ordinal + 1).padStart(2, "0")}Z`,
          event: "stage_complete",
          stage_id: stage.id,
          stage_ordinal: stage.ordinal,
          attempt: 1,
          elapsed_seconds: 10,
          spent_usd: 1,
          cumulative_spent_usd: stage.ordinal,
          artifacts: [],
        }),
      );
    }
    lines.push(
      JSON.stringify({
        ...base,
        sequence: 10,
        timestamp: "2026-08-26T00:00:10Z",
        event: "workflow_complete",
      }),
    );
    const p = fakeProcess([`${lines.join("\n")}\n`], 0);
    const status = await runOne(
      run({ pass: "workflow", rowsTotal: null, vendor: null }),
      "w1",
      deps(f.store, p.proc, 8),
    );
    assert.equal(status, "done");
    assert.deepEqual(f.calls.rowsTotal, [[8, null]]);
    assert.deepEqual(
      f.calls.rows.map((row) => row.indicatorId),
      DAR_WORKFLOW.stages.map((stage) => stage.id),
    );
    assert.equal(f.calls.rows.at(-1)?.rowsDone, 8);
    assert.equal(f.calls.finished[0].spentUsd, 8);
  });

  it("turns workflow budget exhaustion into a terminal failure, not a top-up state", async () => {
    const f = fakeStore();
    const p = fakeProcess(["!! budget exhausted in pass 'research': $500.00 of $500.00\n"], 0);
    const status = await runOne(
      run({ pass: "workflow", vendor: null }),
      "w1",
      deps(f.store, p.proc),
    );
    assert.equal(status, "failed");
    assert.match(f.calls.finished[0].reason, /does not wait for a human budget top-up/);
  });

  it("refuses workflow_complete when the canonical manifest cannot prove all eight stages", async () => {
    const f = fakeStore();
    const complete = JSON.stringify({
      schema_version: "damm.workflow-event/v1",
      run_id: "r1",
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      sequence: 1,
      timestamp: "2026-08-26T00:00:01Z",
      event: "workflow_complete",
    });
    const p = fakeProcess([`${complete}\n`], 0);
    const d = deps(f.store, p.proc);
    d.verifyWorkflow = () => ({ ok: false, reason: "stage 8 is incomplete" });
    const status = await runOne(run({ pass: "workflow", vendor: null }), "w1", d);
    assert.equal(status, "failed");
    assert.match(f.calls.finished[0].reason, /stage 8 is incomplete/);
  });

  it("keeps a fragmented stderr failure separate from partial stdout", async () => {
    const f = fakeStore();
    const p = fakeProcess(["an unfinished stdout line"], 1, {
      stderr: ["Trace", "back (most recent call last):"],
    });
    const status = await runOne(run(), "w1", deps(f.store, p.proc));
    assert.equal(status, "failed");
    assert.match(f.calls.finished[0].reason, /Traceback/);
  });
});

describe("draining the queue", () => {
  it("handles every claimable run and stops when none is left", async () => {
    const f = fakeStore([run({ id: "a" }), run({ id: "b" })]);
    const handled = await drain("w1", {
      ...deps(f.store, fakeProcess([RESEARCH_OUT], 0).proc),
      spawnPipeline: () => fakeProcess([RESEARCH_OUT], 0).proc,
    });
    assert.equal(handled, 2);
    assert.equal(f.calls.finished.length, 2);
  });

  it("marks a run failed when the worker itself throws, rather than stranding it", async () => {
    // Left as running, the run would sit untouched until the claim lease expired, and
    // the workspace would show it progressing when nothing was.
    const f = fakeStore([run({ id: "a" })]);
    const handled = await drain("w1", {
      ...deps(f.store, fakeProcess([], 0).proc),
      spawnPipeline: () => {
        throw new Error("python not found");
      },
    });
    assert.equal(handled, 1);
    assert.equal(f.calls.finished[0].status, "failed");
    assert.match(f.calls.finished[0].reason, /python not found/);
  });

  it("finishes the run in flight but claims no new run after a graceful stop", async () => {
    const f = fakeStore([run({ id: "in-flight" }), run({ id: "must-remain-queued" })]);
    let stopping = false;
    const handled = await drain(
      "w1",
      {
        ...deps(f.store, fakeProcess([RESEARCH_OUT], 0).proc),
        spawnPipeline: () => {
          stopping = true;
          return fakeProcess([RESEARCH_OUT], 0).proc;
        },
      },
      () => stopping,
    );

    assert.equal(handled, 1);
    assert.equal(f.calls.claims, 1, "shutdown must be observed before the next queue claim");
    assert.equal(f.calls.finished.length, 1, "the already-claimed run still finishes cleanly");
    assert.equal(f.calls.released.length, 0, "an in-flight pipeline keeps its existing claim");
  });

  it("releases a claim when shutdown wins the asynchronous claim race", async () => {
    const claimed = run({ id: "claimed-during-shutdown", claimToken: "race-token" });
    const f = fakeStore();
    let stopping = false;
    let pipelineStarts = 0;
    f.store.claimNextRun = async () => {
      f.calls.claims++;
      stopping = true;
      return claimed;
    };

    const handled = await drain(
      "w-race",
      {
        ...deps(f.store, fakeProcess([], 0).proc),
        spawnPipeline: () => {
          pipelineStarts++;
          return fakeProcess([], 0).proc;
        },
      },
      () => stopping,
    );

    assert.equal(handled, 0);
    assert.equal(pipelineStarts, 0, "a post-signal claim must never start Python");
    assert.deepEqual(f.calls.released, [
      {
        runId: "claimed-during-shutdown",
        workerId: "w-race",
        claimToken: "race-token",
      },
    ]);
    assert.equal(f.calls.finished.length, 0, "requeueing is not a terminal run outcome");
  });
});

describe("spawning the real pipeline", () => {
  it("ends the run when the interpreter is missing, rather than holding the claim", async () => {
    // Waiting only on 'close' would leave this run showing as running until its lease
    // expired. The failure has to reach the record, and it has to say what went wrong.
    const before = process.env.DAMM_PIPELINE_PYTHON;
    process.env.DAMM_PIPELINE_PYTHON = "/nonexistent/python-that-is-not-there";
    try {
      const f = fakeStore();
      const real = defaultDeps();
      // readLedger is deliberately the real one: overriding it here once hid a broken
      // path reference that only showed up against a live queue.
      const status = await runOne(run(), "w1", { ...real, store: f.store, heartbeatMs: 50 });
      assert.equal(status, "failed");
      assert.match(f.calls.finished[0].reason, /could not be started/);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_PYTHON;
      else process.env.DAMM_PIPELINE_PYTHON = before;
    }
  });

  it("points a research pass at the configured pipeline directory", () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    process.env.DAMM_PIPELINE_DIR = "/opt/damm";
    try {
      assert.equal(
        argsFor(run()).script,
        "/opt/damm/gauntlet/loop-1/research_pipeline/research_orchestrator.py",
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
    }
  });

  it("reconciles workflow spend from the authoritative run manifest", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workflow-spend-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", outBasename: "EGY_spend" });
      await mkdir(workflowRunDir(workflow), { recursive: true });
      await writeFile(
        path.join(workflowRunDir(workflow), "workflow-manifest.json"),
        JSON.stringify({ schema_version: "damm.workflow-run/v1", spent_usd: 42.75 }),
      );
      assert.equal(await defaultDeps().readLedger(workflow), 42.75);
      await writeFile(
        path.join(workflowRunDir(workflow), "workflow-manifest.json"),
        JSON.stringify({ schema_version: "damm.workflow-run/v1", spent_usd: null }),
      );
      assert.equal(await defaultDeps().readLedger(workflow), null);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("reads new machine-challenge state and spend from the canonical identity", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-canonical-challenge-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const loop = path.join(temp, "gauntlet/loop-1");
      await mkdir(loop, { recursive: true });
      const challenge = run({ pass: "g2", outBasename: "EGY_challenge" });
      await writeFile(
        path.join(loop, "EGY_challenge_automated_challenge_spend.json"),
        JSON.stringify({ summary: { total: 12.75 } }),
      );
      assert.match(
        passFilePaths(challenge).input,
        /EGY_challenge_automated_challenge_input\.json$/,
      );
      assert.match(
        artifactPath(challenge, "findings")?.path ?? "",
        /EGY_challenge_automated_challenge_findings\.json$/,
      );
      assert.equal(await defaultDeps().readLedger(challenge), 12.75);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("reads one historical g2 alias but rejects divergent parallel identities", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-legacy-challenge-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const loop = path.join(temp, "gauntlet/loop-1");
      await mkdir(loop, { recursive: true });
      const challenge = run({ pass: "g2", outBasename: "EGY_legacy" });
      const input = `${JSON.stringify({ "1.1": { value: "legacy" } })}\n`;
      const findings = `${JSON.stringify([{ id: "1.1", outcome: "upheld" }])}\n`;
      const state = `${JSON.stringify({ findings: { "1.1": { outcome: "upheld" } } })}\n`;
      const spend = JSON.stringify({ summary: { total: 8.5 } });
      await Promise.all([
        writeFile(path.join(loop, "EGY_legacy_g2_input.json"), input),
        writeFile(path.join(loop, "EGY_legacy_g2_findings.json"), findings),
        writeFile(path.join(loop, "EGY_legacy_g2_state.json"), state),
        writeFile(path.join(loop, "EGY_legacy_g2_spend.json"), spend),
      ]);

      assert.match(passFilePaths(challenge).input, /EGY_legacy_g2_input\.json$/);
      assert.match(passFilePaths(challenge).state, /EGY_legacy_g2_state\.json$/);
      assert.match(
        artifactPath(challenge, "findings")?.path ?? "",
        /EGY_legacy_g2_findings\.json$/,
      );
      assert.equal(await defaultDeps().readLedger(challenge), 8.5);

      await writeFile(path.join(loop, "EGY_legacy_automated_challenge_input.json"), input);
      assert.match(
        passFilePaths(challenge).input,
        /EGY_legacy_automated_challenge_input\.json$/,
        "byte-identical canonical output supersedes the historical alias",
      );

      await writeFile(
        path.join(loop, "EGY_legacy_automated_challenge_input.json"),
        `${JSON.stringify({ "1.1": { value: "divergent" } })}\n`,
      );
      assert.throws(() => passFilePaths(challenge), /conflicting canonical and legacy/i);
      assert.equal(
        artifactPath(challenge, "input"),
        null,
        "a divergent historical alias cannot authorize an artifact read",
      );

      await writeFile(
        path.join(loop, "EGY_legacy_automated_challenge_spend.json"),
        JSON.stringify({ summary: { total: 99 } }),
      );
      assert.equal(
        await defaultDeps().readLedger(challenge),
        null,
        "ambiguous ledgers cannot overwrite the recorded spend",
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });
});

describe("every pass in the allocation", () => {
  it("has a script, and each is a different one", () => {
    // All five are built. The check that matters now is that no two passes share a
    // script: routing one to another's would run that pass and bill this one's share.
    const scripts = (
      ["workflow", "research", "g2", "scans", "foresight", "generation", "diagnostic"] as const
    ).map((pass) => argsFor(run({ pass })).script);
    assert.equal(new Set(scripts).size, 7);
    assert.ok(scripts.every((s) => s.endsWith(".py")));
  });

  it("refuses a pass no script implements, rather than falling through", () => {
    assert.throws(() => argsFor(run({ pass: "nonesuch" as never })), /No script implements/);
  });
});

describe("the scans pass", () => {
  it("is invoked with --out and its own basename", () => {
    const { script, args } = argsFor(run({ pass: "scans" }));
    assert.match(script, /scans\.py$/);
    assert.equal(args[args.indexOf("--out") + 1], "EGY_run1");
    assert.ok(args.includes("--resume"));
  });

  it("keeps its files under its own prefix, so no two passes share a ledger", () => {
    // The invocations are identical by design — same basename, same flag, different
    // script. What has to differ is where each pass's ledger and checkpoint live:
    // research writes EGY_run1_*, scans writes EGY_run1_scans_*. Sharing one file would
    // make each pass's recorded spend whatever the other wrote last.
    const research = passFilePaths(run({ pass: "research" }));
    const scans = passFilePaths(run({ pass: "scans" }));
    const g2 = passFilePaths(run({ pass: "g2" }));
    assert.match(scans.state, /EGY_run1_scans_state\.json$/);
    assert.match(research.state, /EGY_run1_state\.json$/);
    assert.match(g2.state, /EGY_run1_automated_challenge_state\.json$/);
    assert.notEqual(scans.state, research.state);
  });
});

describe("recording what a run lost", () => {
  const note = (vendor: string, rows: string[], total: number | null) =>
    degradationNotes(
      new Map([[vendor, { rows: new Set(rows), example: "401 quota exceeded" }]]),
      total,
    );

  it("says plainly when a vendor was down for every row", () => {
    // "Finished 59 of 59 rows" with the discovery peer down for all 59 is the shape of a
    // clean success that was not one.
    const [n] = note("perplexity", ["1.1", "1.2", "1.3"], 3);
    assert.match(n, /perplexity was unavailable for every row/);
    assert.match(n, /researched without it/);
  });

  it("counts the rows when only some were affected", () => {
    assert.match(note("perplexity", ["1.1"], 59)[0], /unavailable for 1 row of 59/);
    assert.match(note("exa", ["1.1", "1.2"], 59)[0], /unavailable for 2 rows of 59/);
  });

  it("says nothing when nothing was lost", () => {
    assert.deepEqual(degradationNotes(new Map(), 59), []);
  });

  it("reaches the run record on a finished run, not only a failed one", async () => {
    const f = fakeStore();
    const p = fakeProcess(
      [
        "Egypt (EGY) · 2 rows · vendor anthropic/claude-opus-5\n" +
          "    ! 1.1: perplexity discovery unavailable — 401 quota\n" +
          "    ! 1.2: perplexity discovery unavailable — 401 quota\n" +
          "wrote EGY_x_input.json — 2 rows\n",
      ],
      0,
    );
    const status = await runOne(run(), "w1", deps(f.store, p.proc));
    assert.equal(status, "done");
    assert.match(f.calls.finished[0].reason, /perplexity was unavailable/);
    assert.ok(f.calls.notes.some((m) => /perplexity/.test(m)));
  });
});

interface PackageFixtureFile {
  path: string;
  category:
    | "narrative"
    | "structured"
    | "source_inventory"
    | "source_inventory_consolidated"
    | "workflow"
    | "input";
  content: string | Uint8Array;
  stage_id?: string;
  artifact_id?: string;
  source_sha256?: string;
  input_id?: string;
  input_kind?: string;
}

interface UploadFixture {
  id: string;
  kind: "country_context_documents" | "ai_documents";
  filename: string;
  original: Uint8Array;
  extracted: string;
}

async function fileHash(filename: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
}

async function writePipelineMethodologyFixture(
  root: string,
  engineVersion = "1.7",
): Promise<PipelineMethodologyFile[]> {
  const contentByRole: Record<PipelineMethodologyFile["role"], Uint8Array> = {
    model: new Uint8Array(await readFile(new URL("../../data/model_v1_7.json", import.meta.url))),
    model_schema: new Uint8Array(
      await readFile(new URL("../../data/model_v1_7.schema.json", import.meta.url)),
    ),
    engine: new TextEncoder().encode(`"""DAMM v${engineVersion} engine"""\n`),
    renderer: new TextEncoder().encode('"""DAMM v1.7 renderer"""\n'),
  };
  const expected: PipelineMethodologyFile[] = [];
  for (const component of CANONICAL_PIPELINE_METHODOLOGY_FILES) {
    const filename = path.join(root, component.path);
    await mkdir(path.dirname(filename), { recursive: true });
    const content = contentByRole[component.role];
    await writeFile(filename, content);
    expected.push({
      ...component,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return expected;
}

function commitPipelineFixture(root: string): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.email", "methodology-test@example.invalid");
  git("config", "user.name", "Methodology Test");
  git("add", ".");
  git("commit", "-q", "-m", "fixture");
  return git("rev-parse", "HEAD");
}

describe("canonical pipeline methodology preflight", () => {
  it("accepts one exact model/schema/engine/renderer set and rejects byte drift", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "damm-methodology-test-"));
    try {
      const expected = await writePipelineMethodologyFixture(temp);
      const commit = commitPipelineFixture(temp);
      assert.equal(verifyPipelineMethodology(temp, expected, commit).ok, true);
      const model = expected.find((component) => component.role === "model")!;
      await writeFile(path.join(temp, model.path), "{}\n");
      const rejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(rejected.ok, false);
      assert.match(rejected.ok ? "" : rejected.reason, /model.*pinned/i);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects a stale executable version label even when its new bytes are self-declared", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "damm-methodology-label-test-"));
    try {
      const expected = await writePipelineMethodologyFixture(temp, "1.6");
      const commit = commitPipelineFixture(temp);
      const rejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(rejected.ok, false);
      assert.match(rejected.ok ? "" : rejected.reason, /stale DAMM version label/i);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects coordinator or exporter drift outside the four explicit methodology files", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "damm-methodology-source-test-"));
    try {
      const expected = await writePipelineMethodologyFixture(temp);
      const coordinator = path.join(temp, "gauntlet/loop-1/research_pipeline/run_workflow.py");
      await mkdir(path.dirname(coordinator), { recursive: true });
      await writeFile(coordinator, '"""canonical coordinator"""\n');
      const commit = commitPipelineFixture(temp);
      assert.equal(verifyPipelineMethodology(temp, expected, commit).ok, true);

      // Canonical stages write untracked JSON/HTML work products beside the scripts.
      // Those must not invalidate a clean tracked executable closure.
      await writeFile(path.join(temp, "gauntlet/loop-1/EGY_stage-output.json"), "{}\n");
      await writeFile(path.join(temp, "gauntlet/loop-1/EGY_stage-output.html"), "<p>ok</p>\n");
      assert.equal(verifyPipelineMethodology(temp, expected, commit).ok, true);

      const rogueHandler = path.join(temp, "gauntlet/loop-1/research_pipeline/rogue_handler.py");
      await writeFile(rogueHandler, '"""untracked executable"""\n');
      const rogueRejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(rogueRejected.ok, false);
      assert.match(rogueRejected.ok ? "" : rogueRejected.reason, /clean pinned source revision/i);
      await rm(rogueHandler);

      await writeFile(coordinator, '"""stale coordinator"""\n');
      const rejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(rejected.ok, false);
      assert.match(rejected.ok ? "" : rejected.reason, /clean pinned source revision/i);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects ignored Python source and bytecode in the executable source tree", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "damm-methodology-ignored-source-test-"));
    try {
      const expected = await writePipelineMethodologyFixture(temp);
      const sourceDir = path.join(temp, "gauntlet/loop-1/research_pipeline");
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(sourceDir, "run_workflow.py"), '"""canonical coordinator"""\n');
      await writeFile(path.join(temp, ".gitignore"), "*.ignored.py\n__pycache__/\n");
      const commit = commitPipelineFixture(temp);
      assert.equal(verifyPipelineMethodology(temp, expected, commit).ok, true);

      const ignoredSource = path.join(sourceDir, "rogue_handler.ignored.py");
      await writeFile(ignoredSource, '"""ignored executable source"""\n');
      const sourceRejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(sourceRejected.ok, false);
      assert.match(sourceRejected.ok ? "" : sourceRejected.reason, /clean pinned source revision/i);
      await rm(ignoredSource);

      const externalPackage = path.join(temp, "ignored-external-package");
      await mkdir(externalPackage);
      await writeFile(path.join(externalPackage, "__init__.py"), 'raise RuntimeError("rogue")\n');
      const packageLink = path.join(sourceDir, "anthropic");
      await symlink(externalPackage, packageLink, "dir");
      const packageRejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(packageRejected.ok, false);
      assert.match(
        packageRejected.ok ? "" : packageRejected.reason,
        /clean pinned source revision/i,
      );
      await rm(packageLink);

      const bytecode = path.join(sourceDir, "__pycache__/rogue_handler.cpython-312.pyc");
      await mkdir(path.dirname(bytecode), { recursive: true });
      await writeFile(bytecode, new Uint8Array([0xa7, 0x0d, 0x0d, 0x0a]));
      const bytecodeRejected = verifyPipelineMethodology(temp, expected, commit);
      assert.equal(bytecodeRejected.ok, false);
      assert.match(
        bytecodeRejected.ok ? "" : bytecodeRejected.reason,
        /clean pinned source revision/i,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

async function directoryHash(directory: string): Promise<string> {
  const files: string[] = [];
  async function visit(current: string) {
    for (const name of (await readdir(current)).sort()) {
      const candidate = path.join(current, name);
      const stat = await lstat(candidate);
      if (stat.isDirectory()) await visit(candidate);
      else if (stat.isFile()) files.push(candidate);
    }
  }
  await visit(directory);
  files.sort((a, b) =>
    path
      .relative(directory, a)
      .split(path.sep)
      .join("/")
      .localeCompare(path.relative(directory, b).split(path.sep).join("/")),
  );
  const digest = createHash("sha256");
  for (const filename of files) {
    const relative = Buffer.from(path.relative(directory, filename).split(path.sep).join("/"));
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(relative.length));
    digest.update(length);
    digest.update(relative);
    digest.update(Buffer.from(await fileHash(filename), "hex"));
  }
  return digest.digest("hex");
}

async function writeCompletedWorkflow(
  workflow: Run,
  packageFiles: PackageFixtureFile[],
  uploadFixtures: UploadFixture[] = [],
): Promise<{ root: string; bundle: string; packagePaths: Map<string, string> }> {
  const root = workflowRunDir(workflow);
  const uploadsManifest = path.join(root, "inputs/uploads-manifest.json");
  const inputSnapshot = path.join(root, "inputs/input-snapshot.json");
  await mkdir(path.dirname(inputSnapshot), { recursive: true });
  const uploadDocuments = [] as Array<Record<string, unknown>>;
  for (const [index, upload] of uploadFixtures.entries()) {
    const prefix = String(index + 1).padStart(3, "0");
    const contentPath = `inputs/upload-content/${prefix}-${upload.id}.txt`;
    const originalPath = `inputs/upload-originals/${prefix}-${upload.id}.bin`;
    const contentBytes = new TextEncoder().encode(upload.extracted);
    await mkdir(path.dirname(path.join(root, contentPath)), { recursive: true });
    await mkdir(path.dirname(path.join(root, originalPath)), { recursive: true });
    await writeFile(path.join(root, contentPath), contentBytes);
    await writeFile(path.join(root, originalPath), upload.original);
    uploadDocuments.push({
      id: upload.id,
      kind: upload.kind,
      original_filename: upload.filename,
      content_path: contentPath,
      content_sha256: createHash("sha256").update(contentBytes).digest("hex"),
      content_media_type: "text/plain",
      original_path: originalPath,
      original_sha256: createHash("sha256").update(upload.original).digest("hex"),
      original_size_bytes: upload.original.byteLength,
      metadata: {
        extracted_characters: Array.from(upload.extracted).length,
        app_upload_kind: upload.kind,
        source_mime_type: "application/octet-stream",
        uploaded_at: "2026-08-26T01:02:03Z",
        uploaded_by: "user-1",
        extraction_status: "extracted",
      },
    });
  }
  await writeFile(
    uploadsManifest,
    `${JSON.stringify({
      schema_version: "damm.uploads-manifest/v1",
      documents: uploadDocuments,
    })}\n`,
  );
  const uploadsRecord = {
    path: "inputs/uploads-manifest.json",
    sha256: await fileHash(uploadsManifest),
    document_count: uploadDocuments.length,
  };
  await writeFile(
    inputSnapshot,
    `${JSON.stringify({
      schema_version: "damm.workflow-input-snapshot/v1",
      country: workflow.countryName,
      iso3: workflow.iso3,
      contract_sha256: DAR_WORKFLOW_SHA256,
      uploads_manifest: uploadsRecord,
      ceiling_usd: workflow.ceilingUsd,
      vendor: workflow.vendor,
    })}\n`,
  );

  const stageRecords: Array<Record<string, unknown>> = [];
  const stageArtifactSources = new Map<string, { path: string; sha256: string }>();
  for (const stage of DAR_WORKFLOW.stages.slice(0, -1)) {
    const stageDir = path.join(
      root,
      "stages",
      `${String(stage.ordinal).padStart(2, "0")}-${stage.id}`,
    );
    await mkdir(stageDir, { recursive: true });
    const artifacts = [] as Array<Record<string, unknown>>;
    for (const [index, key] of stage.required_artifacts
      .filter((artifact) => artifact !== "stage_manifest")
      .entries()) {
      const filename = path.join(stageDir, `${String(index + 1).padStart(2, "0")}-${key}.json`);
      await writeFile(filename, JSON.stringify({ key }));
      artifacts.push({
        key,
        path: path.relative(root, filename).split(path.sep).join("/"),
        sha256: await fileHash(filename),
        media_type: "application/json",
      });
    }
    if (stage.id === "damm_diagnostic") {
      const engineInput = path.join(stageDir, "99-engine_input.json");
      await writeFile(engineInput, JSON.stringify({ "1.1": { value: 1, cls: "Measured" } }));
      artifacts.push({
        key: "engine_input",
        path: path.relative(root, engineInput).split(path.sep).join("/"),
        sha256: await fileHash(engineInput),
        media_type: "application/json",
      });
    }
    const stageManifest = path.join(stageDir, "stage-manifest.json");
    const snapshotSha256 = await fileHash(inputSnapshot);
    await writeFile(
      stageManifest,
      JSON.stringify({
        ...structuredClone(dammStageManifestFixture),
        artifacts,
        attempt: 1,
        workflow_id: DAR_WORKFLOW.workflow_id,
        workflow_version: DAR_WORKFLOW.workflow_version,
        run_id: workflow.id,
        stage_id: stage.id,
        ordinal: stage.ordinal,
        execution_mode: "handler",
        input_snapshot: {
          path: "inputs/input-snapshot.json",
          sha256: snapshotSha256,
        },
        input_hashes: {
          checkpoint_binding: null,
          input_snapshot: snapshotSha256,
          upstream_stage_manifests: {},
        },
        output_hashes: Object.fromEntries(
          artifacts.map((artifact) => [artifact.key, artifact.sha256]),
        ),
        source_inventory: [],
        quality_checks: dammStageManifestFixture.quality_checks,
        spend_usd: 0,
        status: "complete",
      }),
    );
    artifacts.push({
      key: "stage_manifest",
      path: path.relative(root, stageManifest).split(path.sep).join("/"),
      sha256: await fileHash(stageManifest),
      media_type: "application/json",
    });
    for (const artifact of artifacts) {
      if (
        typeof artifact.key !== "string" ||
        typeof artifact.path !== "string" ||
        typeof artifact.sha256 !== "string"
      ) {
        throw new Error(`Invalid fixture artifact for ${stage.id}`);
      }
      stageArtifactSources.set(`${stage.id}\0${artifact.key}`, {
        path: artifact.path,
        sha256: artifact.sha256,
      });
    }
    stageRecords.push({
      ordinal: stage.ordinal,
      id: stage.id,
      status: "complete",
      attempts: 1,
      artifacts,
    });
  }

  const exportRoot = path.join(root, "stages/08-export_package/artifacts");
  const groupRoots = {
    narratives: path.join(exportRoot, "narrative_exports/narratives"),
    structured: path.join(exportRoot, "structured_exports/structured"),
    "source-inventory": path.join(exportRoot, "source_inventory_exports/source-inventory"),
  };
  await Promise.all(
    Object.values(groupRoots).map((directory) => mkdir(directory, { recursive: true })),
  );

  const packagePaths = new Map<string, string>();
  const packageRecords = [] as Array<Record<string, unknown>>;
  const packageContents = new Map<string, Uint8Array>();
  const uploadManifestBytes = new Uint8Array(await readFile(uploadsManifest));
  const workflowContractBytes = new Uint8Array(
    await readFile(new URL("../../data/dar_workflow_v1.json", import.meta.url)),
  );
  const inputSnapshotBytes = new Uint8Array(await readFile(inputSnapshot));
  const packagedWorkflowBytes = new TextEncoder().encode(
    JSON.stringify({
      schema_version: "damm.workflow-run/v1",
      run_id: workflow.id,
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      contract_sha256: DAR_WORKFLOW_SHA256,
      country: workflow.countryName,
      iso3: workflow.iso3,
      status: "running",
      input_snapshot: {
        path: "inputs/input-snapshot.json",
        sha256: await fileHash(inputSnapshot),
      },
      uploads_manifest: uploadsRecord,
      stages: [
        ...stageRecords,
        { ordinal: 8, id: "export_package", status: "running", attempts: 1, artifacts: [] },
      ],
    }),
  );
  const packagedWorkflowSha256 = createHash("sha256").update(packagedWorkflowBytes).digest("hex");
  const boundPackageFiles = await Promise.all(
    packageFiles.map(async (file) => {
      if (file.category !== "workflow") return file;
      if (file.artifact_id === "workflow_contract") {
        return {
          ...file,
          content: workflowContractBytes,
          source_sha256: DAR_WORKFLOW_SHA256,
        };
      }
      if (file.artifact_id === "input_snapshot") {
        return {
          ...file,
          content: inputSnapshotBytes,
          source_sha256: await fileHash(inputSnapshot),
        };
      }
      if (file.artifact_id === "workflow_manifest") {
        return {
          ...file,
          content: packagedWorkflowBytes,
          source_sha256: packagedWorkflowSha256,
        };
      }
      return file;
    }),
  );
  for (const [index, file] of boundPackageFiles.entries()) {
    if (!file.stage_id || !file.artifact_id) continue;
    const source = stageArtifactSources.get(`${file.stage_id}\0${file.artifact_id}`);
    if (!source) continue;
    boundPackageFiles[index] = {
      ...file,
      source_sha256: source.sha256,
      ...(file.category === "narrative"
        ? {}
        : { content: new Uint8Array(await readFile(path.join(root, source.path))) }),
    };
  }
  const assessmentInputSource = stageArtifactSources.get("damm_diagnostic\0engine_input");
  if (!assessmentInputSource) throw new Error("Synthetic Stage 1 engine input source");
  const allPackageFiles: PackageFixtureFile[] = [
    ...boundPackageFiles,
    {
      path: "structured/01_damm_diagnostic/engine_input.json",
      category: "structured",
      stage_id: "damm_diagnostic",
      artifact_id: "engine_input",
      source_sha256: assessmentInputSource.sha256,
      content: new Uint8Array(await readFile(path.join(root, assessmentInputSource.path))),
    },
    {
      path: "inputs/uploads-manifest.json",
      category: "input",
      artifact_id: "uploads_manifest",
      source_sha256: uploadsRecord.sha256,
      content: uploadManifestBytes,
    },
    ...uploadDocuments.flatMap((document) => [
      {
        path: document.content_path as string,
        category: "input" as const,
        artifact_id: "upload_extracted_text",
        source_sha256: document.content_sha256 as string,
        input_id: document.id as string,
        input_kind: document.kind as string,
        content: new Uint8Array(readFileSync(path.join(root, document.content_path as string))),
      },
      {
        path: document.original_path as string,
        category: "input" as const,
        artifact_id: "upload_original",
        source_sha256: document.original_sha256 as string,
        input_id: document.id as string,
        input_kind: document.kind as string,
        content: new Uint8Array(readFileSync(path.join(root, document.original_path as string))),
      },
    ]),
  ];
  for (const file of allPackageFiles) {
    const [prefix, ...rest] = file.path.split("/");
    const group = groupRoots[prefix as keyof typeof groupRoots];
    const content =
      typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    packageContents.set(file.path, content);
    let digest = createHash("sha256").update(content).digest("hex");
    if (group && rest.length) {
      const filename = path.join(group, ...rest);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, content);
      packagePaths.set(file.path, filename);
      digest = await fileHash(filename);
    }
    packageRecords.push({
      path: file.path,
      sha256: digest,
      bytes: content.byteLength,
      category: file.category,
      ...(file.stage_id ? { stage_id: file.stage_id } : {}),
      ...(file.artifact_id ? { artifact_id: file.artifact_id } : {}),
      ...(file.source_sha256 ? { source_sha256: file.source_sha256 } : {}),
      ...(file.input_id ? { input_id: file.input_id } : {}),
      ...(file.input_kind ? { input_kind: file.input_kind } : {}),
    });
  }

  const packageManifest = path.join(exportRoot, "workflow_manifest/package-manifest.json");
  await mkdir(path.dirname(packageManifest), { recursive: true });
  const packageManifestBytes = Buffer.from(
    JSON.stringify({
      schema_version: "damm.dar-package/v1",
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      workflow_contract_sha256: DAR_WORKFLOW_SHA256,
      country: workflow.countryName,
      iso3: workflow.iso3,
      lifecycle_state: "draft",
      input_snapshot_sha256: await fileHash(inputSnapshot),
      workflow_manifest_sha256: packagedWorkflowSha256,
      upload_inputs: {
        schema_version: "damm.uploads-manifest/v1",
        manifest_path: uploadsRecord.path,
        manifest_sha256: uploadsRecord.sha256,
        document_count: uploadDocuments.length,
        documents: uploadDocuments.map((document) => ({
          id: document.id,
          kind: document.kind,
          content_path: document.content_path,
          content_sha256: document.content_sha256,
          original_path: document.original_path,
          original_sha256: document.original_sha256,
          original_size_bytes: document.original_size_bytes,
        })),
      },
      file_count: packageRecords.length,
      files: packageRecords,
    }),
  );
  await writeFile(packageManifest, packageManifestBytes);
  const bundle = path.join(exportRoot, "complete_bundle/EGY_exports_dar_package.zip");
  await mkdir(path.dirname(bundle), { recursive: true });
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const [relative, content] of packageContents) {
    zip.file(`fixture-package/${relative}`, content, { createFolders: false });
  }
  zip.file("fixture-package/package-manifest.json", packageManifestBytes, {
    createFolders: false,
  });
  await writeFile(bundle, await zip.generateAsync({ type: "uint8array" }));

  const stage8Manifest = path.join(root, "stages/08-export_package/stage-manifest.json");
  await mkdir(path.dirname(stage8Manifest), { recursive: true });
  const stage8Artifacts = [
    {
      key: "narrative_exports",
      path: path.relative(root, groupRoots.narratives).split(path.sep).join("/"),
      sha256: await directoryHash(groupRoots.narratives),
      media_type: "application/x-directory",
    },
    {
      key: "structured_exports",
      path: path.relative(root, groupRoots.structured).split(path.sep).join("/"),
      sha256: await directoryHash(groupRoots.structured),
      media_type: "application/x-directory",
    },
    {
      key: "source_inventory_exports",
      path: path.relative(root, groupRoots["source-inventory"]).split(path.sep).join("/"),
      sha256: await directoryHash(groupRoots["source-inventory"]),
      media_type: "application/x-directory",
    },
    {
      key: "workflow_manifest",
      path: path.relative(root, packageManifest).split(path.sep).join("/"),
      sha256: await fileHash(packageManifest),
      media_type: "application/json",
    },
    {
      key: "complete_bundle",
      path: path.relative(root, bundle).split(path.sep).join("/"),
      sha256: await fileHash(bundle),
      media_type: "application/zip",
    },
  ];
  await writeFile(
    stage8Manifest,
    JSON.stringify({
      ...structuredClone(dammStageManifestFixture),
      artifacts: stage8Artifacts,
      attempt: 1,
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      run_id: workflow.id,
      stage_id: "export_package",
      ordinal: 8,
      execution_mode: "handler",
      input_snapshot: {
        path: "inputs/input-snapshot.json",
        sha256: await fileHash(inputSnapshot),
      },
      input_hashes: {
        checkpoint_binding: null,
        input_snapshot: await fileHash(inputSnapshot),
        upstream_stage_manifests: {},
      },
      output_hashes: Object.fromEntries(
        stage8Artifacts.map((artifact) => [artifact.key, artifact.sha256]),
      ),
      source_inventory: [],
      quality_checks: dammStageManifestFixture.quality_checks,
      spend_usd: 0,
      status: "complete",
    }),
  );
  stage8Artifacts.push({
    key: "stage_manifest",
    path: path.relative(root, stage8Manifest).split(path.sep).join("/"),
    sha256: await fileHash(stage8Manifest),
    media_type: "application/json",
  });
  stageRecords.push({
    ordinal: 8,
    id: "export_package",
    status: "complete",
    attempts: 1,
    artifacts: stage8Artifacts,
  });

  await writeFile(
    path.join(root, "workflow-manifest.json"),
    JSON.stringify({
      schema_version: "damm.workflow-run/v1",
      run_id: workflow.id,
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      contract_sha256: DAR_WORKFLOW_SHA256,
      country: workflow.countryName,
      iso3: workflow.iso3,
      status: "complete",
      input_snapshot: {
        path: "inputs/input-snapshot.json",
        sha256: await fileHash(inputSnapshot),
      },
      uploads_manifest: uploadsRecord,
      stages: stageRecords,
    }),
  );
  await writeFile(path.join(root, "workflow-events.jsonl"), "");
  return { root, bundle, packagePaths };
}

function completePackageFixtureFiles(): PackageFixtureFile[] {
  const stageOrdinal = new Map<string, number>(
    DAR_WORKFLOW.stages.map((stage) => [stage.id, stage.ordinal]),
  );
  return artifactsFor("workflow").flatMap((artifact) => {
    const source = artifact.workflowSource;
    if (source?.kind !== "package") return [];
    const selector = source.selector;
    const stageFolder = selector.stageId
      ? `${String(stageOrdinal.get(selector.stageId)).padStart(2, "0")}_${selector.stageId}`
      : null;
    let relative: string;
    if (selector.groupArtifactKey === "narrative_exports" && stageFolder) {
      relative = `narratives/${stageFolder}/${selector.artifactId}.${selector.extension}`;
    } else if (selector.groupArtifactKey === "structured_exports" && stageFolder) {
      relative = `structured/${stageFolder}/${selector.artifactId}.${selector.extension}`;
    } else if (selector.groupArtifactKey === "source_inventory_exports") {
      relative = stageFolder
        ? `source-inventory/${stageFolder}/${selector.artifactId}.${selector.extension}`
        : `source-inventory/source_inventory.${selector.extension}`;
    } else {
      relative = `workflow/${selector.artifactId}.${selector.extension}`;
    }
    return [
      {
        path: relative,
        category: selector.category,
        content: `fixture:${artifact.key}`,
        ...(selector.stageId ? { stage_id: selector.stageId } : {}),
        ...(selector.artifactId ? { artifact_id: selector.artifactId } : {}),
      } as PackageFixtureFile,
    ];
  });
}

async function rebindStage8File(root: string, artifactKey: string): Promise<void> {
  const rootManifestPath = path.join(root, "workflow-manifest.json");
  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  const stage8 = rootManifest.stages[7];
  const artifact = stage8.artifacts.find(
    (candidate: { key: string }) => candidate.key === artifactKey,
  );
  assert.ok(artifact);
  artifact.sha256 = await fileHash(path.resolve(root, artifact.path));

  const stageManifestArtifact = stage8.artifacts.find(
    (candidate: { key: string }) => candidate.key === "stage_manifest",
  );
  assert.ok(stageManifestArtifact);
  const stageManifestPath = path.resolve(root, stageManifestArtifact.path);
  const stageManifest = JSON.parse(await readFile(stageManifestPath, "utf8"));
  stageManifest.output_hashes[artifactKey] = artifact.sha256;
  await writeFile(stageManifestPath, JSON.stringify(stageManifest));
  stageManifestArtifact.sha256 = await fileHash(stageManifestPath);
  await writeFile(rootManifestPath, JSON.stringify(rootManifest));
}

interface Stage8PackageIndexRecordFixture {
  path: string;
  sha256: string;
  bytes: number;
  category: string;
  stage_id?: string;
  artifact_id?: string;
  source_sha256?: string;
}

interface Stage8PackageArchiveRewrite {
  remove?: string[];
  replace?: Array<{ path: string; content: Uint8Array }>;
}

async function rewriteStage8PackageIndex(
  root: string,
  bundle: string,
  rewrite: (records: Stage8PackageIndexRecordFixture[]) => Stage8PackageArchiveRewrite | void,
): Promise<void> {
  const packageManifestPath = path.join(
    root,
    "stages/08-export_package/artifacts/workflow_manifest/package-manifest.json",
  );
  const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8")) as {
    file_count: number;
    files: Stage8PackageIndexRecordFixture[];
  };
  const archiveRewrite = rewrite(packageManifest.files);
  packageManifest.file_count = packageManifest.files.length;
  const packageManifestBytes = Buffer.from(JSON.stringify(packageManifest));
  await writeFile(packageManifestPath, packageManifestBytes);

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(bundle));
  for (const relativePath of archiveRewrite?.remove ?? []) {
    zip.remove(`fixture-package/${relativePath}`);
  }
  for (const replacement of archiveRewrite?.replace ?? []) {
    zip.file(`fixture-package/${replacement.path}`, replacement.content, {
      createFolders: false,
    });
  }
  zip.file("fixture-package/package-manifest.json", packageManifestBytes, {
    createFolders: false,
  });
  await writeFile(bundle, await zip.generateAsync({ type: "uint8array" }));

  await rebindStage8File(root, "workflow_manifest");
  await rebindStage8File(root, "complete_bundle");
}

function stage1EngineInputRecord(
  records: Stage8PackageIndexRecordFixture[],
): Stage8PackageIndexRecordFixture {
  const matches = records.filter(
    (record) => record.stage_id === "damm_diagnostic" && record.artifact_id === "engine_input",
  );
  assert.equal(matches.length, 1, "the fixture starts with one Stage 1 engine input record");
  return matches[0];
}

async function withStage8PackageIndexFixture(
  basename: string,
  exercise: (
    workflow: ClaimedRun,
    fixture: Awaited<ReturnType<typeof writeCompletedWorkflow>>,
  ) => Promise<void>,
): Promise<void> {
  const before = process.env.DAMM_PIPELINE_DIR;
  const temp = await mkdtemp(path.join(tmpdir(), `damm-package-index-${basename}-`));
  process.env.DAMM_PIPELINE_DIR = temp;
  try {
    const workflow = run({
      id: `package-index-${basename}`,
      pass: "workflow",
      vendor: null,
      outBasename: `EGY_package_index_${basename}`,
    });
    const fixture = await writeCompletedWorkflow(workflow, completePackageFixtureFiles());
    await exercise(workflow, fixture);
  } finally {
    if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
    else process.env.DAMM_PIPELINE_DIR = before;
    await rm(temp, { recursive: true, force: true });
  }
}

describe("where a pass's output lives", () => {
  it("tracks the stage-manifest shape emitted by the DAMM coordinator", () => {
    assert.equal(dammStageManifestFixture.schema_version, "damm.workflow-stage/v1");
    assert.ok(
      DAR_WORKFLOW.stage_manifest_required_fields.every((field) =>
        Object.prototype.hasOwnProperty.call(dammStageManifestFixture, field),
      ),
    );
    assert.equal(
      dammStageManifestFixture.quality_checks.every((check) => check.ok),
      true,
    );
  });

  const at = (pass: Run["pass"], key: string) =>
    artifactPath(run({ pass, outBasename: "EGY_x" }), key)!
      .path.split("/")
      .pop();

  it("addresses outputs off the bare basename, as the scripts write them", () => {
    // The pass-prefixed name is right for ledgers and checkpoints and wrong for outputs:
    // generate_dar.py writes EGY_x_dar.html, not EGY_x_generation_dar.html. Deriving one
    // from the other produced links that pointed at nothing.
    assert.equal(at("generation", "dar"), "EGY_x_dar.html");
    assert.equal(at("diagnostic", "diagnostic"), "EGY_x_diagnostic.html");
    assert.equal(at("diagnostic", "scored"), "EGY_x_v17.json");
    assert.equal(at("research", "input"), "EGY_x_input.json");
    assert.equal(at("g2", "input"), "EGY_x_automated_challenge_input.json");
    assert.equal(at("scans", "scans"), "EGY_x_scans.json");
    assert.equal(at("scans", "register"), "EGY_x_register.json");
    assert.equal(at("foresight", "foresight"), "EGY_x_foresight.html");
  });

  it("keeps checkpoints under the pass prefix, which is a different rule", () => {
    // Every pass writes its ledger and state under its own prefix. Both rules are real;
    // the bug was applying one of them to the other's files.
    assert.match(passFilePaths(run({ pass: "scans" })).state, /EGY_run1_scans_state\.json$/);
    assert.match(passFilePaths(run({ pass: "research" })).state, /EGY_run1_state\.json$/);
  });

  it("refuses a key the pass does not have", () => {
    assert.equal(artifactPath(run({ pass: "research" }), "dar"), null);
    assert.equal(artifactPath(run({ pass: "generation" }), "../../etc/passwd"), null);
  });

  it("resolves every workflow export through Stage 8's hash-bound package manifest", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-artifacts-test-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", outBasename: "EGY_exports" });
      const fixture = await writeCompletedWorkflow(workflow, [
        {
          path: "narratives/07_draft_dar/draft_dar_report.pdf",
          category: "narrative",
          stage_id: "draft_dar",
          artifact_id: "draft_dar_report",
          content: "pdf",
        },
        {
          path: "structured/07_draft_dar/dar_source_data.json",
          category: "structured",
          stage_id: "draft_dar",
          artifact_id: "dar_source_data",
          content: "{}",
        },
        {
          path: "source-inventory/source_inventory.xlsx",
          category: "source_inventory_consolidated",
          content: "xlsx",
        },
      ]);
      assert.equal(verifyWorkflowCompletion(workflow).ok, true);
      assert.equal(
        artifactPath(workflow, "draft-pdf")?.path,
        fixture.packagePaths.get("narratives/07_draft_dar/draft_dar_report.pdf"),
      );
      assert.equal(
        artifactPath(workflow, "dar-data-json")?.path,
        fixture.packagePaths.get("structured/07_draft_dar/dar_source_data.json"),
      );
      assert.equal(
        artifactPath(workflow, "sources-xlsx")?.path,
        fixture.packagePaths.get("source-inventory/source_inventory.xlsx"),
      );
      assert.equal(artifactPath(workflow, "bundle")?.path, fixture.bundle);
      assert.equal(
        artifactPath(workflow, "draft-docx"),
        null,
        "an unrecorded guessed filename is not served",
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects escaped paths and package files whose bytes no longer match the manifest", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-artifacts-escape-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", outBasename: "EGY_escape" });
      const fixture = await writeCompletedWorkflow(workflow, [
        {
          path: "narratives/07_draft_dar/draft_dar_report.pdf",
          category: "narrative",
          stage_id: "draft_dar",
          artifact_id: "draft_dar_report",
          content: "original",
        },
      ]);
      const draft = fixture.packagePaths.get("narratives/07_draft_dar/draft_dar_report.pdf")!;
      await writeFile(draft, "tampered");
      assert.equal(artifactPath(workflow, "draft-pdf"), null, "tampered bytes must not be served");

      const manifestPath = path.join(fixture.root, "workflow-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const stage8 = manifest.stages[7];
      stage8.artifacts.find(
        (artifact: { key: string }) => artifact.key === "narrative_exports",
      ).path = "../outside";
      await writeFile(manifestPath, JSON.stringify(manifest));
      assert.equal(artifactPath(workflow, "draft-pdf"), null);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects artifacts reached through an intermediate directory symlink outside the workspace", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-artifacts-symlink-escape-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", outBasename: "EGY_symlink_escape" });
      const fixture = await writeCompletedWorkflow(workflow, [
        {
          path: "narratives/07_draft_dar/draft_dar_report.pdf",
          category: "narrative",
          stage_id: "draft_dar",
          artifact_id: "draft_dar_report",
          content: "original",
        },
      ]);
      assert.equal(verifyWorkflowCompletion(workflow).ok, true);

      const internalGroup = path.join(
        fixture.root,
        "stages/08-export_package/artifacts/narrative_exports",
      );
      const externalGroup = path.join(temp, "outside-workflow-narrative-exports");
      await rename(internalGroup, externalGroup);
      await symlink(externalGroup, internalGroup, "dir");

      const rejected = verifyWorkflowCompletion(workflow);
      assert.equal(rejected.ok, false);
      assert.equal(artifactPath(workflow, "draft-pdf"), null);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects a workflow workspace root symlink before writes and completed reads", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workspace-root-symlink-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const loopRoot = path.join(temp, "gauntlet/loop-1");
      await mkdir(loopRoot, { recursive: true });
      const external = path.join(temp, "outside-loop-root");
      await mkdir(external);

      const unwritten = run({ pass: "workflow", outBasename: "EGY_unwritten_symlink" });
      await symlink(external, workflowRunDir(unwritten), "dir");
      await assert.rejects(writeWorkflowUploadSnapshot(unwritten, []), /workflow workspace/i);

      const completed = run({ pass: "workflow", outBasename: "EGY_completed_symlink" });
      const fixture = await writeCompletedWorkflow(completed, completePackageFixtureFiles());
      assert.equal(verifyWorkflowCompletion(completed).ok, true);
      const relocated = path.join(temp, "outside-loop-completed");
      await rename(fixture.root, relocated);
      await symlink(relocated, fixture.root, "dir");
      assert.equal(verifyWorkflowCompletion(completed).ok, false);
      assert.equal(artifactPath(completed, "bundle"), null);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked root workflow manifest at the point of use", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-root-manifest-symlink-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", outBasename: "EGY_manifest_symlink" });
      const fixture = await writeCompletedWorkflow(workflow, completePackageFixtureFiles());
      assert.equal(verifyWorkflowCompletion(workflow).ok, true);

      const manifestPath = path.join(fixture.root, "workflow-manifest.json");
      const externalManifest = path.join(temp, "outside-workflow-manifest.json");
      await rename(manifestPath, externalManifest);
      await symlink(externalManifest, manifestPath);
      assert.equal(verifyWorkflowCompletion(workflow).ok, false);
      assert.equal(artifactPath(workflow, "bundle"), null);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("binds the immutable ceiling and vendor to the queued database run", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workflow-identity-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({
        pass: "workflow",
        vendor: defaultVendorFor("workflow"),
        outBasename: "EGY_identity",
      });
      const fixture = await writeCompletedWorkflow(workflow, []);
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "the server-resolved public default is the value frozen by the coordinator",
      );
      const snapshotPath = path.join(fixture.root, "inputs/input-snapshot.json");
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
      snapshot.ceiling_usd = workflow.ceilingUsd + 1;
      await writeFile(snapshotPath, JSON.stringify(snapshot));
      const rootManifestPath = path.join(fixture.root, "workflow-manifest.json");
      const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
      rootManifest.input_snapshot.sha256 = await fileHash(snapshotPath);
      await writeFile(rootManifestPath, JSON.stringify(rootManifest));
      assert.equal(verifyWorkflowCompletion(workflow).ok, false);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects raw observations as a substitute for the scored G1 assessment input", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-workflow-engine-input-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", vendor: null, outBasename: "EGY_engine_input" });
      const fixture = await writeCompletedWorkflow(workflow, []);
      const rootManifestPath = path.join(fixture.root, "workflow-manifest.json");
      const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
      const stage1 = rootManifest.stages[0];
      const stageManifestBinding = stage1.artifacts.find(
        (artifact: { key: string }) => artifact.key === "stage_manifest",
      );
      assert.ok(stageManifestBinding);
      stage1.artifacts = stage1.artifacts.filter(
        (artifact: { key: string }) => artifact.key !== "engine_input",
      );

      const stageManifestPath = path.resolve(fixture.root, stageManifestBinding.path);
      const stageManifest = JSON.parse(await readFile(stageManifestPath, "utf8"));
      stageManifest.artifacts = stageManifest.artifacts.filter(
        (artifact: { key: string }) => artifact.key !== "engine_input",
      );
      delete stageManifest.output_hashes.engine_input;
      await writeFile(stageManifestPath, JSON.stringify(stageManifest));
      stageManifestBinding.sha256 = await fileHash(stageManifestPath);
      await writeFile(rootManifestPath, JSON.stringify(rootManifest));

      const verification = verifyWorkflowCompletion(workflow);
      assert.equal(verification.ok, false);
      if (!verification.ok) assert.match(verification.reason, /scored engine input/);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects a self-hashed stage record whose stage manifest omits required provenance", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-stage-manifest-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", vendor: null, outBasename: "EGY_stage" });
      const fixture = await writeCompletedWorkflow(workflow, []);
      const rootManifestPath = path.join(fixture.root, "workflow-manifest.json");
      const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
      const stage = rootManifest.stages[1];
      const binding = stage.artifacts.find(
        (artifact: { key: string }) => artifact.key === "stage_manifest",
      );
      const stageManifestPath = path.resolve(fixture.root, binding.path);
      const stageManifest = JSON.parse(await readFile(stageManifestPath, "utf8"));
      delete stageManifest.quality_checks;
      await writeFile(stageManifestPath, JSON.stringify(stageManifest));
      binding.sha256 = await fileHash(stageManifestPath);
      await writeFile(rootManifestPath, JSON.stringify(rootManifest));
      assert.equal(verifyWorkflowCompletion(workflow).ok, false);
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("publishes a Stage 8 package index with one hash-bound Stage 1 engine input", async () => {
    await withStage8PackageIndexFixture("accepted", async (workflow) => {
      assert.equal(verifyWorkflowCompletion(workflow).ok, true);
      const published = await collectWorkflowArtifacts(workflow);
      const assessmentInput = published.find((artifact) => artifact.key === "assessment-input");
      const packagedAssessmentInput = published.find(
        (artifact) => artifact.relativePath === "structured/01_damm_diagnostic/engine_input.json",
      );
      assert.ok(assessmentInput);
      assert.ok(packagedAssessmentInput);
      assert.equal(packagedAssessmentInput.sha256, assessmentInput.sha256);
    });
  });

  it("rejects a self-consistent Stage 8 package index missing its Stage 1 engine input", async () => {
    await withStage8PackageIndexFixture("missing", async (workflow, fixture) => {
      await rewriteStage8PackageIndex(fixture.root, fixture.bundle, (records) => {
        const engineInput = stage1EngineInputRecord(records);
        records.splice(records.indexOf(engineInput), 1);
        return { remove: [engineInput.path] };
      });
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "the eight-stage completion manifests remain valid after the package rewrite",
      );
      await assert.rejects(
        collectWorkflowArtifacts(workflow),
        /bundle does not match its package manifest/,
      );
    });
  });

  it("rejects a self-consistent Stage 8 package index with duplicate Stage 1 engine inputs", async () => {
    await withStage8PackageIndexFixture("duplicate", async (workflow, fixture) => {
      const engineInputPath = fixture.packagePaths.get(
        "structured/01_damm_diagnostic/engine_input.json",
      );
      assert.ok(engineInputPath);
      const engineInputContent = new Uint8Array(await readFile(engineInputPath));
      await rewriteStage8PackageIndex(fixture.root, fixture.bundle, (records) => {
        const engineInput = stage1EngineInputRecord(records);
        const duplicate = {
          ...engineInput,
          path: "structured/01_damm_diagnostic/engine_input-copy.json",
        };
        records.push(duplicate);
        return { replace: [{ path: duplicate.path, content: engineInputContent }] };
      });
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "the eight-stage completion manifests remain valid after the package rewrite",
      );
      await assert.rejects(
        collectWorkflowArtifacts(workflow),
        /bundle does not match its package manifest/,
      );
    });
  });

  it("rejects a self-consistent Stage 8 package index whose engine-input content hash drifted", async () => {
    await withStage8PackageIndexFixture("content-hash-drift", async (workflow, fixture) => {
      const driftedContent = new TextEncoder().encode(
        JSON.stringify({ "1.1": { value: 0, cls: "Measured" } }),
      );
      const driftedSha256 = createHash("sha256").update(driftedContent).digest("hex");
      await rewriteStage8PackageIndex(fixture.root, fixture.bundle, (records) => {
        const engineInput = stage1EngineInputRecord(records);
        engineInput.sha256 = driftedSha256;
        engineInput.bytes = driftedContent.byteLength;
        return { replace: [{ path: engineInput.path, content: driftedContent }] };
      });
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "the eight-stage completion manifests remain valid after the package rewrite",
      );
      await assert.rejects(
        collectWorkflowArtifacts(workflow),
        /bundle does not match its package manifest/,
      );
    });
  });

  it("rejects a self-consistent Stage 8 package index whose engine-input source hash drifted", async () => {
    await withStage8PackageIndexFixture("source-hash-drift", async (workflow, fixture) => {
      await rewriteStage8PackageIndex(fixture.root, fixture.bundle, (records) => {
        const engineInput = stage1EngineInputRecord(records);
        engineInput.source_sha256 = "0".repeat(64);
      });
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "the eight-stage completion manifests remain valid after the package rewrite",
      );
      await assert.rejects(
        collectWorkflowArtifacts(workflow),
        /bundle does not match its package manifest/,
      );
    });
  });

  it("publishes the exhaustive package and rejects an unmanifested ZIP payload", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-zip-exhaustive-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", vendor: null, outBasename: "EGY_zip" });
      const fixture = await writeCompletedWorkflow(workflow, completePackageFixtureFiles());
      const published = await collectWorkflowArtifacts(workflow);
      assert.ok(published.some((artifact) => artifact.key === "bundle"));
      const assessmentInput = published.find((artifact) => artifact.key === "assessment-input");
      assert.ok(assessmentInput);
      assert.match(assessmentInput.relativePath, /engine_input\.json$/);
      assert.ok(
        published.some((artifact) => artifact.relativePath === "inputs/uploads-manifest.json"),
      );
      assert.ok(published.some((artifact) => artifact.key === "canonical-model"));
      assert.ok(published.some((artifact) => artifact.key === "canonical-model-schema"));
      const census = published.find((artifact) => artifact.key === "canonical-indicator-census");
      assert.ok(census);
      assert.equal(JSON.parse(new TextDecoder().decode(census.content)).indicators.length, 57);
      assert.ok(published.some((artifact) => artifact.key === "model-export-manifest"));
      const methodology = published.find((artifact) => artifact.key === "methodology-manifest");
      assert.ok(methodology);
      const methodologyPayload = JSON.parse(new TextDecoder().decode(methodology.content));
      assert.equal(methodologyPayload.schema_version, "damm.run-methodology/v1");
      assert.equal(methodologyPayload.run_id, workflow.id);
      assert.equal(methodologyPayload.model.version, "1.7");
      assert.equal(methodologyPayload.model.revision, 2);
      assert.equal(methodologyPayload.model.ratified, false);
      assert.match(methodologyPayload.indicator_census.sha256, /^[a-f0-9]{64}$/);
      assert.equal(methodologyPayload.engine.version, "1.7");
      assert.equal(methodologyPayload.renderer.version, "1.7");
      assert.equal(methodologyPayload.assessment_input.sha256, methodology.assessmentInputSha256);
      assert.equal(methodologyPayload.assessment_input.sha256, assessmentInput.sha256);

      const artifactSetId = "worker-published-boundary-set";
      const boundary = await verifyStoredStage8Boundary(
        {
          runId: workflow.id,
          artifactSetId,
          pass: "workflow",
          status: "done",
          countryName: workflow.countryName,
          iso3: workflow.iso3,
          ceilingUsd: workflow.ceilingUsd,
          vendor: workflow.vendor,
          workflowId: DAR_WORKFLOW.workflow_id,
          workflowVersion: DAR_WORKFLOW.workflow_version,
          workflowContractSha256: DAR_WORKFLOW_SHA256,
        },
        published.map((artifact) => ({
          runId: workflow.id,
          artifactSetId,
          artifactKey: artifact.key,
          relativePath: artifact.relativePath,
          filename: artifact.filename,
          contentType: artifact.contentType,
          sha256: artifact.sha256,
          byteSize: artifact.content.byteLength,
          workflowId: DAR_WORKFLOW.workflow_id,
          workflowVersion: DAR_WORKFLOW.workflow_version,
          workflowContractSha256: DAR_WORKFLOW_SHA256,
          content: artifact.content,
        })),
      );
      assert.equal(boundary.bundleSha256, published.find((item) => item.key === "bundle")?.sha256);
      assert.equal(boundary.assessmentInputSha256, methodology.assessmentInputSha256);
      assert.equal(boundary.assessmentInputArtifactKey, "assessment-input");
      assert.equal(boundary.assessmentInputSourcePath, assessmentInput.relativePath);
      assert.deepEqual(boundary.assessmentInputContent, assessmentInput.content);

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await readFile(fixture.bundle));
      zip.file("fixture-package/unmanifested-secret.txt", "must not be published", {
        createFolders: false,
      });
      await writeFile(fixture.bundle, await zip.generateAsync({ type: "uint8array" }));
      await rebindStage8File(fixture.root, "complete_bundle");
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "the adversarial outer manifests are internally hash-consistent",
      );
      await assert.rejects(
        collectWorkflowArtifacts(workflow),
        /bundle does not match its package manifest/,
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects a self-consistent Stage 8 package that omits frozen upload originals", async () => {
    const before = process.env.DAMM_PIPELINE_DIR;
    const temp = await mkdtemp(path.join(tmpdir(), "damm-upload-package-binding-"));
    process.env.DAMM_PIPELINE_DIR = temp;
    try {
      const workflow = run({ pass: "workflow", vendor: null, outBasename: "EGY_upload_bind" });
      const fixture = await writeCompletedWorkflow(workflow, completePackageFixtureFiles(), [
        {
          id: "source-1",
          kind: "ai_documents",
          filename: "national-ai-strategy.pdf",
          original: new TextEncoder().encode("original binary fixture"),
          extracted: "AI strategy evidence.\n",
        },
      ]);
      assert.ok((await collectWorkflowArtifacts(workflow)).length > 0);

      const packageManifestPath = path.join(
        fixture.root,
        "stages/08-export_package/artifacts/workflow_manifest/package-manifest.json",
      );
      const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
      packageManifest.files = packageManifest.files.filter(
        (record: { category: string }) => record.category !== "input",
      );
      packageManifest.file_count = packageManifest.files.length;
      packageManifest.upload_inputs = null;
      await writeFile(packageManifestPath, JSON.stringify(packageManifest));
      await rebindStage8File(fixture.root, "workflow_manifest");
      assert.equal(
        verifyWorkflowCompletion(workflow).ok,
        true,
        "outer completion remains self-consistent before Stage 8 package verification",
      );
      await assert.rejects(
        collectWorkflowArtifacts(workflow),
        /bundle does not match its package manifest/,
      );
    } finally {
      if (before === undefined) delete process.env.DAMM_PIPELINE_DIR;
      else process.env.DAMM_PIPELINE_DIR = before;
      await rm(temp, { recursive: true, force: true });
    }
  });
});
