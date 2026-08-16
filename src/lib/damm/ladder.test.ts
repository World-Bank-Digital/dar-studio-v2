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

  it("makes chapter 2 draftable after the diagnostic", () => {
    const chapters = chapterReadiness(model, [], true);
    assert.equal(chapters.find((c) => c.n === "1")?.status, "inputs_ready");
    assert.equal(chapters.find((c) => c.n === "2")?.status, "inputs_ready");
    assert.notEqual(chapters.find((c) => c.n === "3")?.status, "inputs_ready");
  });

  it("unlocks later chapters once the ladder is complete", () => {
    const decisions = [2, 3, 4, 5, 6, 7, 8].map(dec);
    const chapters = chapterReadiness(model, decisions, true);
    assert.ok(chapters.every((c) => c.status === "inputs_ready"));
    assert.match(nextAction(model, decisions, true).text, /adopted/i);
  });
});
