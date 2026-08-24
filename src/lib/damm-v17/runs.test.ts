import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_LEASE_MS,
  DEFAULT_CEILING_USD,
  allocationExhaustsCeiling,
  canResume,
  canTransition,
  isClaimable,
  isResumable,
  isTerminal,
  passCap,
  progressOf,
  remaining,
  stoppedSummary,
  type Run,
  type RunStatus,
  basenameFor,
  canReview,
  defaultVendorFor,
  VENDOR_CHOICES,
  projectToFinish,
  producesEvidence,
  isRunnable,} from "./runs.ts";

function run(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    countryId: "c1",
    countryName: "Egypt",
    iso3: "EGY",
    pass: "research",
    status: "running",
    ceilingUsd: DEFAULT_CEILING_USD,
    spentUsd: 0,
    rowsTotal: 57,
    rowsDone: 0,
    vendor: "anthropic/claude-opus-5",
    outBasename: "EGY_run1",
    claimedBy: "w1",
    heartbeatAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    stoppedReason: null,
    ...over,
  };
}

describe("the budget, which is exported rather than restated (G3)", () => {
  it("per-pass caps exhaust the country ceiling", () => {
    // If they summed to less, a country could not spend its ceiling; if more, it could
    // spend past it by running every pass to its own limit.
    assert.ok(
      allocationExhaustsCeiling(),
      "the per-pass allocation must sum to the whole ceiling",
    );
  });

  it("apportions each pass against the ceiling", () => {
    assert.equal(passCap("research", 500), 200);
    assert.equal(passCap("g2", 500), 75);
    assert.equal(passCap("generation", 500), 100);
  });

  it("refuses a pass it has no allocation for, rather than assuming one", () => {
    // Silently defaulting to the whole ceiling is how a new pass spends a country's
    // entire budget on its first run.
    assert.throws(
      () => passCap("nonsense" as never, 500),
      /no budget allocation/,
      "an unallocated pass must fail loudly",
    );
  });

  it("reports what is left of the pass, not of the ceiling", () => {
    assert.equal(remaining(run({ pass: "g2", spentUsd: 6.35 })), 68.65);
  });
});

describe("exhaustion is not failure (G2)", () => {
  it("keeps the two states apart", () => {
    assert.ok(isTerminal("failed"));
    assert.ok(!isTerminal("exhausted"), "an exhausted run is unfinished, not broken");
    assert.ok(isResumable("exhausted"));
    assert.ok(!isResumable("failed"));
  });

  it("tells an operator what it has, and that the rest is absent rather than gaps", () => {
    const s = stoppedSummary(run({ status: "exhausted", rowsDone: 41, spentUsd: 200 }));
    assert.match(s, /41 of 57/);
    assert.match(s, /absent, not recorded as gaps/);
    assert.match(s, /Add budget/);
  });

  it("will not resume an exhausted run at a ceiling it has already spent", () => {
    // Re-queueing at the same ceiling stops again immediately, which reads to an
    // operator as the button not working.
    const r = run({ status: "exhausted", pass: "research", spentUsd: 200 });
    const same = canResume(r);
    assert.equal(same.ok, false);
    assert.match(same.reason, /Raise the ceiling/);
    assert.equal(canResume(r, 1000).ok, true, "a higher ceiling gives it room");
  });

  it("resumes a paused run without asking for anything", () => {
    assert.equal(canResume(run({ status: "paused", spentUsd: 199 })).ok, true);
  });

  it("refuses to resume a finished run", () => {
    for (const s of ["done", "failed", "cancelled"] as RunStatus[]) {
      const t = canResume(run({ status: s }));
      assert.equal(t.ok, false, `${s} must not resume`);
      assert.match(t.reason, /finished/);
    }
  });
});

