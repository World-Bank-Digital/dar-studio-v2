import assert from "node:assert/strict";
import { describe, it } from "node:test";

import JSZip from "jszip";

import {
  Stage8BoundaryVerificationError,
  type Stage8BoundaryFailureCode,
  type StoredWorkflowArtifact,
  verifyStoredStage8Boundary,
} from "./stage8-boundary.server.ts";
import {
  archiveSyntheticStage8Package,
  buildSyntheticStoredStage8Package,
  syntheticSha256,
  type SyntheticStoredStage8Package,
} from "./stage8-boundary.test-helper.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

async function syntheticValidPackage(): Promise<SyntheticStoredStage8Package> {
  return buildSyntheticStoredStage8Package({
    runId: "run-stage8-boundary",
    artifactSetId: "artifact-set-stage8-boundary",
    countryName: "Egypt",
    iso3: "EGY",
    observationsBytes: bytes(
      JSON.stringify({
        schema_version: "damm.observations/v1",
        observations: [{ indicator_id: "1.1", value: 2 }],
      }),
    ),
  });
}

function artifact(fixture: SyntheticStoredStage8Package, key: string): StoredWorkflowArtifact {
  const found = fixture.artifacts.find((candidate) => candidate.artifactKey === key);
  assert.ok(found, `fixture artifact ${key}`);
  return found;
}

function replaceContent(target: StoredWorkflowArtifact, content: Uint8Array): void {
  target.content = content;
  target.byteSize = content.byteLength;
  target.sha256 = syntheticSha256(content);
}

function mutateJsonArtifact(
  fixture: SyntheticStoredStage8Package,
  key: string,
  mutate: (value: Record<string, any>) => void,
): void {
  const target = artifact(fixture, key);
  const value = JSON.parse(decoder.decode(target.content));
  mutate(value);
  replaceContent(target, bytes(JSON.stringify(value)));
}

function rebindStage8Artifact(
  fixture: SyntheticStoredStage8Package,
  key: "package-manifest" | "bundle",
): void {
  const target = artifact(fixture, key);
  mutateJsonArtifact(fixture, "manifest", (manifest) => {
    const stage8 = manifest.stages.find((stage: { id: string }) => stage.id === "export_package");
    const stageKey = key === "package-manifest" ? "workflow_manifest" : "complete_bundle";
    const binding = stage8.artifacts.find(
      (candidate: { key: string }) => candidate.key === stageKey,
    );
    binding.path = target.relativePath;
    binding.sha256 = target.sha256;
  });
}

async function replaceManifestedPackageFile(
  fixture: SyntheticStoredStage8Package,
  artifactKey: string,
  content: Uint8Array,
  options: { rebindSource?: boolean } = {},
): Promise<void> {
  const target = artifact(fixture, artifactKey);
  fixture.packageBytes.set(target.relativePath, content);
  const file = fixture.packageFiles.find((candidate) => candidate.path === target.relativePath);
  assert.ok(file);
  file.bytes = content.byteLength;
  file.sha256 = syntheticSha256(content);
  if (options.rebindSource) file.source_sha256 = file.sha256;
  replaceContent(target, content);

  const manifest = JSON.parse(decoder.decode(artifact(fixture, "package-manifest").content));
  const manifestFile = manifest.files.find(
    (candidate: { path: string }) => candidate.path === target.relativePath,
  );
  manifestFile.bytes = file.bytes;
  manifestFile.sha256 = file.sha256;
  if (options.rebindSource) manifestFile.source_sha256 = file.sha256;
  if (artifactKey === "package-workflow-manifest") {
    manifest.workflow_manifest_sha256 = file.sha256;
  }
  fixture.packageManifestBytes = bytes(JSON.stringify(manifest));
  replaceContent(artifact(fixture, "package-manifest"), fixture.packageManifestBytes);
  rebindStage8Artifact(fixture, "package-manifest");

  const bundle = await archiveSyntheticStage8Package(
    fixture.packageBytes,
    fixture.packageManifestBytes,
  );
  replaceContent(artifact(fixture, "bundle"), bundle);
  rebindStage8Artifact(fixture, "bundle");
}

