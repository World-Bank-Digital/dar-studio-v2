/**
 * Bring-your-own-key web search.
 *
 * The original build had no search layer at all: it asked Grok to search with
 * its built-in tool and parsed figures out of the model's prose. Nothing the
 * model returned could be checked, because the page content never reached this
 * process.
 *
 * Jina and Exa return real URLs *and* real page text. That changes what the app
 * can promise: an extracted figure can be checked against the retrieved text
 * before it is allowed into the evidence base (see `verifyQuote`). Retrieval and
 * extraction are therefore separated — the search provider finds and fetches,
 * the model only reads what was fetched.
 */

export type SearchProviderId = "exa" | "jina";

export const SEARCH_PROVIDER_IDS: SearchProviderId[] = ["exa", "jina"];

export interface SearchHit {
  title: string;
  url: string;
  /** Short description where the provider gives one. */
  snippet: string;
  /** Retrieved page text. Empty when the provider returned metadata only. */
  text: string;
  publishedYear: number | null;
}

export interface SearchInput {
  key: string;
  query: string;
  numResults?: number;
  /** Preferred hosts, e.g. national statistical offices. */
  includeDomains?: string[];
  /** Fetch page text as well as metadata. Costs more; needed for extraction. */
  withText?: boolean;
  timeoutMs?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  error?: string;
}

export interface ReadResult {
  text: string | null;
  title?: string;
  error?: string;
}

export interface SearchProviderDef {
  id: SearchProviderId;
  label: string;
  consoleUrl: string;
  /** How many `includeDomains` entries the provider honours. */
  domainFilterLimit: number | "all";
  search(input: SearchInput): Promise<SearchResult>;
  /** Fetch one URL as clean text. Used to verify a quotation in place. */
  read(input: { key: string; url: string; timeoutMs?: number }): Promise<ReadResult>;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_TEXT = 12_000;

function failure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(msg)) return "The search request timed out.";
  return msg;
}

/**
 * Jina's s.reader answers a query with no hits as HTTP 422
 * (AssertionFailureError: "No search results available"). Treating that as a
 * provider error polluted a whole ingest pass's audit trail with false alarms;
 * an empty result set is a legitimate answer.
 */
export function jinaTreatsAsEmpty(status: number): boolean {
  return status === 422;
}

function statusError(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 240);
  if (status === 401 || status === 403) return `Search authentication failed (${status}). Check the key.`;
  if (status === 429) return "Search rate limited (429).";
  if (status >= 500) return `Search provider error ${status}.`;
  return `Search provider returned ${status}${trimmed ? `: ${trimmed}` : ""}`;
}

export function yearFromDate(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const m = value.match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100 ? y : null;
}

function clampText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : "";
}

/* ---------- Exa ---------- */

export function parseExaResults(json: unknown): SearchHit[] {
  const body = json as { results?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.results)) return [];
  const out: SearchHit[] = [];
  for (const r of body.results) {
    const url = String(r.url ?? "").trim();
    if (!url) continue;
    out.push({
      title: String(r.title ?? "").slice(0, 300),
      url,
      snippet: clampText(r.summary ?? r.highlights ?? "").slice(0, 600),
      text: clampText(r.text),
      publishedYear: yearFromDate(r.publishedDate),
    });
  }
  return out;
}

const exa: SearchProviderDef = {
  id: "exa",
  label: "Exa",
  consoleUrl: "https://dashboard.exa.ai/api-keys",
  domainFilterLimit: "all",
  async search(input) {
    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.key },
        body: JSON.stringify({
          query: input.query,
          numResults: input.numResults ?? 8,
          type: "auto",
          ...(input.includeDomains?.length ? { includeDomains: input.includeDomains } : {}),
          ...(input.withText === false ? {} : { contents: { text: { maxCharacters: MAX_TEXT } } }),
        }),
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      if (!res.ok) return { hits: [], error: statusError(res.status, await res.text().catch(() => "")) };
      return { hits: parseExaResults(await res.json()) };
    } catch (err) {
      return { hits: [], error: failure(err) };
    }
  },
  async read(input) {
    try {
      const res = await fetch("https://api.exa.ai/contents", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": input.key },
        body: JSON.stringify({ urls: [input.url], text: { maxCharacters: MAX_TEXT } }),
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      if (!res.ok) return { text: null, error: statusError(res.status, await res.text().catch(() => "")) };
      const hits = parseExaResults(await res.json());
      return { text: hits[0]?.text || null, title: hits[0]?.title };
    } catch (err) {
      return { text: null, error: failure(err) };
    }
  },
};

/* ---------- Jina ---------- */

export function parseJinaResults(json: unknown): SearchHit[] {
  const body = json as { data?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.data)) return [];
  const out: SearchHit[] = [];
  for (const r of body.data) {
    const url = String(r.url ?? "").trim();
    if (!url) continue;
    out.push({
      title: String(r.title ?? "").slice(0, 300),
      url,
      snippet: String(r.description ?? "").slice(0, 600),
      text: clampText(r.content),
      publishedYear: yearFromDate(r.date ?? r.publishedTime),
    });
  }
  return out;
}

