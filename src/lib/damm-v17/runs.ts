/**
 * Pipeline runs: the state machine, the claim rule, and the budget (G1, G2, G3).
 *
 * Everything here is pure. The SQL that persists it is thin by design, so the rules that
 * matter — when a run may be claimed, when it may stop, what it is allowed to spend — can
 * be tested without a database and cannot drift into a query.
 *
 * Three properties this file exists to guarantee:
 *
 *  - **Legacy-pass exhaustion is not failure.** A legacy pass that hits its allocation
 *    keeps what it has instead of inventing gaps. The canonical workflow instead performs
 *    bounded retries and settles terminally, so it never waits for a human top-up.
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
import vendors from "../../data/run_vendors.json" with { type: "json" };

export type RunStatus =
  "queued" | "running" | "paused" | "exhausted" | "failed" | "done" | "cancelled";

/** The pipeline's own budget passes. Named to match, so no translation is needed. */
export type RunPass =
  "workflow" | "research" | "g2" | "scans" | "foresight" | "generation" | "diagnostic";

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

/** Internal lease capability. Never serialize this token to a product surface. */
export interface ClaimedRun extends Run {
  claimToken: string;
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

// ---------------------------------------------------------------- vendors

/**
 * The passes a script implements.
 *
 * The allocation names five because it reserves each one's share of the ceiling. Only
 * these are built, and the distinction matters at the point of starting a run: a pass
 * with no script would fall through to the research orchestrator and spend a full
 * research budget under another pass's name.
 */
const LEDGER_PASS_BY_RUN_PASS: Record<Exclude<RunPass, "workflow">, string> = {
  research: "research",
  g2: "g2",
  // The retained admin `scans.py` surface is the international-lessons stage in the
  // canonical DAMM ledger. Keep the DB/API alias while charging the exported key.
  scans: "international_lessons",
  foresight: "foresight",
  generation: "generation",
  diagnostic: "diagnostic",
};
const LEGACY_RUNNABLE_PASSES = (
  Object.keys(LEDGER_PASS_BY_RUN_PASS) as Array<Exclude<RunPass, "workflow">>
).filter((pass) => vendors.runnable_passes.includes(LEDGER_PASS_BY_RUN_PASS[pass]));

/**
 * The public product launches the coordinator. The legacy passes remain runnable for
 * recovery and administration, but they are implementation details of one DAR run.
 */
export const PUBLIC_RUN_PASSES = ["workflow"] as const satisfies readonly RunPass[];
export const RUNNABLE_PASSES: RunPass[] = ["workflow", ...LEGACY_RUNNABLE_PASSES];

export function isPublicRunPass(pass: RunPass): pass is (typeof PUBLIC_RUN_PASSES)[number] {
  return PUBLIC_RUN_PASSES.includes(pass as (typeof PUBLIC_RUN_PASSES)[number]);
}

/**
 * Whether a pass produces rows for the evidence base.
 *
 * Research and the second review do. The scans gather what the instrument does not
 * measure, foresight produces milestones, and generation produces a document — none of
 * them score an indicator, and offering to import one into the evidence base would
 * suggest they might.
 */
export function producesEvidence(pass: RunPass): boolean {
  return pass === "research" || pass === "g2";
}

export function isRunnable(pass: RunPass): boolean {
  return RUNNABLE_PASSES.includes(pass);
}

/** vendor/model pairs the pipeline can resolve, in its own preference order. */
export const VENDOR_CHOICES: string[] = Object.entries(vendors.families).flatMap(
  ([family, models]) => (models as string[]).map((m) => `${family}/${m}`),
);

/** The vendor a pass uses when none is named. Read from the pipeline, never restated. */
export function defaultVendorFor(pass: RunPass): string | null {
  if (pass === "workflow") {
    // run_workflow.py uses the country-research default when --vendor is absent. Resolve
    // it here and pass it explicitly so the DB row and immutable input snapshot agree.
    return (
      (vendors.pass_defaults as Record<string, string | null>).country_research ??
      (vendors.pass_defaults as Record<string, string | null>).research ??
      null
    );
  }
  return (
    (vendors.pass_defaults as Record<string, string | null>)[LEDGER_PASS_BY_RUN_PASS[pass]] ?? null
  );
}

/**
 * Whether a pass calls a vendor at all.
 *
 * The diagnostic renders an assessment that has already been paid for. Its allocation is
 * zero, which a spend bar would render as "at its allocation" the moment it started —
 * a pass that costs nothing must not look like one that has run out.
 */
export function callsAVendor(pass: RunPass): boolean {
  return passCap(pass, 100) > 0;
}

export function vendorFamily(vendor: string | null): string | null {
  if (!vendor) return null;
  const family = vendor.split("/")[0].trim();
  return family || null;
}

/**
 * Whether a reviewer may review this pass.
 *
 * The second review exists to be a peer, and the audition showed a vendor's own siblings
 * abstaining in the same places — so a model reviewing its own pass upholds it and the
 * review reports a clean bill it never earned. Families are compared after defaults are
 * resolved, because the trap is the unnamed case: research on openai and a G2 left at its
 * default is the same family, and nothing on screen would say so.
 */
export function canReview(
  researchVendor: string | null,
  reviewerVendor: string | null,
): Transition {
  const primary = vendorFamily(researchVendor ?? defaultVendorFor("research"));
  const reviewer = vendorFamily(reviewerVendor ?? defaultVendorFor("g2"));
  if (!primary || !reviewer) return OK;
  if (primary !== reviewer) return OK;
  return no(
    `the research pass was run on ${primary} and a second review on ${reviewer} would be ` +
      `that vendor reviewing its own work. Choose a reviewer from another vendor.`,
  );
}

/** Holding a place in the queue: not finished, and not startable again. */
export const ACTIVE: readonly RunStatus[] = ["queued", "running", "paused"];

export function isActive(s: RunStatus): boolean {
  return ACTIVE.includes(s);
}

/**
 * The output basename a pass writes under.
 *
 * A research pass mints one. A second review does not: `gate2.py` takes `--run` and reads
 * an existing pass's files, so a G2 run that minted its own name would review nothing and
 * report a clean review of it. Every later pass inherits the research basename, which is
 * why this returns null when there is none to inherit — the caller has to refuse rather
 * than invent one.
 *
 * `token` is what makes a minted name unique, and it is not decoration. The basename is
 * what the pipeline checkpoints under, and it is always invoked with `--resume`. A name
 * derived from the clock alone collides with any run started in the same minute, and the
 * second run resumes the first one's completed state: it finishes at once, reports every
 * row done, and claims a spend it never made. A run must never inherit another's
 * checkpoint. Continuing a stopped run is what the same run's own basename is for.
 */
export function basenameFor(
  pass: RunPass,
  iso3: string,
  at: Date,
  researchBasename: string | null,
  token: string,
): string | null {
  if (pass === "research" || pass === "workflow") {
    const stamp = at.toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return `${iso3.toUpperCase()}_${stamp}_${token}`;
  }
  return researchBasename;
}

export function isResumable(s: RunStatus): boolean {
  return RESUMABLE.includes(s);
}

// ---------------------------------------------------------------- budget

export const DEFAULT_CEILING_USD: number = budget.default_ceiling_usd;
const ALLOCATION = budget.allocation as Record<string, number>;

/** What this pass may spend of the country ceiling (decision G3). */
export function passCap(pass: RunPass, ceilingUsd: number): number {
  // The coordinator owns the whole preauthorized ceiling and enforces the contract's
  // protected stage allocations within it. Applying one legacy pass share to the outer
  // workflow would recreate the human top-up gates the canonical workflow removes.
  if (pass === "workflow") return round2(ceilingUsd);
  const share = ALLOCATION[LEDGER_PASS_BY_RUN_PASS[pass]];
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
  if (run.pass === "workflow") {
    return no(
      "a canonical workflow retries within its preauthorized ceiling and settles as complete or failed; it never waits for an operator to resume or top it up",
    );
  }
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
    fraction: run.rowsTotal && run.rowsTotal > 0 ? Math.min(1, run.rowsDone / run.rowsTotal) : null,
    spentUsd: run.spentUsd,
    capUsd: cap,
    spentFraction: cap > 0 ? Math.min(1, run.spentUsd / cap) : 0,
    atCap: cap - run.spentUsd <= 0.01,
  };
}

