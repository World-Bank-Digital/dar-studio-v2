/**
 * The surface for pipeline runs: launch the complete DAR workflow and watch it finish.
 * Legacy administrative passes retain their older stop/resume controls for recovery.
 *
 * Every rule these functions apply lives in `runs.ts` and is tested without a database.
 * What is left here is ownership and the honest refusal — a run belongs to the user who
 * started it, and an operation that cannot be done says why in the words the surface
 * should show, rather than failing quietly or half-doing it.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { teamAdminEmails } from "@/lib/damm/teamkeys";
import { getSql } from "@/lib/db";
import { uid } from "@/lib/utils";

import {
  DEFAULT_CEILING_USD,
  basenameFor,
  canResume,
  canRunAutomatedChallenge,
  vendorForLaunch,
  isRunnable,
  producesEvidence,
  canTransition,
  runPassName,
  type Run,
  type RunPass,
  type RunStatus,
} from "./runs.ts";
import { loadRecords, rescore, writeAudit } from "./actions.ts";
import { PIPELINE_ROLE, planImport, summariseImport, type PassRow } from "./import-plan.ts";
import { readPassRows } from "./worker.ts";
import {
  documentsForExactWorkflowPackage,
  type WorkflowDocumentState,
} from "./worker-artifacts.ts";
import { DAR_WORKFLOW, canonicalWorkflowLaunchRequest } from "./workflow.ts";
import { listCompletedStageArtifacts } from "./completed-stage-artifacts.server.ts";
import { decodeWorkflowUploadBase64, extractWorkflowUploadText } from "./workflow-upload.ts";
import { model } from "./model.ts";
import {
  createRun,
  deletePendingWorkflowUpload,
  findActiveCountryRun,
  findActiveRun,
  noteEvent,
  getRun,
  latestCompletedResearch,
  latestWorkflowReviewTarget,
  listPublishedWorkflowArtifactDownloads,
  listEvents,
  listRuns,
  listWorkflowReviews,
  recordWorkflowReview,
  savePendingWorkflowUpload,
  setStatus,
  type RunEventRow,
} from "./run-store.ts";

const PASSES: readonly RunPass[] = [
  "workflow",
  "research",
  "g2",
  "scans",
  "foresight",
  "generation",
  "diagnostic",
];

import { publicRunView, publicRunEvent } from "./run-view.ts";
export type RunView = ReturnType<typeof publicRunView>;

async function ownerView(run: Run): Promise<RunView> {
  const artifacts =
    run.pass === "workflow" ? await listCompletedStageArtifacts(run.id, run.userId) : [];
  const packaged =
    run.pass === "workflow" && run.status === "done"
      ? await listPublishedWorkflowArtifactDownloads(run.id, run.userId)
      : [];
  return publicRunView(run, artifacts, packaged);
}

/** A run the caller owns, or a reason not to touch it. Never one they do not own. */
async function ownedRun(
  runId: string,
  userId: string,
): Promise<{ ok: true; run: Run } | { ok: false; error: string }> {
  const run = await getRun(runId, userId);
  // A run belonging to someone else and a run that does not exist get the same answer:
  // a distinct "not yours" would tell a stranger which run ids are real.
  if (!run || run.userId !== userId) return { ok: false as const, error: "Run not found." };
  return { ok: true as const, run };
}

interface StartRunInput {
  countryId: string;
  pass: RunPass;
  ceilingUsd?: number;
  vendor?: string | null;
}

