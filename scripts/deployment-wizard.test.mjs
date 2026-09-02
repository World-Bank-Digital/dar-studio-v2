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
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");

  assert.match(wizard, /set \+x/);
  assert.match(wizard, /node scripts\/validate-neon-deployment-urls\.mjs/);
  assert.match(wizard, /validate_neon_connection DATABASE_URL pooled/);
  assert.match(wizard, /validate_neon_connection DATABASE_URL_DIRECT direct/);
  assert.match(wizard, /validate_same_neon_database DATABASE_URL DATABASE_URL_DIRECT/);
  assert.doesNotMatch(wizard, /-pooler\.us-east-2\.aws\.neon\.tech/);
});

test("the deployment wizard requires persisted and two-sided Netlify access evidence", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");

  assert.match(wizard, /fresh configuration reload/);
  assert.match(wizard, /remove_env NETLIFY_VISITOR_ACCESS_MODE/);
  assert.match(wizard, /NETLIFY_VISITOR_ACCESS_LABEL="Team protection"/);
  assert.match(wizard, /NETLIFY_VISITOR_ACCESS_LABEL="Basic protection"/);
  assert.match(wizard, /Protected by \$NETLIFY_VISITOR_ACCESS_LABEL/);
  assert.match(wizard, /Access restricted to All deploys/);
  assert.match(wizard, /anonymous request receive the protection boundary/);
  assert.match(wizard, /fresh authorized session complete the protection challenge and reach DAR Studio/);
  assert.match(wizard, /password manager or Keychain/);
  assert.match(wizard, /Basic protection explicitly authorized/);
  assert.match(wizard, /defined distribution\/rotation plan/);
  assert.doesNotMatch(wizard, /write_env\s+NETLIFY_(?:BASIC_)?PASSWORD/i);
  assert.match(wizard, /write_env NETLIFY_VISITOR_ACCESS_MODE "\$NETLIFY_VISITOR_ACCESS_MODE"/);
  assert.match(wizard, /write_env NETLIFY_VISITOR_ACCESS_SCOPE "all-deploys"/);
  assert.match(wizard, /write_env NETLIFY_ANONYMOUS_DENIAL_VERIFIED "true"/);
  assert.match(wizard, /write_env NETLIFY_AUTHORIZED_ACCESS_VERIFIED "true"/);
  assert.ok(
    wizard.indexOf("remove_env NETLIFY_VISITOR_ACCESS_MODE") <
      wizard.indexOf('ask NETLIFY_VISITOR_ACCESS_MODE "Persisted Visitor access mode'),
  );
  assert.ok(
    wizard.indexOf("fresh configuration reload") <
      wizard.indexOf("anonymous request receive the protection boundary"),
  );
  assert.ok(
    wizard.indexOf("anonymous request receive the protection boundary") <
      wizard.indexOf("fresh authorized session complete the protection challenge and reach DAR Studio"),
  );
  assert.ok(
    wizard.indexOf("fresh authorized session complete the protection challenge and reach DAR Studio") <
      wizard.indexOf('write_env NETLIFY_VISITOR_ACCESS_MODE "$NETLIFY_VISITOR_ACCESS_MODE"'),
  );
});

test("the deployment wizard verifies progressive storage and the prior cutover before the current DAMM source repin", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");

  assert.match(wizard, /migrations\/0013_damm_methodology_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0014_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0015_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0016_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0017_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0018_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0019_progressive_stage_artifacts\.sql/);
  assert.match(wizard, /migrations\/0020_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0021_damm_source_pin_cutover\.sql/);
  assert.ok(
    wizard.indexOf("migrations/0019_progressive_stage_artifacts.sql") <
      wizard.indexOf("migrations/0020_damm_source_pin_cutover.sql"),
  );
  assert.ok(
    wizard.indexOf("migrations/0020_damm_source_pin_cutover.sql") <
      wizard.indexOf("migrations/0021_damm_source_pin_cutover.sql"),
  );
  assert.match(wizard, /MIGRATION_0019_VERIFIED/);
  assert.match(wizard, /MIGRATION_0020_VERIFIED/);
  assert.match(wizard, /MIGRATION_0021_VERIFIED/);
  assert.match(wizard, /0019_progressive_stage_artifacts\.sql/);
  assert.match(wizard, /0020_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /0021_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /pre-0021-YYYYMMDD-HHMM/);
  assert.match(wizard, /suspend the preceding-pin Render worker before merging or applying 0021/);
  assert.match(wizard, /existing worker visibly suspended/);
  assert.match(wizard, /f7dfbbb647e0a45d996e94f62d49f2218d518c94/);
  assert.match(wizard, /95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be/);
  assert.doesNotMatch(wizard, /e866e7a1fffd5edb14f53da5e038f69b2ec29af2/);
  assert.doesNotMatch(wizard, /386ccb90904de4109b64b7c62d4ed7beed8daede/);
  assert.doesNotMatch(wizard, /4b97b2c9090204dfba3aa7c44f41d558005982ee/);
  assert.doesNotMatch(wizard, /1b1734c8a8017cda488b77cf0594b0ca82dae6ee/);
  assert.doesNotMatch(wizard, /2efb26607acc29a687a82a56edc85f53c4a6da69/);
  assert.doesNotMatch(wizard, /d4c659f5873f3a891634c8edf6b7166cb2eb374c/);
  assert.doesNotMatch(wizard, /92c6ffe8b331347bc05f345785fe409753401a24/);
});