/**
 * A stated allowance on top of the observed rate.
 *
 * The rate is computed over rows that finished, and those are systematically the cheaper
 * ones: a row that resolves on the first retrieval costs less than one that ends as a gap
 * after exhausting its sources. So the bare projection is a lower bound, and topping up to
 * exactly it invites a second exhaustion a few rows from the end. The allowance is stated
 * on screen rather than folded in silently, because it is a judgement and not a measurement.
 */
export const RATE_ALLOWANCE = 0.2;

export interface Projection {
  costPerRow: number;
  rowsRemaining: number;
  /** What the pass looks likely to cost in total, at the rate observed so far. */
  projectedPassCost: number;
  /** A country ceiling that would give this pass that much, with the allowance. */
  suggestedCeilingUsd: number;
}

/**
 * What finishing this pass looks likely to need, at the rate it has run at.
 *
 * Null when there is no basis — no rows done, or no row total yet. An operator with no
 * basis should be told there is none, not shown a number derived from nothing.
 */
export function projectToFinish(
  run: Pick<Run, "pass" | "ceilingUsd" | "spentUsd" | "rowsDone" | "rowsTotal">,
): Projection | null {
  if (!run.rowsTotal || run.rowsDone <= 0 || run.spentUsd <= 0) return null;
  const rowsRemaining = run.rowsTotal - run.rowsDone;
  if (rowsRemaining <= 0) return null;
  const costPerRow = run.spentUsd / run.rowsDone;
  const projectedPassCost = costPerRow * run.rowsTotal;
  const share = run.pass === "workflow" ? 1 : (ALLOCATION[run.pass] ?? 0);
  const needed = share > 0 ? (projectedPassCost * (1 + RATE_ALLOWANCE)) / share : 0;
  return {
    costPerRow,
    rowsRemaining,
    projectedPassCost,
    // Rounded up to the next $10: a ceiling is a decision an operator states, not a
    // figure to the cent.
    suggestedCeilingUsd: Math.max(run.ceilingUsd, Math.ceil(needed / 10) * 10),
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
      if (run.pass === "workflow") {
        return `The workflow stopped after ${got}. Its bounded automatic retries could not finish within the preauthorized ceiling. Start a new workflow version after correcting the failure; no active run waits for a budget top-up.`;
      }
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
      // A finished run still says what it lost. A pass that completed every row with a
      // vendor down for all of them is a clean success only on its face.
      return (
        `Finished ${got} for $${run.spentUsd.toFixed(2)}.` +
        (run.stoppedReason ? ` ${run.stoppedReason}` : "")
      );
    default:
      return `${got} so far.`;
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
