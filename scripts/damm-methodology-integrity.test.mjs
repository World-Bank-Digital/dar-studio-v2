import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDammMethodologyAssets } from "./damm-methodology-integrity.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILENAMES = ["damm_model_manifest.json", "model_v1_7.json", "model_v1_7.schema.json"];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "damm-build-integrity-"));
  const data = join(root, "src/data");
  await mkdir(data, { recursive: true });
  for (const filename of FILENAMES) {
    await copyFile(join(ROOT, "src/data", filename), join(data, filename));
  }
  return root;
}

describe("DAMM build-time methodology integrity", () => {
  it("accepts the repository's exact model-derived asset set", () => {
    assert.deepEqual(verifyDammMethodologyAssets(ROOT), {
      modelId: "DAMM",
      version: "1.7",
      revision: 2,
      sourceCommit: "386ccb90904de4109b64b7c62d4ed7beed8daede",
    });
  });

  it("preserves the preceding methodology cutover migration byte for byte", async () => {
    const migration = await readFile(
      join(ROOT, "migrations/0013_damm_methodology_pin_cutover.sql"),
    );
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "d91a670add7bb09929ac8d48748dc66c748706ad1242c489de062bbedad2988a",
    );
  });

  it("preserves DAMM source cutover migration 0014 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0014_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "8cc52a34509c38c2043afd8f4188218155761c169ddeedf97d54f07eedf6a199",
    );
  });

  it("preserves DAMM source cutover migration 0015 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0015_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "7d146e443bec3870fed283ade99ebf0530957b0d741a4cca23308f01ff613627",
    );
  });

  it("preserves DAMM source cutover migration 0016 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0016_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "204fdebecf8a9295e8a6cfbd6e4bc5e615fab701dcb3de8b333eef2a2bbd4349",
    );
  });

  it("preserves DAMM source cutover migration 0017 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0017_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "59c4d1f9a8fe22629b56a6c31b386c95ddbf0616f25fbb3643abed826ec61a44",
    );
  });

  it("rejects threshold bytes that drift without a canonical export", async () => {
    const root = await fixture();
    try {
      const filename = join(root, "src/data/model_v1_7.json");
      const model = JSON.parse(await readFile(filename, "utf8"));
      model.bands[0].hi += 0.01;
      await writeFile(filename, `${JSON.stringify(model, null, 2)}\n`);
      assert.throws(() => verifyDammMethodologyAssets(root), /bytes drifted/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a self-declared mapping change until its generated census is regenerated", async () => {
    const root = await fixture();
    try {
      const data = join(root, "src/data");
      const modelFilename = join(data, "model_v1_7.json");
      const manifestFilename = join(data, "damm_model_manifest.json");
      const model = JSON.parse(await readFile(modelFilename, "utf8"));
      model.indicators[0].use_cases = ["AI"];
      const modelBytes = `${JSON.stringify(model, null, 2)}\n`;
      await writeFile(modelFilename, modelBytes);
      const manifest = JSON.parse(await readFile(manifestFilename, "utf8"));
      const hash = createHash("sha256").update(modelBytes).digest("hex");
      manifest.sha256["model_v1_7.json"] = hash;
      manifest.source_sha256[manifest.source.model_path] = hash;
      await writeFile(manifestFilename, `${JSON.stringify(manifest, null, 2)}\n`);
      assert.throws(() => verifyDammMethodologyAssets(root), /census drifted/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects stale runtime version labels even when the manifest is valid JSON", async () => {
    const root = await fixture();
    try {
      const filename = join(root, "src/data/damm_model_manifest.json");
      const manifest = JSON.parse(await readFile(filename, "utf8"));
      manifest.runtime.renderer.version = "1.6";
      await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
      assert.throws(() => verifyDammMethodologyAssets(root), /stale.*version label/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
