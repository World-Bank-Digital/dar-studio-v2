/**
 * The surface for pipeline runs: start one, watch it, stop it, give it more budget.
 *
 * Every rule these functions apply lives in `runs.ts` and is tested without a database.
 * What is left here is ownership and the honest refusal — a run belongs to the user who
 * started it, and an operation that cannot be done says why in the words the surface
 * should show, rather than failing quietly or half-doing it.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { uid } from "@/lib/utils";

import {
  DEFAULT_CEILING_USD,
  basenameFor,
  canResume,
  canReview,
  defaultVendorFor,
  isRunnable,
  canTransition,
  progressOf,
  stoppedSummary,
  type Run,
  type RunPass,
  type RunStatus,
} from "./runs.ts";
import {
  createRun,
  findActiveRun,
  getRun,
  latestCompletedResearch,
  listEvents,
  listRuns,
  setStatus,
  type RunEventRow,
} from "./run-store.ts";

const PASSES: readonly RunPass[] = ["research", "g2", "scans", "foresight", "generation"];

/** What a surface needs to draw a run without deriving anything itself. */
export interface RunView extends Run {
  progress: ReturnType<typeof progressOf>;
  summary: string;
}

function view(run: Run): RunView {
  return { ...run, progress: progressOf(run), summary: stoppedSummary(run) };
}

/** A run the caller owns, or a reason not to touch it. Never one they do not own. */
async function ownedRun(
  runId: string,
  userId: string,
): Promise<{ ok: true; run: Run } | { ok: false; error: string }> {
  const run = await getRun(runId);
  // A run belonging to someone else and a run that does not exist get the same answer:
  // a distinct "not yours" would tell a stranger which run ids are real.
  if (!run || run.userId !== userId) return { ok: false as const, error: "Run not found." };
  return { ok: true as const, run };
}

export const startRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      countryId: string;
      pass: RunPass;
      ceilingUsd?: number;
      vendor?: string | null;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    if (!PASSES.includes(data.pass)) {
      return { ok: false as const, error: `Unknown pass "${data.pass}".` };
    }
    if (!isRunnable(data.pass)) {
      return {
        ok: false as const,
        error: `The ${data.pass} pass has a share of the budget but no pipeline script yet, so it cannot be run.`,
      };
    }
    const sql = await getSql();
    const rows = await sql<{ name: string; iso3: string }>`
      select name, iso3 from countries
      where id = ${data.countryId} and user_id = ${context.userId} and deleted_at is null`;
    if (!rows.length) return { ok: false as const, error: "Country not found." };
    const { name, iso3 } = rows[0];

    // One active run per country and pass. Two pipelines against one ceiling would each
    // believe they had the whole allocation and between them spend twice it.
    const active = await findActiveRun(data.countryId, data.pass);
    if (active) {
      const resumable = active.status === "paused" || active.status === "exhausted";
      return {
        ok: false as const,
        error: resumable
          ? `A ${data.pass} run for ${name} is ${active.status}. Continue it or cancel it ` +
            `first — starting another would research the rows it has already paid for.`
          : `A ${data.pass} run for ${name} is already ${active.status}.`,
        runId: active.id,
      };
    }

    const prior = data.pass === "research" ? null : await latestCompletedResearch(data.countryId);
    // The run's own id is the uniqueness token, so the checkpoint files a run writes
    // belong to that run and to no other.
    const id = uid();
    const outBasename = basenameFor(
      data.pass,
      iso3,
      new Date(),
      prior?.outBasename ?? null,
      id.slice(0, 6),
    );
    if (!outBasename) {
      return {
        ok: false as const,
        error: `A ${data.pass} pass reads the output of a completed research pass, and ${name} has none yet.`,
      };
    }

    // The reviewer must not be the vendor that did the research. Checked here because
    // this is where the vendor is chosen; refused before anything is queued, so the
    // operator sees why rather than a review that upholds everything.
    if (data.pass === "g2") {
      const peer = canReview(prior?.vendor ?? null, data.vendor ?? null);
      if (!peer.ok) return { ok: false as const, error: `Cannot start this review: ${peer.reason}` };
    }

    // Resolved rather than left null, so the run records the vendor it actually used and
    // the app never displays a default the pipeline might resolve differently.
    const vendor = data.vendor ?? defaultVendorFor(data.pass);

    const run = await createRun({
      id,
      userId: context.userId,
      countryId: data.countryId,
      countryName: name,
      iso3,
      pass: data.pass,
      ceilingUsd: data.ceilingUsd ?? DEFAULT_CEILING_USD,
      vendor,
      outBasename,
    });
    return { ok: true as const, run: view(run) };
  });

export const listCountryRuns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId?: string }) => input)
  .handler(async ({ context, data }) => {
    const runs = await listRuns(context.userId);
    const mine = data.countryId ? runs.filter((r) => r.countryId === data.countryId) : runs;
    return { runs: mine.map(view) };
  });

/**
 * One run and whatever has happened since the caller last asked. `sinceEventId` is what
 * makes polling cheap: the surface holds the last id it drew and asks only for what
 * followed, so a long run does not re-send its whole history every few seconds.
 */
export const getRunDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { runId: string; sinceEventId?: number }) => input)
  .handler(async ({ context, data }) => {
    const owned = await ownedRun(data.runId, context.userId);
    if (!owned.ok) return owned;
    const events: RunEventRow[] = await listEvents(data.runId, data.sinceEventId ?? 0);
    return { ok: true as const, run: view(owned.run), events };
  });

/** Pause or cancel. Both are refusals to continue; only one of them is reversible. */
export const stopRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { runId: string; to: "paused" | "cancelled" }) => input)
  .handler(async ({ context, data }) => {
    const owned = await ownedRun(data.runId, context.userId);
    if (!owned.ok) return owned;
    const move = canTransition(owned.run.status, data.to);
    if (!move.ok) return { ok: false as const, error: `Cannot stop this run: ${move.reason}.` };
    // The worker notices at its next heartbeat; the status is what it reads. Nothing is
    // killed from here, because a process killed mid-row loses the row it was paying for.
    await setStatus(data.runId, data.to, {
      reason: data.to === "paused" ? "Paused by the operator." : "Cancelled by the operator.",
    });
    const after = await getRun(data.runId);
    return { ok: true as const, run: after ? view(after) : null };
  });

/**
 * Continue a stopped run, optionally with a higher ceiling.
 *
 * Re-queueing an exhausted run at the ceiling that exhausted it stops it again at once,
 * which reads to an operator as the button not working. `canResume` refuses that, and
 * says how much has been spent against what.
 */
export const resumeRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { runId: string; ceilingUsd?: number }) => input)
  .handler(async ({ context, data }) => {
    const owned = await ownedRun(data.runId, context.userId);
    if (!owned.ok) return owned;
    const may = canResume(owned.run, data.ceilingUsd);
    if (!may.ok) return { ok: false as const, error: `Cannot resume: ${may.reason}` };
    await setStatus(data.runId, "queued" as RunStatus, {
      ceilingUsd: data.ceilingUsd,
      reason: "Queued to continue from where it stopped.",
    });
    const after = await getRun(data.runId);
    return { ok: true as const, run: after ? view(after) : null };
  });
