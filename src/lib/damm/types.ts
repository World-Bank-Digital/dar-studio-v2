export type IndicatorRole = "Context" | "Capability" | "Ecosystem" | "Outcome";
export type PillarId = "C0" | "C1" | "C2" | "C3" | "C4" | "E1" | "E2" | "O1";
export type Direction = "Higher" | "Lower" | "N/A";
/**
 * v1.5 renames "Low/Estimated" to "Low" and adds "Data Gap" as an explicit
 * fourth tag weighted 0 — a gap is now recorded rather than left blank, so
 * the evidence-adequacy calculation can distinguish "no data" from "not yet
 * looked at". The old label is retained so historical rows still parse.
 */
export type Confidence = "High" | "Medium" | "Low" | "Data Gap" | "Low/Estimated";
export type Provenance =
  | "machine-imported"
  | "assessor"
  | "named-gap"
  | "proxy"
  | "manual" | "machine-researched";

export interface LevelAnchors {
  L1: string;
  L2: string;
  L3: string;
  L4: string;
  L5: string;
}

export interface IndicatorDef {
  id: string;
  name: string;
  source_type: "Global" | "Local";
  role: IndicatorRole;
  pillar: PillarId;
  pillar_name: string;
  method: string;
  direction: Direction;
  cuts: number[] | null;
  anchors: LevelAnchors;
  gate: boolean;
  max_age: number;
  rubric_status: string;
  calibration_note: string;
}

export interface PillarDef {
  name: string;
  role: "Context" | "Capability" | "Ecosystem" | "Outcome";
  aggregated?: boolean;
  weight?: number;
}

export interface CoverageGates {
  cms_min: number;
  pillar_min: number;
  ems_min: number;
  evidence_adequacy_min: number;
}

export interface Band {
  level: number;
  name: string;
  lo: number;
  hi: number;
}

export interface StageThresholds {
  stage5_cms?: number;
  stage5_ems?: number;
  stage5_oes?: number;
  stage2_cms: number;
  stage3_cms: number;
  stage3_ems: number;
  stage4_cms: number;
  stage4_ems: number;
  stage4_oes: number;
}

export interface LadderOption {
  name: string;
  means: string;
  cost: string;
  suits: string;
}

export interface LadderRung {
  rung: string;
  step: number;
  name: string;
  decider: string;
  decision: string | null;
  options?: LadderOption[];
  guidance: string;
}

export interface DarChapter {
  n: string;
  title: string;
  content: string;
  produced_by: string;
  ready_at: number;
  inputs: number[];
  needs_decisions?: string[];
  note: string;
}

export interface MethodRule {
  title: string;
  text: string;
}

export interface MethodChainStep {
  step: string;
  text: string;
}

export interface GlossaryEntry {
  term: string;
  name: string;
  /** v1.5 drops the short label; optional so both versions parse. */
  short?: string;
  text: string;
}

export interface ProcessStep {
  step: number;
  name: string;
  executor: string;
  output: string;
  guidance: string;
}

export interface DammModel {
  model: string;
  version: string;
  extracted_from: string;
  status: string;
  prohibitions: string[];
  pillars: Record<string, PillarDef>;
  coverage_gates: CoverageGates;
  confidence_weights: Record<string, number>;
  bands: Band[];
  stage_thresholds: StageThresholds;
  /** v1.5: foundation-minus-transformation gap above which leapfrog fragility is flagged. */
  leapfrog_gap?: number;
  /** v1.5: the 4-step process ladder that replaces the 8-rung decision ladder. */
  process_ladder?: ProcessStep[];
  /** v1.5: where the government mandate sits relative to the workbook. */
  mandate_note?: string | null;
  assessment_year: number;
  indicators: IndicatorDef[];
  ladder: LadderRung[];
  roles: string[];
  dar_outline: DarChapter[];
  methodology: {
    purpose: string;
    not: string;
    rules: MethodRule[];
    chain: MethodChainStep[];
    provenance: string;
  };
  glossary: GlossaryEntry[];
  core_gates: string[];
}

export interface EvidenceRow {
  indicatorId: string;
  value: number | null;
  observationYear: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  confidence: Confidence | null;
  provenance: Provenance | null;
  isProxy: boolean;
  proxyNote: string | null;
  dataGap: boolean;
  gapSteward: string | null;
  gapSource: string | null;
  suggestedLevel: number | null;
  assessorLevel: number | null;
  assessorRole: string | null;
  assessorName: string | null;
  assessedAt: string | null;
  notes: string | null;
}

export interface PillarScore {
  id: PillarId;
  name: string;
  role: string;
  weight: number | null;
  aggregated: boolean;
  total: number;
  scored: number;
  coverage: number;
  score: number | null;
  band: string | null;
  confidence: number | null;
  stale: number;
}

export interface CompositeScore {
  key: "CMS" | "EMS" | "OES";
  name: string;
  score: number | null;
  coverage: number;
  band: string | null;
  suppressedReason: string | null;
  members: PillarId[];
}

export interface StageResult {
  code: string;
  label: string;
  rated: boolean;
  reason: string;
}

export interface GateStatus {
  id: string;
  name: string;
  pillar: PillarId;
  finalLevel: number | null;
  unmeasured: boolean;
  failed: boolean;
  stale: boolean;
}

export interface Scorecard {
  assessmentYear: number;
  pillars: PillarScore[];
  cms: CompositeScore;
  ems: CompositeScore;
  oes: CompositeScore;
  stage: StageResult;
  gates: GateStatus[];
  unmeasuredCoreGates: number;
  coreGateFailures: number;
  staleCount: number;
  levelledCount: number;
  importedCount: number;
  namedGapCount: number;
  validatedCount: number;
  dataGapCount: number;
}

export interface ClaimPolicy {
  currentStep: number;
  mandateRecorded: boolean;
  validationRecorded: boolean;
  gauntletPassed?: boolean;
}

export type ChapterStatus = "not_started" | "inputs_forming" | "inputs_ready";

export interface ChapterReadiness {
  n: string;
  title: string;
  status: ChapterStatus;
  blockers: string[];
  readyAt: number;
  producedBy: string;
  note: string;
}

export interface RecordedDecision {
  step: number;
  optionName: string;
  deciderName: string;
  role: string;
  notes: string | null;
  rejected: string | null;
  createdAt: string;
  payload?: { chains?: string[]; rejected?: string[] } | null;
}
