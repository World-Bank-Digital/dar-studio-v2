/**
 * Pipeline runs: the state machine, the claim rule, and the budget (G1, G2, G3).
 *
 * Everything here is pure. The SQL that persists it is thin by design, so the rules that
 * matter — when a run may be claimed, when it may stop, what it is allowed to spend — can
 * be tested without a database and cannot drift into a query.
 *
 * Three properties this file exists to guarantee:
 *
 *  - **Exhaustion is not failure.** A run that hits its budget stops, keeps what it has,
 *    and waits for a person to add more. A budget-induced gap that reads like a real one
 *    is how Nigeria's 21 phantom gaps happened, so the two states are kept apart all the
 *    way to the surface.
 *  - **A dead worker does not strand a run.** The claim is a lease with a heartbeat. A
 *    worker that dies leaves a stale claim, and the run becomes claimable again. The
 *    pipeline checkpoints per row, so retaking a claim resumes rather than restarts.
 *  - **The budget is not restated here.** `run_budget.json` is exported from the Python
 *    ledger that enforces it. Two copies of an allocation drift, and the app would then
 *    show a ceiling the pipeline does not apply.
 */
// Relative, not aliased: these modules are covered by node:test, which does not
// resolve the bundler's "@/" alias. The rest of the domain layer imports its JSON
// the same way.
import budget from "../../data/run_budget.json" with { type: "json" };

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "exhausted"
  | "failed"
  | "done"
  | "cancelled";

/** The pipeline's own budget passes. Named to match, so no translation is needed. */
export type RunPass = "research" | "g2" | "scans" | "foresight" | "generation";

export interface Run {
  id: string;
  userId: string;
  countryId: string | null;
  countryName: string;
  iso3: string;
  pass: RunPass;
  status: RunStatus;
  ceilingUsd: number;
  spentUsd: number;
  rowsTotal: number | null;
  rowsDone: number;
  vendor: string | null;
  outBasename: string;
  claimedBy: string | null;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  stoppedReason: string | null;
}

/**
 * How long a claim survives without a heartbeat before another worker may take it.
 * Generous on purpose: a single indicator can take three minutes of retrieval, and
 * reclaiming a run that is merely slow would have two workers spending the same budget.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** A run in one of these states is finished and will not move again on its own. */
export const TERMINAL: readonly RunStatus[] = ["done", "failed", "cancelled"];

/** A run in one of these states is stopped but can be continued by a person. */
export const RESUMABLE: readonly RunStatus[] = ["paused", "exhausted"];

export function isTerminal(s: RunStatus): boolean {
  return TERMINAL.includes(s);
}

export function isResumable(s: RunStatus): boolean {
  return RESUMABLE.includes(s);
}

// ---------------------------------------------------------------- budget

export const DEFAULT_CEILING_USD: number = budget.default_ceiling_usd;
const ALLOCATION = budget.allocation as Record<string, number>;

/** What this pass may spend of the country ceiling (decision G3). */
export function passCap(pass: RunPass, ceilingUsd: number): number {
  const share = ALLOCATION[pass];
  if (share === undefined) throw new Error(`no budget allocation for pass "${pass}"`);
  return round2(ceilingUsd * share);
}

export function remaining(run: Pick<Run, "pass" | "ceilingUsd" | "spentUsd">): number {
  return round2(passCap(run.pass, run.ceilingUsd) - run.spentUsd);
}

/**
 * The per-pass caps must exhaust the ceiling, or a country could spend past it by
 * running every pass to its own limit. Checked here rather than assumed, because the
 * allocation arrives from another repository.
 */
export function allocationExhaustsCeiling(): boolean {
  const country = Object.entries(ALLOCATION)
    .filter(([k]) => k !== "audition")
    .reduce((a, [, v]) => a + v, 0);
  return Math.abs(country - 1) < 1e-9;
}

// ---------------------------------------------------------------- transitions

export interface Transition {
  ok: boolean;
  /** Why not, in the words the surface should use. Empty when ok. */
  reason: string;
}

const OK: Transition = { ok: true, reason: "" };
const no = (reason: string): Transition => ({ ok: false, reason });

