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

test("the deployment wizard reports every operator stage in its progress total", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const configuredTotals = [...wizard.matchAll(/^TOTAL_STAGES=(\d+)$/gm)];
  const invokedStages = [...wizard.matchAll(/^stage "/gm)];

  assert.equal(invokedStages.length, 19, "the reviewed operator flow has 19 stages");
  assert.equal(
    Number(configuredTotals.at(-1)?.[1]),
    19,
    "the displayed total must include all 19 operator stages",
  );
});

test("the deployment wizard runs every zero-spend eight-stage simulation before infrastructure", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  assert.match(wizard, /for simulation_profile in minimal typical dense/);
  assert.match(wizard, /--scenario eight-stage-happy-v1 --profile "\$simulation_profile"/);
  assert.match(wizard, /--scenario nigeria-stage6-overlength-v1 --profile "\$simulation_profile"/);
  assert.match(wizard, /--scenario nigeria-stage6-through-package-v1 --profile typical/);
  assert.ok(
    wizard.indexOf("for simulation_profile in minimal typical dense") <
      wizard.indexOf('stage "Infrastructure access and release authorization"'),
  );
});

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
  assert.match(
    wizard,
    /fresh authorized session complete the protection challenge and reach DAR Studio/,
  );
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
      wizard.indexOf(
        "fresh authorized session complete the protection challenge and reach DAR Studio",
      ),
  );
  assert.ok(
    wizard.indexOf(
      "fresh authorized session complete the protection challenge and reach DAR Studio",
    ) < wizard.indexOf('write_env NETLIFY_VISITOR_ACCESS_MODE "$NETLIFY_VISITOR_ACCESS_MODE"'),
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
  assert.match(wizard, /migrations\/0022_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0023_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /migrations\/0024_damm_source_pin_cutover\.sql/);
  assert.ok(
    wizard.indexOf("migrations/0019_progressive_stage_artifacts.sql") <
      wizard.indexOf("migrations/0020_damm_source_pin_cutover.sql"),
  );
  assert.ok(
    wizard.indexOf("migrations/0020_damm_source_pin_cutover.sql") <
      wizard.indexOf("migrations/0021_damm_source_pin_cutover.sql"),
  );
  assert.ok(
    wizard.indexOf("migrations/0021_damm_source_pin_cutover.sql") <
      wizard.indexOf("migrations/0022_damm_source_pin_cutover.sql"),
  );
  assert.ok(
    wizard.indexOf("migrations/0022_damm_source_pin_cutover.sql") <
      wizard.indexOf("migrations/0023_damm_source_pin_cutover.sql"),
  );
  assert.ok(
    wizard.indexOf("migrations/0023_damm_source_pin_cutover.sql") <
      wizard.indexOf("migrations/0024_damm_source_pin_cutover.sql"),
  );
  assert.match(wizard, /MIGRATION_0019_VERIFIED/);
  assert.match(wizard, /MIGRATION_0020_VERIFIED/);
  assert.match(wizard, /MIGRATION_0021_VERIFIED/);
  assert.match(wizard, /MIGRATION_0022_VERIFIED/);
  assert.match(wizard, /MIGRATION_0023_VERIFIED/);
  assert.match(wizard, /MIGRATION_0024_VERIFIED/);
  assert.match(wizard, /0019_progressive_stage_artifacts\.sql/);
  assert.match(wizard, /0020_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /0021_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /0022_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /0023_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /0024_damm_source_pin_cutover\.sql/);
  assert.match(wizard, /pre-0024-YYYYMMDD-HHMM/);
  assert.match(wizard, /suspend the preceding-pin Render worker before applying 0024/);
  assert.match(
    wizard,
    /reviewed merge is inert only while Netlify builds and Deploy Previews are disabled, Render service auto-deploys are off, and any Blueprint is disconnected/,
  );
  assert.match(wizard, /existing worker visibly suspended/);
  assert.match(wizard, /Are Netlify builds still stopped and Deploy Previews still disabled/);
  assert.match(wizard, /or does no Netlify site exist yet/);
  assert.match(wizard, /Do both existing Render services still have automatic deploys off/);
  assert.match(wizard, /Is the provisioning Blueprint still disconnected or absent/);
  assert.match(wizard, /76ca33d97f0809a6be7477447786953317aa41b5/);
  assert.match(wizard, /95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be/);
  assert.doesNotMatch(wizard, /68e1994b5facfaaf0ddc49ba3bec108d9bde2c55/);
  assert.doesNotMatch(wizard, /ff5aecbfec5c2694a61f282c27db74ea8b99b28c/);
  assert.doesNotMatch(wizard, /f7dfbbb647e0a45d996e94f62d49f2218d518c94/);
  assert.doesNotMatch(wizard, /e866e7a1fffd5edb14f53da5e038f69b2ec29af2/);
  assert.doesNotMatch(wizard, /386ccb90904de4109b64b7c62d4ed7beed8daede/);
  assert.doesNotMatch(wizard, /4b97b2c9090204dfba3aa7c44f41d558005982ee/);
  assert.doesNotMatch(wizard, /1b1734c8a8017cda488b77cf0594b0ca82dae6ee/);
  assert.doesNotMatch(wizard, /2efb26607acc29a687a82a56edc85f53c4a6da69/);
  assert.doesNotMatch(wizard, /d4c659f5873f3a891634c8edf6b7166cb2eb374c/);
  assert.doesNotMatch(wizard, /92c6ffe8b331347bc05f345785fe409753401a24/);
});

