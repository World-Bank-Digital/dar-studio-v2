import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { DammModel } from "./types.ts";
import { scoreAssessment } from "./scoring.ts";
import { assembleDeterministicDraft , payloadForPrompt } from "./draft.ts";
import { emptyEvidenceRows } from "./draft.ts";
import { chapterReadiness } from "./ladder.ts";
import { claimableStage } from "./scoring.ts";

const here = dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(readFileSync(join(here, "../../data/model_v1_3.json"), "utf8")) as DammModel;

describe("draft honesty", () => {
  it("thin evidence does not state a claimable stage and emits gap notes", () => {
    const rows = emptyEvidenceRows(model);
    const card = scoreAssessment(model, rows);
    const chapters = chapterReadiness(model, [], false);
    const claim = claimableStage(card, { currentStep: 1, mandateRecorded: false, validationRecorded: false });
    const doc = assembleDeterministicDraft(model, {
      countryName: "Thinland",
      iso3: "THN",
      generatedAt: "2026-01-01T00:00:00.000Z",
      modelVersion: model.version,
      assessmentYear: model.assessment_year,
      currentStep: 1,
      mandateRecorded: false,
      validationRecorded: false,
      scorecard: card,
      claim,
      chapters,
      decisions: [],
      evidence: model.indicators.map((i) => ({
        id: i.id,
        name: i.name,
        pillar: i.pillar,
        role: i.role,
        value: null,
        year: null,
        source: null,
        sourceUrl: null,
        confidence: null,
        provenance: "named-gap",
        proxy: false,
        proxyNote: null,
        dataGap: false,
        gapSteward: "steward",
        suggested: null,
        assessor: null,
        final: null,
        stale: false,
        gate: i.gate,
      })),
      targeting: null,
    });
    const all = doc.chapters.map((c) => c.body).join("\n");
    assert.match(all, /no stage is claimable/i);
    assert.doesNotMatch(all, /Stage 5 - Transformative/);
    assert.equal(card.stage.rated, false);
    const unready = doc.chapters.filter((c) => !c.ready);
    assert.ok(unready.length > 0);
    assert.ok(unready.every((c) => /not drafted/i.test(c.body)));
    assert.doesNotMatch(all, /\b99\.9%\b/);
    assert.match(doc.disclaimer, /not an official World Bank system/);
  });

  it("cites source URL and flags stale values in place", async () => {
    const { assembleDeterministicDraft } = await import("./draft.ts");
    const rows = emptyEvidenceRows(model);
    const card = scoreAssessment(model, rows);
    const chapters = chapterReadiness(model, [], true);
    chapters.forEach((c) => {
      if (c.n === "2" || c.n === "A") c.status = "inputs_ready";
    });
    const claim = claimableStage(card, { currentStep: 1, mandateRecorded: false, validationRecorded: false });
    const doc = assembleDeterministicDraft(model, {
      countryName: "Egypt, Arab Rep.",
      iso3: "EGY",
      generatedAt: "2026-01-01T00:00:00.000Z",
      modelVersion: model.version,
      assessmentYear: model.assessment_year,
      currentStep: 1,
      mandateRecorded: false,
      validationRecorded: false,
      scorecard: card,
      claim,
      chapters,
      decisions: [],
      evidence: [
        {
          id: "2.4",
          name: "Individuals using the Internet (% of population)",
          pillar: "C1",
          role: "Capability",
          value: 72.2,
          year: 2023,
          source: "World Bank WDI / ITU",
          sourceUrl: "https://data.worldbank.org/indicator/IT.NET.USER.ZS",
          confidence: "Medium",
          credibilityTier: "A",
          credibilityScore: 95,
          provenance: "machine-imported",
          proxy: false,
          proxyNote: null,
          dataGap: false,
          gapSteward: null,
          suggested: 4,
          assessor: null,
          final: 4,
          stale: true,
          gate: false,
        },
      ],
      targeting: null,
    });
    const annex = doc.chapters.find((c) => c.n === "A")?.body ?? "";
    assert.match(annex, /data\.worldbank\.org\/indicator\/IT\.NET\.USER\.ZS/);
    assert.match(annex, /credibility A \(95\)/);
    assert.match(annex, /STALE/);
  });

  it("after Step 1, the ecosystem chapter is a provisional standings draft, not a not-started gap", () => {
    const rows = emptyEvidenceRows(model);
    const card = scoreAssessment(model, rows);
    const decisions = [2, 3, 4, 5, 6, 7, 8].map((step) => ({
      step,
      optionName: "Record",
      deciderName: "TTL",
      role: "TTL",
      notes: "ok",
      rejected: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: null,
    }));
    const chapters = chapterReadiness(model, decisions, true);
    // Ch.3 (ecosystem assessment) carries the maturity read-out.
    const standings = chapters.find((c) => c.n === "3");
    assert.equal(standings?.status, "inputs_ready");
    const claim = claimableStage(card, { currentStep: 8, mandateRecorded: true, validationRecorded: true });
    const doc = assembleDeterministicDraft(model, {
      countryName: "Egypt, Arab Rep.",
      iso3: "EGY",
      generatedAt: "2026-01-01T00:00:00.000Z",
      modelVersion: model.version,
      assessmentYear: model.assessment_year,
      currentStep: 8,
      mandateRecorded: true,
      validationRecorded: true,
      scorecard: card,
      claim,
      chapters,
      decisions,
      evidence: model.indicators.map((i) => ({
        id: i.id,
        name: i.name,
        pillar: i.pillar,
        role: i.role,
        value: null,
        year: null,
        source: null,
        sourceUrl: null,
        confidence: null,
        provenance: "named-gap",
        proxy: false,
        proxyNote: null,
        dataGap: false,
        gapSteward: "steward",
        suggested: null,
        assessor: null,
        final: null,
        stale: false,
        gate: i.gate,
      })),
      targeting: { chains: ["Wheat", "Cotton"], rejected: ["Rice"], notes: null },
    });
    const body2 = doc.chapters.find((c) => c.n === "3")?.body ?? "";
    assert.equal(doc.chapters.find((c) => c.n === "3")?.ready, true);
    assert.match(body2, /CMS \(capability\)/);
    assert.doesNotMatch(body2, /is not drafted/);
    const body3 = doc.chapters.find((c) => c.n === "10")?.body ?? "";
    assert.match(body3, /Wheat/);
  });
});