describe("transitions are a closed set", () => {
  it("allows the moves a run actually makes", () => {
    assert.ok(canTransition("queued", "running").ok);
    assert.ok(canTransition("running", "done").ok);
    assert.ok(canTransition("running", "exhausted").ok);
    assert.ok(canTransition("exhausted", "queued").ok, "topped up and queued again");
    assert.ok(canTransition("running", "queued").ok, "a lost claim returns it to the queue");
  });

  it("refuses everything else, with a reason a surface can print", () => {
    const t = canTransition("done", "running");
    assert.equal(t.ok, false);
    assert.match(t.reason, /finished/);
    assert.equal(canTransition("queued", "done").ok, false, "no run finishes unstarted");
    assert.equal(canTransition("failed", "queued").ok, false, "a failure is not retried blindly");
    assert.equal(canTransition("running", "running").ok, false);
  });
});

describe("a dead worker does not strand a run (G1)", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("a queued run is free", () => {
    assert.ok(isClaimable(run({ status: "queued", heartbeatAt: null }), now));
  });

  it("a run whose worker is alive is held", () => {
    const beat = new Date(now.getTime() - CLAIM_LEASE_MS / 2);
    assert.ok(!isClaimable(run({ status: "running", heartbeatAt: beat }), now));
  });

  it("a run whose worker stopped saying so is free again", () => {
    // The pipeline checkpoints per row, so retaking this claim resumes rather than
    // restarts: a failure at indicator 50 of 57 does not go back to zero.
    const stale = new Date(now.getTime() - CLAIM_LEASE_MS - 1000);
    assert.ok(isClaimable(run({ status: "running", heartbeatAt: stale }), now));
  });

  it("a slow run is not stolen mid-row", () => {
    // A single indicator can take three minutes of retrieval. Two workers on one run
    // would spend the same budget twice.
    const beat = new Date(now.getTime() - 3 * 60 * 1000);
    assert.ok(!isClaimable(run({ status: "running", heartbeatAt: beat }), now));
  });

  it("a finished or stopped run is never claimable", () => {
    for (const s of ["done", "failed", "cancelled", "paused", "exhausted"] as RunStatus[]) {
      assert.ok(!isClaimable(run({ status: s, heartbeatAt: null }), now), `${s}`);
    }
  });
});

describe("progress never fabricates what it does not know", () => {
  it("reports no fraction until the total is known", () => {
    const p = progressOf(run({ rowsTotal: null, rowsDone: 3 }));
    assert.equal(p.fraction, null, "an unknown total must not render as 0% or 100%");
    assert.equal(p.rowsDone, 3);
  });

  it("reports spend against the pass allocation, not the ceiling", () => {
    const p = progressOf(run({ pass: "g2", spentUsd: 37.5 }));
    assert.equal(p.capUsd, 75);
    assert.equal(p.spentFraction, 0.5);
    assert.equal(p.atCap, false);
  });

  it("flags the cap before the last cent", () => {
    assert.equal(progressOf(run({ spentUsd: 199.995 })).atCap, true);
  });

  it("never runs past the end of the bar", () => {
    const p = progressOf(run({ rowsDone: 60, rowsTotal: 57, spentUsd: 400 }));
    assert.equal(p.fraction, 1);
    assert.equal(p.spentFraction, 1);
  });
});

describe("which name a pass writes under", () => {
  const at = new Date("2026-08-25T14:07:00Z");

  it("mints a stamped name for a research pass", () => {
    assert.equal(basenameFor("research", "egy", at, null, "a1b2c3"), "EGY_202608251407_a1b2c3");
  });

  it("makes a later pass inherit the research name rather than mint its own", () => {
    // gate2.py takes --run and reads an existing pass's files. A G2 run under a fresh
    // name would find nothing to review and report a clean review of it.
    assert.equal(basenameFor("g2", "EGY", at, "EGY_202608251407_a1b2c3", "zzz"), "EGY_202608251407_a1b2c3");
  });

  it("mints a different name for each run, even in the same minute", () => {
    // The basename is what the pipeline checkpoints under, and every invocation passes
    // --resume. Two runs sharing a name means the second resumes the first's completed
    // state: it finishes at once, reports every row done, and claims a spend it never made.
    assert.notEqual(
      basenameFor("research", "EGY", at, null, "a1b2c3"),
      basenameFor("research", "EGY", at, null, "d4e5f6"),
    );
  });

  it("returns nothing when there is no research pass to inherit from", () => {
    assert.equal(basenameFor("g2", "EGY", at, null, "a1b2c3"), null);
    assert.equal(basenameFor("generation", "EGY", at, null, "a1b2c3"), null);
  });
});

