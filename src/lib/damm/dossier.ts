import { isHttpUrl } from "./citation.ts";
import { classifySource, gradeFromScore, type EvidenceGrade } from "./evidenceScore.ts";
import { nsoDomainsFor } from "./nso.ts";
import { hostOf, isBlockedHost, parseJsonArray } from "./websearch.ts";
import type { SourceClass } from "./registry.ts";

export type DossierInforms = "chapter-1" | "chapter-2" | "named-lead" | "research-task";

export interface DossierItem {
  id: string;
  title: string;
  summary: string;
  year: number | null;
  sourceName: string;
  sourceUrl: string;
  host: string;
  sourceClass: SourceClass;
  informs: DossierInforms;
  relatedIndicator: string | null;
  score: number;
  grade: EvidenceGrade;
  quote: string | null;
  collectedAt?: string;
}

export interface DossierHit {
  title: string;
  summary: string;
  year: number | null;
  sourceName: string;
  sourceUrl: string;
  quote: string | null;
  informs: DossierInforms;
  relatedIndicator: string | null;
}

/** Dossier rows never write evidence.value / assessor_level. Enforced at persist. */
export const DOSSIER_CANNOT_WRITE_EVIDENCE = true;

/**
 * Build a dossier lead straight from a search result.
 *
 * The dossier collects *documents*, not figures, so a real search provider
 * answers it completely — there is nothing for a language model to add, and
 * asking one to recall URLs is how unreachable links got in. Title, URL, year
 * and excerpt all come from the provider's own response.
 */
export function dossierHitFromSearch(
  hit: { title: string; url: string; snippet: string; text: string; publishedYear: number | null },
  informs: DossierInforms = "named-lead",
): DossierHit | null {
  if (!isHttpUrl(hit.url) || isBlockedHost(hit.url)) return null;
  const host = hostOf(hit.url);
  if (!host) return null;
  const excerpt = (hit.snippet || hit.text).replace(/\s+/g, " ").trim();
  if (!hit.title.trim() && !excerpt) return null;
  return {
    title: (hit.title.trim() || host).slice(0, 300),
    summary: excerpt.slice(0, 600),
    year: hit.publishedYear,
    // The publisher is the host until a human names it. `classifySource` reads
    // the URL, so credibility grading is unaffected by this placeholder.
    sourceName: host,
    sourceUrl: hit.url,
    quote: excerpt ? excerpt.slice(0, 400) : null,
    informs,
    relatedIndicator: null,
  };
}

const INFORMS: DossierInforms[] = ["chapter-1", "chapter-2", "named-lead", "research-task"];

/** The assessment domains the roadmap method requires evidence for. */
export type DossierDomain =
  | "agrifood-diagnostic"
  | "digital-ecosystem"
  | "farmer-registry"
  | "dpi-interoperability"
  | "inclusion"
  | "institutions"
  | "technology-ai"
  | "foresight"
  | "legal-governance"
  | "investment-financing";

export interface DossierTopicSpec {
  query: string;
  /** Where a hit on this topic is most likely to be useful. */
  informs: DossierInforms;
  domain: DossierDomain;
  /**
   * Whether to confine this query to the national statistical domains.
   *
   * Only statistical questions belong there. Laws live in the gazette,
   * mandates in ministry sites, AI strategies with the digital authority, and
   * programme evaluations with the international institutions — scoping those
   * to the statistics office returns its front page instead of the document,
   * which is how a first live sweep came back with four fifths of its results
   * from a single host.
   */
  preferNationalStats: boolean;
}

/**
 * The dossier's search agenda.
 *
 * Derived from the roadmap method's assessment domains rather than assembled ad
 * hoc, so the sweep is auditable against the method: every domain the roadmap
 * must form a view on has at least one query pointed at it, and a domain that
 * returns nothing is visible as a gap rather than as an absence nobody noticed.
 *
 * These are retrieval queries, not instructions to a model. The dossier collects
 * citable documents and never writes evidence values or prose — the discipline
 * about what may be concluded from a document lives in the scoring and drafting
 * layers, not here.
 */
