import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { model } from "./model.ts";
import { Scorer, r2 } from "./scorer.ts";
import type { Assessment, Observations, PillarId, UseCaseId } from "./types.ts";

import egyptObs from "./fixtures/egypt-observations.json" with { type: "json" };
import egyptExpected from "./fixtures/egypt-expected.json" with { type: "json" };
import nigeriaObs from "./fixtures/nigeria-observations.json" with { type: "json" };
import nigeriaExpected from "./fixtures/nigeria-expected.json" with { type: "json" };

/**
 * The fixtures are the assessment pipeline's own Egypt and Nigeria runs — the
 * observations it consumed and every figure it derived. The scorer must reproduce
 * all of them from the model file alone. A single divergence means this port and
 * the pipeline disagree about the model, and the pipeline wins: fix the port.
 */

// TypeScript infers a literal type from each fixture, and the two countries differ
// where an indicator records a number in one and a statement in the other (8.5).
// The parity assertions below check every field explicitly, so the structural
// shape is what matters here rather than the literal types of the values.
type Expected = {
  counts: Record<string, number>;
  rated: number;
  held: number;
  pillars: Record<string, Record<string, unknown>>;
  layers: Record<string, number | null>;
  leapfrog_gap: number | null;
  prereq: Record<string, string>;
  matrix: Record<string, Record<string, unknown>>;
};

function assertParity(name: string, got: Assessment, want: Expected) {
  assert.deepEqual(got.counts, want.counts, `${name}: evidence-class counts`);
  assert.equal(got.rated, want.rated, `${name}: rated`);
  assert.equal(got.held, want.held, `${name}: held`);

  for (const [p, e] of Object.entries(want.pillars)) {
    const g = got.pillars[p as PillarId];
    for (const k of ["n", "rated", "held", "mean", "band", "weak", "stale"] as const) {
      assert.deepEqual(g[k], e[k], `${name}: pillar ${p}.${k}`);
    }
    assert.deepEqual(g.comp, e.comp, `${name}: pillar ${p}.comp`);
  }

  assert.deepEqual(got.layers, want.layers, `${name}: layers`);
  assert.equal(got.leapfrog.gap, want.leapfrog_gap, `${name}: leapfrog gap`);

  for (const [id, status] of Object.entries(want.prereq)) {
    assert.equal(got.prereq[id]?.status, status, `${name}: prerequisite ${id}`);
  }

  for (const [uc, e] of Object.entries(want.matrix)) {
    const g = got.matrix[uc as UseCaseId];
    for (const k of [
      "status",
      "why",
      "mean_readiness",
      "mean_need",
      "mean_outcome",
      "n_bearing",
    ] as const) {
      assert.deepEqual(g[k], e[k], `${name}: matrix ${uc}.${k}`);
    }
  }
}

describe("scorer parity with the assessment pipeline", () => {
  const scorer = new Scorer(model);

  it("reproduces every Egypt figure", () => {
    assertParity("Egypt", scorer.run(egyptObs as Observations), egyptExpected);
  });

  it("reproduces every Nigeria figure", () => {
    assertParity("Nigeria", scorer.run(nigeriaObs as Observations), nigeriaExpected);
  });

  it("Egypt C4 is the defect-39 case: mean over 3 of 7 rows, flagged weak", () => {
    const c4 = scorer.run(egyptObs as Observations).pillars.C4;
    assert.equal(c4.n, 7);
    assert.equal(c4.rated, 3);
    assert.equal(c4.held, 3);
    assert.equal(c4.mean, 3.33);
    assert.equal(c4.weak, true, "a pillar resting on a minority of its rows must flag");
  });

  it("ruling 13.12: need never enters the readiness figure", () => {
    // Nigeria MKT was the case the specification argued 13.12 on: 2.58 with the need and
    // outcome rows folded in, 2.64 without. Only the second decides the column now, and
    // the need mean of 1.0 that used to drag it down is reported on its own.
    const mkt = scorer.run(nigeriaObs as Observations).matrix.MKT;
    assert.equal(mkt.status, "Partial");
    assert.equal(mkt.mean_readiness, 2.64, "readiness is the enabling rows alone");
    assert.equal(mkt.mean_need, 1, "a severe problem is reported, never averaged in");
    assert.notEqual(mkt.mean_readiness, 2.58, "the old mixed mean must not survive");
  });

  it("ruling 13.1: a pillar squarely at its level reads a margin of zero", () => {
    const a1 = scorer.run(egyptObs as Observations).pillars.A1;
    assert.equal(a1.mean, 3);
    assert.equal(a1.band, "Established");
    assert.equal(a1.margin, 0, "every row at level 3 must read +0.00, not an edge value");
  });

  it("derives band levels from model order instead of stale presentation labels", () => {
    const renamedModel = structuredClone(model);
    renamedModel.bands = renamedModel.bands.map((band, index) => ({
      ...band,
      name: `Level ${index + 1}`,
    }));
    const a1 = new Scorer(renamedModel).run(egyptObs as Observations).pillars.A1;
    assert.equal(a1.band, "Level 3");
    assert.equal(a1.margin, 0, "renaming a canonical band must not change its arithmetic");
  });

  it("ruling 13.4: the consent prerequisite binds more than the AGI column", () => {
    // Egypt records 7.12 as Absent. Under the old AGI-only binding that blocked one
    // column; it now blocks every column drawing on personal or farm-level data.
    const eg = scorer.run(egyptObs as Observations);
    assert.equal(eg.prereq["7.12"].status, "Absent");
    const blocked = Object.entries(eg.matrix)
      .filter(([, m]) => m.status === "Blocked")
      .map(([uc]) => uc)
      .sort();
    assert.deepEqual(blocked, ["ADV", "AGI", "FIN", "SMF"]);
  });
});

