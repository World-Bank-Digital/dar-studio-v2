import { isHttpUrl } from "./citation.ts";
import { credibilityFor } from "./credibility.ts";
import { nsoDomainsFor } from "./nso.ts";
import { roundObserved } from "./scoring.ts";
import type { IndicatorDef } from "./types.ts";

export interface SearchReading {
  id: string;
  value: number;
  year: number;
  sourceName: string;
  sourceUrl: string;
  quote: string | null;
  isProxy: boolean;
  proxyNote: string | null;
}

const BLOCKED_HOSTS = [
  "wikipedia.org",
  "wikiwand.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "medium.com",
  "reddit.com",
  "quora.com",
  "pinterest.com",
  "tiktok.com",
  "blogspot.com",
  "wordpress.com",
  "substack.com",
  "youtube.com",
  "instagram.com",
  // Professional-network posts are self-published commentary, not citable
  // publications; a live sweep surfaced them alongside FAO and World Bank docs.
  "linkedin.com",
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isBlockedHost(url: string): boolean {
  const host = hostOf(url);
  return BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Extract a JSON array from model text (raw or fenced). */
export function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function validateReading(
  raw: unknown,
  allowedIds: Set<string>,
  assessmentYear: number,
): SearchReading | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  if (!allowedIds.has(id)) return null;
  const value = Number(r.value);
  const year = Number(r.year);
  const sourceName = String(r.sourceName ?? r.source_name ?? "").trim();
  const sourceUrl = String(r.sourceUrl ?? r.source_url ?? "").trim();
  if (!Number.isFinite(value)) return null;
  if (!Number.isInteger(year) || year < 2000 || year > assessmentYear) return null;
  if (!sourceName || !isHttpUrl(sourceUrl)) return null;
  if (isBlockedHost(sourceUrl)) return null;
  const cred = credibilityFor({
    sourceName,
    sourceUrl,
    isProxy: Boolean(r.isProxy ?? r.is_proxy),
  });
  if (cred.tier === "E") return null;
  const quote = r.quote == null ? null : String(r.quote).slice(0, 400);
  return {
    id,
    value: roundObserved(value),
    year,
    sourceName: sourceName.slice(0, 200),
    sourceUrl,
    quote,
    isProxy: Boolean(r.isProxy ?? r.is_proxy),
    proxyNote: r.proxyNote == null && r.proxy_note == null ? null : String(r.proxyNote ?? r.proxy_note).slice(0, 300),
  };
}

export function parseSearchReadings(text: string, allowedIds: Set<string>, assessmentYear: number): SearchReading[] {
  const out: SearchReading[] = [];
  const seen = new Set<string>();
  for (const item of parseJsonArray(text)) {
    const reading = validateReading(item, allowedIds, assessmentYear);
    if (!reading || seen.has(reading.id)) continue;
    seen.add(reading.id);
    out.push(reading);
  }
  return out;
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

export function buildSearchPrompt(input: {
  countryName: string;
  iso3: string;
  nsoDomains: string[];
  indicators: Array<Pick<IndicatorDef, "id" | "name" | "anchors"> & { preferredSource?: string; gapNote?: string }>;
}): string {
  const lines = [
    `Collect cited public statistics for ${input.countryName} (${input.iso3}).`,
    "Search the national statistical office, line ministries, and official international publishers first.",
    input.nsoDomains.length ? `National statistical / government domains to prefer: ${input.nsoDomains.join(", ")}.` : "",
    "Preferred international publishers: World Bank, ITU, UN DESA, FAO, UNESCO, WIPO, ILO, OECD, IMF, Global Findex, GSMA, Open Data Watch ODIN, Oxford Insights, Ookla Speedtest Global Index.",
    "Rules:",
    "- Return a number only if it appears on a public page you can cite with an http(s) URL.",
    "- Never estimate, interpolate, convert currencies unless the page already states the requested unit, or invent a figure.",
    "- Prefer the latest year from 2018 onward. Include the observation year stated by the publisher.",
    "- If the page reports a close official proxy, include it and set isProxy true with a one-line proxyNote.",
    "- Omit an indicator entirely when no cited figure exists. Silence is required.",
    "- Do not use Wikipedia, social media, blogs, or uncited news recaps.",
    "",
    "Return ONLY a JSON array of objects with keys: id, value, year, sourceName, sourceUrl, quote, isProxy, proxyNote.",
    "",
    "Indicators:",
  ];
  for (const ind of input.indicators) {
    lines.push(
      `- ${ind.id} ${ind.name}` +
        (ind.preferredSource ? ` | preferred publisher: ${ind.preferredSource}` : "") +
        (ind.gapNote ? ` | note: ${ind.gapNote}` : "") +
        ` | L5 anchor: ${ind.anchors.L5}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}

export async function searchPublicReadings(input: {
  apiKey: string;
  countryName: string;
  iso3: string;
  assessmentYear: number;
  indicators: Array<Pick<IndicatorDef, "id" | "name" | "anchors"> & { preferredSource?: string; gapNote?: string }>;
}): Promise<{ readings: SearchReading[]; error?: string }> {
  if (input.indicators.length === 0) return { readings: [] };
  const nsoDomains = nsoDomainsFor(input.iso3);
  const prompt = buildSearchPrompt({ ...input, nsoDomains });
  const allowed = new Set(input.indicators.map((i) => i.id));
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
        max_output_tokens: 1800,
        input: [
          {
            role: "system",
            content:
              "You collect only verified public statistics. You never invent numbers. If a figure is not on a citable official or specialized page, you omit it.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { readings: [], error: `Search provider returned ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ""}` };
    }
    const body: unknown = await res.json();
    const text = outputText(body);
    return { readings: parseSearchReadings(text, allowed, input.assessmentYear) };
  } catch (err) {
    return { readings: [], error: err instanceof Error ? err.message : "Search failed" };
  }
}

export function groupByPillar<T extends { pillar: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.pillar) ?? [];
    list.push(item);
    map.set(item.pillar, list);
  }
  return map;
}
