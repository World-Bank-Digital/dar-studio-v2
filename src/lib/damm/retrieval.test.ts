import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExtractionPrompt, buildQuery, validateAgainstDocuments } from "./retrieval.ts";
import type { SearchHit } from "./search.ts";

const DOC: SearchHit = {
  title: "Statistical Yearbook 2024",
  url: "https://www.nsb.gov.bt/yearbook-2024",
  snippet: "",
  text: "Rural 3G population coverage reached 65 per cent in 2024, according to the regulator's returns.",
  publishedYear: 2024,
};

const ALLOWED = new Set(["2.1"]);
const YEAR = 2026;

function good(overrides: Record<string, unknown> = {}) {
  return {
    id: "2.1",
    value: 65,
    year: 2024,
    sourceName: "National Statistics Bureau",
    sourceUrl: DOC.url,
    quote: "Rural 3G population coverage reached 65 per cent in 2024",
    isProxy: false,
    proxyNote: null,
    ...overrides,
  };
}

describe("buildQuery", () => {
  it("names the country, the indicator and a recent year window", () => {
    const q = buildQuery({
      indicator: { id: "2.1", name: "Rural 3G coverage", anchors: { L5: "" } as never },
      countryName: "Bhutan",
      assessmentYear: 2026,
    });
    assert.match(q, /Bhutan/);
    assert.match(q, /Rural 3G coverage/);
    assert.match(q, /2023-2026/);
  });
});

describe("buildExtractionPrompt", () => {
  it("tells the model it is extracting, not searching", () => {
    const prompt = buildExtractionPrompt({
      countryName: "Bhutan",
      iso3: "BTN",
      assessmentYear: YEAR,
      indicators: [{ id: "2.1", name: "Rural 3G coverage", anchors: { L5: "full" } as never }],
      documents: [DOC],
    });
    assert.match(prompt, /You are not searching/);
    assert.match(prompt, /ONLY the document text provided/);
    assert.ok(prompt.includes(DOC.url));
    assert.ok(prompt.includes("Rural 3G population coverage reached 65 per cent"));
  });
});

