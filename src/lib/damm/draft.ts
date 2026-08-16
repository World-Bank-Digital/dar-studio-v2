import type {
  ChapterReadiness,
  DammModel,
  EvidenceRow,
  RecordedDecision,
  Scorecard,
} from "./types.ts";
import { claimableStage, formatObserved, formatPct, formatScore } from "./scoring.ts";
import { disclaimer } from "./model.ts";
import { DAR_OUTLINE, isPrescriptive } from "./outline.ts";

export interface DraftPayload {
  countryName: string;
  iso3: string;
  generatedAt: string;
  modelVersion: string;
  assessmentYear: number;
  currentStep: number;
  mandateRecorded: boolean;
  validationRecorded: boolean;
  scorecard: Scorecard;
  claim: ReturnType<typeof claimableStage>;
  chapters: ChapterReadiness[];
  decisions: RecordedDecision[];
  evidence: Array<{
    id: string;
    name: string;
    pillar: string;
    role: string;
    value: number | null;
    year: number | null;
    source: string | null;
    sourceUrl: string | null;
    confidence: string | null;
    credibilityTier?: string | null;
    credibilityScore?: number | null;
    provenance: string | null;
    proxy: boolean;
    proxyNote: string | null;
    dataGap: boolean;
    gapSteward: string | null;
    suggested: number | null;
    assessor: number | null;
    final: number | null;
    stale: boolean;
    gate: boolean;
  }>;
  targeting: {
    chains: string[];
    rejected: string[];
    notes: string | null;
  } | null;
  gauntletPassed?: boolean;
  gauntletSummary?: string;
  dossier?: Array<{
    title: string;
    summary: string;
    year: number | null;
    sourceName: string;
    sourceUrl: string;
    grade: string;
    score: number;
    informs: string;
    relatedIndicator: string | null;
  }>;
}

export interface DraftChapter {
  n: string;
  title: string;
  ready: boolean;
  machineDrafted: boolean;
  modelName: string;
  draftedAt: string;
  body: string;
}

export interface DraftDocument {
  title: string;
  disclaimer: string;
  generatedAt: string;
  modelName: string;
  chapters: DraftChapter[];
}

function factsBlock(p: DraftPayload): string {
  const s = p.scorecard;
  const lines = [
    `Country: ${p.countryName} (${p.iso3})`,
    `Model: ${p.modelVersion}; assessment year ${p.assessmentYear}`,
    `Ladder: Step ${p.currentStep}; mandate ${p.mandateRecorded ? "recorded" : "not recorded"}; validation ${p.validationRecorded ? "recorded" : "not recorded"}`,
    `CMS: ${formatScore(s.cms.score)} (coverage ${formatPct(s.cms.coverage)}, ${s.cms.band ?? "not rated"}${s.cms.suppressedReason ? `; ${s.cms.suppressedReason}` : ""})`,
    `EMS: ${formatScore(s.ems.score)} (coverage ${formatPct(s.ems.coverage)}, ${s.ems.band ?? "not rated"}${s.ems.suppressedReason ? `; ${s.ems.suppressedReason}` : ""})`,
    `OES: ${formatScore(s.oes.score)} (coverage ${formatPct(s.oes.coverage)}, ${s.oes.band ?? "not rated"}${s.oes.suppressedReason ? `; ${s.oes.suppressedReason}` : ""})`,
    `Engine stage: ${s.stage.label}`,
    `Claimable stage: ${p.claim.display}`,
    `Claim explanation: ${p.claim.explanation}`,
    `Core gates unmeasured: ${s.unmeasuredCoreGates}; core gates at Level 1: ${s.coreGateFailures}`,
    `Levelled indicators: ${s.levelledCount}; imported rows: ${s.importedCount}; named gaps: ${s.namedGapCount}; validated: ${s.validatedCount}; explicit data gaps: ${s.dataGapCount}; stale: ${s.staleCount}`,
  ];
  for (const pl of s.pillars) {
    lines.push(
      `Pillar ${pl.id} ${pl.name}: score ${formatScore(pl.score)}, coverage ${formatPct(pl.coverage)} (${pl.scored}/${pl.total}), band ${pl.band ?? "not rated"}, stale ${pl.stale}`,
    );
  }
  for (const g of s.gates) {
    lines.push(
      `Core gate ${g.id} ${g.name}: ${g.unmeasured ? "unmeasured" : `level ${g.finalLevel}`}${g.failed ? " (failure)" : ""}${g.stale ? " (stale)" : ""}`,
    );
  }
  for (const d of p.decisions) {
    lines.push(
      `Decision Step ${d.step}: option “${d.optionName}” by ${d.deciderName} (${d.role}) on ${d.createdAt}${d.rejected ? `; rejected: ${d.rejected}` : ""}${d.notes ? `; notes: ${d.notes}` : ""}`,
    );
  }
  if (p.targeting) {
    lines.push(`Targeting shortlist: ${p.targeting.chains.join("; ") || "(none)"}`);
    lines.push(`Targeting rejected: ${p.targeting.rejected.join("; ") || "(none)"}`);
    if (p.targeting.notes) lines.push(`Targeting notes: ${p.targeting.notes}`);
  }
  return lines.join("\n");
}