function fullPayload(overrides = {}) {
    const rows = emptyEvidenceRows(model);
    const card = scoreAssessment(model, rows);
    const chapters = chapterReadiness(model, [], true);
    const claim = claimableStage(card, { currentStep: 1, mandateRecorded: false, validationRecorded: false });
    return {
      countryName: "Thinland", iso3: "THN", generatedAt: "2026-01-01T00:00:00.000Z",
      modelVersion: model.version, assessmentYear: model.assessment_year,
      currentStep: 1, mandateRecorded: false, validationRecorded: false,
      scorecard: card, claim, chapters, decisions: [],
      evidence: model.indicators.map((i) => ({
        id: i.id, name: i.name, pillar: i.pillar, role: i.role,
        value: null, year: null, source: null, sourceUrl: null, confidence: null,
        provenance: "named-gap" as const, proxy: false, proxyNote: null,
        dataGap: false, gapSteward: "steward", suggested: null, assessor: null,
        final: null, stale: false, gate: i.gate,
      })),
      targeting: null, gauntletPassed: false, gauntletSummary: "Gauntlet locked. 0/13 populated.",
      ...overrides,
    };
}

describe("draft-first architecture", () => {
  it("drafts all 17 chapters and 11 annexes right after Step 1, with nothing undrafted", () => {
    const doc = assembleDeterministicDraft(model, fullPayload());
    const undrafted = doc.chapters.filter((c) => /is not drafted/.test(c.body));
    assert.equal(undrafted.length, 0, undrafted.map((c) => c.n).join(","));
    assert.equal(doc.chapters.filter((c) => /^\d+$/.test(c.n)).length, 17);
    assert.equal(doc.chapters.filter((c) => /^[A-K]$/.test(c.n)).length, 11);
  });

  it("opens by explaining the model, then the evidence-health page (pipeline revision point 2)", () => {
    const doc = assembleDeterministicDraft(model, fullPayload());
    assert.equal(doc.chapters[0].n, "model");
    assert.match(doc.chapters[0].body, /THE MODEL THIS RUN EXECUTES/);
    assert.match(doc.chapters[0].body, /97 indicators/);
    assert.equal(doc.chapters[1].n, "health");
    const body = doc.chapters[1].body;
    assert.match(body, /no stage claimable/i);
    assert.match(body, /Strengthen first \(ranked\):/);
    assert.match(body, /core gate/i);
  });

  it("marks prescriptive chapters as conditional when the readiness gate has not cleared", () => {
    const doc = assembleDeterministicDraft(model, fullPayload());
    const ch10 = doc.chapters.find((c) => c.n === "10")!;
    assert.match(ch10.body, /CONDITIONS ON THIS CHAPTER/);
    assert.match(ch10.body, /hypothesis → evidence → decision-gate/);
    const ch2 = doc.chapters.find((c) => c.n === "2")!;
    assert.doesNotMatch(ch2.body, /CONDITIONS ON THIS CHAPTER/, "diagnostic chapters report, they are not conditional");
  });

  it("never lets the health page claim a stage the policy withholds", () => {
    const doc = assembleDeterministicDraft(model, fullPayload());
    assert.doesNotMatch(doc.chapters[0].body, /Stage [1-5] is claimable|claimable: Stage/i);
  });
});

