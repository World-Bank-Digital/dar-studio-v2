/**
 * Progressive publication of completed canonical workflow stages.
 *
 * One reconciliation operation owns the difficult boundary: it accepts only the
 * canonical completed prefix in the coordinator's root manifest, verifies every stage
 * manifest and every exact byte under the isolated worker workspace, then appends those
 * bytes to immutable Postgres storage while the current worker still holds its claim.
 * Web callers see only that archive; they never depend on the worker filesystem.
 */
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { getSql, type Sql } from "../db.ts";
import {
  MAX_WORKFLOW_ARTIFACT_BYTES,
  MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES,
} from "./artifact-limits.ts";
import { DAMM_WORKFLOW_METHODOLOGY, methodologyMatchesCanonical } from "./methodology.ts";
import { workflowMethodologySnapshot } from "./run-store.ts";
import type { ClaimedRun } from "./runs.ts";
import { isSimulationIdentity, workflowRunDir } from "./worker.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256, type DarWorkflowStageId } from "./workflow.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_ROOT_STATUSES = new Set(["running", "retrying", "failed", "complete"]);
const MAX_CONTROL_FILE_BYTES = 5 * 1024 * 1024;

interface ArtifactRecord {
  key: string;
  path: string;
  sha256: string;
  mediaType: string;
  byteSize: number;
}

interface CompletedStageWrite {
  stageId: DarWorkflowStageId;
  stageOrdinal: number;
  stageTitle: string;
  completedAt: Date;
  stageManifestSha256: string;
  inputSnapshotSha256: string;
  artifacts: CompletedStageArtifactWrite[];
}

interface CompletedStageArtifactWrite {
  artifactId: string;
  key: string;
  relativePath: string;
  filename: string;
  contentType: string;
  sha256: string;
  byteSize: number;
}

export interface CompletedStageArtifactMetadata {
  runId: string;
  stageId: DarWorkflowStageId;
  stageOrdinal: number;
  stageTitle: string;
  stageCompletedAt: Date;
  artifactId: string;
  key: string;
  relativePath: string;
  filename: string;
  contentType: string;
  sha256: string;
  byteSize: number;
}

export interface CompletedStageArtifactDownload extends CompletedStageArtifactMetadata {
  content: Uint8Array;
}

export interface CompletedStageReconciliation {
  publishedStageIds: DarWorkflowStageId[];
  alreadyPublishedStageIds: DarWorkflowStageId[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function safeDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function safeWorkspaceRoot(run: ClaimedRun): Promise<string | null> {
  const candidate = path.resolve(workflowRunDir(run));
  const loopRoot = path.resolve(
    path.dirname(workflowRunDir({ outBasename: "__canonical_workflow_child__" })),
  );
  if (path.dirname(candidate) !== loopRoot) return null;
  try {
    const rootStat = await lstat(candidate);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
    const canonicalParent = await realpath(loopRoot);
    const canonicalRoot = await realpath(candidate);
    return canonicalRoot.startsWith(`${canonicalParent}${path.sep}`) ? canonicalRoot : null;
  } catch {
    return null;
  }
}

function lexicalWorkspaceFile(root: string, relative: unknown): string | null {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative) ||
    relative.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return null;
  }
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, ...relative.split("/"));
  if (!candidate.startsWith(`${absoluteRoot}${path.sep}`)) return null;
  return candidate;
}

