import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDeckSlides, chapterTakeaway, closingSlides, slidesForChapters } from "./deck.ts";
import { model } from "./model.ts";
import { scoreAssessment, claimableStage } from "./scoring.ts";
import { chapterReadiness } from "./ladder.ts";
import { emptyEvidenceRows } from "./draft.ts";
import type { DraftPayload } from "./draft.ts";

function payload(overrides: Partial<DraftPayload> = {}): DraftPayload {
  const rows = emptyEvidenceRows(model);
  const card = scoreAssessment(model, rows);
  return {
    countryName: "Thinland", iso3: "THN", generatedAt: "2026-08-18T00:00:00.000Z",
    modelVersion: model.version, assessmentYear: model.assessment_year,
    currentStep: 1, mandateRecorded: false, validationRecorded: false,
    scorecard: card,
    claim: claimableStage(card, { currentStep: 1, mandateRecorded: false, validationRecorded: false }),
    chapters: chapterReadiness(model, [], true), decisions: [],
    evidence: model.indicators.map((i) => ({
      id: i.id, name: i.name, pillar: i.pillar, role: i.role,
      value: null, year: null, source: null, sourceUrl: null, confidence: null,
      provenance: "named-gap" as const, proxy: false, proxyNote: null,
      dataGap: false, gapSteward: "steward", suggested: null, assessor: null,
      final: null, stale: false, gate: i.gate,
    })),
    targeting: null, gauntletPassed: false, gauntletSummary: "Gauntlet locked.",
    ...overrides,
  };
}

describe("roadmap deck (feature: consulting-style PPT)", () => {
  it("opens with the country, the claim, and the machine-drafted disclaimer", () => {
    const slides = buildDeckSlides(payload());
    assert.equal(slides[0].kind, "title");
    assert.equal(slides[0].title, "Thinland");
    assert.ok(slides[0].bullets!.some((b) => /Claimable statement/.test(b)));
    assert.ok(slides[0].bullets!.some((b) => /Machine-drafted for human review/.test(b)));
  });

  it("explains the model from the configuration, then the evidence, read-outs, pillars and gates", () => {
    const slides = buildDeckSlides(payload());
    const kickers = slides.map((s) => s.kicker);
    assert.ok(kickers.includes("THE MODEL"));
    const readouts = slides.find((s) => s.kicker === "READ-OUTS")!;
    assert.equal(readouts.table!.rows.length, 3);
    assert.match(readouts.title, /no maturity stage is claimable/i);
    const gates = slides.find((s) => s.kicker === "CORE GATES")!;
    assert.equal(gates.table!.rows.length, model.core_gates.length);
  });

  it("uses action titles — sentences, not labels", () => {
    for (const s of buildDeckSlides(payload()).filter((x) => x.kind === "content" || x.kind === "table")) {
      assert.ok(s.title.split(" ").length >= 6, `not an action title: "${s.title}"`);
    }
  });

  it("strips the conditions banner from a chapter takeaway but flags the chapter as conditional", () => {
    const body = "CONDITIONS ON THIS CHAPTER — its recommendations are conditional scenarios, not settled advice:\n- gate open\n\nThe investment sequencing follows three horizons anchored on registry readiness and connectivity coverage in the delta governorates.\n\n- Horizon 1 covers no-regret actions\n- Horizon 2 scales pilots";
    assert.match(chapterTakeaway(body), /^The investment sequencing/);
    const slides = slidesForChapters(payload(), [{ n: "12", title: "Sequencing", body }]);
    assert.equal(slides.length, 1);
    assert.match(slides[0].kicker!, /CONDITIONAL/);
    assert.match(slides[0].note!, /conditional scenarios/);
  });

  it("builds one slide per numbered chapter and none for annexes", () => {
    const slides = slidesForChapters(payload(), [
      { n: "2", title: "Diagnostic", body: "This chapter profiles agricultural structure and need across the governorates in detail.\n- point one\n- point two" },
      { n: "B", title: "Ecosystem Inventory", body: "annex body" },
    ]);
    assert.equal(slides.length, 1);
    assert.match(slides[0].kicker!, /CHAPTER 2/);
  });

  it("closes with the ladder record and the prohibitions; findings slides appear only when findings exist", () => {
    const bare = closingSlides(payload());
    assert.ok(!bare.some((s) => s.kicker === "ECOSYSTEM"));
    const ladder = bare.find((s) => s.kicker === "DECISIONS")!;
    assert.equal(ladder.table!.rows.length, 7);
    const closing = bare[bare.length - 1];
    assert.equal(closing.kind, "closing");
    assert.ok(closing.bullets!.some((b) => /PDO indicator, DLI or disbursement/.test(b)));

    const withFindings = closingSlides(payload({
      findings: [{ kind: "opportunistic", claim: "A national platform for farmer services operates in three governorates today.", quote: "q", sourceName: "src", sourceUrl: "https://x.gov.eg/a", publishedYear: 2026, credibility: "B", pillarHint: null }],
    }));
    assert.ok(withFindings.some((s) => s.kicker === "ECOSYSTEM"));
  });
});
