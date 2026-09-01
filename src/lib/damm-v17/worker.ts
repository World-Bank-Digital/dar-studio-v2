/**
 * The durable worker.
 *
 * It claims a run, spawns the pipeline, follows it, and records where it got to. Legacy
 * passes use `--resume` and checkpoint every row. The canonical coordinator owns its own
 * manifest checkpoint and bounded retries, so it receives one launch and no operator
 * resume flag.
 *
 * Two rules this file exists to keep.
 *
 * **The pipeline record is the source of record for money.** Stdout is followed for
 * liveness, while final spend comes from the pass's `<prefix>_spend.json` ledger or the
 * coordinator's `workflow-manifest.json`. If console output changes, accounting stays
 * anchored to the pipeline record.
 *
 * **A stopped run says why.** Exhaustion, an unresearched remainder and a crash are three
 * different endings with three different remedies, and each is recorded as itself rather
 * than as a generic failure.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  readSync,
  statSync,
} from "node:fs";
import { mkdir, open as openFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_WORKFLOW_ARTIFACT_BYTES,
  MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES,
  MAX_WORKFLOW_BUNDLE_BYTES,
} from "./artifact-limits.ts";
import {
  DAMM_MODEL_EXPORT,
  DAMM_MODEL_FILENAME,
  DAMM_MODEL_IDENTITY,
  DAMM_MODEL_SCHEMA_FILENAME,
  DAMM_MODEL_SOURCE_SHA256,
} from "./model.ts";
import { canonicalIndicatorCensus, runMethodologyManifest } from "./methodology.ts";
import { parseChunk, statusOnExit, type RunEvent } from "./run-output.ts";
import type { ClaimedRun, Run, RunPass, RunStatus } from "./runs.ts";
import type { WorkflowArtifactWrite } from "./run-store.ts";
import {
  artifactsFor as artifactLinksFor,
  type ArtifactLink,
  type WorkflowPackageSelector,
} from "./worker-artifacts.ts";
import {
  CANONICAL_STAGE_IDS,
  DAR_WORKFLOW,
  DAR_WORKFLOW_SHA256,
  frozenWorkflowUploadViolations,
  type DarWorkflowStageId,
  type FrozenWorkflowUpload,
} from "./workflow.ts";

/**
 * Where the pipeline lives. It is a separate repository, so the path is configuration
 * rather than a constant — hard-coding one developer's directory is how a worker becomes
 * undeployable.
 */
export function pipelineDir(): string {
  return process.env.DAMM_PIPELINE_DIR ?? path.join(process.env.HOME ?? "", "DAR/Claude/DAMM");
}

/** The pipeline needs its own virtualenv: the vendor SDKs are not in system Python. */
export function pipelinePython(): string {
  return process.env.DAMM_PIPELINE_PYTHON ?? path.join(pipelineDir(), ".venv/bin/python");
}

/** Read on each call rather than captured at import, so configuration is configuration. */
function scriptDir(): string {
  return path.join(pipelineDir(), "gauntlet/loop-1/research_pipeline");
}

const HEARTBEAT_MS = 30_000;

/** What a completed row contributes to the run record. */
export interface RowProgress {
  indicatorId: string;
  rowsDone: number;
  rowsTotal: number;
  /** Null when a workflow handler cannot report spend; persistence preserves the last value. */
  spentUsd: number | null;
  outcome: string;
}

export interface SpawnedProcess {
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  wait(): Promise<number | null>;
  kill(): void;
}

/**
 * The writes a run makes as it goes.
 *
 * Narrowed to an interface, and imported lazily in `dbStore()`, because `run-store.ts`
 * reaches `db.ts`, which opens PGLite the moment it is imported in Node. Following a run
 * is the part of this file most worth testing — a misrecorded ending is what turns a
 * stopped assessment into an apparently finished one — and it should not need a database
 * to check how a line of output was handled.
 */
export interface RunStore {
  claimNextRun(workerId: string): Promise<ClaimedRun | null>;
  releaseClaim(runId: string, workerId: string, claimToken: string): Promise<boolean>;
  setRowsTotal(
    runId: string,
    workerId: string,
    claimToken: string,
    rowsTotal: number,
    vendor: string | null,
  ): Promise<boolean>;
  recordRow(runId: string, workerId: string, claimToken: string, e: RowProgress): Promise<boolean>;
  noteEvent(
    runId: string,
    workerId: string,
    claimToken: string,
    kind: string,
    message: string,
  ): Promise<boolean>;
  heartbeat(runId: string, workerId: string, claimToken: string): Promise<boolean>;
  finishRun(
    runId: string,
    workerId: string,
    claimToken: string,
    status: RunStatus,
    reason: string,
    spentUsd?: number,
  ): Promise<boolean>;
}

/** The real store, loaded on first use rather than at import. */
export function dbStore(): RunStore {
  const store = () => import("./run-store.ts");
  return {
    claimNextRun: (w) => store().then((m) => m.claimNextRun(w)),
    releaseClaim: (id, w, token) => store().then((m) => m.releaseClaim(id, w, token)),
    setRowsTotal: (id, w, token, n, v) => store().then((m) => m.setRowsTotal(id, w, token, n, v)),
    recordRow: (id, w, token, e) => store().then((m) => m.recordRow(id, w, token, e)),
    noteEvent: (id, w, token, k, msg) =>
      store().then((m) => m.noteWorkerEvent(id, w, token, k, msg)),
    heartbeat: (id, w, token) => store().then((m) => m.heartbeat(id, w, token)),
    finishRun: (id, w, token, s, r, spent) =>
      store().then((m) => m.finishRun(id, w, token, s, r, spent)),
  };
}

/** Injected so the loop can be exercised without launching Python or a database. */
export interface WorkerDeps {
  spawnPipeline(run: ClaimedRun): SpawnedProcess;
  readLedger(run: ClaimedRun): Promise<number | null>;
  store: RunStore;
  prepareWorkflowInputs?(run: ClaimedRun): Promise<void>;
  /** Root-manifest proof required before a workflow may settle as done. */
  verifyWorkflow?(run: Run): { ok: true } | { ok: false; reason: string };
  /** Archive the manifest-verified completed Stage 1-7 prefix under the current claim. */
  reconcileCompletedStageArtifacts?(run: ClaimedRun, workerId: string): Promise<void>;
  /** Copy the already hash-verified download set into storage shared with web hosts. */
  publishWorkflowArtifacts?(run: ClaimedRun, workerId: string): Promise<void>;
  /** Overridden in tests; a run that takes minutes should not be watched by the second. */
  heartbeatMs?: number;
}

/** The coordinator owns one isolated directory for the complete eight-stage run. */
export function workflowRunDir(run: Pick<Run, "outBasename">): string {
  return path.join(pipelineDir(), "gauntlet/loop-1", `${run.outBasename}_workflow`);
}

/** Simulation identities are permanently ineligible for workflow acceptance or publication. */
export function isSimulationIdentity(run: Pick<Run, "id" | "vendor">): boolean {
  return run.id.startsWith("sim-") || Boolean(run.vendor?.startsWith("fixture/"));
}