test("the deployment wizard keeps paid canary execution behind separate named authorization", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");

  assert.match(
    wizard,
    /This stage does not authorize provider inference\/search or the separately gated paid canary/,
  );
  assert.doesNotMatch(wizard, /run vendor-cost smoke tests/);
  assert.match(wizard, /Deployment-only closeout boundary/);
  assert.match(wizard, /Deployment completion does not authorize either/);
  assert.match(wizard, /separate explicit paid-canary authorization/i);
  assert.match(
    wizard,
    /Reverify every selected provider model ID and tariff against first-party documentation today/,
  );
  assert.match(wizard, /Map the exact Render Jina key to its package\/rate/);
  assert.match(
    wizard,
    /38-file identity b867d6960ac6e0f446e89f9c341b6283fdb3ddfe4326070049bf4a5c097e134c/,
  );
  assert.match(wizard, /exactly one Live worker instance and possible claimant/);
  assert.match(
    wizard,
    /cumulative spend against \$225, \$262\.50, \$312\.50, \$350, \$400, \$425, then strictly below \$500/,
  );
  assert.match(wizard, /Abort without automatic retry\/top-up\/state repair/);
  assert.match(wizard, /Explicitly authorized canary country name/);
  assert.doesNotMatch(wizard, /create a new Nigeria country workspace/i);
});

