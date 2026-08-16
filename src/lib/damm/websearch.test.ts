import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJsonArray, parseSearchReadings, validateReading, isBlockedHost, buildSearchPrompt } from "./websearch.ts";
import { isGovernmentHost } from "./nso.ts";

describe("search payload parser", () => {
  it("reads a fenced JSON array and drops invented or uncited rows", () => {
    const text = `Here you go:\n\`\`\`json\n[${JSON.stringify({
      id: "6.1",
      value: 23.96,
      year: 2025,
      sourceName: "WIPO Global Innovation Index 2025",
      sourceUrl: "https://www.wipo.int/web-publications/global-innovation-index-2025/en/gii-2025-results.html",
      quote: "Egypt score 23.96",
    })},{"id":"6.3","value":"n/a"},{"id":"99.9","value":1,"year":2024,"sourceName":"x","sourceUrl":"https://example.com"}]\n\`\`\``;
    const rows = parseSearchReadings(text, new Set(["6.1", "6.3"]), 2026);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "6.1");
    assert.equal(rows[0].value, 23.96);
    assert.equal(rows[0].year, 2025);
  });

  it("rejects wikipedia and social recaps", () => {
    assert.equal(isBlockedHost("https://en.wikipedia.org/wiki/Egypt"), true);
    const row = validateReading(
      {
        id: "4.3",
        value: 50,
        year: 2024,
        sourceName: "Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Government_AI_Readiness_Index",
      },
      new Set(["4.3"]),
      2026,
    );
    assert.equal(row, null);
  });

  it("rejects a year after the assessment year and a missing URL", () => {
    assert.equal(
      validateReading(
        { id: "3.2", value: 50, year: 2029, sourceName: "ODIN", sourceUrl: "https://odin.opendatawatch.com/" },
        new Set(["3.2"]),
        2026,
      ),
      null,
    );
    assert.equal(
      validateReading({ id: "3.2", value: 50, year: 2024, sourceName: "ODIN" }, new Set(["3.2"]), 2026),
      null,
    );
  });

  it("parses a bare array", () => {
    assert.deepEqual(parseJsonArray('[{"a":1}]'), [{ a: 1 }]);
    assert.deepEqual(parseJsonArray("not json"), []);
  });

  it("names the national statistical office in the prompt", () => {
    const prompt = buildSearchPrompt({
      countryName: "Egypt, Arab Rep.",
      iso3: "EGY",
      nsoDomains: ["capmas.gov.eg"],
      indicators: [
        {
          id: "6.1",
          name: "Global Innovation Index (GII) score",
          anchors: { L1: "<20", L2: "20", L3: "40", L4: "60", L5: ">=80" },
          preferredSource: "WIPO GII",
        },
      ],
    });
    assert.match(prompt, /capmas\.gov\.eg/);
    assert.match(prompt, /6\.1 Global Innovation Index/);
    assert.match(prompt, /Never estimate/);
  });
});

describe("national hosts", () => {
  it("treats CAPMAS and other .gov hosts as government", () => {
    assert.equal(isGovernmentHost("capmas.gov.eg"), true);
    assert.equal(isGovernmentHost("www.usda.gov"), true);
    assert.equal(isGovernmentHost("example.com"), false);
  });
});
