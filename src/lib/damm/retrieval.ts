/**
 * Retrieval-then-extraction evidence collection.
 *
 * The previous path asked a model with a built-in search tool for figures and
 * trusted the JSON it produced. Nothing could be checked: the page never
 * reached this process, so a hallucinated figure attached to a real URL was
 * indistinguishable from a real reading.
 *
 * Here the search provider fetches page text first. The model is then given
 * only that text and asked to extract, not to research. Every extracted figure
 * must quote the document it came from, and the quote is checked against the
 * retrieved text before the reading is allowed anywhere near the evidence base.
 * A figure that cannot be located on the page is dropped and logged, never
 * downgraded — silence is the methodology's required behaviour.
 */

import { credibilityFor } from "./credibility.ts";
import { isHttpUrl } from "./citation.ts";
import { nsoDomainsFor } from "./nso.ts";
import { roundObserved } from "./scoring.ts";
import { searchProviderDef, verifyQuote, type SearchHit, type SearchProviderDef } from "./search.ts";
import { providerDef } from "./providers.ts";
import { isBlockedHost, parseJsonArray, type SearchReading } from "./websearch.ts";
import type { IndicatorDef } from "./types.ts";

export interface RetrievalIndicator
  extends Pick<IndicatorDef, "id" | "name" | "anchors"> {
  preferredSource?: string;
  gapNote?: string;
}

export interface RejectedReading {
  indicatorId: string;
  sourceUrl: string | null;
  reason: string;
}

export interface RetrievalOutcome {
  readings: SearchReading[];
  rejected: RejectedReading[];
  /** Documents actually fetched, for the audit trail. */
  documentsRead: number;
  error?: string;
}

const MAX_DOC_CHARS = 6000;
const MAX_DOCS_IN_PROMPT = 6;

/**
 * Strip indicator-registry notation from a search query. Unit suffixes like
 * "(%)" or "(Mbps)" and slashed alternatives are catalogue conventions, not
 * search terms — a first live run showed them driving real queries to zero
 * results on a provider that takes the string literally.
 */
