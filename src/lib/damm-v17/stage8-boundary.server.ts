/**
 * Re-verify a published Stage 8 Draft using only immutable database bytes.
 *
 * This deliberately has no worker dependency: approval hosts must not trust the
 * worker filesystem, its completion flag, or a previously computed verification
 * timestamp when deciding whether a human review chain may be created.
 */
import { createHash } from "node:crypto";
import { posix as path } from "node:path";
import { isDeepStrictEqual } from "node:util";
import zlib from "node:zlib";

import {
  MAX_WORKFLOW_ARTIFACT_BYTES,
  MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES,
  MAX_WORKFLOW_BUNDLE_BYTES,
} from "./artifact-limits.ts";
import { DAMM_WORKFLOW_METHODOLOGY, runMethodologyManifest } from "./methodology.ts";
import { DAMM_MODEL_EXPORT } from "./model.ts";
import { artifactsFor, type WorkflowPackageSelector } from "./worker-artifacts.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "./workflow.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const PACKAGE_CATEGORIES = new Set([
  "input",
  "narrative",
  "structured",
  "source_inventory",
  "source_inventory_consolidated",
  "workflow",
]);
const OPTIONAL_UPLOAD_KINDS = new Set(DAR_WORKFLOW.optional_launch_inputs.map((input) => input.id));

export type Stage8BoundaryFailureCode =
  | "INVALID_RUN"
  | "INVALID_ARTIFACT_SET"
  | "INVALID_ARTIFACT_BYTES"
  | "INVALID_METHODOLOGY"
  | "INVALID_WORKFLOW_MANIFEST"
  | "INVALID_PACKAGE_MANIFEST"
  | "INVALID_PACKAGE_MAPPING"
  | "INVALID_ARCHIVE";

export class Stage8BoundaryVerificationError extends Error {
  readonly code: Stage8BoundaryFailureCode;

  constructor(code: Stage8BoundaryFailureCode, message: string) {
    super(message);
    this.name = "Stage8BoundaryVerificationError";
    this.code = code;
  }
}

/** Exact completed-run identity selected for approval. */
export interface CompletedWorkflowRunMetadata {
  runId: string;
  artifactSetId: string;
  pass: "workflow";
  status: "done";
  countryName: string;
  iso3: string;
  ceilingUsd: number;
  vendor: string | null;
  workflowId: string;
  workflowVersion: string;
  workflowContractSha256: string;
}

/** One row from the selected immutable `workflow_run_artifacts` set. */
export interface StoredWorkflowArtifact {
  runId: string;
  artifactSetId: string;
  artifactKey: string;
  relativePath: string;
  filename: string;
  contentType: string;
  sha256: string;
  byteSize: number;
  workflowId: string;
  workflowVersion: string;
  workflowContractSha256: string;
  content: Uint8Array;
}

export interface VerifiedStage8Boundary {
  runId: string;
  artifactSetId: string;
  bundleSha256: string;
  workflowManifestSha256: string;
  packageManifestSha256: string;
  assessmentInputArtifactKey: string;
  assessmentInputRelativePath: string;
  assessmentInputSourcePath: string;
  assessmentInputSha256: string;
  assessmentInputContent: Uint8Array;
  inputSnapshotSha256: string;
  artifactCount: number;
  packageFileCount: number;
}

interface PackageFileRecord {
  path: string;
  sha256: string;
  bytes: number;
  category: string;
  stageId?: string;
  artifactId?: string;
  sourceSha256?: string;
  inputId?: string;
  inputKind?: string;
}

interface StageArtifactRecord {
  key: string;
  path: string;
  sha256: string;
  mediaType: string;
}

interface ParsedWorkflowManifest {
  manifest: Record<string, unknown>;
  inputSnapshot: { path: string; sha256: string };
  assessmentInput: StageArtifactRecord;
  stageArtifacts: ReadonlyMap<string, ReadonlyMap<string, StageArtifactRecord>>;
  stage8: ReadonlyMap<string, StageArtifactRecord>;
}

function refuse(code: Stage8BoundaryFailureCode, message: string): never {
  throw new Stage8BoundaryVerificationError(code, message);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (path.isAbsolute(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJsonArtifact(
  artifact: StoredWorkflowArtifact,
  code: Stage8BoundaryFailureCode,
  label: string,
): Record<string, unknown> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.content);
    const parsed = record(JSON.parse(text));
    if (!parsed) refuse(code, `${label} must be a JSON object.`);
    return parsed;
  } catch (error) {
    if (error instanceof Stage8BoundaryVerificationError) throw error;
    return refuse(code, `${label} is not valid UTF-8 JSON.`);
  }
}

function validateRun(run: CompletedWorkflowRunMetadata): void {
  if (
    !run.runId.trim() ||
    !run.artifactSetId.trim() ||
    run.pass !== "workflow" ||
    run.status !== "done" ||
    !run.countryName.trim() ||
    !/^[A-Z]{3}$/.test(run.iso3) ||
    !Number.isFinite(run.ceilingUsd) ||
    run.ceilingUsd < 0 ||
    (run.vendor !== null &&
      (typeof run.vendor !== "string" || !run.vendor.trim() || run.vendor !== run.vendor.trim())) ||
    run.workflowId !== DAR_WORKFLOW.workflow_id ||
    run.workflowVersion !== DAR_WORKFLOW.workflow_version ||
    run.workflowContractSha256 !== DAR_WORKFLOW_SHA256
  ) {
    refuse("INVALID_RUN", "The selected run is not an exact completed canonical workflow.");
  }
}

function validateArtifactSet(
  run: CompletedWorkflowRunMetadata,
  supplied: readonly StoredWorkflowArtifact[],
): Map<string, StoredWorkflowArtifact> {
  if (!supplied.length) refuse("INVALID_ARTIFACT_SET", "The selected artifact set is empty.");
  const byKey = new Map<string, StoredWorkflowArtifact>();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const artifact of supplied) {
    if (
      artifact.runId !== run.runId ||
      artifact.artifactSetId !== run.artifactSetId ||
      artifact.workflowId !== run.workflowId ||
      artifact.workflowVersion !== run.workflowVersion ||
      artifact.workflowContractSha256 !== run.workflowContractSha256
    ) {
      refuse("INVALID_ARTIFACT_SET", "A stored artifact belongs to a different run or contract.");
    }
    if (!artifact.artifactKey.trim() || byKey.has(artifact.artifactKey)) {
      refuse("INVALID_ARTIFACT_SET", `Duplicate or empty artifact key ${artifact.artifactKey}.`);
    }
    if (
      !safeRelativePath(artifact.relativePath) ||
      paths.has(artifact.relativePath) ||
      artifact.filename !== path.basename(artifact.relativePath) ||
      !artifact.contentType.trim()
    ) {
      refuse(
        "INVALID_ARTIFACT_SET",
        `Artifact ${artifact.artifactKey} has invalid or duplicate storage metadata.`,
      );
    }
    if (
      !(artifact.content instanceof Uint8Array) ||
      !Number.isSafeInteger(artifact.byteSize) ||
      artifact.byteSize < 0 ||
      artifact.byteSize !== artifact.content.byteLength ||
      !SHA256.test(artifact.sha256) ||
      digest(artifact.content) !== artifact.sha256
    ) {
      refuse(
        "INVALID_ARTIFACT_BYTES",
        `Artifact ${artifact.artifactKey} does not match its stored byte length and SHA-256.`,
      );
    }
    const maximumBytes =
      artifact.artifactKey === "bundle" ? MAX_WORKFLOW_BUNDLE_BYTES : MAX_WORKFLOW_ARTIFACT_BYTES;
    totalBytes += artifact.byteSize;
    if (artifact.byteSize > maximumBytes || totalBytes > MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES) {
      refuse(
        "INVALID_ARTIFACT_BYTES",
        `Artifact ${artifact.artifactKey} exceeds the canonical publication size limits.`,
      );
    }
    byKey.set(artifact.artifactKey, artifact);
    paths.add(artifact.relativePath);
  }

  for (const expected of artifactsFor("workflow")) {
    if (!byKey.has(expected.key)) {
      refuse("INVALID_ARTIFACT_SET", `The canonical artifact ${expected.key} is missing.`);
    }
  }
  return byKey;
}

