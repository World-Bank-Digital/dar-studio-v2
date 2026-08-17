import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRubricPrompt,
  buildRubricQuery,
  parseJsonObject,
  proposalNote,
  researchableRubrics,
  validateRubricProposal,
} from "./rubric.ts";
import { model } from "./model.ts";
import type { SearchHit } from "./search.ts";

const REGISTRY = model.indicators.find((i) => i.id === "3.3")!;

// The reference case: the user's own web assessment of Egypt's farmer registry,
// which specified the shape this pass must produce — clause-mapped evidence for
// the proposed level plus the explicit negative finding for the next one.
const DECREE: SearchHit = {
  title: "Farmer's Card system implementation",
  url: "https://www.moalr.gov.eg/farmers-card",
  snippet: "",
  text:
    "The Ministry of Agriculture and the Ministry of Communications co-manage the national Farmer's Card system. " +
    "The card is mandatory for government-subsidised fertilisers, seeds and agricultural credit. " +
    "The digital network is integrated with the Agricultural Bank of Egypt and e-finance services. " +
    "Millions of traditional paper landholdings have been digitised across the governorates.",
  publishedYear: 2024,
};

function egyptProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "3.3",
    proposedLevel: 4,
    rationale:
      "Accountable governance: the system is co-managed by the Ministry of Agriculture and the Ministry of Communications. " +
      "Interoperability: the network is integrated with the Agricultural Bank of Egypt and e-finance. " +
      "Broad use: the card is mandatory for subsidised fertilisers, seeds and credit. " +
      "Beyond L3: millions of paper landholdings digitised across the governorates — not partial coverage.",
    whyNotHigher:
      "L5 requires total nationwide inclusion; isolated smallholders and informal tenants are not yet fully in the digital ecosystem.",
    citations: [
      {
        sourceName: "Ministry of Agriculture and Land Reclamation",
        sourceUrl: DECREE.url,
        quote: "The card is mandatory for government-subsidised fertilisers, seeds and agricultural credit.",
      },
    ],
    ...overrides,
  };
}

describe("rubric research targets", () => {
  it("covers the anchored rubrics and leaves quantitative and context indicators alone", () => {
    const targets = researchableRubrics(model.indicators);
    assert.equal(targets.length, 42, "anchored capability + evidence-quality rubrics");
    assert.ok(targets.some((i) => i.id === "3.3"));
    assert.ok(!targets.some((i) => i.id === "2.1"), "quantitative indicators are the search pass's job");
    assert.ok(!targets.some((i) => i.id === "1.5"), "context profile items are never rubric-scored");
  });

  it("aims the query at documents, not statistics", () => {
    const q = buildRubricQuery(REGISTRY, "Egypt, Arab Rep.");
    assert.match(q, /Egypt/);
    assert.match(q, /farmer registry/i);
    assert.match(q, /official/);
    assert.doesNotMatch(q, /[()%]/);
  });
});

describe("rubric prompt", () => {
  it("carries all five anchor texts verbatim and demands the negative finding", () => {
    const prompt = buildRubricPrompt({ countryName: "Egypt, Arab Rep.", iso3: "EGY", indicator: REGISTRY, documents: [DECREE] });
    for (const lv of ["L1", "L2", "L3", "L4", "L5"] as const) {
      assert.ok(prompt.includes(REGISTRY.anchors[lv].slice(0, 60)), `${lv} anchor missing`);
    }
    assert.match(prompt, /whyNotHigher/);
    assert.match(prompt, /Quotes are checked/);
    assert.ok(prompt.includes(DECREE.url));
  });
});