describe("conditions banner survives prose (L18)", () => {
  it("extracts the banner block and nothing else", async () => {
    const { extractConditionsBanner } = await import("./draft.ts");
    const body = "CONDITIONS ON THIS CHAPTER — its recommendations are conditional scenarios, not settled advice:\n- The evidence readiness gate has not cleared.\n\nChapter text follows here.";
    const banner = extractConditionsBanner(body);
    assert.ok(banner?.startsWith("CONDITIONS ON THIS CHAPTER"));
    assert.ok(!banner?.includes("Chapter text follows"));
    assert.equal(extractConditionsBanner("Plain chapter body with no banner."), null);
  });
});

describe("sweep findings and foresight in the draft (pipeline points 3-5)", () => {
  const FINDING_OPP = {
    kind: "opportunistic" as const,
    claim: "The Farmer's Card programme reaches 4.5 million registered farmers across all governorates.",
    quote: "the Farmer's Card now reaches 4.5 million registered farmers",
    sourceName: "Ministry of Agriculture",
    sourceUrl: "https://www.moalr.gov.eg/farmers-card-2026",
    publishedYear: 2026,
    credibility: "B",
    pillarHint: "C2",
  };
  const FINDING_PRACTICE = {
    kind: "practice" as const,
    claim: "Kenya's 2026 digital agriculture strategy pairs e-extension scale-up with agri-data governance rules.",
    quote: "the strategy pairs e-extension scale-up with agricultural data governance",
    sourceName: "Ministry of Agriculture Kenya",
    sourceUrl: "https://kilimo.go.ke/strategy-2026",
    publishedYear: 2026,
    credibility: "B",
    pillarHint: null,
  };
  const FORESIGHT = { filename: "egypt-2040-scenarios.pdf", chars: 54210, excerpt: "Scenario B assumes water stress accelerates consolidation of smallholder plots…" };

  it("renders the opportunistic sweep as the ecosystem inventory (Annex B) with verified quotes", () => {
    const doc = assembleDeterministicDraft(model, { ...fullPayload(), findings: [FINDING_OPP, FINDING_PRACTICE] });
    const annexB = doc.chapters.find((c) => c.n === "B")!;
    assert.match(annexB.body, /wide-net sweep/);
    assert.ok(annexB.body.includes(FINDING_OPP.claim));
    assert.ok(annexB.body.includes(FINDING_OPP.quote), "the verified quote travels with the finding");
    assert.ok(!annexB.body.includes(FINDING_PRACTICE.claim), "practices are comparators, not ecosystem inventory");
  });

  it("shows practices and foresight to prescriptive chapters as labelled comparator material", () => {
    const doc = assembleDeterministicDraft(model, { ...fullPayload(), findings: [FINDING_OPP, FINDING_PRACTICE], foresight: [FORESIGHT] });
    const ch12 = doc.chapters.find((c) => c.n === "12")!;
    assert.ok(ch12.body.includes(FINDING_PRACTICE.claim));
    assert.match(ch12.body, /comparators, not prescriptions/);
    assert.ok(ch12.body.includes(FORESIGHT.filename));
    assert.match(ch12.body, /user uploads, cited as such/);
    const ch2 = doc.chapters.find((c) => c.n === "2")!;
    assert.ok(!ch2.body.includes(FINDING_PRACTICE.claim), "diagnostic chapters do not carry comparator practices");
  });

  it("feeds findings and foresight into the model facts block so prose may cite them", () => {
    const facts = payloadForPrompt({ ...fullPayload(), findings: [FINDING_OPP, FINDING_PRACTICE], foresight: [FORESIGHT] });
    assert.ok(facts.includes(FINDING_OPP.claim));
    assert.ok(facts.includes(FINDING_PRACTICE.claim));
    assert.ok(facts.includes(FORESIGHT.filename));
    assert.match(facts, /User-provided strategic foresight/);
  });

  it("keeps Annex B honest when no sweep has run", () => {
    const doc = assembleDeterministicDraft(model, fullPayload());
    const annexB = doc.chapters.find((c) => c.n === "B")!;
    assert.match(annexB.body, /No public-domain findings are stored/);
  });
});
