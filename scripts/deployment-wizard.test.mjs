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

test("the deployment wizard verifies the append-only DAMM source repin", () => {
  const wizard = readFileSync(
    join(root, "scripts/deploy/netlify-neon-render-ohio.sh"),
    "utf8",
  );

  assert.match(wizard, /migrations\/0013_damm_methodology_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0014_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /MIGRATION_0014_VERIFIED/);
  assert.match(wizard, /0014_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /d4c659f5873f3a891634c8edf6b7166cb2eb374c/);
  assert.doesNotMatch(wizard, /92c6ffe8b331347bc05f345785fe409753401a24/);
});

test("the deployment wizard keeps the private DAMM build credential out of env values", () => {
  const wizard = readFileSync(
    join(root, "scripts/deploy/netlify-neon-render-ohio.sh"),
    "utf8",
  );

  assert.match(wizard, /Secret Files > Add Secret File/);
  assert.match(wizard, /damm_git_netrc/);
  assert.match(wizard, /machine github\.com/);
  assert.match(wizard, /Contents permission Read-only/);
  assert.match(wizard, /Metadata Read-only appears automatically/);
  assert.match(wizard, /RUN --mount=type=secret,id=damm_git_netrc/);
  assert.match(wizard, /fetch --depth=1 --no-tags origin/);
  assert.match(wizard, /automatically starts the worker retry/);
  assert.match(wizard, /Live, Failed, or Canceled/);
  assert.match(wizard, /delete\/revoke its fine-grained PAT/);
  assert.ok(
    wizard.indexOf("set Auto Sync to No") <
      wizard.indexOf("Secret Files > Add Secret File"),
  );
  assert.ok(
    wizard.indexOf("Save Changes. Render automatically starts the worker retry") <
      wizard.indexOf("delete/revoke its fine-grained PAT"),
  );
  assert.ok(
    wizard.indexOf("delete/revoke its fine-grained PAT") <
      wizard.indexOf('ask RENDER_WORKER_DEPLOY_SHA "Commit SHA shown for the worker deploy:"'),
  );
  assert.ok(
    wizard.indexOf("delete/revoke its fine-grained PAT") <
      wizard.indexOf('open_url "$ARTIFACT_GATEWAY_URL/healthz"'),
  );
  const credentialNames =
    /(?:damm_git_netrc|DAMM_(?:GIT_)?(?:TOKEN|PAT|PASSWORD)|GITHUB_(?:TOKEN|PAT|PASSWORD)|GH_(?:TOKEN|PAT|PASSWORD))/i;
  for (const command of [
    "ask",
    "ask_secret",
    "generate_secret",
    "set_secret",
    "set_var",
    "write_env",
    "write_optional",
  ]) {
    assert.doesNotMatch(wizard, new RegExp(`\\b${command}\\s+${credentialNames.source}`, "i"));
  }
  assert.match(wizard, /key:\[\[:space:\]\]\*\(damm_git_netrc\|/);
});