test("Netlify stays frozen while one exact clean worktree is built and deployed manually", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const guide = readFileSync(join(root, "docs/DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md"), "utf8");
  for (const [source, stageMarker] of [
    [wizard, 'stage "Netlify production deploy"'],
    [guide, "### 14. Deploy and verify the Netlify web application"],
  ]) {
    const stage = source.slice(source.indexOf(stageMarker));
    const closed = stage.indexOf("stop_builds=true");
    const cleanWorktree = stage.indexOf("clean detached worktree", closed);
    const manual = stage.indexOf("manual production deploy", cleanWorktree);
    const commitBinding = stage.indexOf("COMMIT_REF", cleanWorktree);
    assert.ok(closed >= 0, "the stopped-build state must be freshly verified");
    assert.ok(cleanWorktree > closed, "the deploy must be built from an isolated exact checkout");
    assert.ok(manual > cleanWorktree, "the frozen site must use a manual deploy");
    assert.ok(
      commitBinding > cleanWorktree,
      "the local build must bind Netlify COMMIT_REF to the reviewed SHA",
    );
    assert.doesNotMatch(stage, /temporarily activate Netlify builds|stop_builds=false/);
  }
  assert.match(wizard, /pinned Netlify CLI 27\.4\.2/);
  assert.match(wizard, /git worktree add --detach/);
  assert.match(wizard, /--platform linux\/amd64/);
  assert.match(wizard, /NETLIFY_RELEASE_VOLUME_CREATED="false"/);
  assert.match(
    wizard,
    /\$\{NETLIFY_RELEASE_VOLUME_CREATED:-false\}" == "true"[\s\S]*docker volume rm -f/,
  );
  assert.match(
    wizard,
    /NETLIFY_RELEASE_VOLUME=\$\(docker volume create[\s\S]*--label "org\.worldbank\.dar-studio\.release=\$DEPLOY_GIT_SHA"\)/,
  );
  assert.match(wizard, /"\$NETLIFY_RELEASE_VOLUME" =~ \^\[a-f0-9\]\{64\}\$/);
  assert.match(wizard, /org\.worldbank\.dar-studio\.release[\s\S]*docker volume rm -f/);
  assert.doesNotMatch(wizard, /NETLIFY_RELEASE_VOLUME="dar-netlify-release-/);
  assert.match(
    wizard,
    /\[\[ -z "\$\(find \/workspace -mindepth 1 -maxdepth 1 -print -quit\)" \]\]/,
  );
  assert.match(
    wizard,
    /node:22\.22\.3-bookworm@sha256:46e94f8cf91baab69a2deb3153e74eeffd73c20c7cc1d8432f5b96469eaa0322/,
  );
  assert.match(wizard, /AWS_LAMBDA_JS_RUNTIME="nodejs22\.x"/);
  assert.match(
    wizard,
    /env:get AWS_LAMBDA_JS_RUNTIME --context dev --scope functions --site "\$NETLIFY_SITE_ID" --json/,
  );
  assert.match(
    wizard,
    /AWS_LAMBDA_JS_RUNTIME=\$NETLIFY_FUNCTION_RUNTIME: all deploy contexts, Functions only/,
  );
  assert.match(wizard, /verify-netlify-function-bundle\.mjs/);
  assert.match(
    wizard,
    /\.\/node_modules\/\.bin\/netlify deploy --prod --no-build --skip-functions-cache\s+\\\s+--dir dist\/client --functions \.netlify\/v1\/functions\s+\\\s+--site "\$NETLIFY_SITE_ID"/,
  );
  assert.match(
    wizard,
    /for unexpected_deploy_input in[\s\S]*netlify\/functions[\s\S]*\.netlify\/functions-internal[\s\S]*\.netlify\/edge-functions/,
  );
  for (const deployInput of [
    ".netlify/v1/edge-functions",
    ".netlify/edge-functions-dist",
    ".netlify/v1/blobs",
    ".netlify/deploy/v1/blobs",
    ".netlify/blobs",
    ".netlify/deploy-config",
    ".netlify/internal/db/migrations",
  ]) {
    assert.match(wizard, new RegExp(deployInput.replaceAll(".", "\\.")));
  }
  assert.match(wizard, /\.\/node_modules\/\.bin\/netlify env:get AWS_LAMBDA_JS_RUNTIME/);
  assert.doesNotMatch(wizard, /npm exec --offline -- netlify/);
  assert.doesNotMatch(wizard, /deploy --prod --no-build --context/);
  assert.doesNotMatch(wizard, /netlify deploy --trigger|POST .*\/builds/);
});