function workflowManifest(
  run: CompletedWorkflowRunMetadata,
  artifact: StoredWorkflowArtifact,
): ParsedWorkflowManifest {
  if (artifact.relativePath !== "workflow-manifest.json") {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The root workflow manifest is not stored at its canonical path.",
    );
  }
  const manifest = parseJsonArtifact(artifact, "INVALID_WORKFLOW_MANIFEST", "Workflow manifest");
  if (
    manifest.schema_version !== "damm.workflow-run/v1" ||
    manifest.run_id !== run.runId ||
    manifest.workflow_id !== run.workflowId ||
    manifest.workflow_version !== run.workflowVersion ||
    manifest.contract_sha256 !== run.workflowContractSha256 ||
    manifest.country !== run.countryName ||
    manifest.iso3 !== run.iso3 ||
    manifest.status !== "complete"
  ) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The workflow manifest does not identify this completed run.",
    );
  }

  const inputSnapshot = record(manifest.input_snapshot);
  if (
    !inputSnapshot ||
    !safeRelativePath(inputSnapshot.path) ||
    !SHA256.test(typeof inputSnapshot.sha256 === "string" ? inputSnapshot.sha256 : "")
  ) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The workflow manifest has no valid input snapshot binding.",
    );
  }

  if (!Array.isArray(manifest.stages) || manifest.stages.length !== DAR_WORKFLOW.stages.length) {
    refuse("INVALID_WORKFLOW_MANIFEST", "The workflow manifest must contain exactly eight stages.");
  }
  let stage8 = new Map<string, StageArtifactRecord>();
  const stageArtifacts = new Map<string, ReadonlyMap<string, StageArtifactRecord>>();
  for (const [index, contractStage] of DAR_WORKFLOW.stages.entries()) {
    const stage = record(manifest.stages[index]);
    if (
      !stage ||
      stage.ordinal !== contractStage.ordinal ||
      stage.id !== contractStage.id ||
      stage.status !== "complete" ||
      !Array.isArray(stage.artifacts)
    ) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Canonical stage ${contractStage.ordinal} is not recorded as complete.`,
      );
    }
    const artifacts = new Map<string, StageArtifactRecord>();
    for (const candidate of stage.artifacts) {
      const stageArtifact = record(candidate);
      const key = typeof stageArtifact?.key === "string" ? stageArtifact.key : "";
      if (
        !stageArtifact ||
        !key ||
        artifacts.has(key) ||
        !safeRelativePath(stageArtifact.path) ||
        !SHA256.test(typeof stageArtifact.sha256 === "string" ? stageArtifact.sha256 : "") ||
        typeof stageArtifact.media_type !== "string" ||
        !stageArtifact.media_type
      ) {
        refuse(
          "INVALID_WORKFLOW_MANIFEST",
          `Canonical stage ${contractStage.ordinal} has an invalid artifact record.`,
        );
      }
      artifacts.set(key, {
        key,
        path: stageArtifact.path as string,
        sha256: stageArtifact.sha256 as string,
        mediaType: stageArtifact.media_type as string,
      });
    }
    for (const required of contractStage.required_artifacts) {
      if (!artifacts.has(required)) {
        refuse(
          "INVALID_WORKFLOW_MANIFEST",
          `Canonical stage ${contractStage.ordinal} omits required artifact ${required}.`,
        );
      }
    }
    if (contractStage.id === "export_package") stage8 = artifacts;
    stageArtifacts.set(contractStage.id, artifacts);
  }
  const stage1 = stageArtifacts.get("damm_diagnostic");
  const assessmentInput = stage1?.get("engine_input") ?? null;
  if (!assessmentInput) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The workflow has no exact Stage 1 scored engine input; raw observations cannot substitute for G1 assessment rows.",
    );
  }
  return {
    manifest,
    inputSnapshot: {
      path: inputSnapshot.path as string,
      sha256: inputSnapshot.sha256 as string,
    },
    assessmentInput,
    stageArtifacts,
    stage8,
  };
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function parsePackageRecord(value: unknown, index: number): PackageFileRecord {
  const item = record(value);
  if (
    !item ||
    !safeRelativePath(item.path) ||
    path.basename(item.path) === "package-manifest.json" ||
    !SHA256.test(typeof item.sha256 === "string" ? item.sha256 : "") ||
    !Number.isSafeInteger(item.bytes) ||
    (item.bytes as number) < 0 ||
    typeof item.category !== "string" ||
    !PACKAGE_CATEGORIES.has(item.category) ||
    !optionalString(item.stage_id) ||
    !optionalString(item.artifact_id) ||
    !optionalString(item.input_id) ||
    !optionalString(item.input_kind) ||
    (item.source_sha256 !== undefined &&
      !SHA256.test(typeof item.source_sha256 === "string" ? item.source_sha256 : ""))
  ) {
    refuse("INVALID_PACKAGE_MANIFEST", `Package file record ${index + 1} is invalid.`);
  }
  return {
    path: item.path,
    sha256: item.sha256 as string,
    bytes: item.bytes as number,
    category: item.category,
    ...(item.stage_id === undefined ? {} : { stageId: item.stage_id as string }),
    ...(item.artifact_id === undefined ? {} : { artifactId: item.artifact_id as string }),
    ...(item.source_sha256 === undefined ? {} : { sourceSha256: item.source_sha256 as string }),
    ...(item.input_id === undefined ? {} : { inputId: item.input_id as string }),
    ...(item.input_kind === undefined ? {} : { inputKind: item.input_kind as string }),
  };
}

function matchesSelector(file: PackageFileRecord, selector: WorkflowPackageSelector): boolean {
  return (
    file.category === selector.category &&
    (selector.stageId === undefined || file.stageId === selector.stageId) &&
    (selector.artifactId === undefined || file.artifactId === selector.artifactId) &&
    path.extname(file.path).toLowerCase() === `.${selector.extension.toLowerCase()}`
  );
}

function verifyUploadBinding(
  rootManifest: Record<string, unknown>,
  packageManifest: Record<string, unknown>,
  files: readonly PackageFileRecord[],
): void {
  const rootUpload = record(rootManifest.uploads_manifest);
  const packaged = record(packageManifest.upload_inputs);
  if (
    !rootUpload ||
    !safeRelativePath(rootUpload.path) ||
    !SHA256.test(typeof rootUpload.sha256 === "string" ? rootUpload.sha256 : "") ||
    !Number.isSafeInteger(rootUpload.document_count) ||
    (rootUpload.document_count as number) < 0 ||
    !packaged ||
    packaged.schema_version !== "damm.uploads-manifest/v1" ||
    packaged.manifest_path !== rootUpload.path ||
    packaged.manifest_sha256 !== rootUpload.sha256 ||
    packaged.document_count !== rootUpload.document_count ||
    !Array.isArray(packaged.documents) ||
    packaged.documents.length !== rootUpload.document_count
  ) {
    refuse("INVALID_PACKAGE_MANIFEST", "The package upload-input binding is not canonical.");
  }

  const expectedInputs: Array<{
    path: string;
    sha256: string;
    artifactId: string;
    inputId?: string;
    inputKind?: string;
  }> = [
    {
      path: rootUpload.path,
      sha256: rootUpload.sha256 as string,
      artifactId: "uploads_manifest",
    },
  ];
  const ids = new Set<string>();
  const inputPaths = new Set<string>([rootUpload.path]);
  for (const documentValue of packaged.documents) {
    const document = record(documentValue);
    if (
      !document ||
      typeof document.id !== "string" ||
      !document.id ||
      ids.has(document.id) ||
      typeof document.kind !== "string" ||
      !OPTIONAL_UPLOAD_KINDS.has(document.kind) ||
      !safeRelativePath(document.content_path) ||
      !safeRelativePath(document.original_path) ||
      inputPaths.has(document.content_path) ||
      inputPaths.has(document.original_path) ||
      document.content_path === document.original_path ||
      !SHA256.test(typeof document.content_sha256 === "string" ? document.content_sha256 : "") ||
      !SHA256.test(typeof document.original_sha256 === "string" ? document.original_sha256 : "") ||
      !Number.isSafeInteger(document.original_size_bytes) ||
      (document.original_size_bytes as number) < 0
    ) {
      refuse("INVALID_PACKAGE_MANIFEST", "A packaged upload-input record is invalid.");
    }
    ids.add(document.id);
    inputPaths.add(document.content_path);
    inputPaths.add(document.original_path);
    expectedInputs.push(
      {
        path: document.content_path,
        sha256: document.content_sha256 as string,
        artifactId: "upload_extracted_text",
        inputId: document.id,
        inputKind: document.kind,
      },
      {
        path: document.original_path,
        sha256: document.original_sha256 as string,
        artifactId: "upload_original",
        inputId: document.id,
        inputKind: document.kind,
      },
    );
  }

  const inputFiles = files.filter((file) => file.category === "input");
  if (inputFiles.length !== expectedInputs.length) {
    refuse("INVALID_PACKAGE_MANIFEST", "The package does not contain the exact frozen input set.");
  }
  for (const expected of expectedInputs) {
    const matches = inputFiles.filter((file) => file.path === expected.path);
    if (
      matches.length !== 1 ||
      matches[0].sha256 !== expected.sha256 ||
      matches[0].sourceSha256 !== expected.sha256 ||
      matches[0].artifactId !== expected.artifactId ||
      matches[0].inputId !== expected.inputId ||
      matches[0].inputKind !== expected.inputKind
    ) {
      refuse("INVALID_PACKAGE_MANIFEST", `Frozen input ${expected.path} is not hash-bound.`);
    }
  }
}

function packageManifest(
  run: CompletedWorkflowRunMetadata,
  root: ReturnType<typeof workflowManifest>,
  artifact: StoredWorkflowArtifact,
): { manifest: Record<string, unknown>; files: PackageFileRecord[] } {
  const manifest = parseJsonArtifact(artifact, "INVALID_PACKAGE_MANIFEST", "Package manifest");
  if (
    manifest.schema_version !== "damm.dar-package/v1" ||
    manifest.workflow_id !== run.workflowId ||
    manifest.workflow_version !== run.workflowVersion ||
    manifest.workflow_contract_sha256 !== run.workflowContractSha256 ||
    manifest.country !== run.countryName ||
    manifest.iso3 !== run.iso3 ||
    manifest.lifecycle_state !== "draft" ||
    manifest.input_snapshot_sha256 !== root.inputSnapshot.sha256 ||
    !Array.isArray(manifest.files) ||
    !Number.isSafeInteger(manifest.file_count) ||
    manifest.file_count !== manifest.files.length
  ) {
    refuse("INVALID_PACKAGE_MANIFEST", "The package manifest is not a contract-bound Draft.");
  }
  const files = manifest.files.map(parsePackageRecord);
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    refuse("INVALID_PACKAGE_MANIFEST", "The package manifest repeats a file path.");
  }
  verifyUploadBinding(root.manifest, manifest, files);
  return { manifest, files };
}

function verifyStage8StoredBindings(
  stage8: ReadonlyMap<string, unknown>,
  packageArtifact: StoredWorkflowArtifact,
  bundleArtifact: StoredWorkflowArtifact,
): void {
  for (const [key, stored] of [
    ["workflow_manifest", packageArtifact],
    ["complete_bundle", bundleArtifact],
  ] as const) {
    const stageRecord = record(stage8.get(key));
    if (
      !stageRecord ||
      stageRecord.path !== stored.relativePath ||
      stageRecord.sha256 !== stored.sha256
    ) {
      refuse("INVALID_WORKFLOW_MANIFEST", `Stage 8 does not bind the stored ${key} bytes.`);
    }
  }
}

function verifyMethodologyArtifacts(
  run: CompletedWorkflowRunMetadata,
  root: ReturnType<typeof workflowManifest>,
  byKey: ReadonlyMap<string, StoredWorkflowArtifact>,
): void {
  const pinnedDigests = [
    ["canonical-model", DAMM_WORKFLOW_METHODOLOGY.appModelSha256],
    ["canonical-model-schema", DAMM_WORKFLOW_METHODOLOGY.appModelSchemaSha256],
    ["canonical-indicator-census", DAMM_WORKFLOW_METHODOLOGY.censusSha256],
  ] as const;
  for (const [key, expected] of pinnedDigests) {
    if (byKey.get(key)?.sha256 !== expected) {
      refuse("INVALID_METHODOLOGY", `Stored methodology artifact ${key} is not canonical.`);
    }
  }

  const exportManifest = parseJsonArtifact(
    byKey.get("model-export-manifest")!,
    "INVALID_METHODOLOGY",
    "DAMM model export manifest",
  );
  if (!isDeepStrictEqual(exportManifest, DAMM_MODEL_EXPORT)) {
    refuse("INVALID_METHODOLOGY", "The stored DAMM model export manifest is not canonical.");
  }
  const methodology = parseJsonArtifact(
    byKey.get("methodology-manifest")!,
    "INVALID_METHODOLOGY",
    "Run methodology manifest",
  );
  const expected = runMethodologyManifest(run.runId, {
    path: root.assessmentInput.path,
    sha256: root.assessmentInput.sha256,
  });
  if (!isDeepStrictEqual(methodology, expected)) {
    refuse(
      "INVALID_METHODOLOGY",
      "The run methodology manifest does not bind the run, contract, assessment input, and pinned DAMM identity.",
    );
  }
}

function supplementalPackageArtifactKey(relativePath: string): string {
  return `package-file-${createHash("sha256").update(relativePath).digest("hex").slice(0, 24)}`;
}

function verifyPackageMappings(
  artifacts: readonly StoredWorkflowArtifact[],
  byKey: ReadonlyMap<string, StoredWorkflowArtifact>,
  files: readonly PackageFileRecord[],
  root: ParsedWorkflowManifest,
): ReadonlyMap<string, StoredWorkflowArtifact> {
  const canonicalKeys = new Set(artifactsFor("workflow").map((artifact) => artifact.key));
  const expectedKeys = new Set(canonicalKeys);
  const storedByPackagePath = new Map<string, StoredWorkflowArtifact>();
  for (const link of artifactsFor("workflow")) {
    if (link.workflowSource?.kind !== "package") continue;
    const selector = link.workflowSource.selector;
    const matches = files.filter((file) => matchesSelector(file, selector));
    if (matches.length !== 1) {
      refuse("INVALID_PACKAGE_MAPPING", `Package selector ${link.key} is not unique.`);
    }
    const match = matches[0];
    if (selector.stageId) {
      const source = root.stageArtifacts.get(selector.stageId)?.get(selector.artifactId ?? "");
      if (!selector.artifactId || !source) {
        refuse(
          "INVALID_PACKAGE_MAPPING",
          `Package selector ${link.key} has no exact root-stage source record.`,
        );
      }
      if (
        match.sourceSha256 !== source.sha256 ||
        (match.category !== "narrative" && match.sha256 !== source.sha256)
      ) {
        refuse(
          "INVALID_PACKAGE_MAPPING",
          `Package selector ${link.key} is not derived from its exact root-stage artifact.`,
        );
      }
    }
    if (selector.groupArtifactKey) {
      const prefixes = {
        narrative_exports: "narratives/",
        structured_exports: "structured/",
        source_inventory_exports: "source-inventory/",
      } as const;
      if (!match.path.startsWith(prefixes[selector.groupArtifactKey])) {
        refuse("INVALID_PACKAGE_MAPPING", `Package selector ${link.key} is outside its group.`);
      }
    }
    const stored = byKey.get(link.key)!;
    if (
      stored.relativePath !== match.path ||
      stored.filename !== path.basename(match.path) ||
      stored.sha256 !== match.sha256 ||
      stored.byteSize !== match.bytes
    ) {
      refuse(
        "INVALID_PACKAGE_MAPPING",
        `Stored package artifact ${link.key} differs from its manifest.`,
      );
    }
  }

  for (const file of files) {
    const stored = artifacts.filter((artifact) => artifact.relativePath === file.path);
    if (
      stored.length !== 1 ||
      stored[0].sha256 !== file.sha256 ||
      stored[0].byteSize !== file.bytes
    ) {
      refuse("INVALID_PACKAGE_MAPPING", `Manifest file ${file.path} has no exact stored artifact.`);
    }
    storedByPackagePath.set(file.path, stored[0]);
    const isStageProjection =
      file.category === "narrative" ||
      file.category === "structured" ||
      file.category === "source_inventory";
    if (
      (file.stageId !== undefined && file.artifactId === undefined) ||
      (isStageProjection && (file.stageId === undefined || file.artifactId === undefined))
    ) {
      refuse(
        "INVALID_PACKAGE_MAPPING",
        `Manifest file ${file.path} has an incomplete root-stage identity.`,
      );
    }
    if (file.stageId !== undefined && file.artifactId !== undefined) {
      const source = root.stageArtifacts.get(file.stageId)?.get(file.artifactId);
      if (
        !source ||
        file.sourceSha256 !== source.sha256 ||
        (file.category !== "narrative" && file.sha256 !== source.sha256)
      ) {
        refuse(
          "INVALID_PACKAGE_MAPPING",
          `Manifest file ${file.path} is not bound to its exact root-stage source.`,
        );
      }
    }
    if (!canonicalKeys.has(stored[0].artifactKey)) {
      const expectedKey = supplementalPackageArtifactKey(file.path);
      if (stored[0].artifactKey !== expectedKey) {
        refuse(
          "INVALID_ARTIFACT_SET",
          `Manifest-backed artifact ${file.path} has an unrecognized storage key.`,
        );
      }
      expectedKeys.add(expectedKey);
    }
  }

  if (
    artifacts.length !== expectedKeys.size ||
    artifacts.some((artifact) => !expectedKeys.has(artifact.artifactKey))
  ) {
    refuse(
      "INVALID_ARTIFACT_SET",
      "The selected set contains artifacts outside the exact canonical and manifest-backed catalogue.",
    );
  }
  return storedByPackagePath;
}

function verifyStoredUploadManifest(
  root: ParsedWorkflowManifest,
  packageManifestValue: Record<string, unknown>,
  storedByPackagePath: ReadonlyMap<string, StoredWorkflowArtifact>,
): void {
  const rootUpload = record(root.manifest.uploads_manifest);
  const packaged = record(packageManifestValue.upload_inputs);
  const stored =
    rootUpload && typeof rootUpload.path === "string"
      ? storedByPackagePath.get(rootUpload.path)
      : null;
  if (
    !rootUpload ||
    !packaged ||
    !stored ||
    stored.sha256 !== rootUpload.sha256 ||
    stored.byteSize !== stored.content.byteLength
  ) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The frozen upload manifest does not have exact stored bytes.",
    );
  }
  const envelope = parseJsonArtifact(stored, "INVALID_WORKFLOW_MANIFEST", "Frozen upload manifest");
  if (
    envelope.schema_version !== "damm.uploads-manifest/v1" ||
    !Array.isArray(envelope.documents) ||
    envelope.documents.length !== rootUpload.document_count
  ) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The frozen upload manifest has an invalid envelope or document count.",
    );
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  const documents: Array<Record<string, unknown>> = [];
  for (const [index, candidate] of envelope.documents.entries()) {
    const document = record(candidate);
    const metadata = record(document?.metadata);
    const contentPath = typeof document?.content_path === "string" ? document.content_path : "";
    const originalPath = typeof document?.original_path === "string" ? document.original_path : "";
    const contentArtifact = contentPath ? storedByPackagePath.get(contentPath) : null;
    const originalArtifact = originalPath ? storedByPackagePath.get(originalPath) : null;
    let extractedCharacters = -1;
    try {
      extractedCharacters = contentArtifact
        ? Array.from(new TextDecoder("utf-8", { fatal: true }).decode(contentArtifact.content))
            .length
        : -1;
    } catch {
      // The single canonical extracted-content media type is UTF-8 text.
    }
    if (
      !document ||
      typeof document.id !== "string" ||
      !document.id ||
      ids.has(document.id) ||
      typeof document.kind !== "string" ||
      !OPTIONAL_UPLOAD_KINDS.has(document.kind) ||
      typeof document.original_filename !== "string" ||
      !document.original_filename ||
      !safeRelativePath(contentPath) ||
      !contentPath.startsWith("inputs/upload-content/") ||
      !safeRelativePath(originalPath) ||
      !originalPath.startsWith("inputs/upload-originals/") ||
      contentPath === originalPath ||
      paths.has(contentPath) ||
      paths.has(originalPath) ||
      !SHA256.test(typeof document.content_sha256 === "string" ? document.content_sha256 : "") ||
      !SHA256.test(typeof document.original_sha256 === "string" ? document.original_sha256 : "") ||
      !Number.isSafeInteger(document.original_size_bytes) ||
      (document.original_size_bytes as number) < 0 ||
      document.content_media_type !== "text/plain" ||
      !contentArtifact ||
      contentArtifact.sha256 !== document.content_sha256 ||
      !originalArtifact ||
      originalArtifact.sha256 !== document.original_sha256 ||
      originalArtifact.byteSize !== document.original_size_bytes ||
      !metadata ||
      metadata.app_upload_kind !== document.kind ||
      metadata.extraction_status !== "extracted" ||
      typeof metadata.source_mime_type !== "string" ||
      !metadata.source_mime_type ||
      typeof metadata.uploaded_by !== "string" ||
      !metadata.uploaded_by ||
      typeof metadata.uploaded_at !== "string" ||
      !Number.isFinite(Date.parse(metadata.uploaded_at)) ||
      metadata.extracted_characters !== extractedCharacters
    ) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Frozen upload document ${index + 1} fails its immutable provenance binding.`,
      );
    }
    ids.add(document.id);
    paths.add(contentPath);
    paths.add(originalPath);
    documents.push({
      id: document.id,
      kind: document.kind,
      content_path: contentPath,
      content_sha256: document.content_sha256,
      original_path: originalPath,
      original_sha256: document.original_sha256,
      original_size_bytes: document.original_size_bytes,
    });
  }
  const expectedProjection = {
    schema_version: "damm.uploads-manifest/v1",
    manifest_path: rootUpload.path,
    manifest_sha256: rootUpload.sha256,
    document_count: rootUpload.document_count,
    documents,
  };
  if (!isDeepStrictEqual(packaged, expectedProjection)) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The packaged upload projection differs from the exact frozen launch manifest.",
    );
  }
}