/**
 * Legal moves. Deliberately narrow: a status that cannot be reached by any listed
 * transition cannot be reached at all, and adding one is a decision rather than a typo.
 */
const MOVES: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["done", "failed", "exhausted", "paused", "cancelled", "queued"],
  paused: ["queued", "cancelled"],
  exhausted: ["queued", "cancelled"],
  failed: [],
  done: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): Transition {
  if (from === to) return no(`the run is already ${from}`);
  if (isTerminal(from)) return no(`a ${from} run is finished and cannot become ${to}`);
  return MOVES[from].includes(to) ? OK : no(`a ${from} run cannot become ${to}`);
}

/**
 * Continuing a stopped run. Exhaustion needs more budget than it has already spent —
 * re-queueing at the same ceiling would stop again immediately, which reads to an
 * operator as the button not working.
 */
export function canResume(
  run: Pick<Run, "status" | "pass" | "ceilingUsd" | "spentUsd">,
  newCeilingUsd?: number,
): Transition {
  if (!isResumable(run.status)) {
    return no(
      isTerminal(run.status)
        ? `a ${run.status} run is finished`
        : `only a paused or exhausted run can be resumed, and this one is ${run.status}`,
    );
  }
  if (run.status === "exhausted") {
    const ceiling = newCeilingUsd ?? run.ceilingUsd;
    if (passCap(run.pass, ceiling) <= run.spentUsd) {
      return no(
        `this pass has spent $${run.spentUsd.toFixed(2)} of its $${passCap(
          run.pass,
          ceiling,
        ).toFixed(2)} allocation. Raise the ceiling to continue.`,
      );
    }
  }
  return OK;
}

// ---------------------------------------------------------------- claiming

/**
 * A run is claimable when nothing holds it, or when whatever held it has stopped saying
 * so. `now` is passed in rather than read, so the lease is testable.
 */
export function isClaimable(
  run: Pick<Run, "status" | "heartbeatAt">,
  now: Date = new Date(),
): boolean {
  if (run.status === "queued") return true;
  if (run.status !== "running") return false;
  if (!run.heartbeatAt) return true;
  return now.getTime() - run.heartbeatAt.getTime() > CLAIM_LEASE_MS;
}

// ---------------------------------------------------------------- progress

export interface Progress {
  rowsDone: number;
  rowsTotal: number | null;
  /** Null while the total is unknown; never a fabricated 0 or 100. */
  fraction: number | null;
  spentUsd: number;
  capUsd: number;
  spentFraction: number;
  /** True once the pass is within a rounding cent of its allocation. */
  atCap: boolean;
}

export function progressOf(run: Run): Progress {
  const cap = passCap(run.pass, run.ceilingUsd);
  return {
    rowsDone: run.rowsDone,
    rowsTotal: run.rowsTotal,
    fraction:
      run.rowsTotal && run.rowsTotal > 0
        ? Math.min(1, run.rowsDone / run.rowsTotal)
        : null,
    spentUsd: run.spentUsd,
    capUsd: cap,
    spentFraction: cap > 0 ? Math.min(1, run.spentUsd / cap) : 0,
    atCap: cap - run.spentUsd <= 0.01,
  };
}

/**
 * What an operator should be told about a stopped run. Exhaustion reads as an unfinished
 * job with a decision attached, never as an error, and never as a completed one.
 */
export function stoppedSummary(run: Run): string {
  const got =
    run.rowsTotal != null ? `${run.rowsDone} of ${run.rowsTotal} rows` : `${run.rowsDone} rows`;
  switch (run.status) {
    case "exhausted":
      return `Stopped on budget after ${got}, having spent $${run.spentUsd.toFixed(
        2,
      )} of $${passCap(run.pass, run.ceilingUsd).toFixed(2)}. The rows it did not reach are absent, not recorded as gaps. Add budget to continue.`;
    case "failed":
      return `Failed after ${got}. ${run.stoppedReason ?? "No reason was recorded."}`;
    case "paused":
      return `Paused after ${got}. It will continue from where it stopped.`;
    case "cancelled":
      return `Cancelled after ${got}.`;
    case "done":
      return `Finished ${got} for $${run.spentUsd.toFixed(2)}.`;
    default:
      return `${got} so far.`;
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
