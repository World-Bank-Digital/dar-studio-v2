import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const validator = join(root, "scripts/validate-neon-deployment-urls.mjs");
const passwordMarker = "NEVER-PRINT-THIS-PASSWORD";
const pooled = `postgresql://role:${passwordMarker}@ep-dar-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`;
const direct = `postgresql://role:${passwordMarker}@ep-dar.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`;

function validate(mode, input) {
  return spawnSync(process.execPath, [validator, mode], { input, encoding: "utf8" });
}

test("the wizard validator accepts a matching cluster-qualified pooled/direct pair silently", () => {
  for (const [mode, input] of [
    ["pooled", pooled],
    ["direct", direct],
    ["pair", `${pooled}\0${direct}`],
  ]) {
    const result = validate(mode, input);
    assert.equal(result.status, 0, `${mode} validation should pass`);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

test("the wizard validator rejects mismatched or incomplete details without disclosing them", () => {
  for (const candidate of [
    direct.replace("ep-dar.c-5", "ep-other.c-5"),
    direct.replace(".c-5.", ".c-6."),
    direct.replace("/neondb?", "/other?"),
    direct.replace("postgresql://role:", "postgresql://other:"),
    direct.replace(`:${passwordMarker}@`, "@"),
  ]) {
    const result = validate("pair", `${pooled}\0${candidate}`);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(passwordMarker));
  }
});

test("the deployment wizard delegates Neon URL validation to the shared parsed policy", () => {
  const wizard = readFileSync(
    join(root, "scripts/deploy/netlify-neon-render-ohio.sh"),
    "utf8",
  );

  assert.match(wizard, /set \+x/);
  assert.match(wizard, /node scripts\/validate-neon-deployment-urls\.mjs/);
  assert.match(wizard, /validate_neon_connection DATABASE_URL pooled/);
  assert.match(wizard, /validate_neon_connection DATABASE_URL_DIRECT direct/);
  assert.match(wizard, /validate_same_neon_database DATABASE_URL DATABASE_URL_DIRECT/);
  assert.doesNotMatch(wizard, /-pooler\.us-east-2\.aws\.neon\.tech/);
});
