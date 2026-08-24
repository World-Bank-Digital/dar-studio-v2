/**
 * DAMM v1.7 — types for the canonical model file.
 *
 * These mirror `src/data/model_v1_7.schema.json`, which is the contract. The model
 * file is MODEL ONLY — indicator metadata and scoring rules. Country observations,
 * assessments and rendered outputs are separate payloads with their own shapes.
 *
 * v1.7 is a different instrument from the v1.5 model this app was built on: there
 * are no stages, no CMS/EMS/OES composites, no coverage arithmetic, no confidence
 * weights and no core gates. Do not reach for `../damm/types.ts` equivalents here —
 * the concepts were removed from the model on purpose, not renamed.
 */

export type PillarId = "A1" | "C1" | "C2" | "C3" | "C4" | "E1" | "O1";
export type LayerId = "Foundation" | "Enablers" | "Transformation" | "Outcomes";
export type UseCaseId = "ADV" | "SMF" | "MKT" | "SCM" | "FIN" | "AGI";

/**
 * Derived from what was recorded, never chosen: a number is Measured, a sourced
 * citation at an admissible tier is Documented, an unsourced (or T5-only) statement
 * is Judged, and a recorded search trail is a Gap.
 */
export type EvidenceClass = "Measured" | "Documented" | "Judged" | "Gap";

export type SourceTier = "T1" | "T2" | "T3" | "T4" | "T5";

/** Presence only — a fact, never an opinion. An unrated row asserts nothing. */
export type PrereqStatus = "Present" | "Present (narrow)" | "Absent" | "Unverified";

export type MatrixStatus = "Ready" | "Partial" | "Blocked" | "Unverified";

export type Direction = "higher-is-better" | "lower-is-better" | null;

export interface PillarDef {
  name: string;
  /** A "need" pillar is NOT digital maturity: a low reading is a large opportunity. */
  reading: "need" | "capability" | "outcome";
  note?: string;
}

export interface Band {
  name: string;
  /** Half-open [lo, hi). Governed by open decision 13.1. */
  lo: number;
  hi: number;
}

export interface BindingRule {
  id: string;
  rule: string;
  /** False until the section-13 ruling lands. Render as provisional, never as settled. */
  ratified: boolean;
  decision?: string;
  note?: string;
}

export interface RatificationQuestion {
  open_question: string;
  severity?: "asserts-falsehood" | "construct-drift" | "unit-ambiguity";
  decision: string;
}

export interface IndicatorDef {
  id: string;
  name: string;
  pillar: PillarId;
  layer: LayerId;
  /** Use-case columns this row's level enters (plus every column when tags has "ALL"). */
  use_cases: UseCaseId[];
  /** Non-column tags: NEED, EQ, ALL, AI. */
  tags: string[];
  /** UNIVERSAL | "UC:<comma-list>" | DELIVERY | null. */
  prerequisite: string | null;
  method: "threshold" | "ladder";
  direction: Direction;
  /** Four cut-points; level = 1 + how many are met. Null for ladder rows. */
  thresholds: number[] | null;
  /**
   * Ruling 13.7: the v1.5 rows this indicator absorbed in the 102→57 census, nested
   * beneath it as unscored detail. Names recovered from the v1.5 workbook. These carry
   * no level and enter no mean.
   */
  absorbs: { id: string; name: string }[];
  /** Present (and false) where the cut-points are still test values (13.6). */
  thresholds_ratified?: boolean;
  /** Present where the row carries an open definitional question (13.5). */
  ratification?: RatificationQuestion;
}

/** Closed vocabulary of derived structures a DAR chapter may cite. */
export type DerivedSourceId = string;

/**
 * What one DAR chapter is permitted to cite. A chapter may draw on ONLY what
 * its binding names; `"*"` means all of that kind. This is what lets the
 * fidelity check ask "did it use the *right* number", not merely "did it
 * invent one" — a financing chapter citing connectivity indicators reads
 * fluently and is wrong.
 */
export interface ChapterBinding {
  pillars: PillarId[];
  indicators: string[];
  use_cases: UseCaseId[];
  prerequisites: string[];
  derived: DerivedSourceId[];
}

export interface DarChapter {
  n: string;
  title: string;
  /** Prescriptive chapters render marked *proposed, not evidenced*. */
  kind: "diagnostic" | "prescriptive";
  content: string;
  binding: ChapterBinding;
  note: string;
}

export interface ForesightStep {
  id: string;
  name: string;
  purpose: string;
}