export function cleanQueryTerm(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/[/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One search query per indicator, biased to official national publishers. */
export function buildQuery(input: {
  indicator: RetrievalIndicator;
  countryName: string;
  assessmentYear: number;
}): string {
  const { indicator, countryName, assessmentYear } = input;
  const preferred = indicator.preferredSource ? ` ${cleanQueryTerm(indicator.preferredSource)}` : "";
  return `${countryName} ${cleanQueryTerm(indicator.name)} statistics${preferred} ${assessmentYear - 3}-${assessmentYear}`;
}

/** Render fetched documents for the extraction prompt, numbered so the model can cite by index. */
export function buildExtractionPrompt(input: {
  countryName: string;
  iso3: string;
  assessmentYear: number;
  indicators: RetrievalIndicator[];
  documents: SearchHit[];
}): string {
  const lines = [
    `Extract cited statistics for ${input.countryName} (${input.iso3}) from the documents below.`,
    "",
    "You are not searching. You may use ONLY the document text provided here.",
    "Rules:",
    "- Return a figure only when it appears verbatim in one of the documents.",
    "- `sourceUrl` must be copied exactly from the document you used.",
    "- `quote` must be a verbatim span from that document containing the figure. It is checked.",
    "- Never estimate, interpolate, convert units or currencies, or combine numbers.",
    `- The observation year must be stated by the document and must not exceed ${input.assessmentYear}.`,
    "- If a document reports a close official proxy, set isProxy true and explain in proxyNote.",
    "- Omit any indicator you cannot support. Returning nothing is correct and expected.",
    "",
    "Return ONLY a JSON array of objects with keys: id, value, year, sourceName, sourceUrl, quote, isProxy, proxyNote.",
    "",
    "Indicators:",
  ];
  for (const ind of input.indicators) {
    lines.push(
      `- ${ind.id} ${ind.name}` +
        (ind.gapNote ? ` | note: ${ind.gapNote}` : "") +
        ` | L5 anchor: ${ind.anchors.L5}`,
    );
  }
  lines.push("", "Documents:");
  for (const [i, doc] of input.documents.slice(0, MAX_DOCS_IN_PROMPT).entries()) {
    lines.push("", `[${i + 1}] ${doc.title || "(untitled)"}`, `URL: ${doc.url}`, doc.text.slice(0, MAX_DOC_CHARS));
  }
  return lines.join("\n");
}

/**
 * Validate one extracted reading against the documents it claims to come from.
 * Every rejection carries a reason so the interface can explain a thin result
 * rather than presenting an empty table.
 */
export function validateAgainstDocuments(
  raw: unknown,
  allowedIds: Set<string>,
  assessmentYear: number,
  documents: SearchHit[],
): { reading: SearchReading } | { rejected: RejectedReading } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const sourceUrl = String(r.sourceUrl ?? r.source_url ?? "").trim();

  const reject = (reason: string): { rejected: RejectedReading } => ({
    rejected: { indicatorId: id || "(unknown)", sourceUrl: sourceUrl || null, reason },
  });

  if (!allowedIds.has(id)) return reject("Indicator id was not in the requested batch.");

  const value = Number(r.value);
  if (!Number.isFinite(value)) return reject("Value was not a finite number.");

  const year = Number(r.year);
  if (!Number.isInteger(year) || year < 2000 || year > assessmentYear) {
    return reject(`Observation year ${r.year} is outside 2000–${assessmentYear}.`);
  }

  const sourceName = String(r.sourceName ?? r.source_name ?? "").trim();
  if (!sourceName) return reject("No source name.");
  if (!isHttpUrl(sourceUrl)) return reject("Source URL was not a public http(s) URL.");
  if (isBlockedHost(sourceUrl)) return reject("Source host is on the excluded list.");

  // The URL must be one this process actually fetched — not one the model recalled.
  const doc = documents.find((d) => d.url === sourceUrl);
  if (!doc) return reject("Source URL was not among the retrieved documents.");

  const quote = String(r.quote ?? "").trim();
  const check = verifyQuote(doc.text, quote, value);
  if (!check.ok) return reject(check.reason ?? "Quotation could not be verified.");

  const isProxy = Boolean(r.isProxy ?? r.is_proxy);
  const cred = credibilityFor({ sourceName, sourceUrl, isProxy });
  if (cred.tier === "E") return reject("Source credibility tier E cannot enter the evidence base.");

  return {
    reading: {
      id,
      value: roundObserved(value),
      year,
      sourceName: sourceName.slice(0, 200),
      sourceUrl,
      quote: quote.slice(0, 400),
      isProxy,
      proxyNote:
        r.proxyNote == null && r.proxy_note == null ? null : String(r.proxyNote ?? r.proxy_note).slice(0, 300),
    },
  };
}

/**
 * Fetch candidate documents for a batch of indicators.
 *
 * The national-statistics scope is a preference, not a cage: the first live
 * run scoped every query to the NSO domain and came back with two documents
 * and zero readings, because most indicators are published elsewhere — the
 * same over-scoping already fixed once in the dossier path (LEARNINGS L4) and
 * repeated here in its sibling. Each indicator now tries the scoped search
 * first and falls back to the open web when the scope returns nothing usable.
 */
export async function collectDocuments(input: {
  searcher: Pick<SearchProviderDef, "search" | "domainFilterLimit">;
  key: string;
  indicators: RetrievalIndicator[];
  countryName: string;
  assessmentYear: number;
  nsoDomains: string[];
  resultsPerIndicator: number;
}): Promise<{ documents: SearchHit[]; searchError?: string }> {
  const documents: SearchHit[] = [];
  const seen = new Set<string>();
  let searchError: string | undefined;

  const scope = input.nsoDomains.length
    ? input.searcher.domainFilterLimit === "all"
      ? input.nsoDomains
      : input.nsoDomains.slice(0, input.searcher.domainFilterLimit as number)
    : undefined;

  const usable = (hit: SearchHit) => !seen.has(hit.url) && Boolean(hit.text.trim()) && !isBlockedHost(hit.url);

  for (const indicator of input.indicators) {
    const query = buildQuery({ indicator, countryName: input.countryName, assessmentYear: input.assessmentYear });
    let found = 0;
    if (scope) {
      const scoped = await input.searcher.search({
        key: input.key,
        query,
        numResults: input.resultsPerIndicator,
        includeDomains: scope,
        withText: true,
      });
      if (scoped.error) searchError = scoped.error;
      for (const hit of scoped.hits) {
        if (!usable(hit)) continue;
        seen.add(hit.url);
        documents.push(hit);
        found += 1;
      }
    }
    if (found === 0) {
      const open = await input.searcher.search({
        key: input.key,
        query,
        numResults: input.resultsPerIndicator,
        withText: true,
      });
      if (open.error) searchError = open.error;
      for (const hit of open.hits) {
        if (!usable(hit)) continue;
        seen.add(hit.url);
        documents.push(hit);
      }
    }
  }
  return { documents, searchError };
}

const EXTRACTION_SYSTEM =
  "You extract statistics from supplied documents. You never search, recall, estimate or convert. " +
  "Every figure you return must appear verbatim in the document text you were given, and your quote is " +
  "checked against that text. Omitting an indicator is always acceptable; inventing one never is.";

/**
 * Collect verified readings for one batch of indicators.
 *
 * Search and extraction use separate credentials by design: the operator may
 * run Exa for retrieval and Claude for extraction, and neither needs to be the
 * other's vendor.
 */
export async function retrieveVerifiedReadings(input: {
  search: { providerId: string; key: string };
  model: { providerId: string; key: string; modelName: string };
  countryName: string;
  iso3: string;
  assessmentYear: number;
  indicators: RetrievalIndicator[];
  resultsPerIndicator?: number;
}): Promise<RetrievalOutcome> {
  if (!input.indicators.length) return { readings: [], rejected: [], documentsRead: 0 };

  const searcher = searchProviderDef(input.search.providerId);
  if (!searcher) return { readings: [], rejected: [], documentsRead: 0, error: `Unknown search provider “${input.search.providerId}”.` };

  const extractor = providerDef(input.model.providerId);
  if (!extractor) return { readings: [], rejected: [], documentsRead: 0, error: `Unknown model provider “${input.model.providerId}”.` };

  const nsoDomains = nsoDomainsFor(input.iso3);
  const { documents, searchError } = await collectDocuments({
    searcher,
    key: input.search.key,
    indicators: input.indicators,
    countryName: input.countryName,
    assessmentYear: input.assessmentYear,
    nsoDomains,
    resultsPerIndicator: input.resultsPerIndicator ?? 4,
  });

  if (!documents.length) {
    return {
      readings: [],
      rejected: [],
      documentsRead: 0,
      error: searchError ?? "No official documents with readable text were retrieved for this batch.",
    };
  }

  const prompt = buildExtractionPrompt({
    countryName: input.countryName,
    iso3: input.iso3,
    assessmentYear: input.assessmentYear,
    indicators: input.indicators,
    documents,
  });

  const chat = await extractor.chat({
    key: input.model.key,
    model: input.model.modelName,
    system: EXTRACTION_SYSTEM,
    user: prompt,
    maxTokens: 3000,
    temperature: 0,
    timeoutMs: 90_000,
  });
  if (chat.error) return { readings: [], rejected: [], documentsRead: documents.length, error: chat.error };
  if (!chat.text) {
    return { readings: [], rejected: [], documentsRead: documents.length, error: "The extraction model returned no output." };
  }

  const allowed = new Set(input.indicators.map((i) => i.id));
  const readings: SearchReading[] = [];
  const rejected: RejectedReading[] = [];
  const takenIds = new Set<string>();

  for (const item of parseJsonArray(chat.text)) {
    const outcome = validateAgainstDocuments(item, allowed, input.assessmentYear, documents);
    if ("rejected" in outcome) {
      rejected.push(outcome.rejected);
      continue;
    }
    if (takenIds.has(outcome.reading.id)) continue;
    takenIds.add(outcome.reading.id);
    readings.push(outcome.reading);
  }

  return { readings, rejected, documentsRead: documents.length, error: searchError };
}
