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

import { searchProviderDef, verifyQuote, type SearchHit, type SearchProviderDef } from "./search.ts";
import { providerDef, type ProviderDef } from "./providers.ts";
import { hostOf, isBlockedHost, isForeignGovernmentHost, parseJsonArray } from "./websearch.ts";
import { iso2For } from "./countries.ts";
import { isHttpUrl } from "./citation.ts";
import { cleanQueryTerm, collectDocuments, searchCountryName } from "./retrieval.ts";
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
  /**
   * Citations whose quote was found verbatim on a DIFFERENT retrieved document
   * than the one the model named, corrected during verification. Shown to the
   * reviewer in the note — a silent correction would hide how often the model
   * fumbles attribution.
   */
  reattributions: string[];
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
 * Registry names write two capabilities into one token — "registry/database",
 * "market/e-commerce" — and the query hygiene pass used to glue both sides
 * into the search string. A human searches ONE side at a time; the winning
 * reference query was "Egypt farm registry", while the machine sent
 * "Egypt National farmer registry database official" and the registry resisted
 * three whole runs. Expand the first slashed token into per-side names.
 */
export function nameAlternatives(name: string): string[] {
  const cleaned = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const fallback = [cleanQueryTerm(cleaned) || cleaned].filter(Boolean);

  // A spaced slash separates whole phrasings ("data portal / open data");
  // each side stands alone. A live pass crashed on this form when it was
  // read as a slashed token whose sides are empty — the parse must cover
  // the catalogue's names, not the convenient ones.
  if (/\s\/\s/.test(cleaned)) {
    const sides = cleaned.split(/\s+\/\s+/).map((s) => cleanQueryTerm(s)).filter(Boolean);
    const unique = [...new Set(sides)];
    return unique.length ? unique : fallback;
  }

  const tokens = cleaned.split(" ");
  const slashed = tokens.findIndex((t) => t.includes("/"));
  if (slashed < 0) return fallback;
  const sides = tokens[slashed].split("/").filter(Boolean);
  const variants = sides.map((side) =>
    cleanQueryTerm(tokens.map((t, i) => (i === slashed ? side : t)).join(" ")),
  );
  const unique = [...new Set(variants.filter(Boolean))];
  return unique.length ? unique : fallback;
}

/** Leading scope words rank poorly and discriminate nothing. */
const LEADING_SCOPE = /^(national|official)\s+/i;

/**
 * Search queries for one rubric, in the order to try them. Deliberately short
 * (the two-word reference case beat a 13-word stuffed query), and deliberately
 * plural: when the first phrasing returns plausible-but-wrong documents, only
 * a different angle dislodges them — the acid-test registry sat unretrieved
 * for three runs behind a single fixed phrasing.
 */
export function buildRubricQueries(indicator: Pick<IndicatorDef, "name">, countryName: string): string[] {
  const country = searchCountryName(countryName);
  const alts = nameAlternatives(indicator.name);
  const primary = alts[0];
  const queries = [
    `${country} ${primary} official`,
    `${country} ${primary.replace(LEADING_SCOPE, "")}`,
    ...alts.slice(1).map((alt) => `${country} ${alt.replace(LEADING_SCOPE, "")}`),
  ];
  return [...new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))].slice(0, 3);
}

/** Kept for compatibility: the first (closest-to-legacy) query variant. */
export function buildRubricQuery(indicator: IndicatorDef, countryName: string): string {
  return buildRubricQueries(indicator, countryName)[0];
}

/**
 * Words that appear in most indicator names and in most agriculture documents;
 * matching on them would make every retrieved page look on-topic.
 */
const GENERIC_TERMS = new Set([
  "national", "official", "digital", "agricultural", "agriculture", "farmer", "farmers",
  "system", "systems", "platform", "platforms", "scheme", "schemes", "service", "services",
  "data", "public", "rules", "provisions", "framework", "frameworks", "adopted", "enabling",
  "active", "users", "with", "for", "and", "the",
]);

/**
 * The discriminating vocabulary of a rubric — the words a document must use
 * somewhere before it can plausibly establish the capability ("registry",
 * "cybersecurity", "subsidy"), as opposed to the words every document in the
 * domain uses. Used to decide whether a search variant found anything worth
 * assessing, never to reject evidence.
 */