describe("proposal validation (the Egypt registry reference case)", () => {
  it("accepts the clause-mapped L4 proposal with its negative finding", () => {
    const out = validateRubricProposal(egyptProposal(), "3.3", [DECREE]);
    assert.ok("proposal" in out, JSON.stringify(out));
    assert.equal(out.proposal.proposedLevel, 4);
    assert.match(out.proposal.whyNotHigher ?? "", /smallholders/);
    assert.equal(out.proposal.primary.sourceUrl, DECREE.url);
  });

  it("rejects a proposal below L5 that omits the negative finding", () => {
    const out = validateRubricProposal(egyptProposal({ whyNotHigher: null }), "3.3", [DECREE]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /negative finding/i);
  });

  it("rejects a citation whose URL was never retrieved — no citing from memory", () => {
    const out = validateRubricProposal(
      egyptProposal({
        citations: [{ sourceName: "Egypt Today", sourceUrl: "https://www.egypttoday.com/some-article", quote: "anything" }],
      }),
      "3.3",
      [DECREE],
    );
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /not among the retrieved documents/i);
  });

  it("rejects a quote that is not on the cited page", () => {
    const out = validateRubricProposal(
      egyptProposal({
        citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: "the registry covers every single farmer in Egypt completely" }],
      }),
      "3.3",
      [DECREE],
    );
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /quote verification/i);
  });

  it("treats an empty object as the model's honest 'nothing found'", () => {
    const out = validateRubricProposal({}, "3.3", [DECREE]);
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /did not establish/i);
  });

  it("rejects an out-of-range level", () => {
    const out = validateRubricProposal(egyptProposal({ proposedLevel: 6 }), "3.3", [DECREE]);
    assert.ok("rejected" in out);
  });
});

describe("proposal note", () => {
  it("labels itself machine-researched and carries the negative finding for review", () => {
    const out = validateRubricProposal(egyptProposal(), "3.3", [DECREE]);
    assert.ok("proposal" in out);
    const note = proposalNote(out.proposal);
    assert.match(note, /MACHINE-RESEARCHED PROPOSAL — Level 4/);
    assert.match(note, /Why not L5:/);
    assert.match(note, /Confirm, correct or reject/);
  });
});

describe("parseJsonObject", () => {
  it("reads raw, fenced and empty-signal outputs", () => {
    assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonObject("[]"), {});
    assert.equal(parseJsonObject("no json here"), null);
  });
});

describe("review-batch fixes (L18)", () => {
  it("refuses L1 — absence of evidence is not evidence of absence", () => {
    const out = validateRubricProposal(
      egyptProposal({ proposedLevel: 1, whyNotHigher: "documents show no capability at all" }),
      "3.3",
      [DECREE],
    );
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /absence of evidence/i);
  });

  it("rejects the whole proposal when any citation is malformed", () => {
    const out = validateRubricProposal(
      egyptProposal({
        citations: [
          { sourceName: "MALR", sourceUrl: DECREE.url, quote: "The card is mandatory for government-subsidised fertilisers, seeds and agricultural credit." },
          { sourceName: "", sourceUrl: "not-a-url", quote: "" },
        ],
      }),
      "3.3",
      [DECREE],
    );
    assert.ok("rejected" in out, "one verified quote must not carry unverifiable baggage");
  });

  it("carries the newest cited document year for staleness accounting", () => {
    const out = validateRubricProposal(egyptProposal(), "3.3", [DECREE]);
    assert.ok("proposal" in out);
    assert.equal(out.proposal.documentYear, 2024);
  });
});

describe("rubric query shape (round-2)", () => {
  it("is short, plain-named and unstuffed — the reference search was two words", () => {
    const q = buildRubricQuery(REGISTRY, "Egypt, Arab Rep.");
    assert.doesNotMatch(q, /Arab Rep/);
    assert.ok(q.split(" ").length <= 6, `query too long: "${q}"`);
    assert.match(q, /^Egypt /);
  });
});

