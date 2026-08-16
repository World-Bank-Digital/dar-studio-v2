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

const INFORMS: DossierInforms[] = ["chapter-1", "chapter-2", "named-lead", "research-task"];

export function dossierTopics(countryName: string, iso3: string, chains: string[] = []): string[] {
  const chain = chains.length ? chains.slice(0, 4).join(", ") : "priority agricultural value chains";
  const nso = nsoDomainsFor(iso3);
  const site = nso.length ? ` Prefer site:${nso.join(" OR site:")}.` : "";
  return [
    `${countryName} national digital agriculture strategy OR e-agriculture policy official${site}`,
    `${countryName} data protection privacy law agriculture personal data official gazette`,
    `${countryName} national AI strategy agriculture water food official`,
    `${countryName} farmer registry database MALR ministry of agriculture official`,
    `${countryName} rural mobile coverage 3G 4G telecom regulator official`,
    `${countryName} digital agricultural extension advisory platform official OR FAO`,
    `${countryName} agtech agri-fintech digital finance farmers official OR donor`,
    `${countryName} agricultural census statistics office ${chain}`,
    `${countryName} FAO World Bank IFAD digital agriculture programme evaluation`,
    `${countryName} inter-ministerial digital agriculture coordination mechanism official`,
    `${countryName} agricultural data governance interoperability standards official`,
    `${countryName} cybersecurity agricultural digital systems ministry official`,
  ];
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
