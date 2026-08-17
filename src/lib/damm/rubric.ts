/**
 * Web research for anchored rubrics.
 *
 * Forty-six of the model's indicators are anchored rubrics — "national farmer
 * registry", "agricultural data-governance framework" — with no number to
 * fetch anywhere. The original build left every one of them blank, discarding
 * exactly the evidence a task team needs most (a registry decree found on the
 * web establishes the answer is "yes, operational" even when no statistic
 * exists).
 *
 * This pass researches each rubric and proposes a PROVISIONAL level. The
 * discipline comes from the output shape, not from refusing to look:
 *
 *  - the proposal must argue clause-by-clause against the anchor text of the
 *    level it proposes;
 *  - it must state the NEGATIVE finding — why the next level up was not
 *    proposed — so a reviewer can attack the weakest link in seconds;
 *  - every claim must cite a retrieved document, quote-verified against the
 *    page text, with primary (government/official) sources preferred;
 *  - the result is stored as a machine-researched *suggested* level. It feeds
 *    the provisional scores exactly as quantitative machine imports do, and it
 *    converts to a validated assessor level only when a human confirms it.
 *    The engagement-package rule is untouched: no stage is claimable from it.
 */

import { searchProviderDef, verifyQuote, type SearchHit } from "./search.ts";
import { providerDef } from "./providers.ts";
import { isBlockedHost, parseJsonArray } from "./websearch.ts";
import { isHttpUrl } from "./citation.ts";
import { cleanQueryTerm, collectDocuments, searchCountryName } from "./retrieval.ts";
import { nsoDomainsFor } from "./nso.ts";
import type { IndicatorDef } from "./types.ts";

export interface RubricCitation {
  sourceName: string;
  sourceUrl: string;
  quote: string;
}

export interface RubricProposal {
  indicatorId: string;
  proposedLevel: number;
  /** Clause-by-clause case for the proposed level, against the anchor text. */
  rationale: string;
  /** Why the next level up was NOT proposed. Required below L5. */
  whyNotHigher: string | null;
  citations: RubricCitation[];
  /** The strongest (ideally official) citation, stored on the evidence row. */
  primary: RubricCitation;
  /** Newest published year among the cited documents; null when none state one. */
  documentYear: number | null;
}

export interface RubricRejection {
  indicatorId: string;
  reason: string;
}

export interface RubricOutcome {
  proposals: RubricProposal[];
  rejected: RubricRejection[];
  documentsRead: number;
  error?: string;
}

const RUBRIC_SYSTEM =
  "You assess a country against a written capability rubric, using ONLY the documents supplied. " +
  "You never rely on memory or general knowledge of the country. Every claim in your rationale must " +
  "be supported by a quoted span from a supplied document; quotes are checked verbatim against the " +
  "page text. Propose the HIGHEST level every clause of whose anchor is evidenced — and state plainly " +
  "why the next level up is not, naming the missing evidence. If the documents are insufficient to " +
  "distinguish levels, propose the lower level. Returning no proposal is acceptable; inventing " +
  "evidence never is.";

/**
 * A search query aimed at the documents that answer a rubric, not statistics.
 * Deliberately short: the reference case ("Egypt farm registry", two words,
 * rich results) beat a 13-word stuffed query that returned nothing usable.
 */
export function buildRubricQuery(indicator: IndicatorDef, countryName: string): string {
  return `${searchCountryName(countryName)} ${cleanQueryTerm(indicator.name)} official`;
}