export function dossierTopicSpecs(
  countryName: string,
  iso3: string,
  chains: string[] = [],
): DossierTopicSpec[] {
  const c = countryName;
  const chain = chains.length ? chains.slice(0, 4).join(", ") : "priority agricultural value chains";

  const t = (
    query: string,
    informs: DossierInforms,
    domain: DossierDomain,
    preferNationalStats = false,
  ): DossierTopicSpec => ({ query, informs, domain, preferNationalStats });

  return [
    // Agrifood structure — the sector the roadmap serves.
    t(`${c} agricultural census holdings smallholder farm size statistics office`, "chapter-1", "agrifood-diagnostic", true),
    t(`${c} agriculture employment GDP share national accounts official`, "chapter-1", "agrifood-diagnostic", true),
    t(`${c} land tenure tenancy sharecropping agricultural holdings official`, "chapter-1", "agrifood-diagnostic", true),
    t(`${c} ${chain} value chain production marketing official report`, "chapter-1", "agrifood-diagnostic"),
    t(`${c} agricultural credit insurance smallholder finance central bank`, "chapter-1", "agrifood-diagnostic"),

    // Existing digital systems and their actual use.
    t(`${c} national digital agriculture strategy OR e-agriculture policy official`, "chapter-2", "digital-ecosystem"),
    t(`${c} digital agricultural extension advisory platform official OR FAO`, "chapter-2", "digital-ecosystem"),
    t(`${c} agricultural market information system prices platform official`, "chapter-2", "digital-ecosystem"),
    t(`${c} agricultural traceability export certification system official`, "chapter-2", "digital-ecosystem"),
    t(`${c} agtech agri-fintech private sector digital services farmers`, "named-lead", "digital-ecosystem"),

    // The registry, treated as a strategic object in its own right.
    t(`${c} farmer registry database ministry of agriculture official`, "chapter-2", "farmer-registry"),
    t(`${c} farmer registration coverage enrolment numbers official report`, "research-task", "farmer-registry"),
    t(`${c} agricultural subsidy payment beneficiary database official`, "chapter-2", "farmer-registry"),

    // What agriculture could reuse instead of rebuilding.
    t(`${c} national digital identity coverage authority official`, "chapter-2", "dpi-interoperability"),
    t(`${c} digital payments interoperability national switch central bank`, "chapter-2", "dpi-interoperability"),
    t(`${c} government data exchange interoperability framework API standards official`, "named-lead", "dpi-interoperability"),
    t(`${c} national geospatial data infrastructure cadastre land records official`, "chapter-2", "dpi-interoperability"),
    t(`${c} government cloud data centre hosting policy official`, "named-lead", "dpi-interoperability"),

    // Who is actually reached, and who is not.
    t(`${c} rural mobile coverage 3G 4G broadband telecom regulator official`, "chapter-2", "inclusion"),
    t(`${c} women farmers land ownership access to services statistics`, "chapter-1", "inclusion", true),
    t(`${c} rural digital literacy mobile phone ownership gender gap survey`, "chapter-2", "inclusion", true),
    t(`${c} smallholder tenant landless livestock keepers access agricultural services`, "research-task", "inclusion"),

    // Institutions by function, not title.
    t(`${c} ministry of agriculture organizational structure mandate digital unit official`, "named-lead", "institutions"),
    t(`${c} inter-ministerial digital agriculture coordination mechanism decree official`, "named-lead", "institutions"),
    t(`${c} agricultural extension service staffing capacity official report`, "chapter-2", "institutions"),
    t(`${c} FAO World Bank IFAD digital agriculture programme evaluation lessons`, "research-task", "institutions"),

    // Technology direction and its authorisation.
    t(`${c} national AI strategy agriculture water food official`, "named-lead", "technology-ai"),
    t(`${c} remote sensing crop monitoring earth observation agriculture official`, "chapter-2", "technology-ai"),

    // Drivers that could invalidate the roadmap.
    t(`${c} climate change agriculture water scarcity adaptation plan official`, "research-task", "foresight"),
    t(`${c} agricultural subsidy reform food security policy official`, "research-task", "foresight"),

    // The legal basis for anything that shares data.
    t(`${c} data protection privacy law personal data official gazette`, "named-lead", "legal-governance"),
    t(`${c} agricultural data governance sharing framework official`, "named-lead", "legal-governance"),
    t(`${c} cybersecurity law critical infrastructure national agency official`, "named-lead", "legal-governance"),

    // Who might pay.
    t(`${c} agriculture public expenditure budget digital investment official`, "research-task", "investment-financing"),
    t(`${c} World Bank agriculture project appraisal document digital component`, "research-task", "investment-financing"),
  ];
}