test("the frozen Netlify build receives operator-held secrets without CLI arguments", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const stage = wizard.slice(wizard.indexOf('stage "Netlify production deploy"'));
  const build = stage.indexOf("npm run build");
  const secretScan = stage.indexOf("node scripts/verify-build-no-secrets.mjs", build);
  const bundleAudit = stage.indexOf("node scripts/verify-netlify-function-bundle.mjs", secretScan);
  const clearSecrets = stage.indexOf("unset DATABASE_URL", secretScan);
  const deploy = stage.indexOf("netlify deploy --prod --no-build", clearSecrets);
  const configMount = stage.indexOf("target=/netlify-auth/config.json,readonly");
  const configInstall = stage.indexOf(
    "install -m 600 /netlify-auth/config.json /root/.config/netlify/config.json",
  );

  assert.match(stage, /docker info/);
  assert.match(stage, /--mount "type=bind,source=\$NETLIFY_RELEASE_DIR,target=\/source,readonly"/);
  assert.match(
    stage,
    /--mount "type=bind,source=\$NETLIFY_CONFIG_PATH,target=\/netlify-auth\/config\.json,readonly"/,
  );
  assert.match(stage, /--tmpfs \/root\/\.config\/netlify:rw,noexec,nosuid,nodev,mode=0700/);
  assert.match(
    stage,
    /install -m 600 \/netlify-auth\/config\.json \/root\/\.config\/netlify\/config\.json/,
  );
  assert.doesNotMatch(
    stage,
    /source=\$NETLIFY_CONFIG_PATH,target=\/root\/\.config\/netlify\/config\.json/,
  );
  assert.match(stage, /cd \/workspace \|\| exit \$\?/);
  assert.match(stage, /export DATABASE_URL/);
  assert.match(stage, /MIGRATION_DATABASE_URL="\$DATABASE_URL_DIRECT"/);
  assert.match(stage, /export DATABASE_URL MIGRATION_DATABASE_URL/);
  assert.match(stage, /export DAR_KEY_SECRET BETTER_AUTH_SECRET ARTIFACT_DELIVERY_SECRET/);
  assert.match(stage, /export GROK_AUTH_ISSUER GROK_AUTH_CLIENT_ID GROK_AUTH_CLIENT_SECRET/);
  assert.ok(build >= 0, "the reviewed checkout must be built locally");
  assert.ok(secretScan > build, "all generated release output must be scanned before upload");
  assert.ok(
    bundleAudit > secretScan,
    "the Linux function archive must pass metadata and PDF extraction smoke before upload",
  );
  assert.ok(
    configMount > bundleAudit && configInstall > bundleAudit,
    "the account-wide Netlify credential must enter only the deploy container after build audit",
  );
  assert.doesNotMatch(stage.slice(0, bundleAudit), /netlify-auth\/config\.json/);
  assert.match(stage.slice(bundleAudit), /for release_name in NETLIFY_SITE_ID DEPLOY_GIT_SHA; do/);
  assert.ok(clearSecrets > secretScan, "build-only secrets must be cleared after scanning");
  assert.ok(deploy > clearSecrets, "the CLI must upload existing output without rebuilding");
  assert.match(stage, /printf '%s\\0'/);
  for (const secretName of [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "DAR_KEY_SECRET",
    "BETTER_AUTH_SECRET",
    "ARTIFACT_DELIVERY_SECRET",
    "GROK_AUTH_CLIENT_SECRET",
  ]) {
    assert.doesNotMatch(
      stage,
      new RegExp(`--env ${secretName}(?:\\s|$)`),
      `${secretName} must not be persisted in Docker container metadata`,
    );
  }
  assert.match(stage, /trap 'cleanup_netlify_release \|\| true' EXIT/);
  assert.match(stage, /trap 'exit 130' HUP INT TERM/);
  assert.doesNotMatch(stage.slice(deploy), /--(?:secret-)?env/);
});

