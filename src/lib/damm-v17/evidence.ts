/**
 * The bridge between stored evidence rows and the scorer's observations.
 *
 * Everything derivable is derived here, never stored: the evidence class comes
 * from the recorded value, the level of a numeric threshold row comes from the
 * cut-points, staleness comes from the year. The database holds only what an
 * assessor actually enters — the same six entry columns as the scoring
 * workbook (value, source, source URL, tier, year, assessor level) plus the
 * ratification hold and notes.
 *
 * Pure functions, so the round trip is unit-testable without a server: the
 * demonstration fixtures map to evidence rows, back to observations, and the
 * scorer must reproduce every figure the assessment pipeline derived.
 */
import type {
  EvidenceClass,
  IndicatorDef,
  Observation,
  Observations,
  SourceTier,
} from "./types.ts";
import { Scorer } from "./scorer.ts";
import { model, indicatorById } from "./model.ts";

export interface EvidenceRecord {
  indicatorId: string;
  /** The recorded value as entered: a number, prose, or a "DATA GAP …" trail. */
  valueRaw: string | null;
  observationYear: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceTier: SourceTier | null;
  /** 1–5; honored only where the class is not Measured-with-thresholds. */
  assessorLevel: number | null;
  /** Level withheld pending a section-13.5 ruling; the row leaves every mean. */
  ratificationHold: boolean;
  assessorRole: string | null;
  assessorName: string | null;
  assessedAt: string | null;
  notes: string | null;
}

const scorer = new Scorer(model);

/** A value string that is exactly one number scores as a number. */
export function numericValue(raw: string | null): number | null {
  if (raw === null) return null;
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function toObservation(def: IndicatorDef, r: EvidenceRecord): Observation {
  const num = numericValue(r.valueRaw);
  const value: number | string | null =
    num !== null ? num : r.valueRaw && r.valueRaw.trim() !== "" ? r.valueRaw : null;
  const base: Observation = {
    value,
    year: r.observationYear,
    src: r.sourceName,
    tier: r.sourceTier,
    url: r.sourceUrl,
  };
  const cls = scorer.evidenceClass(base);
  if (r.ratificationHold) return { ...base, level: null };
  if (cls === "Measured" && def.thresholds) return base; // the scorer derives
  return { ...base, level: r.assessorLevel ?? null };
}

export function toObservations(rows: EvidenceRecord[]): Observations {
  const obs: Observations = {};
  for (const r of rows) {
    const def = indicatorById(r.indicatorId);
    if (!def) continue;
    obs[r.indicatorId] = toObservation(def, r);
  }
  return obs;
}

/** The derived, display-side reading of one row. */
export interface DerivedRow {
  cls: EvidenceClass | "";
  level: number | null;
  stale: boolean;
}

export function deriveRow(def: IndicatorDef, r: EvidenceRecord): DerivedRow {
  const o = toObservation(def, r);
  const cls = scorer.evidenceClass(o);
  let level: number | null = null;
  if (!r.ratificationHold && cls !== "" && cls !== "Gap") {
    if (cls === "Measured" && def.thresholds && typeof o.value === "number") {
      const higher = def.direction === "higher-is-better";
      let lv = 1;
      def.thresholds.forEach((t, k) => {
        if (higher ? (o.value as number) >= t : (o.value as number) <= t) lv = k + 2;
      });
      level = lv;
    } else {
      level = r.assessorLevel ?? null;
    }
  }
  const stale = Boolean(
    r.observationYear &&
      cls !== "Gap" &&
      cls !== "" &&
      r.observationYear < model.config.assessment_year - model.config.staleness_years,
  );
  return { cls, level, stale };
}

/**
 * One fixture observation (the assessment pipeline's input shape) as a stored
 * evidence row — how the demonstration pack loads the real Egypt and Nigeria
 * assessments. A withheld level in the pipeline (level null on a non-gap row)
 * becomes a ratification hold; a level on a non-threshold reading becomes the
 * assessor level; a numeric threshold reading carries no level at all, because
 * it scores itself.
 */
export interface FixtureObservation {
  value: number | string | null;
  cls?: string;
  level?: number | null;
  year?: number | null;
  src?: string | null;
  tier?: string | null;
  url?: string | null;
}

export function fixtureToRecord(
  indicatorId: string,
  f: FixtureObservation,
  actor: { role: string; name: string },
): EvidenceRecord {
  const def = indicatorById(indicatorId);
  if (!def) throw new Error(`fixture names unknown indicator ${indicatorId}`);
  const isNum = typeof f.value === "number";
  const measuredThreshold = isNum && def.thresholds !== null;
  const isGap = typeof f.value === "string" && f.value.toUpperCase().includes("DATA GAP");
  const held = f.level === null && !isGap && f.value !== null;
  return {
    indicatorId,
    valueRaw: f.value === null ? null : String(f.value),
    observationYear: f.year ?? null,
    sourceName: f.src ?? null,
    sourceUrl: f.url ?? null,
    sourceTier: (f.tier as SourceTier) || null,
    assessorLevel: held || measuredThreshold || isGap ? null : (f.level ?? null),
    ratificationHold: held,
    assessorRole: actor.role,
    assessorName: actor.name,
    assessedAt: null,
    notes: null,
  };
}