async function readWorkspaceFile(
  root: string,
  relative: unknown,
  maxBytes: number,
): Promise<{ filename: string; content: Uint8Array } | null> {
  const absoluteRoot = path.resolve(root);
  const candidate = lexicalWorkspaceFile(root, relative);
  if (!candidate) return null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const canonicalRoot = await realpath(absoluteRoot);
    handle = await open(
      candidate,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!before.isFile() || before.size < 0 || before.size > maxBytes) return null;

    // Validate containment and file identity after opening. If any parent was
    // swapped to a symlink before open, realpath resolves outside and is rejected;
    // if the path changes after open, the descriptor remains bound to the original
    // file and the lstat identity check fails closed.
    const canonicalCandidate = await realpath(candidate);
    if (!canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) return null;
    const pathStat = await lstat(candidate);
    if (
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      pathStat.dev !== before.dev ||
      pathStat.ino !== before.ino
    ) {
      return null;
    }

    // Allocate only the size already accepted above. FileHandle.readFile performs
    // another fstat internally, so a concurrent grow between the bounded check and
    // that second stat could otherwise allocate beyond maxBytes. Positional reads
    // keep the descriptor bound to the validated inode and never follow path changes.
    const content = new Uint8Array(before.size);
    let offset = 0;
    while (offset < content.byteLength) {
      const { bytesRead } = await handle.read(content, offset, content.byteLength - offset, offset);
      if (bytesRead === 0) return null;
      offset += bytesRead;
    }
    const growthProbe = new Uint8Array(1);
    const { bytesRead: extraBytes } = await handle.read(growthProbe, 0, 1, before.size);
    const after = await handle.stat();
    if (
      extraBytes !== 0 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      offset !== before.size
    ) {
      return null;
    }
    return { filename: canonicalCandidate, content };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readBoundFile(
  root: string,
  relative: unknown,
  expectedSha256: unknown,
  maxBytes: number,
): Promise<{ filename: string; content: Uint8Array } | null> {
  if (typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)) return null;
  const bound = await readWorkspaceFile(root, relative, maxBytes);
  return bound && digest(bound.content) === expectedSha256 ? bound : null;
}

function outputHashes(value: unknown): Map<string, string[]> | null {
  const result = new Map<string, string[]>();
  const add = (key: unknown, sha256: unknown) => {
    if (typeof key !== "string" || typeof sha256 !== "string" || !SHA256.test(sha256)) {
      return;
    }
    result.set(key, [...(result.get(key) ?? []), sha256]);
  };
  const record = object(value);
  if (record) {
    for (const [key, candidate] of Object.entries(record)) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) add(key, object(item)?.sha256 ?? item);
      } else {
        add(key, object(candidate)?.sha256 ?? candidate);
      }
    }
    return result;
  }
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    const item = object(candidate);
    if (item) add(item.key ?? item.artifact_id ?? item.id, item.sha256);
  }
  return result;
}

function artifactMultiset(
  records: Array<Pick<ArtifactRecord, "key" | "sha256">>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const record of records) {
    result.set(record.key, [...(result.get(record.key) ?? []), record.sha256]);
  }
  return result;
}

function sameArtifactMultiset(
  left: Map<string, string[]> | null,
  right: Map<string, string[]>,
): boolean {
  if (!left || left.size !== right.size) return false;
  for (const [key, expected] of right) {
    const actual = left.get(key);
    if (!actual || [...actual].sort().join("\n") !== [...expected].sort().join("\n")) return false;
  }
  return true;
}

