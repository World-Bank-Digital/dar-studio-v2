/**
 * Reading the pipeline's own progress output.
 *
 * The worker spawns `research_orchestrator.py` or `automated_challenge.py` and has to
 * know how far the run has got, what it has spent, and why it stopped. The automated
 * challenge performs machine QC only; it has no G1/G2 human-review or approval effect.
 * Two channels carry progress, and they are used for different things on purpose:
 *
 *  - **The checkpoint files are authoritative.** `<out>_spend.json` carries the ledger and
 *    `<out>_state.json` the completed rows. Those are what the pipeline itself resumes
 *    from, so they are what the run record is reconciled against when a run ends.
 *  - **Stdout is for liveness.** It arrives a row at a time, which is what a progress bar
 *    and a heartbeat need. It is parsed here, and it is never the last word on a number.
 *
 * That split matters because parsing another program's console output is brittle by
 * nature. If a format changes, this file stops producing row events and the progress bar
 * goes quiet — it does not produce a wrong spend figure, because it is not where the
 * spend figure comes from.
 */
import {
  CANONICAL_STAGE_IDS,
  DAR_WORKFLOW,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_STAGE_COUNT,
  type DarWorkflowStageId,
} from "./workflow.ts";

/** A line the worker should act on. Anything unrecognised is deliberately dropped. */
export type RunEvent =
  | { kind: "start"; rowsTotal: number; vendor: string | null }
  | {
      kind: "row";
      indicatorId: string;
      rowsDone: number;
      rowsTotal: number;
      /** Cumulative pass spend as the pipeline reported it on this line. */
      spentUsd: number | null;
      seconds: number;
      /** Research outcomes, or machine-QC outcomes from the automated vendor challenge. */
      outcome: string;
    }
  | { kind: "exhausted"; message: string }
  | { kind: "incomplete"; message: string }
  | { kind: "failed"; message: string; authoritative?: boolean }
  | { kind: "note"; message: string }
  /** A vendor was unavailable for one row. The row was researched on a narrower base. */
  | { kind: "degraded"; vendor: string; indicatorId: string; message: string }
  | { kind: "finished"; message: string };

/**
 *   Egypt (EGY) · 59 rows · vendor anthropic/claude-opus-5
 * The row count is the only place the total is stated before the first row lands.
 */
const START = /^\s*\S.*·\s*(\d+)\s+rows\s*·\s*vendor\s+(\S+)/;

/**
 * A completed row, from either script. The leading mark is the pipeline's own flag
 * column (G gap, H hold, R reject, F filled, W withdrawn, A adjusted, L relevelled), and
 * both scripts end the line with the running spend and the row's wall-clock seconds.
 *
 *     H [ 6/59] 1.5          hold   Documented LNone No national …   $  1.72   92s
 *     F [11/38] 3.7          hold         adjust    -> filled        $  2.10  147s
 */
const ROW = /^\s*[A-Z]?\s*\[\s*(\d+)\s*\/\s*(\d+)\]\s+(\S+)\s+(\S+).*?\$\s*([\d.]+)\s+(\d+)s\s*$/;

/** `!! budget exhausted in pass 'research': $200.00 of $200.00` */
const EXHAUSTED = /^\s*!!\s*(budget exhausted.*)$/i;

/** `!! 3 rows not researched: [...]` — the input is deliberately not written. */
const INCOMPLETE = /^\s*!!\s*(\d+\s+rows not researched.*)$/i;

/** `wrote EGY_shadow_input.json — 59 rows, 23 gaps, 10 held` */
const FINISHED = /^\s*wrote\s+(\S+_input\.json.*)$/;

/** Canonical `challenged …`; retired `reviewed …` remains readable for old checkpoints. */
const FINISHED_AUTOMATED_CHALLENGE = /^\s*((?:challenged|reviewed)\s+\d+\s+rows.*)$/;