function objectCode(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

async function isRunAdmin(userId: string): Promise<boolean> {
  const admins = teamAdminEmails();
  if (!admins.length) return false;
  const sql = await getSql();
  const rows = await sql<{ email: string }>`select email from "user" where id = ${userId}`;
  return Boolean(rows[0] && admins.includes(rows[0].email.toLowerCase()));
}

async function queueRun(userId: string, data: StartRunInput) {
  if (!PASSES.includes(data.pass)) {
    return { ok: false as const, error: `Unknown pass "${data.pass}".` };
  }
  if (!isRunnable(data.pass)) {
    return {
      ok: false as const,
      error: `The ${runPassName(data.pass)} has a share of the budget but no pipeline script yet, so it cannot be run.`,
    };
  }
  if (
    data.ceilingUsd !== undefined &&
    (!Number.isFinite(data.ceilingUsd) || data.ceilingUsd <= 0)
  ) {
    return { ok: false as const, error: "The preauthorized ceiling must be greater than zero." };
  }
  const sql = await getSql();
  const rows = await sql<{ name: string; iso3: string }>`
      select name, iso3 from countries
      where id = ${data.countryId} and user_id = ${userId} and deleted_at is null`;
  if (!rows.length) return { ok: false as const, error: "Country not found." };
  const { name, iso3 } = rows[0];

  // A canonical workflow owns the whole country ceiling. It cannot run beside a
  // legacy pass, and no legacy administrative pass can be started beside it.
  const active =
    data.pass === "workflow"
      ? await findActiveCountryRun(data.countryId, userId)
      : ((await findActiveRun(data.countryId, data.pass, userId)) ??
        (await findActiveRun(data.countryId, "workflow", userId)));
  if (active) {
    const resumable = active.status === "paused" || active.status === "exhausted";
    return {
      ok: false as const,
      error:
        active.pass === "workflow"
          ? `The canonical workflow for ${name} is already ${active.status}. A second workflow cannot start against the same country ceiling; cancel this run only if it must be abandoned.`
          : resumable
            ? `The ${runPassName(active.pass)} for ${name} is ${active.status}. Continue it or cancel it ` +
              `first — starting another would research the rows it has already paid for.`
            : `The ${runPassName(active.pass)} for ${name} is already ${active.status}.`,
      runId: active.id,
    };
  }

  const prior =
    data.pass === "research" || data.pass === "workflow"
      ? null
      : await latestCompletedResearch(data.countryId, userId);
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
      error: `The ${runPassName(data.pass)} reads the output of a completed research pass, and ${name} has none yet.`,
    };
  }

  // The automated challenger must not be from the vendor family that did the research.
  // This is machine QC only: it neither performs nor satisfies G1/G2 human review.
  // Refuse it before queuing so an operator does not receive a false clean machine check.
  if (data.pass === "g2") {
    const challenge = canRunAutomatedChallenge(prior?.vendor ?? null, data.vendor ?? null);
    if (!challenge.ok) {
      return {
        ok: false as const,
        error: `Cannot start the automated vendor challenge: ${challenge.reason}`,
      };
    }
  }

  // Resolved rather than left null, so the run records the vendor it actually used and
  // the app never displays a default the pipeline might resolve differently.
  const vendor = vendorForLaunch(data.pass, data.vendor);

  let run: Run;
  try {
    // The frozen text and queue row are one insert. The claiming worker may live on a
    // different host, and can materialize this exact payload without seeing later edits.
    run = await createRun({
      id,
      userId,
      countryId: data.countryId,
      countryName: name,
      iso3,
      pass: data.pass,
      ceilingUsd: data.ceilingUsd ?? DEFAULT_CEILING_USD,
      vendor,
      outBasename,
    });
  } catch (error) {
    const conflict =
      objectCode(error) === "ACTIVE_RUN_CONFLICT" ||
      (data.pass === "workflow" &&
        (objectCode(error) === "23505" ||
          String(error).includes("runs_one_active_workflow_per_country")));
    if (conflict) {
      const activeWorkflow =
        data.pass === "workflow"
          ? await findActiveCountryRun(data.countryId, userId)
          : ((await findActiveRun(data.countryId, data.pass, userId)) ??
            (await findActiveRun(data.countryId, "workflow", userId)));
      return {
        ok: false as const,
        error: `The ${runPassName(activeWorkflow?.pass ?? data.pass)} for ${name} is already active.`,
        ...(activeWorkflow ? { runId: activeWorkflow.id } : {}),
      };
    }
    if (data.pass === "workflow" && String(error).includes("provenance-complete")) {
      return {
        ok: false as const,
        error:
          "Every pre-launch document must have complete original-file and extraction provenance. Remove and re-upload any legacy document.",
      };
    }
    throw error;
  }
  return { ok: true as const, run: await ownerView(run) };
}

