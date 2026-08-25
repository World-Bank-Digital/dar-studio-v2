/**
 * The durable worker (design decision G1).
 *
 * It claims a run, spawns the pipeline, follows it, and records where it got to. The
 * pipeline is always invoked with `--resume`, which is what makes the whole arrangement
 * durable: the Python side checkpoints after every row, so a worker that dies at
 * indicator 50 of 57 is replaced by one that starts at 51. Nothing here needs to know
 * what an indicator is.
 *
 * Two rules this file exists to keep.
 *
 * **The ledger is the source of record for money.** Stdout is followed for liveness, but
 * the spend written to the run when it ends is read from the pipeline's own
 * `<out>_spend.json`. If the console format ever changes, the progress bar goes quiet
 * and the accounting stays right.
 *
 * **A stopped run says why.** Exhaustion, an unresearched remainder and a crash are three
 * different endings with three different remedies, and each is recorded as itself rather
 * than as a generic failure.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseChunk, statusOnExit, type RunEvent } from "./run-output.ts";
import type { Run, RunPass, RunStatus } from "./runs.ts";

/**
 * Where the pipeline lives. It is a separate repository, so the path is configuration
 * rather than a constant — hard-coding one developer's directory is how a worker becomes
 * undeployable.
 */
export function pipelineDir(): string {
  return process.env.DAMM_PIPELINE_DIR ?? path.join(process.env.HOME ?? "", "DAR/Claude/DAMM");
}

/** The pipeline needs its own virtualenv: the vendor SDKs are not in system Python. */
export function pipelinePython(): string {
  return process.env.DAMM_PIPELINE_PYTHON ?? path.join(pipelineDir(), ".venv/bin/python");
}

/** Read on each call rather than captured at import, so configuration is configuration. */
function scriptDir(): string {
  return path.join(pipelineDir(), "gauntlet/loop-1/research_pipeline");
}

const HEARTBEAT_MS = 30_000;

/** What a completed row contributes to the run record. */
export interface RowProgress {
  indicatorId: string;
  rowsDone: number;
  rowsTotal: number;
  spentUsd: number;
  outcome: string;
}

export interface SpawnedProcess {
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  wait(): Promise<number | null>;
  kill(): void;
}

/**
 * The writes a run makes as it goes.
 *
 * Narrowed to an interface, and imported lazily in `dbStore()`, because `run-store.ts`
 * reaches `db.ts`, which opens PGLite the moment it is imported in Node. Following a run
 * is the part of this file most worth testing — a misrecorded ending is what turns a
 * stopped assessment into an apparently finished one — and it should not need a database
 * to check how a line of output was handled.
 */
export interface RunStore {
  claimNextRun(workerId: string): Promise<Run | null>;
  setRowsTotal(runId: string, rowsTotal: number, vendor: string | null): Promise<void>;
  recordRow(runId: string, e: RowProgress): Promise<void>;
  noteEvent(runId: string, kind: string, message: string): Promise<void>;
  heartbeat(runId: string, workerId: string): Promise<boolean>;
  finishRun(runId: string, status: RunStatus, reason: string, spentUsd?: number): Promise<void>;
}

/** The real store, loaded on first use rather than at import. */
export function dbStore(): RunStore {
  const store = () => import("./run-store.ts");
  return {
    claimNextRun: (w) => store().then((m) => m.claimNextRun(w)),
    setRowsTotal: (id, n, v) => store().then((m) => m.setRowsTotal(id, n, v)),
    recordRow: (id, e) => store().then((m) => m.recordRow(id, e)),
    noteEvent: (id, k, msg) => store().then((m) => m.noteEvent(id, k, msg)),
    heartbeat: (id, w) => store().then((m) => m.heartbeat(id, w)),
    finishRun: (id, s, r, spent) => store().then((m) => m.finishRun(id, s, r, spent)),
  };
}

/** Injected so the loop can be exercised without launching Python or a database. */
export interface WorkerDeps {
  spawnPipeline(run: Run): SpawnedProcess;
  readLedger(run: Run): Promise<number | null>;
  store: RunStore;
  /** Overridden in tests; a run that takes minutes should not be watched by the second. */
  heartbeatMs?: number;
}