export function buildRubricPrompt(input: {
  countryName: string;
  iso3: string;
  indicator: IndicatorDef;
  documents: SearchHit[];
}): string {
  const a = input.indicator.anchors;
  const lines = [
    `Assess ${input.countryName} (${input.iso3}) against this rubric, using ONLY the documents below.`,
    "",
    `Indicator ${input.indicator.id} — ${input.indicator.name}`,
    "Anchor text per level:",
    `L1: ${a.L1}`,
    `L2: ${a.L2}`,
    `L3: ${a.L3}`,
    `L4: ${a.L4}`,
    `L5: ${a.L5}`,
    "",
    "Return ONLY a JSON object with keys:",
    '{ "id": string, "proposedLevel": 1|2|3|4|5,',
    '  "rationale": string (clause-by-clause case for the proposed level, citing documents),',
    '  "whyNotHigher": string (the missing evidence for the next level up; null only at L5),',
    '  "citations": [ { "sourceName": string, "sourceUrl": string, "quote": string } ] }',
    "Rules:",
    "- Every sourceUrl must be one of the document URLs below, copied exactly.",
    "- Every quote must be a verbatim span from that document. Quotes are checked.",
    "- Prefer government / official documents as the first citation.",
    "- Quotes work best as short verbatim spans (10-25 words) copied exactly from the document.",
    "- If ANY document evidences the capability operating at L2 or above, you MUST return a proposal.",
    "- Return {} only when no document mentions the capability at all. Do not return {} merely because the evidence is imperfect — propose the level the evidence supports and say what is missing.",
    "",
    "Documents:",
  ];
  for (const [i, doc] of input.documents.entries()) {
    lines.push("", `[${i + 1}] ${doc.title || "(untitled)"}`, `URL: ${doc.url}`, doc.text.slice(0, 4500));
  }
  return lines.join("\n");
}

/**
 * Validate one proposal against the documents that were actually retrieved.
 * The bar is deliberately the same one human evidence faces: cited, checkable,
 * and honest about what it does not show.
 */
export function validateRubricProposal(
  raw: unknown,
  indicatorId: string,
  documents: SearchHit[],
): { proposal: RubricProposal } | { rejected: RubricRejection } {
  const reject = (reason: string): { rejected: RubricRejection } => ({ rejected: { indicatorId, reason } });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("No assessable proposal was returned.");
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length === 0) return reject("The documents did not establish the capability.");

  const level = Number(r.proposedLevel);
  if (!Number.isInteger(level) || level < 1 || level > 5) return reject(`Proposed level ${r.proposedLevel} is not 1–5.`);
  // L1 asserts the ABSENCE of a capability. Retrieved documents failing to
  // show a capability is not evidence it does not exist — a live run proposed
  // several L1s on exactly that inference. Absence stays a named gap for a
  // human; only L2+ is proposable from web research.
  if (level === 1) {
    return reject("L1 (no credible capability) cannot be proposed from web research — absence of evidence is not evidence of absence. Left for human assessment.");
  }

  const rationale = String(r.rationale ?? "").trim();
  if (rationale.length < 40) return reject("Rationale is missing or too thin to review.");

  const whyNotHigher = r.whyNotHigher == null ? null : String(r.whyNotHigher).trim();
  if (level < 5 && (!whyNotHigher || whyNotHigher.length < 15)) {
    return reject("The negative finding — why not the next level up — is required below L5.");
  }

  const rawCites = Array.isArray(r.citations) ? r.citations : [];
  const citations: RubricCitation[] = [];
  const seenUrls = new Set<string>();
  for (const c of rawCites) {
    // Every citation must be checkable. Skipping the malformed ones would let
    // a proposal pass on one verified anodyne quote while carrying any number
    // of unverifiable claims (review finding #16) — so malformed rejects.
    if (!c || typeof c !== "object") return reject("A citation was not an object.");
    const cc = c as Record<string, unknown>;
    const sourceUrl = String(cc.sourceUrl ?? "").trim();
    const sourceName = String(cc.sourceName ?? "").trim();
    const quote = String(cc.quote ?? "").trim();
    if (!isHttpUrl(sourceUrl)) return reject(`A citation URL was not http(s): ${sourceUrl.slice(0, 60) || "(empty)"}`);
    if (isBlockedHost(sourceUrl)) return reject(`A citation used an excluded host: ${sourceUrl.slice(0, 60)}`);
    if (!sourceName || !quote) return reject("A citation was missing its source name or quote.");
    if (seenUrls.has(sourceUrl + quote)) continue;
    seenUrls.add(sourceUrl + quote);
    const doc = documents.find((d) => d.url === sourceUrl);
    if (!doc) return reject(`Citation URL was not among the retrieved documents: ${sourceUrl.slice(0, 80)}`);
    const check = verifyQuote(doc.text, quote);
    if (!check.ok) return reject(`A citation failed quote verification: ${check.reason}`);
    citations.push({ sourceName: sourceName.slice(0, 200), sourceUrl, quote: quote.slice(0, 400) });
  }
  if (citations.length === 0) return reject("No verifiable citation survived.");

  const citedDocs = citations
    .map((c) => documents.find((d) => d.url === c.sourceUrl))
    .filter((d): d is SearchHit => Boolean(d));
  const years = citedDocs.map((d) => d.publishedYear).filter((y): y is number => y != null);

  return {
    proposal: {
      indicatorId,
      proposedLevel: level,
      rationale: rationale.slice(0, 1500),
      whyNotHigher: whyNotHigher ? whyNotHigher.slice(0, 500) : null,
      citations,
      primary: citations[0],
      documentYear: years.length ? Math.max(...years) : null,
    },
  };
}

