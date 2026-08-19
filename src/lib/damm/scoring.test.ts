import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { DammModel, EvidenceRow } from "./types.ts";
import {
  bandFor,
  claimableStage,
  finalLevel,
  formatObserved,
  formatScore,
  isStale,
  roundObserved,
  scoreAssessment,
  suggestedLevel,
} from "./scoring.ts";
import { regressionRows } from "./fixture.ts";
import { model } from "./model.ts";

const here = dirname(fileURLToPath(import.meta.url));

function row(partial: Partial<EvidenceRow> & { indicatorId: string }): EvidenceRow {
  return {
    value: null,
    observationYear: null,
    sourceName: null,
    sourceUrl: null,
    confidence: "High",
    provenance: "manual",
    isProxy: false,
    proxyNote: null,
    dataGap: false,
    gapSteward: null,
    gapSource: null,
    suggestedLevel: null,
    assessorLevel: null,
    assessorRole: null,
    assessorName: null,
    assessedAt: null,
    notes: null,
    ...partial,
  };
}

function levelAll(
  base: EvidenceRow[],
  override: Record<string, Partial<EvidenceRow>>,
): EvidenceRow[] {
  return base.map((r) => (override[r.indicatorId] ? { ...r, ...override[r.indicatorId] } : r));
}

describe("suggestedLevel", () => {
  const higher = model.indicators.find((i) => i.id === "2.1")!;
  const lower = model.indicators.find((i) => i.id === "2.5")!;
  const rubric = model.indicators.find((i) => i.id === "3.3")!;

  it("higher-is-better uses inclusive lower bounds", () => {
    assert.equal(suggestedLevel(higher, 19.9), 1);
    assert.equal(suggestedLevel(higher, 20), 2);
    assert.equal(suggestedLevel(higher, 39.9), 2);
    assert.equal(suggestedLevel(higher, 40), 3);
    assert.equal(suggestedLevel(higher, 60), 4);
    assert.equal(suggestedLevel(higher, 80), 5);
    assert.equal(suggestedLevel(higher, 100), 5);
  });

  it("lower-is-better uses inclusive upper bounds", () => {
    assert.equal(suggestedLevel(lower, 10.1), 1);
    assert.equal(suggestedLevel(lower, 10), 2);
    assert.equal(suggestedLevel(lower, 5.1), 2);
    assert.equal(suggestedLevel(lower, 5), 3);
    assert.equal(suggestedLevel(lower, 2), 4);
    assert.equal(suggestedLevel(lower, 1), 5);
    assert.equal(suggestedLevel(lower, 0.4), 5);
  });

  it("returns null without a value or without cuts", () => {
    assert.equal(suggestedLevel(higher, null), null);
    assert.equal(suggestedLevel(rubric, 3), null);
  });
});

describe("formatObserved", () => {
  it("caps publisher floats at two decimals", () => {
    assert.equal(formatObserved(72.281528), "72.28");
    assert.equal(formatObserved(0.669940000000012), "0.67");
    assert.equal(formatObserved(15.609999999999999), "15.61");
    assert.equal(formatObserved(100), "100");
    assert.equal(formatObserved(1.0), "1");
    assert.equal(formatObserved(null), "—");
    assert.equal(roundObserved(72.281528), 72.28);
    assert.equal(roundObserved(99.8), 99.8);
  });
});

describe("finalLevel", () => {
  it("data gap contributes nothing even if levels exist", () => {
    assert.equal(finalLevel({ dataGap: true, assessorLevel: 4, suggestedLevel: 3 }), null);
  });
  it("assessor always wins", () => {
    assert.equal(finalLevel({ dataGap: false, assessorLevel: 1, suggestedLevel: 5 }), 1);
  });
  it("falls back to suggested", () => {
    assert.equal(finalLevel({ dataGap: false, assessorLevel: null, suggestedLevel: 3 }), 3);
  });
});

describe("half-open bands", () => {
  it("a score of exactly 2.6 is Established, not Emerging", () => {
    assert.equal(bandFor(2.6, model.bands), "Established");
    assert.equal(bandFor(1.8, model.bands), "Emerging");
    assert.equal(bandFor(1.799, model.bands), "Nascent");
    assert.equal(bandFor(3.4, model.bands), "Advanced");
    assert.equal(bandFor(4.2, model.bands), "Transformative");
    assert.equal(bandFor(5.0, model.bands), "Transformative");
  });
});