export function rubricTopicTerms(name: string): string[] {
  const terms = new Set<string>();
  for (const alt of nameAlternatives(name)) {
    for (const word of alt.toLowerCase().split(/[^a-z0-9-]+/)) {
      if (word.length >= 4 && !GENERIC_TERMS.has(word)) terms.add(word);
    }
  }
  return [...terms];
}

/** Singular/plural/derivational tolerance: "registry" must match "registries" and "registration". */
function topicStem(term: string): string {
  if (term.endsWith("ies")) return term.slice(0, -3);
  if (term.endsWith("y")) return term.slice(0, -1);
  if (term.endsWith("s")) return term.slice(0, -1);
  return term;
}

/**
 * Whether a document uses the rubric's discriminating vocabulary at all.
 * ONLY a keep-searching trigger — never a rank and never a filter on what the
 * model sees. A capability is often named differently on the ground (the
 * reference case establishes Egypt's farmer REGISTRY via the "Farmer's Card"
 * decree, which never says "registry"), so a false negative here must cost an
 * extra search at most, not the establishing document's place in the prompt.
 */
export function isOnTopic(doc: Pick<SearchHit, "title" | "snippet" | "text">, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${doc.title}\n${doc.snippet}\n${doc.text}`.toLowerCase();
  return terms.some((t) => hay.includes(topicStem(t)));
}

/**
 * Merge per-variant result lists by taking each list's best hit first, then
 * each list's second, and so on (URL-deduped). Under a document cap this
 * preserves every query angle's top results instead of letting the first
 * variant's tail crowd out the second variant's head — the search engine's
 * ranking is trusted within a list; no lexical judgment of ours reorders it.
 */
export function interleaveByRank<T extends { url: string }>(lists: T[][]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const depth = lists.reduce((d, l) => Math.max(d, l.length), 0);
  for (let rank = 0; rank < depth; rank += 1) {
    for (const list of lists) {
      const doc = list[rank];
      if (doc && !seen.has(doc.url)) {
        seen.add(doc.url);
        out.push(doc);
      }
    }
  }
  return out;
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
    "- Copy quotes in the document's own language and script. NEVER translate, transliterate or paraphrase a quote — a translated quote fails verification and sinks the whole proposal.",
    "- Prefer government / official documents as the first citation.",
    "- Quotes work best as short verbatim spans (10-25 words) copied exactly from the document.",
    "- If ANY document evidences the capability operating at L2 or above, you MUST return a proposal.",
    "- Return {} only when no document mentions the capability at all. Do not return {} merely because the evidence is imperfect — propose the level the evidence supports and say what is missing.",
    "",
    "Documents:",
  ];
  for (const [i, doc] of input.documents.entries()) {
    // 9000 of the retrieved 12000 chars: the shown text is the model's whole
    // quotable surface (verification covers the full clamp, and shown must
    // stay a prefix of it). At 4500 the surface was small enough that live
    // runs produced fluent quotes from beyond it — i.e. from model memory —
    // which can never verify.
    lines.push("", `[${i + 1}] ${doc.title || "(untitled)"}`, `URL: ${doc.url}`, doc.text.slice(0, 9000));
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
  const reattributions: string[] = [];
  const seenUrls = new Set<string>();
  for (const c of rawCites) {
    // Every citation must be checkable. Skipping the malformed ones would let
    // a proposal pass on one verified anodyne quote while carrying any number
    // of unverifiable claims (review finding #16) — so malformed rejects.
    if (!c || typeof c !== "object") return reject("A citation was not an object.");
    const cc = c as Record<string, unknown>;
    let sourceUrl = String(cc.sourceUrl ?? "").trim();
    let sourceName = String(cc.sourceName ?? "").trim();
    const quote = String(cc.quote ?? "").trim();
    if (!isHttpUrl(sourceUrl)) return reject(`A citation URL was not http(s): ${sourceUrl.slice(0, 60) || "(empty)"}`);
    if (isBlockedHost(sourceUrl)) return reject(`A citation used an excluded host: ${sourceUrl.slice(0, 60)}`);
    if (!sourceName || !quote) return reject("A citation was missing its source name or quote.");
    if (seenUrls.has(sourceUrl + quote)) continue;
    seenUrls.add(sourceUrl + quote);
    const doc = documents.find((d) => d.url === sourceUrl);
    if (!doc) return reject(`Citation URL was not among the retrieved documents: ${sourceUrl.slice(0, 80)}`);
    const check = verifyQuote(doc.text, quote);
    if (!check.ok) {
      // A model juggling eight documents demonstrably fumbles WHICH page a
      // real quote came from (live run: identical failed quotes cited for two
      // different rubrics). The quote's existence on a retrieved page is the
      // epistemic guarantee; the URL is metadata — so before rejecting, look
      // for the quote on the OTHER retrieved documents. Exactly one match
      // re-attributes with a visible note; zero or several still reject.
      const homes = documents.filter((d) => d.url !== sourceUrl && verifyQuote(d.text, quote).ok);
      if (homes.length !== 1) {
        // The offending quote rides along in the reason: six proposals died on
        // this rejection in one live run, and the audit could not say whether
        // the model translated, paraphrased or spliced — undiagnosable is
        // unfixable.
        return reject(`A citation failed quote verification (${check.reason}) — offending quote: “${quote.slice(0, 90)}”`);
      }
      reattributions.push(`${sourceUrl} → ${homes[0].url}`);
      sourceUrl = homes[0].url;
      sourceName = homes[0].title.trim() || sourceName;
    }
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
      reattributions,
    },
  };
}

/** A rejection this pass can try to repair (the citation was checkable but the quote was not verbatim). */
export function isQuoteVerificationFailure(reason: string): boolean {
  return reason.startsWith("A citation failed quote verification");
}

/**
 * One bounded second chance for a proposal that failed ONLY on quote
 * verification. The verification bar does not move — the model is shown which
 * quote failed and told to copy real spans or drop the claim. Six of the ten
 * rejections that were not L1-refusals in delivery run 5 were exactly this
 * shape: an argued, cited proposal thrown away for a non-verbatim quote.
 */
export function buildQuoteRepairPrompt(input: {
  basePrompt: string;
  previousJson: string;
  failure: string;
}): string {
  return [
    input.basePrompt,
    "",
    "Your previous assessment of this rubric was REJECTED because a citation failed verbatim quote verification:",
    input.failure,
    "",
    "Your previous JSON:",
    input.previousJson.slice(0, 4000),
    "",
    "Resubmit the full JSON object, with every quote replaced by a span of 10-25 CONSECUTIVE words copied character-for-character from a document above.",
    "Copy each quote in the document's own language and script — never translate, transliterate, paraphrase, shorten with ellipses, or splice two passages together.",
    "If a claim has no copyable span behind it, drop that citation — and lower the proposed level if the remaining evidence no longer carries it.",
  ].join("\n");
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

/** Stop adding query variants once this many documents pass the topic check. */
const TARGET_ON_TOPIC_DOCS = 3;
/** Documents shown to the model, after on-topic-first ordering. */
const MAX_RUBRIC_DOCS = 8;

/** Research one rubric end to end: search (per variant) → assess → validate, with one citation repair. */
export async function researchRubric(
  input: {
    search: { providerId: string; key: string };
    model: { providerId: string; key: string; modelName: string };
    countryName: string;
    iso3: string;
    indicator: IndicatorDef;
  },
  /** Test seam: registry lookups are module constants, so stubs inject here. */
  deps?: {
    searcher?: Pick<SearchProviderDef, "search" | "domainFilterLimit">;
    extractor?: Pick<ProviderDef, "chat">;
  },
): Promise<{ proposal?: RubricProposal; rejected?: RubricRejection; documentsRead: number; error?: string; repaired?: boolean }> {
  const searcher = deps?.searcher ?? searchProviderDef(input.search.providerId);
  const extractor = deps?.extractor ?? providerDef(input.model.providerId);
  if (!searcher || !extractor) {
    return { documentsRead: 0, error: "Search or model provider is not configured." };
  }

  // Try each query phrasing until enough ON-TOPIC documents accumulate. A doc
  // count alone cannot trigger the next variant: the resistant rubrics all
  // returned six plausible-but-wrong documents on the first phrasing, which
  // looked exactly like success until the assessment came back empty.
  const topicTerms = rubricTopicTerms(input.indicator.name);
  const queries = buildRubricQueries(input.indicator, input.countryName);
  const iso2 = iso2For(input.iso3) ?? "";
  const perVariant: SearchHit[][] = [];
  let searchError: string | undefined;
  for (const query of queries) {
    if (perVariant.flat().filter((d) => isOnTopic(d, topicTerms)).length >= TARGET_ON_TOPIC_DOCS) break;
    const { docsByIndicator, searchError: err } = await collectDocuments({
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
          queryOverride: query,
        },
      ],
      countryName: input.countryName,
      assessmentYear: new Date().getFullYear(),
      // OPEN WEB ONLY — the third instance of the L4/L11 over-scoping class,
      // this time in the rubric sibling. Capability documents are ministry
      // decrees, strategies and programme pages; the statistics office hosts
      // almost none of them. Scoped to the NSO, the acid-test registry read
      // ONLY censusinfo.capmas.gov.eg for four runs — census pages say
      // "database" everywhere, so even the vocabulary trigger was satisfied
      // by the wrong capability. Quantitative retrieval keeps its NSO-first
      // scope; rubric research must not inherit it.
      nsoDomains: [],
      resultsPerIndicator: 6,
    });
    if (err) searchError = err;
    // Another country's government site is not evidence about THIS country —
    // the open web returned India's AgriStack portal for the Egypt registry
    // query. Discarded before it can satisfy the topic trigger or reach the
    // model at all.
    perVariant.push((docsByIndicator.get(input.indicator.id) ?? []).filter((d) => !isForeignGovernmentHost(d.url, iso2)));
  }
  const documents = interleaveByRank(perVariant).slice(0, MAX_RUBRIC_DOCS);
  if (!documents.length) {
    return {
      documentsRead: 0,
      rejected: { indicatorId: input.indicator.id, reason: searchError ?? "No readable documents were retrieved." },
    };
  }

  const basePrompt = buildRubricPrompt({ countryName: input.countryName, iso3: input.iso3, indicator: input.indicator, documents });
  const chat = await extractor.chat({
    key: input.model.key,
    model: input.model.modelName,
    system: RUBRIC_SYSTEM,
    user: basePrompt,
    maxTokens: 24_000,
    temperature: 0,
    timeoutMs: 360_000,
  });
  if (chat.error || !chat.text) {
    return { documentsRead: documents.length, error: chat.error ?? "The model returned no assessment." };
  }

  const parsed = parseJsonObject(chat.text);
  let outcome = validateRubricProposal(parsed, input.indicator.id, documents);
  let repaired = false;
  if ("rejected" in outcome && isQuoteVerificationFailure(outcome.rejected.reason)) {
    const repair = await extractor.chat({
      key: input.model.key,
      model: input.model.modelName,
      system: RUBRIC_SYSTEM,
      user: buildQuoteRepairPrompt({
        basePrompt,
        previousJson: JSON.stringify(parsed),
        failure: outcome.rejected.reason,
      }),
      maxTokens: 24_000,
      temperature: 0,
      timeoutMs: 360_000,
    });
    if (!repair.error && repair.text) {
      const second = validateRubricProposal(parseJsonObject(repair.text), input.indicator.id, documents);
      if ("proposal" in second) {
        outcome = second;
        repaired = true;
      } else {
        // One attempt only: a model that cannot produce a verbatim quote when
        // told exactly which one failed does not have the evidence.
        outcome = {
          rejected: {
            indicatorId: input.indicator.id,
            reason: `${second.rejected.reason} (after one citation-repair attempt)`,
          },
        };
      }
    }
  }
  if ("rejected" in outcome) {
    // Evidence-judgment rejections name what was read: "did not establish"
    // told us nothing for three runs of the resistant registry — whether the
    // documents were wrong or the judgment was is undiagnosable without the
    // reading list. Quote failures already carry their own diagnosis.
    const trail = isQuoteVerificationFailure(outcome.rejected.reason)
      ? ""
      : ` · read: ${[...new Set(documents.map((d) => hostOf(d.url)))].slice(0, 3).join(", ")}`;
    return {
      documentsRead: documents.length,
      rejected: { indicatorId: outcome.rejected.indicatorId, reason: `${outcome.rejected.reason}${trail}` },
    };
  }
  return { documentsRead: documents.length, proposal: outcome.proposal, repaired };
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
    p.reattributions.length
      ? `Citation re-attributed during verification (the quote was found on a different retrieved page than the model cited): ${p.reattributions.join(" · ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