test("the deployment wizard keeps the private DAMM build credential out of env values", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");

  assert.match(wizard, /Secret Files > Add Secret File/);
  assert.match(wizard, /damm_git_netrc/);
  assert.match(wizard, /machine github\.com/);
  assert.match(wizard, /Contents permission Read-only/);
  assert.match(wizard, /Metadata Read-only appears automatically/);
  assert.match(wizard, /RUN --mount=type=secret,id=damm_git_netrc/);
  assert.match(wizard, /fetch --depth=1 --no-tags origin/);
  assert.match(wizard, /Refresh origin\/main before a one-attempt token is created/);
  assert.match(wizard, /Refresh origin\/main again immediately before the build credential is loaded/);
  assert.match(wizard, /Refresh origin\/main again immediately before resume/);
  assert.match(wizard, /Render's displayed latest commit to build/);
  assert.ok((wizard.match(/git fetch --quiet origin main/g) ?? []).length >= 4);
  assert.match(wizard, /Before every live-token upload or replacement/);
  assert.match(wizard, /including this initial one/);
  assert.match(wizard, /service to be visibly Suspended/);
  assert.match(wizard, /Only after the source identity and suspension gates pass, create/);
  assert.match(wizard, /Pre-load source check failed:[^\n]*immediately revoke/);
  assert.match(wizard, /Pre-resume source check failed:[^\n]*immediately revoke/);
  assert.match(wizard, /require the Secret Files editor to leave edit mode/);
  assert.match(wizard, /compare the persisted value byte-for-byte/);
  assert.match(wizard, /Persistence mismatch:[^\n]*immediately revoke/);
  assert.match(wizard, /active-workflow query still return zero rows/);
  assert.match(wizard, /Zero-active gate failed:[^\n]*immediately revoke/);
  assert.match(wizard, /Resume the suspended worker/);
  assert.match(wizard, /Render starts the exact latest-commit build/);
  assert.match(wizard, /Live, Failed, or Canceled/);
  assert.match(wizard, /delete\/revoke its fine-grained PAT/);
  assert.doesNotMatch(wizard, /Save Changes[^\n]*automatically starts/i);
  assert.ok(
    wizard.indexOf("set Auto Sync to No") < wizard.indexOf("Secret Files > Add Secret File"),
  );
  assert.ok(
    wizard.indexOf("Refresh origin/main before a one-attempt token is created") <
      wizard.indexOf("Before every live-token upload or replacement"),
  );
  assert.ok(
    wizard.indexOf("Before every live-token upload or replacement") <
      wizard.indexOf("Only after the source identity and suspension gates pass, create"),
  );
  assert.ok(
    wizard.indexOf("Only after the source identity and suspension gates pass, create") <
      wizard.indexOf("Refresh origin/main again immediately before the build credential is loaded"),
  );
  assert.ok(
    wizard.indexOf("Refresh origin/main again immediately before the build credential is loaded") <
      wizard.indexOf("Secret Files > Add Secret File"),
  );
  assert.ok(
    wizard.indexOf("compare the persisted value byte-for-byte") <
      wizard.indexOf("active-workflow query still return zero rows"),
  );
  assert.ok(
    wizard.indexOf("active-workflow query still return zero rows") <
      wizard.indexOf("Refresh origin/main again immediately before resume"),
  );
  assert.ok(
    wizard.indexOf("Refresh origin/main again immediately before resume") <
      wizard.indexOf("Render's displayed latest commit to build"),
  );
  assert.ok(
    wizard.indexOf("Render's displayed latest commit to build") <
      wizard.indexOf("Resume the suspended worker"),
  );
  assert.ok(
    wizard.indexOf("Resume the suspended worker") <
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