describe("staleness", () => {
  const ind = model.indicators.find((i) => i.id === "2.7")!; // max_age 2
  it("exactly at max_age is not stale; one year past is stale", () => {
    assert.equal(isStale(ind, { observationYear: 2024 }, 2026, 3), false);
    assert.equal(isStale(ind, { observationYear: 2023 }, 2026, 3), true);
  });
  it("unlevelled rows are never stale", () => {
    assert.equal(isStale(ind, { observationYear: 2010 }, 2026, null), false);
  });
});

describe("scoring regression — full fixture", () => {
  const rows = regressionRows(model);
  const card = scoreAssessment(model, rows);

  it("pins CMS, EMS, OES, stage, gate counts and stale count", () => {
    const c1 = card.pillars.find((p) => p.id === "C1")!.score;
    const c2 = card.pillars.find((p) => p.id === "C2")!.score;
    const c3 = card.pillars.find((p) => p.id === "C3")!.score;
    const c4 = card.pillars.find((p) => p.id === "C4")!.score;
    const e1 = card.pillars.find((p) => p.id === "E1")!.score;
    const e2 = card.pillars.find((p) => p.id === "E2")!.score;
    const o1 = card.pillars.find((p) => p.id === "O1")!.score;

    // C1 levels: 4,3,3,3,3,4,2,3,4,3,2 → 34/11 = 3.0909...
    assert.ok(c1 !== null);
    assert.equal(Number(c1!.toFixed(6)), Number((34 / 11).toFixed(6)));
    // C2: 30 over the v1.3 twelve, +2 for v1.5's 3.13 (value 30 → L2) → 32/13
    assert.equal(c2, 32 / 13);
    // C3: 3,3,2,3,2,2,3,2,3,2,2,3,2 → 32/13
    assert.equal(c3, 32 / 13);
    // C4: 1.9=3, 5.1=2, 5.2=3, 5.3=2, 5.4=2, 5.5=3, 5.6=2, 5.7=3, 5.8=2, 5.9=2, 5.10=3, 5.11=3, 5.12=2
    // 3+2+3+2+2+3+2+3+2+2+3+3+2 = 32, +3 for v1.5's 5.13 (value 25 → L3) → 35/14
    assert.equal(c4, 35 / 14);
    // E1: 30 over thirteen, +3 for v1.5's 6.14 core gate (assessor L3) → 33/14
    assert.equal(e1, 33 / 14);
    // E2: 2,2,2,2,2,2,2,2,3,2,2,3 = 26/12
    assert.equal(e2, 26 / 12);
    // O1: 34 over fifteen, +2 (8.16 assessor L2) +2 (8.17 value 30 → L2) → 38/17
    assert.equal(o1, 38 / 17);

    // Weights come from the model, not from literals: v1.5 rebalanced E1/E2
    // from 55/45 to 70/30, and a hardcoded weight here would have passed while
    // the engine computed something else.
    const w = (id: string) => model.pillars[id].weight!;
    const cms = w("C1") * c1! + w("C2") * c2! + w("C3") * c3! + w("C4") * c4!;
    const ems = w("E1") * e1! + w("E2") * e2!;
    assert.equal(Number(card.cms.score!.toFixed(10)), Number(cms.toFixed(10)));
    assert.equal(Number(card.ems.score!.toFixed(10)), Number(ems.toFixed(10)));
    assert.equal(card.oes.score, o1);

    // cms ≈ 2.69 clears the Stage 2 floor (2.6) but not the Stage 3 floor
    // (3.4), so the fixture is Stage 2. Until the v1.5 migration this asserted
    // Stage 3 — the cascade read each stageN threshold as that stage's ceiling
    // rather than its floor and returned one stage too high (LEARNINGS L25).
    assert.ok(card.cms.score! >= model.stage_thresholds.stage2_cms);
    assert.ok(card.cms.score! < model.stage_thresholds.stage3_cms);
    assert.equal(card.stage.code, "STAGE_2");
    assert.equal(card.stage.label, "Stage 2 - Capability building");

    assert.equal(card.unmeasuredCoreGates, 0);
    assert.equal(card.coreGateFailures, 0);
    // Stale: 1.5 (max_age 2, year 2021 → 5>2) and 8.5 (max_age 3, year 2021 → 5>3)
    assert.equal(card.staleCount, 2);
    assert.equal(card.levelledCount, 94); // 89 + the five v1.5 indicators
  });

  it("C0 is never aggregated", () => {
    const c0 = card.pillars.find((p) => p.id === "C0")!;
    assert.equal(c0.aggregated, false);
    assert.equal(c0.score, null);
    assert.equal(c0.scored, 0);
    assert.equal(c0.stale, 1);
  });
});