test("the frozen Netlify build does not inherit out-of-scope operator credentials", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const stage = wizard.slice(wizard.indexOf('stage "Netlify production deploy"'));
  const clearExports = stage.indexOf('export -n "$RELEASE_EXPORTED_NAME"');
  const secretlessInstall = stage.indexOf("npm ci");
  const build = stage.indexOf("npm run build", clearExports);
  const deploy = stage.indexOf("netlify deploy --prod --no-build", build);

  assert.ok(clearExports >= 0, "the release subshell must clear its inherited export set");
  assert.ok(secretlessInstall >= 0 && secretlessInstall < clearExports);
  assert.match(
    stage.slice(0, clearExports),
    /Install the exact locked dependency tree without any operator secret/,
  );
  for (const name of [
    "EXA_API_KEY",
    "JINA_API_KEY",
    "PERPLEXITY_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "RESEND_API_KEY",
    "XAI_API_KEY",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "NETLIFY_AUTH_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
  ]) {
    const cleared = stage.indexOf(`unset ${name}`);
    assert.ok(cleared > clearExports && cleared < build, `${name} must be absent before the build`);
  }
  assert.ok(build > clearExports);
  assert.ok(deploy > build);
  assert.match(stage, /AWS_LAMBDA_JS_RUNTIME="nodejs22\.x"/);
  const dockerRestoreStart = stage.indexOf("for RELEASE_BASE_NAME in", clearExports);
  const dockerRestoreEnd = stage.indexOf("done", dockerRestoreStart);
  const dockerRestoreBlock = stage.slice(dockerRestoreStart, dockerRestoreEnd);
  for (const name of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "SSH_AUTH_SOCK",
  ]) {
    assert.match(dockerRestoreBlock, new RegExp(name));
  }
  assert.match(dockerRestoreBlock, /export "\$RELEASE_BASE_NAME"/);
  assert.ok(stage.indexOf("docker info >/dev/null 2>&1", clearExports) > clearExports);
  assert.match(stage, /Temporary Linux release volume survived cleanup/);
  assert.match(stage, /\.\/node_modules\/\.bin\/netlify deploy/);
  assert.match(stage, /--skip-functions-cache/);
});

test("Netlify establishes a stopped-build and deploy-history baseline immediately after import", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const guide = readFileSync(join(root, "docs/DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md"), "utf8");
  for (const [source, startMarker, endMarker] of [
    [
      wizard,
      'stage "Import or verify the main branch in Netlify, then freeze builds"',
      'stage "Netlify Ohio, deploy isolation, and private access"',
    ],
    [guide, "### 8. Import", "### 9."],
  ]) {
    const stage = source.slice(
      source.indexOf(startMarker),
      source.indexOf(endMarker, source.indexOf(startMarker)),
    );
    const terminal = stage.indexOf("initial deploy reaches a terminal state");
    const stop = stage.indexOf("stop Netlify builds", terminal);
    const closed = stage.indexOf("stop_builds=true", stop);
    const history = stage.indexOf("deploy-history baseline", closed);
    assert.ok(terminal >= 0, "the import's automatic deploy must settle or be canceled");
    assert.ok(stop > terminal, "builds must be stopped immediately after import");
    assert.ok(closed > stop, "the stopped state needs a fresh read");
    assert.ok(history > closed, "the initial deploy history must be captured under the freeze");
  }
});

test("Netlify revalidates the exact remote main while builds are frozen", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const guide = readFileSync(join(root, "docs/DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md"), "utf8");
  const wizardStage = wizard.slice(wizard.indexOf('stage "Netlify production deploy"'));
  const guideStage = guide.slice(
    guide.indexOf("### 14. Deploy and verify the Netlify web application"),
  );
  for (const source of [wizardStage, guideStage]) {
    const refresh = source.indexOf("refresh cached origin/main and direct GitHub main");
    const exact = source.indexOf("must both equal DEPLOY_GIT_SHA", refresh);
    const manual = source.indexOf("manual production deploy", exact);
    assert.ok(refresh >= 0, "Netlify needs an immediate two-source main refresh");
    assert.ok(exact > refresh, "both refreshed identities must equal the reviewed deploy SHA");
    assert.ok(manual > exact, "main must be revalidated before the isolated manual deploy");
  }
  assert.ok(wizardStage.indexOf("git fetch --quiet origin main") >= 0);
  assert.ok(wizardStage.indexOf("NETLIFY_TRACKING_SHA=$(git rev-parse origin/main)") >= 0);
  assert.ok(wizardStage.indexOf("NETLIFY_REMOTE_SHA=$(git ls-remote origin refs/heads/main") >= 0);
});

test("declining the separately authorized canary completes the deployment-only flow successfully", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const block = wizard.match(/stage "Deployment-only closeout boundary"([\s\S]*?)# ── 15/)?.[1];
  assert.ok(block, "deployment-only closeout block");
  const harness = `
stage() { :; }
step() { :; }
warn() { :; }
say() { :; }
write_env() { :; }
chmod() { :; }
finish() { printf 'finish-called\\n'; }
confirm() { return 1; }
confirm_or_stop() { confirm "$1" || exit 1; }
DAMM_SOURCE_COMMIT=fixture
ENV_FILE=/dev/null
${block}
printf 'fell-through\\n'
`;
  const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /finish-called/);
  assert.doesNotMatch(result.stdout, /fell-through/);
});

