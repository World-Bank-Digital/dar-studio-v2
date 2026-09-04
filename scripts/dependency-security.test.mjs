import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createIPX } from "ipx";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = require("sharp");
const toml = require("toml");

function dependencyState() {
  return {
    manifest: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    lock: JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")),
  };
}

test("the deployment TOML parser rejects prototype-chain traversal", () => {
  const marker = "darStudioPrototypePolluted";
  delete Object.prototype[marker];

  try {
    assert.throws(
      () =>
        toml.parse(`[a.b]
y = 1
[a.b.y.__proto__.__proto__]
${marker} = "yes"`),
      /cannot|invalid|key|redefine|reserved|table/i,
    );
    assert.equal({}[marker], undefined);
  } finally {
    delete Object.prototype[marker];
  }
});

test("the deployment TOML parser bounds recursive input without overflowing the stack", () => {
  const deeplyNestedArray = `${"[".repeat(3_000)}1${"]".repeat(3_000)}`;

  assert.throws(
    () => toml.parse(`a = ${deeplyNestedArray}`),
    (error) =>
      error instanceof Error &&
      !(error instanceof RangeError) &&
      /maximum nesting depth/i.test(error.message),
  );
});

test("security overrides stay exact and outside the production dependency graph", () => {
  const { manifest, lock } = dependencyState();

  assert.equal(manifest.overrides?.toml, "4.2.0");
  assert.equal(lock.packages?.["node_modules/toml"]?.version, "4.2.0");
  assert.equal(lock.packages?.["node_modules/toml"]?.dev, true);
  assert.equal(manifest.overrides?.sharp, "0.35.4");
  assert.equal(lock.packages?.["node_modules/sharp"]?.version, "0.35.4");
  assert.equal(lock.packages?.["node_modules/sharp"]?.dev, true);
});

test("unused presentation tooling is absent from the release dependency graph", () => {
  const { manifest, lock } = dependencyState();

  assert.equal(manifest.devDependencies?.pptxgenjs, undefined);
  assert.equal(lock.packages?.["node_modules/pptxgenjs"], undefined);
  assert.equal(lock.packages?.["node_modules/image-size"], undefined);
});

test("Netlify image tooling uses a patched sharp and still transforms images through IPX", async () => {
  const source = await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const ipx = createIPX({
    storage: {
      name: "synthetic-fixture",
      getMeta: () => ({}),
      getData: () => source,
    },
  });
  const transformed = await ipx("fixture.png", { w: "2", f: "webp" }).process();
  const metadata = await sharp(transformed.data).metadata();

  assert.equal(transformed.format, "webp");
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.format, "webp");
});
