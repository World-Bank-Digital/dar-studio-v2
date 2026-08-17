import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { DammModel, RecordedDecision } from "./types.ts";
import { canRecordStep, chapterReadiness, currentOpenStep, hasDecision, nextAction } from "./ladder.ts";

const here = dirname(fileURLToPath(import.meta.url));
const model = JSON.parse(readFileSync(join(here, "../../data/model_v1_3.json"), "utf8")) as DammModel;

function dec(step: number | string): RecordedDecision {
  return {
    step: step as number,
    optionName: "Record",
    deciderName: "TTL",
    role: "TTL",
    notes: null,
    rejected: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    payload: null,
  };
}

describe("ladder", () => {
  it("treats string step ids as recorded", () => {
    const decisions = [dec("2"), dec("3")];
    assert.equal(hasDecision(decisions, 2), true);
    assert.equal(canRecordStep(decisions, true, 4), true);
    assert.equal(currentOpenStep(decisions, true), 4);
  });

  it("draft-first: after Step 1 every chapter drafts; pending decisions are notes, not locks", () => {
    const chapters = chapterReadiness(model, [], true);
    assert.ok(chapters.every((c) => c.status === "inputs_ready"), "nothing blocks once an evidence base exists");
    // The unrecorded ladder is still visible — as stated assumptions in place.
    const exec = chapters.find((c) => c.n === "1")!;
    assert.ok(exec.blockers.length > 0, "pending decisions are reported");
    assert.match(exec.blockers.join(" "), /not yet recorded/);
    assert.doesNotMatch(exec.blockers.join(" "), /stays? locked/i);
  });

  it("before Step 1 there is no evidence base, so chapters are still forming", () => {
    const chapters = chapterReadiness(model, [], false);
    assert.ok(chapters.every((c) => c.status === "inputs_forming"));
  });

  it("unlocks later chapters once the ladder is complete", () => {
    const decisions = [2, 3, 4, 5, 6, 7, 8].map(dec);
    const chapters = chapterReadiness(model, decisions, true);
    assert.ok(chapters.every((c) => c.status === "inputs_ready"));
    assert.match(nextAction(model, decisions, true).text, /adopted/i);
  });
});