/** Query strings only. Retained for the legacy model-search path. */
export function dossierTopics(countryName: string, iso3: string, chains: string[] = []): string[] {
  return dossierTopicSpecs(countryName, iso3, chains).map((s) => s.query);
}

export function scoreDossierItem(input: {
  sourceName: string;
  sourceUrl: string;
  year?: number | null;
  title?: string;
  summary?: string;
  quote?: string | null;
  countryName?: string;
  assessmentYear?: number;
}): { total: number; grade: EvidenceGrade; sourceClass: SourceClass; host: string } {
  const host = hostOf(input.sourceUrl);
  const sourceClass = classifySource(input.sourceName, input.sourceUrl);
  const authority =
    sourceClass === "national" ? 40
    : sourceClass === "international" || sourceClass === "specialized" ? 36
    : sourceClass === "donor" ? 24
    : sourceClass === "research" ? 16
    : sourceClass === "private" ? 12
    : 8;

  const blob = `${input.title ?? ""} ${input.summary ?? ""} ${input.quote ?? ""}`.toLowerCase();
  const relevant =
    /agricultur|farmer|food|rural|extension|agtech|e-agricultur|value.?chain|irrigation|livestock/.test(blob) ||
    /digital|data protection|cyber|ai strategy|interoperab|registry|broadband|3g|4g/.test(blob);
  const countryHit = input.countryName
    ? blob.includes(input.countryName.toLowerCase()) || (input.sourceUrl ?? "").toLowerCase().includes(input.countryName.toLowerCase())
    : true;
  const relevance = relevant && countryHit ? 25 : relevant ? 16 : countryHit ? 10 : 4;

  const year = input.year ?? null;
  const ay = input.assessmentYear ?? 2026;
  const recency =
    year == null ? 6
    : year >= ay - 2 ? 20
    : year >= ay - 4 ? 14
    : year >= ay - 8 ? 8
    : 4;

  const specificity =
    (input.quote ? 6 : 0) + (year ? 5 : 0) + (input.sourceUrl ? 4 : 0);
  const spec = Math.min(15, specificity);

  let total = authority + relevance + recency + spec;
  if (!input.sourceUrl) total = 0;
  total = Math.max(0, Math.min(100, total));
  return { total, grade: gradeFromScore(total), sourceClass, host };
}

export function validateDossierHit(raw: unknown, countryName: string, assessmentYear: number): DossierHit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title ?? "").trim();
  const summary = String(r.summary ?? r.note ?? "").trim();
  const sourceName = String(r.sourceName ?? r.source_name ?? "").trim();
  const sourceUrl = String(r.sourceUrl ?? r.source_url ?? "").trim();
  if (title.length < 8 || summary.length < 20 || !sourceName || !isHttpUrl(sourceUrl)) return null;
  if (isBlockedHost(sourceUrl)) return null;
  const yearRaw = r.year;
  const year =
    yearRaw == null || yearRaw === "" || yearRaw === "NA"
      ? null
      : Number(yearRaw);
  if (year != null && (!Number.isInteger(year) || year < 1990 || year > assessmentYear)) return null;
  const informsRaw = String(r.informs ?? "chapter-1").trim() as DossierInforms;
  const informs = INFORMS.includes(informsRaw) ? informsRaw : "chapter-1";
  const related = String(r.relatedIndicator ?? r.related_indicator ?? "").trim();
  return {
    title: title.slice(0, 240),
    summary: summary.slice(0, 600),
    year,
    sourceName: sourceName.slice(0, 200),
    sourceUrl,
    quote: r.quote == null ? null : String(r.quote).slice(0, 400),
    informs,
    relatedIndicator: related || null,
  };
}

export function parseDossierHits(text: string, countryName: string, assessmentYear: number): DossierHit[] {
  const out: DossierHit[] = [];
  const seen = new Set<string>();
  for (const item of parseJsonArray(text)) {
    const hit = validateDossierHit(item, countryName, assessmentYear);
    if (!hit || seen.has(hit.sourceUrl)) continue;
    seen.add(hit.sourceUrl);
    out.push(hit);
  }
  return out;
}