function gapNote(ch: ChapterReadiness, extra?: string): string {
  return [
    `Chapter ${ch.n} — ${ch.title} is not drafted.`,
    `Status: ${ch.status.replace("_", " ")}.`,
    `Produced by: ${ch.producedBy}. Ready at Step ${ch.readyAt}.`,
    ch.blockers.length ? `Blockers:\n${ch.blockers.map((b) => `- ${b}`).join("\n")}` : "No blockers listed.",
    extra,
    ch.note,
    "An honest gap note is worth more than plausible filler. This chapter will be assembled when its last input exists and any required decision has been recorded.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function cite(e: DraftPayload["evidence"][number]): string {
  const bits = [`${e.id} ${e.name}`];
  if (e.final !== null) bits.push(`level ${e.final}`);
  if (e.value !== null) bits.push(`value ${formatObserved(e.value)}`);
  if (e.year !== null) bits.push(`observed ${e.year}`);
  if (e.source) bits.push(`source ${e.source}`);
  if (e.sourceUrl) bits.push(`url ${e.sourceUrl}`);
  if (e.credibilityTier) bits.push(`credibility ${e.credibilityTier}${e.credibilityScore != null ? ` (${e.credibilityScore})` : ""}`);
  if (e.proxy) bits.push(`PROXY${e.proxyNote ? `: ${e.proxyNote}` : ""}`);
  if (e.stale) bits.push("STALE");
  if (e.dataGap) bits.push("explicit data gap");
  if (e.provenance === "named-gap") bits.push(`named gap → ${e.gapSteward ?? "steward"}`);
  return bits.join("; ");
}

export function assembleDeterministicDraft(model: DammModel, payload: DraftPayload): DraftDocument {
  const draftedAt = payload.generatedAt;
  const modelName = "deterministic-assembler";
  const chapters: DraftChapter[] = DAR_OUTLINE.map((outline) => {
    const ready = payload.chapters.find((c) => String(c.n) === String(outline.n));
    const policyLocked = payload.gauntletPassed === false && isPrescriptive(outline.n);
    const isReady = !policyLocked && (ready?.status === "inputs_ready" || (ready != null && ready.blockers.length === 0));
    if ((!isReady && ready) || policyLocked) {
      return {
        n: outline.n,
        title: outline.title,
        ready: false,
        machineDrafted: true,
        modelName,
        draftedAt,
        body: gapNote(ready ?? {
          n: outline.n,
          title: outline.title,
          status: "inputs_forming",
          blockers: ["Evidence gauntlet has not passed — chapters that prescribe action stay locked."],
          readyAt: outline.readyAt,
          producedBy: outline.producedBy,
          note: outline.note ?? "",
        }, payload.gauntletSummary),
      };
    }
    const body = assembleChapter(outline.n, payload);
    return {
      n: outline.n,
      title: outline.title,
      ready: true,
      machineDrafted: true,
      modelName,
      draftedAt,
      body,
    };
  });
  return {
    title: `Digital Agriculture Roadmap — first draft — ${payload.countryName}`,
    disclaimer: disclaimer(),
    generatedAt: draftedAt,
    modelName,
    chapters,
  };
}

function assembleChapter(n: string, p: DraftPayload): string {
  const s = p.scorecard;
  switch (n) {
    // Ch.2 — Country and Agrifood Diagnostic (the C0 context pillar).
    case "2": {
      const ctx = p.evidence.filter((e) => e.pillar === "C0");
      const lines = [
        `This chapter profiles agricultural structure and need for ${p.countryName}. Context indicators are not aggregated into any maturity score.`,
        "",
        "Observed context readings:",
      ];
      for (const e of ctx) {
        lines.push(`- ${cite(e)}`);
      }
      lines.push("");
      lines.push(
        "Do not interpret these readings as digital maturity. They describe the sector the roadmap will serve.",
      );
      const dossierCtx = (p.dossier ?? []).filter((d) => d.informs === "chapter-1" || d.informs === "named-lead");
      if (dossierCtx.length) {
        lines.push("");
        lines.push(
          "Country dossier (not scored). These items do not populate indicators and do not change CMS, EMS or OES:",
        );
        for (const d of dossierCtx) {
          lines.push(
            `- ${d.title} (${d.year ?? "n.d."}; ${d.sourceName}; ${d.grade} ${d.score}/100; ${d.sourceUrl}) — ${d.summary}`,
          );
        }
      }
      return lines.join("\n");
    }
    // Ch.3 — Digital Agriculture Ecosystem Assessment carries the maturity read-out.
    case "3": {
      const lines = [
        `Where ${p.countryName} stands is reported as three read-outs, never a single index.`,
        "",
        `CMS (capability): ${formatScore(s.cms.score)}${s.cms.band ? ` — ${s.cms.band}` : ""} — coverage ${formatPct(s.cms.coverage)}.${s.cms.suppressedReason ? ` Suppressed: ${s.cms.suppressedReason}.` : ""}`,
        `EMS (ecosystem): ${formatScore(s.ems.score)}${s.ems.band ? ` — ${s.ems.band}` : ""} — coverage ${formatPct(s.ems.coverage)}.${s.ems.suppressedReason ? ` Suppressed: ${s.ems.suppressedReason}.` : ""}`,
        `OES (outcomes): ${formatScore(s.oes.score)}${s.oes.band ? ` — ${s.oes.band}` : ""} — coverage ${formatPct(s.oes.coverage)}.${s.oes.suppressedReason ? ` Suppressed: ${s.oes.suppressedReason}.` : ""}`,
        "",
        `Engine cascade result: ${s.stage.label}.`,
        `Claimable statement: ${p.claim.display}. ${p.claim.explanation}`,
        "",
        "Pillar profile:",
      ];
      for (const pl of s.pillars.filter((x) => x.aggregated)) {
        lines.push(
          `- ${pl.id} ${pl.name}: ${formatScore(pl.score)} (${pl.band ?? "not rated"}), coverage ${formatPct(pl.coverage)} (${pl.scored} of ${pl.total} levelled).`,
        );
      }
      lines.push("");
      lines.push("Core-gate status:");
      for (const g of s.gates) {
        lines.push(
          `- ${g.id} ${g.name}: ${g.unmeasured ? "unmeasured" : `level ${g.finalLevel}`}${g.failed ? " — failing (Level 1)" : ""}.`,
        );
      }
      lines.push("");
      lines.push(
        `Evidence counts: ${s.levelledCount} levelled, ${s.importedCount} imported, ${s.namedGapCount} named gaps, ${s.validatedCount} assessor-validated, ${s.staleCount} stale.`,
      );
      if (!p.claim.claimable) {
        lines.push("");
        lines.push(
          "No maturity stage is asserted in this draft. The engine result above is preparatory arithmetic, not a country judgement.",
        );
      }
      const leads = (p.dossier ?? []).filter((d) => d.informs === "named-lead" || d.informs === "chapter-2");
      if (leads.length) {
        lines.push("");
        lines.push(
          "Named documentary leads. A lead is not a populated indicator and cannot open the gauntlet:",
        );
        for (const d of leads) {
          lines.push(
            `- ${d.relatedIndicator ? `${d.relatedIndicator} · ` : ""}${d.title} (${d.year ?? "n.d."}; ${d.sourceName}; ${d.grade} ${d.score}/100; ${d.sourceUrl})`,
          );
        }
      }
      return lines.join("\n");
    }
    // Ch.10 — Priority Opportunity Portfolio inherits the Step 3 targeting record.
    case "10": {
      const t = p.targeting;
      const lines = [
        "Vision, targeting and beneficiaries are taken from the recorded Step 3 decision and any government endorsement at Step 5.",
        "",
      ];
      if (t) {
        lines.push(`Proposed value-chain shortlist: ${t.chains.join("; ") || "(none recorded)"}.`);
        lines.push(`Rejected alternatives: ${t.rejected.join("; ") || "(none recorded)"}.`);
        if (t.notes) lines.push(t.notes);
      } else {
        lines.push("No targeting record is stored.");
      }
      const d3 = p.decisions.find((d) => d.step === 3);
      const d5 = p.decisions.find((d) => d.step === 5);
      if (d3) lines.push(`Step 3 recorded by ${d3.deciderName} (${d3.role}) as “${d3.optionName}”.`);
      if (d5) lines.push(`Step 5 government gates recorded by ${d5.deciderName} (${d5.role}) as “${d5.optionName}”.`);
      return lines.join("\n");
    }
    case "A": {
      const lines = [
        "Annex — full indicator evidence base with provenance. Figures below are copied from the engine; none are inferred.",
        "",
      ];
      for (const e of p.evidence) {
        lines.push(`- ${cite(e)}`);
      }
      return lines.join("\n");
    }
    default: {
      const ready = p.chapters.find((c) => c.n === n);
      const related = p.decisions.filter((d) => (ready ? ready.readyAt === d.step || d.step >= 6 : false));
      const lines = [
        `Chapter ${n} is assembled only from recorded decisions and engine facts.`,
        "",
      ];
      if (related.length === 0) {
        lines.push("No recorded decisions yet apply to this chapter.");
      } else {
        for (const d of related) {
          lines.push(`- Step ${d.step}: “${d.optionName}” — ${d.deciderName} (${d.role}) on ${d.createdAt}.`);
          if (d.notes) lines.push(`  Notes: ${d.notes}`);
          if (d.rejected) lines.push(`  Rejected: ${d.rejected}`);
        }
      }
      lines.push("");
      lines.push(
        isPrescriptive(n)
          ? "Recommendations in this chapter must carry an owner, a payer, a legal basis and a delivery channel, or stand as an explicit hypothesis with its decision gate."
          : "This chapter restates what has been recorded and does not prescribe an option.",
      );
      return lines.join("\n");
    }
  }
}

/**
 * The drafting brief.
 *
 * The earlier version forbade recommendations outright, which made the tool an
 * evidence assembler rather than a strategy product. It now recommends — under
 * the discipline the method imposes: a recommendation whose evidence is thin
 * must be written as a hypothesis with the gate that would confirm it, and
 * observed figures stay bounded by the evidence base. That bound is enforced
 * downstream by the fidelity check, not requested here — a prompt is not an
 * enforcement mechanism.
 */
export function draftSystemPrompt(kind: "diagnostic" | "prescriptive" = "diagnostic"): string {
  const shared = [
    "You are a senior digital-development strategist drafting a national Digital Agriculture Roadmap for government decision-makers and an international development institution.",
    "Write for a minister: conclusions first, then why they matter. Calm institutional English, no ranking language, no cross-country comparison.",
    "Never invent a statistic, budget figure, law, institutional mandate, implementation status or programme result.",
    "Cite every observed figure with its source and observation year. Flag PROXY and STALE in place.",
    "If the payload says no maturity stage is claimable, say so in those terms. Never write around a suppressed score.",
    "Distinguish what is verified, what is reported but unverified, what is inferred, and what is unknown. Do not fill an evidence gap to make the chapter look complete.",
    "Label the section as machine-drafted and for human rewriting.",
  ];

  if (kind === "diagnostic") {
    return [
      ...shared,
      "This chapter reports evidence. Describe what is known and what is missing; leave prioritisation, sequencing and investment to the prescriptive chapters.",
      "The existence of a system is not evidence of its effectiveness. Registration is not an inclusion outcome. A minister is not an implementation owner.",
    ].join(" ");
  }

  return [
    ...shared,
    "This chapter prescribes. Recommend, prioritise and sequence — but every consequential recommendation must name its owner, its payer, its legal basis and its delivery channel, or be downgraded to a hypothesis.",
    "Where evidence is insufficient for a firm recommendation, write it as: strategic hypothesis, evidence required, decision gate, action if validated, alternative if rejected.",
    "State entry conditions, success criteria, stop conditions and fallback pathways for each major initiative, and include explicit do-not-do items where the evidence warrants them.",
    "Use cost classes — Low, Moderate, High, Very High — and name what drives the cost. Do not invent precise costs.",
    "Phase boundaries are gates, not dates. Do not assert calendar commitments the payload does not contain.",
  ].join(" ");
}

export function payloadForPrompt(p: DraftPayload): string {
  return factsBlock(p);
}

export function emptyEvidenceRows(_model: DammModel): EvidenceRow[] {
  return _model.indicators.map((i) => ({
    indicatorId: i.id,
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
    assessorRole: null,
    assessorName: null,
    assessedAt: null,
    notes: null,
  }));
}