test("the deployment wizard requires exact post-cutover runtime and database evidence", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");

  assert.match(wizard, /exactly 24 total migration rows through 0024/);
  assert.match(wizard, /preserved-failure query/);
  assert.match(wizard, /node=22\.22\.3, python=3\.12\.13, migrations=24 through 0024/);
  assert.match(wizard, /up-to-date exact 24-row ledger through 0024/);
  assert.match(wizard, /Netlify must not be the first process to apply 0024/);
});

test("the deployment wizard deploys the public DAMM source without a build credential", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const manifest = JSON.parse(
    readFileSync(join(root, "src/data/damm_model_manifest.json"), "utf8"),
  );
  const declaredRepository = wizard.match(/^DAMM_PUBLIC_REPOSITORY="([^"]+)"$/m)?.[1];

  assert.match(wizard, /public DAMM/i);
  assert.match(wizard, /anonymous[^\n]*(?:without|no)[^\n]*(?:credential|token)/i);
  assert.match(wizard, /Remove[^\n]*damm_git_netrc Secret File/i);
  assert.doesNotMatch(
    wizard,
    /Secret Files > Add Secret File[^\n]*damm_git_netrc|type=secret,id=damm_git_netrc|create[^\n]*fine-grained PAT/i,
  );
  assert.match(
    wizard,
    /GIT_CONFIG_GLOBAL=\/dev\/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=\/bin\/false/,
  );
  assert.equal(declaredRepository, manifest.source.repository);
  assert.match(wizard, /app manifest does not pin the canonical public DAMM repository/i);
  assert.match(wizard, /https:\/\/github\.com\/World-Bank-Digital\/DAMM/);
  assert.match(wizard, /refs\/heads\/main/);
  const anonymousProbe = wizard.match(/^read_anonymous_damm_main\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(anonymousProbe, "the isolated anonymous DAMM probe must be defined");
  assert.match(anonymousProbe, /mktemp -d/);
  assert.match(anonymousProbe, /install -d -m 0700/);
  assert.match(anonymousProbe, /unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT/);
  assert.match(anonymousProbe, /export GIT_CONFIG_COUNT=0/);
  assert.match(anonymousProbe, /GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(anonymousProbe, /GIT_CONFIG_NOSYSTEM=1/);
  assert.match(anonymousProbe, /GIT_TERMINAL_PROMPT=0/);
  assert.match(anonymousProbe, /GIT_ASKPASS=\/bin\/false/);
  assert.match(anonymousProbe, /credential\.helper=/);
  assert.match(anonymousProbe, /ls-remote "\$DAMM_PUBLIC_REPOSITORY" refs\/heads\/main/);
  assert.match(anonymousProbe, /trap[^\n]*rm -rf -- "\$audit_root"/);
  assert.ok((wizard.match(/read_anonymous_damm_main/g) ?? []).length >= 3);
  assert.ok((wizard.match(/== "\$DAMM_SOURCE_COMMIT"/g) ?? []).length >= 2);
  assert.match(wizard, /fetch --depth=1 --no-tags origin/);
  assert.match(wizard, /Refresh origin\/main again immediately before resume/);
  assert.match(wizard, /Render's displayed latest commit to build/);
  assert.ok((wizard.match(/git fetch --quiet origin main/g) ?? []).length >= 2);
  assert.match(wizard, /visibly Suspended/);
  assert.match(wizard, /active-workflow query still return zero rows/);
  assert.match(wizard, /Zero-active gate failed:[^\n]*keep the worker suspended/);
  assert.match(wizard, /Resume the suspended worker/);
  assert.match(wizard, /Render starts the exact latest-commit build/);
  assert.match(wizard, /Live, Failed, or Canceled/);
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
      wizard.indexOf("Wait until that deploy reaches a terminal state"),
  );
  assert.ok(
    wizard.indexOf("Wait until that deploy reaches a terminal state") <
      wizard.indexOf('ask RENDER_WORKER_DEPLOY_SHA "Commit SHA shown for the worker deploy:"'),
  );
  assert.ok(
    wizard.indexOf("Wait until that deploy reaches a terminal state") <
      wizard.indexOf('open_url "$ARTIFACT_GATEWAY_URL/healthz"'),
  );
});