function stageManifestAccepts(
  value: unknown,
  run: ClaimedRun,
  stageId: string,
  ordinal: number,
  inputSnapshotSha256: string,
  artifacts: ArtifactRecord[],
): boolean {
  const manifest = object(value);
  if (!manifest) return false;
  const outputArtifacts = artifacts.filter((artifact) => artifact.key !== "stage_manifest");
  const internalArtifacts = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.flatMap((candidate) => {
        const artifact = object(candidate);
        return artifact &&
          typeof artifact.key === "string" &&
          typeof artifact.sha256 === "string" &&
          SHA256.test(artifact.sha256)
          ? [{ key: artifact.key, sha256: artifact.sha256 }]
          : [];
      })
    : [];
  const quality = object(manifest.quality_checks);
  const checks = quality ? Object.values(quality) : manifest.quality_checks;
  return (
    DAR_WORKFLOW.stage_manifest_required_fields.every((field) =>
      Object.prototype.hasOwnProperty.call(manifest, field),
    ) &&
    manifest.schema_version === "damm.workflow-stage/v1" &&
    manifest.workflow_id === DAR_WORKFLOW.workflow_id &&
    manifest.workflow_version === DAR_WORKFLOW.workflow_version &&
    manifest.run_id === run.id &&
    manifest.stage_id === stageId &&
    manifest.ordinal === ordinal &&
    manifest.status === "complete" &&
    typeof manifest.execution_mode === "string" &&
    Boolean(manifest.execution_mode.trim()) &&
    typeof manifest.spend_usd === "number" &&
    Number.isFinite(manifest.spend_usd) &&
    manifest.spend_usd >= 0 &&
    object(manifest.input_hashes)?.input_snapshot === inputSnapshotSha256 &&
    object(manifest.input_snapshot)?.sha256 === inputSnapshotSha256 &&
    (object(manifest.quality_checks) !== null || Array.isArray(manifest.quality_checks)) &&
    Array.isArray(checks) &&
    checks.every((candidate) => object(candidate)?.ok !== false && candidate !== false) &&
    manifest.source_inventory !== null &&
    manifest.source_inventory !== undefined &&
    internalArtifacts.length === outputArtifacts.length &&
    sameArtifactMultiset(artifactMultiset(internalArtifacts), artifactMultiset(outputArtifacts)) &&
    sameArtifactMultiset(outputHashes(manifest.output_hashes), artifactMultiset(outputArtifacts))
  );
}

async function parseArtifact(root: string, value: unknown): Promise<ArtifactRecord | null> {
  const record = object(value);
  if (
    !record ||
    typeof record.key !== "string" ||
    !record.key.trim() ||
    typeof record.path !== "string" ||
    typeof record.sha256 !== "string" ||
    !SHA256.test(record.sha256) ||
    typeof record.media_type !== "string" ||
    !record.media_type.trim()
  ) {
    return null;
  }
  const bound = await readBoundFile(root, record.path, record.sha256, MAX_WORKFLOW_ARTIFACT_BYTES);
  if (!bound) return null;
  return {
    key: record.key,
    path: record.path,
    sha256: record.sha256,
    mediaType: record.media_type,
    byteSize: bound.content.byteLength,
  };
}

