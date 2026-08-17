import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreEvidence } from "./evidenceScore.ts";
import { mandatoryEntries, REGISTRY } from "./registry.ts";

describe("indicator registry", () => {
  it("covers every DAMM indicator and marks exactly the 13 core gates as mandatory", () => {
    assert.equal(REGISTRY.length, 97);
    const mandatory = mandatoryEntries();
    assert.equal(mandatory.length, 13);
    assert.deepEqual(
      mandatory.map((m) => m.id),
      ["2.1", "2.5", "2.9", "3.3", "3.11", "4.1", "4.2", "4.5", "4.9", "5.5", "5.7", "7.9", "7.12"],
    );
    assert.equal(mandatory.filter((m) => m.kind === "quantitative").length, 5);
    assert.ok(mandatory.every((m) => m.definition.length > 20 && m.nationalFirst && m.internationalFallback));
  });
});

describe("evidence score /100", () => {
  it("scores a national exact series above an international official series", () => {
    const national = scoreEvidence({
      indicatorId: "2.9",
      value: 100,
      observationYear: 2023,
      sourceName: "CAPMAS — Egypt in Figures, rural electricity access",
      sourceUrl: "https://www.capmas.gov.eg/Pages/Publications.aspx",
      isProxy: false,
      provenance: "machine-imported",
    });
    const intl = scoreEvidence({
      indicatorId: "2.9",
      value: 100,
      observationYear: 2023,
      sourceName: "World Bank WDI",
      sourceUrl: "https://data.worldbank.org/indicator/EG.ELC.ACCS.RU.ZS",
      isProxy: false,
      provenance: "machine-imported",
    });
    assert.equal(national.sourceClass, "national");
    assert.equal(intl.sourceClass, "international");
    assert.equal(intl.grade, "A");
  });

  it("caps a documented rural proxy at B and never A", () => {
    const s = scoreEvidence({
      indicatorId: "2.1",
      value: 99,
      observationYear: 2023,
      sourceName: "ITU DataHub — population covered by at least 3G (national)",
      sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
      isProxy: true,
      provenance: "proxy",
    });
    assert.equal(s.fit, "proxy");
    assert.notEqual(s.grade, "A");
    assert.ok(s.total < 85);
    assert.ok(s.grade === "B" || s.grade === "C");
  });

  it("scores a named gap as E with zero", () => {
    const s = scoreEvidence({
      indicatorId: "3.3",
      provenance: "named-gap",
    });
    assert.equal(s.grade, "E");
    assert.equal(s.total, 0);
    assert.equal(s.fit, "missing");
  });

  it("refuses A/B when there is no source URL", () => {
    const s = scoreEvidence({
      indicatorId: "2.5",
      value: 1.2,
      observationYear: 2023,
      sourceName: "World Bank WDI",
      isProxy: false,
      provenance: "machine-imported",
    });
    assert.ok(s.total <= 39);
    assert.ok(s.grade === "D" || s.grade === "E");
  });
});

describe("machine-researched proposals (L18)", () => {
  it("grades a researched proposal as populated but capped at C — both graders now agree", async () => {
    const { scoreEvidence } = await import("./evidenceScore.ts");
    const s = scoreEvidence({
      indicatorId: "3.3",
      value: null,
      assessorLevel: null,
      suggestedLevel: 4,
      provenance: "machine-researched",
      sourceName: "Ministry of Agriculture and Land Reclamation",
      sourceUrl: "https://www.moalr.gov.eg/farmers-card",
    });
    assert.equal(s.fit, "direct");
    assert.notEqual(s.grade, "E", "a cited proposal is not an empty row");
    assert.ok(s.grade === "C" || s.grade === "D", `capped below A/B, got ${s.grade}`);
    assert.match(s.note, /pending validation/i);
  });

  it("still treats a researched row without a level as missing", async () => {
    const { scoreEvidence } = await import("./evidenceScore.ts");
    const s = scoreEvidence({ indicatorId: "3.3", value: null, assessorLevel: null, suggestedLevel: null, provenance: "machine-researched" });
    assert.equal(s.grade, "E");
  });
});
