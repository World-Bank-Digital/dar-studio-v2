import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { DammModel } from "./types.ts";
import { scoreAssessment } from "./scoring.ts";
import { assembleDeterministicDraft } from "./draft.ts";
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
