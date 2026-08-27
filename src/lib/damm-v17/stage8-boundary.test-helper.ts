import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import JSZip from "jszip";

import { canonicalIndicatorCensus } from "./methodology.ts";
import { runMethodologyManifest } from "./methodology.ts";
import type {
  CompletedWorkflowRunMetadata,
  StoredWorkflowArtifact,
} from "./stage8-boundary.server.ts";
import { artifactsFor, type WorkflowPackageSelector } from "./worker-artifacts.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "./workflow.ts";

export interface SyntheticPackageRecord {
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

export interface SyntheticStoredStage8Options {
  runId: string;
  artifactSetId: string;
  countryName: string;
  iso3: string;
  observationsBytes: Uint8Array;
  ceilingUsd?: number;
  vendor?: string | null;
  /** Defaults to observationsBytes, but remains a distinct supplemental Stage 1 record. */
  assessmentInputBytes?: Uint8Array;
}

export interface SyntheticStoredStage8Package {
  run: CompletedWorkflowRunMetadata;
  artifacts: StoredWorkflowArtifact[];
  packageFiles: SyntheticPackageRecord[];
  packageBytes: Map<string, Uint8Array>;
  packageManifestBytes: Uint8Array;
  bundleSha256: string;
  assessmentInputSha256: string;
  inputSnapshotSha256: string;
}

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

export function syntheticSha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function packagePath(selector: WorkflowPackageSelector): string {
  const stage = selector.stageId
    ? DAR_WORKFLOW.stages.find((candidate) => candidate.id === selector.stageId)
    : null;
  const stageFolder = stage ? `${String(stage.ordinal).padStart(2, "0")}_${stage.id}` : null;
  if (selector.groupArtifactKey === "narrative_exports" && stageFolder) {
    return `narratives/${stageFolder}/${selector.artifactId}.${selector.extension}`;
  }
  if (selector.groupArtifactKey === "structured_exports" && stageFolder) {
    return `structured/${stageFolder}/${selector.artifactId}.${selector.extension}`;
  }
  if (selector.groupArtifactKey === "source_inventory_exports") {
    return stageFolder
      ? `source-inventory/${stageFolder}/${selector.artifactId}.${selector.extension}`
      : `source-inventory/source_inventory.${selector.extension}`;
  }
  return `workflow/${selector.artifactId}.${selector.extension}`;
}

function storedArtifact(
  run: CompletedWorkflowRunMetadata,
  artifactKey: string,
  relativePath: string,
  content: Uint8Array,
  contentType = "application/octet-stream",
): StoredWorkflowArtifact {
  return {
    runId: run.runId,
    artifactSetId: run.artifactSetId,
    artifactKey,
    relativePath,
    filename: relativePath.split("/").at(-1)!,
    contentType,
    sha256: syntheticSha256(content),
    byteSize: content.byteLength,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    workflowContractSha256: run.workflowContractSha256,
    content,
  };
}

export async function archiveSyntheticStage8Package(
  packageBytes: ReadonlyMap<string, Uint8Array>,
  manifestBytes: Uint8Array,
  options: {
    override?: ReadonlyMap<string, Uint8Array>;
    extra?: ReadonlyMap<string, Uint8Array>;
  } = {},
): Promise<Uint8Array> {
  const archive = new JSZip();
  for (const [relativePath, content] of packageBytes) {
    archive.file(
      `synthetic-draft/${relativePath}`,
      options.override?.get(relativePath) ?? content,
      {
        createFolders: false,
      },
    );
  }
  archive.file("synthetic-draft/package-manifest.json", manifestBytes, { createFolders: false });
  for (const [relativePath, content] of options.extra ?? []) {
    archive.file(`synthetic-draft/${relativePath}`, content, { createFolders: false });
  }
  return archive.generateAsync({ type: "uint8array" });
}

async function canonicalMethodologyBytes(
  runId: string,
  assessmentInput: { path: string; sha256: string },
): Promise<ReadonlyMap<string, Uint8Array>> {
  const [modelExport, model, schema] = await Promise.all([
    readFile(new URL("../../data/damm_model_manifest.json", import.meta.url)),
    readFile(new URL("../../data/model_v1_7.json", import.meta.url)),
    readFile(new URL("../../data/model_v1_7.schema.json", import.meta.url)),
  ]);
  return new Map([
    [
      "methodology-manifest",
      bytes(`${JSON.stringify(runMethodologyManifest(runId, assessmentInput), null, 2)}\n`),
    ],
    ["model-export-manifest", new Uint8Array(modelExport)],
    ["canonical-model", new Uint8Array(model)],
    ["canonical-model-schema", new Uint8Array(schema)],
    [
      "canonical-indicator-census",
      bytes(`${JSON.stringify(canonicalIndicatorCensus(), null, 2)}\n`),
    ],
  ]);
}

/** Build one complete, internally hash-bound stored set without a worker filesystem. */
export async function buildSyntheticStoredStage8Package(
  options: SyntheticStoredStage8Options,
): Promise<SyntheticStoredStage8Package> {
  const run: CompletedWorkflowRunMetadata = {
    runId: options.runId,
    artifactSetId: options.artifactSetId,
    pass: "workflow",
    status: "done",
    countryName: options.countryName,
    iso3: options.iso3,
    ceilingUsd: options.ceilingUsd ?? 0,
    vendor: options.vendor === undefined ? null : options.vendor,
    workflowId: DAR_WORKFLOW.workflow_id,
    workflowVersion: DAR_WORKFLOW.workflow_version,
    workflowContractSha256: DAR_WORKFLOW_SHA256,
  };
  const uploadManifestContent = bytes(
    `${JSON.stringify({ schema_version: "damm.uploads-manifest/v1", documents: [] })}\n`,
  );
  const uploadManifestSha256 = syntheticSha256(uploadManifestContent);
  const uploadManifestRecord = {
    path: "inputs/uploads-manifest.json",
    sha256: uploadManifestSha256,
    document_count: 0,
  };
  const inputSnapshotContent = bytes(
    `${JSON.stringify({
      schema_version: "damm.workflow-input-snapshot/v1",
      country: run.countryName,
      iso3: run.iso3,
      contract_sha256: run.workflowContractSha256,
      uploads_manifest: uploadManifestRecord,
      ceiling_usd: run.ceilingUsd,
      vendor: run.vendor,
    })}\n`,
  );
  const inputSnapshotSha256 = syntheticSha256(inputSnapshotContent);
  const workflowContractContent = new Uint8Array(
    await readFile(new URL("../../data/dar_workflow_v1.json", import.meta.url)),
  );
  const assessmentInputContent = options.assessmentInputBytes ?? options.observationsBytes;
  const assessmentInputPath = "stages/01-damm_diagnostic/00-engine_input.json";
  const assessmentInputSha256 = syntheticSha256(assessmentInputContent);
  const assessmentInput = { path: assessmentInputPath, sha256: assessmentInputSha256 };

  const stageRecords: Array<Record<string, unknown>> = [];
  const stageSource = new Map<
    string,
    {
      record: { key: string; path: string; sha256: string; media_type: string };
      content: Uint8Array;
    }
  >();
  for (const stage of DAR_WORKFLOW.stages.slice(0, -1)) {
    const stageFolder = `${String(stage.ordinal).padStart(2, "0")}-${stage.id}`;
    const stageArtifacts: Array<{
      key: string;
      path: string;
      sha256: string;
      media_type: string;
    }> = [];
    const sourceArtifacts = stage.required_artifacts.filter((key) => key !== "stage_manifest");
    if (stage.id === "damm_diagnostic") sourceArtifacts.unshift("engine_input");
    for (const [index, artifactKey] of sourceArtifacts.entries()) {
      let content = bytes(`${JSON.stringify({ stage: stage.id, artifact: artifactKey })}\n`);
      let extension = "json";
      let mediaType = "application/json";
      if (artifactKey === "engine_input") content = assessmentInputContent;
      else if (stage.id === "damm_diagnostic" && artifactKey === "damm_observations") {
        content = options.observationsBytes;
      } else if (artifactKey.endsWith("_report")) {
        content = bytes(`# Synthetic ${stage.title}\n`);
        extension = "md";
        mediaType = "text/markdown";
      } else if (artifactKey === "cost_benefit_workbook") {
        content = bytes("synthetic workbook bytes\n");
        extension = "xlsx";
        mediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
      const artifactPath =
        artifactKey === "engine_input"
          ? assessmentInputPath
          : `stages/${stageFolder}/${String(index + 1).padStart(2, "0")}-${artifactKey}.${extension}`;
      const record = {
        key: artifactKey,
        path: artifactPath,
        sha256: syntheticSha256(content),
        media_type: mediaType,
      };
      stageArtifacts.push(record);
      stageSource.set(`${stage.id}\0${artifactKey}`, { record, content });
    }

    const stageManifestContent = bytes(
      JSON.stringify({
        schema_version: "damm.workflow-stage/v1",
        workflow_id: run.workflowId,
        workflow_version: run.workflowVersion,
        run_id: run.runId,
        stage_id: stage.id,
        ordinal: stage.ordinal,
        attempt: 1,
        execution_mode: "synthetic-test",
        input_snapshot: { path: "inputs/input-snapshot.json", sha256: inputSnapshotSha256 },
        input_hashes: {
          input_snapshot: inputSnapshotSha256,
          checkpoint_binding: null,
          upstream_stage_manifests: {},
        },
        artifacts: stageArtifacts,
        output_hashes: Object.fromEntries(
          stageArtifacts.map((artifact) => [artifact.key, artifact.sha256]),
        ),
        source_inventory: [],
        quality_checks: [{ id: "synthetic_complete", ok: true }],
        spend_usd: 0,
        status: "complete",
      }),
    );
    const stageManifestRecord = {
      key: "stage_manifest",
      path: `stages/${stageFolder}/stage-manifest.json`,
      sha256: syntheticSha256(stageManifestContent),
      media_type: "application/json",
    };
    stageArtifacts.push(stageManifestRecord);
    stageSource.set(`${stage.id}\0stage_manifest`, {
      record: stageManifestRecord,
      content: stageManifestContent,
    });
    stageRecords.push({
      ordinal: stage.ordinal,
      id: stage.id,
      status: "complete",
      attempts: 1,
      artifacts: stageArtifacts,
    });
  }

  const packagedWorkflowManifestContent = bytes(
    JSON.stringify({
      schema_version: "damm.workflow-run/v1",
      run_id: run.runId,
      workflow_id: run.workflowId,
      workflow_version: run.workflowVersion,
      contract_sha256: run.workflowContractSha256,
      country: run.countryName,
      iso3: run.iso3,
      status: "running",
      current_stage: "export_package",
      input_snapshot: { path: "inputs/input-snapshot.json", sha256: inputSnapshotSha256 },
      uploads_manifest: uploadManifestRecord,
      stages: [
        ...stageRecords,
        { ordinal: 8, id: "export_package", status: "running", attempts: 1, artifacts: [] },
      ],
    }),
  );

  const packageFiles: SyntheticPackageRecord[] = [];
  const packageBytes = new Map<string, Uint8Array>();
  const selectorRecordByKey = new Map<string, SyntheticPackageRecord>();
  for (const link of artifactsFor("workflow")) {
    if (link.workflowSource?.kind !== "package") continue;
    const selector = link.workflowSource.selector;
    const relativePath = packagePath(selector);
    let content = bytes(`synthetic package bytes for ${link.key}\n`);
    let sourceSha256: string | undefined;
    if (selector.stageId && selector.artifactId) {
      const source = stageSource.get(`${selector.stageId}\0${selector.artifactId}`);
      if (!source) throw new Error(`Synthetic source ${selector.stageId}.${selector.artifactId}`);
      sourceSha256 = source.record.sha256;
      if (selector.category !== "narrative") content = source.content;
    } else if (selector.category === "workflow" && selector.artifactId === "input_snapshot") {
      content = inputSnapshotContent;
      sourceSha256 = inputSnapshotSha256;
    } else if (selector.category === "workflow" && selector.artifactId === "workflow_contract") {
      content = workflowContractContent;
      sourceSha256 = run.workflowContractSha256;
    } else if (selector.category === "workflow" && selector.artifactId === "workflow_manifest") {
      content = packagedWorkflowManifestContent;
      sourceSha256 = syntheticSha256(packagedWorkflowManifestContent);
    }
    const file: SyntheticPackageRecord = {
      path: relativePath,
      sha256: syntheticSha256(content),
      bytes: content.byteLength,
      category: selector.category,
      ...(selector.stageId ? { stage_id: selector.stageId } : {}),
      ...(selector.artifactId ? { artifact_id: selector.artifactId } : {}),
      ...(sourceSha256 ? { source_sha256: sourceSha256 } : {}),
    };
    packageFiles.push(file);
    packageBytes.set(relativePath, content);
    selectorRecordByKey.set(link.key, file);
  }

  // DAMM Stage 8 now packages the exact supplemental Stage 1 engine input even
  // though it is not a required artifact in the immutable eight-stage contract.
  const packagedAssessmentInputRecord: SyntheticPackageRecord = {
    path: "structured/01_damm_diagnostic/engine_input.json",
    sha256: assessmentInputSha256,
    bytes: assessmentInputContent.byteLength,
    category: "structured",
    stage_id: "damm_diagnostic",
    artifact_id: "engine_input",
    source_sha256: assessmentInputSha256,
  };
  packageFiles.push(packagedAssessmentInputRecord);
  packageBytes.set(packagedAssessmentInputRecord.path, assessmentInputContent);

  const packagedUploadManifestRecord: SyntheticPackageRecord = {
    path: "inputs/uploads-manifest.json",
    sha256: uploadManifestSha256,
    bytes: uploadManifestContent.byteLength,
    category: "input",
    artifact_id: "uploads_manifest",
    source_sha256: uploadManifestSha256,
  };
  packageFiles.push(packagedUploadManifestRecord);
  packageBytes.set(packagedUploadManifestRecord.path, uploadManifestContent);

  const packageManifest = {
    schema_version: "damm.dar-package/v1",
    package_version: run.workflowVersion,
    workflow_id: run.workflowId,
    workflow_version: run.workflowVersion,
    workflow_contract_sha256: run.workflowContractSha256,
    country: run.countryName,
    iso3: run.iso3,
    lifecycle_state: "draft",
    workflow_manifest_sha256: syntheticSha256(packagedWorkflowManifestContent),
    input_snapshot_sha256: inputSnapshotSha256,
    upload_inputs: {
      schema_version: "damm.uploads-manifest/v1",
      manifest_path: packagedUploadManifestRecord.path,
      manifest_sha256: uploadManifestSha256,
      document_count: 0,
      documents: [],
    },
    file_count: packageFiles.length,
    files: packageFiles,
  };
  const packageManifestBytes = bytes(JSON.stringify(packageManifest));
  const bundleBytes = await archiveSyntheticStage8Package(packageBytes, packageManifestBytes);
  const packageManifestPath =
    "stages/08-export_package/artifacts/workflow_manifest/package-manifest.json";
  const bundlePath = `stages/08-export_package/artifacts/complete_bundle/${run.iso3}_exports_dar_package.zip`;
  const stage8 = DAR_WORKFLOW.stages[7];
  const stages = [
    ...stageRecords,
    {
      ordinal: stage8.ordinal,
      id: stage8.id,
      status: "complete",
      attempts: 1,
      artifacts: stage8.required_artifacts.map((artifactKey) => ({
        key: artifactKey,
        path:
          artifactKey === "workflow_manifest"
            ? packageManifestPath
            : artifactKey === "complete_bundle"
              ? bundlePath
              : `stages/08-export_package/artifacts/${artifactKey}`,
        sha256:
          artifactKey === "workflow_manifest"
            ? syntheticSha256(packageManifestBytes)
            : artifactKey === "complete_bundle"
              ? syntheticSha256(bundleBytes)
              : syntheticSha256(bytes(`directory:${artifactKey}`)),
        media_type:
          artifactKey === "complete_bundle"
            ? "application/zip"
            : artifactKey === "workflow_manifest"
              ? "application/json"
              : "application/x-directory",
      })),
    },
  ];
  const rootManifestBytes = bytes(
    JSON.stringify({
      schema_version: "damm.workflow-run/v1",
      run_id: run.runId,
      workflow_id: run.workflowId,
      workflow_version: run.workflowVersion,
      contract_sha256: run.workflowContractSha256,
      country: run.countryName,
      iso3: run.iso3,
      status: "complete",
      input_snapshot: { path: "inputs/input-snapshot.json", sha256: inputSnapshotSha256 },
      uploads_manifest: uploadManifestRecord,
      stages,
    }),
  );
  const methodology = await canonicalMethodologyBytes(run.runId, assessmentInput);
  const artifacts = artifactsFor("workflow").map((link) => {
    const source = link.workflowSource;
    if (link.key === "manifest") {
      return storedArtifact(
        run,
        link.key,
        "workflow-manifest.json",
        rootManifestBytes,
        "application/json",
      );
    }
    if (link.key === "events") {
      return storedArtifact(run, link.key, "workflow-events.jsonl", bytes(""), "application/jsonl");
    }
    if (link.key === "package-manifest") {
      return storedArtifact(
        run,
        link.key,
        packageManifestPath,
        packageManifestBytes,
        "application/json",
      );
    }
    if (link.key === "bundle") {
      return storedArtifact(run, link.key, bundlePath, bundleBytes, "application/zip");
    }
    if (source?.kind === "assessment_input") {
      return storedArtifact(
        run,
        link.key,
        assessmentInputPath,
        assessmentInputContent,
        "application/json",
      );
    }
    if (methodology.has(link.key)) {
      return storedArtifact(
        run,
        link.key,
        `methodology/${link.key}.json`,
        methodology.get(link.key)!,
        "application/json",
      );
    }
    if (source?.kind === "package") {
      const packageRecord = selectorRecordByKey.get(link.key)!;
      return storedArtifact(
        run,
        link.key,
        packageRecord.path,
        packageBytes.get(packageRecord.path)!,
      );
    }
    return storedArtifact(
      run,
      link.key,
      `catalogue/${link.key}.${link.extension ?? "bin"}`,
      bytes(`synthetic canonical artifact ${link.key}\n`),
    );
  });
  artifacts.push(
    storedArtifact(
      run,
      `package-file-${createHash("sha256")
        .update(packagedAssessmentInputRecord.path)
        .digest("hex")
        .slice(0, 24)}`,
      packagedAssessmentInputRecord.path,
      assessmentInputContent,
      "application/json",
    ),
    storedArtifact(
      run,
      `package-file-${createHash("sha256")
        .update(packagedUploadManifestRecord.path)
        .digest("hex")
        .slice(0, 24)}`,
      packagedUploadManifestRecord.path,
      uploadManifestContent,
      "application/json",
    ),
  );
  return {
    run,
    artifacts,
    packageFiles,
    packageBytes,
    packageManifestBytes,
    bundleSha256: syntheticSha256(bundleBytes),
    assessmentInputSha256,
    inputSnapshotSha256,
  };
}