/** Extract the first JSON object from model text (raw or fenced). */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    // "[]" is the model's other legitimate "nothing found" shape — but only an
    // actual bracket counts; parseJsonArray also returns [] for garbage.
    return body.includes("[") && parseJsonArray(body).length === 0 ? {} : null;
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Research one rubric end to end: search → extract → validate. */
export async function researchRubric(input: {
  search: { providerId: string; key: string };
  model: { providerId: string; key: string; modelName: string };
  countryName: string;
  iso3: string;
  indicator: IndicatorDef;
}): Promise<{ proposal?: RubricProposal; rejected?: RubricRejection; documentsRead: number; error?: string }> {
  const searcher = searchProviderDef(input.search.providerId);
  const extractor = providerDef(input.model.providerId);
  if (!searcher || !extractor) {
    return { documentsRead: 0, error: "Search or model provider is not configured." };
  }

  const { docsByIndicator, searchError } = await collectDocuments({
    searcher,
    key: input.search.key,
    indicators: [
      {
        id: input.indicator.id,
        name: input.indicator.name,
        anchors: input.indicator.anchors,
        // Documents, not statistics: override the search-pass query builder
        // with the rubric-specific one (review finding #14 — this hint was
        // previously routed into a field the query builder ignores).
        queryOverride: buildRubricQuery(input.indicator, input.countryName),
      },
    ],
    countryName: input.countryName,
    assessmentYear: new Date().getFullYear(),
    nsoDomains: nsoDomainsFor(input.iso3),
    resultsPerIndicator: 6,
  });
  const documents = docsByIndicator.get(input.indicator.id) ?? [];
  if (!documents.length) {
    return {
      documentsRead: 0,
      rejected: { indicatorId: input.indicator.id, reason: searchError ?? "No readable documents were retrieved." },
    };
  }

  const chat = await extractor.chat({
    key: input.model.key,
    model: input.model.modelName,
    system: RUBRIC_SYSTEM,
    user: buildRubricPrompt({ countryName: input.countryName, iso3: input.iso3, indicator: input.indicator, documents }),
    maxTokens: 24_000,
    temperature: 0,
    timeoutMs: 360_000,
  });
  if (chat.error || !chat.text) {
    return { documentsRead: documents.length, error: chat.error ?? "The model returned no assessment." };
  }

  const parsed = parseJsonObject(chat.text);
  const outcome = validateRubricProposal(parsed, input.indicator.id, documents);
  if ("rejected" in outcome) return { documentsRead: documents.length, rejected: outcome.rejected };
  return { documentsRead: documents.length, proposal: outcome.proposal };
}

/** The rubric indicators this pass covers: anchored rubrics outside C0. */
export function researchableRubrics(indicators: IndicatorDef[]): IndicatorDef[] {
  return indicators.filter(
    (i) => i.method !== "Quantitative threshold" && i.method !== "Context profile (not aggregated)",
  );
}

/** Render a proposal as the evidence-row note a reviewer reads. */
export function proposalNote(p: RubricProposal): string {
  const extra = p.citations
    .slice(1)
    .map((c) => `${c.sourceName}: ${c.sourceUrl}`)
    .join(" · ");
  return [
    `MACHINE-RESEARCHED PROPOSAL — Level ${p.proposedLevel}. Confirm, correct or reject at validation.`,
    p.rationale,
    p.whyNotHigher ? `Why not L${Math.min(p.proposedLevel + 1, 5)}: ${p.whyNotHigher}` : null,
    extra ? `Further sources: ${extra}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
