import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleDeterministicDraft } from "./draft.ts";
import { emptyEvidenceRows } from "./draft.ts";
import { chapterReadiness } from "./ladder.ts";
import { claimableStage, scoreAssessment } from "./scoring.ts";
import { model } from "./model.ts";
import {
  DOSSIER_CANNOT_WRITE_EVIDENCE,
  parseDossierHits,
  scoreDossierItem,
  toDossierItem,
  validateDossierHit,
} from "./dossier.ts";

describe("country dossier", () => {
  it("never writes the evidence table", () => {
    assert.equal(DOSSIER_CANNOT_WRITE_EVIDENCE, true);
  });

  it("scores a national official page above a private recap", () => {
    const national = scoreDossierItem({
      sourceName: "Egypt Ministry of Agriculture",
      sourceUrl: "https://moa.gov.eg/digital-extension",
      year: 2025,
      title: "Egypt digital agricultural extension programme",
      summary: "MALR describes the national digital extension model for farmers.",
      countryName: "Egypt",
    });
    const other = scoreDossierItem({
      sourceName: "Blog recap",
      sourceUrl: "https://example.com/egypt-agtech",
      year: 2021,
      title: "Notes",
      summary: "A brief mention of agriculture.",
      countryName: "Egypt",
    });
    assert.ok(national.total > other.total);
    assert.equal(national.sourceClass, "national");
    assert.ok(national.total >= 70);
  });

  it("rejects blocked hosts and missing URLs", () => {
    assert.equal(
      validateDossierHit(
        {
          title: "Egypt digital agriculture wikipedia",
          summary: "A long enough summary about farmers and digital tools in Egypt.",
          sourceName: "Wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/Agriculture_in_Egypt",
          informs: "chapter-1",
        },
        "Egypt",
        2026,
      ),
      null,
    );
    assert.equal(
      validateDossierHit(
        {
          title: "Egypt AI strategy agriculture",
          summary: "National AI strategy mentions agriculture and water management.",
          sourceName: "MCIT",
          sourceUrl: "not-a-url",
        },
        "Egypt",
        2026,
      ),
      null,
    );
  });

  it("parses cited hits and keeps relatedIndicator as a lead only", () => {
    const hits = parseDossierHits(
      JSON.stringify([
        {
          title: "Egypt Personal Data Protection Law No. 151 of 2020",
          summary: "OECD notes enactment of Law 151/2020 on personal data protection.",
          year: 2020,
          sourceName: "OECD AI Review of Egypt",
          sourceUrl: "https://www.oecd.org/content/dam/oecd/en/publications/reports/2024/05/oecd-artificial-intelligence-review-of-egypt_3c437131/2a282726-en.pdf",
          informs: "named-lead",
          relatedIndicator: "4.1",
        },
      ]),
      "Egypt",
      2026,
    );
    assert.equal(hits.length, 1);
    const item = toDossierItem(hits[0], "Egypt", 2026, "d1");
    assert.equal(item.relatedIndicator, "4.1");
    assert.equal(item.informs, "named-lead");
    assert.notEqual(item.score, undefined);
  });

  it("feeds chapters 1–2 without changing CMS or unlocking policy chapters", () => {
    const rows = emptyEvidenceRows(model);
    const card = scoreAssessment(model, rows);
    const chapters = chapterReadiness(model, [], true);
    const claim = claimableStage(card, { currentStep: 1, mandateRecorded: false, validationRecorded: false });
    const evidence = model.indicators.map((i) => ({
      id: i.id,
      name: i.name,
      pillar: i.pillar,
      role: i.role,
      value: null,
      year: null,
      source: null,
      sourceUrl: null,
      confidence: null,
      provenance: "named-gap" as const,
      proxy: false,
      proxyNote: null,
      dataGap: false,
      gapSteward: "steward",
      suggested: null,
      assessor: null,
      final: null,
      stale: false,
      gate: i.gate,
    }));
    const dossier = [
      {
        title: "Egypt National AI Strategy",
        summary: "Agriculture and water management are named application areas.",
        year: 2025,
        sourceName: "MCIT",
        sourceUrl: "https://ai.gov.eg/strategy.pdf",
        grade: "A",
        score: 88,
        informs: "named-lead",
        relatedIndicator: "4.6",
      },
    ];
    const without = assembleDeterministicDraft(model, {
      countryName: "Egypt",
      iso3: "EGY",
      generatedAt: "2026-01-01T00:00:00.000Z",
      modelVersion: model.version,
      assessmentYear: model.assessment_year,
      currentStep: 2,
      mandateRecorded: false,
      validationRecorded: false,
      scorecard: card,
      claim,
      chapters,
      decisions: [],
      evidence,
      targeting: null,
      gauntletPassed: false,
    });
    const withDossier = assembleDeterministicDraft(model, {
      countryName: "Egypt",
      iso3: "EGY",
      generatedAt: "2026-01-01T00:00:00.000Z",
      modelVersion: model.version,
      assessmentYear: model.assessment_year,
      currentStep: 2,
      mandateRecorded: false,
      validationRecorded: false,
      scorecard: card,
      claim,
      chapters,
      decisions: [],
      evidence,
      targeting: null,
      gauntletPassed: false,
      dossier,
    });
    const ch1 = withDossier.chapters.find((c) => c.n === "1")?.body ?? "";
    const ch4 = withDossier.chapters.find((c) => c.n === "4")?.body ?? "";
    assert.match(ch1, /Country dossier \(not scored\)/i);
    assert.match(ch1, /Egypt National AI Strategy/);
    assert.match(ch4, /not drafted|gauntlet has not passed/i);
    assert.equal(without.chapters.find((c) => c.n === "2")?.body.includes("CMS"), withDossier.chapters.find((c) => c.n === "2")?.body.includes("CMS"));
  });
});