export function argsFor(run: Run): { script: string; args: string[] } {
  const dir = scriptDir();
  // Exhaustive on purpose. A pass with no entry here must not fall through to the
  // research orchestrator: that would run a full 57-row research pass under another
  // pass's name and bill it to that pass's allocation.
  const SCRIPTS: Partial<Record<RunPass, string>> = {
    research: "research_orchestrator.py",
    g2: "gate2.py",
    scans: "scans.py",
    foresight: "foresight.py",
    generation: "generate_dar.py",
    diagnostic: "diagnostic.py",
  };
  const script = SCRIPTS[run.pass];
  if (!script) throw new Error(`No script implements the ${run.pass} pass.`);

  // gate2.py takes --run because it reads an existing pass rather than naming a new one.
  // Passing --out there is accepted by argparse as unknown and the review reads the
  // wrong basename.
  const nameFlag = run.pass === "g2" ? "--run" : "--out";
  return {
    script: path.join(dir, script),
    args: [
      "--country", run.countryName,
      "--iso", run.iso3,
      nameFlag, run.outBasename,
      "--ceiling", String(run.ceilingUsd),
      ...(run.vendor ? ["--vendor", run.vendor] : []),
      // Always resume. On a first run there is no state file and it starts from zero;
      // on a retaken claim it continues. One code path, no decision to get wrong.
      "--resume",
    ],
  };
}

export function defaultDeps(): WorkerDeps {
  return {
    store: dbStore(),
    spawnPipeline(run) {
      const { script, args } = argsFor(run);
      const child = spawn(pipelinePython(), ["-u", script, ...args], {
        cwd: scriptDir(),
        env: { ...process.env },
      });
      let onErr: (chunk: string) => void = () => {};
      return {
        onStdout: (cb) => child.stdout?.on("data", (d) => cb(String(d))),
        onStderr: (cb) => {
          onErr = cb;
          child.stderr?.on("data", (d) => cb(String(d)));
        },
        wait: () =>
          new Promise((resolve) => {
            // A process that cannot be started at all emits 'error', and 'close' is not
            // guaranteed to follow. Waiting only on 'close' would leave the worker holding
            // the claim until its lease expired, with the run showing as running the whole
            // time — a missing interpreter would look like a pipeline that never answers.
            let settled = false;
            const settle = (code: number | null) => {
              if (settled) return;
              settled = true;
              resolve(code);
            };
            child.on("close", settle);
            child.on("error", (err: Error) => {
              onErr(`OSError: the pipeline could not be started — ${err.message}\n`);
              settle(null);
            });
          }),
        kill: () => child.kill("SIGTERM"),
      };
    },
    async readLedger(run) {
      // The pipeline writes its ledger beside the assessment, in gauntlet/loop-1.
      const p = path.join(pipelineDir(), "gauntlet/loop-1", `${ledgerName(run)}_spend.json`);
      try {
        const j = JSON.parse(await readFile(p, "utf8"));
        const total = j?.summary?.total;
        return typeof total === "number" ? total : null;
      } catch {
        // A missing ledger is normal when a run dies before its first checkpoint. The
        // stdout figure stands rather than being overwritten with a guess.
        return null;
      }
    },
  };
}

/**
 * Where a pass leaves the rows it produced, in the order they should be trusted.
 *
 * `_input.json` is the engine input and only exists for a pass that reached every row —
 * the pipeline deliberately refuses to write it otherwise, because a partial input would
 * score as though the missing rows had been looked for and not found.
 *
 * `_state.json` is the per-row checkpoint, written after every row. It is what a partial
 * pass leaves behind, and reading it is how the rows an exhausted pass already paid for
 * can be imported without inventing the ones it never reached.
 */
export function passFilePaths(run: Run): { input: string; state: string } {
  const dir = path.join(pipelineDir(), "gauntlet/loop-1");
  return {
    input: path.join(dir, `${ledgerName(run)}_input.json`),
    state: path.join(dir, `${ledgerName(run)}_state.json`),
  };
}

