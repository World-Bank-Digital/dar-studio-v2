import { sourceFor, type SourceSpec } from "./sources.ts";
import { suggestedLevel, roundObserved } from "./scoring.ts";
import { model } from "./model.ts";
import { credibilityFor, confidenceFromCredibility } from "./credibility.ts";
import type { EvidenceRow } from "./types.ts";

const WB = "https://api.worldbank.org/v2";
const D360 = "https://data360api.worldbank.org/data360/data";
const UA = "DAR-Studio/1.3 (independent prototype; public statistical client)";

async function fetchJson(url: string, attempt = 0): Promise<unknown> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(45000),
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    const text = await res.text();
    if (!res.ok) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
        return fetchJson(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    if (text.trimStart().startsWith("<")) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        return fetchJson(url, attempt + 1);
      }
      throw new Error("Publisher returned a non-JSON error page");
    }
    return JSON.parse(text) as unknown;
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

export function parseWbLatest(body: unknown): { value: number; year: number } | null {
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) return null;
  for (const row of body[1] as Array<{ value: number | null; date: string }>) {
    if (row && row.value !== null && row.value !== undefined && !Number.isNaN(Number(row.value))) {
      const year = Number(row.date);
      if (!Number.isNaN(year)) return { value: Number(row.value), year };
    }
  }
  return null;
}

function isTotalCode(v: unknown): boolean {
  return v === undefined || v === null || v === "" || v === "_T" || v === "_Z" || v === "_X";
}

export function parseData360Latest(
  body: unknown,
  opts: { sex?: string; age?: string; unit?: string } = {},
): { value: number; year: number } | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as { value?: unknown }).value;
  if (!Array.isArray(rows)) return null;
  const wantSex = opts.sex ?? "_T";
  const wantAge = opts.age;
  const wantUnit = opts.unit;
  type Cand = { value: number; year: number; latest: boolean; ageRank: number };
  const cands: Cand[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const sex = String(r.SEX ?? "_T");
    if (wantSex && sex !== wantSex && sex !== "_Z") continue;
    if (!isTotalCode(r.COMP_BREAKDOWN_1) || !isTotalCode(r.COMP_BREAKDOWN_2) || !isTotalCode(r.COMP_BREAKDOWN_3)) {
      continue;
    }
    const age = String(r.AGE ?? "_T");
    if (wantAge && age !== wantAge && age !== "_T" && age !== "_Z") continue;
    if (wantUnit && String(r.UNIT_MEASURE ?? "") !== wantUnit) continue;
    const rawVal = r.OBS_VALUE;
    if (rawVal === null || rawVal === undefined || String(rawVal).toLowerCase() === "null") continue;
    const value = Number(rawVal);
    const year = Number(r.TIME_PERIOD);
    if (Number.isNaN(value) || Number.isNaN(year)) continue;
    const ageRank = age === "Y_GE15" ? 2 : age === "_T" || age === "_Z" ? 1 : 0;
    cands.push({ value, year, latest: Boolean(r.LATEST_DATA), ageRank });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.year - a.year || Number(b.latest) - Number(a.latest) || b.ageRank - a.ageRank);
  const topYear = cands[0].year;
  const same = cands.filter((c) => c.year === topYear);
  const preferred = same.find((c) => c.latest && c.ageRank === same[0].ageRank) ?? same[0];
  return { value: preferred.value, year: preferred.year };
}

export function parseOwidLatest(csvText: string, iso3: string): { value: number; year: number } | null {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0].split(",");
  const codeIdx = header.findIndex((h) => h.trim().toLowerCase() === "code");
  const yearIdx = header.findIndex((h) => h.trim().toLowerCase() === "year");
  if (codeIdx < 0 || yearIdx < 0) return null;
  const valueIdx = header.length - 1;
  let best: { value: number; year: number } | null = null;
  const needle = iso3.toUpperCase();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if ((cols[codeIdx] ?? "").toUpperCase() !== needle) continue;
    const year = Number(cols[yearIdx]);
    const value = Number(cols[valueIdx]);
    if (Number.isNaN(year) || Number.isNaN(value)) continue;
    if (!best || year > best.year) best = { value, year };
  }
  return best;
}

function applyScale(value: number, spec: SourceSpec): number {
  if (spec.scale === "index100-to-01") return value / 100;
  return value;
}

export async function fetchWorldBankSeries(
  iso3: string,
  series: string,
): Promise<{ value: number; year: number } | null> {
  const url = `${WB}/country/${encodeURIComponent(iso3)}/indicator/${encodeURIComponent(series)}?format=json&mrv=12&per_page=12`;
  return parseWbLatest(await fetchJson(url));
}

export async function fetchData360Series(
  iso3: string,
  spec: SourceSpec,
): Promise<{ value: number; year: number } | null> {
  if (!spec.databaseId || !spec.data360Indicator) return null;
  const url =
    `${D360}?DATABASE_ID=${encodeURIComponent(spec.databaseId)}` +
    `&INDICATOR=${encodeURIComponent(spec.data360Indicator)}` +
    `&REF_AREA=${encodeURIComponent(iso3)}`;
  const body = await fetchJson(url);
  return parseData360Latest(body, { sex: spec.data360Sex, age: spec.data360Age, unit: spec.data360Unit });
}

export async function fetchOwidSeries(
  iso3: string,
  slug: string,
): Promise<{ value: number; year: number } | null> {
  const url = `https://ourworldindata.org/grapher/${encodeURIComponent(slug)}.csv?v=1&csvType=full&useColumnShortNames=true`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(45000),
    headers: { Accept: "text/csv", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`OWID HTTP ${res.status}`);
  return parseOwidLatest(await res.text(), iso3);
}

