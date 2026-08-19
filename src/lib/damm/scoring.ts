import type {
  Band,
  ClaimPolicy,
  CompositeScore,
  DammModel,
  EvidenceRow,
  GateStatus,
  IndicatorDef,
  PillarId,
  PillarScore,
  Scorecard,
  StageResult,
} from "./types.ts";

export function suggestedLevel(indicator: IndicatorDef, value: number | null): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!indicator.cuts || indicator.cuts.length === 0) return null;
  if (indicator.direction === "N/A") return null;
  const [l2, l3, l4, l5] = indicator.cuts;
  if (indicator.direction === "Lower") {
    const pairs: Array<[number, number | undefined]> = [
      [5, l5],
      [4, l4],
      [3, l3],
      [2, l2],
    ];
    for (const [level, cut] of pairs) {
      if (cut !== undefined && cut !== null && value <= cut) return level;
    }
    return 1;
  }
  const pairs: Array<[number, number | undefined]> = [
    [5, l5],
    [4, l4],
    [3, l3],
    [2, l2],
  ];
  for (const [level, cut] of pairs) {
    if (cut !== undefined && cut !== null && value >= cut) return level;
  }
  return 1;
}

export function finalLevel(row: Pick<EvidenceRow, "dataGap" | "assessorLevel" | "suggestedLevel">): number | null {
  if (row.dataGap) return null;
  if (row.assessorLevel !== null && row.assessorLevel !== undefined) return row.assessorLevel;
  return row.suggestedLevel ?? null;
}

export function isStale(
  indicator: IndicatorDef,
  row: Pick<EvidenceRow, "observationYear"> & { value?: number | null },
  assessmentYear: number,
  level: number | null,
): boolean {
  if (row.observationYear === null || row.observationYear === undefined) return false;
  const aged = assessmentYear - row.observationYear > indicator.max_age;
  if (!aged) return false;
  // Context profile rows are never levelled; staleness still counts when a value exists.
  if (indicator.role === "Context" || indicator.pillar === "C0") {
    return row.value !== null && row.value !== undefined;
  }
  return level !== null;
}