describe("validateAgainstDocuments", () => {
  it("accepts a reading whose quotation is present in the retrieved page", () => {
    const out = validateAgainstDocuments(good(), ALLOWED, YEAR, [DOC]);
    assert.ok("reading" in out);
    assert.equal(out.reading.value, 65);
    assert.equal(out.reading.sourceUrl, DOC.url);
  });

  it("rejects a URL the process never actually fetched", () => {
    const out = validateAgainstDocuments(good({ sourceUrl: "https://www.nsb.gov.bt/some-other-page" }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /not among the retrieved documents/i);
  });

  it("rejects a figure that is not in the quoted passage", () => {
    const out = validateAgainstDocuments(good({ value: 88 }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /does not appear|not found/i);
  });

  it("rejects a quotation absent from the page, however plausible", () => {
    const out = validateAgainstDocuments(
      good({ quote: "Rural 3G population coverage reached 65 per cent in every district" }),
      ALLOWED,
      YEAR,
      [DOC],
    );
    assert.ok("rejected" in out);
  });

  it("rejects an indicator outside the requested batch", () => {
    const out = validateAgainstDocuments(good({ id: "9.9" }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /not in the requested batch/i);
  });

  it("rejects an observation year the assessment cannot contain", () => {
    const out = validateAgainstDocuments(good({ year: 2031 }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /outside/i);
  });

  it("rejects a non-numeric value rather than coercing it", () => {
    const out = validateAgainstDocuments(good({ value: "sixty-five" }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
  });

  it("rejects a reading with no citable source name", () => {
    const out = validateAgainstDocuments(good({ sourceName: "" }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
  });

  it("rejects an excluded host even when the quotation checks out", () => {
    const wiki: SearchHit = { ...DOC, url: "https://en.wikipedia.org/wiki/Bhutan" };
    const out = validateAgainstDocuments(good({ sourceUrl: wiki.url }), ALLOWED, YEAR, [wiki]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /excluded list/i);
  });

  it("always states why a reading was dropped, so a thin result can be explained", () => {
    const out = validateAgainstDocuments(good({ value: 88 }), ALLOWED, YEAR, [DOC]);
    assert.ok("rejected" in out);
    assert.ok(out.rejected.reason.length > 10);
    assert.equal(out.rejected.indicatorId, "2.1");
  });
});

describe("query hygiene (LEARNINGS L11)", () => {
  it("strips unit notation that drove live queries to zero results", async () => {
    const { cleanQueryTerm, buildQuery } = await import("./retrieval.ts");
    assert.equal(cleanQueryTerm("Farmers using climate-smart/sustainable practices (%)"), "Farmers using climate-smart sustainable practices");
    assert.equal(cleanQueryTerm("Average download speed in agricultural areas (Mbps)"), "Average download speed in agricultural areas");
    const q = buildQuery({
      indicator: { id: "8.1", name: "Post-harvest loss rate (%)", anchors: { L5: "" } as never, preferredSource: "Ookla / national QoS" },
      countryName: "Egypt, Arab Rep.",
      assessmentYear: 2026,
    });
    assert.doesNotMatch(q, /[()%/]/);
  });
});

describe("scoped-then-open document collection (LEARNINGS L11)", () => {
  const HIT = (url: string, text = "some page text 65 per cent"): SearchHit => ({ title: "t", url, snippet: "", text, publishedYear: 2024 });
  const IND = [{ id: "2.1", name: "Rural 3G coverage", anchors: { L5: "" } as never }];

  it("falls back to the open web when the NSO scope returns nothing", async () => {
    const { collectDocuments } = await import("./retrieval.ts");
    const calls: Array<string[] | null> = [];
    const searcher = {
      domainFilterLimit: 1 as const,
      async search(input: { includeDomains?: string[] }) {
        calls.push(input.includeDomains ?? null);
        // Scoped call: empty (the live 422 case). Open call: one document.
        return input.includeDomains ? { hits: [] } : { hits: [HIT("https://itu.int/report")] };
      },
    };
    const out = await collectDocuments({
      searcher, key: "k", indicators: IND, countryName: "Egypt", assessmentYear: 2026,
      nsoDomains: ["capmas.gov.eg"], resultsPerIndicator: 4,
    });
    assert.deepEqual(calls, [["capmas.gov.eg"], null], "expected scoped attempt then open fallback");
    assert.equal(out.documents.length, 1);
  });

  it("does not fall back when the scoped search already found usable text", async () => {
    const { collectDocuments } = await import("./retrieval.ts");
    const calls: Array<string[] | null> = [];
    const searcher = {
      domainFilterLimit: 1 as const,
      async search(input: { includeDomains?: string[] }) {
        calls.push(input.includeDomains ?? null);
        return { hits: [HIT("https://capmas.gov.eg/stats")] };
      },
    };
    const out = await collectDocuments({
      searcher, key: "k", indicators: IND, countryName: "Egypt", assessmentYear: 2026,
      nsoDomains: ["capmas.gov.eg"], resultsPerIndicator: 4,
    });
    assert.equal(calls.length, 1, "open-web call should not have happened");
    assert.equal(out.documents.length, 1);
  });

  it("searches the open web directly when a country has no NSO domains", async () => {
    const { collectDocuments } = await import("./retrieval.ts");
    const calls: Array<string[] | null> = [];
    const searcher = {
      domainFilterLimit: "all" as const,
      async search(input: { includeDomains?: string[] }) {
        calls.push(input.includeDomains ?? null);
        return { hits: [] };
      },
    };
    await collectDocuments({
      searcher, key: "k", indicators: IND, countryName: "Nowhere", assessmentYear: 2026,
      nsoDomains: [], resultsPerIndicator: 4,
    });
    assert.deepEqual(calls, [null]);
  });
});
