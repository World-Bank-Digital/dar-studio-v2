import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credibilityFor, importedCredibilitySummary } from "./credibility.ts";

describe("source credibility", () => {
  it("scores an official exact series as A 95", () => {
    const c = credibilityFor({
      sourceName: "World Bank WDI / ITU",
      sourceUrl: "https://data.worldbank.org/indicator/IT.NET.USER.ZS",
      isProxy: false,
      provenance: "machine-imported",
    });
    assert.equal(c.tier, "A");
    assert.equal(c.score, 95);
  });

  it("scores an official documented proxy as B 80", () => {
    const c = credibilityFor({
      sourceName: "ITU DataHub — population covered by at least 3G (national, via World Bank Data360)",
      sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
      isProxy: true,
      provenance: "proxy",
    });
    assert.equal(c.tier, "B");
    assert.equal(c.score, 80);
  });

  it("scores an OWID research compilation as D, not as an official series", () => {
    const c = credibilityFor({
      sourceName: "Our World in Data — mean years of schooling (Wittgenstein Centre / Barro-Lee long-run)",
      sourceUrl: "https://ourworldindata.org/grapher/mean-years-of-schooling",
      isProxy: true,
      provenance: "proxy",
    });
    assert.equal(c.tier, "D");
    assert.equal(c.score, 45);
  });

  it("scores a named gap as E and does not treat it as a reading", () => {
    const c = credibilityFor({
      sourceName: "National farmer registry",
      provenance: "named-gap",
    });
    assert.equal(c.tier, "E");
    assert.equal(c.score, 20);
  });

  it("scores a national statistical office as official", () => {
    const c = credibilityFor({
      sourceName: "CAPMAS — Egypt in Figures 2025",
      sourceUrl: "https://www.capmas.gov.eg/Pages/Publications.aspx",
      isProxy: false,
    });
    assert.equal(c.tier, "A");
  });

  it("means only imported readings and never invents a score from gaps", () => {
    const summary = importedCredibilitySummary([
      {
        value: 74.65,
        sourceName: "World Bank WDI / ITU",
        sourceUrl: "https://data.worldbank.org/indicator/IT.NET.USER.ZS",
        isProxy: false,
        provenance: "machine-imported",
      },
      {
        value: 99.8,
        sourceName: "ITU DataHub",
        sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
        isProxy: true,
        provenance: "proxy",
      },
      { value: null, provenance: "named-gap", sourceName: "gap" },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.mean, 88);
    assert.equal(summary.byTier.A, 1);
    assert.equal(summary.byTier.B, 1);
    assert.equal(summary.byTier.E, 0);
  });
});
