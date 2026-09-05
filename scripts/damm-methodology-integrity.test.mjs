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
      sourceCommit: "3cd0c599ff137a09a1892b498f0eecfca5f43785",
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

  it("preserves DAMM source cutover migration 0018 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0018_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "0c7d56834ccac32996e36c17c593f1a92d3272b1824a2ae68ec0d6a171eaac36",
    );
  });

  it("preserves progressive stage artifact migration 0019 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0019_progressive_stage_artifacts.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "8d4d63c79663cd2ab370e69d97355189255c6e66ec1c669ecf311b8d7c10d8fe",
    );
  });

  it("preserves DAMM source cutover migration 0020 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0020_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "7620ad00a35e6e4e4614151cad66fdd9d7f9ccaf9d307a2953238dcf07976a59",
    );
  });

  it("pins DAMM source cutover migration 0021 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0021_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "02e43eefdc4f36e3917118c6dafb6d5b467086dff148470818f42b00853646ce",
    );
  });

  it("pins DAMM source cutover migration 0022 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0022_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "8bde638974122ffc00d0b0d651c7e993bf26dc48288b6b14ac107d833908a5e8",
    );
  });

  it("pins DAMM source cutover migration 0023 byte for byte", async () => {
    const migration = await readFile(join(ROOT, "migrations/0023_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "875f64eded83a97870ff03ff20ea84c815e7d9071730a669494dbbd06e914114",
    );
  });

  it("cuts migration 0024 over to the reviewed DAMM source only", async () => {
    const migration = await readFile(join(ROOT, "migrations/0024_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "a4abf1cf597fa36e722b0af1aa942d14c018507c006ab75fbc4e39d80f431769",
    );
    const text = migration.toString("utf8");
    assert.match(text, /76ca33d97f0809a6be7477447786953317aa41b5/);
    assert.doesNotMatch(text, /68e1994b5facfaaf0ddc49ba3bec108d9bde2c55/);
  });

  it("cuts migration 0025 over to the fail-closed DAMM source only", async () => {
    const migration = await readFile(join(ROOT, "migrations/0025_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "7cfb1cefab433e3e8a70c08f8ce8d7dc99d90a781d62c252aecb7b38426c9494",
    );
    const text = migration.toString("utf8");
    assert.match(text, /d81d267133eed52b5fdcc599bfecf8d72496f292/);
    assert.doesNotMatch(text, /76ca33d97f0809a6be7477447786953317aa41b5/);
  });

  it("pins the reviewed Reader source cutover migration 0026", async () => {
    const migration = await readFile(join(ROOT, "migrations/0026_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "daf784ba8fb92ce72a0bcddb6b8bbded5b0e502b240d6952a450730e7518bdea",
    );
    assert.match(migration.toString("utf8"), /d708dbd0129cfb7f37dcf003875c439367b7c97d/);
  });

  it("pins the reviewed workflow reliability source cutover migration 0027", async () => {
    const migration = await readFile(join(ROOT, "migrations/0027_damm_source_pin_cutover.sql"));
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      "fe1accda77ef1c90faaff3792add752d22f7a4800a1ee7c3d6a8d090992c9037",
    );
    const text = migration.toString("utf8");
    assert.match(text, /7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb/);
    assert.doesNotMatch(text, /d708dbd0129cfb7f37dcf003875c439367b7c97d/);
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
