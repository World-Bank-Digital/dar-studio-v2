import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFindingsPrompt,
  opportunisticTopics,
  practiceTopics,
  researchFindings,
  validateFinding,
} from "./findings.ts";
import type { SearchHit } from "./search.ts";

const DOC: SearchHit = {
  title: "Egypt launches Farmer's Card expansion",
  url: "https://www.moalr.gov.eg/farmers-card-2026",
  snippet: "",
  text: "The Ministry of Agriculture announced that the Farmer's Card now reaches 4.5 million registered farmers across all governorates, linked to subsidised inputs and credit.",
  publishedYear: 2026,
};

const FOREIGN: SearchHit = {
  title: "India AgriStack progress",
  url: "https://agristack.gov.in/progress",
  snippet: "",
  text: "India's AgriStack farmer registry now covers most states with digital land records integration.",
  publishedYear: 2026,
};

function goodFinding(overrides: Record<string, unknown> = {}) {
  return {
    topic: "landscape",
    claim: "Egypt's Farmer's Card programme reaches 4.5 million registered farmers across all governorates.",
    quote: "the Farmer's Card now reaches 4.5 million registered farmers across all governorates",
    sourceName: "Ministry of Agriculture and Land Reclamation",
    sourceUrl: DOC.url,
    year: 2026,
    pillarHint: "C2",
    ...overrides,
  };
}

const CTX = { kind: "opportunistic" as const, assessmentYear: 2026, countryIso2: "EG", documents: [DOC, FOREIGN] };

describe("sweep topics (pipeline points 3-4)", () => {
  it("casts a wide country net and loosens indicator gaps into plain phrases", () => {
    const topics = opportunisticTopics("Egypt, Arab Rep.", ["National farmer registry/database"]);
    assert.ok(topics.length >= 9);
    assert.ok(topics.every((t) => t.query.startsWith("Egypt ")));
    const gap = topics.find((t) => t.id === "gap-1");
    assert.ok(gap);
    assert.equal(gap!.query, "Egypt National farmer registry database");
  });

  it("stamps recency into practice queries", () => {
    const topics = practiceTopics(2026);
    assert.ok(topics.some((t) => t.query.includes("2026")));
    assert.ok(topics.every((t) => !t.query.includes("Egypt")), "practice research is global, not country-bound");
  });
});

describe("findings prompt", () => {
  it("anchors the opportunistic sweep to the country and the practice sweep to recency", () => {
    const opp = buildFindingsPrompt({ kind: "opportunistic", countryName: "Egypt, Arab Rep.", assessmentYear: 2026, topics: opportunisticTopics("Egypt, Arab Rep.").slice(0, 1), docsByTopic: new Map([["landscape", [DOC]]]) });
    assert.match(opp, /about Egypt SPECIFICALLY/);
    assert.match(opp, /never names Egypt, must be omitted/);
    const pr = buildFindingsPrompt({ kind: "practice", countryName: "Egypt, Arab Rep.", assessmentYear: 2026, topics: practiceTopics(2026).slice(0, 1), docsByTopic: new Map() });
    assert.match(pr, /ANY country or institution/);
    assert.match(pr, /2025–2026/);
  });

  it("carries the anti-defensive obligation and the verbatim-quote contract", () => {
    const p = buildFindingsPrompt({ kind: "opportunistic", countryName: "Egypt", assessmentYear: 2026, topics: opportunisticTopics("Egypt").slice(0, 1), docsByTopic: new Map([["landscape", [DOC]]]) });
    assert.match(p, /you MUST return it/);
    assert.match(p, /verbatim span/);
    assert.match(p, /document's own language/);
  });
});

describe("finding validation", () => {
  it("accepts a quote-verified, cited, on-country finding", () => {
    const out = validateFinding(goodFinding(), CTX);
    assert.ok("finding" in out, JSON.stringify(out));
    assert.equal(out.finding.publishedYear, 2026);
    assert.equal(out.finding.pillarHint, "C2");
    assert.ok(out.finding.credibility);
  });

  it("rejects a paraphrased quote — same bar as every other pass", () => {
    const out = validateFinding(goodFinding({ quote: "the card reaches around four and a half million farmers nationwide" }), CTX);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /offending quote/);
  });

  it("rejects a foreign government host for country findings but allows it for practices", () => {
    const foreign = goodFinding({
      claim: "India's AgriStack registry covers most states with digital land records integration today.",
      quote: "AgriStack farmer registry now covers most states with digital land records integration",
      sourceUrl: FOREIGN.url,
    });
    const opp = validateFinding(foreign, CTX);
    assert.ok("rejected" in opp);
    assert.match(opp.rejected.reason, /foreign government/i);
    const pr = validateFinding(foreign, { ...CTX, kind: "practice" });
    assert.ok("finding" in pr, JSON.stringify(pr));
  });

  it("enforces the past-year window for practices only", () => {
    const OLD: SearchHit = { ...DOC, url: "https://www.fao.org/old-strategy", text: DOC.text, publishedYear: 2021 };
    const old = goodFinding({ sourceUrl: OLD.url, year: 2021 });
    const asPractice = validateFinding(old, { ...CTX, kind: "practice", documents: [OLD] });
    assert.ok("rejected" in asPractice);
    assert.match(asPractice.rejected.reason, /past-year window/);
    const asOpportunistic = validateFinding(old, { ...CTX, documents: [OLD] });
    assert.ok("finding" in asOpportunistic, "country evidence may be older; the year is recorded, not gated");
  });

  it("nulls an invalid pillar hint rather than trusting it", () => {
    const out = validateFinding(goodFinding({ pillarHint: "Z9" }), CTX);
    assert.ok("finding" in out);
    assert.equal(out.finding.pillarHint, null);
  });

  it("falls back to the document's published year when the model omits one", () => {
    const out = validateFinding(goodFinding({ year: null }), CTX);
    assert.ok("finding" in out);
    assert.equal(out.finding.publishedYear, 2026);
  });
});

describe("researchFindings wiring", () => {
  it("sweeps, extracts, validates, dedupes — and keeps foreign gov docs out of opportunistic prompts", async () => {
    const prompts: string[] = [];
    const out = await researchFindings(
      {
        kind: "opportunistic",
        search: { providerId: "jina", key: "sk" },
        model: { providerId: "openrouter", key: "mk", modelName: "m" },
        countryName: "Egypt, Arab Rep.",
        iso3: "EGY",
        assessmentYear: 2026,
        topics: opportunisticTopics("Egypt, Arab Rep.").slice(0, 2),
      },
      {
        searcher: { domainFilterLimit: "all", search: async () => ({ hits: [DOC, FOREIGN] }) },
        extractor: {
          chat: async (inp: { user: string }) => {
            prompts.push(inp.user);
            return { text: JSON.stringify([goodFinding(), goodFinding()]) };
          },
        },
      },
    );
    assert.equal(out.findings.length, 1, "duplicate claims collapse");
    assert.equal(out.findings[0].kind, "opportunistic");
    assert.ok(!prompts[0].includes("agristack.gov.in"), "foreign gov doc must not reach the opportunistic prompt");
    assert.ok(prompts[0].includes(DOC.url));
  });
});
