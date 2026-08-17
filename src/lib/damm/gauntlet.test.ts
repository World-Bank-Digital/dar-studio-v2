import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateGauntlet } from "./gauntlet.ts";
import { emptyRow } from "./scoring.ts";
import { model } from "./model.ts";
import type { EvidenceRow } from "./types.ts";

function base(id: string, patch: Partial<EvidenceRow> = {}): EvidenceRow {
  return { ...emptyRow(id), ...patch, indicatorId: id };
}

function census(overrides: Record<string, Partial<EvidenceRow>>): EvidenceRow[] {
  return model.indicators.map((ind) => base(ind.id, overrides[ind.id]));
}

const strong = {
  value: 80,
  observationYear: 2024,
  sourceName: "World Bank WDI rural series",
  sourceUrl: "https://data.worldbank.org/indicator/EG.ELC.ACCS.RU.ZS",
  isProxy: false,
  provenance: "machine-imported" as const,
  confidence: "High" as const,
};

describe("evidence gauntlet", () => {
  it("fails a desk pack with silent named gaps on the 13 gates", () => {
    const rows = census({
      "2.9": strong,
    });
    const g = evaluateGauntlet(rows, "EGY");
    assert.equal(g.passed, false);
    assert.ok(g.populated < g.populatedNeeded);
    assert.ok(g.silentGaps.length > 0);
    assert.ok(g.tasks.some((t) => t.indicatorId === "3.3" && t.priority === "blocking"));
    assert.match(g.summary, /not cleared/i);
    const rubric = g.lines.find((l) => l.indicatorId === "3.3");
    assert.equal(rubric?.kind, "rubric");
    assert.equal(rubric?.reading, "Documentary — unmeasured");
    const series = g.lines.find((l) => l.indicatorId === "2.9");
    assert.equal(series?.kind, "quantitative");
    assert.match(series?.reading ?? "", /%/);
  });

  it("passes only when 11 gates are A/B and the rest are human data gaps", () => {
    const filled = ["2.1", "2.5", "2.9", "3.3", "3.11", "4.1", "4.2", "4.5", "4.9", "5.5", "5.7"];
    const overrides: Record<string, Partial<EvidenceRow>> = {
      "7.9": { dataGap: true, provenance: "assessor", notes: "No ministry CISO report this cycle" },
      "7.12": { dataGap: true, provenance: "assessor", notes: "Consent policy not yet issued" },
    };
    for (const id of filled) {
      overrides[id] = {
        ...strong,
        assessorLevel: 3,
        provenance: "assessor",
        sourceName: id === "2.1" ? "NTRA rural 3G coverage" : strong.sourceName,
        sourceUrl:
          id === "2.1"
            ? "https://www.ntra.gov.eg/coverage"
            : id === "2.5"
              ? "https://www.itu.int/en/ITU-D/Statistics/Pages/ICTprices.aspx"
              : strong.sourceUrl,
        isProxy: false,
      };
    }
    const g = evaluateGauntlet(census(overrides), "EGY");
    assert.equal(g.populated, 11);
    assert.equal(g.accounted, 13);
    assert.equal(g.silentGaps.length, 0);
    assert.ok(g.gradeAB >= g.abNeeded);
    assert.equal(g.passed, true);
  });

  it("does not let a C/D reading sneak through without a human gap mark", () => {
    const overrides: Record<string, Partial<EvidenceRow>> = {};
    for (const id of ["2.1", "2.5", "2.9", "3.3", "3.11", "4.1", "4.2", "4.5", "4.9", "5.5", "5.7", "7.9", "7.12"]) {
      overrides[id] = {
        value: 50,
        observationYear: 2015,
        sourceName: "Consultant slide deck",
        sourceUrl: "https://example.com/deck.pdf",
        isProxy: true,
        provenance: "manual",
      };
    }
    const g = evaluateGauntlet(census(overrides), "EGY");
    assert.equal(g.passed, false);
    assert.ok(g.weakReadings.length > 0);
  });
});
