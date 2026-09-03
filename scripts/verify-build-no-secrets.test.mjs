import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = join(root, "scripts/verify-build-no-secrets.mjs");
const marker = "NEVER PRINT THIS/RELEASE?SECRET=VALUE";

function fixture(content) {
  const directory = mkdtempSync(join(tmpdir(), "dar-build-secret-scan-"));
  mkdirSync(join(directory, "dist/client"), { recursive: true });
  mkdirSync(join(directory, ".netlify/v1/functions"), { recursive: true });
  writeFileSync(join(directory, "dist/client/app.js"), content);
  writeFileSync(join(directory, ".netlify/v1/functions/server.mjs"), "export default {};");
  return directory;
}

function verify(directory) {
  return spawnSync(process.execPath, [verifier, "TEST_RELEASE_SECRET"], {
    cwd: directory,
    env: { ...process.env, TEST_RELEASE_SECRET: marker },
    encoding: "utf8",
  });
}

test("the release-output scan accepts files that contain no configured secret", () => {
  const directory = fixture("public build output");
  try {
    const result = verify(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scanned 2 files/i);
    assert.equal((result.stdout + result.stderr).includes(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [label, leak] of [
  ["plaintext", marker],
  ["base64", Buffer.from(marker).toString("base64")],
  ["URI-encoded", encodeURIComponent(marker)],
]) {
  test(`the release-output scan rejects a ${label} secret without disclosing it`, () => {
    const directory = fixture(`const leaked = ${JSON.stringify(leak)};`);
    try {
      const result = verify(directory);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /TEST_RELEASE_SECRET/);
      assert.match(result.stderr, /dist\/client\/app\.js/);
      assert.equal((result.stdout + result.stderr).includes(marker), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
