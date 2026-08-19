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
  it("fails a desk pack with silent named gaps on the core gates", () => {
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

  it("passes only when the populated gates are A/B and the rest are human data gaps", () => {
    // Derived from the model: v1.5 added a fourteenth core gate, and a literal
    // list here left it an unaccounted silent gap while the test still claimed
    // a pass. The two marked as human data gaps are the last two in the list.
    const gates = [...model.core_gates];
    const gapped = gates.slice(-2);
    const filled = gates.slice(0, -2);
    const overrides: Record<string, Partial<EvidenceRow>> = {
      [gapped[0]]: { dataGap: true, provenance: "assessor", notes: "No ministry CISO report this cycle" },
      [gapped[1]]: { dataGap: true, provenance: "assessor", notes: "Consent policy not yet issued" },
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
    assert.equal(g.populated, filled.length);
    assert.equal(g.accounted, gates.length);
    assert.equal(g.silentGaps.length, 0);
    assert.ok(g.gradeAB >= g.abNeeded);
    assert.equal(g.passed, true);
  });

  it("does not let a C/D reading sneak through without a human gap mark", () => {
    const overrides: Record<string, Partial<EvidenceRow>> = {};
    for (const id of model.core_gates) {
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
