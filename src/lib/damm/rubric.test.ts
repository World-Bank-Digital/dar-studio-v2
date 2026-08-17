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