async function rejection(
  action: () => Promise<unknown>,
  code: Stage8BoundaryFailureCode,
  message?: RegExp,
): Promise<void> {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof Stage8BoundaryVerificationError);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

function zipEndOffset(content: Uint8Array): number {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  for (let offset = content.byteLength - 22; offset >= 0; offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === content.byteLength
    ) {
      return offset;
    }
  }
  assert.fail("synthetic ZIP end record");
}

function duplicateFirstCentralDirectoryRecord(content: Uint8Array): Uint8Array {
  const source = new Uint8Array(content);
  const sourceView = new DataView(source.buffer);
  const endOffset = zipEndOffset(source);
  const centralOffset = sourceView.getUint32(endOffset + 16, true);
  assert.equal(sourceView.getUint32(centralOffset, true), 0x02014b50);
  const recordLength =
    46 +
    sourceView.getUint16(centralOffset + 28, true) +
    sourceView.getUint16(centralOffset + 30, true) +
    sourceView.getUint16(centralOffset + 32, true);
  const output = new Uint8Array(source.byteLength + recordLength);
  output.set(source.subarray(0, endOffset));
  output.set(source.subarray(centralOffset, centralOffset + recordLength), endOffset);
  output.set(source.subarray(endOffset), endOffset + recordLength);
  const outputView = new DataView(output.buffer);
  const outputEnd = endOffset + recordLength;
  outputView.setUint16(outputEnd + 8, sourceView.getUint16(endOffset + 8, true) + 1, true);
  outputView.setUint16(outputEnd + 10, sourceView.getUint16(endOffset + 10, true) + 1, true);
  outputView.setUint32(
    outputEnd + 12,
    sourceView.getUint32(endOffset + 12, true) + recordLength,
    true,
  );
  return output;
}

function insertBytesBeforeCentralDirectory(
  content: Uint8Array,
  injected: Uint8Array,
): Uint8Array {
  const source = new Uint8Array(content);
  const sourceView = new DataView(source.buffer);
  const endOffset = zipEndOffset(source);
  const centralOffset = sourceView.getUint32(endOffset + 16, true);
  const output = new Uint8Array(source.byteLength + injected.byteLength);
  output.set(source.subarray(0, centralOffset));
  output.set(injected, centralOffset);
  output.set(source.subarray(centralOffset), centralOffset + injected.byteLength);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(
    endOffset + injected.byteLength + 16,
    centralOffset + injected.byteLength,
    true,
  );
  return output;
}

async function archiveWithDataDescriptors(
  fixture: SyntheticStoredStage8Package,
): Promise<Uint8Array> {
  const archive = new JSZip();
  for (const [relativePath, content] of fixture.packageBytes) {
    archive.file(`synthetic-draft/${relativePath}`, content, { createFolders: false });
  }
  archive.file("synthetic-draft/package-manifest.json", fixture.packageManifestBytes, {
    createFolders: false,
  });
  return archive.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    streamFiles: true,
  });
}