describe("gate behaviour", () => {
  const base = regressionRows(model);

  it("one core gate at level 1 → Stage 1, even when everything else is strong", () => {
    const rows = levelAll(base, {
      "2.1": { assessorLevel: 1, value: 90, suggestedLevel: 5 },
    });
    const card = scoreAssessment(model, rows);
    assert.equal(card.coreGateFailures, 1);
    assert.equal(card.stage.code, "STAGE_1");
    assert.equal(card.stage.label, "Stage 1 - Foundation constrained");
  });

  it("one core gate unmeasured → NOT RATED", () => {
    const rows = levelAll(base, {
      "3.3": { assessorLevel: null, suggestedLevel: null, value: null, dataGap: true },
    });
    const card = scoreAssessment(model, rows);
    assert.equal(card.unmeasuredCoreGates, 1);
    assert.equal(card.stage.code, "NOT_RATED_GATES");
    assert.match(card.stage.label, /core gate/);
  });
});

describe("suppression", () => {
  it("a pillar at 59% coverage is not rated and suppresses its composite", () => {
    const rows = regressionRows(model).map((r) => {
      const ind = model.indicators.find((i) => i.id === r.indicatorId)!;
      if (ind.pillar !== "C1") return r;
      // C1 has 11 indicators. 59% of 11 is 6.49 → 6 scored = 54.5%; 7 scored = 63.6%.
      // Leave 5 of 11 unlevelled → 6/11 = 54.5% < 0.60
      if (["2.7", "2.8", "2.10", "2.11", "2.2"].includes(r.indicatorId)) {
        return { ...r, assessorLevel: null, suggestedLevel: null, value: null, dataGap: true };
      }
      return r;
    });
    const card = scoreAssessment(model, rows);
    const c1 = card.pillars.find((p) => p.id === "C1")!;
    assert.ok(c1.coverage < 0.6);
    assert.equal(c1.score, null);
    assert.equal(card.cms.score, null);
    assert.equal(card.cms.suppressedReason, "A member pillar is not rated");
    assert.equal(card.stage.rated, false);
  });
});

describe("confidence independence", () => {
  it("High vs Low/Estimated confidence produces an identical score", () => {
    const high = regressionRows(model).map((r) => ({ ...r, confidence: "High" as const }));
    const low = regressionRows(model).map((r) => ({ ...r, confidence: "Low/Estimated" as const }));
    const a = scoreAssessment(model, high);
    const b = scoreAssessment(model, low);
    assert.equal(a.cms.score, b.cms.score);
    assert.equal(a.ems.score, b.ems.score);
    assert.equal(a.oes.score, b.oes.score);
    assert.notEqual(a.pillars.find((p) => p.id === "C1")!.confidence, b.pillars.find((p) => p.id === "C1")!.confidence);
  });
});

describe("engagement-package rule", () => {
  it("does not claim a stage before mandate and validation", () => {
    const card = scoreAssessment(model, regressionRows(model));
    const before = claimableStage(card, { currentStep: 2, mandateRecorded: false, validationRecorded: false });
    assert.equal(before.claimable, false);
    assert.match(before.display, /Engagement package/);
    const afterMandate = claimableStage(card, { currentStep: 5, mandateRecorded: true, validationRecorded: false });
    assert.equal(afterMandate.claimable, false);
    const validated = claimableStage(card, { currentStep: 6, mandateRecorded: true, validationRecorded: true });
    assert.equal(validated.claimable, true);
    assert.equal(validated.display, card.stage.label);
  });
});

describe("draft honesty helpers", () => {
  it("thin evidence does not invent a rated stage", () => {
    const thin: EvidenceRow[] = model.indicators.map((i) =>
      row({ indicatorId: i.id, provenance: "named-gap" }),
    );
    const card = scoreAssessment(model, thin);
    assert.equal(card.cms.score, null);
    assert.equal(card.stage.rated, false);
    assert.equal(card.levelledCount, 0);
    assert.match(card.stage.label, /NOT RATED/);
  });
});
