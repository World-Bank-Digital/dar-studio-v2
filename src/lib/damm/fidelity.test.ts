import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkProseFidelity, collectAllowedNumbers, isSupportedNumber } from "./fidelity.ts";

const FACTS = {
  facts: "CMS (capability): 2.63 — Established — coverage 100%. Rural 3G coverage 65% observed 2024.",
  payload: { scorecard: { cms: { score: 2.63 } }, evidence: [{ id: "2.1", value: 65, year: 2024 }] },
};

describe("collectAllowedNumbers", () => {
  it("collects numbers from nested objects and from rendered text alike", () => {
    const allowed = collectAllowedNumbers(FACTS);
    assert.equal(allowed.has(2.63), true);
    assert.equal(allowed.has(65), true);
    assert.equal(allowed.has(2024), true);
    assert.equal(allowed.has(100), true);
  });

  it("does not invent numbers that were never present", () => {
    assert.equal(collectAllowedNumbers(FACTS).has(78), false);
  });
});

describe("isSupportedNumber", () => {
  const allowed = new Set([2.63, 65, 2024]);

  it("permits the model to re-round a figure it was given", () => {
    assert.equal(isSupportedNumber(2.6, 1, allowed), true);
  });

  it("permits small structural integers used for numbering", () => {
    assert.equal(isSupportedNumber(4, 0, allowed), true);
  });

  it("refuses a figure with no counterpart", () => {
    assert.equal(isSupportedNumber(91.4, 1, allowed), false);
  });
});

describe("checkProseFidelity", () => {
  it("accepts prose that only restates the engine's own figures", () => {
    const prose = "Capability stands at 2.63 with coverage of 100%. Rural 3G coverage was 65% in 2024.";
    const report = checkProseFidelity(prose, FACTS, { stageClaimable: true });
    assert.equal(report.ok, true);
    assert.equal(report.reason, null);
  });

  it("rejects prose that introduces a figure the evidence base does not hold", () => {
    const prose = "Rural 3G coverage was 65% in 2024, and mobile broadband reached 88% of households.";
    const report = checkProseFidelity(prose, FACTS, { stageClaimable: true });
    assert.equal(report.ok, false);
    assert.ok(report.unsupportedNumbers.includes("88"));
    assert.match(report.reason ?? "", /not present in the evidence base/i);
  });

  it("rejects a stage assertion when the payload says no stage is claimable", () => {
    const prose = "On the evidence assembled, the country is at Stage 3.";
    const report = checkProseFidelity(prose, FACTS, { stageClaimable: false });
    assert.equal(report.ok, false);
    assert.ok(report.unsupportedClaims.length > 0);
  });

  it("allows the same stage language once a stage is genuinely claimable", () => {
    const prose = "On the evidence assembled, the country is at Stage 3.";
    assert.equal(checkProseFidelity(prose, FACTS, { stageClaimable: true }).ok, true);
  });

  it("catches a maturity label asserted without a claim", () => {
    const prose = "Capability is established across the board.";
    const report = checkProseFidelity(prose, FACTS, { stageClaimable: false });
    assert.equal(report.ok, false);
  });

  it("reports every distinct offending figure once", () => {
    const prose = "Values of 88 and 88 and 91 were recorded.";
    const report = checkProseFidelity(prose, FACTS, { stageClaimable: true });
    assert.deepEqual(report.unsupportedNumbers.slice().sort(), ["88", "91"]);
  });
});

describe("chapter-aware fidelity", () => {
  const facts = { facts: "CMS 2.63, coverage 100%, rural 3G 65% in 2024." };

  it("rejects a target year in a diagnostic chapter — it would be a claim about now", () => {
    const r = checkProseFidelity("Coverage reaches 65% and will hold to 2032.", facts, {
      kind: "diagnostic",
      assessmentYear: 2026,
    });
    assert.equal(r.ok, false);
    assert.ok(r.unsupportedNumbers.includes("2032"));
  });

  it("allows a target year in a roadmap chapter — it is a proposal", () => {
    const r = checkProseFidelity("Phase 3 completes by 2032.", facts, {
      kind: "prescriptive",
      assessmentYear: 2026,
    });
    assert.equal(r.ok, true);
  });

  it("still blocks a fabricated statistic in a roadmap chapter", () => {
    const r = checkProseFidelity("Phase 3 completes by 2032, lifting coverage to 88%.", facts, {
      kind: "prescriptive",
      assessmentYear: 2026,
    });
    assert.equal(r.ok, false);
    assert.ok(r.unsupportedNumbers.includes("88"));
  });

  it("does not treat a distant year as a plan", () => {
    const r = checkProseFidelity("By 2400 the programme concludes.", facts, {
      kind: "prescriptive",
      assessmentYear: 2026,
    });
    assert.equal(r.ok, false);
  });
});

describe("section numbering vs figures (LEARNINGS L15)", () => {
  const facts = { facts: "Rural 3G coverage 65% in 2024." };

  it("ignores numbered subsection headings in any chapter", () => {
    const prose = "10.1 No-regret actions\nCoverage stands at 65%.\n### 10.2 Conditional investments\nMore text.";
    const r = checkProseFidelity(prose, facts, { kind: "prescriptive", assessmentYear: 2026 });
    assert.equal(r.ok, true, r.reason ?? "");
  });

  it("still catches the same value used as a figure in running text", () => {
    const prose = "The programme will reach 10.1 million farmers.";
    const r = checkProseFidelity(prose, facts, { kind: "prescriptive", assessmentYear: 2026 });
    assert.equal(r.ok, false);
    assert.ok(r.unsupportedNumbers.includes("10.1"));
  });

  it("does not glue digits across a non-breaking space into phantom numbers", () => {
    const prose = "Q1 65% coverage was recorded.";
    const r = checkProseFidelity(prose, facts, { kind: "diagnostic" });
    assert.equal(r.ok, true, r.reason ?? "");
    const bad = checkProseFidelity("Q1 88% coverage was recorded.", facts, { kind: "diagnostic" });
    assert.ok(bad.unsupportedNumbers.includes("88"), "88 should be caught on its own, not as 188");
  });
});

describe("heading punctuation (L15 follow-up)", () => {
  it("strips section numbers followed by punctuation", () => {
    const facts = { facts: "coverage 65% in 2024" };
    const prose = "9.5: Revision triggers\nCoverage is 65%.\n9.6) Signposts\nMore.";
    const r = checkProseFidelity(prose, facts, { kind: "diagnostic" });
    assert.equal(r.ok, true, r.reason ?? "");
  });
});

describe("hyphenated ranges (L15 follow-up)", () => {
  it("reads 'Phases 1-3' as a range, not the number minus three", () => {
    const facts = { facts: "coverage 65% in 2024" };
    const r = checkProseFidelity("Phases 1-3 proceed as gates allow. Coverage is 65%.", facts, {
      kind: "prescriptive",
      assessmentYear: 2026,
    });
    assert.equal(r.ok, true, r.reason ?? "");
  });

  it("still catches a genuinely negative unsupported figure", () => {
    const facts = { facts: "coverage 65% in 2024" };
    const r = checkProseFidelity("The balance moved by -3.7 points.", facts, { kind: "diagnostic" });
    assert.equal(r.ok, false);
  });
});

describe("band list covers the model's own bands (L18)", () => {
  it("catches 'is transformative' asserted without a claimable stage", () => {
    const r = checkProseFidelity("The ecosystem is transformative.", { facts: "x" }, { stageClaimable: false });
    assert.equal(r.ok, false);
    assert.ok(r.unsupportedClaims.length > 0);
  });
});