describe("query variants for resistant rubrics (round-3)", () => {
  it("expands slashed alternatives into separate names — a human searches one side at a time", async () => {
    const { nameAlternatives } = await import("./rubric.ts");
    assert.deepEqual(nameAlternatives("National farmer registry/database"), [
      "National farmer registry",
      "National farmer database",
    ]);
    assert.deepEqual(nameAlternatives("Digital agricultural market/e-commerce platforms (>5,000 active users)"), [
      "Digital agricultural market platforms",
      "Digital agricultural e-commerce platforms",
    ]);
    assert.deepEqual(nameAlternatives("AI-ready agricultural datasets"), ["AI-ready agricultural datasets"]);
  });

  it("keeps the legacy phrasing first and adds unscoped and per-alternative phrasings", async () => {
    const { buildRubricQueries } = await import("./rubric.ts");
    const qs = buildRubricQueries(REGISTRY, "Egypt, Arab Rep.");
    assert.equal(qs[0], buildRubricQuery(REGISTRY, "Egypt, Arab Rep."));
    assert.ok(qs.includes("Egypt farmer registry"), `reference-shaped query missing: ${JSON.stringify(qs)}`);
    assert.ok(qs.includes("Egypt farmer database"), `alternative query missing: ${JSON.stringify(qs)}`);
    assert.equal(new Set(qs).size, qs.length, "variants must differ");
    assert.ok(qs.length <= 3);
  });

  it("finds the discriminating vocabulary, not the domain wallpaper", async () => {
    const { rubricTopicTerms } = await import("./rubric.ts");
    const terms = rubricTopicTerms(REGISTRY.name);
    assert.ok(terms.includes("registry"), JSON.stringify(terms));
    assert.ok(terms.includes("database"));
    assert.ok(!terms.includes("farmer"), "every agriculture page says farmer");
    assert.ok(!terms.includes("national"));
    assert.deepEqual((await import("./rubric.ts")).rubricTopicTerms("Cybersecurity of agricultural digital systems"), ["cybersecurity"]);
  });

  it("stems the topic check — registration coverage counts for a registry rubric", async () => {
    const { isOnTopic } = await import("./rubric.ts");
    const doc = { title: "Farmer registration drive", snippet: "", text: "The ministry expanded farmer registration in 2024." };
    assert.equal(isOnTopic(doc, ["registry"]), true);
    assert.equal(isOnTopic({ title: "Weather", snippet: "", text: "Rainfall statistics" }, ["registry"]), false);
    assert.equal(isOnTopic({ title: "Anything", snippet: "", text: "at all" }, []), true, "no terms means no opinion");
  });

  it("does NOT rank or filter shown evidence by the topic check — the reference decree never says registry", async () => {
    const { isOnTopic, rubricTopicTerms } = await import("./rubric.ts");
    assert.equal(isOnTopic(DECREE, rubricTopicTerms(REGISTRY.name)), false, "the establishing document itself is off-vocabulary");
  });

  it("interleaves per-variant results by rank so every angle's best hits survive a cap", async () => {
    const { interleaveByRank } = await import("./rubric.ts");
    const mk = (u: string) => ({ url: u });
    const merged = interleaveByRank([[mk("a"), mk("b"), mk("c")], [mk("d"), mk("a"), mk("e")]]);
    assert.deepEqual(merged.map((d) => d.url), ["a", "d", "b", "c", "e"]);
  });
});