/**
 * What a pass leaves behind that a person would want to read.
 *
 * A closed list, keyed by pass. Artifacts are addressed by key and the path is built
 * here from the run's own basename — a route that took a filename from the caller would
 * be a path-traversal hole reading anything the worker's user can read.
 */
export interface Artifact {
  key: string;
  label: string;
  filename: string;
  contentType: string;
}

const ARTIFACTS: Record<RunPass, Artifact[]> = {
  research: [
    { key: "input", label: "Engine input", filename: "_input.json", contentType: "application/json" },
    { key: "trail", label: "Research trail", filename: "_research.json", contentType: "application/json" },
  ],
  g2: [
    { key: "input", label: "Reviewed engine input", filename: "_input.json", contentType: "application/json" },
    { key: "findings", label: "Review findings", filename: "_findings.json", contentType: "application/json" },
  ],
  scans: [
    { key: "scans", label: "Scan findings", filename: ".json", contentType: "application/json" },
  ],
  foresight: [
    { key: "foresight", label: "Foresight report", filename: ".html", contentType: "text/html; charset=utf-8" },
    { key: "foresight-json", label: "Scenarios and milestones", filename: ".json", contentType: "application/json" },
  ],
  generation: [
    { key: "dar", label: "Draft roadmap", filename: "_dar.html", contentType: "text/html; charset=utf-8" },
    { key: "dar-json", label: "Roadmap source", filename: "_dar.json", contentType: "application/json" },
  ],
  diagnostic: [
    { key: "diagnostic", label: "Diagnostic report", filename: "_diagnostic.html", contentType: "text/html; charset=utf-8" },
    { key: "scored", label: "Scored assessment", filename: "_v17.json", contentType: "application/json" },
  ],
};

export function artifactsFor(pass: RunPass): Artifact[] {
  return ARTIFACTS[pass] ?? [];
}

/** The absolute path of one artifact, or null when the key is not one this pass has. */
export function artifactPath(run: Run, key: string): { path: string; artifact: Artifact } | null {
  const artifact = artifactsFor(run.pass).find((x) => x.key === key);
  if (!artifact) return null;
  return {
    artifact,
    path: path.join(pipelineDir(), "gauntlet/loop-1", `${ledgerName(run)}${artifact.filename}`),
  };
}

export interface PassOutput {
  rows: Record<string, Record<string, unknown>>;
  /** Which file it came from — a partial pass is read from its checkpoint. */
  from: "input" | "state";
  complete: boolean;
}

export async function readPassRows(run: Run): Promise<PassOutput | null> {
  const { input, state } = passFilePaths(run);
  try {
    return { rows: JSON.parse(await readFile(input, "utf8")), from: "input", complete: true };
  } catch {
    // No engine input. For a research pass the checkpoint still holds the rows it reached.
  }
  if (run.pass !== "research") return null;
  try {
    const parsed = JSON.parse(await readFile(state, "utf8"));
    const rows = parsed?.rows;
    if (!rows || typeof rows !== "object") return null;
    return { rows, from: "state", complete: false };
  } catch {
    return null;
  }
}

/**
 * The prefix a pass's own files carry. Research writes under the bare basename and every
 * later pass suffixes it with its own name, so one assessment's files group together and
 * no two passes can overwrite each other's ledger.
 */
function ledgerName(run: Run): string {
  return run.pass === "research" ? run.outBasename : `${run.outBasename}_${run.pass}`;
}

/** What to record about vendors that were unavailable during a run. */
export function degradationNotes(
  degraded: Map<string, { rows: Set<string>; example: string }>,
  rowsTotal: number | null,
): string[] {
  const out: string[] = [];
  for (const [vendor, { rows, example }] of degraded) {
    const scope =
      rowsTotal && rows.size >= rowsTotal
        ? "every row"
        : `${rows.size} row${rows.size === 1 ? "" : "s"}${rowsTotal ? ` of ${rowsTotal}` : ""}`;
    out.push(
      `${vendor} was unavailable for ${scope}, so those rows were researched without it: ${example}`,
    );
  }
  return out;
}