/**
 * `    ! 1.4: perplexity discovery unavailable — 401 ... quota ...`
 *
 * The pipeline records this on the row and carries on, which is right: a row that lost
 * its discovery peer was researched on a narrower base than its neighbours, and that is a
 * degradation rather than a failure. Parsed here so the degradation reaches the run
 * record too — a pass where a vendor was down for every row should not read afterwards as
 * a clean success.
 */
const DEGRADED = /^\s*!\s*(\S+?):\s*(\S+)\s+\S+\s+unavailable\s*[—–-]\s*(.*)$/;

/** An unhandled exception reaching stderr. */
const TRACEBACK = /^\s*(Traceback \(most recent call last\):?|\w*(?:Error|Exception):.*)$/;
const WORKFLOW_CONFIGURATION_ERROR = /^\s*(workflow configuration error:.*)$/i;

function workflowStage(
  id: unknown,
  ordinal: unknown,
): { id: DarWorkflowStageId; ordinal: number; title: string } | null {
  if (typeof id !== "string" || !Number.isInteger(ordinal)) return null;
  const index = Number(ordinal) - 1;
  if (index < 0 || CANONICAL_STAGE_IDS[index] !== id) return null;
  const stage = DAR_WORKFLOW.stages[index];
  return { id: stage.id, ordinal: stage.ordinal, title: stage.title };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The coordinator emits JSONL so stage progress is a versioned protocol rather than a
 * regex over prose. A malformed or foreign JSON object is ignored: it must never move a
 * run merely because it happens to contain a field named `event`.
 */
function parseWorkflowLine(line: string, expectedRunId?: string): RunEvent | null {
  if (!line.trimStart().startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    event.schema_version !== WORKFLOW_EVENT_SCHEMA_VERSION ||
    event.workflow_id !== DAR_WORKFLOW.workflow_id ||
    event.workflow_version !== DAR_WORKFLOW.workflow_version ||
    typeof event.run_id !== "string" ||
    event.run_id.length === 0 ||
    (expectedRunId !== undefined && event.run_id !== expectedRunId) ||
    !Number.isInteger(event.sequence) ||
    typeof event.timestamp !== "string"
  ) {
    return null;
  }

  switch (event.event) {
    case "start":
      return { kind: "start", rowsTotal: WORKFLOW_STAGE_COUNT, vendor: null };
    case "stage_start": {
      const stage = workflowStage(event.stage_id, event.stage_ordinal);
      if (!stage) return null;
      return {
        kind: "note",
        message: `Stage ${stage.ordinal} of ${WORKFLOW_STAGE_COUNT} started: ${stage.title}.`,
      };
    }
    case "stage_complete": {
      const stage = workflowStage(event.stage_id, event.stage_ordinal);
      if (!stage) return null;
      return {
        kind: "row",
        indicatorId: stage.id,
        rowsDone: stage.ordinal,
        rowsTotal: WORKFLOW_STAGE_COUNT,
        spentUsd: finiteOrNull(event.cumulative_spent_usd),
        seconds: finiteOrNull(event.elapsed_seconds) ?? 0,
        outcome: "complete",
      };
    }
    case "retry": {
      const stage = workflowStage(event.stage_id, event.stage_ordinal);
      if (!stage) return null;
      const attempt = Number.isInteger(event.attempt) ? ` (attempt ${String(event.attempt)})` : "";
      return {
        kind: "note",
        message: `Stage ${stage.ordinal} of ${WORKFLOW_STAGE_COUNT} is retrying automatically${attempt}: ${stage.title}.`,
      };
    }
    case "failure": {
      const error =
        event.error && typeof event.error === "object" && !Array.isArray(event.error)
          ? (event.error as Record<string, unknown>)
          : null;
      const message =
        typeof error?.message === "string"
          ? error.message
          : "The workflow reported a terminal failure.";
      const stage = workflowStage(event.stage_id, event.stage_ordinal);
      return {
        kind: "failed",
        authoritative: true,
        message: stage ? `${stage.title}: ${message}` : message,
      };
    }
    case "workflow_complete":
      return { kind: "finished", message: "Canonical DAR workflow complete." };
    default:
      return null;
  }
}

export function parseLine(line: string, expectedWorkflowRunId?: string): RunEvent | null {
  const workflow = parseWorkflowLine(line, expectedWorkflowRunId);
  if (workflow) return workflow;
  let m = ROW.exec(line);
  if (m) {
    return {
      kind: "row",
      rowsDone: Number(m[1]),
      rowsTotal: Number(m[2]),
      indicatorId: m[3],
      outcome: m[4],
      spentUsd: Number(m[5]),
      seconds: Number(m[6]),
    };
  }
  if ((m = DEGRADED.exec(line))) {
    return { kind: "degraded", indicatorId: m[1], vendor: m[2], message: m[3].trim() };
  }
  if ((m = EXHAUSTED.exec(line))) return { kind: "exhausted", message: m[1].trim() };
  if ((m = INCOMPLETE.exec(line))) return { kind: "incomplete", message: m[1].trim() };
  if ((m = FINISHED.exec(line))) return { kind: "finished", message: m[1].trim() };
  if ((m = FINISHED_AUTOMATED_CHALLENGE.exec(line))) {
    const detail = m[1].trim().replace(/^(?:challenged|reviewed)/i, "machine-checked");
    return {
      kind: "finished",
      message:
        `Automated vendor challenge complete: ${detail}. ` +
        "Machine QC does not satisfy G1 or G2 human review and records no approval.",
    };
  }
  if ((m = WORKFLOW_CONFIGURATION_ERROR.exec(line))) {
    return { kind: "failed", authoritative: true, message: m[1].trim() };
  }
  if ((m = TRACEBACK.exec(line))) return { kind: "failed", message: m[1].trim() };
  // The start line is checked last: it is the loosest pattern and would otherwise
  // swallow anything containing a middle dot and the word "rows".
  if ((m = START.exec(line))) {
    return { kind: "start", rowsTotal: Number(m[1]), vendor: m[2] || null };
  }
  return null;
}

/** Split a stdout chunk into lines and keep whatever the events say. */
export function parseChunk(chunk: string, expectedWorkflowRunId?: string): RunEvent[] {
  const out: RunEvent[] = [];
  for (const line of chunk.split("\n")) {
    const e = parseLine(line, expectedWorkflowRunId);
    if (e) out.push(e);
  }
  return out;
}

/**
 * The status a run should take when its process exits.
 *
 * Exhaustion outranks the exit code, and that ordering is the point: the pipeline exits
 * cleanly when it runs out of budget, so an exit code of 0 alone would record a stopped
 * run as a finished one, and the rows it never reached would read as an assessment that
 * looked and found nothing.
 */
export function statusOnExit(
  exitCode: number | null,
  seen: { exhausted: boolean; incomplete: boolean; finished: boolean; failure: string | null },
  options: { budgetExhaustion?: "resumable" | "terminal" } = {},
): { status: "done" | "exhausted" | "failed"; reason: string } {
  if (seen.exhausted) {
    if (options.budgetExhaustion === "terminal") {
      return {
        status: "failed",
        reason:
          "The workflow could not complete within its preauthorized ceiling after bounded automatic retries. It ended as a terminal failure and does not wait for a human budget top-up.",
      };
    }
    return {
      status: "exhausted",
      reason:
        "The pass reached its budget allocation and stopped. Rows it did not reach are absent from the output, not recorded as gaps.",
    };
  }
  if (seen.incomplete) {
    return {
      status: "failed",
      reason:
        "The run ended with rows unresearched, so no engine input was written. A partial input would score as though the missing rows had been looked for and not found.",
    };
  }
  if (seen.failure) {
    return { status: "failed", reason: seen.failure };
  }
  if (exitCode !== 0) {
    return {
      status: "failed",
      reason: seen.failure ?? `The pipeline exited with code ${exitCode}.`,
    };
  }
  if (!seen.finished) {
    return {
      status: "failed",
      reason:
        "The pipeline exited cleanly without reporting that it had written its output. Treated as a failure rather than a success, because a silent exit is not evidence of completion.",
    };
  }
  return { status: "done", reason: "" };
}