test("a new Render environment accepts one initial worker build without a duplicate resume", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const newEnvironmentBranch = wizard.match(
    /if confirm "Is this a new Render environment[\s\S]*?^else$/m,
  )?.[0];
  const workerCutover = wizard.match(
    /if \[\[ "\$RENDER_WORKER_NEEDS_RESUME" == "true" \]\]; then[\s\S]*?^fi$/m,
  )?.[0];

  assert.ok(newEnvironmentBranch, "the new-environment branch must be present");
  assert.ok(workerCutover, "the conditional worker cutover must be present");
  assert.match(newEnvironmentBranch, /RENDER_WORKER_NEEDS_RESUME="false"/);
  assert.match(newEnvironmentBranch, /both initial credential-free deploys Live/);
  assert.doesNotMatch(newEnvironmentBranch, /Resume the suspended worker/);
  const zeroActive = newEnvironmentBranch.indexOf(
    "Does the active-workflow query still return zero rows before the initial Blueprint deploy",
  );
  const sourceRefresh = newEnvironmentBranch.indexOf(
    "Refresh both bound source identities immediately before the initial Blueprint deploy",
  );
  const deployAuthorization = newEnvironmentBranch.indexOf("Deploy this billed Blueprint now?");
  const deployClick = newEnvironmentBranch.indexOf("Click Deploy Blueprint");
  const disableAutoSync = newEnvironmentBranch.indexOf(
    "Immediately open the new Blueprint's Settings page and set Auto Sync to No",
  );
  const awaitTerminal = newEnvironmentBranch.indexOf(
    "Wait for both initial credential-free deploys to reach terminal states",
  );
  for (const [label, index] of Object.entries({
    zeroActive,
    sourceRefresh,
    deployAuthorization,
    deployClick,
    disableAutoSync,
    awaitTerminal,
  })) {
    assert.notEqual(index, -1, `${label} gate must be present in the new-environment path`);
  }
  assert.ok(zeroActive < sourceRefresh);
  assert.ok(sourceRefresh < deployAuthorization);
  assert.ok(deployAuthorization < deployClick);
  assert.ok(deployClick < disableAutoSync);
  assert.ok(disableAutoSync < awaitTerminal);
  assert.match(workerCutover, /if \[\[ "\$RENDER_WORKER_NEEDS_RESUME" == "true" \]\]/);
  assert.match(workerCutover, /Resume the suspended worker/);
  assert.match(workerCutover, /else[\s\S]*initial credential-free worker deploy still Live/);
  assert.equal((workerCutover.match(/Resume the suspended worker/g) ?? []).length, 1);
});