/** Follow one claimed run to its end. Returns the status it settled on. */
export async function runOne(run: Run, workerId: string, deps: WorkerDeps): Promise<string> {
  const seen = { exhausted: false, incomplete: false, finished: false, failure: null as string | null };
  // Which vendors went missing, and on how many rows. A pass that lost its discovery peer
  // on every row gathered its evidence on a narrower base than the method describes, and
  // that has to reach the run record rather than living only in the pipeline's own files.
  const degraded = new Map<string, { rows: Set<string>; example: string }>();
  const proc = deps.spawnPipeline(run);

  // Stdout arrives in arbitrary chunks, so a line can be split across two of them.
  // Buffering to newline is what stops half a row being parsed as a whole one.
  let buf = "";
  const pump = (chunk: string, isErr: boolean) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    void handle(parseChunk(lines.join("\n")), isErr);
  };

  const pending: Promise<unknown>[] = [];
  const handle = (events: RunEvent[], isErr: boolean) => {
    for (const e of events) {
      switch (e.kind) {
        case "start":
          pending.push(deps.store.setRowsTotal(run.id, e.rowsTotal, e.vendor));
          break;
        case "row":
          pending.push(deps.store.recordRow(run.id, e));
          break;
        case "exhausted":
          seen.exhausted = true;
          pending.push(deps.store.noteEvent(run.id, "note", e.message));
          break;
        case "incomplete":
          seen.incomplete = true;
          pending.push(deps.store.noteEvent(run.id, "note", e.message));
          break;
        case "finished":
          seen.finished = true;
          pending.push(deps.store.noteEvent(run.id, "note", e.message));
          break;
        case "degraded": {
          const entry = degraded.get(e.vendor) ?? { rows: new Set<string>(), example: e.message };
          entry.rows.add(e.indicatorId);
          degraded.set(e.vendor, entry);
          break;
        }
        case "failed":
          // Only stderr counts as a failure signal: the word "Error" can legitimately
          // appear in a search trail on stdout.
          if (isErr) seen.failure = e.message;
          break;
      }
    }
  };

  proc.onStdout((c) => pump(c, false));
  proc.onStderr((c) => pump(c, true));

  const beat = setInterval(() => {
    void deps.store.heartbeat(run.id, workerId).then((held) => {
      // The claim was taken, which means this worker was presumed dead. Stop rather
      // than run alongside whatever took over and spend the budget twice.
      if (!held) proc.kill();
    });
  }, deps.heartbeatMs ?? HEARTBEAT_MS);

  let code: number | null = null;
  try {
    code = await proc.wait();
  } finally {
    clearInterval(beat);
  }

  if (buf.trim()) handle(parseChunk(buf), false);
  await Promise.allSettled(pending);

  const { status, reason } = statusOnExit(code, seen);
  const notes = degradationNotes(degraded, run.rowsTotal);
  for (const note of notes) await deps.store.noteEvent(run.id, "degraded", note);

  const ledger = await deps.readLedger(run);
  // Carried on a finished run too. "Finished 59 of 59 rows" with a vendor down for every
  // one of them is the shape of a clean success that was not one.
  const full = [reason, ...notes].filter(Boolean).join(" ");
  await deps.store.finishRun(run.id, status, full, ledger ?? undefined);
  return status;
}

/**
 * Claim and run until nothing is queued. Returns how many runs it handled, so a caller
 * can decide whether to wait before asking again.
 */
export async function drain(workerId: string, deps: WorkerDeps = defaultDeps()): Promise<number> {
  let handled = 0;
  for (;;) {
    const run = await deps.store.claimNextRun(workerId);
    if (!run) return handled;
    handled++;
    try {
      await runOne(run, workerId, deps);
    } catch (err) {
      // A throw here is the worker's own fault rather than the pipeline's, and leaving
      // the run marked running would strand it until the lease expired.
      await deps.store.finishRun(run.id, "failed", `The worker failed: ${String(err)}`);
    }
  }
}
