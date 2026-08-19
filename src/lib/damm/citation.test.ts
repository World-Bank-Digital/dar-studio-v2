import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { citationError, isHttpUrl, nextProvenance } from "./citation.ts";
import { economyByName, FALLBACK_ECONOMIES } from "./countries.ts";
import { parseWbLatest, ingestQueue } from "./ingest.ts";
import { chainSuggestions } from "./chains.ts";
import { model } from "./model.ts";

describe("citation gate", () => {
  it("accepts only http(s) URLs", () => {
    assert.equal(isHttpUrl("https://data.worldbank.org/indicator/IT.NET.USER.ZS"), true);
    assert.equal(isHttpUrl("http://example.org/a"), true);
    assert.equal(isHttpUrl("javascript:alert(1)"), false);
    assert.equal(isHttpUrl("not-a-url"), false);
  });

  it("requires a named source and URL before a value can enter the evidence base", () => {
    assert.match(
      citationError({
        dataGap: false,
        value: 72.4,
        assessorLevel: null,
        sourceName: null,
        sourceUrl: null,
      }) ?? "",
      /source name/i,
    );
    assert.match(
      citationError({
        dataGap: false,
        value: 72.4,
        assessorLevel: null,
        sourceName: "World Bank WDI",
        sourceUrl: "ftp://bad",
      }) ?? "",
      /source URL/i,
    );
    assert.equal(
      citationError({
        dataGap: false,
        value: 72.4,
        assessorLevel: null,
        sourceName: "World Bank WDI",
        sourceUrl: "https://data.worldbank.org/indicator/IT.NET.USER.ZS",
      }),
      null,
    );
  });

  it("allows an explicit data gap without a citation", () => {
    assert.equal(
      citationError({
        dataGap: true,
        value: null,
        assessorLevel: null,
        sourceName: null,
        sourceUrl: null,
      }),
      null,
    );
  });

  it("promotes a filled named-gap to manual, and an assessor win to assessor", () => {
    assert.equal(
      nextProvenance({ dataGap: false, assessorLevel: null, value: 10, current: "named-gap" }),
      "manual",
    );
    assert.equal(
      nextProvenance({ dataGap: false, assessorLevel: 3, value: 10, current: "machine-imported" }),
      "assessor",
    );
    assert.equal(
      nextProvenance({ dataGap: false, assessorLevel: null, value: 10, current: "proxy" }),
      "proxy",
    );
  });
});

describe("Egypt is a first-class economy", () => {
  it("is in the fallback list as Egypt, Arab Rep. / EGY", () => {
    const egy = FALLBACK_ECONOMIES.find((e) => e.iso3 === "EGY");
    assert.ok(egy);
    assert.match(egy!.name, /Egypt/i);
  });

  it("resolves the common search string “Egypt” to EGY", () => {
    const hit = economyByName(FALLBACK_ECONOMIES, "Egypt");
    assert.ok(hit);
    assert.equal(hit!.iso3, "EGY");
  });
});

describe("ingest catalogue", () => {
  it("maps every indicator and keeps World Bank series fetchable", () => {
    const queue = ingestQueue();
    assert.equal(queue.length, model.indicators.length);
    const fetchable = queue.filter((s) => s.kind !== "named-gap");
    assert.ok(fetchable.length >= 20);
    assert.ok(fetchable.every((s) => Boolean(s.sourceName)));
    assert.ok(fetchable.filter((s) => s.kind === "worldbank").every((s) => Boolean(s.series)));
    assert.ok(fetchable.filter((s) => s.kind === "data360").every((s) => Boolean(s.databaseId && s.data360Indicator)));
  });

  it("parses the latest non-null World Bank observation", () => {
    const body = [
      { page: 1 },
      [
        { value: null, date: "2024" },
        { value: 72.2, date: "2023" },
        { value: 70.1, date: "2022" },
      ],
    ];
    assert.deepEqual(parseWbLatest(body), { value: 72.2, year: 2023 });
    assert.equal(parseWbLatest({ error: true }), null);
  });
});

describe("Egypt targeting suggestions", () => {
  it("offers cited wheat and citrus hypotheses", () => {
    const list = chainSuggestions("EGY");
    assert.ok(list.some((c) => c.name === "Wheat"));
    assert.ok(list.some((c) => c.name === "Citrus (oranges)"));
    assert.ok(list.every((c) => c.sourceUrl.startsWith("https://")));
  });
});