const jina: SearchProviderDef = {
  id: "jina",
  label: "Jina",
  consoleUrl: "https://jina.ai/api-dashboard/",
  // s.jina.ai scopes a search to one site per request via the X-Site header.
  domainFilterLimit: 1,
  async search(input) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${input.key}`,
        Accept: "application/json",
      };
      if (input.includeDomains?.length) headers["X-Site"] = input.includeDomains[0];
      if (input.withText === false) headers["X-Respond-With"] = "no-content";
      const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(input.query)}`, {
        headers,
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      if (jinaTreatsAsEmpty(res.status)) return { hits: [] };
      if (!res.ok) return { hits: [], error: statusError(res.status, await res.text().catch(() => "")) };
      const hits = parseJinaResults(await res.json());
      return { hits: hits.slice(0, input.numResults ?? 8) };
    } catch (err) {
      return { hits: [], error: failure(err) };
    }
  },
  async read(input) {
    try {
      const res = await fetch(`https://r.jina.ai/${input.url}`, {
        headers: { Authorization: `Bearer ${input.key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      if (!res.ok) return { text: null, error: statusError(res.status, await res.text().catch(() => "")) };
      const body = (await res.json()) as { data?: { content?: unknown; title?: unknown } };
      return { text: clampText(body.data?.content) || null, title: String(body.data?.title ?? "") };
    } catch (err) {
      return { text: null, error: failure(err) };
    }
  },
};

export const SEARCH_PROVIDERS: Record<SearchProviderId, SearchProviderDef> = { exa, jina };

export function isSearchProviderId(value: string): value is SearchProviderId {
  return (SEARCH_PROVIDER_IDS as string[]).includes(value);
}

export function searchProviderDef(id: string): SearchProviderDef | null {
  return isSearchProviderId(id) ? SEARCH_PROVIDERS[id] : null;
}

/** Cheap liveness check for the Settings “Test” button. */
export async function verifySearchKey(id: string, key: string): Promise<{ ok: boolean; error?: string }> {
  const def = searchProviderDef(id);
  if (!def) return { ok: false, error: `Unknown search provider “${id}”.` };
  const res = await def.search({ key, query: "world bank rural 3G coverage statistics", numResults: 1, withText: false });
  if (res.error) return { ok: false, error: res.error };
  return { ok: true };
}

/* ---------- quotation verification ---------- */

/** Collapse whitespace and unify the punctuation publishers vary on. */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\u00a0/g, " ")
    // Bracketed reference markers: a table printing "65 per cent[1]" quotes the
    // same figure as one printing "65 per cent", and treating the marker as a
    // mismatch would reject good readings from the official sources the method
    // prefers. Removed here rather than tolerated by a looser match threshold.
    .replace(/\[\d{1,3}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Share of a quote's words that must appear as one unbroken run on the page. */
const QUOTE_COVERAGE = 0.85;

/**
 * Length of the longest run of consecutive `words` that appears verbatim in
 * `page`. Quotes are short, so the quadratic scan costs nothing.
 */
export function longestContiguousRun(page: string, words: string[]): number {
  let best = 0;
  for (let start = 0; start < words.length; start += 1) {
    if (words.length - start <= best) break;
    let end = start + best;
    while (end < words.length && page.includes(words.slice(start, end + 1).join(" "))) {
      end += 1;
      best = end - start;
    }
  }
  return best;
}

/**
 * Confirm a quoted passage really appears in retrieved page text, and that the
 * figure being claimed appears inside that passage.
 *
 * An exact substring match is too brittle for real pages — footnote markers,
 * soft hyphens and table cells joined by markup all break it — so a near-miss
 * is tolerated. The tolerance is deliberately expressed as "almost the whole
 * quote appears as one unbroken run" rather than "some window of it matches":
 * the latter would let a model take a genuine sentence and append an invented
 * clause to it, which is precisely the failure this check exists to catch.
 */
export function verifyQuote(
  pageText: string,
  quote: string,
  value?: number,
): { ok: boolean; reason?: string } {
  if (!pageText.trim()) return { ok: false, reason: "No page text was retrieved to check the quotation against." };
  if (!quote.trim()) return { ok: false, reason: "No quotation was supplied." };

  const page = normalizeForMatch(pageText);
  const q = normalizeForMatch(quote);

  if (!page.includes(q)) {
    const words = q.split(" ").filter(Boolean);
    const covered = longestContiguousRun(page, words);
    if (words.length < 4 || covered / words.length < QUOTE_COVERAGE) {
      return { ok: false, reason: "The quoted passage was not found on the retrieved page." };
    }
  }

  if (value !== undefined && Number.isFinite(value)) {
    if (!numberAppearsIn(q, value)) {
      return { ok: false, reason: `The figure ${value} does not appear in the quoted passage.` };
    }
  }
  return { ok: true };
}

/**
 * Does `value` appear in `text` as a number a publisher would actually print?
 * Accepts thousands separators and trailing-zero differences (78 vs 78.0), and
 * a percentage written as a share (0.55 vs 55%) is *not* accepted — that is a
 * conversion, which the methodology forbids.
 */
export function numberAppearsIn(text: string, value: number): boolean {
  const found = text.match(/-?\d[\d,\u00a0 ]*(?:\.\d+)?/g) ?? [];
  for (const raw of found) {
    const n = Number(raw.replace(/[,\u00a0 ]/g, ""));
    if (!Number.isFinite(n)) continue;
    if (n === value) return true;
    // Tolerate the publisher's rounding only at the last printed digit.
    const decimals = (raw.split(".")[1] ?? "").length;
    if (decimals > 0 && Math.abs(n - value) < 0.5 / 10 ** decimals) return true;
    if (decimals === 0 && Number.isInteger(n) && Math.abs(n - value) < 0.5) return true;
  }
  return false;
}