/**
 * The product action: one click queues the complete eight-stage workflow. Country is the
 * only required input; uploads already present in the workspace are snapshotted, and an
 * empty snapshot is valid because every optional-input stage has a research fallback.
 */
export const startDarWorkflow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  // Only the country and a validated limit at or below the default ceiling survive.
  // Raw ceiling/vendor overrides cannot reach the queue.
  .validator(canonicalWorkflowLaunchRequest)
  .handler(({ context, data }) => queueRun(context.userId, { ...data, pass: "workflow" }));

/**
 * Legacy/admin pass launcher retained for recovery while the product moves to the
 * canonical action above. New product surfaces must call `startDarWorkflow`.
 */
export const startRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: StartRunInput) => input)
  .handler(async ({ context, data }) => {
    if (!(await isRunAdmin(context.userId))) {
      return { ok: false as const, error: "Legacy passes are restricted to administrators." };
    }
    return queueRun(context.userId, data);
  });

export interface WorkflowUploadView {
  id: string;
  kind: string;
  filename: string;
  mime: string;
  characters: number;
  sourceBytes: number;
  sourceSha256: string;
  uploadedAt: string;
  extractionStatus: "extracted" | "legacy";
}

const WORKFLOW_UPLOAD_KINDS = new Set(DAR_WORKFLOW.optional_launch_inputs.map((input) => input.id));

