import type { DammModel, RecordedDecision, Scorecard } from "./types.ts";
import { claimableStage, formatPct, formatScore } from "./scoring.ts";
import { nextAction } from "./ladder.ts";

export function assembleMemo(input: {
  model: DammModel;
  countryName: string;
  iso3: string;
  step: number;
  scorecard: Scorecard;
  decisions: RecordedDecision[];
  step1Done: boolean;
  mandateRecorded: boolean;
  validationRecorded: boolean;
}): string {
  const rung = input.model.ladder.find((r) => r.step === input.step);
  const claim = claimableStage(input.scorecard, {
    currentStep: input.step,
    mandateRecorded: input.mandateRecorded,
    validationRecorded: input.validationRecorded,
  });
  const next = nextAction(input.model, input.decisions, input.step1Done);
  const s = input.scorecard;
  const lines: string[] = [
    `Decision memo — Step ${input.step}${rung ? `: ${rung.name}` : ""}`,
    `${input.countryName} (${input.iso3})`,
    "",
    "This note is assembled from engine facts. It does not recommend an option.",
    "",
    "Decision required",
    rung?.decision ?? "See the ladder guidance.",
    `Decider: ${rung?.decider ?? "—"}.`,
    "",
    "Guidance",
    rung?.guidance ?? "",
    "",
    "Options and trade-offs",
  ];
  if (rung?.options?.length) {
    for (const o of rung.options) {
      lines.push(`- ${o.name}. Means: ${o.means} Cost: ${o.cost} Suits: ${o.suits}`);
    }
  } else {
    lines.push("This step has no enumerated options in the configuration. Record the decision, the rejected alternatives, and the acting role.");
  }
  lines.push("");
  lines.push("Evidence position");
  lines.push(
    `CMS ${formatScore(s.cms.score)} (${formatPct(s.cms.coverage)} coverage); EMS ${formatScore(s.ems.score)} (${formatPct(s.ems.coverage)}); OES ${formatScore(s.oes.score)} (${formatPct(s.oes.coverage)}).`,
  );
  lines.push(`Engine cascade: ${s.stage.label}. Claimable statement: ${claim.display}. ${claim.explanation}`);
  lines.push(
    `Core gates unmeasured ${s.unmeasuredCoreGates}; failing ${s.coreGateFailures}; stale items ${s.staleCount}; levelled ${s.levelledCount}; named gaps ${s.namedGapCount}.`,
  );
  lines.push("");
  lines.push("What the evidence cannot settle");
  lines.push(
    "Public series do not replace an assessor judgement on anchored rubrics. Named gaps are routing instructions, not scores. A composite is withheld when any member pillar is unrated.",
  );
  if (s.namedGapCount > 0) {
    lines.push(`${s.namedGapCount} named gaps still require a steward.`);
  }
  lines.push("");
  lines.push("Recorded decisions so far");
  if (input.decisions.length === 0) {
    lines.push("None.");
  } else {
    for (const d of input.decisions) {
      lines.push(`- Step ${d.step}: “${d.optionName}” — ${d.deciderName} (${d.role}) on ${d.createdAt}.`);
    }
  }
  lines.push("");
  lines.push("What follows whichever option is chosen");
  lines.push(next.text);
  lines.push("The ladder will not move until a human records the decision. The machine will not choose.");
  return lines.join("\n");
}