function stageOutputHashes(value: unknown): Map<string, string[]> | null {
  const output = new Map<string, string[]>();
  const add = (key: unknown, sha256: unknown): void => {
    if (typeof key !== "string" || typeof sha256 !== "string" || !SHA256.test(sha256)) return;
    output.set(key, [...(output.get(key) ?? []), sha256]);
  };
  const objectValue = record(value);
  if (objectValue) {
    for (const [key, candidate] of Object.entries(objectValue)) {
      if (Array.isArray(candidate)) {
        for (const child of candidate) add(key, record(child)?.sha256 ?? child);
      } else {
        add(key, record(candidate)?.sha256 ?? candidate);
      }
    }
    return output;
  }
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    const item = record(candidate);
    if (item) add(item.key ?? item.artifact_id ?? item.id, item.sha256);
  }
  return output;
}

function failedQualityCheck(value: unknown): boolean {
  if (value === false) return true;
  return record(value)?.ok === false;
}

/** Re-run the worker's stage-provenance checks against the exact packaged bytes. */
function verifyStoredStageManifests(
  run: CompletedWorkflowRunMetadata,
  root: ParsedWorkflowManifest,
  files: readonly PackageFileRecord[],
  storedByPackagePath: ReadonlyMap<string, StoredWorkflowArtifact>,
): void {
  for (const contractStage of DAR_WORKFLOW.stages.slice(0, -1)) {
    const matches = files.filter(
      (file) =>
        file.category === "structured" &&
        file.stageId === contractStage.id &&
        file.artifactId === "stage_manifest",
    );
    const stored = matches.length === 1 ? storedByPackagePath.get(matches[0].path) : null;
    if (!stored) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Canonical stage ${contractStage.ordinal} has no exact stored stage manifest.`,
      );
    }
    const manifest = parseJsonArtifact(
      stored,
      "INVALID_WORKFLOW_MANIFEST",
      `Stage ${contractStage.ordinal} manifest`,
    );
    const inputHashes = record(manifest.input_hashes);
    const inputSnapshot = record(manifest.input_snapshot);
    const quality = record(manifest.quality_checks);
    const checks = quality ? Object.values(quality) : manifest.quality_checks;
    if (
      !DAR_WORKFLOW.stage_manifest_required_fields.every((field) =>
        Object.hasOwn(manifest, field),
      ) ||
      manifest.schema_version !== "damm.workflow-stage/v1" ||
      manifest.workflow_id !== run.workflowId ||
      manifest.workflow_version !== run.workflowVersion ||
      manifest.run_id !== run.runId ||
      manifest.stage_id !== contractStage.id ||
      manifest.ordinal !== contractStage.ordinal ||
      manifest.status !== "complete" ||
      typeof manifest.execution_mode !== "string" ||
      !manifest.execution_mode.trim() ||
      typeof manifest.spend_usd !== "number" ||
      !Number.isFinite(manifest.spend_usd) ||
      manifest.spend_usd < 0 ||
      inputHashes?.input_snapshot !== root.inputSnapshot.sha256 ||
      inputSnapshot?.sha256 !== root.inputSnapshot.sha256 ||
      (!quality && !Array.isArray(checks)) ||
      (Array.isArray(checks) && checks.some(failedQualityCheck)) ||
      manifest.source_inventory === null ||
      manifest.source_inventory === undefined
    ) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Canonical stage ${contractStage.ordinal} has invalid provenance metadata.`,
      );
    }

    const outputHashes = stageOutputHashes(manifest.output_hashes);
    const stageArtifacts = root.stageArtifacts.get(contractStage.id);
    if (!outputHashes || !stageArtifacts) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Canonical stage ${contractStage.ordinal} has no valid output bindings.`,
      );
    }
    const expected = new Map<string, string[]>();
    for (const [key, artifact] of stageArtifacts) {
      if (key === "stage_manifest") continue;
      expected.set(key, [...(expected.get(key) ?? []), artifact.sha256]);
    }
    if (
      outputHashes.size !== expected.size ||
      [...expected].some(([key, digests]) => {
        const actual = outputHashes.get(key);
        return !actual || [...actual].sort().join("\n") !== [...digests].sort().join("\n");
      })
    ) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Canonical stage ${contractStage.ordinal} output hashes differ from the final root.`,
      );
    }
  }
}