function inferredMediaType(filename: string, supplied: string): string {
  if (supplied.trim()) return supplied.trim().slice(0, 200);
  const extension = filename.split(".").pop()?.toLowerCase();
  return (
    {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      txt: "text/plain",
      md: "text/markdown",
      html: "text/html",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

async function workflowCountryOwned(countryId: string, userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from countries
    where id = ${countryId} and user_id = ${userId} and deleted_at is null`;
  return rows.length === 1;
}

/** Optional source documents may be added only before the immutable launch snapshot. */
export const uploadWorkflowDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      countryId: string;
      kind: string;
      filename: string;
      mime: string;
      sourceBase64: string;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    if (!(await workflowCountryOwned(data.countryId, context.userId))) {
      return { ok: false as const, error: "Country not found." };
    }
    if (!WORKFLOW_UPLOAD_KINDS.has(data.kind)) {
      return { ok: false as const, error: "This is not a canonical workflow document category." };
    }
    if (!data.filename.trim() || data.filename.length > 240) {
      return { ok: false as const, error: "The document needs a valid filename." };
    }
    try {
      const source = decodeWorkflowUploadBase64(data.sourceBase64);
      const extracted = await extractWorkflowUploadText(data.filename, source);
      const { createHash } = await import("node:crypto");
      const id = uid();
      const sourceSha256 = createHash("sha256").update(source).digest("hex");
      const mime = inferredMediaType(data.filename, data.mime);
      const characters = Array.from(extracted.text).length;
      const stored = await savePendingWorkflowUpload({
        id,
        userId: context.userId,
        countryId: data.countryId,
        filename: data.filename.trim(),
        kind: data.kind,
        mime,
        chars: characters,
        content: extracted.text,
        source,
        sourceSha256,
      });
      if (!stored.ok) {
        const errors = {
          country: "Country not found.",
          active:
            "This workflow has already frozen its inputs. A late document cannot alter an active run; it belongs in a new workflow version after this run settles.",
          documents: "A workflow may freeze at most 50 source documents.",
          characters: "The extracted source text exceeds the 10,000,000-character combined limit.",
          source_bytes: "The source documents exceed the 10 MB combined limit.",
          invalid: "The extracted document failed its provenance or size checks.",
        } as const;
        return { ok: false as const, error: errors[stored.reason] };
      }
      return {
        ok: true as const,
        upload: {
          id,
          kind: data.kind,
          filename: data.filename.trim(),
          mime,
          characters,
          sourceBytes: source.byteLength,
          sourceSha256,
          uploadedAt: new Date(stored.uploadedAt).toISOString(),
          extractionStatus: "extracted" as const,
        },
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "The document could not be extracted.",
      };
    }
  });

export const listWorkflowUploads = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string }) => input)
  .handler(async ({ context, data }) => {
    if (!(await workflowCountryOwned(data.countryId, context.userId))) return { uploads: [] };
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      kind: string;
      filename: string;
      mime: string | null;
      chars: number;
      source_byte_size: number | null;
      source_sha256: string | null;
      uploaded_at: Date;
      extraction_status: string | null;
    }>`
      select id, kind, filename, mime, chars, source_byte_size, source_sha256,
             uploaded_at, extraction_status
      from uploads
      where country_id = ${data.countryId} and user_id = ${context.userId}
      order by uploaded_at, id`;
    return {
      uploads: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        filename: row.filename,
        mime: row.mime ?? "application/octet-stream",
        characters: row.chars,
        sourceBytes: Number(row.source_byte_size ?? 0),
        sourceSha256: row.source_sha256 ?? "",
        uploadedAt: new Date(row.uploaded_at).toISOString(),
        extractionStatus:
          row.extraction_status === "extracted" && WORKFLOW_UPLOAD_KINDS.has(row.kind)
            ? ("extracted" as const)
            : ("legacy" as const),
      })),
    };
  });

export const deleteWorkflowUpload = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; uploadId: string }) => input)
  .handler(async ({ context, data }) => {
    const result = await deletePendingWorkflowUpload(context.userId, data.countryId, data.uploadId);
    if (!result.ok && result.reason === "active") {
      return { ok: false as const, error: "Active workflow inputs are immutable." };
    }
    return result.ok ? result : { ok: false as const, error: "Document not found." };
  });

export const listCountryRuns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId?: string }) => input)
  .handler(async ({ context, data }) => {
    const runs = await listRuns(context.userId);
    const mine = data.countryId ? runs.filter((r) => r.countryId === data.countryId) : runs;
    return { runs: await Promise.all(mine.map(ownerView)) };
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
    const events: RunEventRow[] = await listEvents(
      data.runId,
      context.userId,
      data.sinceEventId ?? 0,
    );
    return {
      ok: true as const,
      run: await ownerView(owned.run),
      events: events.map(publicRunEvent),
    };
  });

/** Pause or cancel. Both are refusals to continue; only one of them is reversible. */
export const stopRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { runId: string; to: "paused" | "cancelled" }) => input)
  .handler(async ({ context, data }) => {
    const owned = await ownedRun(data.runId, context.userId);
    if (!owned.ok) return owned;
    if (owned.run.pass !== "workflow" && !(await isRunAdmin(context.userId))) {
      return {
        ok: false as const,
        error: "Legacy pass controls are restricted to administrators.",
      };
    }
    if (owned.run.pass === "workflow" && data.to === "paused") {
      return {
        ok: false as const,
        error:
          "A canonical workflow cannot wait for human input after launch. It may be cancelled, but its retries and stage transitions are automatic.",
      };
    }
    const move = canTransition(owned.run.status, data.to);
    if (!move.ok) return { ok: false as const, error: `Cannot stop this run: ${move.reason}.` };
    // The worker notices at its next heartbeat; the status is what it reads. Nothing is
    // killed from here, because a process killed mid-row loses the row it was paying for.
    const changed = await setStatus(data.runId, context.userId, data.to, {
      reason: data.to === "paused" ? "Paused by the operator." : "Cancelled by the operator.",
      expectedStatus: owned.run.status,
    });
    if (!changed) return { ok: false as const, error: "The run changed before cancellation." };
    const after = await getRun(data.runId, context.userId);
    return { ok: true as const, run: after ? await ownerView(after) : null };
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
    if (!(await isRunAdmin(context.userId))) {
      return {
        ok: false as const,
        error: "Legacy pass controls are restricted to administrators.",
      };
    }
    const may = canResume(owned.run, data.ceilingUsd);
    if (!may.ok) return { ok: false as const, error: `Cannot resume: ${may.reason}` };
    const changed = await setStatus(data.runId, context.userId, "queued" as RunStatus, {
      ceilingUsd: data.ceilingUsd,
      reason: "Queued to continue from where it stopped.",
      expectedStatus: owned.run.status,
    });
    if (!changed) return { ok: false as const, error: "The run changed before it was re-queued." };
    const after = await getRun(data.runId, context.userId);
    return { ok: true as const, run: after ? await ownerView(after) : null };
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
    if (!(await isRunAdmin(context.userId))) {
      return { ok: false as const, error: "Legacy pass imports are restricted to administrators." };
    }
    const run = owned.run;

    if (!run.countryId) {
      return { ok: false as const, error: "This run is not attached to a country." };
    }
    if (!producesEvidence(run.pass)) {
      return {
        ok: false as const,
        error: `The ${runPassName(run.pass)} does not produce indicator rows, so there is nothing to import into the evidence base. Its output feeds the roadmap documents.`,
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
            : "This automated vendor challenge stopped before it wrote its output. Partial machine QC records findings against rows rather than rows themselves, so there is nothing to import until it finishes.",
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
      `${runPassName(run.pass)} ${run.outBasename}${output.complete ? "" : " (partial — read from its checkpoint)"}: ${summary}`,
    );

    await noteEvent(run.id, context.userId, "note", `Imported into the workspace: ${summary}`);
    return { ok: true as const, summary, held: plan.held, complete: output.complete };
  });

export type DocumentState = WorkflowDocumentState;

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
    const [allRuns, target] = await Promise.all([
      listRuns(context.userId, 200),
      latestWorkflowReviewTarget(data.countryId, context.userId),
    ]);
    const runs = allRuns.filter((run) => run.countryId === data.countryId);
    const latestAttempt = runs.find((run) => run.pass === "workflow") ?? null;
    const selected = target
      ? {
          runId: target.runId,
          artifactSetId: target.artifactSetId,
          bundleSha256: target.bundleSha256,
          completedAt: target.completedAt.toISOString(),
        }
      : null;
    const published = selected
      ? await listPublishedWorkflowArtifactDownloads(selected.runId, context.userId)
      : [];
    const verifiedKeys = new Set(published.map((item) => item.key));
    const documentSet = documentsForExactWorkflowPackage(
      selected,
      verifiedKeys,
      latestAttempt ? { runId: latestAttempt.id, status: latestAttempt.status } : null,
    );

    return {
      ...documentSet,
      downloads: published,
      documents: documentSet.documents.map((document) => ({
        ...document,
        byteSize: published.find((item) => item.key === document.artifactKey)?.byteSize,
      })),
      status:
        "Pre-review Draft. Human controls apply once, after Stage 8, to this exact " +
        "immutable package — never to a mixture of files from different runs and never " +
        "on one document at a time.",
    };
  });

/** Review is unavailable until Stage 8's verified bundle is durably published. */
export const getDarReviewState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string }) => input)
  .handler(async ({ context, data }) => {
    const target = await latestWorkflowReviewTarget(data.countryId, context.userId);
    const reviews = await listWorkflowReviews(data.countryId, context.userId);
    return {
      available: target !== null,
      target: target
        ? {
            ...target,
            completedAt: target.completedAt.toISOString(),
          }
        : null,
      reviews: reviews.map((review) => ({
        ...review,
        reviewedAt: review.reviewedAt.toISOString(),
        completedAt: review.completedAt.toISOString(),
      })),
    };
  });

export const recordDarReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      countryId: string;
      runId: string;
      artifactSetId: string;
      bundleSha256: string;
      outcome: "reviewed" | "revisions_required";
      notes: string;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    if (!(["reviewed", "revisions_required"] as const).includes(data.outcome)) {
      return { ok: false as const, error: "Choose a valid review outcome." };
    }
    const notes = data.notes.trim();
    if (notes.length > 5000) {
      return { ok: false as const, error: "Review notes may contain at most 5,000 characters." };
    }
    const review = await recordWorkflowReview({
      id: uid(),
      runId: data.runId,
      countryId: data.countryId,
      reviewerId: context.userId,
      artifactSetId: data.artifactSetId,
      bundleSha256: data.bundleSha256,
      outcome: data.outcome,
      notes,
    });
    return review
      ? { ok: true as const }
      : {
          ok: false as const,
          error:
            "Review is available only for the exact published Draft DAR package produced after Stage 8.",
        };
  });