/** The foresight method, declared in the model so it is ratifiable. */
export interface Foresight {
  method: string;
  ratified: boolean;
  settled_by?: string;
  steps: ForesightStep[];
  milestone_binding: {
    rule: string;
    fields: string[];
    fallback: string;
    provisionality?: string;
  };
  note?: string;
}

/**
 * A metric carried beside the model without entering it. Foresight may propose
 * one where no existing indicator fits a milestone; promotion to a scored
 * indicator is a versioned model change, never automatic.
 */
export interface CandidateIndicatorRule {
  purpose: string;
  id_pattern: string;
  required_fields: string[];
  may_be_proposed_by?: string[];
  /** Aggregates a candidate must never enter. */
  never: string[];
  disposition: string;
}

export interface OpenDecision {
  id: string;
  title: string;
  /** The model-file fields this ruling governs — how the UI knows what is provisional. */
  governs: string[];
  scope?: string;
}

export interface ModelConfig {
  assessment_year: number;
  staleness_years: number;
  readiness_threshold: number;
  leapfrog_threshold: number;
  rounding: "half-up";
  rounding_note?: string;
}

export interface DammModelV17 {
  model: "DAMM";
  title: string;
  version: string;
  /** Bumped on every change to a ratifiable value. Consumers pin on version+revision. */
  revision: number;
  status: string;
  /** False while any open decision is unresolved. */
  ratified: boolean;
  ratification_note: string;
  generated_from: string;
  generated_on: string;
  prohibitions: string[];
  config: ModelConfig;
  pillars: Record<PillarId, PillarDef>;
  layers: LayerId[];
  use_cases: Record<UseCaseId, string>;
  non_use_case_tags: Record<string, string>;
  evidence_classes: { id: EvidenceClass; derived_from: string; levels: string }[];
  source_tiers: Record<SourceTier, string>;
  tier_note: string;
  bands: Band[];
  prerequisite_kinds: Record<string, string>;
  prerequisite_status: Record<PrereqStatus, string>;
  binding_rules: BindingRule[];
  invariants: string[];
  indicators: IndicatorDef[];
  derived_sources: Record<DerivedSourceId, string>;
  dar_outline: DarChapter[];
  foresight: Foresight;
  candidate_indicators: CandidateIndicatorRule;
  open_decisions: OpenDecision[];
}

/**
 * One observation row, as an assessment supplies it — the same shape the pipeline's
 * input files use. `value` carries a number (→ Measured), prose (→ Documented/Judged
 * by source and tier) or a "DATA GAP …" search trail (→ Gap).
 */
export interface Observation {
  value: number | string | null;
  /** Precomputed class; when absent the scorer derives it from the value. */
  cls?: EvidenceClass | "";
  /**
   * The recorded level. `null` on a row whose level is withheld (ratification hold) —
   * withheld is an assertion of nothing, and such rows sit outside every mean.
   * When the property is absent entirely, the scorer derives threshold levels.
   */
  level?: number | null;
  year?: number | null;
  src?: string | null;
  tier?: SourceTier | "" | null;
  url?: string | null;
}

export type Observations = Record<string, Observation>;

export interface PillarScore {
  n: number;
  /** The mean's own denominator — the rows that actually produced a level. */
  rated: number;
  /** Levels withheld pending ratification; outside the mean, disclosed beside it. */
  held: number;
  mean: number | null;
  band: string;
  /**
   * Ruling 13.1: signed distance from the level the band is named for. +0.00 means the
   * pillar sits squarely at that level; near ±0.50 it is on the edge of the next one.
   */
  margin: number | null;
  /** Judged + gap + held outnumber the levelled measured/documented rows. */
  weak: boolean;
  comp: Record<EvidenceClass, number>;
  stale: number;
}

export interface MatrixCell {
  status: MatrixStatus;
  why: string;
  /**
   * Ruling 13.12: the three roles are separated and only readiness decides the column.
   * Need measures the severity of the agricultural problem, outcome measures what has
   * already been achieved; both are reported and neither is averaged into readiness.
   */
  mean_readiness: number | null;
  mean_need: number | null;
  mean_outcome: number | null;
  n_bearing: number;
}

export interface Assessment {
  pillars: Record<PillarId, PillarScore>;
  layers: Record<LayerId, number | null>;
  leapfrog: { gap: number | null };
  prereq: Record<string, { kind: string; status: PrereqStatus }>;
  matrix: Record<UseCaseId, MatrixCell>;
  counts: Record<EvidenceClass, number>;
  rated: number;
  held: number;
}