test("the new-environment runbook closes source and automation races before accepting its one build", () => {
  const guide = readFileSync(join(root, "docs/DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md"), "utf8");
  const section = guide.match(/### 11\. Create both Render Ohio services[\s\S]*?(?=### 12\.)/)?.[0];
  assert.ok(section, "the new-environment Render section must exist");

  const zeroActive = section.indexOf("Reconfirm zero active workflows before clicking");
  const sourceRefresh = section.indexOf(
    "Refresh both bound source identities immediately before clicking",
  );
  const deployClick = section.indexOf("click **Deploy Blueprint** once");
  const disableAutoSync = section.indexOf(
    "Immediately open the created Blueprint's **Settings** and set **Auto Sync: No**",
  );
  const awaitTerminal = section.indexOf(
    "Wait for both initial credential-free deploys to reach terminal states",
  );
  for (const [label, index] of Object.entries({
    zeroActive,
    sourceRefresh,
    deployClick,
    disableAutoSync,
    awaitTerminal,
  })) {
    assert.notEqual(index, -1, `${label} gate must be documented`);
  }
  assert.ok(zeroActive < sourceRefresh);
  assert.ok(sourceRefresh < deployClick);
  assert.ok(deployClick < disableAutoSync);
  assert.ok(disableAutoSync < awaitTerminal);
  assert.match(section, /without starting a second build/);
});

test("the release contract permits only one credential-free worker build at a time", () => {
  const handoff = readFileSync(join(root, "HANDOFF.md"), "utf8");

  assert.doesNotMatch(handoff, /permit exactly one credential-free build/);
  assert.match(handoff, /permit one credential-free build at a time/);
  assert.match(
    handoff,
    /terminal failure or cancellation[\s\S]{0,180}source and\s+zero-active gates?[\s\S]{0,120}retry/i,
  );
});

test("the final Render release ledger records a disconnected Blueprint without changing services", () => {
  const wizard = readFileSync(join(root, "scripts/deploy/netlify-neon-render-ohio.sh"), "utf8");
  const guide = readFileSync(join(root, "docs/DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md"), "utf8");

  assert.doesNotMatch(wizard, /ask RENDER_BLUEPRINT_ID/);
  assert.doesNotMatch(wizard, /write_env RENDER_BLUEPRINT_ID/);
  assert.doesNotMatch(wizard, /write_env RENDER_BLUEPRINT_AUTO_SYNC/);
  assert.match(wizard, /remove_env RENDER_BLUEPRINT_ID/);
  assert.match(wizard, /remove_env RENDER_BLUEPRINT_AUTO_SYNC/);
  assert.match(wizard, /write_env RENDER_BLUEPRINT_STATE "disconnected"/);
  assert.match(wizard, /Resources will no longer sync automatically from your Blueprint file/);
  assert.match(wizard, /This will not delete the managed resources/);
  assert.match(wizard, /If the Blueprint is already absent, do not reconnect it/);
  assert.match(wizard, /Existing deployment: keep an already-disconnected Blueprint disconnected/);
  assert.match(wizard, /Is this a new Render environment with no existing worker or gateway/);
  assert.match(wizard, /RENDER_ENVIRONMENT_MODE="new"/);
  assert.match(wizard, /RENDER_ENVIRONMENT_MODE="existing"/);
  assert.match(wizard, /Existing deployment path: do not create or deploy a Blueprint/);
  assert.match(wizard, /deploy the exact gateway commit first while the worker remains suspended/);
  assert.match(wizard, /if \[\[ "\$RENDER_ENVIRONMENT_MODE" == "new" \]\]; then/);
  assert.match(wizard, /already disconnected, or was disconnected/);
  assert.match(wizard, /Do not request the old Sync Hook URL with any HTTP method/);
  assert.match(wizard, /worker and gateway remain Live on their unchanged deploy IDs/);
  assert.match(wizard, /worker disk remains attached at \/var\/data/);

  const workerDeploy = wizard.indexOf("write_env RENDER_WORKER_DEPLOY_ID");
  const gatewayDeploy = wizard.indexOf("write_env RENDER_ARTIFACT_DEPLOY_ID");
  const disconnect = wizard.indexOf("Disconnect Blueprint");
  const disconnectedState = wizard.indexOf('write_env RENDER_BLUEPRINT_STATE "disconnected"');
  assert.ok(disconnect > workerDeploy, "disconnect only after the exact worker deploy is recorded");
  assert.ok(
    disconnect > gatewayDeploy,
    "disconnect only after the exact gateway deploy is recorded",
  );
  assert.ok(
    disconnectedState > disconnect,
    "persist the state only after disconnection is verified",
  );

  assert.match(guide, /`RENDER_BLUEPRINT_STATE`/);
  assert.match(guide, /fixed `disconnected`/);
  assert.match(guide, /This will not delete the managed resources/);
  assert.match(guide, /worker and gateway remain \*\*Live\*\* on the unchanged deploy IDs/);
  assert.doesNotMatch(guide, /^\| `RENDER_BLUEPRINT_ID`/m);
  assert.doesNotMatch(guide, /^\| `RENDER_BLUEPRINT_AUTO_SYNC`/m);
});
