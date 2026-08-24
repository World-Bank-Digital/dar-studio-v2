import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseChunk, parseLine, statusOnExit } from "./run-output.ts";

// Verbatim lines from the Egypt and Nigeria runs of 24 and 25 August 2026. Copied rather
// than composed: a parser tested against invented input tests the invention.
const RESEARCH = `Egypt (EGY) · 59 rows · vendor anthropic/claude-opus-5
budget $500, research allocation $200 (decision G3)

fetching the machine-readable T1 lane for independent corroboration...
  10 of 11 series returned

  [ 1/59] 1.4          pass   Measured   L3 109.1                                $  0.47   51s
G [ 5/59] 1.6          gap    Gap        LNone DATA GAP — Read all nine supplied    $  1.51   78s
H [ 6/59] 1.5          hold   Documented LNone No national all-crop post-harvest    $  1.72   92s
  [59/59] A1-CAND-IRR  pass   Measured   LNone 100.0                                $ 15.14   62s

wrote EGY_shadow_input.json — 59 rows, 23 gaps, 10 held
spend $15.14 of $200 allocated ($500 country ceiling) in 23 minutes, 1003 vendor calls`;

const GATE2 = `Gate 2 on EGY_shadow · reviewer openai/gpt-5.6-terra
scope: 38 of 57 rows — 12 prerequisites, 22 gaps, 11 holds (7 overlap)

  [ 1/38] 1.6          gap          confirmed -> upheld     $  0.32   66s
F [11/38] 3.7          hold         adjust    -> filled     $  2.10  147s
W [32/38] 7.12         prerequisite refuted   -> withdrawn  $  5.50   80s

reviewed 38 rows · adjusted 3 · filled 4 · upheld 29`;

describe("reading the pipeline's progress", () => {
  it("takes the row total and the vendor from the opening line", () => {
    const e = parseLine("Egypt (EGY) · 59 rows · vendor anthropic/claude-opus-5");
    assert.deepEqual(e, { kind: "start", rowsTotal: 59, vendor: "anthropic/claude-opus-5" });
  });

  it("reads a completed row, whatever flag it carries", () => {
    const plain = parseLine(
      "  [ 1/59] 1.4          pass   Measured   L3 109.1                                $  0.47   51s",
    );
    assert.deepEqual(plain, {
      kind: "row",
      rowsDone: 1,
      rowsTotal: 59,
      indicatorId: "1.4",
      outcome: "pass",
      spentUsd: 0.47,
      seconds: 51,
    });
    const held = parseLine(
      "H [ 6/59] 1.5          hold   Documented LNone No national all-crop post-harvest    $  1.72   92s",
    );
    assert.equal(held?.kind, "row");
    assert.equal((held as { indicatorId: string }).indicatorId, "1.5");
    assert.equal((held as { outcome: string }).outcome, "hold");
  });

  it("reads the second review's rows, which report a different outcome vocabulary", () => {
    const e = parseLine("F [11/38] 3.7          hold         adjust    -> filled     $  2.10  147s");
    assert.equal(e?.kind, "row");
    assert.equal((e as { rowsTotal: number }).rowsTotal, 38);
    assert.equal((e as { indicatorId: string }).indicatorId, "3.7");
    assert.equal((e as { spentUsd: number }).spentUsd, 2.1);
  });

  it("handles a row id that is not a number, like a carried candidate", () => {
    const e = parseLine(
      "  [59/59] A1-CAND-IRR  pass   Measured   LNone 100.0                                $ 15.14   62s",
    );
    assert.equal((e as { indicatorId: string }).indicatorId, "A1-CAND-IRR");
  });

  it("drops everything it does not recognise rather than guessing", () => {
    for (const line of [
      "",
      "budget $500, research allocation $200 (decision G3)",
      "fetching the machine-readable T1 lane for independent corroboration...",
      "  10 of 11 series returned",
      "spend $15.14 of $200 allocated ($500 country ceiling) in 23 minutes, 1003 vendor calls",
    ]) {
      assert.equal(parseLine(line), null, `should ignore: ${line}`);
    }
  });

  it("reads a whole research run end to end", () => {
    const ev = parseChunk(RESEARCH);
    assert.equal(ev[0].kind, "start");
    assert.equal(ev.filter((e) => e.kind === "row").length, 4);
    assert.equal(ev.at(-1)?.kind, "finished");
  });

  it("reads a whole second review end to end", () => {
    const ev = parseChunk(GATE2);
    assert.equal(ev.filter((e) => e.kind === "row").length, 3);
    assert.equal(ev.at(-1)?.kind, "finished");
  });

  it("recognises budget exhaustion and an unresearched remainder", () => {
    assert.deepEqual(parseLine("!! budget exhausted in pass 'research': $200.00 of $200.00"), {
      kind: "exhausted",
      message: "budget exhausted in pass 'research': $200.00 of $200.00",
    });
    assert.equal(parseLine("!! 3 rows not researched: ['3.11', '4.5', '6.9']")?.kind, "incomplete");
  });

  it("recognises a traceback on stderr", () => {
    assert.equal(parseLine("Traceback (most recent call last):")?.kind, "failed");
    assert.equal(parseLine("KeyError: 'mean'")?.kind, "failed");
  });
});

describe("what a run's exit means", () => {
  const clean = { exhausted: false, incomplete: false, finished: true, failure: null };

  it("a clean exit that reported its output is done", () => {
    assert.equal(statusOnExit(0, clean).status, "done");
  });

  it("exhaustion outranks a clean exit code", () => {
    // The pipeline exits 0 when it runs out of budget. Trusting the code alone would
    // record a stopped run as a finished one, and the rows it never reached would read
    // as an assessment that looked and found nothing.
    const s = statusOnExit(0, { ...clean, exhausted: true });
    assert.equal(s.status, "exhausted");
    assert.match(s.reason, /absent from the output, not recorded as gaps/);
  });

  it("an unresearched remainder is a failure, because no input was written", () => {
    const s = statusOnExit(0, { ...clean, incomplete: true, finished: false });
    assert.equal(s.status, "failed");
    assert.match(s.reason, /partial input would score/);
  });

  it("a silent clean exit is not evidence of completion", () => {
    const s = statusOnExit(0, { ...clean, finished: false });
    assert.equal(s.status, "failed");
    assert.match(s.reason, /silent exit is not evidence/);
  });

  it("a non-zero exit carries whatever reason was seen", () => {
    const s = statusOnExit(1, { ...clean, failure: "KeyError: 'mean'" });
    assert.equal(s.status, "failed");
    assert.match(s.reason, /KeyError/);
  });
});