function gapResult(
  spec: SourceSpec,
  message: string,
  status: "gap" | "error" = "gap",
): Partial<EvidenceRow> & { status: "imported" | "gap" | "error"; message: string } {
  return {
    status,
    message,
    provenance: "named-gap",
    gapSteward: spec.steward,
    gapSource: spec.sourceName,
    sourceName: spec.sourceName,
    sourceUrl: spec.sourceUrl ?? null,
    dataGap: false,
  };
}

function importedResult(
  spec: SourceSpec,
  value: number,
  year: number,
  extra: string,
): Partial<EvidenceRow> & { status: "imported" | "gap" | "error"; message: string } {
  const scaled = roundObserved(applyScale(value, spec));
  const cred = credibilityFor({
    sourceName: spec.sourceName,
    sourceUrl: spec.sourceUrl,
    isProxy: Boolean(spec.isProxy),
    provenance: spec.isProxy ? "proxy" : "machine-imported",
  });
  const ind = model.indicators.find((i) => i.id === spec.indicatorId);
  return {
    status: "imported",
    message: `Imported ${scaled} (${year}) from ${spec.sourceName}${extra} · credibility ${cred.tier} (${cred.score})`,
    value: scaled,
    observationYear: year,
    sourceName: spec.sourceName,
    sourceUrl: spec.sourceUrl ?? null,
    confidence: confidenceFromCredibility(cred, Boolean(spec.isProxy)),
    provenance: spec.isProxy ? "proxy" : "machine-imported",
    isProxy: Boolean(spec.isProxy),
    proxyNote: spec.proxyNote ?? null,
    suggestedLevel: ind ? suggestedLevel(ind, scaled) : null,
    notes: cred.note,
  };
}

async function ingestOne(
  iso3: string,
  spec: SourceSpec,
): Promise<Partial<EvidenceRow> & { status: "imported" | "gap" | "error"; message: string }> {
  if (spec.kind === "named-gap") {
    return gapResult(spec, spec.gapNote ?? "Named gap");
  }
  try {
    if (spec.kind === "derived" && spec.series && spec.seriesB && spec.derive === "subtract") {
      const a = await fetchWorldBankSeries(iso3, spec.series);
      const b = await fetchWorldBankSeries(iso3, spec.seriesB);
      if (!a || !b) return gapResult(spec, "Derived series incomplete — routed as a named gap.");
      return importedResult(spec, a.value - b.value, Math.min(a.year, b.year), "");
    }
    if (spec.kind === "worldbank" && spec.series) {
      const reading = await fetchWorldBankSeries(iso3, spec.series);
      if (!reading) return gapResult(spec, `No recent observation for ${spec.series}.`);
      return importedResult(spec, reading.value, reading.year, ` · ${spec.series}`);
    }
    if (spec.kind === "data360") {
      const reading = await fetchData360Series(iso3, spec);
      if (!reading) return gapResult(spec, `No Data360 observation for ${spec.data360Indicator}.`);
      return importedResult(spec, reading.value, reading.year, ` · ${spec.databaseId}/${spec.data360Indicator}`);
    }
    if (spec.kind === "owid" && spec.owidSlug) {
      const reading = await fetchOwidSeries(iso3, spec.owidSlug);
      if (!reading) return gapResult(spec, `No Our World in Data observation for ${spec.owidSlug}.`);
      return importedResult(spec, reading.value, reading.year, ` · ${spec.owidSlug}`);
    }
    return gapResult(spec, spec.gapNote ?? "No public series configured.");
  } catch (err) {
    return gapResult(spec, err instanceof Error ? err.message : "Fetch failed", "error");
  }
}

/**
 * Try the mapped series, then lower-priority fallbacks.
 * Official exact series are listed first in the catalogue.
 */
export async function ingestIndicator(
  iso3: string,
  spec: SourceSpec,
): Promise<Partial<EvidenceRow> & { status: "imported" | "gap" | "error"; message: string }> {
  const attempts: SourceSpec[] = [
    spec,
    ...(spec.fallbacks ?? []).map((f) => ({ ...f, indicatorId: spec.indicatorId })),
  ];
  let last = gapResult(spec, spec.gapNote ?? "No public series configured.");
  for (const attempt of attempts) {
    const result = await ingestOne(iso3, attempt);
    if (result.status === "imported") return result;
    last = result;
  }
  return last;
}

export function ingestQueue(): SourceSpec[] {
  return model.indicators.map((i) => {
    const spec = sourceFor(i.id);
    return (
      spec ?? {
        indicatorId: i.id,
        kind: "named-gap" as const,
        sourceName: "Unmapped",
        steward: "Model steward",
        gapNote: "No source mapping in the catalogue.",
      }
    );
  });
}

const CONTEXT_SEARCHABLE = new Set(["1.5", "1.6", "1.7", "1.8"]);

/** Quantitative (and a few numeric context) indicators that may be filled from cited public pages after official APIs. Rubrics are never auto-scored. */
export function isWebSearchable(indicatorId: string): boolean {
  const ind = model.indicators.find((i) => i.id === indicatorId);
  if (!ind) return false;
  if (ind.method === "Quantitative threshold") return true;
  return CONTEXT_SEARCHABLE.has(ind.id);
}

export function webSearchableIndicators() {
  return model.indicators.filter((i) => isWebSearchable(i.id));
}
