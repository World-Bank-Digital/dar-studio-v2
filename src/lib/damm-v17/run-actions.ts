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
  producesEvidence,
  canTransition,
  progressOf,
  stoppedSummary,
  type Run,
  type RunPass,
  type RunStatus,
} from "./runs.ts";
import { loadRecords, rescore, writeAudit } from "./actions.ts";
import { PIPELINE_ROLE, planImport, summariseImport, type PassRow } from "./import-plan.ts";
import { readPassRows } from "./worker.ts";
import { DOCUMENT_SLOTS } from "./worker-artifacts.ts";
import { model } from "./model.ts";
import {
  createRun,
  findActiveRun,
  noteEvent,
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


/**
 * Write a finished pass's findings into the country's evidence.
 *
 * Explicit, never automatic. An import replaces the evidence base, and a background
 * worker doing that while an assessor is reading the screen would change what they are
 * looking at with nobody's name on the decision. The operator asks for it, and the audit
 * trail records who did.
 *
 * A person's entry is never overwritten — see `planImport`. Rows the pass never reached
 * are left untouched rather than written as gaps.
 */
export const importPassOutput = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { runId: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const owned = await ownedRun(data.runId, context.userId);
    if (!owned.ok) return owned;
    const run = owned.run;

    if (!run.countryId) {
      return { ok: false as const, error: "This run is not attached to a country." };
    }
    if (!producesEvidence(run.pass)) {
      return {
        ok: false as const,
        error: `The ${run.pass} pass does not produce indicator rows, so there is nothing to import into the evidence base. Its output feeds the roadmap documents.`,
      };
    }
    if (run.status !== "done" && run.status !== "exhausted") {
      return {
        ok: false as const,
        error: `A ${run.status} run has nothing settled to import. Let it finish, or continue it.`,
      };
    }

    const output = await readPassRows(run);
    if (!output) {
      return {
        ok: false as const,
        error:
          run.pass === "research"
            ? "This pass left no rows on disk. It may have stopped before its first checkpoint, or the pipeline directory is not the one it ran in."
            : "This review stopped before it wrote its output. A partial review records findings against rows rather than rows themselves, so there is nothing to import until it finishes.",
      };
    }

    const existing = await loadRecords(run.countryId);
    const plan = planImport(existing, output.rows as unknown as Record<string, PassRow>, {
      role: PIPELINE_ROLE,
      name: `${run.outBasename}${run.vendor ? ` · ${run.vendor}` : ""}`,
    });

    const sql = await getSql();
    const at = new Date().toISOString();
    for (const r of plan.records) {
      await sql`
        update evidence set
          value_raw = ${r.valueRaw},
          observation_year = ${r.observationYear},
          source_name = ${r.sourceName},
          source_url = ${r.sourceUrl},
          source_tier = ${r.sourceTier},
          assessor_level = ${r.assessorLevel},
          ratification_hold = ${r.ratificationHold},
          assessor_role = ${r.assessorRole},
          assessor_name = ${r.assessorName},
          assessed_at = ${at},
          notes = ${r.notes}
        where country_id = ${run.countryId} and indicator_id = ${r.indicatorId}`;
    }

    await rescore(run.countryId);
    const summary = summariseImport(plan, Object.keys(output.rows).length, model.indicators.length);
    await writeAudit(
      context.userId,
      run.countryId,
      data.role,
      data.actorName,
      "import_pass",
      `${run.pass} pass ${run.outBasename}${output.complete ? "" : " (partial — read from its checkpoint)"}: ${summary}`,
    );

    await noteEvent(run.id, "note", `Imported into the workspace: ${summary}`);
    return { ok: true as const, summary, held: plan.held, complete: output.complete };
  });


export interface DocumentState {
  key: string;
  title: string;
  what: string;
  pass: RunPass;
  /** The run that produced it, when one has. */
  runId: string | null;
  producedAt: string | null;
  href: string | null;
  /** Why it is not there yet, in the words the surface should use. */
  missingBecause: string | null;
}

/**
 * The document set for a country.
 *
 * Named whole, including the parts that do not exist. The alternative — listing only what
 * has been produced — makes a set of one look complete, and the review this feeds is a
 * review of the set.
 */
export const countryDocuments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string }) => input)
  .handler(async ({ context, data }) => {
    const runs = (await listRuns(context.userId, 200)).filter(
      (r) => r.countryId === data.countryId,
    );

    const documents: DocumentState[] = DOCUMENT_SLOTS.map((slot) => {
      const produced = runs.find((r) => r.pass === slot.pass && r.status === "done");
      if (produced) {
        return {
          ...slot,
          runId: produced.id,
          producedAt: (produced.finishedAt ?? produced.startedAt)?.toISOString() ?? null,
          href: `/api/runs/${produced.id}/artifact?key=${slot.artifactKey}`,
          missingBecause: null,
        };
      }
      const attempted = runs.find((r) => r.pass === slot.pass);
      return {
        ...slot,
        runId: attempted?.id ?? null,
        producedAt: null,
        href: null,
        missingBecause: attempted
          ? `The ${slot.pass} pass is ${attempted.status}.`
          : `The ${slot.pass} pass has not been run.`,
      };
    });

    return {
      documents,
      complete: documents.every((d) => d.href !== null),
      status:
        "Pre-review draft. Review happens once, at the end, on the completed set — not "
        + "on one document at a time.",
    };
  });