describe("citation repair (round-3)", () => {
  const GOOD_QUOTE = "The card is mandatory for government-subsidised fertilisers, seeds and agricultural credit.";
  const BAD_QUOTE = "The card is required for subsidised fertilisers and rural credit programmes.";

  function stubSearcher(byQuery: (q: string) => SearchHit[]) {
    const queries: string[] = [];
    return {
      queries,
      def: {
        domainFilterLimit: "all" as const,
        search: async (inp: { query: string }) => {
          queries.push(inp.query);
          return { hits: byQuery(inp.query) };
        },
      },
    };
  }

  function stubExtractor(responses: string[]) {
    const calls: string[] = [];
    return {
      calls,
      def: {
        chat: async (inp: { user: string }) => {
          calls.push(inp.user);
          return { text: responses[Math.min(calls.length - 1, responses.length - 1)] };
        },
      },
    };
  }

  const RUN = (searcher: ReturnType<typeof stubSearcher>, extractor: ReturnType<typeof stubExtractor>) =>
    import("./rubric.ts").then(({ researchRubric }) =>
      researchRubric(
        {
          search: { providerId: "jina", key: "sk" },
          model: { providerId: "openrouter", key: "mk", modelName: "m" },
          countryName: "Egypt, Arab Rep.",
          iso3: "TST",
          indicator: REGISTRY,
        },
        { searcher: searcher.def, extractor: extractor.def },
      ),
    );

  it("names the offending quote in the rejection — undiagnosable is unfixable", () => {
    const out = validateRubricProposal(
      egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: BAD_QUOTE }] }),
      "3.3",
      [DECREE],
    );
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /offending quote/);
    assert.ok(out.rejected.reason.includes(BAD_QUOTE.slice(0, 60)));
  });

  it("classifies quote failures as repairable and everything else as final", async () => {
    const { isQuoteVerificationFailure } = await import("./rubric.ts");
    const quoteFail = validateRubricProposal(
      egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: BAD_QUOTE }] }),
      "3.3",
      [DECREE],
    );
    assert.ok("rejected" in quoteFail && isQuoteVerificationFailure(quoteFail.rejected.reason));
    assert.equal(isQuoteVerificationFailure("The documents did not establish the capability."), false);
  });

  it("tells the repair call what failed and forbids translation and splicing", async () => {
    const { buildQuoteRepairPrompt } = await import("./rubric.ts");
    const prompt = buildQuoteRepairPrompt({ basePrompt: "BASE", previousJson: '{"x":1}', failure: "offending quote: X" });
    assert.match(prompt, /^BASE\n/);
    assert.match(prompt, /REJECTED because a citation failed/);
    assert.match(prompt, /never translate, transliterate, paraphrase/i);
    assert.ok(prompt.includes('{"x":1}'));
  });

  it("recovers a proposal whose only failure was a non-verbatim quote", async () => {
    const searcher = stubSearcher(() => [DECREE]);
    const extractor = stubExtractor([
      JSON.stringify(egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: BAD_QUOTE }] })),
      JSON.stringify(egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: GOOD_QUOTE }] })),
    ]);
    const res = await RUN(searcher, extractor);
    assert.ok(res.proposal, JSON.stringify(res.rejected ?? res.error));
    assert.equal(res.repaired, true);
    assert.equal(extractor.calls.length, 2);
    assert.match(extractor.calls[1], /REJECTED because a citation failed/);
    assert.ok(extractor.calls[1].includes(BAD_QUOTE.slice(0, 60)), "the repair call names the failed quote");
  });

  it("gives exactly one second chance — a third attempt never happens", async () => {
    const searcher = stubSearcher(() => [DECREE]);
    const extractor = stubExtractor([
      JSON.stringify(egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: BAD_QUOTE }] })),
      JSON.stringify(egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: "still not a verbatim span of anything shown" }] })),
    ]);
    const res = await RUN(searcher, extractor);
    assert.ok(res.rejected, "second failure stays rejected");
    assert.match(res.rejected!.reason, /after one citation-repair attempt/);
    assert.equal(extractor.calls.length, 2, "no third call");
  });

  it("does not spend a repair call on a non-quote rejection", async () => {
    const searcher = stubSearcher(() => [DECREE]);
    const extractor = stubExtractor(["{}"]);
    const res = await RUN(searcher, extractor);
    assert.ok(res.rejected);
    assert.match(res.rejected!.reason, /did not establish/);
    assert.equal(extractor.calls.length, 1);
  });

  it("advances to the next query variant while the harvest stays off-vocabulary, then stops", async () => {
    const chaff = (n: number): SearchHit => ({
      title: `Irrigation bulletin ${n}`,
      url: `https://example.gov.eg/irrigation-${n}`,
      snippet: "",
      text: "Canal maintenance schedules for the delta governorates.",
      publishedYear: 2023,
    });
    const onTopic = (n: number): SearchHit => ({
      title: `Farmer registration update ${n}`,
      url: `https://example.gov.eg/registration-${n}`,
      snippet: "",
      text: "The national farmer registration programme now covers additional governorates.",
      publishedYear: 2024,
    });
    const searcher = stubSearcher((q) =>
      q.includes("official") ? [chaff(1), chaff(2), chaff(3)] : [onTopic(1), onTopic(2), onTopic(3)],
    );
    const extractor = stubExtractor(["{}"]);
    const res = await RUN(searcher, extractor);
    assert.equal(searcher.queries.length, 2, `expected variant advance then stop: ${JSON.stringify(searcher.queries)}`);
    assert.equal(searcher.queries[1], "Egypt farmer registry");
    assert.equal(res.documentsRead, 6, "both angles' documents reach the model");
    assert.ok(extractor.calls[0].includes("irrigation-1") && extractor.calls[0].includes("registration-1"));
  });

  it("stops at the first variant when it already found the vocabulary", async () => {
    const searcher = stubSearcher(() => [
      {
        title: "Registry gazette",
        url: "https://example.gov.eg/gazette",
        snippet: "",
        text: "The farmer registry decree was published together with the database regulations and registry rollout plan.",
        publishedYear: 2024,
      },
      DECREE,
      { title: "Registry annex", url: "https://example.gov.eg/annex", snippet: "", text: "Annex on registry governance and database access.", publishedYear: 2024 },
      { title: "Registry budget", url: "https://example.gov.eg/budget", snippet: "", text: "Budget line for the registry programme.", publishedYear: 2024 },
    ]);
    const extractor = stubExtractor(["{}"]);
    await RUN(searcher, extractor);
    assert.equal(searcher.queries.length, 1, JSON.stringify(searcher.queries));
  });
});