describe("who may review a pass", () => {
  it("allows a reviewer from another vendor", () => {
    assert.ok(canReview("anthropic/claude-opus-5", "openai/gpt-5.6-terra").ok);
  });

  it("refuses a vendor reviewing its own work", () => {
    const t = canReview("anthropic/claude-opus-5", "anthropic/claude-sonnet-5");
    assert.equal(t.ok, false);
    assert.match(t.reason, /reviewing its own work/);
  });

  it("catches the unnamed case, where nothing on screen would say so", () => {
    // Research on openai, reviewer left at its default — which is also openai. This is
    // the trap the rule exists for: both fields look empty and the review is not a peer.
    const t = canReview("openai/gpt-5.6-terra", null);
    assert.equal(t.ok, false);
  });

  it("allows the two defaults, which is the arrangement the pipeline shipped with", () => {
    assert.ok(canReview(null, null).ok);
  });

  it("offers only vendor/model pairs the pipeline can resolve", () => {
    assert.ok(VENDOR_CHOICES.includes("anthropic/claude-opus-5"));
    assert.ok(VENDOR_CHOICES.includes("gemini/gemini-3.1-pro-preview"));
    assert.ok(VENDOR_CHOICES.every((v) => v.includes("/")));
  });

  it("reads the pass defaults from the pipeline rather than restating them", () => {
    assert.equal(defaultVendorFor("research"), "anthropic/claude-opus-5");
    assert.equal(defaultVendorFor("g2"), "openai/gpt-5.6-terra");
  });
});

describe("how much budget finishing would need", () => {
  const stopped = {
    pass: "research" as const,
    ceilingUsd: 20,
    spentUsd: 8,
    rowsDone: 20,
    rowsTotal: 59,
  };

  it("projects from the rate the run actually ran at", () => {
    const p = projectToFinish(stopped)!;
    assert.equal(p.rowsRemaining, 39);
    assert.ok(Math.abs(p.costPerRow - 0.4) < 1e-9);
    assert.ok(Math.abs(p.projectedPassCost - 23.6) < 1e-9);
  });

  it("suggests a ceiling that gives the pass that much, with the stated allowance", () => {
    // $23.60 projected, plus 20%, is $28.32 — which at research's 40% share needs a
    // ceiling of $70.80, rounded up to $80.
    assert.equal(projectToFinish(stopped)!.suggestedCeilingUsd, 80);
  });

  it("never suggests less than the ceiling already set", () => {
    assert.equal(projectToFinish({ ...stopped, ceilingUsd: 500 })!.suggestedCeilingUsd, 500);
  });

  it("gives nothing when there is no basis, rather than a number derived from nothing", () => {
    assert.equal(projectToFinish({ ...stopped, rowsTotal: null }), null);
    assert.equal(projectToFinish({ ...stopped, rowsDone: 0 }), null);
    assert.equal(projectToFinish({ ...stopped, rowsDone: 59, rowsTotal: 59 }), null);
  });
});

describe("which passes produce evidence", () => {
  it("research and the second review do", () => {
    assert.ok(producesEvidence("research"));
    assert.ok(producesEvidence("g2"));
  });

  it("the scans, foresight and generation do not", () => {
    // They gather what the instrument does not measure, produce milestones, and produce a
    // document. Offering to import one into the evidence base would suggest they score
    // something.
    for (const p of ["scans", "foresight", "generation"] as const) {
      assert.equal(producesEvidence(p), false, `${p} should not produce evidence`);
    }
  });

  it("scans is runnable now that a script implements it", () => {
    assert.ok(isRunnable("scans"));
    assert.equal(isRunnable("foresight"), false);
  });
});