function verifyPackagedWorkflowBindings(
  run: CompletedWorkflowRunMetadata,
  root: ParsedWorkflowManifest,
  packageManifestValue: Record<string, unknown>,
  files: readonly PackageFileRecord[],
  byKey: ReadonlyMap<string, StoredWorkflowArtifact>,
): void {
  const workflowRecord = (artifactId: string): PackageFileRecord => {
    const matches = files.filter(
      (file) => file.category === "workflow" && file.artifactId === artifactId,
    );
    if (matches.length !== 1) {
      refuse("INVALID_PACKAGE_MAPPING", `Packaged workflow record ${artifactId} is not unique.`);
    }
    return matches[0];
  };
  const contract = workflowRecord("workflow_contract");
  if (
    contract.sha256 !== run.workflowContractSha256 ||
    contract.sourceSha256 !== run.workflowContractSha256
  ) {
    refuse("INVALID_PACKAGE_MAPPING", "The packaged workflow contract bytes are not canonical.");
  }
  const snapshotRecord = workflowRecord("input_snapshot");
  if (
    snapshotRecord.sha256 !== root.inputSnapshot.sha256 ||
    snapshotRecord.sourceSha256 !== root.inputSnapshot.sha256
  ) {
    refuse("INVALID_PACKAGE_MAPPING", "The packaged input snapshot differs from the root binding.");
  }

  const snapshot = parseJsonArtifact(
    byKey.get("package-input-snapshot")!,
    "INVALID_WORKFLOW_MANIFEST",
    "Packaged input snapshot",
  );
  if (
    snapshot.schema_version !== "damm.workflow-input-snapshot/v1" ||
    snapshot.country !== run.countryName ||
    snapshot.iso3 !== run.iso3 ||
    snapshot.contract_sha256 !== run.workflowContractSha256 ||
    !isDeepStrictEqual(snapshot.uploads_manifest, root.manifest.uploads_manifest) ||
    snapshot.ceiling_usd !== run.ceilingUsd ||
    !Object.hasOwn(snapshot, "vendor") ||
    snapshot.vendor !== run.vendor
  ) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The packaged input snapshot is not the exact immutable launch identity.",
    );
  }

  // The final root manifest contains the complete-bundle digest. Requiring that same
  // final manifest inside the bundle would create an impossible cryptographic cycle
  // (root -> ZIP hash -> archived root). The packaged pre-Stage-8 manifest must instead
  // carry the exact same Stage 1--7 identity as the final stored root.
  const packagedWorkflowRecord = workflowRecord("workflow_manifest");
  if (
    packagedWorkflowRecord.sha256 !== packagedWorkflowRecord.sourceSha256 ||
    packageManifestValue.workflow_manifest_sha256 !== packagedWorkflowRecord.sha256
  ) {
    refuse(
      "INVALID_PACKAGE_MAPPING",
      "The packaged workflow manifest has no authoritative source binding.",
    );
  }
  const packagedWorkflow = parseJsonArtifact(
    byKey.get("package-workflow-manifest")!,
    "INVALID_WORKFLOW_MANIFEST",
    "Packaged workflow manifest",
  );
  if (
    packagedWorkflow.schema_version !== "damm.workflow-run/v1" ||
    packagedWorkflow.run_id !== run.runId ||
    packagedWorkflow.workflow_id !== run.workflowId ||
    packagedWorkflow.workflow_version !== run.workflowVersion ||
    packagedWorkflow.contract_sha256 !== run.workflowContractSha256 ||
    packagedWorkflow.country !== run.countryName ||
    packagedWorkflow.iso3 !== run.iso3 ||
    !isDeepStrictEqual(packagedWorkflow.input_snapshot, root.manifest.input_snapshot) ||
    !isDeepStrictEqual(packagedWorkflow.uploads_manifest, root.manifest.uploads_manifest) ||
    !Array.isArray(packagedWorkflow.stages) ||
    packagedWorkflow.stages.length !== DAR_WORKFLOW.stages.length
  ) {
    refuse(
      "INVALID_WORKFLOW_MANIFEST",
      "The packaged workflow manifest is not the precursor of this completed run.",
    );
  }
  for (const contractStage of DAR_WORKFLOW.stages.slice(0, -1)) {
    const packagedStage = record(packagedWorkflow.stages[contractStage.ordinal - 1]);
    const rootStage = root.stageArtifacts.get(contractStage.id);
    if (
      !packagedStage ||
      packagedStage.ordinal !== contractStage.ordinal ||
      packagedStage.id !== contractStage.id ||
      packagedStage.status !== "complete" ||
      !Array.isArray(packagedStage.artifacts) ||
      !rootStage
    ) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Packaged workflow stage ${contractStage.ordinal} is not complete.`,
      );
    }
    const packagedArtifacts = new Map<string, StageArtifactRecord>();
    for (const candidate of packagedStage.artifacts) {
      const item = record(candidate);
      const key = typeof item?.key === "string" ? item.key : "";
      if (
        !item ||
        !key ||
        packagedArtifacts.has(key) ||
        !safeRelativePath(item.path) ||
        !SHA256.test(typeof item.sha256 === "string" ? item.sha256 : "") ||
        typeof item.media_type !== "string" ||
        !item.media_type
      ) {
        refuse(
          "INVALID_WORKFLOW_MANIFEST",
          `Packaged workflow stage ${contractStage.ordinal} has an invalid artifact record.`,
        );
      }
      packagedArtifacts.set(key, {
        key,
        path: item.path,
        sha256: item.sha256 as string,
        mediaType: item.media_type,
      });
    }
    if (
      packagedArtifacts.size !== rootStage.size ||
      [...rootStage].some(([key, source]) => {
        const packaged = packagedArtifacts.get(key);
        return !packaged || !isDeepStrictEqual(packaged, source);
      })
    ) {
      refuse(
        "INVALID_WORKFLOW_MANIFEST",
        `Packaged workflow stage ${contractStage.ordinal} differs from the final root identity.`,
      );
    }
  }
}

function verifyStoredAssessmentInput(
  root: ParsedWorkflowManifest,
  byKey: ReadonlyMap<string, StoredWorkflowArtifact>,
  files: readonly PackageFileRecord[],
  storedByPackagePath: ReadonlyMap<string, StoredWorkflowArtifact>,
): StoredWorkflowArtifact {
  const stored = byKey.get("assessment-input");
  if (
    !stored ||
    stored.relativePath !== root.assessmentInput.path ||
    stored.sha256 !== root.assessmentInput.sha256
  ) {
    refuse(
      "INVALID_PACKAGE_MAPPING",
      "The stored assessment input is not the exact Stage 1 engine input selected by the workflow.",
    );
  }

  const packagedMatches = files.filter(
    (file) => file.stageId === "damm_diagnostic" && file.artifactId === root.assessmentInput.key,
  );
  if (packagedMatches.length !== 1) {
    refuse(
      "INVALID_PACKAGE_MAPPING",
      "The package must contain exactly one selected Stage 1 engine input.",
    );
  }
  const packaged = packagedMatches[0];
  const packagedStored = storedByPackagePath.get(packaged.path);
  if (!packagedStored) {
    refuse("INVALID_PACKAGE_MAPPING", "The packaged assessment input has no stored bytes.");
  }
  if (
    packaged.category !== "structured" ||
    packaged.sourceSha256 !== root.assessmentInput.sha256 ||
    packaged.sha256 !== root.assessmentInput.sha256 ||
    packagedStored.sha256 !== stored.sha256 ||
    packagedStored.byteSize !== stored.byteSize ||
    !packagedStored.content.every((value, index) => value === stored.content[index])
  ) {
    refuse(
      "INVALID_PACKAGE_MAPPING",
      "The packaged assessment input differs from the stored Stage 1 engine input.",
    );
  }
  return stored;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_DATA_DESCRIPTOR = 0x08074b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP_ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;

export interface InspectedZipEntry {
  readonly name: string;
  readonly compressionMethod: 0 | 8;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressedContent: Uint8Array;
}

function checkedZipEnd(offset: number, length: number, limit: number): number {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > limit ||
    length > limit - offset
  ) {
    refuse("INVALID_ARCHIVE", "The ZIP directory contains an out-of-bounds record.");
  }
  return offset + length;
}

function inspectZipExtraFields(bytes: Uint8Array, offset: number, length: number): void {
  checkedZipEnd(offset, length, bytes.byteLength);
  if (length !== 0) {
    refuse("INVALID_ARCHIVE", "ZIP extra fields are not valid canonical package bytes.");
  }
}

function zipEntryName(bytes: Uint8Array, offset: number, length: number): string {
  const end = checkedZipEnd(offset, length, bytes.byteLength);
  const nameBytes = bytes.subarray(offset, end);
  if (nameBytes.length === 0 || nameBytes.some((value) => value < 0x20 || value > 0x7e)) {
    refuse("INVALID_ARCHIVE", "ZIP entry names must be non-empty canonical ASCII paths.");
  }
  const name = new TextDecoder().decode(nameBytes);
  const pathName = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!safeRelativePath(pathName)) {
    refuse("INVALID_ARCHIVE", "The ZIP contains an unsafe central-directory path.");
  }
  return name;
}

function zipDataDescriptorEnd(
  view: DataView,
  offset: number,
  limit: number,
  expected: { crc32: number; compressedSize: number; uncompressedSize: number },
): number {
  const available = limit - offset;
  if (
    available >= 16 &&
    view.getUint32(offset, true) === ZIP_DATA_DESCRIPTOR &&
    view.getUint32(offset + 4, true) === expected.crc32 &&
    view.getUint32(offset + 8, true) === expected.compressedSize &&
    view.getUint32(offset + 12, true) === expected.uncompressedSize
  ) {
    return offset + 16;
  }
  if (
    available >= 12 &&
    view.getUint32(offset, true) === expected.crc32 &&
    view.getUint32(offset + 4, true) === expected.compressedSize &&
    view.getUint32(offset + 8, true) === expected.uncompressedSize
  ) {
    return offset + 12;
  }
  refuse("INVALID_ARCHIVE", "A ZIP data descriptor differs from its central record.");
}

/**
 * Inspect the raw central directory before JSZip builds its name-keyed object.
 * JSZip necessarily collapses duplicate names, so the raw record count, bounds,
 * encryption state, ZIP64 markers, and local-header bindings must be checked first.
 */
export function inspectZipArchive(bytes: Uint8Array): readonly InspectedZipEntry[] {
  if (bytes.byteLength < 22) {
    refuse("INVALID_ARCHIVE", "The complete bundle has no ZIP central directory.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliestEocd = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= earliestEocd; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    refuse("INVALID_ARCHIVE", "The complete bundle has no bounded ZIP end record.");
  }
  if (view.getUint16(eocdOffset + 20, true) !== 0) {
    refuse("INVALID_ARCHIVE", "ZIP archive comments are not valid canonical package bytes.");
  }

  if (
    eocdOffset >= 20 &&
    view.getUint32(eocdOffset - 20, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR
  ) {
    refuse("INVALID_ARCHIVE", "ZIP64 archives are not valid canonical Draft packages.");
  }
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    refuse(
      "INVALID_ARCHIVE",
      "Spanned or ZIP64 central directories are not valid canonical Draft packages.",
    );
  }
  const centralEnd = checkedZipEnd(centralOffset, centralSize, eocdOffset);
  if (centralEnd !== eocdOffset || entryCount > Math.floor(centralSize / 46)) {
    refuse("INVALID_ARCHIVE", "The ZIP central-directory bounds or entry count are invalid.");
  }

  const entries: InspectedZipEntry[] = [];
  const uniqueNames = new Set<string>();
  const localOffsets = new Set<number>();
  const localRecords: Array<{
    offset: number;
    dataEnd: number;
    usesDataDescriptor: boolean;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
  }> = [];
  let cursor = centralOffset;
  for (let ordinal = 0; ordinal < entryCount; ordinal += 1) {
    if (
      checkedZipEnd(cursor, 46, centralEnd) > centralEnd ||
      view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_HEADER
    ) {
      refuse("INVALID_ARCHIVE", "The ZIP central directory is truncated or malformed.");
    }
    const versionNeeded = view.getUint16(cursor + 6, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const startDisk = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const variableLength = nameLength + extraLength + commentLength;
    const recordEnd = checkedZipEnd(cursor + 46, variableLength, centralEnd);
    if (commentLength !== 0) {
      refuse("INVALID_ARCHIVE", "ZIP entry comments are not valid canonical package bytes.");
    }
    if (
      versionNeeded >= 45 ||
      (flags & ZIP_ENCRYPTION_FLAGS) !== 0 ||
      (method !== 0 && method !== 8) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      startDisk !== 0 ||
      localOffset === 0xffffffff
    ) {
      refuse("INVALID_ARCHIVE", "The ZIP uses ZIP64, encryption, or unsupported entry features.");
    }

    const nameOffset = cursor + 46;
    const name = zipEntryName(bytes, nameOffset, nameLength);
    if (name.endsWith("/")) {
      refuse("INVALID_ARCHIVE", "The canonical package must not contain a directory record.");
    }
    if (uniqueNames.has(name)) {
      refuse("INVALID_ARCHIVE", `The ZIP central directory repeats entry name ${name}.`);
    }
    uniqueNames.add(name);
    inspectZipExtraFields(bytes, nameOffset + nameLength, extraLength);

    if (localOffsets.has(localOffset)) {
      refuse("INVALID_ARCHIVE", "Multiple ZIP records reference the same local file header.");
    }
    localOffsets.add(localOffset);
    if (
      checkedZipEnd(localOffset, 30, centralOffset) > centralOffset ||
      view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_HEADER
    ) {
      refuse("INVALID_ARCHIVE", "A ZIP central record has no bounded local file header.");
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc32 = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameOffset = localOffset + 30;
    const localExtraOffset = checkedZipEnd(localNameOffset, localNameLength, centralOffset);
    const dataOffset = checkedZipEnd(localExtraOffset, localExtraLength, centralOffset);
    const dataEnd = checkedZipEnd(dataOffset, compressedSize, centralOffset);
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      !bytes
        .subarray(nameOffset, nameOffset + nameLength)
        .every((value, index) => value === bytes[localNameOffset + index]) ||
      (localFlags & ZIP_ENCRYPTION_FLAGS) !== 0
    ) {
      refuse("INVALID_ARCHIVE", "A ZIP local header differs from its central record.");
    }
    inspectZipExtraFields(bytes, localExtraOffset, localExtraLength);
    const usesDataDescriptor = (flags & 0x0008) !== 0;
    const localMetadataMatches =
      localCrc32 === crc32 &&
      localCompressedSize === compressedSize &&
      localUncompressedSize === uncompressedSize;
    const localMetadataIsEmpty =
      localCrc32 === 0 && localCompressedSize === 0 && localUncompressedSize === 0;
    if (!localMetadataMatches && (!usesDataDescriptor || !localMetadataIsEmpty)) {
      refuse("INVALID_ARCHIVE", "A ZIP local header has inconsistent byte metadata.");
    }
    localRecords.push({
      offset: localOffset,
      dataEnd,
      usesDataDescriptor,
      crc32,
      compressedSize,
      uncompressedSize,
    });
    entries.push(
      Object.freeze({
        name,
        compressionMethod: method as 0 | 8,
        crc32,
        compressedSize,
        uncompressedSize,
        compressedContent: bytes.subarray(dataOffset, dataEnd),
      }),
    );
    cursor = recordEnd;
  }
  if (cursor !== centralEnd) {
    refuse("INVALID_ARCHIVE", "The ZIP central directory has unparsed trailing records.");
  }
  localRecords.sort((left, right) => left.offset - right.offset);
  let localCursor = 0;
  for (const [index, local] of localRecords.entries()) {
    const nextOffset = localRecords[index + 1]?.offset ?? centralOffset;
    if (local.offset !== localCursor) {
      refuse("INVALID_ARCHIVE", "The ZIP local record coverage is not exact.");
    }
    const recordEnd = local.usesDataDescriptor
      ? zipDataDescriptorEnd(view, local.dataEnd, nextOffset, local)
      : local.dataEnd;
    if (recordEnd !== nextOffset) {
      refuse("INVALID_ARCHIVE", "The ZIP local record coverage is not exact.");
    }
    localCursor = recordEnd;
  }
  if (localCursor !== centralOffset) {
    refuse("INVALID_ARCHIVE", "The ZIP local record coverage is not exact.");
  }
  return Object.freeze(entries);
}

/** Inspect canonical raw names without asking a name-keyed ZIP library to collapse them. */
export function inspectZipCentralDirectory(bytes: Uint8Array): readonly string[] {
  return Object.freeze(inspectZipArchive(bytes).map((entry) => entry.name));
}

/**
 * Extract one already-inspected entry while bounding actual output to its trusted size.
 * The native inflater stops once `maxOutputLength` is exceeded; it never accumulates an
 * attacker-selected expansion before comparing it with the manifest.
 */
export function extractZipEntryExact(
  entry: InspectedZipEntry,
  expected: { readonly bytes: number; readonly sha256: string },
): Uint8Array {
  if (
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 0 ||
    !SHA256.test(expected.sha256)
  ) {
    refuse("INVALID_ARCHIVE", "A ZIP entry has no valid trusted byte limit.");
  }
  if (entry.uncompressedSize !== expected.bytes) {
    refuse("INVALID_ARCHIVE", `Archived file ${entry.name} declares an invalid size.`);
  }
  let extracted: Uint8Array;
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== expected.bytes) {
      refuse("INVALID_ARCHIVE", `Stored ZIP entry ${entry.name} has inconsistent sizes.`);
    }
    extracted = entry.compressedContent;
  } else {
    try {
      const result = zlib.inflateRawSync(entry.compressedContent, {
        info: true,
        maxOutputLength: Math.max(1, expected.bytes),
      }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (result.engine.bytesWritten !== entry.compressedSize) {
        refuse(
          "INVALID_ARCHIVE",
          `DEFLATE entry ${entry.name} differs from its exact compressed boundary.`,
        );
      }
      extracted = new Uint8Array(
        result.buffer.buffer,
        result.buffer.byteOffset,
        result.buffer.byteLength,
      );
    } catch (error) {
      if (error instanceof Stage8BoundaryVerificationError) throw error;
      refuse(
        "INVALID_ARCHIVE",
        `DEFLATE entry ${entry.name} is malformed or exceeds its exact byte limit.`,
      );
    }
  }
  if (
    extracted.byteLength !== expected.bytes ||
    zlib.crc32(extracted) !== entry.crc32 ||
    digest(extracted) !== expected.sha256
  ) {
    refuse(
      "INVALID_ARCHIVE",
      `Archived file ${entry.name} fails its exact byte, CRC-32, or SHA-256 binding.`,
    );
  }
  return extracted;
}

async function verifyArchive(
  bundle: StoredWorkflowArtifact,
  authoritativeManifest: StoredWorkflowArtifact,
  files: readonly PackageFileRecord[],
): Promise<void> {
  try {
    const entries = inspectZipArchive(bundle.content);

    const manifestEntries = entries.filter(
      (entry) =>
        entry.name === "package-manifest.json" || entry.name.endsWith("/package-manifest.json"),
    );
    if (manifestEntries.length !== 1 || entries.length !== files.length + 1) {
      refuse("INVALID_ARCHIVE", "The bundle is not an exact package-manifest archive.");
    }
    const manifestEntry = manifestEntries[0];
    const manifestName = "package-manifest.json";
    const prefix = manifestEntry.name.slice(0, -manifestName.length);
    const expectedNames = new Set([
      manifestEntry.name,
      ...files.map((file) => `${prefix}${file.path}`),
    ]);
    if (
      expectedNames.size !== entries.length ||
      entries.some((entry) => !expectedNames.has(entry.name))
    ) {
      refuse("INVALID_ARCHIVE", "The bundle contains missing, misplaced, or unmanifested files.");
    }
    if (manifestEntry.uncompressedSize !== authoritativeManifest.byteSize) {
      refuse("INVALID_ARCHIVE", "The archived package manifest declares an invalid size.");
    }
    const archivedManifest = extractZipEntryExact(manifestEntry, {
      bytes: authoritativeManifest.byteSize,
      sha256: authoritativeManifest.sha256,
    });
    if (
      archivedManifest.byteLength !== authoritativeManifest.content.byteLength ||
      !archivedManifest.every((value, index) => value === authoritativeManifest.content[index])
    ) {
      refuse("INVALID_ARCHIVE", "The archived package manifest is not authoritative.");
    }
    for (const file of files) {
      const entry = entries.find((candidate) => candidate.name === `${prefix}${file.path}`);
      if (!entry) refuse("INVALID_ARCHIVE", `The bundle omits ${file.path}.`);
      if (entry.uncompressedSize !== file.bytes) {
        refuse("INVALID_ARCHIVE", `Archived file ${file.path} declares an invalid size.`);
      }
      extractZipEntryExact(entry, { bytes: file.bytes, sha256: file.sha256 });
    }
  } catch (error) {
    if (error instanceof Stage8BoundaryVerificationError) throw error;
    refuse("INVALID_ARCHIVE", "The complete bundle is not a parseable canonical ZIP archive.");
  }
}

/**
 * Assert the complete Stage 8 trust boundary before creating any G1 package.
 * Returns only immutable identity/digest facts; it never returns mutable manifest objects.
 */
export async function verifyStoredStage8Boundary(
  run: CompletedWorkflowRunMetadata,
  artifacts: readonly StoredWorkflowArtifact[],
): Promise<VerifiedStage8Boundary> {
  validateRun(run);
  const byKey = validateArtifactSet(run, artifacts);
  const rootArtifact = byKey.get("manifest")!;
  const packageArtifact = byKey.get("package-manifest")!;
  const bundleArtifact = byKey.get("bundle")!;
  const root = workflowManifest(run, rootArtifact);
  const packaged = packageManifest(run, root, packageArtifact);
  verifyStage8StoredBindings(root.stage8, packageArtifact, bundleArtifact);
  verifyMethodologyArtifacts(run, root, byKey);
  const storedByPackagePath = verifyPackageMappings(artifacts, byKey, packaged.files, root);
  verifyStoredUploadManifest(root, packaged.manifest, storedByPackagePath);
  verifyStoredStageManifests(run, root, packaged.files, storedByPackagePath);
  verifyPackagedWorkflowBindings(run, root, packaged.manifest, packaged.files, byKey);
  const assessmentInput = verifyStoredAssessmentInput(
    root,
    byKey,
    packaged.files,
    storedByPackagePath,
  );
  await verifyArchive(bundleArtifact, packageArtifact, packaged.files);
  return Object.freeze({
    runId: run.runId,
    artifactSetId: run.artifactSetId,
    bundleSha256: bundleArtifact.sha256,
    workflowManifestSha256: rootArtifact.sha256,
    packageManifestSha256: packageArtifact.sha256,
    assessmentInputArtifactKey: assessmentInput.artifactKey,
    assessmentInputRelativePath: assessmentInput.relativePath,
    assessmentInputSourcePath: root.assessmentInput.path,
    assessmentInputSha256: assessmentInput.sha256,
    assessmentInputContent: new Uint8Array(assessmentInput.content),
    inputSnapshotSha256: root.inputSnapshot.sha256,
    artifactCount: artifacts.length,
    packageFileCount: packaged.files.length,
  });
}
