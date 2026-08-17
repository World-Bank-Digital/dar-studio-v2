import type { ChapterReadiness, DammModel, RecordedDecision } from "./types.ts";
import { DAR_OUTLINE } from "./outline.ts";

function stepNum(step: number | string): number {
  return Number(step);
}

export function currentOpenStep(decisions: RecordedDecision[], step1Done: boolean): number {
  if (!step1Done) return 1;
  const recorded = new Set(decisions.map((d) => stepNum(d.step)));
  for (let s = 2; s <= 8; s++) {
    if (!recorded.has(s)) return s;
  }
  return 8;
}

export function highestRecordedStep(decisions: RecordedDecision[], step1Done: boolean): number {
  if (!step1Done) return 0;
  const max = decisions.reduce((m, d) => Math.max(m, stepNum(d.step)), 1);
  return max;
}

export function hasDecision(decisions: RecordedDecision[], step: number): boolean {
  return decisions.some((d) => stepNum(d.step) === step);
}

export function canRecordStep(decisions: RecordedDecision[], step1Done: boolean, step: number): boolean {
  if (step < 1 || step > 8) return false;
  if (step === 1) return false;
  if (hasDecision(decisions, step)) return false;
  if (step === 2) return step1Done;
  return hasDecision(decisions, step - 1);
}

export function chapterReadiness(
  model: DammModel,
  decisions: RecordedDecision[],
  step1Done: boolean,
): ChapterReadiness[] {
  const recorded = new Set(decisions.map((d) => stepNum(d.step)));

  // Draft-first: once the Step 1 diagnostic has run, every chapter drafts.
  // "Blockers" are now informational — decisions not yet recorded, which the
  // draft states in place as assumptions rather than refusing to exist. The
  // stage CLAIM (engagement-package rule) is governed elsewhere and unchanged.
  return DAR_OUTLINE.map((ch) => {
    const pending: string[] = [];
    if (!step1Done) {
      pending.push("Step 1 automated diagnostic has not run — there is no evidence base to draft from.");
    }
    const needs = ch.needsDecisions ?? [];
    if (needs.includes("G") && !recorded.has(5)) {
      pending.push("Government gates (Step 5) not yet recorded — drafted as pre-mandate preparatory material.");
    }
    for (const inputStep of ch.inputs) {
      if (inputStep === 1 || recorded.has(inputStep)) continue;
      const rung = model.ladder.find((r) => r.step === inputStep);
      pending.push(`Step ${inputStep}${rung ? ` (${rung.name})` : ""} not yet recorded — drafted from engine facts under stated assumptions.`);
    }

    return {
      n: ch.n,
      title: ch.title,
      status: step1Done ? ("inputs_ready" as const) : ("inputs_forming" as const),
      blockers: pending,
      readyAt: ch.readyAt,
      producedBy: ch.producedBy,
      note: ch.note ?? "",
    };
  });
}

export function nextAction(
  model: DammModel,
  decisions: RecordedDecision[],
  step1Done: boolean,
): { step: number; text: string } {
  const open = currentOpenStep(decisions, step1Done);
  const rung = model.ladder.find((r) => r.step === open);
  if (!step1Done) {
    return { step: 1, text: "Launch or finish the automated diagnostic so the machine can hand over." };
  }
  if (hasDecision(decisions, 8)) {
    return { step: 8, text: "The record is adopted. Export the workbook and the DAR draft, then version the archive." };
  }
  return {
    step: open,
    text: rung
      ? `Record the Step ${open} decision: ${rung.decision ?? rung.name}. Advisory only — the ladder will not move until a human records it.`
      : `Record Step ${open}.`,
  };
}