function lastZipEntry(content: Uint8Array): {
  centralOffset: number;
  compressedSize: number;
  crc32: number;
  localOffset: number;
  uncompressedSize: number;
} {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const endOffset = zipEndOffset(content);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  let cursor = centralOffset;
  let result:
    | {
        centralOffset: number;
        compressedSize: number;
        crc32: number;
        localOffset: number;
        uncompressedSize: number;
      }
    | undefined;
  for (let ordinal = 0; ordinal < entryCount; ordinal += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    const localOffset = view.getUint32(cursor + 42, true);
    if (!result || localOffset > result.localOffset) {
      result = {
        centralOffset,
        compressedSize: view.getUint32(cursor + 20, true),
        crc32: view.getUint32(cursor + 16, true),
        localOffset,
        uncompressedSize: view.getUint32(cursor + 24, true),
      };
    }
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
  assert.ok(result);
  return result;
}

function unsignedLastDataDescriptor(content: Uint8Array): Uint8Array {
  const source = new Uint8Array(content);
  const view = new DataView(source.buffer);
  const endOffset = zipEndOffset(source);
  const entry = lastZipEntry(source);
  assert.equal(view.getUint16(entry.localOffset + 6, true) & 0x0008, 0x0008);
  const descriptorOffset =
    entry.localOffset +
    30 +
    view.getUint16(entry.localOffset + 26, true) +
    view.getUint16(entry.localOffset + 28, true) +
    entry.compressedSize;
  assert.equal(view.getUint32(descriptorOffset, true), 0x08074b50);

  const output = new Uint8Array(source.byteLength - 4);
  output.set(source.subarray(0, descriptorOffset));
  output.set(source.subarray(descriptorOffset + 4), descriptorOffset);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(endOffset - 4 + 16, entry.centralOffset - 4, true);
  return output;
}

function contradictoryLastDescriptorLocalMetadata(content: Uint8Array): Uint8Array {
  const output = new Uint8Array(content);
  const view = new DataView(output.buffer);
  const entry = lastZipEntry(output);
  assert.equal(view.getUint16(entry.localOffset + 6, true) & 0x0008, 0x0008);
  const differentNonzero = (value: number): number => (value === 1 ? 2 : 1);
  view.setUint32(entry.localOffset + 14, differentNonzero(entry.crc32), true);
  view.setUint32(
    entry.localOffset + 18,
    differentNonzero(entry.compressedSize),
    true,
  );
  view.setUint32(
    entry.localOffset + 22,
    differentNonzero(entry.uncompressedSize),
    true,
  );
  return output;
}

function matchingLastDescriptorLocalMetadata(content: Uint8Array): Uint8Array {
  const output = new Uint8Array(content);
  const view = new DataView(output.buffer);
  const entry = lastZipEntry(output);
  assert.equal(view.getUint16(entry.localOffset + 6, true) & 0x0008, 0x0008);
  view.setUint32(entry.localOffset + 14, entry.crc32, true);
  view.setUint32(entry.localOffset + 18, entry.compressedSize, true);
  view.setUint32(entry.localOffset + 22, entry.uncompressedSize, true);
  return output;
}

function encryptedFirstZipEntry(content: Uint8Array): Uint8Array {
  const output = new Uint8Array(content);
  const view = new DataView(output.buffer);
  const endOffset = zipEndOffset(output);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  view.setUint16(centralOffset + 8, view.getUint16(centralOffset + 8, true) | 1, true);
  view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) | 1, true);
  return output;
}

function zip64SentinelDirectory(content: Uint8Array): Uint8Array {
  const output = new Uint8Array(content);
  const view = new DataView(output.buffer);
  const endOffset = zipEndOffset(output);
  view.setUint16(endOffset + 8, 0xffff, true);
  view.setUint16(endOffset + 10, 0xffff, true);
  return output;
}

function outOfBoundsCentralDirectory(content: Uint8Array): Uint8Array {
  const output = new Uint8Array(content);
  const view = new DataView(output.buffer);
  const endOffset = zipEndOffset(output);
  view.setUint32(endOffset + 12, view.getUint32(endOffset + 12, true) + 1, true);
  return output;
}

function replaceBundle(fixture: SyntheticStoredStage8Package, content: Uint8Array): void {
  replaceContent(artifact(fixture, "bundle"), content);
  rebindStage8Artifact(fixture, "bundle");
}