async function collectCompletedStages(run: ClaimedRun): Promise<CompletedStageWrite[]> {
  if (run.pass !== "workflow" || isSimulationIdentity(run)) {
    throw new Error("Simulation or non-workflow runs cannot publish completed stages.");
  }
  const root = await safeWorkspaceRoot(run);
  if (!root) throw new Error("The workflow workspace is not a real isolated directory.");
  const rootManifest = await readWorkspaceFile(
    root,
    "workflow-manifest.json",
    MAX_CONTROL_FILE_BYTES,
  );
  if (!rootManifest) return [];
  let manifest: Record<string, unknown>;
  try {
    const parsed = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rootManifest.content)),
    );
    if (!parsed) throw new Error("root is not an object");
    manifest = parsed;
  } catch (error) {
    throw new Error(`The workflow manifest cannot be read: ${String(error)}`);
  }
  if (
    manifest.schema_version !== "damm.workflow-run/v1" ||
    manifest.run_id !== run.id ||
    manifest.workflow_id !== DAR_WORKFLOW.workflow_id ||
    manifest.workflow_version !== DAR_WORKFLOW.workflow_version ||
    manifest.contract_sha256 !== DAR_WORKFLOW_SHA256 ||
    manifest.country !== run.countryName ||
    manifest.iso3 !== run.iso3.toUpperCase() ||
    !ALLOWED_ROOT_STATUSES.has(String(manifest.status)) ||
    manifest.simulation_provenance !== undefined
  ) {
    throw new Error("The workflow manifest does not identify this canonical run.");
  }

  const snapshot = object(manifest.input_snapshot);
  const snapshotBound = snapshot
    ? await readBoundFile(root, snapshot.path, snapshot.sha256, MAX_CONTROL_FILE_BYTES)
    : null;
  if (!snapshot || !snapshotBound || typeof snapshot.sha256 !== "string") {
    throw new Error("The immutable workflow input snapshot failed verification.");
  }
  let snapshotValue: Record<string, unknown>;
  try {
    const parsed = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshotBound.content)),
    );
    if (!parsed) throw new Error("snapshot is not an object");
    snapshotValue = parsed;
  } catch (error) {
    throw new Error(`The immutable workflow input snapshot cannot be parsed: ${String(error)}`);
  }
  if (
    snapshotValue.schema_version !== "damm.workflow-input-snapshot/v1" ||
    snapshotValue.country !== run.countryName ||
    snapshotValue.iso3 !== run.iso3.toUpperCase() ||
    snapshotValue.contract_sha256 !== DAR_WORKFLOW_SHA256 ||
    snapshotValue.ceiling_usd !== run.ceilingUsd ||
    !("vendor" in snapshotValue) ||
    (snapshotValue.vendor ?? null) !== run.vendor ||
    !jsonEqual(snapshotValue.uploads_manifest, manifest.uploads_manifest)
  ) {
    throw new Error("The immutable input snapshot is not bound to this workflow run.");
  }
  const uploads = object(manifest.uploads_manifest);
  if (
    !uploads ||
    typeof uploads.document_count !== "number" ||
    !Number.isInteger(uploads.document_count) ||
    uploads.document_count < 0 ||
    !(await readBoundFile(root, uploads.path, uploads.sha256, MAX_CONTROL_FILE_BYTES))
  ) {
    throw new Error("The frozen uploads manifest failed verification.");
  }
  if (!Array.isArray(manifest.stages) || manifest.stages.length !== DAR_WORKFLOW.stages.length) {
    throw new Error("The workflow manifest does not contain the canonical stage sequence.");
  }

  const completed: CompletedStageWrite[] = [];
  let encounteredIncomplete = false;
  let totalBytes = 0;
  for (const [index, contractStage] of DAR_WORKFLOW.stages.entries()) {
    const stage = object(manifest.stages[index]);
    if (!stage || stage.id !== contractStage.id || stage.ordinal !== contractStage.ordinal) {
      throw new Error(`Canonical stage ${contractStage.ordinal} has invalid identity.`);
    }
    if (stage.status !== "complete") {
      encounteredIncomplete = true;
      continue;
    }
    if (encounteredIncomplete) {
      throw new Error("The workflow manifest contains a non-canonical completed-stage gap.");
    }
    if (contractStage.id === "export_package") continue;
    if (!Array.isArray(stage.artifacts)) {
      throw new Error(`Canonical stage ${contractStage.ordinal} has no artifact records.`);
    }
    const valid: ArtifactRecord[] = [];
    for (const value of stage.artifacts) {
      const artifact = await parseArtifact(root, value);
      if (!artifact) {
        throw new Error(`Canonical stage ${contractStage.ordinal} has an invalid artifact record.`);
      }
      totalBytes += artifact.byteSize;
      if (totalBytes > MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES) {
        throw new Error("The completed-stage archive exceeds its bounded storage limit.");
      }
      valid.push(artifact);
    }
    const keys = new Set(valid.map((artifact) => artifact.key));
    if (contractStage.required_artifacts.some((key) => !keys.has(key))) {
      throw new Error(`Canonical stage ${contractStage.ordinal} is missing a required artifact.`);
    }
    const stageManifests = valid.filter((artifact) => artifact.key === "stage_manifest");
    if (stageManifests.length !== 1) {
      throw new Error(`Canonical stage ${contractStage.ordinal} has no unique stage manifest.`);
    }
    let stageManifestValue: unknown;
    try {
      const stageManifestBound = await readBoundFile(
        root,
        stageManifests[0].path,
        stageManifests[0].sha256,
        MAX_CONTROL_FILE_BYTES,
      );
      if (!stageManifestBound) throw new Error("stage manifest bytes changed");
      stageManifestValue = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(stageManifestBound.content),
      );
    } catch (error) {
      throw new Error(
        `Canonical stage ${contractStage.ordinal} manifest cannot be parsed: ${String(error)}`,
      );
    }
    if (
      !stageManifestAccepts(
        stageManifestValue,
        run,
        contractStage.id,
        contractStage.ordinal,
        snapshot.sha256,
        valid,
      )
    ) {
      throw new Error(`Canonical stage ${contractStage.ordinal} manifest failed verification.`);
    }
    const completedAt = safeDate(stage.completed_at);
    if (!completedAt) {
      throw new Error(`Canonical stage ${contractStage.ordinal} has no completion timestamp.`);
    }
    const writes = valid.map((artifact): CompletedStageArtifactWrite => {
      const artifactId = createHash("sha256")
        .update(
          `${contractStage.id}\0${artifact.key}\0${artifact.path}\0${artifact.mediaType}`,
          "utf8",
        )
        .digest("hex");
      return {
        artifactId,
        key: artifact.key,
        relativePath: artifact.path,
        filename: path.posix.basename(artifact.path),
        contentType: artifact.mediaType,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
      };
    });
    completed.push({
      stageId: contractStage.id,
      stageOrdinal: contractStage.ordinal,
      stageTitle: contractStage.title,
      completedAt,
      stageManifestSha256: stageManifests[0].sha256,
      inputSnapshotSha256: snapshot.sha256,
      artifacts: writes,
    });
  }
  return completed;
}

