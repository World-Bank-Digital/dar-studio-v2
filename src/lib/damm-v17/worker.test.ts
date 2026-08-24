import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  argsFor,
  drain,
  runOne,
  type RowProgress,
  type RunStore,
  type SpawnedProcess,
  type WorkerDeps,
} from "./worker.ts";
import type { Run } from "./runs.ts";

function run(over: Partial<Run> = {}): Run {
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
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    stoppedReason: null,
    ...over,
  };
}

describe("how the worker invokes the pipeline", () => {
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

  it("calls the second review with --run, which is a different flag for the same name", () => {
    // gate2.py takes --run because it reads an existing pass rather than naming a new
    // one. Passing --out there is silently accepted by argparse as unknown and the
    // review would read the wrong basename.
    const { script, args } = argsFor(run({ pass: "g2" }));
    assert.match(script, /gate2\.py$/);
    assert.equal(args[args.indexOf("--run") + 1], "EGY_run1");
    assert.ok(!args.includes("--out"));
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
});

// ---------------------------------------------------------------------------
// Following a run to its end.
// ---------------------------------------------------------------------------

/** A store that records what it was told rather than writing it anywhere. */
function fakeStore(queue: Run[] = []) {
  const calls = {
    rowsTotal: [] as Array<[number, string | null]>,
    rows: [] as RowProgress[],
    notes: [] as string[],
    finished: [] as Array<{ status: string; reason: string; spentUsd?: number }>,
    claims: 0,
    heartbeats: 0,
  };
  let claimHeld = true;
  const store: RunStore = {
    async claimNextRun() {
      calls.claims++;
      return queue.shift() ?? null;
    },
    async setRowsTotal(_id, n, v) {
      calls.rowsTotal.push([n, v]);
    },
    async recordRow(_id, e) {
      calls.rows.push(e);
    },
    async noteEvent(_id, _kind, message) {
      calls.notes.push(message);
    },
    async heartbeat() {
      calls.heartbeats++;
      return claimHeld;
    },
    async finishRun(_id, status, reason, spentUsd) {
      calls.finished.push({ status, reason, spentUsd });
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

function deps(
  store: RunStore,
  proc: SpawnedProcess,
  ledger: number | null = null,
): WorkerDeps {
  return {
    store,
    spawnPipeline: () => proc,
    readLedger: async () => ledger,
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
});