describe("scorer semantics", () => {
  const scorer = new Scorer(model);

  it("derives the evidence class from the value, never from a choice", () => {
    assert.equal(scorer.evidenceClass({ value: 42 }), "Measured");
    assert.equal(scorer.evidenceClass({ value: "DATA GAP — searched x, y" }), "Gap");
    assert.equal(
      scorer.evidenceClass({ value: "Law in force", src: "Gazette", tier: "T3" }),
      "Documented",
    );
    assert.equal(
      scorer.evidenceClass({ value: "Reported operating", src: "Vendor blog", tier: "T5" }),
      "Judged",
    );
    assert.equal(scorer.evidenceClass({ value: "Assessor statement" }), "Judged");
    assert.equal(scorer.evidenceClass({ value: null }), "");
  });

  it("keeps a withheld level outside the mean without calling it absent", () => {
    const obs = structuredClone(egyptObs) as Observations;
    // 4.7 is a FIN prerequisite. Withhold its level: the column must read
    // Unverified — an unrated row asserts nothing — and never Blocked.
    obs["4.7"].level = null;
    const got = scorer.run(obs);
    assert.equal(got.prereq["4.7"].status, "Unverified");
    // Egypt's FIN column is Blocked on 7.12 since ruling 13.4, so the claim to test is
    // not the column's status but that a withheld row never becomes a blocker itself.
    assert.ok(
      !got.matrix.FIN.why.includes("4.7"),
      "an unrated row asserts nothing and must never be named as a blocker",
    );
    const c3 = got.pillars.C3;
    assert.equal(c3.rated, 7, "the withheld row leaves the mean's denominator");
    assert.equal(c3.held, 1, "…and is disclosed as held, not vanished");
  });

  it("blocks every column when a universal prerequisite is absent", () => {
    const obs = structuredClone(nigeriaObs) as Observations;
    // Rural electricity down to 3%: drop the precomputed class and level so the
    // scorer derives both from the value — Measured, level 1, Absent.
    obs["2.9"] = { value: 3, year: 2024, src: "test", tier: "T1" };
    const got = scorer.run(obs);
    assert.equal(got.prereq["2.9"].status, "Absent");
    for (const cell of Object.values(got.matrix)) {
      assert.equal(cell.status, "Blocked");
      assert.match(cell.why, /Universal: .*2\.9/);
    }
  });
});

describe("half-up rounding (the workbook's rule, not IEEE's)", () => {
  it("rounds exact .xx5 up, where round-to-even would band a mean differently", () => {
    assert.equal(r2(2.675), 2.68); // Math.round(2.675*100)/100 === 2.67 — the bug this guards
    assert.equal(r2(3.335), 3.34);
    assert.equal(r2(2.585), 2.59);
    assert.equal(r2(1.005), 1.01);
  });

  it("rounds half away from zero on both signs, matching Excel ROUND()", () => {
    assert.equal(r2(-2.675), -2.68);
    assert.equal(r2(-0.125), -0.13);
  });

  it("is exact on repeating-decimal means the scorer actually produces", () => {
    assert.equal(r2(31 / 12), 2.58); // Nigeria MKT-adjacent shape
    assert.equal(r2(10 / 3), 3.33);
    assert.equal(r2(8 / 3), 2.67);
    assert.equal(r2(2.6), 2.6);
    assert.equal(r2(4), 4);
  });
});
