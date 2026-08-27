import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SEARCH_PROVIDER_IDS,
  isSearchProviderId,
  normalizeForMatch,
  numberAppearsIn,
  parseExaResults,
  parseJinaResults,
  searchProviderDef,
  verifyQuote,
  yearFromDate,
} from "./search.ts";

describe("search catalogue", () => {
  it("offers Exa and Jina", () => {
    assert.deepEqual(SEARCH_PROVIDER_IDS.slice().sort(), ["exa", "jina"]);
    for (const id of SEARCH_PROVIDER_IDS) assert.ok(searchProviderDef(id));
  });

  it("rejects an unknown search provider", () => {
    assert.equal(isSearchProviderId("tavily"), false);
    assert.equal(searchProviderDef("tavily"), null);
  });

  it("records that Jina scopes to a single site per query", () => {
    assert.equal(searchProviderDef("jina")!.domainFilterLimit, 1);
    assert.equal(searchProviderDef("exa")!.domainFilterLimit, "all");
  });
});

describe("result parsing", () => {
  it("parses Exa results and keeps the published year", () => {
    const hits = parseExaResults({
      results: [{ title: "Yearbook", url: "https://nsb.gov.bt/a", text: "3G coverage 65%", publishedDate: "2024-06-01" }],
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].publishedYear, 2024);
    assert.match(hits[0].text, /65%/);
  });

  it("parses Jina results", () => {
    const hits = parseJinaResults({
      data: [{ title: "Report", url: "https://itu.int/b", description: "summary", content: "body text" }],
    });
    assert.equal(hits[0].url, "https://itu.int/b");
    assert.equal(hits[0].snippet, "summary");
  });

  it("drops results with no URL rather than inventing one", () => {
    assert.equal(parseExaResults({ results: [{ title: "no url" }] }).length, 0);
    assert.equal(parseJinaResults({ data: [{ title: "no url" }] }).length, 0);
  });

  it("reads a year only from a plausible range", () => {
    assert.equal(yearFromDate("2023-01-01"), 2023);
    assert.equal(yearFromDate("not a date"), null);
    assert.equal(yearFromDate(null), null);
  });
});

describe("numberAppearsIn", () => {
  it("matches a figure written with separators", () => {
    assert.equal(numberAppearsIn("a total of 1,234,567 farmers", 1234567), true);
  });

  it("accepts the publisher's own rounding", () => {
    assert.equal(numberAppearsIn("coverage was 65.0 per cent", 65), true);
    assert.equal(numberAppearsIn("coverage was 65 per cent", 65.2), true);
  });

  it("refuses a unit conversion — 0.55 is not 55%", () => {
    assert.equal(numberAppearsIn("the index stands at 55", 0.55), false);
  });

  it("refuses a figure that is simply absent", () => {
    assert.equal(numberAppearsIn("coverage was 65 per cent", 78), false);
  });
});

describe("verifyQuote", () => {
  const page =
    "The National Statistics Bureau reports that rural 3G population coverage reached 65 per cent in 2024, " +
    "up from 61 per cent in 2022.";

  it("accepts a verbatim quotation containing the figure", () => {
    const res = verifyQuote(page, "rural 3G population coverage reached 65 per cent in 2024", 65);
    assert.equal(res.ok, true);
  });

  it("tolerates whitespace and curly-quote differences", () => {
    const res = verifyQuote(page, "rural  3G population   coverage reached 65 per cent", 65);
    assert.equal(res.ok, true);
  });

  it("rejects a quotation that is not on the page", () => {
    const res = verifyQuote(page, "rural 3G coverage reached 92 per cent in 2025", 92);
    assert.equal(res.ok, false);
    assert.match(res.reason ?? "", /not found/i);
  });

  it("rejects a real quotation carrying a figure it does not contain", () => {
    const res = verifyQuote(page, "rural 3G population coverage reached 65 per cent in 2024", 78);
    assert.equal(res.ok, false);
    assert.match(res.reason ?? "", /does not appear/i);
  });

  it("rejects when no page text was retrieved, rather than passing by default", () => {
    assert.equal(verifyQuote("", "anything", 1).ok, false);
    assert.equal(verifyQuote(page, "", 1).ok, false);
  });

  it("does not let a few shared words pass as a quotation", () => {
    const res = verifyQuote(page, "the bureau said coverage was excellent overall this year", 65);
    assert.equal(res.ok, false);
  });
});

describe("normalizeForMatch", () => {
  it("unifies quotes, dashes and non-breaking spaces", () => {
    assert.equal(normalizeForMatch("“a b” — c"), '"a b" - c');
  });
});

describe("verifyQuote — appended fabrication", () => {
  const page =
    "The National Statistics Bureau reports that rural 3G population coverage reached 65 per cent in 2024, " +
    "up from 61 per cent in 2022.";

  it("rejects a genuine sentence with an invented clause bolted on", () => {
    const res = verifyQuote(page, "rural 3G population coverage reached 65 per cent in every district", 65);
    assert.equal(res.ok, false);
  });

  it("still tolerates a footnote marker breaking the run", () => {
    const withMarker = page.replace("65 per cent", "65 per cent[1]");
    const res = verifyQuote(withMarker, "rural 3G population coverage reached 65 per cent in 2024", 65);
    assert.equal(res.ok, true);
  });
});

describe("jina no-results handling (LEARNINGS L11)", () => {
  it("treats HTTP 422 as an empty result, not a provider failure", async () => {
    const { jinaTreatsAsEmpty } = await import("./search.ts");
    assert.equal(jinaTreatsAsEmpty(422), true);
    assert.equal(jinaTreatsAsEmpty(429), false);
    assert.equal(jinaTreatsAsEmpty(500), false);
  });
});

describe("search retry on transient failure (the run-11 dry pass)", () => {
  const original = globalThis.fetch;
  const okResponse = () => new Response(JSON.stringify({ data: [] }), { status: 200 });

  it("retries a network failure and succeeds on the second attempt", async () => {
    const { fetchWithRetry } = await import("./search.ts");
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return okResponse();
    }) as typeof fetch;
    try {
      const res = await fetchWithRetry("https://s.jina.ai/?q=x", {}, 5000, [10, 20]);
      assert.equal(res.status, 200);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("retries 429 throttling but returns the final 429 when it persists", async () => {
    const { fetchWithRetry } = await import("./search.ts");
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("slow down", { status: 429 });
    }) as typeof fetch;
    try {
      const res = await fetchWithRetry("https://s.jina.ai/?q=x", {}, 5000, [10, 20]);
      assert.equal(res.status, 429, "the caller still sees the throttle after retries are spent");
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not retry a non-transient failure — a bad key is not a blip", async () => {
    const { fetchWithRetry } = await import("./search.ts");
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("nope", { status: 401 });
    }) as typeof fetch;
    try {
      const res = await fetchWithRetry("https://s.jina.ai/?q=x", {}, 5000, [10, 20]);
      assert.equal(res.status, 401);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("gives up after the delays are exhausted and surfaces the network error", async () => {
    const { fetchWithRetry } = await import("./search.ts");
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      await assert.rejects(() => fetchWithRetry("https://s.jina.ai/?q=x", {}, 5000, [10, 20]), /fetch failed/);
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = original;
    }
  });
});