describe("stored Stage 8 boundary verification", () => {
  it("accepts a synthetic complete canonical Draft package", async () => {
    const fixture = await syntheticValidPackage();
    const verified = await verifyStoredStage8Boundary(fixture.run, fixture.artifacts);
    assert.equal(verified.runId, fixture.run.runId);
    assert.equal(verified.artifactSetId, fixture.run.artifactSetId);
    assert.equal(verified.bundleSha256, artifact(fixture, "bundle").sha256);
    assert.equal(verified.packageFileCount, fixture.packageFiles.length);
    assert.equal(verified.artifactCount, fixture.artifacts.length);
    assert.equal(verified.assessmentInputSha256, fixture.assessmentInputSha256);
    assert.equal(verified.inputSnapshotSha256, fixture.inputSnapshotSha256);
    // The final root contains the bundle SHA, so copying that root into the same
    // bundle would be a cryptographic cycle. Both records remain independently bound.
    assert.notEqual(
      artifact(fixture, "package-workflow-manifest").sha256,
      verified.workflowManifestSha256,
    );
    assert.ok(Object.isFrozen(verified));
  });

  it("binds the packaged Stage 1 snapshot to the queued ceiling and nullable vendor", async () => {
    const exact = await buildSyntheticStoredStage8Package({
      runId: "run-launch-identity",
      artifactSetId: "artifact-set-launch-identity",
      countryName: "Egypt",
      iso3: "EGY",
      observationsBytes: bytes("{}"),
      ceilingUsd: 321.5,
      vendor: "openai",
    });
    await verifyStoredStage8Boundary(exact.run, exact.artifacts);

    const ceilingDrift = await syntheticValidPackage();
    ceilingDrift.run.ceilingUsd = 1;
    await rejection(
      () => verifyStoredStage8Boundary(ceilingDrift.run, ceilingDrift.artifacts),
      "INVALID_WORKFLOW_MANIFEST",
      /launch identity/,
    );

    const vendorDrift = await syntheticValidPackage();
    vendorDrift.run.vendor = "openai";
    await rejection(
      () => verifyStoredStage8Boundary(vendorDrift.run, vendorDrift.artifacts),
      "INVALID_WORKFLOW_MANIFEST",
      /launch identity/,
    );

    exact.run.vendor = null;
    await rejection(
      () => verifyStoredStage8Boundary(exact.run, exact.artifacts),
      "INVALID_WORKFLOW_MANIFEST",
      /launch identity/,
    );
  });

  it("returns detached bytes for the exact selected Stage 1 engine input", async () => {
    const observations = bytes('{"1.1":{"value":1,"cls":"Measured"}}');
    const engineInput = bytes('{"1.1":{"value":3,"cls":"Measured"}}');
    const fixture = await buildSyntheticStoredStage8Package({
      runId: "run-distinct-engine-input",
      artifactSetId: "artifact-set-distinct-engine-input",
      countryName: "Egypt",
      iso3: "EGY",
      observationsBytes: observations,
      assessmentInputBytes: engineInput,
    });

    const verified = await verifyStoredStage8Boundary(fixture.run, fixture.artifacts);
    assert.equal(verified.assessmentInputArtifactKey, "assessment-input");
    assert.equal(
      verified.assessmentInputSourcePath,
      "stages/01-damm_diagnostic/00-engine_input.json",
    );
    assert.equal(verified.assessmentInputSha256, syntheticSha256(engineInput));
    assert.notEqual(verified.assessmentInputSha256, syntheticSha256(observations));
    assert.deepEqual(verified.assessmentInputContent, engineInput);
    assert.notStrictEqual(
      verified.assessmentInputContent,
      artifact(fixture, "assessment-input").content,
    );

    verified.assessmentInputContent[0] ^= 0xff;
    assert.deepEqual(artifact(fixture, "assessment-input").content, engineInput);
  });

  it("never promotes raw Stage 1 observations as the G1 assessment input", async () => {
    const fixture = await syntheticValidPackage();
    mutateJsonArtifact(fixture, "manifest", (manifest) => {
      const stage1 = manifest.stages.find(
        (stage: { id: string }) => stage.id === "damm_diagnostic",
      );
      stage1.artifacts = stage1.artifacts.filter(
        (candidate: { key: string }) => candidate.key !== "engine_input",
      );
    });
    await rejection(
      () => verifyStoredStage8Boundary(fixture.run, fixture.artifacts),
      "INVALID_WORKFLOW_MANIFEST",
      /raw observations cannot substitute/,
    );
  });

  it("requires the exact Stage 1 engine input inside the Stage 8 package", async () => {
    const fixture = await syntheticValidPackage();
    const packageManifest = JSON.parse(
      decoder.decode(artifact(fixture, "package-manifest").content),
    );
    const packagedInput = packageManifest.files.find(
      (candidate: { stage_id?: string; artifact_id?: string }) =>
        candidate.stage_id === "damm_diagnostic" && candidate.artifact_id === "engine_input",
    );
    assert.ok(packagedInput);

    mutateJsonArtifact(fixture, "package-manifest", (manifest) => {
      manifest.files = manifest.files.filter(
        (candidate: { path: string }) => candidate.path !== packagedInput.path,
      );
      manifest.file_count = manifest.files.length;
    });
    rebindStage8Artifact(fixture, "package-manifest");
    fixture.artifacts = fixture.artifacts.filter(
      (candidate) => candidate.relativePath !== packagedInput.path,
    );

    await rejection(
      () => verifyStoredStage8Boundary(fixture.run, fixture.artifacts),
      "INVALID_PACKAGE_MAPPING",
      /exactly one selected Stage 1 engine input/,
    );
  });

  it("requires the exact catalogue, with no missing or unrecognized stored key", async () => {
    const missing = await syntheticValidPackage();
    missing.artifacts = missing.artifacts.filter(
      (candidate) => candidate.artifactKey !== "draft-pdf",
    );
    await rejection(
      () => verifyStoredStage8Boundary(missing.run, missing.artifacts),
      "INVALID_ARTIFACT_SET",
    );

    const extra = await syntheticValidPackage();
    const content = bytes("self-hashed but unrecognized extra artifact");
    extra.artifacts.push({
      ...artifact(extra, "events"),
      artifactKey: "unrecognized-extra",
      relativePath: "unrecognized/extra.txt",
      filename: "extra.txt",
      contentType: "text/plain",
      content,
      byteSize: content.byteLength,
      sha256: syntheticSha256(content),
    });
    await rejection(
      () => verifyStoredStage8Boundary(extra.run, extra.artifacts),
      "INVALID_ARTIFACT_SET",
    );
  });

  it("rehashes every supplied byte and rejects self-hashed fake methodology", async () => {
    const corrupt = await syntheticValidPackage();
    artifact(corrupt, "draft-pdf").byteSize += 1;
    await rejection(
      () => verifyStoredStage8Boundary(corrupt.run, corrupt.artifacts),
      "INVALID_ARTIFACT_BYTES",
    );

    const fakeModel = await syntheticValidPackage();
    replaceContent(artifact(fakeModel, "canonical-model"), bytes('{"self":"consistent"}'));
    await rejection(
      () => verifyStoredStage8Boundary(fakeModel.run, fakeModel.artifacts),
      "INVALID_METHODOLOGY",
    );

    const fakeRunIdentity = await syntheticValidPackage();
    mutateJsonArtifact(fakeRunIdentity, "methodology-manifest", (manifest) => {
      manifest.run_id = "another-run";
    });
    await rejection(
      () => verifyStoredStage8Boundary(fakeRunIdentity.run, fakeRunIdentity.artifacts),
      "INVALID_METHODOLOGY",
    );
  });

  it("requires all eight ordered stages and every required stage artifact", async () => {
    const missingStage = await syntheticValidPackage();
    mutateJsonArtifact(missingStage, "manifest", (manifest) => manifest.stages.pop());
    await rejection(
      () => verifyStoredStage8Boundary(missingStage.run, missingStage.artifacts),
      "INVALID_WORKFLOW_MANIFEST",
    );

    const missingArtifact = await syntheticValidPackage();
    mutateJsonArtifact(missingArtifact, "manifest", (manifest) => {
      manifest.stages[4].artifacts.pop();
    });
    await rejection(
      () => verifyStoredStage8Boundary(missingArtifact.run, missingArtifact.artifacts),
      "INVALID_WORKFLOW_MANIFEST",
    );
  });

  it("requires a canonical Draft package manifest with unique valid records", async () => {
    const promoted = await syntheticValidPackage();
    mutateJsonArtifact(promoted, "package-manifest", (manifest) => {
      manifest.lifecycle_state = "final";
    });
    rebindStage8Artifact(promoted, "package-manifest");
    await rejection(
      () => verifyStoredStage8Boundary(promoted.run, promoted.artifacts),
      "INVALID_PACKAGE_MANIFEST",
    );

    const duplicate = await syntheticValidPackage();
    mutateJsonArtifact(duplicate, "package-manifest", (manifest) => {
      manifest.files.push(structuredClone(manifest.files[0]));
      manifest.file_count = manifest.files.length;
    });
    rebindStage8Artifact(duplicate, "package-manifest");
    await rejection(
      () => verifyStoredStage8Boundary(duplicate.run, duplicate.artifacts),
      "INVALID_PACKAGE_MANIFEST",
    );
  });

  it("binds every package selector and every manifest file to one stored row", async () => {
    const selectorDrift = await syntheticValidPackage();
    mutateJsonArtifact(selectorDrift, "package-manifest", (manifest) => {
      const draft = manifest.files.find(
        (file: { category: string; stage_id?: string }) =>
          file.category === "narrative" && file.stage_id === "draft_dar",
      );
      draft.stage_id = "country_research";
    });
    rebindStage8Artifact(selectorDrift, "package-manifest");
    await rejection(
      () => verifyStoredStage8Boundary(selectorDrift.run, selectorDrift.artifacts),
      "INVALID_PACKAGE_MAPPING",
    );

    const missingStoredFile = await syntheticValidPackage();
    missingStoredFile.artifacts = missingStoredFile.artifacts.filter(
      (candidate) => candidate.relativePath !== "inputs/uploads-manifest.json",
    );
    await rejection(
      () => verifyStoredStage8Boundary(missingStoredFile.run, missingStoredFile.artifacts),
      "INVALID_PACKAGE_MAPPING",
    );

    const fakeSource = await syntheticValidPackage();
    mutateJsonArtifact(fakeSource, "package-manifest", (manifest) => {
      const stageFile = manifest.files.find(
        (file: { stage_id?: string; artifact_id?: string }) =>
          file.stage_id === "country_research" && file.artifact_id === "country_evidence_data",
      );
      stageFile.source_sha256 = "f".repeat(64);
    });
    rebindStage8Artifact(fakeSource, "package-manifest");
    await rejection(
      () => verifyStoredStage8Boundary(fakeSource.run, fakeSource.artifacts),
      "INVALID_PACKAGE_MAPPING",
    );
  });

  it("cannot rewrite the declared assessment input without the exact stored bytes", async () => {
    const fixture = await syntheticValidPackage();
    const forgedPath = "stages/01-damm_diagnostic/00-forged-engine-input.json";
    const forgedSha256 = "f".repeat(64);
    mutateJsonArtifact(fixture, "manifest", (manifest) => {
      const stage1 = manifest.stages[0];
      const selected = stage1.artifacts.find(
        (candidate: { key: string }) => candidate.key === "engine_input",
      );
      selected.path = forgedPath;
      selected.sha256 = forgedSha256;
    });
    mutateJsonArtifact(fixture, "methodology-manifest", (manifest) => {
      manifest.assessment_input = { path: forgedPath, sha256: forgedSha256 };
    });

    const stageManifestKey = "data-damm_diagnostic-stage_manifest-json";
    const stageManifest = JSON.parse(decoder.decode(artifact(fixture, stageManifestKey).content));
    stageManifest.output_hashes.engine_input = forgedSha256;
    await replaceManifestedPackageFile(
      fixture,
      stageManifestKey,
      bytes(JSON.stringify(stageManifest)),
      { rebindSource: true },
    );
    const forgedStageManifestSha256 = artifact(fixture, stageManifestKey).sha256;
    mutateJsonArtifact(fixture, "manifest", (manifest) => {
      const stageManifestRecord = manifest.stages[0].artifacts.find(
        (candidate: { key: string }) => candidate.key === "stage_manifest",
      );
      stageManifestRecord.sha256 = forgedStageManifestSha256;
    });

    const packagedWorkflow = JSON.parse(
      decoder.decode(artifact(fixture, "package-workflow-manifest").content),
    );
    const packagedSelected = packagedWorkflow.stages[0].artifacts.find(
      (candidate: { key: string }) => candidate.key === "engine_input",
    );
    packagedSelected.path = forgedPath;
    packagedSelected.sha256 = forgedSha256;
    const packagedStageManifest = packagedWorkflow.stages[0].artifacts.find(
      (candidate: { key: string }) => candidate.key === "stage_manifest",
    );
    packagedStageManifest.sha256 = forgedStageManifestSha256;
    await replaceManifestedPackageFile(
      fixture,
      "package-workflow-manifest",
      bytes(JSON.stringify(packagedWorkflow)),
      { rebindSource: true },
    );

    await rejection(
      () => verifyStoredStage8Boundary(fixture.run, fixture.artifacts),
      "INVALID_PACKAGE_MAPPING",
    );
  });

  it("pins the packaged workflow contract and input snapshot to the root identities", async () => {
    const inputDrift = await syntheticValidPackage();
    await replaceManifestedPackageFile(
      inputDrift,
      "package-input-snapshot",
      bytes("self-consistent but different input snapshot"),
    );
    await rejection(
      () => verifyStoredStage8Boundary(inputDrift.run, inputDrift.artifacts),
      "INVALID_PACKAGE_MAPPING",
    );

    const contractDrift = await syntheticValidPackage();
    await replaceManifestedPackageFile(
      contractDrift,
      "package-workflow-contract",
      bytes("self-consistent but different workflow contract"),
    );
    await rejection(
      () => verifyStoredStage8Boundary(contractDrift.run, contractDrift.artifacts),
      "INVALID_PACKAGE_MAPPING",
    );
  });

  it("requires a parseable exact ZIP with authoritative manifest and hash-bound files", async () => {
    const unmanifested = await syntheticValidPackage();
    const extraBundle = await archiveSyntheticStage8Package(
      unmanifested.packageBytes,
      unmanifested.packageManifestBytes,
      { extra: new Map([["unmanifested.txt", bytes("not declared")]]) },
    );
    replaceContent(artifact(unmanifested, "bundle"), extraBundle);
    rebindStage8Artifact(unmanifested, "bundle");
    await rejection(
      () => verifyStoredStage8Boundary(unmanifested.run, unmanifested.artifacts),
      "INVALID_ARCHIVE",
    );

    const corrupted = await syntheticValidPackage();
    const firstPath = corrupted.packageFiles[0].path;
    const corruptBundle = await archiveSyntheticStage8Package(
      corrupted.packageBytes,
      corrupted.packageManifestBytes,
      { override: new Map([[firstPath, bytes("different archived bytes")]]) },
    );
    replaceContent(artifact(corrupted, "bundle"), corruptBundle);
    rebindStage8Artifact(corrupted, "bundle");
    await rejection(
      () => verifyStoredStage8Boundary(corrupted.run, corrupted.artifacts),
      "INVALID_ARCHIVE",
    );

    const malformed = await syntheticValidPackage();
    replaceContent(artifact(malformed, "bundle"), bytes("not a zip"));
    rebindStage8Artifact(malformed, "bundle");
    await rejection(
      () => verifyStoredStage8Boundary(malformed.run, malformed.artifacts),
      "INVALID_ARCHIVE",
    );
  });

  it("rejects duplicate raw central-directory names before JSZip can collapse them", async () => {
    const fixture = await syntheticValidPackage();
    replaceBundle(
      fixture,
      duplicateFirstCentralDirectoryRecord(artifact(fixture, "bundle").content),
    );
    await rejection(
      () => verifyStoredStage8Boundary(fixture.run, fixture.artifacts),
      "INVALID_ARCHIVE",
      /repeats entry name/,
    );
  });

  it("rejects unmanifested bytes between the local records and central directory", async () => {
    const fixture = await syntheticValidPackage();
    replaceBundle(
      fixture,
      insertBytesBeforeCentralDirectory(
        artifact(fixture, "bundle").content,
        bytes("UNMANIFESTED-HIDDEN-BYTES"),
      ),
    );
    await rejection(
      () => verifyStoredStage8Boundary(fixture.run, fixture.artifacts),
      "INVALID_ARCHIVE",
      /local record coverage/,
    );
  });

  it("accepts exact ZIP local records that use signed and unsigned data descriptors", async () => {
    for (const descriptorForm of ["signed", "unsigned"] as const) {
      for (const localMetadata of ["zero", "matching"] as const) {
        const fixture = await syntheticValidPackage();
        const signed = await archiveWithDataDescriptors(fixture);
        const descriptorArchive =
          descriptorForm === "signed" ? signed : unsignedLastDataDescriptor(signed);
        replaceBundle(
          fixture,
          localMetadata === "zero"
            ? descriptorArchive
            : matchingLastDescriptorLocalMetadata(descriptorArchive),
        );

        const verified = await verifyStoredStage8Boundary(fixture.run, fixture.artifacts);

        assert.equal(verified.bundleSha256, artifact(fixture, "bundle").sha256);
      }
    }
  });

  for (const descriptorForm of ["signed", "unsigned"] as const) {
    it(`rejects contradictory nonzero local metadata in ${descriptorForm} data descriptors`, async () => {
      const fixture = await syntheticValidPackage();
      const signed = await archiveWithDataDescriptors(fixture);
      const descriptorArchive =
        descriptorForm === "signed" ? signed : unsignedLastDataDescriptor(signed);
      replaceBundle(fixture, contradictoryLastDescriptorLocalMetadata(descriptorArchive));

      await rejection(
        () => verifyStoredStage8Boundary(fixture.run, fixture.artifacts),
        "INVALID_ARCHIVE",
        /inconsistent byte metadata/,
      );
    });
  }

  it("rejects encrypted, ZIP64, and out-of-bounds central-directory records", async () => {
    const encrypted = await syntheticValidPackage();
    replaceBundle(encrypted, encryptedFirstZipEntry(artifact(encrypted, "bundle").content));
    await rejection(
      () => verifyStoredStage8Boundary(encrypted.run, encrypted.artifacts),
      "INVALID_ARCHIVE",
      /encryption|unsupported entry features/,
    );

    const zip64 = await syntheticValidPackage();
    replaceBundle(zip64, zip64SentinelDirectory(artifact(zip64, "bundle").content));
    await rejection(
      () => verifyStoredStage8Boundary(zip64.run, zip64.artifacts),
      "INVALID_ARCHIVE",
      /ZIP64/,
    );

    const outOfBounds = await syntheticValidPackage();
    replaceBundle(
      outOfBounds,
      outOfBoundsCentralDirectory(artifact(outOfBounds, "bundle").content),
    );
    await rejection(
      () => verifyStoredStage8Boundary(outOfBounds.run, outOfBounds.artifacts),
      "INVALID_ARCHIVE",
      /out-of-bounds|bounds/,
    );
  });
});