interface ExistingPublicationRow {
  stage_manifest_sha256: string;
  input_snapshot_sha256: string;
  artifact_count: number;
  completed_at: Date;
}

interface ExistingArtifactRow {
  artifact_id: string;
  artifact_key: string;
  relative_path: string;
  filename: string;
  content_type: string;
  sha256: string;
  byte_size: number;
}

function sameStoredArtifacts(
  rows: ExistingArtifactRow[],
  expected: CompletedStageArtifactWrite[],
): boolean {
  if (rows.length !== expected.length) return false;
  const byId = new Map(expected.map((artifact) => [artifact.artifactId, artifact]));
  return rows.every((row) => {
    const artifact = byId.get(row.artifact_id);
    return Boolean(
      artifact &&
      row.artifact_key === artifact.key &&
      row.relative_path === artifact.relativePath &&
      row.filename === artifact.filename &&
      row.content_type === artifact.contentType &&
      row.sha256 === artifact.sha256 &&
      Number(row.byte_size) === artifact.byteSize,
    );
  });
}

async function publishStage(
  run: ClaimedRun,
  workerId: string,
  stage: CompletedStageWrite,
  sql: Sql,
): Promise<"published" | "already_published"> {
  const root = await safeWorkspaceRoot(run);
  if (!root) throw new Error("The workflow workspace changed before stage publication.");
  return sql.transaction(async (transaction) => {
    const held = await transaction<{ id: string }>`
      select id from runs
      where id = ${run.id} and pass = 'workflow' and status = 'running'
        and claimed_by = ${workerId} and claim_token = ${run.claimToken}
      for update`;
    if (!held.length) throw new Error("The workflow claim was lost before stage publication.");
    const methodology = await workflowMethodologySnapshot(run.id, transaction);
    if (!methodology || !methodologyMatchesCanonical(methodology)) {
      throw new Error("The workflow methodology changed before stage publication.");
    }

    const existing = await transaction<ExistingPublicationRow>`
      select stage_manifest_sha256, input_snapshot_sha256, artifact_count, completed_at
      from workflow_stage_publications
      where run_id = ${run.id} and stage_id = ${stage.stageId}`;
    if (existing.length) {
      const rows = await transaction<ExistingArtifactRow>`
        select artifact_id, artifact_key, relative_path, filename, content_type, sha256, byte_size
        from workflow_stage_artifacts
        where run_id = ${run.id} and stage_id = ${stage.stageId}
        order by artifact_id`;
      const publication = existing[0];
      if (
        publication.stage_manifest_sha256 !== stage.stageManifestSha256 ||
        publication.input_snapshot_sha256 !== stage.inputSnapshotSha256 ||
        Number(publication.artifact_count) !== stage.artifacts.length ||
        new Date(publication.completed_at).getTime() !== stage.completedAt.getTime() ||
        !sameStoredArtifacts(rows, stage.artifacts)
      ) {
        throw new Error(
          `Completed stage ${stage.stageOrdinal} conflicts with its immutable publication.`,
        );
      }
      return "already_published";
    }

    const preceding = await transaction<{ stage_id: string; stage_ordinal: number }>`
      select stage_id, stage_ordinal from workflow_stage_publications
      where run_id = ${run.id} order by stage_ordinal`;
    const expectedPrior = DAR_WORKFLOW.stages
      .slice(0, stage.stageOrdinal - 1)
      .map((item) => item.id);
    if (
      preceding.length !== expectedPrior.length ||
      preceding.some(
        (item, index) =>
          item.stage_id !== expectedPrior[index] || Number(item.stage_ordinal) !== index + 1,
      )
    ) {
      throw new Error(
        `Completed stage ${stage.stageOrdinal} cannot publish before its canonical prefix.`,
      );
    }

    const canonical = DAMM_WORKFLOW_METHODOLOGY;
    await transaction`
      insert into workflow_stage_publications
        (run_id, stage_id, stage_ordinal, stage_title, completed_at,
         stage_manifest_sha256, input_snapshot_sha256, artifact_count,
         workflow_id, workflow_version, workflow_contract_sha256,
         damm_model_version, damm_model_revision, damm_model_sha256, damm_source_commit)
      values
         (${run.id}, ${stage.stageId}, ${stage.stageOrdinal}, ${stage.stageTitle},
         ${stage.completedAt}, ${stage.stageManifestSha256}, ${stage.inputSnapshotSha256},
         ${stage.artifacts.length}, ${DAR_WORKFLOW.workflow_id}, ${DAR_WORKFLOW.workflow_version},
         ${DAR_WORKFLOW_SHA256}, ${canonical.modelVersion}, ${canonical.modelRevision},
         ${canonical.appModelSha256}, ${canonical.sourceCommit})`;
    for (const artifact of stage.artifacts) {
      const rebound = await readBoundFile(
        root,
        artifact.relativePath,
        artifact.sha256,
        MAX_WORKFLOW_ARTIFACT_BYTES,
      );
      if (!rebound || rebound.content.byteLength !== artifact.byteSize) {
        throw new Error(`Completed stage ${stage.stageOrdinal} changed before storage.`);
      }
      const content = Buffer.from(rebound.content);
      await transaction`
        insert into workflow_stage_artifacts
          (run_id, stage_id, artifact_id, artifact_key, relative_path, filename,
           content_type, sha256, byte_size, content_verified_at, content)
        values
          (${run.id}, ${stage.stageId}, ${artifact.artifactId}, ${artifact.key},
           ${artifact.relativePath}, ${artifact.filename}, ${artifact.contentType},
           ${artifact.sha256}, ${artifact.byteSize}, now(), ${content})`;
    }
    return "published";
  });
}