export function bandFor(score: number | null, bands: Band[]): string | null {
  if (score === null || Number.isNaN(score)) return null;
  for (const band of bands) {
    if (score >= band.lo && score < band.hi) return band.name;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pillarScore(
  model: DammModel,
  id: PillarId,
  rowsById: Map<string, EvidenceRow>,
): PillarScore {
  const def = model.pillars[id];
  const indicators = model.indicators.filter((i) => i.pillar === id);
  const levels: number[] = [];
  const confidences: number[] = [];
  let stale = 0;
  for (const ind of indicators) {
    const row = rowsById.get(ind.id);
    if (!row) continue;
    const suggested = row.suggestedLevel ?? suggestedLevel(ind, row.value);
    const level = finalLevel({
      dataGap: row.dataGap,
      assessorLevel: row.assessorLevel,
      suggestedLevel: suggested,
    });
    if (level !== null) {
      levels.push(level);
      const w = row.confidence ? model.confidence_weights[row.confidence] : undefined;
      if (typeof w === "number") confidences.push(w);
    }
    if (isStale(ind, row, model.assessment_year, level)) stale += 1;
  }
  const total = indicators.length;
  const scored = levels.length;
  const coverage = total === 0 ? 0 : scored / total;
  const aggregated = def.aggregated !== false && id !== "C0";
  const score =
    aggregated && coverage >= model.coverage_gates.pillar_min ? mean(levels) : aggregated ? null : null;
  return {
    id,
    name: def.name,
    role: def.role,
    weight: def.weight ?? null,
    aggregated,
    total,
    scored,
    coverage,
    score,
    band: bandFor(score, model.bands),
    confidence: mean(confidences),
    stale,
  };
}

function weightedComposite(
  key: "CMS" | "EMS" | "OES",
  name: string,
  members: PillarScore[],
): CompositeScore {
  const ids = members.map((m) => m.id);
  const anyUnrated = members.some((m) => m.score === null);
  const scored = members.reduce((a, m) => a + m.scored, 0);
  const total = members.reduce((a, m) => a + m.total, 0);
  const coverage = total === 0 ? 0 : scored / total;
  if (anyUnrated) {
    return {
      key,
      name,
      score: null,
      coverage,
      band: null,
      suppressedReason: "A member pillar is not rated",
      members: ids,
    };
  }
  let acc = 0;
  for (const m of members) {
    acc += (m.score ?? 0) * (m.weight ?? 0);
  }
  return {
    key,
    name,
    score: acc,
    coverage,
    band: null,
    suppressedReason: null,
    members: ids,
  };
}

export function computeStage(model: DammModel, card: Omit<Scorecard, "stage">): StageResult {
  const { cms, ems, oes, unmeasuredCoreGates, coreGateFailures, pillars } = card;
  const gates = model.coverage_gates;
  const th = model.stage_thresholds;
  const capPillars = pillars.filter((p) => ["C1", "C2", "C3", "C4"].includes(p.id));

  if (cms.coverage < gates.cms_min || capPillars.some((p) => p.coverage < gates.pillar_min)) {
    return {
      code: "NOT_RATED_CMS",
      label: "NOT RATED - insufficient capability evidence",
      rated: false,
      reason:
        "Capability coverage is below the gate: CMS coverage must reach the configured minimum and every capability pillar must clear its coverage floor.",
    };
  }
  if (unmeasuredCoreGates > 0) {
    return {
      code: "NOT_RATED_GATES",
      label: "NOT RATED - core gate(s) unmeasured",
      rated: false,
      reason: `${unmeasuredCoreGates} core-gate indicator${unmeasuredCoreGates === 1 ? " is" : "s are"} unmeasured. A gap cannot be hidden by not measuring it.`,
    };
  }
  if (coreGateFailures > 0) {
    return {
      code: "STAGE_1",
      label: "Stage 1 - Foundation constrained",
      rated: true,
      reason: `${coreGateFailures} core gate${coreGateFailures === 1 ? "" : "s"} at Level 1. Foundations are not tradeable.`,
    };
  }
  // v1.5 semantics: `stageN_*` is the FLOOR a read-out must reach to be AT
  // stage N, and the achieved stage is the highest N whose floors are all
  // met. v1.3's code read each threshold as the CEILING of its own stage,
  // which returned one stage too high — Egypt at CMS 3.07 scored Stage 3
  // where the workbook scores Stage 2. A maturity model that overstates is
  // worse than one that understates, so the direction of that error mattered.
  if (cms.score === null || cms.score < th.stage2_cms) {
    return {
      code: "STAGE_1",
      label: "Stage 1 - Foundation constrained",
      rated: true,
      reason: `CMS ${cms.score === null ? "is not rated" : `(${cms.score.toFixed(2)}) is below the Stage 2 floor (${th.stage2_cms})`}.`,
    };
  }
  if (ems.coverage < gates.ems_min) {
    return {
      code: "NOT_RATED_EMS",
      label: "NOT RATED - ecosystem evidence insufficient for staging",
      rated: false,
      reason: "Ecosystem coverage is below the configured minimum required to stage beyond Stage 2.",
    };
  }
  const meetsStage3 = cms.score >= th.stage3_cms && ems.score !== null && ems.score >= th.stage3_ems;
  if (!meetsStage3) {
    return {
      code: "STAGE_2",
      label: "Stage 2 - Capability building",
      rated: true,
      reason: `CMS ${cms.score.toFixed(2)} / EMS ${ems.score === null ? "not rated" : ems.score.toFixed(2)} — below the Stage 3 floors (CMS ${th.stage3_cms}, EMS ${th.stage3_ems}).`,
    };
  }
  // Stage 4 and above require outcome evidence, not just capability.
  if (oes.coverage < gates.cms_min) {
    return {
      code: "STAGE_3_THIN_OES",
      label: "Stage 3 - Ecosystem scaling (outcome evidence insufficient to stage higher)",
      rated: true,
      reason: `OES coverage is below ${gates.cms_min}. Stage 4 and above are withheld.`,
    };
  }
  const meetsStage4 =
    cms.score >= th.stage4_cms &&
    ems.score !== null && ems.score >= th.stage4_ems &&
    oes.score !== null && oes.score >= th.stage4_oes;
  if (!meetsStage4) {
    return {
      code: "STAGE_3",
      label: "Stage 3 - Ecosystem scaling",
      rated: true,
      reason: `Below the Stage 4 floors (CMS ${th.stage4_cms}, EMS ${th.stage4_ems}, OES ${th.stage4_oes}).`,
    };
  }
  // v1.5 introduces explicit Stage-5 floors; v1.3 reused the Stage-4 numbers
  // and so promoted to Stage 5 too readily. Fall back to them only if absent.
  const s5cms = th.stage5_cms ?? th.stage4_cms;
  const s5ems = th.stage5_ems ?? th.stage4_ems;
  const s5oes = th.stage5_oes ?? th.stage4_oes;
  const meetsStage5 =
    cms.score >= s5cms &&
    ems.score !== null && ems.score >= s5ems &&
    oes.score !== null && oes.score >= s5oes;
  if (!meetsStage5) {
    return {
      code: "STAGE_4",
      label: "Stage 4 - Integrated scale",
      rated: true,
      reason: `Below the Stage 5 floors (CMS ${s5cms}, EMS ${s5ems}, OES ${s5oes}).`,
    };
  }
  return {
    code: "STAGE_5",
    label: "Stage 5 - Transformative & inclusive",
    rated: true,
    reason: "All read-outs and gates clear the Stage 5 floors.",
  };
}

export function scoreAssessment(model: DammModel, rows: EvidenceRow[]): Scorecard {
  const rowsById = new Map(rows.map((r) => [r.indicatorId, r]));
  const pillarIds = Object.keys(model.pillars) as PillarId[];
  const pillars = pillarIds.map((id) => pillarScore(model, id, rowsById));

  const byId = Object.fromEntries(pillars.map((p) => [p.id, p])) as Record<PillarId, PillarScore>;
  const cms = weightedComposite("CMS", "Capability Maturity Score", [byId.C1, byId.C2, byId.C3, byId.C4]);
  cms.band = bandFor(cms.score, model.bands);
  const ems = weightedComposite("EMS", "Ecosystem Maturity Score", [byId.E1, byId.E2]);
  ems.band = bandFor(ems.score, model.bands);
  const oes: CompositeScore = {
    key: "OES",
    name: "Outcome & Equity Score",
    score: byId.O1.score,
    coverage: byId.O1.coverage,
    band: bandFor(byId.O1.score, model.bands),
    suppressedReason: byId.O1.score === null ? "Outcomes pillar is not rated" : null,
    members: ["O1"],
  };

  const gates: GateStatus[] = model.core_gates.map((id) => {
    const ind = model.indicators.find((i) => i.id === id)!;
    const row = rowsById.get(id);
    const suggested = row ? (row.suggestedLevel ?? suggestedLevel(ind, row.value)) : null;
    const level = row
      ? finalLevel({
          dataGap: row.dataGap,
          assessorLevel: row.assessorLevel,
          suggestedLevel: suggested,
        })
      : null;
    return {
      id,
      name: ind.name,
      pillar: ind.pillar,
      finalLevel: level,
      unmeasured: level === null,
      failed: level === 1,
      stale: row ? isStale(ind, row, model.assessment_year, level) : false,
    };
  });

  let staleCount = 0;
  let levelledCount = 0;
  let importedCount = 0;
  let namedGapCount = 0;
  let validatedCount = 0;
  let dataGapCount = 0;
  for (const ind of model.indicators) {
    const row = rowsById.get(ind.id);
    if (!row) continue;
    const suggested = row.suggestedLevel ?? suggestedLevel(ind, row.value);
    const level = finalLevel({
      dataGap: row.dataGap,
      assessorLevel: row.assessorLevel,
      suggestedLevel: suggested,
    });
    if (level !== null) {
      levelledCount += 1;
    }
    if (isStale(ind, row, model.assessment_year, level)) staleCount += 1;
    if (row.provenance === "machine-imported" || row.provenance === "proxy") importedCount += 1;
    if (row.provenance === "named-gap") namedGapCount += 1;
    if (row.assessorLevel !== null && row.assessorLevel !== undefined) validatedCount += 1;
    if (row.dataGap) dataGapCount += 1;
  }

  const partial = {
    assessmentYear: model.assessment_year,
    pillars,
    cms,
    ems,
    oes,
    gates,
    unmeasuredCoreGates: gates.filter((g) => g.unmeasured).length,
    coreGateFailures: gates.filter((g) => g.failed).length,
    staleCount,
    levelledCount,
    importedCount,
    namedGapCount,
    validatedCount,
    dataGapCount,
  };
  const stage = computeStage(model, partial);
  return { ...partial, stage };
}

export function claimableStage(
  card: Scorecard,
  policy: ClaimPolicy,
): { claimable: boolean; display: string; explanation: string } {
  if (!policy.mandateRecorded || policy.currentStep < 5) {
    return {
      claimable: false,
      display: "Engagement package — no stage claimable",
      explanation:
        "Everything assembled before the government mandate is preparatory material for a Bank decision, not an assessment of the country.",
    };
  }
  if (!policy.validationRecorded) {
    return {
      claimable: false,
      display: "Provisional — awaiting panel validation",
      explanation:
        "Machine-suggested levels feed the scores you see. No stage is claimable until an assessor validates the evidence at Step 6.",
    };
  }
  if (policy.gauntletPassed === false) {
    return {
      claimable: false,
      display: "Evidence gauntlet not passed",
      explanation:
        "The 13 core gates have not cleared the evidence gauntlet (80% populated, 60% A/B, no silent gaps). Prescriptive chapters carry the conditional banner; the draft remains available.",
    };
  }
  return {
    claimable: card.stage.rated,
    display: card.stage.label,
    explanation: card.stage.reason,
  };
}

export function formatScore(n: number | null, digits = 2): string {
  if (n === null || Number.isNaN(n)) return "Not rated";
  return n.toFixed(digits);
}

export function formatPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** Persist and compare at two decimal places — publisher floats are noise beyond that. */
export function roundObserved(n: number): number {
  return Number(n.toFixed(2));
}

/** Table / draft / CSV display: at most two decimals, no trailing zeros. */
export function formatObserved(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return String(roundObserved(n));
}

export function emptyRow(indicatorId: string): EvidenceRow {
  return {
    indicatorId,
    value: null,
    observationYear: null,
    sourceName: null,
    sourceUrl: null,
    confidence: null,
    provenance: null,
    isProxy: false,
    proxyNote: null,
    dataGap: false,
    gapSteward: null,
    gapSource: null,
    suggestedLevel: null,
    assessorLevel: null,
    assessorName: null,
    assessorRole: null,
    assessedAt: null,
    notes: null,
  };
}
