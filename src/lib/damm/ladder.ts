import type { ChapterReadiness, DammModel, RecordedDecision } from "./types.ts";

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
  const reached = step1Done ? Math.max(1, ...decisions.map((d) => stepNum(d.step)), 1) : 0;

  return model.dar_outline.map((ch) => {
    const blockers: string[] = [];
    const needs = ch.needs_decisions ?? [];
    if (needs.includes("G") && !recorded.has(5)) {
      blockers.push("Government gates (Step 5) have not been recorded.");
    }
    const lastInput = Math.max(...ch.inputs, ch.ready_at);
    if (!step1Done && lastInput >= 1) {
      blockers.push("Step 1 automated diagnostic has not finished.");
    }
    for (const inputStep of ch.inputs) {
      if (inputStep === 1) continue;
      if (!recorded.has(inputStep) && inputStep <= ch.ready_at) {
        const rung = model.ladder.find((r) => r.step === inputStep);
        blockers.push(
          `Step ${inputStep}${rung ? ` (${rung.name})` : ""} has not been recorded.`,
        );
      }
    }
    if (reached < ch.ready_at && !recorded.has(ch.ready_at) && ch.ready_at !== 1) {
      const rung = model.ladder.find((r) => r.step === ch.ready_at);
      if (!blockers.some((b) => b.includes(`Step ${ch.ready_at}`))) {
        blockers.push(
          `Chapter is produced at Step ${ch.ready_at}${rung ? ` — ${rung.name}` : ""}.`,
        );
      }
    }

    // Chapter 1 is the diagnostic pack. Chapter 2 is a provisional standings
    // note from Step 1 — the claim policy, not readiness, withholds the stage.
    const provisional = step1Done && (ch.n === "1" || ch.n === "2");

    let status: ChapterReadiness["status"] = "not_started";
    if (blockers.length === 0 || provisional) status = "inputs_ready";
    else if (step1Done || reached > 0) status = "inputs_forming";

    return {
      n: ch.n,
      title: ch.title,
      status,
      blockers: provisional ? blockers.filter((b) => !b.includes("Step 1 automated")) : blockers,
      readyAt: ch.ready_at,
      producedBy: ch.produced_by,
      note: ch.note,
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