describe("catalogue-wide query construction (the 3.5 crash)", () => {
  it("reads a spaced slash as whole-phrase alternatives", async () => {
    const { nameAlternatives } = await import("./rubric.ts");
    assert.deepEqual(nameAlternatives("National agricultural data portal / open data"), [
      "National agricultural data portal",
      "open data",
    ]);
  });

  it("builds non-empty queries for EVERY researchable rubric in the catalogue — not just the convenient names", async () => {
    const { nameAlternatives, buildRubricQueries, rubricTopicTerms } = await import("./rubric.ts");
    for (const ind of researchableRubrics(model.indicators)) {
      const alts = nameAlternatives(ind.name);
      assert.ok(alts.length >= 1, `${ind.id} "${ind.name}" produced no name alternatives`);
      const qs = buildRubricQueries(ind, "Egypt, Arab Rep.");
      assert.ok(qs.length >= 1, `${ind.id} produced no queries`);
      for (const q of qs) {
        assert.ok(q.trim().length > "Egypt ".length, `${ind.id} produced a blank query: "${q}"`);
      }
      rubricTopicTerms(ind.name); // must not throw for any catalogue name
    }
  });
});

describe("cross-document quote re-attribution (round-3b)", () => {
  const OTHER: SearchHit = {
    title: "National AI Strategy overview",
    url: "https://mcit.gov.eg/ai-strategy",
    snippet: "",
    text: "Egypt's National Artificial Intelligence Strategy was launched in July 2021 by the ministry.",
    publishedYear: 2021,
  };
  const QUOTE_ON_OTHER = "Egypt's National Artificial Intelligence Strategy was launched in July 2021";

  it("re-attributes a quote found verbatim on exactly one other retrieved document", () => {
    const out = validateRubricProposal(
      egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: QUOTE_ON_OTHER }] }),
      "3.3",
      [DECREE, OTHER],
    );
    assert.ok("proposal" in out, JSON.stringify(out));
    assert.equal(out.proposal.citations[0].sourceUrl, OTHER.url, "citation moves to the page that carries the quote");
    assert.equal(out.proposal.citations[0].sourceName, OTHER.title, "the real page names the source");
    assert.equal(out.proposal.primary.sourceUrl, OTHER.url);
    assert.equal(out.proposal.documentYear, 2021, "staleness accounting follows the corrected citation");
    assert.deepEqual(out.proposal.reattributions, [`${DECREE.url} → ${OTHER.url}`]);
    assert.match(proposalNote(out.proposal), /re-attributed during verification/);
  });

  it("still rejects when the quote lives nowhere among the retrieved documents", () => {
    const out = validateRubricProposal(
      egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: "a passage no retrieved page contains anywhere at all" }] }),
      "3.3",
      [DECREE, OTHER],
    );
    assert.ok("rejected" in out);
    assert.match(out.rejected.reason, /offending quote/);
  });

  it("rejects an ambiguous quote found on several other documents — a guess is not an attribution", () => {
    const TWIN: SearchHit = { ...OTHER, url: "https://mirror.gov.eg/ai-strategy-copy" };
    const out = validateRubricProposal(
      egyptProposal({ citations: [{ sourceName: "MALR", sourceUrl: DECREE.url, quote: QUOTE_ON_OTHER }] }),
      "3.3",
      [DECREE, OTHER, TWIN],
    );
    assert.ok("rejected" in out);
  });

  it("keeps a clean validation free of re-attribution noise", () => {
    const out = validateRubricProposal(egyptProposal(), "3.3", [DECREE, OTHER]);
    assert.ok("proposal" in out);
    assert.deepEqual(out.proposal.reattributions, []);
    assert.doesNotMatch(proposalNote(out.proposal), /re-attributed/);
  });
});