/** A workflow workspace must be one real, direct child of the pinned executable tree. */
function safeWorkflowRunDir(
  run: Pick<Run, "outBasename">,
  requireExisting: boolean,
): string | null {
  const loopRoot = path.resolve(pipelineDir(), "gauntlet/loop-1");
  const candidate = path.resolve(workflowRunDir(run));
  if (path.dirname(candidate) !== loopRoot) return null;
  let canonicalLoopRoot: string;
  try {
    if (!lstatSync(loopRoot).isDirectory()) return null;
    canonicalLoopRoot = realpathSync(loopRoot);
  } catch {
    return null;
  }
  try {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    const canonicalCandidate = realpathSync(candidate);
    return canonicalCandidate.startsWith(`${canonicalLoopRoot}${path.sep}`) ? candidate : null;
  } catch (error) {
    if (
      !requireExisting &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return candidate;
    }
    return null;
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

async function ensureContainedDirectory(root: string, relative: string): Promise<string> {
  let current = "";
  for (const segment of relative.split("/").filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    const candidate = path.join(root, ...current.split("/"));
    try {
      await mkdir(candidate, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const verified = containedPath(root, current);
    if (verified !== candidate || !lstatSync(candidate).isDirectory()) {
      throw new Error(`The workflow directory ${current} is not a real contained directory.`);
    }
  }
  return path.join(root, ...relative.split("/").filter(Boolean));
}

async function writeImmutableContainedFile(
  root: string,
  relative: string,
  value: string | Uint8Array,
): Promise<string> {
  const parentRelative = path.posix.dirname(relative);
  const parent = containedPath(root, parentRelative);
  const filename = path.join(root, ...relative.split("/"));
  if (parent !== path.dirname(filename) || !lstatSync(parent).isDirectory()) {
    throw new Error(`The workflow file ${relative} has no real contained parent directory.`);
  }

  const expected = Buffer.from(value);
  let handle;
  try {
    handle = await openFile(
      filename,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(expected);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    const existingPath = containedPath(root, relative);
    if (!existingPath || !lstatSync(existingPath).isFile()) throw error;
    const existing = await readFile(existingPath);
    if (!existing.equals(expected)) throw error;
  } finally {
    await handle?.close();
  }

  const verified = containedPath(root, relative);
  if (verified !== filename || !lstatSync(filename).isFile()) {
    throw new Error(`The workflow file ${relative} is not a real contained file.`);
  }
  return filename;
}

/**
 * The launch envelope is deliberately separate from the coordinator's frozen copy at
 * `inputs/uploads-manifest.json`. It and every extracted upload live under `--out`, so
 * the coordinator can containment-check and hash them before stage 1 starts.
 */
export function workflowUploadManifestPath(run: Pick<Run, "outBasename">): string {
  return path.join(workflowRunDir(run), "launch-uploads-manifest.json");
}

export type WorkflowLaunchUpload = FrozenWorkflowUpload;

const WORKFLOW_UPLOAD_KINDS = [
  "country_context_documents",
  "ai_documents",
  "international_strategy_documents",
  "foresight_documents",
  "investment_documents",
] as const;
type WorkflowUploadKind = (typeof WORKFLOW_UPLOAD_KINDS)[number];

function workflowUploadKind(kind: string): WorkflowUploadKind {
  if ((WORKFLOW_UPLOAD_KINDS as readonly string[]).includes(kind)) {
    return kind as WorkflowUploadKind;
  }
  const aliases: Record<string, WorkflowUploadKind> = {
    country: "country_context_documents",
    country_context: "country_context_documents",
    context: "country_context_documents",
    ai: "ai_documents",
    international: "international_strategy_documents",
    international_strategy: "international_strategy_documents",
    strategy: "international_strategy_documents",
    foresight: "foresight_documents",
    investment: "investment_documents",
    cost_benefit: "investment_documents",
  };
  // Unknown legacy kinds remain optional country context. Dropping them would make an
  // upload present at launch silently disappear from the immutable snapshot.
  return aliases[kind] ?? "country_context_documents";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Freeze the uploads visible at launch as extracted text plus a hash-checked envelope.
 * The manifest is written last with `wx`; a basename can therefore never be silently
 * reused with different human inputs.
 */
export async function writeWorkflowUploadSnapshot(
  run: Pick<Run, "outBasename">,
  uploads: WorkflowLaunchUpload[],
): Promise<string> {
  const violations = frozenWorkflowUploadViolations(uploads);
  if (violations.length)
    throw new Error(`Invalid frozen workflow uploads: ${violations.join("; ")}`);
  const pendingRoot = safeWorkflowRunDir(run, false);
  if (!pendingRoot) throw new Error("The workflow workspace is outside the pinned pipeline tree.");
  const root = pendingRoot;
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  if (safeWorkflowRunDir(run, true) !== root) {
    throw new Error("The workflow workspace is not a real directory in the pinned pipeline tree.");
  }
  await ensureContainedDirectory(root, "inputs/upload-content");
  await ensureContainedDirectory(root, "inputs/upload-originals");

  const documents = [] as Array<Record<string, unknown>>;
  for (const [index, upload] of uploads.entries()) {
    const canonicalKind = workflowUploadKind(upload.kind);
    const stable = sha256(upload.id).slice(0, 16);
    const contentFilename = `${String(index + 1).padStart(3, "0")}-${stable}.txt`;
    await writeImmutableContainedFile(
      root,
      path.posix.join("inputs", "upload-content", contentFilename),
      upload.content,
    );
    const original = Buffer.from(upload.sourceBase64, "base64");
    if (
      original.byteLength !== upload.sourceBytes ||
      createHash("sha256").update(original).digest("hex") !== upload.sourceSha256
    ) {
      throw new Error(`Frozen original ${upload.filename} failed its provenance check.`);
    }
    const extension = path
      .extname(upload.filename)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "");
    const originalFilename = `${String(index + 1).padStart(3, "0")}-${stable}${extension}`;
    await writeImmutableContainedFile(
      root,
      path.posix.join("inputs", "upload-originals", originalFilename),
      original,
    );
    documents.push({
      id: upload.id,
      kind: canonicalKind,
      original_filename: upload.filename,
      content_path: path.posix.join("inputs", "upload-content", contentFilename),
      content_sha256: sha256(upload.content),
      content_media_type: "text/plain",
      original_path: path.posix.join("inputs", "upload-originals", originalFilename),
      original_sha256: upload.sourceSha256,
      original_size_bytes: upload.sourceBytes,
      metadata: {
        extracted_characters: upload.chars,
        app_upload_kind: canonicalKind,
        ...(upload.kind !== canonicalKind ? { app_upload_kind_original: upload.kind } : {}),
        ...(upload.mime ? { source_mime_type: upload.mime } : {}),
        uploaded_at: upload.uploadedAt,
        uploaded_by: upload.uploaderId,
        extraction_status: upload.extractionStatus,
      },
    });
  }

  const bytes = `${JSON.stringify(
    {
      schema_version: "damm.uploads-manifest/v1",
      documents,
    },
    null,
    2,
  )}\n`;
  return writeImmutableContainedFile(root, "launch-uploads-manifest.json", bytes);
}

export function argsFor(run: Run): { script: string; args: string[] } {
  const dir = scriptDir();
  // Exhaustive on purpose. A pass with no entry here must not fall through to the
  // research orchestrator: that would run a full 57-row research pass under another
  // pass's name and bill it to that pass's allocation.
  const SCRIPTS: Partial<Record<RunPass, string>> = {
    research: "research_orchestrator.py",
    // `g2` is the retained legacy/admin database id. Execution always enters the
    // canonically named machine-challenge script.
    g2: "automated_challenge.py",
    scans: "scans.py",
    foresight: "foresight.py",
    generation: "generate_dar.py",
    diagnostic: "diagnostic.py",
    workflow: "run_workflow.py",
  };
  const script = SCRIPTS[run.pass];
  if (!script) throw new Error(`No script implements the ${run.pass} pass.`);

  if (run.pass === "workflow") {
    return {
      script: path.join(dir, script),
      args: [
        "--country",
        run.countryName,
        "--iso",
        run.iso3,
        "--out",
        workflowRunDir(run),
        "--run-id",
        run.id,
        "--ceiling",
        String(run.ceilingUsd),
        ...(run.vendor ? ["--vendor", run.vendor] : []),
        "--uploads-manifest",
        workflowUploadManifestPath(run),
        // Safe on the first launch and required after a stale worker claim is retaken.
        // The coordinator validates the immutable snapshot and resumes the next stage;
        // this is automatic recovery, never a human resume/top-up gate.
        "--resume",
      ],
    };
  }

  // The automated challenge is machine QC, never G2 human review. It takes --run because
  // it reads an existing research pass rather than naming a new one. Its own resume logic
  // reads unambiguous historical `_g2_*` checkpoints and publishes canonical aliases
  // after a successful legacy resume.
  const nameFlag = run.pass === "g2" ? "--run" : "--out";
  return {
    script: path.join(dir, script),
    args: [
      "--country",
      run.countryName,
      "--iso",
      run.iso3,
      nameFlag,
      run.outBasename,
      "--ceiling",
      String(run.ceilingUsd),
      ...(run.vendor ? ["--vendor", run.vendor] : []),
      // Always resume. On a first run there is no state file and it starts from zero;
      // on a retaken claim it continues. One code path, no decision to get wrong.
      "--resume",
    ],
  };
}

export function defaultDeps(): WorkerDeps {
  return {
    store: dbStore(),
    async prepareWorkflowInputs(run) {
      const { workflowRunUsesCanonicalMethodology, workflowUploadSnapshot } =
        await import("./run-store.ts");
      if (!(await workflowRunUsesCanonicalMethodology(run.id))) {
        throw new Error("The workflow run is not pinned to this canonical DAMM methodology.");
      }
      const methodology = verifyPipelineMethodology();
      if (!methodology.ok) throw new Error(methodology.reason);
      const uploads = await workflowUploadSnapshot(run.id);
      if (!uploads) throw new Error("The canonical workflow has no durable launch snapshot.");
      await writeWorkflowUploadSnapshot(run, uploads);
    },
    verifyWorkflow(run) {
      const verified = verifyWorkflowCompletion(run);
      return verified.ok ? { ok: true } : verified;
    },
    async reconcileCompletedStageArtifacts(run, workerId) {
      const { reconcileCompletedStageArtifacts } = await import(
        "./completed-stage-artifacts.server.ts"
      );
      await reconcileCompletedStageArtifacts(run, workerId);
    },
    async publishWorkflowArtifacts(run, workerId) {
      const methodology = verifyPipelineMethodology();
      if (!methodology.ok) throw new Error(methodology.reason);
      const {
        publishWorkflowArtifactSet,
        saveWorkflowArtifact,
        workflowRunUsesCanonicalMethodology,
      } = await import("./run-store.ts");
      if (!(await workflowRunUsesCanonicalMethodology(run.id))) {
        throw new Error("The workflow run methodology changed before Draft artifacts were stored.");
      }
      const records = await collectWorkflowArtifacts(run);
      for (const record of records) {
        const held = await saveWorkflowArtifact(run.id, workerId, run.claimToken, record);
        if (!held) throw new Error("the workflow claim was lost while publishing downloads");
      }
      const published = await publishWorkflowArtifactSet(
        run.id,
        workerId,
        run.claimToken,
        records.map((record) => record.key),
      );
      if (!published) {
        throw new Error("the verified Stage 8 Draft download set was not made available");
      }
    },
    spawnPipeline(run) {
      const { script, args } = argsFor(run);
      // Bytecode beside the executable source tree would be an unpinned Python program.
      // Prevent normal runs from creating it so the source attestation can reject every
      // ignored or untracked .pyc without making the second run fail on the first run's cache.
      const child = spawn(pipelinePython(), ["-B", "-u", script, ...args], {
        cwd: scriptDir(),
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
      let onErr: (chunk: string) => void = () => {};
      return {
        onStdout: (cb) => child.stdout?.on("data", (d) => cb(String(d))),
        onStderr: (cb) => {
          onErr = cb;
          child.stderr?.on("data", (d) => cb(String(d)));
        },
        wait: () =>
          new Promise((resolve) => {
            // A process that cannot be started at all emits 'error', and 'close' is not
            // guaranteed to follow. Waiting only on 'close' would leave the worker holding
            // the claim until its lease expired, with the run showing as running the whole
            // time — a missing interpreter would look like a pipeline that never answers.
            let settled = false;
            const settle = (code: number | null) => {
              if (settled) return;
              settled = true;
              resolve(code);
            };
            child.on("close", settle);
            child.on("error", (err: Error) => {
              onErr(`OSError: the pipeline could not be started — ${err.message}\n`);
              settle(null);
            });
          }),
        kill: () => child.kill("SIGTERM"),
      };
    },
    async readLedger(run) {
      if (run.pass === "workflow") {
        try {
          const root = safeWorkflowRunDir(run, true);
          if (!root) return null;
          const manifestPath = containedPath(root, "workflow-manifest.json");
          if (!manifestPath) return null;
          const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
          // Null is meaningful: at least one handler could not report spend, so keeping
          // the last event value is more honest than treating an incomplete sum as total.
          return typeof manifest?.spent_usd === "number" ? manifest.spent_usd : null;
        } catch {
          return null;
        }
      }
      // The pipeline writes its ledger beside the assessment, in gauntlet/loop-1. A
      // historical machine-challenge run may still have only its retired `_g2_spend`
      // checkpoint; conflicting aliases are never selected silently.
      try {
        const p =
          run.pass === "g2"
            ? compatibleAutomatedChallengePath(run, "spend")
            : path.join(pipelineDir(), "gauntlet/loop-1", `${ledgerName(run)}_spend.json`);
        const j = JSON.parse(await readFile(p, "utf8"));
        const total = j?.summary?.total;
        return typeof total === "number" ? total : null;
      } catch {
        // A missing ledger is normal when a run dies before its first checkpoint. The
        // stdout figure stands rather than being overwritten with a guess.
        return null;
      }
    },
  };
}

/**
 * Where a pass leaves the rows it produced, in the order they should be trusted.
 *
 * `_input.json` is the engine input and only exists for a pass that reached every row —
 * the pipeline deliberately refuses to write it otherwise, because a partial input would
 * score as though the missing rows had been looked for and not found.
 *
 * `_state.json` is the per-row checkpoint, written after every row. It is what a partial
 * pass leaves behind, and reading it is how the rows an exhausted pass already paid for
 * can be imported without inventing the ones it never reached.
 */
type AutomatedChallengeFile = "input" | "state" | "spend" | "findings";

function regularFileBytes(filename: string, label: string): Buffer | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file.`);
  }
  return readFileSync(filename);
}

/**
 * Resolve one canonical machine-challenge file with a narrowly scoped historical alias.
 * New runs select the canonical name even before it exists. An old `_g2_*` file remains
 * readable/resumable, but two aliases must carry byte-identical content; otherwise there
 * is no trustworthy identity to select.
 */
function compatibleAutomatedChallengePath(run: Run, file: AutomatedChallengeFile): string {
  const dir = path.join(pipelineDir(), "gauntlet/loop-1");
  const canonical = path.join(dir, `${run.outBasename}_automated_challenge_${file}.json`);
  const legacy = path.join(dir, `${run.outBasename}_g2_${file}.json`);
  const canonicalBytes = regularFileBytes(canonical, `Canonical automated-challenge ${file}`);
  const legacyBytes = regularFileBytes(legacy, `Legacy automated-challenge ${file}`);
  if (canonicalBytes && legacyBytes && !canonicalBytes.equals(legacyBytes)) {
    throw new Error(`Conflicting canonical and legacy automated-challenge ${file} files.`);
  }
  if (canonicalBytes) return canonical;
  if (legacyBytes) return legacy;
  return canonical;
}

export function passFilePaths(run: Run): { input: string; state: string } {
  const dir = path.join(pipelineDir(), "gauntlet/loop-1");
  if (run.pass === "g2") {
    return {
      input: compatibleAutomatedChallengePath(run, "input"),
      state: compatibleAutomatedChallengePath(run, "state"),
    };
  }
  return {
    input: path.join(dir, `${ledgerName(run)}_input.json`),
    state: path.join(dir, `${ledgerName(run)}_state.json`),
  };
}

/**
 * What a pass leaves behind that a person would want to read.
 *
 * A closed list, keyed by pass. Artifacts are addressed by key and the path is built
 * here from the run's own basename — a route that took a filename from the caller would
 * be a path-traversal hole reading anything the worker's user can read.
 *
 * Each filename carries its whole suffix off the BARE basename, because that is what the
 * scripts write. The pass-prefixed name is right for ledgers and checkpoints, which every
 * pass writes under its own prefix, and wrong for outputs, which do not follow that rule:
 * generate_dar.py writes EGY_x_dar.html, not EGY_x_generation_dar.html. Deriving one from
 * the other produced links that pointed at nothing, for the roadmap most of all.
 */
export interface Artifact extends ArtifactLink {
  filename: string;
  contentType: string;
}

const JSON_T = "application/json";
const HTML_T = "text/html; charset=utf-8";
const TEXT_T = "text/markdown; charset=utf-8";
const CSV_T = "text/csv; charset=utf-8";
const PDF_T = "application/pdf";
const DOCX_T = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_T = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_T = "application/zip";
const JSONL_T = "application/x-ndjson; charset=utf-8";

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  json: JSON_T,
  jsonl: JSONL_T,
  html: HTML_T,
  md: TEXT_T,
  csv: CSV_T,
  pdf: PDF_T,
  docx: DOCX_T,
  xlsx: XLSX_T,
  zip: ZIP_T,
};

const APP_MODEL_DATA_DIRECTORY = fileURLToPath(new URL("../../data/", import.meta.url));

function methodologyAssetPath(asset: "export_manifest" | "model" | "schema"): string {
  const filename = {
    export_manifest: "damm_model_manifest.json",
    model: DAMM_MODEL_FILENAME,
    schema: DAMM_MODEL_SCHEMA_FILENAME,
  }[asset];
  return path.join(APP_MODEL_DATA_DIRECTORY, filename);
}

const WORKFLOW_ARTIFACTS: Artifact[] = artifactLinksFor("workflow").map((link) => {
  if (!link.extension || !link.workflowSource) {
    throw new Error(`Workflow artifact ${link.key} has no manifest selector`);
  }
  const contentType = CONTENT_TYPE_BY_EXTENSION[link.extension];
  if (!contentType) throw new Error(`Workflow artifact ${link.key} has an unknown media type`);
  return {
    ...link,
    filename: `_${link.key}.${link.extension}`,
    contentType,
  };
});

const ARTIFACTS: Record<RunPass, Artifact[]> = {
  workflow: WORKFLOW_ARTIFACTS,
  research: [
    { key: "input", label: "Engine input", filename: "_input.json", contentType: JSON_T },
    { key: "trail", label: "Research trail", filename: "_research.json", contentType: JSON_T },
  ],
  g2: [
    {
      key: "input",
      label: "Machine-QC engine input",
      filename: "_automated_challenge_input.json",
      contentType: JSON_T,
    },
    {
      key: "findings",
      label: "Automated challenge findings",
      filename: "_automated_challenge_findings.json",
      contentType: JSON_T,
    },
  ],
  scans: [
    { key: "scans", label: "Scan findings", filename: "_scans.json", contentType: JSON_T },
    {
      key: "register",
      label: "Initiative register",
      filename: "_register.json",
      contentType: JSON_T,
    },
  ],
  foresight: [
    {
      key: "foresight",
      label: "Foresight report",
      filename: "_foresight.html",
      contentType: HTML_T,
    },
    {
      key: "foresight-json",
      label: "Scenarios and milestones",
      filename: "_foresight.json",
      contentType: JSON_T,
    },
  ],
  generation: [
    { key: "dar", label: "Draft roadmap", filename: "_dar.html", contentType: HTML_T },
    { key: "dar-json", label: "Roadmap source", filename: "_dar.json", contentType: JSON_T },
  ],
  diagnostic: [
    {
      key: "diagnostic",
      label: "Diagnostic report",
      filename: "_diagnostic.html",
      contentType: HTML_T,
    },
    { key: "scored", label: "Scored assessment", filename: "_v17.json", contentType: JSON_T },
  ],
};

export function artifactsFor(pass: RunPass): Artifact[] {
  return ARTIFACTS[pass] ?? [];
}

function containedPath(root: string, relative: string): string | null {
  if (!relative || relative.includes("\\")) return null;
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relative);
  if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
    return null;
  }
  try {
    const canonicalRoot = realpathSync(absoluteRoot);
    const canonicalCandidate = realpathSync(candidate);
    if (
      canonicalCandidate !== canonicalRoot &&
      !canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)
    ) {
      return null;
    }

    // A final-component lstat cannot see a symlink in an ancestor. Reject every
    // workspace-relative symlink component so a manifest cannot route an otherwise
    // hash-matching artifact through a directory outside the run workspace.
    let component = absoluteRoot;
    for (const segment of path.relative(absoluteRoot, candidate).split(path.sep).filter(Boolean)) {
      component = path.join(component, segment);
      if (lstatSync(component).isSymbolicLink()) return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

interface RecordedArtifact {
  key: string;
  path: string;
  sha256: string;
  media_type: string;
}

interface VerifiedWorkflow {
  manifest: Record<string, unknown>;
  stage8Artifacts: RecordedArtifact[];
  assessmentInput: RecordedArtifact;
  uploadManifest: {
    path: string;
    sha256: string;
    documentCount: number;
  };
  uploads: VerifiedUploadDocument[];
}

interface VerifiedUploadDocument {
  id: string;
  kind: string;
  contentPath: string;
  contentSha256: string;
  originalPath: string;
  originalSha256: string;
  originalSizeBytes: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordedArtifact(value: unknown, root: string): RecordedArtifact | null {
  const record = object(value);
  if (
    !record ||
    typeof record.key !== "string" ||
    typeof record.path !== "string" ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    typeof record.media_type !== "string"
  ) {
    return null;
  }
  const filename = containedPath(root, record.path);
  if (!filename || artifactDigestSync(filename) !== record.sha256) return null;
  return record as unknown as RecordedArtifact;
}

function sha256FileSync(filename: string): string | null {
  try {
    if (!statSync(filename).isFile()) return null;
    const descriptor = openSync(filename, "r");
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      for (;;) {
        const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytes === 0) break;
        digest.update(buffer.subarray(0, bytes));
      }
    } finally {
      closeSync(descriptor);
    }
    return digest.digest("hex");
  } catch {
    return null;
  }
}

function directoryDigestSync(directory: string): string | null {
  try {
    const files: string[] = [];
    const visit = (current: string) => {
      for (const name of readdirSync(current).sort()) {
        const candidate = path.join(current, name);
        const stat = lstatSync(candidate);
        if (stat.isSymbolicLink()) throw new Error("symbolic links are not canonical artifacts");
        if (stat.isDirectory()) visit(candidate);
        else if (stat.isFile()) files.push(candidate);
      }
    };
    visit(directory);
    files.sort((a, b) =>
      path
        .relative(directory, a)
        .split(path.sep)
        .join("/")
        .localeCompare(path.relative(directory, b).split(path.sep).join("/")),
    );
    const digest = createHash("sha256");
    for (const filename of files) {
      const relative = Buffer.from(
        path.relative(directory, filename).split(path.sep).join("/"),
        "utf8",
      );
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(relative.length));
      digest.update(length);
      digest.update(relative);
      const fileHash = sha256FileSync(filename);
      if (!fileHash) return null;
      digest.update(Buffer.from(fileHash, "hex"));
    }
    return digest.digest("hex");
  } catch {
    return null;
  }
}

function artifactDigestSync(filename: string): string | null {
  try {
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) return null;
    if (stat.isFile()) return sha256FileSync(filename);
    if (stat.isDirectory()) return directoryDigestSync(filename);
    return null;
  } catch {
    return null;
  }
}

export type PipelineMethodologyRole = "model" | "model_schema" | "engine" | "renderer";

export interface PipelineMethodologyFile {
  role: PipelineMethodologyRole;
  path: string;
  sha256: string;
}

/**
 * Every pipeline-owned byte that can change the meaning or labels of a diagnostic. The
 * indicator census is not in this list because DAR Studio generates it directly from
 * the pinned model. These explicit digests complement the clean source-commit check by
 * making the most consequential identity failures specific and diagnosable.
 */
export const CANONICAL_PIPELINE_METHODOLOGY_FILES: readonly PipelineMethodologyFile[] =
  Object.freeze(
    (
      [
        {
          role: "model",
          path: DAMM_MODEL_EXPORT.source.model_path,
          sha256: DAMM_MODEL_SOURCE_SHA256[DAMM_MODEL_EXPORT.source.model_path],
        },
        {
          role: "model_schema",
          path: DAMM_MODEL_EXPORT.source.schema_path,
          sha256: DAMM_MODEL_SOURCE_SHA256[DAMM_MODEL_EXPORT.source.schema_path],
        },
        {
          role: "engine",
          path: DAMM_MODEL_EXPORT.runtime.engine.path,
          sha256: DAMM_MODEL_EXPORT.runtime.engine.sha256,
        },
        {
          role: "renderer",
          path: DAMM_MODEL_EXPORT.runtime.renderer.path,
          sha256: DAMM_MODEL_EXPORT.runtime.renderer.sha256,
        },
      ] satisfies PipelineMethodologyFile[]
    ).map((entry) => Object.freeze(entry)),
  );

export interface VerifiedPipelineMethodology {
  sourceCommit: string;
  files: readonly PipelineMethodologyFile[];
}

function verifyPipelineSourceCheckout(
  root: string,
  expectedCommit: string,
): { ok: true; commit: string } | { ok: false; reason: string } {
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const topLevel = git("rev-parse", "--show-toplevel");
    const commit = git("rev-parse", "HEAD");
    const trackedChanges = git("status", "--porcelain=v1", "--untracked-files=no");
    const trackedSource = git("ls-files", "-z", "--", "gauntlet/loop-1");
    const untrackedSource = git(
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "gauntlet/loop-1",
    );
    const ignoredSource = git(
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      "gauntlet/loop-1",
    );
    const hasUnpinnedExecutable = [untrackedSource, ignoredSource].some((files) =>
      files
        .split("\0")
        .some((filename) => /\.(?:py|pyi|pyx|pyw|pyz|pyc|pyo|so|pyd)$/i.test(filename)),
    );
    const hasSourceSymlink = [trackedSource, untrackedSource, ignoredSource].some((files) =>
      files
        .split("\0")
        .filter(Boolean)
        .some((filename) => lstatSync(path.join(root, filename)).isSymbolicLink()),
    );
    if (
      realpathSync(topLevel) !== realpathSync(root) ||
      commit !== expectedCommit ||
      trackedChanges.length > 0 ||
      hasUnpinnedExecutable ||
      hasSourceSymlink
    ) {
      return {
        ok: false,
        reason: "The DAMM pipeline checkout is not the clean pinned source revision.",
      };
    }
    return { ok: true, commit };
  } catch {
    return {
      ok: false,
      reason: "The DAMM pipeline checkout cannot attest its pinned source revision.",
    };
  }
}

/** Refuse a pipeline checkout whose executable model, schema, engine, or renderer drifted. */
export function verifyPipelineMethodology(
  root = pipelineDir(),
  expected: readonly PipelineMethodologyFile[] = CANONICAL_PIPELINE_METHODOLOGY_FILES,
  expectedSourceCommit = DAMM_MODEL_IDENTITY.sourceCommit,
): { ok: true; value: VerifiedPipelineMethodology } | { ok: false; reason: string } {
  const roles = new Set<PipelineMethodologyRole>();
  const paths = new Set<string>();
  for (const component of expected) {
    if (
      roles.has(component.role) ||
      paths.has(component.path) ||
      !/^[a-f0-9]{64}$/.test(component.sha256)
    ) {
      return { ok: false, reason: "The canonical pipeline methodology manifest is invalid." };
    }
    roles.add(component.role);
    paths.add(component.path);
    const filename = containedPath(root, component.path);
    if (!filename || artifactDigestSync(filename) !== component.sha256) {
      return {
        ok: false,
        reason: `The DAMM ${component.role.replaceAll("_", " ")} does not match the pinned methodology revision.`,
      };
    }
  }
  const requiredRoles: PipelineMethodologyRole[] = ["model", "model_schema", "engine", "renderer"];
  if (requiredRoles.some((role) => !roles.has(role))) {
    return { ok: false, reason: "The canonical pipeline methodology manifest is incomplete." };
  }

  // The coordinator and every tracked stage/export dependency are pinned by the clean
  // source tree, while the four meaning-bearing files below also receive explicit
  // content checks and version-label validation. A source commit is never self-attested.
  const checkout = verifyPipelineSourceCheckout(root, expectedSourceCommit);
  if (!checkout.ok) return checkout;

  const modelRecord = expected.find((component) => component.role === "model");
  const schemaRecord = expected.find((component) => component.role === "model_schema");
  const engineRecord = expected.find((component) => component.role === "engine");
  const rendererRecord = expected.find((component) => component.role === "renderer");
  try {
    const parsedModel = object(
      JSON.parse(readFileSync(containedPath(root, modelRecord!.path)!, "utf8")),
    );
    const parsedSchema = object(
      JSON.parse(readFileSync(containedPath(root, schemaRecord!.path)!, "utf8")),
    );
    if (
      !parsedModel ||
      parsedModel.model !== DAMM_MODEL_IDENTITY.modelId ||
      parsedModel.version !== DAMM_MODEL_IDENTITY.version ||
      parsedModel.revision !== DAMM_MODEL_IDENTITY.revision ||
      parsedModel.status !== DAMM_MODEL_IDENTITY.status ||
      parsedModel.ratified !== DAMM_MODEL_IDENTITY.ratified ||
      !parsedSchema
    ) {
      return {
        ok: false,
        reason: "The pipeline model or schema carries a stale DAMM revision or status label.",
      };
    }
    const engineText = readFileSync(containedPath(root, engineRecord!.path)!, "utf8");
    const rendererText = readFileSync(containedPath(root, rendererRecord!.path)!, "utf8");
    if (
      !engineText.includes(`DAMM v${DAMM_MODEL_EXPORT.runtime.engine.version}`) ||
      !rendererText.includes(`DAMM v${DAMM_MODEL_EXPORT.runtime.renderer.version}`)
    ) {
      return {
        ok: false,
        reason: "The pipeline engine or renderer carries a stale DAMM version label.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `The pinned pipeline methodology cannot be read: ${String(error)}`,
    };
  }
  return {
    ok: true,
    value: {
      sourceCommit: checkout.commit,
      files: expected.map((component) => Object.freeze({ ...component })),
    },
  };
}

function stageOutputHashes(value: unknown): Map<string, string[]> | null {
  const result = new Map<string, string[]>();
  const add = (key: unknown, digest: unknown) => {
    if (typeof key !== "string" || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
      return;
    }
    result.set(key, [...(result.get(key) ?? []), digest]);
  };
  const root = object(value);
  if (root) {
    for (const [key, candidate] of Object.entries(root)) {
      if (Array.isArray(candidate)) {
        for (const child of candidate) add(key, object(child)?.sha256 ?? child);
      } else {
        add(key, object(candidate)?.sha256 ?? candidate);
      }
    }
    return result;
  }
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    const item = object(candidate);
    if (!item) continue;
    add(item.key ?? item.artifact_id ?? item.id, item.sha256);
  }
  return result;
}

function failedQualityCheck(value: unknown): boolean {
  if (value === false) return true;
  const item = object(value);
  return item?.ok === false;
}

/** Validate the coordinator's stage-level provenance, not only its outer file hash. */
function verifyStageManifest(
  filename: string | null,
  stageId: string,
  ordinal: number,
  runId: string,
  inputSnapshotSha256: string,
  artifacts: RecordedArtifact[],
): boolean {
  if (!filename) return false;
  let manifest: Record<string, unknown>;
  try {
    const parsed = object(JSON.parse(readFileSync(filename, "utf8")));
    if (!parsed) return false;
    manifest = parsed;
  } catch {
    return false;
  }
  if (
    !DAR_WORKFLOW.stage_manifest_required_fields.every((field) =>
      Object.prototype.hasOwnProperty.call(manifest, field),
    ) ||
    manifest.schema_version !== "damm.workflow-stage/v1" ||
    manifest.workflow_id !== DAR_WORKFLOW.workflow_id ||
    manifest.workflow_version !== DAR_WORKFLOW.workflow_version ||
    manifest.run_id !== runId ||
    manifest.stage_id !== stageId ||
    manifest.ordinal !== ordinal ||
    manifest.status !== "complete" ||
    typeof manifest.execution_mode !== "string" ||
    !manifest.execution_mode.trim() ||
    typeof manifest.spend_usd !== "number" ||
    !Number.isFinite(manifest.spend_usd) ||
    manifest.spend_usd < 0 ||
    !object(manifest.input_hashes) ||
    object(manifest.input_hashes)?.input_snapshot !== inputSnapshotSha256 ||
    object(manifest.input_snapshot)?.sha256 !== inputSnapshotSha256 ||
    (!object(manifest.quality_checks) && !Array.isArray(manifest.quality_checks)) ||
    manifest.source_inventory === null ||
    manifest.source_inventory === undefined
  ) {
    return false;
  }
  const quality = object(manifest.quality_checks);
  const checks = quality ? Object.values(quality) : (manifest.quality_checks as unknown[]);
  if (checks.some(failedQualityCheck)) return false;

  const outputHashes = stageOutputHashes(manifest.output_hashes);
  if (!outputHashes) return false;
  const expected = new Map<string, string[]>();
  for (const artifact of artifacts) {
    if (artifact.key === "stage_manifest") continue;
    expected.set(artifact.key, [...(expected.get(artifact.key) ?? []), artifact.sha256]);
  }
  if (expected.size !== outputHashes.size) return false;
  for (const [key, digests] of expected) {
    const actual = outputHashes.get(key);
    if (!actual || [...actual].sort().join("\n") !== [...digests].sort().join("\n")) {
      return false;
    }
  }
  return true;
}

/**
 * Prove that the coordinator completed this exact exported contract, in canonical order,
 * with every required artifact recorded under its isolated workspace.
 */
export function verifyWorkflowCompletion(
  run: Pick<Run, "id" | "countryName" | "iso3" | "outBasename" | "ceilingUsd" | "vendor">,
): { ok: true; value: VerifiedWorkflow } | { ok: false; reason: string } {
  if (isSimulationIdentity(run)) {
    return {
      ok: false,
      reason: "Simulation output is not eligible for workflow acceptance or artifact publication.",
    };
  }
  const root = safeWorkflowRunDir(run, true);
  if (!root) {
    return { ok: false, reason: "The workflow workspace is not inside the pipeline tree." };
  }
  let manifest: Record<string, unknown>;
  try {
    const manifestPath = containedPath(root, "workflow-manifest.json");
    if (!manifestPath) throw new Error("manifest path is not a real contained file");
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    const candidate = object(parsed);
    if (!candidate) throw new Error("manifest root is not an object");
    manifest = candidate;
  } catch (error) {
    return { ok: false, reason: `The workflow manifest cannot be read: ${String(error)}` };
  }

  if (
    manifest.schema_version !== "damm.workflow-run/v1" ||
    manifest.run_id !== run.id ||
    manifest.workflow_id !== DAR_WORKFLOW.workflow_id ||
    manifest.workflow_version !== DAR_WORKFLOW.workflow_version ||
    manifest.contract_sha256 !== DAR_WORKFLOW_SHA256 ||
    manifest.country !== run.countryName ||
    manifest.iso3 !== run.iso3.toUpperCase() ||
    manifest.status !== "complete"
  ) {
    return {
      ok: false,
      reason: "The workflow manifest does not identify this completed canonical run.",
    };
  }

  const snapshot = object(manifest.input_snapshot);
  if (
    !snapshot ||
    typeof snapshot.path !== "string" ||
    typeof snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  ) {
    return { ok: false, reason: "The workflow manifest has no valid immutable input snapshot." };
  }
  const snapshotPath = containedPath(root, snapshot.path);
  if (!snapshotPath || sha256FileSync(snapshotPath) !== snapshot.sha256) {
    return { ok: false, reason: "The immutable workflow input snapshot failed verification." };
  }
  let inputSnapshot: Record<string, unknown>;
  try {
    const parsed = object(JSON.parse(readFileSync(snapshotPath, "utf8")));
    if (!parsed) throw new Error("snapshot is not an object");
    inputSnapshot = parsed;
  } catch (error) {
    return { ok: false, reason: `The immutable input snapshot cannot be parsed: ${String(error)}` };
  }
  if (
    inputSnapshot.schema_version !== "damm.workflow-input-snapshot/v1" ||
    inputSnapshot.country !== run.countryName ||
    inputSnapshot.iso3 !== run.iso3.toUpperCase() ||
    inputSnapshot.contract_sha256 !== DAR_WORKFLOW_SHA256 ||
    inputSnapshot.ceiling_usd !== run.ceilingUsd ||
    !("vendor" in inputSnapshot) ||
    (inputSnapshot.vendor ?? null) !== run.vendor ||
    JSON.stringify(inputSnapshot.uploads_manifest ?? null) !==
      JSON.stringify(manifest.uploads_manifest ?? null)
  ) {
    return { ok: false, reason: "The input snapshot is not bound to this run and upload record." };
  }
  const uploadsRecord = object(manifest.uploads_manifest);
  if (!uploadsRecord) {
    return { ok: false, reason: "The workflow manifest has no frozen uploads record." };
  }
  if (
    typeof uploadsRecord.path !== "string" ||
    typeof uploadsRecord.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(uploadsRecord.sha256) ||
    !Number.isInteger(uploadsRecord.document_count)
  ) {
    return { ok: false, reason: "The frozen uploads record is invalid." };
  }
  const uploadsPath = containedPath(root, uploadsRecord.path);
  if (!uploadsPath || sha256FileSync(uploadsPath) !== uploadsRecord.sha256) {
    return { ok: false, reason: "The frozen uploads manifest failed verification." };
  }
  const verifiedUploads: VerifiedUploadDocument[] = [];
  try {
    const envelope = object(JSON.parse(readFileSync(uploadsPath, "utf8")));
    if (
      !envelope ||
      envelope.schema_version !== "damm.uploads-manifest/v1" ||
      !Array.isArray(envelope.documents) ||
      envelope.documents.length !== uploadsRecord.document_count
    ) {
      throw new Error("upload envelope shape or count does not match");
    }
    const documentIds = new Set<string>();
    const documentPaths = new Set<string>();
    for (const [index, value] of envelope.documents.entries()) {
      const document = object(value);
      const metadata = object(document?.metadata);
      const contentRelative =
        typeof document?.content_path === "string" ? document.content_path : "";
      const originalRelative =
        typeof document?.original_path === "string" ? document.original_path : "";
      const contentPath = contentRelative ? containedPath(root, contentRelative) : null;
      const originalPath = originalRelative ? containedPath(root, originalRelative) : null;
      if (
        !document ||
        typeof document.id !== "string" ||
        !document.id ||
        documentIds.has(document.id) ||
        typeof document.kind !== "string" ||
        !DAR_WORKFLOW.optional_launch_inputs.some((input) => input.id === document.kind) ||
        typeof document.original_filename !== "string" ||
        !document.original_filename ||
        typeof document.content_sha256 !== "string" ||
        typeof document.original_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(document.content_sha256) ||
        !/^[a-f0-9]{64}$/.test(document.original_sha256) ||
        !Number.isSafeInteger(document.original_size_bytes) ||
        (document.original_size_bytes as number) < 0 ||
        !contentPath ||
        !originalPath ||
        contentRelative === originalRelative ||
        documentPaths.has(contentRelative) ||
        documentPaths.has(originalRelative) ||
        !contentRelative.startsWith("inputs/upload-content/") ||
        !originalRelative.startsWith("inputs/upload-originals/") ||
        sha256FileSync(contentPath) !== document.content_sha256 ||
        sha256FileSync(originalPath) !== document.original_sha256 ||
        statSync(originalPath).size !== document.original_size_bytes ||
        document.content_media_type !== "text/plain" ||
        !metadata ||
        metadata.app_upload_kind !== document.kind ||
        metadata.extraction_status !== "extracted" ||
        typeof metadata.source_mime_type !== "string" ||
        !metadata.source_mime_type ||
        typeof metadata.uploaded_by !== "string" ||
        !metadata.uploaded_by ||
        typeof metadata.uploaded_at !== "string" ||
        !Number.isFinite(Date.parse(metadata.uploaded_at))
      ) {
        throw new Error(`document ${index + 1} provenance does not verify`);
      }
      const content = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(contentPath));
      if (metadata.extracted_characters !== Array.from(content).length) {
        throw new Error(`document ${index + 1} extracted character count does not match`);
      }
      documentIds.add(document.id);
      documentPaths.add(contentRelative);
      documentPaths.add(originalRelative);
      verifiedUploads.push({
        id: document.id,
        kind: document.kind,
        contentPath: contentRelative,
        contentSha256: document.content_sha256,
        originalPath: originalRelative,
        originalSha256: document.original_sha256,
        originalSizeBytes: document.original_size_bytes as number,
      });
    }
  } catch (error) {
    return { ok: false, reason: `The frozen upload inputs failed verification: ${String(error)}` };
  }

  if (!Array.isArray(manifest.stages) || manifest.stages.length !== DAR_WORKFLOW.stages.length) {
    return { ok: false, reason: "The workflow manifest does not contain all eight stages." };
  }

  let stage8Artifacts: RecordedArtifact[] = [];
  let assessmentInput: RecordedArtifact | null = null;
  for (const [index, contractStage] of DAR_WORKFLOW.stages.entries()) {
    const stage = object(manifest.stages[index]);
    if (
      !stage ||
      stage.ordinal !== contractStage.ordinal ||
      stage.id !== contractStage.id ||
      stage.status !== "complete" ||
      !Array.isArray(stage.artifacts)
    ) {
      return {
        ok: false,
        reason: `The workflow manifest has not completed canonical stage ${contractStage.ordinal}.`,
      };
    }
    const artifacts = stage.artifacts.map((value) => recordedArtifact(value, root));
    if (artifacts.some((value) => value === null)) {
      return {
        ok: false,
        reason: `Canonical stage ${contractStage.ordinal} has an invalid artifact record.`,
      };
    }
    const valid = artifacts as RecordedArtifact[];
    const keys = new Set(valid.map((artifact) => artifact.key));
    for (const required of contractStage.required_artifacts) {
      if (!keys.has(required)) {
        return {
          ok: false,
          reason: `Canonical stage ${contractStage.ordinal} is missing ${required}.`,
        };
      }
    }
    const stageManifests = valid.filter((artifact) => artifact.key === "stage_manifest");
    if (
      stageManifests.length !== 1 ||
      !verifyStageManifest(
        containedPath(root, stageManifests[0].path),
        contractStage.id,
        contractStage.ordinal,
        run.id,
        snapshot.sha256,
        valid,
      )
    ) {
      return {
        ok: false,
        reason: `Canonical stage ${contractStage.ordinal} has an invalid stage manifest.`,
      };
    }
    if (contractStage.id === "damm_diagnostic") {
      const engineInputs = valid.filter((artifact) => artifact.key === "engine_input");
      if (engineInputs.length !== 1) {
        return {
          ok: false,
          reason:
            "Canonical stage 1 does not identify one hash-bound scored engine input. " +
            "Raw research observations cannot stand in for the assessment rows reviewed at G1.",
        };
      }
      assessmentInput = engineInputs[0];
    }
    if (contractStage.id === "export_package") stage8Artifacts = valid;
  }

  if (!assessmentInput) {
    return { ok: false, reason: "The completed workflow has no assessment input binding." };
  }

  return {
    ok: true,
    value: {
      manifest,
      stage8Artifacts,
      assessmentInput,
      uploadManifest: {
        path: uploadsRecord.path,
        sha256: uploadsRecord.sha256,
        documentCount: uploadsRecord.document_count as number,
      },
      uploads: verifiedUploads,
    },
  };
}

function verifiedStage8File(root: string, records: RecordedArtifact[], key: string): string | null {
  const matches = records.filter((record) => record.key === key);
  if (matches.length !== 1) return null;
  const filename = containedPath(root, matches[0].path);
  return filename && sha256FileSync(filename) === matches[0].sha256 ? filename : null;
}

interface PackageFileRecord {
  path: string;
  sha256: string;
  bytes: number;
  category: string;
  stage_id?: string;
  artifact_id?: string;
  source_sha256?: string;
  input_id?: string;
  input_kind?: string;
}

function packageRecord(value: unknown): PackageFileRecord | null {
  const record = object(value);
  if (
    !record ||
    typeof record.path !== "string" ||
    !record.path ||
    record.path.includes("\\") ||
    path.posix.isAbsolute(record.path) ||
    record.path.split("/").includes("..") ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes as number) < 0 ||
    typeof record.category !== "string" ||
    (record.stage_id !== undefined && typeof record.stage_id !== "string") ||
    (record.artifact_id !== undefined && typeof record.artifact_id !== "string") ||
    (record.source_sha256 !== undefined &&
      (typeof record.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.source_sha256))) ||
    (record.input_id !== undefined && typeof record.input_id !== "string") ||
    (record.input_kind !== undefined && typeof record.input_kind !== "string")
  ) {
    return null;
  }
  return record as unknown as PackageFileRecord;
}

function matchesPackageSelector(record: PackageFileRecord, selector: WorkflowPackageSelector) {
  return (
    record.category === selector.category &&
    (selector.stageId === undefined || record.stage_id === selector.stageId) &&
    (selector.artifactId === undefined || record.artifact_id === selector.artifactId) &&
    path.posix.extname(record.path).toLowerCase() === `.${selector.extension.toLowerCase()}`
  );
}

interface VerifiedPackageIndex {
  manifestPath: string;
  records: PackageFileRecord[];
}

function verifiedPackageIndex(
  root: string,
  completed: VerifiedWorkflow,
): VerifiedPackageIndex | null {
  const manifestPath = verifiedStage8File(root, completed.stage8Artifacts, "workflow_manifest");
  if (!manifestPath) return null;
  let manifest: Record<string, unknown>;
  try {
    const parsed = object(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (!parsed) return null;
    manifest = parsed;
  } catch {
    return null;
  }
  if (
    manifest.schema_version !== "damm.dar-package/v1" ||
    manifest.workflow_id !== DAR_WORKFLOW.workflow_id ||
    manifest.workflow_version !== DAR_WORKFLOW.workflow_version ||
    manifest.workflow_contract_sha256 !== DAR_WORKFLOW_SHA256 ||
    manifest.country !== completed.manifest.country ||
    manifest.iso3 !== completed.manifest.iso3 ||
    manifest.lifecycle_state !== "draft" ||
    manifest.input_snapshot_sha256 !== object(completed.manifest.input_snapshot)?.sha256 ||
    !Array.isArray(manifest.files) ||
    manifest.file_count !== manifest.files.length
  ) {
    return null;
  }
  const records = manifest.files.map(packageRecord);
  if (records.some((record) => record === null)) return null;
  const validRecords = records as PackageFileRecord[];
  if (new Set(validRecords.map((record) => record.path)).size !== validRecords.length) return null;

  const packagedAssessmentInputs = validRecords.filter(
    (record) => record.stage_id === "damm_diagnostic" && record.artifact_id === "engine_input",
  );
  if (
    packagedAssessmentInputs.length !== 1 ||
    packagedAssessmentInputs[0].category !== "structured" ||
    packagedAssessmentInputs[0].sha256 !== completed.assessmentInput.sha256 ||
    packagedAssessmentInputs[0].source_sha256 !== completed.assessmentInput.sha256
  ) {
    return null;
  }

  const expectedUploadSignature = {
    schema_version: "damm.uploads-manifest/v1",
    manifest_path: completed.uploadManifest.path,
    manifest_sha256: completed.uploadManifest.sha256,
    document_count: completed.uploadManifest.documentCount,
    documents: completed.uploads.map((upload) => ({
      id: upload.id,
      kind: upload.kind,
      content_path: upload.contentPath,
      content_sha256: upload.contentSha256,
      original_path: upload.originalPath,
      original_sha256: upload.originalSha256,
      original_size_bytes: upload.originalSizeBytes,
    })),
  };
  if (JSON.stringify(manifest.upload_inputs) !== JSON.stringify(expectedUploadSignature)) {
    return null;
  }

  const expectedInputs = [
    {
      path: completed.uploadManifest.path,
      sha256: completed.uploadManifest.sha256,
      artifactId: "uploads_manifest",
      inputId: undefined,
      inputKind: undefined,
    },
    ...completed.uploads.flatMap((upload) => [
      {
        path: upload.contentPath,
        sha256: upload.contentSha256,
        artifactId: "upload_extracted_text",
        inputId: upload.id,
        inputKind: upload.kind,
      },
      {
        path: upload.originalPath,
        sha256: upload.originalSha256,
        artifactId: "upload_original",
        inputId: upload.id,
        inputKind: upload.kind,
      },
    ]),
  ];
  const inputRecords = validRecords.filter((record) => record.category === "input");
  if (inputRecords.length !== expectedInputs.length) return null;
  for (const expected of expectedInputs) {
    const matches = inputRecords.filter((record) => record.path === expected.path);
    if (
      matches.length !== 1 ||
      matches[0].sha256 !== expected.sha256 ||
      matches[0].source_sha256 !== expected.sha256 ||
      matches[0].artifact_id !== expected.artifactId ||
      matches[0].input_id !== expected.inputId ||
      matches[0].input_kind !== expected.inputKind
    ) {
      return null;
    }
  }
  return { manifestPath, records: validRecords };
}

function workflowPackageFile(
  root: string,
  completed: VerifiedWorkflow,
  selector: WorkflowPackageSelector,
): string | null {
  const index = verifiedPackageIndex(root, completed);
  if (!index) return null;
  const matches = index.records.filter((record) => matchesPackageSelector(record, selector));
  if (matches.length !== 1) return null;

  if (!selector.groupArtifactKey) return null;
  const groupRecord = completed.stage8Artifacts.find(
    (record) => record.key === selector.groupArtifactKey,
  );
  if (!groupRecord) return null;
  const groupRoot = containedPath(root, groupRecord.path);
  if (!groupRoot) return null;
  const prefix: Record<NonNullable<WorkflowPackageSelector["groupArtifactKey"]>, string> = {
    narrative_exports: "narratives",
    structured_exports: "structured",
    source_inventory_exports: "source-inventory",
  };
  const groupPrefix = `${prefix[selector.groupArtifactKey]}/`;
  if (!matches[0].path.startsWith(groupPrefix)) return null;
  const filename = containedPath(groupRoot, matches[0].path.slice(groupPrefix.length));
  return filename && sha256FileSync(filename) === matches[0].sha256 ? filename : null;
}

async function archivedWorkflowPackageFiles(
  run: Run,
  completed: VerifiedWorkflow,
): Promise<{ index: VerifiedPackageIndex; content: Map<string, Uint8Array> } | null> {
  const root = safeWorkflowRunDir(run, true);
  if (!root) return null;
  const index = verifiedPackageIndex(root, completed);
  if (!index) return null;
  const bundle = verifiedStage8File(root, completed.stage8Artifacts, "complete_bundle");
  if (!bundle) return null;
  try {
    const bundleSize = statSync(bundle).size;
    if (bundleSize > MAX_WORKFLOW_BUNDLE_BYTES) return null;
    let declaredTotal = 0;
    for (const record of index.records) {
      if (record.bytes > MAX_WORKFLOW_ARTIFACT_BYTES) return null;
      declaredTotal += record.bytes;
      if (declaredTotal > MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES) return null;
    }
    const JSZip = (await import("jszip")).default;
    const archive = await JSZip.loadAsync(await readFile(bundle));
    const archiveFiles = Object.values(archive.files).filter((entry) => !entry.dir);
    if (archiveFiles.length !== index.records.length + 1) return null;
    const content = new Map<string, Uint8Array>();
    const usedArchiveEntries = new Set<string>();
    for (const record of index.records) {
      if (content.has(record.path)) return null;
      const suffix = `/${record.path}`;
      const entries = archiveFiles.filter(
        (entry) =>
          !usedArchiveEntries.has(entry.name) &&
          (entry.name === record.path || entry.name.endsWith(suffix)),
      );
      if (entries.length !== 1) return null;
      usedArchiveEntries.add(entries[0].name);
      const bytes = await entries[0].async("uint8array");
      if (
        bytes.byteLength !== record.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== record.sha256
      ) {
        return null;
      }
      content.set(record.path, bytes);
    }
    const manifestEntries = archiveFiles.filter(
      (entry) =>
        !usedArchiveEntries.has(entry.name) &&
        (entry.name === "package-manifest.json" || entry.name.endsWith("/package-manifest.json")),
    );
    if (manifestEntries.length !== 1) return null;
    const archivedManifest = await manifestEntries[0].async("uint8array");
    const authoritativeManifest = await readFile(index.manifestPath);
    if (!Buffer.from(archivedManifest).equals(authoritativeManifest)) return null;
    usedArchiveEntries.add(manifestEntries[0].name);
    if (usedArchiveEntries.size !== archiveFiles.length) return null;
    return { index, content };
  } catch {
    return null;
  }
}

/** The absolute path of one artifact, or null when the key is not one this pass has. */
export function artifactPath(run: Run, key: string): { path: string; artifact: Artifact } | null {
  const artifact = artifactsFor(run.pass).find((x) => x.key === key);
  if (!artifact) return null;
  if (run.pass === "workflow") {
    const root = safeWorkflowRunDir(run, true);
    if (!root) return null;
    const verified = verifyWorkflowCompletion(run);
    if (!verified.ok || !artifact.workflowSource) return null;
    const source = artifact.workflowSource;
    let resolved: string | null;
    if (source.kind === "root") resolved = containedPath(root, source.path);
    else if (source.kind === "stage8") {
      resolved = verifiedStage8File(root, verified.value.stage8Artifacts, source.artifactKey);
    } else if (source.kind === "assessment_input") {
      resolved = containedPath(root, verified.value.assessmentInput.path);
    } else if (source.kind === "package") {
      resolved = workflowPackageFile(root, verified.value, source.selector);
    } else {
      resolved =
        source.asset === "run_manifest" || source.asset === "indicator_census"
          ? null
          : methodologyAssetPath(source.asset);
    }
    return resolved ? { artifact, path: resolved } : null;
  }
  try {
    return {
      artifact,
      path:
        run.pass === "g2"
          ? compatibleAutomatedChallengePath(run, key === "input" ? "input" : "findings")
          : path.join(pipelineDir(), "gauntlet/loop-1", `${run.outBasename}${artifact.filename}`),
    };
  } catch {
    // An ambiguous or non-regular compatibility alias is not an artifact DAR Studio may
    // expose. The upstream resume entry point rejects the same condition before spending.
    return null;
  }
}

// Preserve these public exports for callers while keeping one deployment-wide source of truth.
export {
  MAX_WORKFLOW_ARTIFACT_BYTES,
  MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES,
  MAX_WORKFLOW_BUNDLE_BYTES,
} from "./artifact-limits.ts";

/**
 * Read the complete canonical download set only after all manifest checks have passed.
 * Every byte is re-hashed here before it crosses the worker/web host boundary.
 */
export async function collectWorkflowArtifacts(run: Run): Promise<WorkflowArtifactWrite[]> {
  if (run.pass !== "workflow")
    throw new Error("Only a canonical workflow publishes an artifact set.");
  const verified = verifyWorkflowCompletion(run);
  if (!verified.ok) throw new Error(verified.reason);
  const assessmentInputSha256 = verified.value.assessmentInput.sha256;

  const root = safeWorkflowRunDir(run, true);
  if (!root) throw new Error("The completed workflow workspace failed containment verification.");
  const archive = await archivedWorkflowPackageFiles(run, verified.value);
  if (!archive) throw new Error("The completed DAR bundle does not match its package manifest.");

  const records: WorkflowArtifactWrite[] = [];
  const keys = new Set<string>();
  const usedPackagePaths = new Set<string>();
  let total = 0;

  function addArtifact(
    artifact: Omit<WorkflowArtifactWrite, "content" | "assessmentInputSha256"> & {
      content: Uint8Array;
    },
    label: string,
    limit = MAX_WORKFLOW_ARTIFACT_BYTES,
  ) {
    if (keys.has(artifact.key))
      throw new Error(`Duplicate canonical artifact key ${artifact.key}.`);
    keys.add(artifact.key);
    if (artifact.content.byteLength > limit) {
      throw new Error(`${label} exceeds its ${Math.floor(limit / 1024 / 1024)} MB storage limit.`);
    }
    total += artifact.content.byteLength;
    if (total > MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES) {
      throw new Error(
        `The canonical download set exceeds its ${Math.floor(MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES / 1024 / 1024)} MB storage limit.`,
      );
    }
    records.push({
      ...artifact,
      assessmentInputSha256,
    });
  }

  for (const link of artifactsFor("workflow")) {
    const source = link.workflowSource;
    if (source?.kind === "methodology") {
      let content: Uint8Array;
      let relativePath: string;
      let filename: string;
      if (source.asset === "run_manifest") {
        content = new TextEncoder().encode(
          `${JSON.stringify(
            runMethodologyManifest(run.id, {
              path: verified.value.assessmentInput.path,
              sha256: verified.value.assessmentInput.sha256,
            }),
            null,
            2,
          )}\n`,
        );
        relativePath = "methodology/run-methodology.json";
        filename = "run-methodology.json";
      } else if (source.asset === "indicator_census") {
        content = new TextEncoder().encode(
          `${JSON.stringify(canonicalIndicatorCensus(), null, 2)}\n`,
        );
        filename = `${DAMM_MODEL_IDENTITY.modelId}-v${DAMM_MODEL_IDENTITY.version}-indicator-census.json`;
        relativePath = `methodology/${filename}`;
        if (
          createHash("sha256").update(content).digest("hex") !==
          DAMM_MODEL_EXPORT.runtime.indicator_census.sha256
        ) {
          throw new Error("The generated indicator census does not match the model manifest.");
        }
      } else {
        content = new Uint8Array(await readFile(methodologyAssetPath(source.asset)));
        const modelBasename = `${DAMM_MODEL_IDENTITY.modelId}-v${DAMM_MODEL_IDENTITY.version}`;
        const names = {
          export_manifest: "damm-model-export.json",
          model: `${modelBasename}-model.json`,
          schema: `${modelBasename}-model.schema.json`,
        } as const;
        filename = names[source.asset];
        relativePath = `methodology/${filename}`;
        const digest = createHash("sha256").update(content).digest("hex");
        if (
          (source.asset === "model" && digest !== DAMM_MODEL_IDENTITY.modelSha256) ||
          (source.asset === "schema" && digest !== DAMM_MODEL_IDENTITY.schemaSha256)
        ) {
          throw new Error(`The app-owned ${source.asset} bytes drifted after startup.`);
        }
        if (source.asset === "export_manifest") {
          const parsed = JSON.parse(new TextDecoder().decode(content));
          if (JSON.stringify(parsed) !== JSON.stringify(DAMM_MODEL_EXPORT)) {
            throw new Error("The app-owned model export manifest drifted after startup.");
          }
        }
      }
      addArtifact(
        {
          key: link.key,
          relativePath,
          filename,
          contentType: link.contentType,
          sha256: createHash("sha256").update(content).digest("hex"),
          content,
        },
        link.label,
      );
      continue;
    }
    if (source?.kind === "package") {
      const matches = archive.index.records.filter((record) =>
        matchesPackageSelector(record, source.selector),
      );
      if (matches.length !== 1) {
        throw new Error(`The verified workflow does not expose ${link.label}.`);
      }
      const packageRecord = matches[0];
      const content = archive.content.get(packageRecord.path);
      if (!content || usedPackagePaths.has(packageRecord.path)) {
        throw new Error(`The verified workflow package duplicates ${link.label}.`);
      }
      usedPackagePaths.add(packageRecord.path);
      addArtifact(
        {
          key: link.key,
          relativePath: packageRecord.path,
          filename: path.posix.basename(packageRecord.path),
          contentType: link.contentType,
          sha256: packageRecord.sha256,
          content,
        },
        link.label,
      );
      continue;
    }

    const found = artifactPath(run, link.key);
    if (!found) throw new Error(`The verified workflow does not expose ${link.label}.`);
    const relativePath = path.relative(root, found.path).split(path.sep).join("/");
    if (!relativePath || relativePath.startsWith("../") || path.posix.isAbsolute(relativePath)) {
      throw new Error(`The canonical artifact ${link.key} is outside the workflow workspace.`);
    }
    const content = new Uint8Array(await readFile(found.path));
    const limit = link.key === "bundle" ? MAX_WORKFLOW_BUNDLE_BYTES : MAX_WORKFLOW_ARTIFACT_BYTES;
    addArtifact(
      {
        key: link.key,
        relativePath,
        filename: path.basename(found.path),
        contentType: link.contentType,
        sha256: createHash("sha256").update(content).digest("hex"),
        content,
      },
      link.label,
      limit,
    );
  }

  // Stage 8 may add further hash-bound inputs (for example uploaded originals and their
  // extracted UTF-8 text). Persist those bytes as well so a completed run never depends
  // on the worker's local filesystem, even when they are reached only through the bundle.
  for (const packageRecord of archive.index.records) {
    if (usedPackagePaths.has(packageRecord.path)) continue;
    const content = archive.content.get(packageRecord.path);
    if (!content) throw new Error(`The DAR bundle is missing ${packageRecord.path}.`);
    const extension = path.posix.extname(packageRecord.path).slice(1).toLowerCase();
    addArtifact(
      {
        key: `package-file-${createHash("sha256").update(packageRecord.path).digest("hex").slice(0, 24)}`,
        relativePath: packageRecord.path,
        filename: path.posix.basename(packageRecord.path),
        contentType: CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
        sha256: packageRecord.sha256,
        content,
      },
      packageRecord.path,
    );
  }
  return records;
}

export interface PassOutput {
  rows: Record<string, Record<string, unknown>>;
  /** Which file it came from — a partial pass is read from its checkpoint. */
  from: "input" | "state";
  complete: boolean;
}

export async function readPassRows(run: Run): Promise<PassOutput | null> {
  const { input, state } = passFilePaths(run);
  try {
    return { rows: JSON.parse(await readFile(input, "utf8")), from: "input", complete: true };
  } catch {
    // No engine input. For a research pass the checkpoint still holds the rows it reached.
  }
  if (run.pass !== "research") return null;
  try {
    const parsed = JSON.parse(await readFile(state, "utf8"));
    const rows = parsed?.rows;
    if (!rows || typeof rows !== "object") return null;
    return { rows, from: "state", complete: false };
  } catch {
    return null;
  }
}

/**
 * The prefix a pass's own files carry. Research writes under the bare basename and every
 * later pass suffixes it with its own name, so one assessment's files group together and
 * no two passes can overwrite each other's ledger.
 */
function ledgerName(run: Run): string {
  if (run.pass === "research") return run.outBasename;
  if (run.pass === "g2") return `${run.outBasename}_automated_challenge`;
  return `${run.outBasename}_${run.pass}`;
}

/** What to record about vendors that were unavailable during a run. */
export function degradationNotes(
  degraded: Map<string, { rows: Set<string>; example: string }>,
  rowsTotal: number | null,
): string[] {
  const out: string[] = [];
  for (const [vendor, { rows, example }] of degraded) {
    const scope =
      rowsTotal && rows.size >= rowsTotal
        ? "every row"
        : `${rows.size} row${rows.size === 1 ? "" : "s"}${rowsTotal ? ` of ${rowsTotal}` : ""}`;
    out.push(
      `${vendor} was unavailable for ${scope}, so those rows were researched without it: ${example}`,
    );
  }
  return out;
}

/** Follow one claimed run to its end. Returns the status it settled on. */
export async function runOne(run: ClaimedRun, workerId: string, deps: WorkerDeps): Promise<string> {
  if (isSimulationIdentity(run)) {
    throw new Error("Simulation identities cannot enter the production worker.");
  }
  const seen = {
    exhausted: false,
    incomplete: false,
    finished: false,
    failure: null as string | null,
  };
  // Which vendors went missing, and on how many rows. A pass that lost its discovery peer
  // on every row gathered its evidence on a narrower base than the method describes, and
  // that has to reach the run record rather than living only in the pipeline's own files.
  const degraded = new Map<string, { rows: Set<string>; example: string }>();
  if (run.pass === "workflow") {
    if (!deps.prepareWorkflowInputs) {
      throw new Error("The worker cannot materialize the durable workflow input snapshot.");
    }
    if (!deps.reconcileCompletedStageArtifacts) {
      throw new Error("The worker cannot archive completed workflow stages.");
    }
    await deps.prepareWorkflowInputs(run);
    // A recovered coordinator skips already-complete stages and does not re-emit their
    // completion events. Reconcile before spending so those checkpointed bytes cannot be
    // lost merely because the preceding worker died after its atomic manifest write.
    await deps.reconcileCompletedStageArtifacts(run, workerId);
  }
  const proc = deps.spawnPipeline(run);

  // Both streams arrive in arbitrary chunks. They need independent buffers: otherwise
  // a partial JSON event and a traceback can splice into one synthetic, unparseable line.
  let stdoutBuf = "";
  let stderrBuf = "";
  const pump = (chunk: string, isErr: boolean) => {
    const buffered = (isErr ? stderrBuf : stdoutBuf) + chunk;
    const lines = buffered.split("\n");
    if (isErr) stderrBuf = lines.pop() ?? "";
    else stdoutBuf = lines.pop() ?? "";
    void handle(parseChunk(lines.join("\n"), run.pass === "workflow" ? run.id : undefined), isErr);
  };

  const pending: Promise<unknown>[] = [];
  let stageReconciliation = Promise.resolve();
  let stageReconciliationFailure: unknown = null;
  const queueStageReconciliation = (after?: Promise<unknown>) => {
    if (run.pass !== "workflow" || !deps.reconcileCompletedStageArtifacts) return;
    stageReconciliation = stageReconciliation.then(async () => {
      if (after) await after;
      try {
        await deps.reconcileCompletedStageArtifacts!(run, workerId);
        stageReconciliationFailure = null;
      } catch (error) {
        // A later checkpoint or the unconditional post-exit scan may repair a transient
        // storage failure. Preserve the latest error without rejecting an unobserved
        // stream callback promise.
        stageReconciliationFailure = error;
      }
    });
  };
  const handle = (events: RunEvent[], isErr: boolean) => {
    for (const e of events) {
      switch (e.kind) {
        case "start":
          pending.push(
            deps.store.setRowsTotal(run.id, workerId, run.claimToken, e.rowsTotal, e.vendor),
          );
          break;
        case "row":
          {
            const recorded = deps.store.recordRow(run.id, workerId, run.claimToken, e);
            pending.push(recorded);
            if (
              run.pass === "workflow" &&
              e.outcome === "complete" &&
              CANONICAL_STAGE_IDS.includes(e.indicatorId as DarWorkflowStageId)
            ) {
              // The coordinator checkpoints the root manifest before emitting this
              // event. Scan the filesystem proof; never trust stdout's artifact list.
              queueStageReconciliation(recorded);
            }
          }
          break;
        case "exhausted":
          seen.exhausted = true;
          pending.push(deps.store.noteEvent(run.id, workerId, run.claimToken, "note", e.message));
          break;
        case "incomplete":
          seen.incomplete = true;
          pending.push(deps.store.noteEvent(run.id, workerId, run.claimToken, "note", e.message));
          break;
        case "finished":
          seen.finished = true;
          pending.push(deps.store.noteEvent(run.id, workerId, run.claimToken, "note", e.message));
          break;
        case "note":
          pending.push(deps.store.noteEvent(run.id, workerId, run.claimToken, "note", e.message));
          break;
        case "degraded": {
          const entry = degraded.get(e.vendor) ?? { rows: new Set<string>(), example: e.message };
          entry.rows.add(e.indicatorId);
          degraded.set(e.vendor, entry);
          break;
        }
        case "failed":
          // Only stderr counts as a failure signal: the word "Error" can legitimately
          // appear in a search trail on stdout.
          if (isErr || e.authoritative) seen.failure = e.message;
          break;
      }
    }
  };

  proc.onStdout((c) => pump(c, false));
  proc.onStderr((c) => pump(c, true));

  const beat = setInterval(() => {
    void deps.store.heartbeat(run.id, workerId, run.claimToken).then((held) => {
      // The claim was taken, which means this worker was presumed dead. Stop rather
      // than run alongside whatever took over and spend the budget twice.
      if (!held) proc.kill();
    });
  }, deps.heartbeatMs ?? HEARTBEAT_MS);

  let code: number | null = null;
  try {
    code = await proc.wait();
  } finally {
    clearInterval(beat);
  }

  const expectedWorkflowRunId = run.pass === "workflow" ? run.id : undefined;
  if (stdoutBuf.trim()) handle(parseChunk(stdoutBuf, expectedWorkflowRunId), false);
  if (stderrBuf.trim()) handle(parseChunk(stderrBuf, expectedWorkflowRunId), true);
  await Promise.allSettled(pending);
  await stageReconciliation;

  if (run.pass === "workflow" && deps.reconcileCompletedStageArtifacts) {
    try {
      // Unconditional: catches a process that exited after an atomic stage checkpoint
      // but before stdout delivered its stage_complete event.
      await deps.reconcileCompletedStageArtifacts(run, workerId);
      stageReconciliationFailure = null;
    } catch (error) {
      stageReconciliationFailure = error;
    }
    if (stageReconciliationFailure) {
      const archiveFailure =
        `Verified completed-stage downloads could not be archived: ${String(stageReconciliationFailure)}`;
      seen.failure = seen.failure ? `${seen.failure} ${archiveFailure}` : archiveFailure;
      seen.finished = false;
    }
  }

  if (run.pass === "workflow" && seen.finished) {
    const verified =
      deps.verifyWorkflow?.(run) ??
      (() => {
        const result = verifyWorkflowCompletion(run);
        return result.ok ? ({ ok: true } as const) : result;
      })();
    if (!verified.ok) {
      seen.finished = false;
      seen.failure = `The coordinator reported completion, but its output failed verification: ${verified.reason}`;
    } else if (!deps.publishWorkflowArtifacts) {
      seen.finished = false;
      seen.failure = "The worker has no shared artifact publisher for this completed workflow.";
    } else {
      try {
        await deps.publishWorkflowArtifacts(run, workerId);
      } catch (error) {
        seen.finished = false;
        seen.failure = `The verified Stage 8 Draft downloads could not be made available: ${String(error)}`;
      }
    }
  }

  const { status, reason } = statusOnExit(code, seen, {
    budgetExhaustion: run.pass === "workflow" ? "terminal" : "resumable",
  });
  const notes = degradationNotes(degraded, run.rowsTotal);
  for (const note of notes) {
    await deps.store.noteEvent(run.id, workerId, run.claimToken, "degraded", note);
  }

  const ledger = await deps.readLedger(run);
  // Carried on a finished run too. "Finished 59 of 59 rows" with a vendor down for every
  // one of them is the shape of a clean success that was not one.
  const full = [reason, ...notes].filter(Boolean).join(" ");
  await deps.store.finishRun(run.id, workerId, run.claimToken, status, full, ledger ?? undefined);
  return status;
}

/**
 * Claim and run until nothing is queued. Returns how many runs it handled, so a caller
 * can decide whether to wait before asking again.
 */
export async function drain(
  workerId: string,
  deps: WorkerDeps = defaultDeps(),
  shouldStop: () => boolean = () => false,
): Promise<number> {
  let handled = 0;
  for (;;) {
    // A process-level stop request means "finish the claim already held, then leave".
    // Checking here, between claims, prevents a graceful shutdown from taking another
    // country merely because it arrived while the current country was running.
    if (shouldStop()) return handled;
    const run = await deps.store.claimNextRun(workerId);
    if (!run) return handled;
    // A stop can arrive while the atomic database claim itself is in flight. Give that
    // exact token back before doing any pipeline work; a different or replayed token
    // cannot release somebody else's claim.
    if (shouldStop()) {
      await deps.store.releaseClaim(run.id, workerId, run.claimToken);
      return handled;
    }
    handled++;
    try {
      await runOne(run, workerId, deps);
    } catch (err) {
      // A throw here is the worker's own fault rather than the pipeline's, and leaving
      // the run marked running would strand it until the lease expired.
      await deps.store.finishRun(
        run.id,
        workerId,
        run.claimToken,
        "failed",
        `The worker failed: ${String(err)}`,
      );
    }
  }
}
