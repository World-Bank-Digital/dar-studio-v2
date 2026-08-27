import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseChunk, parseLine, statusOnExit } from "./run-output.ts";
import { DAR_WORKFLOW } from "./workflow.ts";

// Verbatim lines from the Egypt and Nigeria runs of 24 and 25 August 2026. Copied rather
// than composed: a parser tested against invented input tests the invention.
// The historical upstream "decision G3" text below names a budget design decision. The
// parser deliberately drops it; it is unrelated to TTL/country-owner G3 sign-off.
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

// Canonical upstream output. This is an automated vendor challenge and has no G1/G2
// human-review or approval effect.
const AUTOMATED_CHALLENGE = `Automated challenge on EGY_shadow · challenger openai/gpt-5.6-terra
scope: 38 of 57 rows — 12 prerequisites, 22 gaps, 11 holds (7 overlap)

  [ 1/38] 1.6          gap          confirmed -> upheld     $  0.32   66s
F [11/38] 3.7          hold         adjust    -> filled     $  2.10  147s
W [32/38] 7.12         prerequisite refuted   -> withdrawn  $  5.50   80s

challenged 38 rows · adjusted 3 · filled 4 · upheld 29`;

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

  it("reads automated-challenge rows, which report a different outcome vocabulary", () => {
    const e = parseLine(
      "F [11/38] 3.7          hold         adjust    -> filled     $  2.10  147s",
    );
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

  it("reads a whole automated vendor challenge end to end without calling it human review", () => {
    const ev = parseChunk(AUTOMATED_CHALLENGE);
    const finalEvent = ev.at(-1);
    assert.equal(ev.filter((e) => e.kind === "row").length, 3);
    assert.equal(finalEvent?.kind, "finished");
    assert.match(
      finalEvent?.kind === "finished" ? finalEvent.message : "",
      /does not satisfy G1 or G2 human review/,
    );
  });

  it("keeps the retired reviewed summary as machine-QC-only compatibility input", () => {
    const event = parseLine("reviewed 38 rows · adjusted 3 · filled 4 · upheld 29");
    assert.equal(event?.kind, "finished");
    assert.match(event?.kind === "finished" ? event.message : "", /machine-checked 38 rows/);
    assert.match(
      event?.kind === "finished" ? event.message : "",
      /does not satisfy G1 or G2 human review/,
    );
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

  it("keeps a coordinator preflight error as the terminal reason", () => {
    const event = parseLine(
      "workflow configuration error: explicit Python handler required for: export_package",
    );
    assert.equal(event?.kind, "failed");
    assert.equal(event?.kind === "failed" ? event.authoritative : false, true);
    assert.match(event?.kind === "failed" ? event.message : "", /export_package/);
  });
});

function workflowEvent(
  sequence: number,
  event: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema_version: "damm.workflow-event/v1",
    sequence,
    event,
    timestamp: `2026-08-26T00:00:${String(sequence).padStart(2, "0")}Z`,
    run_id: "EGY_x",
    workflow_id: DAR_WORKFLOW.workflow_id,
    workflow_version: DAR_WORKFLOW.workflow_version,
    ...extra,
  });
}

describe("the coordinator's structured JSONL protocol", () => {
  it("starts one eight-stage run and maps every completed stage to progress", () => {
    const lines = [workflowEvent(1, "start")];
    for (const stage of DAR_WORKFLOW.stages) {
      lines.push(
        workflowEvent(stage.ordinal + 1, "stage_complete", {
          stage_id: stage.id,
          stage_ordinal: stage.ordinal,
          attempt: 1,
          elapsed_seconds: 12.5,
          spent_usd: 1.25,
          cumulative_spent_usd: stage.ordinal * 1.25,
          artifacts: [],
        }),
      );
    }
    lines.push(workflowEvent(10, "workflow_complete"));

    const events = parseChunk(lines.join("\n"));
    assert.deepEqual(events[0], { kind: "start", rowsTotal: 8, vendor: null });
    const stages = events.filter((event) => event.kind === "row");
    assert.equal(stages.length, 8);
    assert.deepEqual(
      stages.map((event) => [event.indicatorId, event.rowsDone, event.rowsTotal]),
      DAR_WORKFLOW.stages.map((stage) => [stage.id, stage.ordinal, 8]),
    );
    assert.equal(events.at(-1)?.kind, "finished");
  });

  it("preserves spend when a handler cannot report a cumulative value", () => {
    const event = parseLine(
      workflowEvent(2, "stage_complete", {
        stage_id: "damm_diagnostic",
        stage_ordinal: 1,
        attempt: 1,
        elapsed_seconds: 2,
        spent_usd: null,
        cumulative_spent_usd: null,
        artifacts: [],
      }),
    );
    assert.equal(event?.kind, "row");
    assert.equal(event?.kind === "row" ? event.spentUsd : 1, null);
  });

  it("records automatic retry and terminal failure without looking for prose on stderr", () => {
    assert.equal(
      parseLine(
        workflowEvent(3, "retry", {
          stage_id: "country_research",
          stage_ordinal: 2,
          attempt: 2,
          elapsed_seconds: 3,
        }),
      )?.kind,
      "note",
    );
    const failure = parseLine(
      workflowEvent(4, "failure", {
        stage_id: "country_research",
        stage_ordinal: 2,
        attempt: 3,
        elapsed_seconds: 8,
        error: { type: "RuntimeError", message: "source retrieval failed" },
      }),
    );
    assert.deepEqual(failure, {
      kind: "failed",
      authoritative: true,
      message: "Country research and credible-source inventory: source retrieval failed",
    });
  });

  it("drops a stage event whose id and ordinal do not match the contract", () => {
    assert.equal(
      parseLine(
        workflowEvent(2, "stage_complete", {
          stage_id: "export_package",
          stage_ordinal: 1,
          cumulative_spent_usd: 1,
        }),
      ),
      null,
    );
  });

  it("does not let another run's event advance this run", () => {
    assert.equal(parseLine(workflowEvent(1, "start"), "a-different-run"), null);
    assert.equal(parseLine(workflowEvent(1, "start"), "EGY_x")?.kind, "start");
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

  it("workflow exhaustion is a terminal failure, never a request for a top-up", () => {
    const s = statusOnExit(0, { ...clean, exhausted: true }, { budgetExhaustion: "terminal" });
    assert.equal(s.status, "failed");
    assert.match(s.reason, /does not wait for a human budget top-up/);
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

  it("an authoritative failure cannot be hidden by a later completion event", () => {
    const result = statusOnExit(0, { ...clean, failure: "stage 8 failed" });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "stage 8 failed");
  });
});

describe("a vendor that went missing mid-run", () => {
  it("reads the line the pipeline records when a discovery peer is unavailable", () => {
    // Verbatim from the Egypt run of 24 August 2026, where the Perplexity key was out of
    // quota and every one of the 59 rows lost its discovery peer.
    const e = parseLine(
      "    ! 1.4: perplexity discovery unavailable — 401 https://api.perplexity.ai/chat/completions :: quota exceeded",
    );
    assert.equal(e?.kind, "degraded");
    assert.equal((e as { vendor: string }).vendor, "perplexity");
    assert.equal((e as { indicatorId: string }).indicatorId, "1.4");
    assert.match((e as { message: string }).message, /quota exceeded/);
  });

  it("is a degradation, not a failure — the row was still researched", () => {
    const ev = parseChunk("    ! 2.1: perplexity discovery unavailable — 500 upstream\n");
    assert.equal(ev[0].kind, "degraded");
    assert.notEqual(ev[0].kind, "failed");
  });
});
