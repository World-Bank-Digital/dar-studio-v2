import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortedJsonValue(child)]),
    );
  }
  return value;
}

/**
 * Build-time integrity gate for app-owned methodology assets. Runtime performs the
 * complementary clean-source-checkout and pipeline-byte verification before execution.
 */
export function verifyDammMethodologyAssets(root = process.cwd()) {
  const dataDirectory = join(root, "src/data");
  const manifest = object(
    JSON.parse(readFileSync(join(dataDirectory, "damm_model_manifest.json"), "utf8")),
    "DAMM model export manifest",
  );
  const appDigests = object(manifest.sha256, "DAMM app digest map");
  const entries = Object.entries(appDigests);
  const schemaEntry = entries.find(([filename]) => filename.endsWith(".schema.json"));
  const modelEntries = entries.filter(([filename]) => !filename.endsWith(".schema.json"));
  if (entries.length !== 2 || !schemaEntry || modelEntries.length !== 1) {
    throw new Error("DAMM model export manifest must name one model and one schema");
  }
  const [modelFilename, modelDigest] = modelEntries[0];
  const [schemaFilename, schemaDigest] = schemaEntry;
  if (!SHA256.test(String(modelDigest)) || !SHA256.test(String(schemaDigest))) {
    throw new Error("DAMM app asset digests must be lowercase SHA-256 values");
  }

  const modelBytes = readFileSync(join(dataDirectory, modelFilename));
  const schemaBytes = readFileSync(join(dataDirectory, schemaFilename));
  if (digest(modelBytes) !== modelDigest || digest(schemaBytes) !== schemaDigest) {
    throw new Error("DAMM app model or schema bytes drifted from the export manifest");
  }
  const model = object(JSON.parse(modelBytes.toString("utf8")), "DAMM model");
  object(JSON.parse(schemaBytes.toString("utf8")), "DAMM model schema");
  const source = object(manifest.source, "DAMM source identity");
  const sourceDigests = object(manifest.source_sha256, "DAMM source digest map");
  const runtime = object(manifest.runtime, "DAMM runtime identity");
  const census = object(runtime.indicator_census, "DAMM indicator census identity");
  const engine = object(runtime.engine, "DAMM engine identity");
  const renderer = object(runtime.renderer, "DAMM renderer identity");

  if (
    manifest.model_id !== model.model ||
    manifest.model_version !== model.version ||
    manifest.model_revision !== model.revision ||
    manifest.model_status !== model.status ||
    manifest.ratified !== model.ratified ||
    sourceDigests[source.model_path] !== modelDigest ||
    !SHA256.test(String(sourceDigests[source.schema_path] ?? "")) ||
    census.revision !== `DAMM-v${model.version}-r${model.revision}` ||
    census.path !== `generated:${modelFilename}#indicators` ||
    engine.version !== model.version ||
    engine.path !== model.generated_from ||
    renderer.version !== model.version
  ) {
    throw new Error("DAMM export manifest carries a stale identity, mapping, or version label");
  }

  const censusBytes = `${JSON.stringify(
    sortedJsonValue({
      schema_version: "damm.indicator-census/v1",
      model_id: model.model,
      model_version: model.version,
      model_revision: model.revision,
      indicators: model.indicators,
    }),
    null,
    2,
  )}\n`;
  if (digest(censusBytes) !== census.sha256) {
    throw new Error("DAMM generated indicator census drifted from the canonical model");
  }

  return {
    modelId: model.model,
    version: model.version,
    revision: model.revision,
    sourceCommit: source.commit,
  };
}