export function toDossierItem(hit: DossierHit, countryName: string, assessmentYear: number, id: string): DossierItem {
  const scored = scoreDossierItem({
    sourceName: hit.sourceName,
    sourceUrl: hit.sourceUrl,
    year: hit.year,
    title: hit.title,
    summary: hit.summary,
    quote: hit.quote,
    countryName,
    assessmentYear,
  });
  return {
    id,
    title: hit.title,
    summary: hit.summary,
    year: hit.year,
    sourceName: hit.sourceName,
    sourceUrl: hit.sourceUrl,
    host: scored.host,
    sourceClass: scored.sourceClass,
    informs: hit.informs,
    relatedIndicator: hit.relatedIndicator,
    score: scored.total,
    grade: scored.grade,
    quote: hit.quote,
  };
}

function outputText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  if (typeof b.output_text === "string") return b.output_text;
  const output = b.output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const content = rec.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && typeof c === "object" && typeof (c as { text?: string }).text === "string") {
            chunks.push((c as { text: string }).text);
          }
        }
      }
      if (typeof rec.text === "string") chunks.push(rec.text);
    }
    if (chunks.length) return chunks.join("\n");
  }
  const choices = b.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const msg = (choices[0] as { message?: { content?: unknown } }).message;
    if (typeof msg?.content === "string") return msg.content;
  }
  return "";
}

export function buildDossierPrompt(input: {
  countryName: string;
  iso3: string;
  chains: string[];
  topics?: string[];
}): string {
  const topics = input.topics?.length ? input.topics : dossierTopics(input.countryName, input.iso3, input.chains);
  return [
    `Country dossier for a Digital Agriculture Roadmap on ${input.countryName} (${input.iso3}).`,
    "NOT the 97-indicator diagnostic. Return only citable public documents (strategy, law, programme, evaluation, chain note).",
    "Prefer national official hosts, then international official, then donor, then research, then private.",
    "Never invent a URL, year, or figure. Omit anything you cannot cite. No Wikipedia, social, or uncited news.",
    "",
    "Search only these topics:",
    ...topics.map((t, i) => `${i + 1}. ${t}`),
    "",
    "Return ONLY a JSON array of objects: title, summary, year, sourceName, sourceUrl, quote, informs, relatedIndicator.",
    "informs: chapter-1 | chapter-2 | named-lead | research-task. relatedIndicator is optional (a lead, never a score).",
  ].join("\n");
}

export async function searchDossierBatch(input: {
  apiKey: string;
  countryName: string;
  iso3: string;
  assessmentYear: number;
  topics: string[];
}): Promise<{ hits: DossierHit[]; error?: string }> {
  if (!input.topics.length) return { hits: [] };
  const prompt = buildDossierPrompt({
    countryName: input.countryName,
    iso3: input.iso3,
    chains: [],
    topics: input.topics,
  });
  try {
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        tools: [{ type: "web_search" }],
        max_output_tokens: 1600,
        input: [
          {
            role: "system",
            content:
              "Collect only citable public documents. Never invent URLs or figures. Dossier items are context, not indicator scores. Return a short JSON array.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(28000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { hits: [], error: `Search provider returned ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ""}` };
    }
    const body: unknown = await res.json();
    return { hits: parseDossierHits(outputText(body), input.countryName, input.assessmentYear) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Dossier search failed";
    return { hits: [], error: /aborted|timeout/i.test(msg) ? "Batch timed out — later topics will still be tried." : msg };
  }
}

export function chunkTopics<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** @deprecated one-shot path — prefer searchDossierBatch */
export async function searchCountryDossier(input: {
  apiKey: string;
  countryName: string;
  iso3: string;
  assessmentYear: number;
  chains?: string[];
}): Promise<{ hits: DossierHit[]; error?: string }> {
  const topics = dossierTopics(input.countryName, input.iso3, input.chains ?? []);
  const all: DossierHit[] = [];
  const seen = new Set<string>();
  let lastError: string | undefined;
  for (const batch of chunkTopics(topics, 3)) {
    const part = await searchDossierBatch({ ...input, topics: batch });
    if (part.error) lastError = part.error;
    for (const hit of part.hits) {
      if (seen.has(hit.sourceUrl)) continue;
      seen.add(hit.sourceUrl);
      all.push(hit);
    }
  }
  return { hits: all, error: lastError };
}
