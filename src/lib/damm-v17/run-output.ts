/**
 * Reading the pipeline's own progress output.
 *
 * The worker spawns `research_orchestrator.py` or `gate2.py` and has to know how far the
 * run has got, what it has spent, and why it stopped. Two channels carry that, and they
 * are used for different things on purpose:
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

/** A line the worker should act on. Anything unrecognised is deliberately dropped. */
export type RunEvent =
  | { kind: "start"; rowsTotal: number; vendor: string | null }
  | {
      kind: "row";
      indicatorId: string;
      rowsDone: number;
      rowsTotal: number;
      /** Cumulative pass spend as the pipeline reported it on this line. */
      spentUsd: number;
      seconds: number;
      /** pass | hold | reject | gap for research; upheld | filled | withdrawn … for G2. */
      outcome: string;
    }
  | { kind: "exhausted"; message: string }
  | { kind: "incomplete"; message: string }
  | { kind: "failed"; message: string }
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
const ROW =
  /^\s*[A-Z]?\s*\[\s*(\d+)\s*\/\s*(\d+)\]\s+(\S+)\s+(\S+).*?\$\s*([\d.]+)\s+(\d+)s\s*$/;

/** `!! budget exhausted in pass 'research': $200.00 of $200.00` */
const EXHAUSTED = /^\s*!!\s*(budget exhausted.*)$/i;

/** `!! 3 rows not researched: [...]` — the input is deliberately not written. */
const INCOMPLETE = /^\s*!!\s*(\d+\s+rows not researched.*)$/i;

/** `wrote EGY_shadow_input.json — 59 rows, 23 gaps, 10 held` */
const FINISHED = /^\s*wrote\s+(\S+_input\.json.*)$/;

/** `reviewed 38 rows · adjusted 3 · filled 4 · upheld 29` */
const FINISHED_G2 = /^\s*(reviewed\s+\d+\s+rows.*)$/;

/** An unhandled exception reaching stderr. */
const TRACEBACK = /^\s*(Traceback \(most recent call last\):?|\w*(?:Error|Exception):.*)$/;

export function parseLine(line: string): RunEvent | null {
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
  if ((m = EXHAUSTED.exec(line))) return { kind: "exhausted", message: m[1].trim() };
  if ((m = INCOMPLETE.exec(line))) return { kind: "incomplete", message: m[1].trim() };
  if ((m = FINISHED.exec(line))) return { kind: "finished", message: m[1].trim() };
  if ((m = FINISHED_G2.exec(line))) return { kind: "finished", message: m[1].trim() };
  if ((m = TRACEBACK.exec(line))) return { kind: "failed", message: m[1].trim() };
  // The start line is checked last: it is the loosest pattern and would otherwise
  // swallow anything containing a middle dot and the word "rows".
  if ((m = START.exec(line))) {
    return { kind: "start", rowsTotal: Number(m[1]), vendor: m[2] || null };
  }
  return null;
}

/** Split a stdout chunk into lines and keep whatever the events say. */
export function parseChunk(chunk: string): RunEvent[] {
  const out: RunEvent[] = [];
  for (const line of chunk.split("\n")) {
    const e = parseLine(line);
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
): { status: "done" | "exhausted" | "failed"; reason: string } {
  if (seen.exhausted) {
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