/** Verify and append every completed Stage 1-7 prefix member not already published. */
export async function reconcileCompletedStageArtifacts(
  run: ClaimedRun,
  workerId: string,
  database?: Sql,
): Promise<CompletedStageReconciliation> {
  const sql = database ?? (await getSql());
  const stages = await collectCompletedStages(run);
  const result: CompletedStageReconciliation = {
    publishedStageIds: [],
    alreadyPublishedStageIds: [],
  };
  for (const stage of stages) {
    const outcome = await publishStage(run, workerId, stage, sql);
    result[outcome === "published" ? "publishedStageIds" : "alreadyPublishedStageIds"].push(
      stage.stageId,
    );
  }
  return result;
}

interface ArtifactMetadataRow {
  run_id: string;
  stage_id: DarWorkflowStageId;
  stage_ordinal: number;
  stage_title: string;
  completed_at: Date;
  artifact_id: string;
  artifact_key: string;
  relative_path: string;
  filename: string;
  content_type: string;
  sha256: string;
  byte_size: number;
}

function metadata(row: ArtifactMetadataRow): CompletedStageArtifactMetadata {
  return {
    runId: row.run_id,
    stageId: row.stage_id,
    stageOrdinal: Number(row.stage_ordinal),
    stageTitle: row.stage_title,
    stageCompletedAt: new Date(row.completed_at),
    artifactId: row.artifact_id,
    key: row.artifact_key,
    relativePath: row.relative_path,
    filename: row.filename,
    contentType: row.content_type,
    sha256: row.sha256,
    byteSize: Number(row.byte_size),
  };
}