describe("rubric prompt quotable surface (round-3b)", () => {
  it("shows 9000 chars of each document — the shown text is the whole quotable surface", () => {
    const long: SearchHit = { ...DECREE, text: "A".repeat(5000) + "NEEDLE_BEYOND_OLD_WINDOW" + "B".repeat(4000) };
    const prompt = buildRubricPrompt({ countryName: "Egypt, Arab Rep.", iso3: "EGY", indicator: REGISTRY, documents: [long] });
    assert.match(prompt, /NEEDLE_BEYOND_OLD_WINDOW/, "content past 4500 chars must be quotable");
  });
});

describe("rejection reading-trail (round-3b)", () => {
  it("names the hosts that were read when the judgment, not a quote, rejected", async () => {
    const { researchRubric } = await import("./rubric.ts");
    const res = await researchRubric(
      {
        search: { providerId: "jina", key: "sk" },
        model: { providerId: "openrouter", key: "mk", modelName: "m" },
        countryName: "Egypt, Arab Rep.",
        iso3: "TST",
        indicator: REGISTRY,
      },
      {
        searcher: { domainFilterLimit: "all", search: async () => ({ hits: [DECREE] }) },
        extractor: { chat: async () => ({ text: "{}" }) },
      },
    );
    assert.ok(res.rejected);
    assert.match(res.rejected!.reason, /did not establish/);
    assert.match(res.rejected!.reason, /read: moalr\.gov\.eg/, "the reading list makes a resistant rubric diagnosable");
  });
});

describe("rubric retrieval scope (the third L4/L11 recurrence)", () => {
  it("searches the open web — capability documents do not live at the statistics office", async () => {
    const { researchRubric } = await import("./rubric.ts");
    const scopes: Array<string[] | undefined> = [];
    await researchRubric(
      {
        search: { providerId: "jina", key: "sk" },
        model: { providerId: "openrouter", key: "mk", modelName: "m" },
        countryName: "Egypt, Arab Rep.",
        // EGY has NSO domains in the catalogue; the rubric pass must not use them.
        iso3: "EGY",
        indicator: REGISTRY,
      },
      {
        searcher: {
          domainFilterLimit: 1,
          search: async (inp: { query: string; includeDomains?: string[] }) => {
            scopes.push(inp.includeDomains);
            return { hits: [DECREE] };
          },
        },
        extractor: { chat: async () => ({ text: "{}" }) },
      },
    );
    assert.ok(scopes.length >= 1);
    for (const scope of scopes) {
      assert.equal(scope, undefined, "a rubric search was scoped to a domain filter");
    }
  });
});

describe("cross-country contamination (round-3b)", () => {
  it("keeps foreign government documents away from the model entirely", async () => {
    const { researchRubric } = await import("./rubric.ts");
    const FOREIGN: SearchHit = {
      title: "AgriStack farmer registry",
      url: "https://mhfr.agristack.gov.in/registry",
      snippet: "",
      text: "The farmer registry database covers every registered farmer with registry identifiers.",
      publishedYear: 2024,
    };
    const extractorPrompts: string[] = [];
    const res = await researchRubric(
      {
        search: { providerId: "jina", key: "sk" },
        model: { providerId: "openrouter", key: "mk", modelName: "m" },
        countryName: "Egypt, Arab Rep.",
        iso3: "EGY",
        indicator: REGISTRY,
      },
      {
        searcher: { domainFilterLimit: 1, search: async () => ({ hits: [FOREIGN, DECREE] }) },
        extractor: {
          chat: async (inp: { user: string }) => {
            extractorPrompts.push(inp.user);
            return { text: "{}" };
          },
        },
      },
    );
    assert.equal(res.documentsRead, 1, "only the domestic document survives");
    assert.ok(extractorPrompts[0].includes(DECREE.url));
    assert.ok(!extractorPrompts[0].includes("agristack.gov.in"), "the foreign registry must never reach the prompt");
  });
});
