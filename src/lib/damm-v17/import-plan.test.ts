import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PIPELINE_ROLE, isHumanEntry, planImport, summariseImport } from "./import-plan.ts";
import type { EvidenceRecord } from "./evidence.ts";
import { model } from "./model.ts";

const PASS = { role: PIPELINE_ROLE, name: "EGY_202608251407_a1b2c3 · anthropic/claude-opus-5" };

function rec(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    indicatorId: "1.1",
    valueRaw: null,
    observationYear: null,
    sourceName: null,
    sourceUrl: null,
    sourceTier: null,
    assessorLevel: null,
    ratificationHold: false,
    assessorRole: null,
    assessorName: null,
    assessedAt: null,
    notes: null,
    ...over,
  };
}

const empty = () => model.indicators.map((i) => rec({ indicatorId: i.id }));

describe("whose entry a row is", () => {
  it("an untouched row belongs to nobody", () => {
    assert.equal(isHumanEntry(rec()), false);
  });

  it("a row a pass wrote belongs to the pass", () => {
    assert.equal(isHumanEntry(rec({ valueRaw: "8942", assessorRole: PIPELINE_ROLE })), false);
  });

  it("a row an assessor wrote is theirs", () => {
    assert.equal(isHumanEntry(rec({ valueRaw: "62.4", assessorRole: "TTL" })), true);
  });

  it("a ratification hold on an empty row is a judgement too", () => {
    // Overwriting this would erase a withheld level, which reads afterwards as a level
    // nobody withheld — the opposite of what the assessor decided.
    assert.equal(isHumanEntry(rec({ ratificationHold: true })), true);
  });

  it("treats unknown provenance as a person's, which is the cautious direction", () => {
    assert.equal(isHumanEntry(rec({ valueRaw: "12" })), true);
  });
});

describe("planning an import", () => {
  it("writes every row of a pass into an untouched country", () => {
    const plan = planImport(empty(), { "1.1": { value: 8942, cls: "Measured", level: 4, year: 2025 } }, PASS);
    assert.equal(plan.records.length, 1);
    assert.equal(plan.held.length, 0);
    assert.equal(plan.records[0].assessorRole, PIPELINE_ROLE);
  });

  it("never overwrites a person's entry, and shows both readings", () => {
    const existing = empty().map((r) =>
      r.indicatorId === "1.1"
        ? rec({ indicatorId: "1.1", valueRaw: "62.4", sourceTier: "T2", observationYear: 2024, assessorRole: "TTL", assessorName: "K. R." })
        : r,
    );
    const plan = planImport(existing, { "1.1": { value: 58.1, cls: "Measured", tier: "T1", year: 2025 } }, PASS);
    assert.equal(plan.records.length, 0);
    assert.equal(plan.held.length, 1);
    assert.match(plan.held[0].yours, /62\.4/);
    assert.match(plan.held[0].found, /58\.1/);
    assert.equal(plan.held[0].assessorName, "K. R.");
  });

  it("replaces a row an earlier pass wrote", () => {
    const existing = empty().map((r) =>
      r.indicatorId === "1.1" ? rec({ indicatorId: "1.1", valueRaw: "1", assessorRole: PIPELINE_ROLE }) : r,
    );
    const plan = planImport(existing, { "1.1": { value: 2, cls: "Measured" } }, PASS);
    assert.equal(plan.records.length, 1);
    assert.equal(plan.held.length, 0);
  });

  it("leaves rows a partial pass never reached untouched, and never writes them as gaps", () => {
    // This is the whole instrument in one assertion: a row nobody looked at must not
    // become a row someone looked at and found nothing.
    const plan = planImport(empty(), { "1.1": { value: 1, cls: "Measured" } }, PASS);
    assert.equal(plan.notReached.length, model.indicators.length - 1);
    assert.ok(!plan.records.some((r) => r.indicatorId !== "1.1"));
  });

  it("reports rows the pass produced that this instrument does not have", () => {
    // Carried candidates come out of the pipeline alongside the scored rows. Dropping
    // them silently would lose work the pass paid for without saying so.
    const plan = planImport(empty(), { "A1-CAND-IRR": { value: 100, cls: "Measured" } }, PASS);
    assert.deepEqual(plan.unknown, ["A1-CAND-IRR"]);
    assert.equal(plan.records.length, 0);
  });

  it("carries the pass's note onto the row", () => {
    const plan = planImport(empty(), { "1.1": { value: 1, cls: "Measured", note: "series ends 2022" } as never }, PASS);
    assert.equal(plan.records[0].notes, "series ends 2022");
  });
});

describe("what the operator is told", () => {
  it("says how much was left alone and why, never just a success count", () => {
    const plan = planImport(
      empty().map((r) => (r.indicatorId === "1.1" ? rec({ indicatorId: "1.1", valueRaw: "9", assessorRole: "TTL" }) : r)),
      { "1.1": { value: 1, cls: "Measured" }, "1.2": { value: 2, cls: "Measured" } },
      PASS,
    );
    const s = summariseImport(plan, 2, model.indicators.length);
    assert.match(s, /Imported 1 of the 2 rows/);
    assert.match(s, /you had entered/);
    assert.match(s, /not recorded as gaps/);
  });
});