const CATALOG_SQL = `
  select publication.run_id, publication.stage_id, publication.stage_ordinal,
         publication.stage_title, publication.completed_at,
         artifact.artifact_id, artifact.artifact_key, artifact.relative_path,
         artifact.filename, artifact.content_type, artifact.sha256, artifact.byte_size
  from runs workflow_run
  join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
  join workflow_stage_publications publication on publication.run_id = workflow_run.id
  join workflow_stage_artifacts artifact
    on artifact.run_id = publication.run_id and artifact.stage_id = publication.stage_id
  where workflow_run.id = $1 and workflow_run.user_id = $2 and workflow_run.pass = 'workflow'
    and publication.workflow_id = $3
    and publication.workflow_version = $4
    and publication.workflow_contract_sha256 = $5
    and publication.damm_model_version = methodology.model_version
    and publication.damm_model_revision = methodology.model_revision
    and publication.damm_model_sha256 = methodology.app_model_sha256
    and publication.damm_source_commit = methodology.source_commit`;

/** List immutable completed-stage artifacts without loading their bytes. */
export async function listCompletedStageArtifacts(
  runId: string,
  userId: string,
  database?: Sql,
): Promise<CompletedStageArtifactMetadata[]> {
  const sql = database ?? (await getSql());
  const rows = await sql.query<ArtifactMetadataRow>(
    `${CATALOG_SQL} order by publication.stage_ordinal, artifact.artifact_key, artifact.artifact_id`,
    [runId, userId, DAR_WORKFLOW.workflow_id, DAR_WORKFLOW.workflow_version, DAR_WORKFLOW_SHA256],
  );
  return rows.map(metadata);
}

/** Resolve owner-scoped immutable metadata without hydrating the archived bytes. */
export async function getCompletedStageArtifactMetadata(
  runId: string,
  artifactId: string,
  userId: string,
  database?: Sql,
): Promise<CompletedStageArtifactMetadata | null> {
  if (!SHA256.test(artifactId)) return null;
  const sql = database ?? (await getSql());
  const rows = await sql.query<ArtifactMetadataRow>(
    `${CATALOG_SQL} and artifact.artifact_id = $6 limit 1`,
    [
      runId,
      userId,
      DAR_WORKFLOW.workflow_id,
      DAR_WORKFLOW.workflow_version,
      DAR_WORKFLOW_SHA256,
      artifactId,
    ],
  );
  return rows[0] ? metadata(rows[0]) : null;
}

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string" && /^\\x[0-9a-f]*$/i.test(value)) {
    return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  }
  return null;
}

/** Resolve one owner-scoped artifact and re-hash the exact stored bytes before delivery. */
export async function resolveCompletedStageArtifactDownload(
  runId: string,
  artifactId: string,
  userId: string,
  database?: Sql,
): Promise<CompletedStageArtifactDownload | null> {
  if (!SHA256.test(artifactId)) return null;
  const sql = database ?? (await getSql());
  const value = await getCompletedStageArtifactMetadata(runId, artifactId, userId, sql);
  if (!value) return null;
  const contentRows = await sql.query<{ content: unknown }>(
    `select content from workflow_stage_artifacts
     where run_id = $1 and artifact_id = $2 and sha256 = $3 limit 1`,
    [runId, artifactId, value.sha256],
  );
  const content = bytes(contentRows[0]?.content);
  if (!content || content.byteLength !== value.byteSize || digest(content) !== value.sha256) {
    return null;
  }
  return { ...value, content };
}
