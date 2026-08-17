import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleDeterministicDraft } from "./draft.ts";
import { emptyEvidenceRows } from "./draft.ts";
import { chapterReadiness } from "./ladder.ts";
import { claimableStage, scoreAssessment } from "./scoring.ts";
import { model } from "./model.ts";
import {
  dossierTopicSpecs,
  dossierTopics,
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

  it("feeds the diagnostic chapters without changing CMS; prescriptive chapters draft as conditional", () => {
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
    // Ch.2 is the agrifood diagnostic, where chapter-1 dossier leads surface.
    const ch1 = withDossier.chapters.find((c) => c.n === "2")?.body ?? "";
    const ch4 = withDossier.chapters.find((c) => c.n === "4")?.body ?? "";
    assert.match(ch1, /Country dossier \(not scored\)/i);
    assert.match(ch1, /Egypt National AI Strategy/);
    assert.match(ch4, /./);
    assert.equal(without.chapters.find((c) => c.n === "3")?.body.includes("CMS"), withDossier.chapters.find((c) => c.n === "3")?.body.includes("CMS"));
  });
});

describe("dossier search agenda", () => {
  const specs = dossierTopicSpecs("Egypt, Arab Rep.", "EGY", ["Wheat", "Cotton"]);

  it("covers every assessment domain the roadmap must form a view on", () => {
    const covered = new Set(specs.map((s) => s.domain));
    const required: Array<(typeof specs)[number]["domain"]> = [
      "agrifood-diagnostic",
      "digital-ecosystem",
      "farmer-registry",
      "dpi-interoperability",
      "inclusion",
      "institutions",
      "technology-ai",
      "foresight",
      "legal-governance",
      "investment-financing",
    ];
    for (const domain of required) {
      assert.ok(covered.has(domain), `no query covers ${domain}`);
    }
  });

  it("names the country in every query", () => {
    for (const s of specs) assert.match(s.query, /Egypt/);
  });

  it("folds the chosen value chains into the diagnostic sweep", () => {
    assert.ok(specs.some((s) => /Wheat/.test(s.query)));
  });

  it("treats the farmer registry as its own line of enquiry", () => {
    const registry = specs.filter((s) => s.domain === "farmer-registry");
    assert.ok(registry.length >= 3, "registry needs coverage, enrolment and payments queries");
  });

  it("keeps the legacy string form in step with the specs", () => {
    const strings = dossierTopics("Egypt, Arab Rep.", "EGY", ["Wheat", "Cotton"]);
    assert.deepEqual(strings, specs.map((s) => s.query));
  });

  it("assigns every topic a usable informs tag", () => {
    for (const s of specs) {
      assert.ok(["chapter-1", "chapter-2", "named-lead", "research-task"].includes(s.informs));
    }
  });
});

describe("dossier site scoping", () => {
  const specs = dossierTopicSpecs("Egypt, Arab Rep.", "EGY");

  it("confines only statistical topics to the statistics office", () => {
    const scoped = specs.filter((s) => s.preferNationalStats);
    assert.ok(scoped.length > 0, "some statistical topics should be scoped");
    for (const s of scoped) {
      assert.ok(
        ["agrifood-diagnostic", "inclusion"].includes(s.domain),
        `${s.domain} should not be confined to the statistics office`,
      );
    }
  });

  it("leaves legal, institutional and AI topics unscoped", () => {
    for (const s of specs) {
      if (["legal-governance", "institutions", "technology-ai", "investment-financing"].includes(s.domain)) {
        assert.equal(s.preferNationalStats, false, `${s.query} must not be pinned to the statistics office`);
      }
    }
  });

  it("no longer embeds a site: operator in the query text", () => {
    for (const s of specs) assert.doesNotMatch(s.query, /site:/);
  });
});
