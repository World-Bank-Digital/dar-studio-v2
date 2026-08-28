import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validateCheckout } from "../deploy/worker/prepare-checkout.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
const service = (blueprint, name) => {
  const blocks = blueprint.split(/(?=^ {2}- type:)/m);
  const block = blocks.find((candidate) => candidate.includes(`\n    name: ${name}\n`));
  assert.ok(block, `render.yaml must define ${name}`);
  return block;
};

describe("Render worker deployment contract", () => {
  it("deploys one Ohio worker with a persistent disk and no unsupported shutdown-delay field", () => {
    const blueprint = read("render.yaml");
    const worker = service(blueprint, "dar-studio-worker");
    assert.equal((blueprint.match(/^\s*- type: worker$/gm) ?? []).length, 1);
    assert.match(worker, /^\s+runtime: docker$/m);
    assert.match(worker, /^\s+region: ohio$/m);
    assert.match(worker, /^\s+plan: 1c-2g$/m);
    assert.match(worker, /^\s+dockerfilePath: \.\/Dockerfile\.worker$/m);
    assert.match(worker, /^\s+autoDeployTrigger: off$/m);
    assert.match(worker, /^\s+numInstances: 1$/m);
    assert.doesNotMatch(worker, /^\s+maxShutdownDelaySeconds:/m);
    assert.match(
      worker,
      /disk:\n\s+name: dar-studio-worker-data\n\s+mountPath: \/var\/data\n\s+sizeGB: 10/,
    );
  });

  it("prompts for every runtime secret instead of committing a value", () => {
    const blueprint = read("render.yaml");
    const worker = service(blueprint, "dar-studio-worker");
    const secrets = [
      "DATABASE_URL",
      "EXA_API_KEY",
      "JINA_API_KEY",
      "PERPLEXITY_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
    ];
    for (const key of secrets) {
      assert.match(worker, new RegExp(`- key: ${key}\\n\\s+sync: false`));
      assert.doesNotMatch(worker, new RegExp(`- key: ${key}\\n\\s+value:`));
    }
    assert.equal((worker.match(/sync: false/g) ?? []).length, secrets.length);
  });

  it("keeps the large-artifact gateway in the same Ohio stack without a disk", () => {
    const blueprint = read("render.yaml");
    const gateway = service(blueprint, "dar-studio-artifacts");
    assert.match(gateway, /^\s*- type: web$/m);
    assert.match(gateway, /^\s+runtime: docker$/m);
    assert.match(gateway, /^\s+region: ohio$/m);
    assert.match(gateway, /^\s+plan: 1c-2g$/m);
    assert.match(gateway, /^\s+dockerfilePath: \.\/Dockerfile\.artifact-gateway$/m);
    assert.match(gateway, /^\s+dockerContext: \.$/m);
    assert.match(gateway, /^\s+healthCheckPath: \/healthz$/m);
    assert.match(gateway, /^\s+autoDeployTrigger: off$/m);
    assert.match(gateway, /^\s+numInstances: 1$/m);
    assert.match(gateway, /^\s+maxShutdownDelaySeconds: 300$/m);
    assert.equal((blueprint.match(/^\s+maxShutdownDelaySeconds:/gm) ?? []).length, 1);
    assert.doesNotMatch(gateway, /^\s+disk:/m);
    assert.doesNotMatch(gateway, /^\s+- key: PORT$/m);
    for (const key of ["DATABASE_URL", "ARTIFACT_DELIVERY_SECRET", "APP_ORIGIN"]) {
      assert.match(gateway, new RegExp(`- key: ${key}\\n\\s+sync: false`));
      assert.doesNotMatch(gateway, new RegExp(`- key: ${key}\\n\\s+value:`));
    }
    assert.equal((gateway.match(/sync: false/g) ?? []).length, 3);
  });

  it("builds pinned Node and Python runtimes plus the Stage 8 converters", () => {
    const dockerfile = read("Dockerfile.worker");
    assert.match(dockerfile, /node:22\.22\.3-bookworm-slim@sha256:[0-9a-f]{64}/);
    assert.match(dockerfile, /python:3\.12\.13-slim-bookworm@sha256:[0-9a-f]{64}/);
    for (const dependency of ["git", "libreoffice-writer", "pandoc", "tini", "util-linux"]) {
      assert.match(dockerfile, new RegExp(`\\b${dependency}\\b`));
    }
    assert.match(dockerfile, /pip install[\s\S]*--no-deps[\s\S]*requirements\.lock/);
    assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
    assert.match(dockerfile, /USER|gosu|useradd/);
    assert.match(
      dockerfile,
      /groupadd --gid 10001 darworker[\s\S]*useradd --uid 10001 --gid 10001/,
    );
    assert.doesNotMatch(dockerfile, /(?:usermod|useradd)[^\n]*(?:--groups|-G)[^\n]*\b1000\b/);
    assert.match(dockerfile, /git config --system --add safe\.directory \/opt\/damm-seed/);
    assert.doesNotMatch(dockerfile, /chown[^\n]*\/opt\/(?:app|damm-seed|damm-venv)/);
  });

  it("takes the private DAMM repository and commit through an ephemeral build credential", () => {
    const dockerfile = read("Dockerfile.worker");
    const instructions = dockerfile.replace(/\\\r?\n[ \t]*/g, " ");
    const manifest = JSON.parse(read("src/data/damm_model_manifest.json"));
    assert.match(dockerfile, /damm_model_manifest\.json/);
    assert.match(
      dockerfile,
      /RUN --mount=type=secret,id=damm_git_netrc,dst=\/root\/\.netrc,required=true,mode=0400/,
    );
    assert.equal((dockerfile.match(/type=secret,id=damm_git_netrc/g) ?? []).length, 1);
    assert.equal((dockerfile.match(/\/root\/\.netrc/g) ?? []).length, 2);
    assert.match(dockerfile, /git -C \/opt\/damm-seed init --quiet/);
    assert.match(dockerfile, /install -d -m 0755 \/opt\/damm-seed/);
    assert.match(
      dockerfile,
      /HOME=\/root GIT_TERMINAL_PROMPT=0 git -C \/opt\/damm-seed fetch --depth=1 --no-tags origin "\$commit"/,
    );
    assert.doesNotMatch(dockerfile, /git clone/);
    assert.match(dockerfile, /remote get-url --all origin\)" = "\$repository"/);
    assert.match(dockerfile, /remote get-url --push --all origin\)" = "\$repository"/);
    assert.match(dockerfile, /git -C \/opt\/damm-seed checkout --detach "\$commit"/);
    assert.match(dockerfile, /rev-list --count --all\)" = "1"/);
    assert.match(dockerfile, /test -z "\$\(git -C \/opt\/damm-seed tag --list\)"/);
    assert.match(dockerfile, /verifyPipelineMethodology/);
    assert.doesNotMatch(dockerfile, new RegExp(manifest.source.commit));
    assert.doesNotMatch(dockerfile, /World-Bank-Digital\/DAMM/);
    assert.doesNotMatch(
      instructions,
      /^\s*(?:ARG|ENV)\s+.*(?:damm_git_netrc|DAMM_(?:GIT_)?(?:TOKEN|PAT|PASSWORD)|GITHUB_(?:TOKEN|PAT|PASSWORD)|GH_(?:TOKEN|PAT|PASSWORD))/gim,
    );
    assert.doesNotMatch(dockerfile, /https:\/\/[^/\s]+@github\.com/);
    assert.doesNotMatch(instructions, /^\s*(?:COPY|ADD).*netrc/gim);
    assert.doesNotMatch(dockerfile, /\bset\s+-[^;\n]*x\b/i);
    assert.doesNotMatch(dockerfile, /credential\.helper|http\.[^\s]*extraheader/i);
    assert.doesNotMatch(
      dockerfile,
      /\b(?:cat|head|tail|sed|awk|grep|strings|base64|xxd|od|hexdump)\b[^;\n]*(?:\/root\/\.netrc|damm_git_netrc)/i,
    );
    assert.match(read(".gitignore"), /^damm_git_netrc$/m);
    assert.doesNotMatch(read("render.yaml"), /key:\s*damm_git_netrc/i);
  });

  it("requires the private DAMM build credential without committing or printing it", () => {
    const wizard = read("scripts/deploy/netlify-neon-render-ohio.sh");
    const guide = read("docs/DEPLOYMENT-NETLIFY-NEON-RENDER-OHIO.md");
    for (const deploymentSurface of [wizard, guide]) {
      assert.match(deploymentSurface, /damm_git_netrc/);
      assert.match(deploymentSurface, /Contents(?::| permission)? Read-only/i);
      assert.match(deploymentSurface, /Metadata(?::)?\s+Read-only.*automatically/i);
      assert.match(deploymentSurface, /automatically (?:starts|triggers)/i);
      assert.match(deploymentSurface, /Live.*Failed.*Cancel/i);
      assert.match(deploymentSurface, /(?:delete|revoke).*PAT/i);
      assert.doesNotMatch(deploymentSurface, /\b(?:cat|echo|printf)\b.*damm_git_netrc/i);
      assert.ok(
        deploymentSurface.indexOf("Auto Sync: No") <
          deploymentSurface.indexOf("Secret Files > Add Secret File"),
      );
      const gatewayVerificationMarker =
        deploymentSurface === wizard
          ? 'open_url "$ARTIFACT_GATEWAY_URL/healthz"'
          : "For `dar-studio-artifacts`, open";
      const credentialSaveMarker =
        deploymentSurface === wizard ? 'step "Click Save Changes.' : "Click **Save Changes**.";
      const oneAttemptRevocationMarker =
        deploymentSurface === wizard
          ? 'step "Wait until that credentialed deploy reaches a terminal state'
          : "Wait for that credentialed deploy to reach a terminal state";
      assert.ok(
        deploymentSurface.indexOf(oneAttemptRevocationMarker) <
          deploymentSurface.indexOf(gatewayVerificationMarker),
      );
      assert.ok(
        deploymentSurface.indexOf(credentialSaveMarker) <
          deploymentSurface.indexOf(oneAttemptRevocationMarker),
      );
    }
  });

  it("runs standalone model parity and every upstream unittest root without bytecode", () => {
    const dockerfile = read("Dockerfile.worker");
    assert.match(dockerfile, /python -B model\/test_model_parity\.py/);
    assert.doesNotMatch(dockerfile, /unittest discover -s model/);
    for (const root of ["workflow", "gauntlet/loop-1", "gauntlet/loop-1/research_pipeline"]) {
      assert.match(dockerfile, new RegExp(`unittest discover -s ${root.replaceAll("/", "\\/")}`));
    }
    assert.match(dockerfile, /PYTHONDONTWRITEBYTECODE=1/);
    assert.match(dockerfile, /python -B -m unittest/);
  });

  it("keeps runtime checkpoints in a commit-versioned checkout on the disk", () => {
    const prepare = read("deploy/worker/prepare-checkout.mjs");
    assert.match(prepare, /damm_model_manifest\.json/);
    assert.match(prepare, /path\.join\(checkoutsRoot, commit\)/);
    assert.match(prepare, /\["clone", "--no-local", "--no-checkout"/);
    assert.match(prepare, /SEED_ROOT, temporary/);
    assert.match(prepare, /git\(temporary, "fsck", "--strict", "--no-dangling"\)/);
    assert.match(prepare, /git\(root, "remote", "get-url", "--all", "origin"\)/);
    assert.match(prepare, /git\(root, "remote", "get-url", "--push", "--all", "origin"\)/);
    assert.match(prepare, /fetchOrigins !== repository \|\| pushOrigins !== repository/);
    assert.match(prepare, /canonical credential-free origin/);
    assert.match(prepare, /git\(root, "rev-list", "--count", "--all"\) !== "1"/);
    assert.match(prepare, /Git history beyond the manifest commit/);
    assert.equal(
      (prepare.match(/await validateCheckout\([^\n]*repository, commit/g) ?? []).length,
      4,
    );
    assert.equal(
      (
        prepare.match(
          /await validateCheckout\(target, repository, commit, "the persistent DAMM checkout"\);/g,
        ) ?? []
      ).length,
      2,
    );
    assert.match(
      prepare,
      /git\(temporary, "remote", "set-url", "origin", repository\);[\s\S]*await validateCheckout\(temporary, repository, commit, "the prepared DAMM checkout"\);/,
    );
    assert.match(prepare, /await rename\(temporary, target\)/);
    assert.match(prepare, /constants\.O_NOFOLLOW/);
    assert.match(prepare, /stat\.size !== 0/);
  });

  it("rejects extra history and credential-bearing origins without disclosure", async () => {
    const checkout = mkdtempSync(join(tmpdir(), "dar-worker-checkout-"));
    const canonical = "https://github.com/World-Bank-Digital/DAMM";
    const credentialMarker = "DO-NOT-DISCLOSE-CREDENTIAL";
    const isolatedGitEnvironment = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const previousGitEnvironment = Object.fromEntries(
      Object.keys(isolatedGitEnvironment).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, isolatedGitEnvironment);
    const runGit = (...args) =>
      execFileSync("git", ["-C", checkout, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    let commit;
    const rejectedWithoutDisclosure = async () => {
      await assert.rejects(
        validateCheckout(checkout, canonical, commit, "test checkout"),
        (error) => {
          assert.match(error.message, /canonical credential-free origin/);
          assert.doesNotMatch(error.message, new RegExp(credentialMarker));
          return true;
        },
      );
    };

    try {
      runGit("init");
      runGit("config", "user.email", "worker-contract@example.invalid");
      runGit("config", "user.name", "Worker Contract");
      writeFileSync(join(checkout, "model.txt"), "pinned\n");
      runGit("add", "model.txt");
      runGit("commit", "-m", "pinned fixture");
      commit = runGit("rev-parse", "HEAD");
      runGit("remote", "add", "origin", canonical);

      await validateCheckout(checkout, canonical, commit, "test checkout");

      runGit(
        "remote",
        "set-url",
        "origin",
        `https://x-access-token:${credentialMarker}@github.com/World-Bank-Digital/DAMM`,
      );
      await rejectedWithoutDisclosure();

      runGit("remote", "remove", "origin");
      runGit("remote", "add", "origin", canonical);
      writeFileSync(join(checkout, "model.txt"), "unpinned history\n");
      runGit("add", "model.txt");
      runGit("commit", "-m", "unwanted history");
      const unpinnedCommit = runGit("rev-parse", "HEAD");
      await assert.rejects(
        validateCheckout(checkout, canonical, unpinnedCommit, "test checkout"),
        /Git history beyond the manifest commit/,
      );

      runGit("remote", "set-url", "origin", canonical);
      runGit(
        "remote",
        "set-url",
        "--add",
        "--push",
        "origin",
        `https://x-access-token:${credentialMarker}@github.com/World-Bank-Digital/DAMM`,
      );
      await rejectedWithoutDisclosure();
    } finally {
      rmSync(checkout, { recursive: true, force: true });
      for (const [key, value] of Object.entries(previousGitEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("fails closed before starting Node and never runs database migrations", () => {
    const entrypoint = read("deploy/worker/entrypoint.sh");
    const preflight = read("deploy/worker/preflight.mjs");
    assert.match(entrypoint, /mountpoint -q "\$DATA_ROOT"/);
    assert.match(entrypoint, /gosu darworker/);
    assert.match(entrypoint, /gosu darworker test -x \/opt\/damm-seed/);
    assert.match(entrypoint, /gosu darworker test -r \/opt\/damm-seed\/\.git\/HEAD/);
    assert.match(entrypoint, /\[ "\$\(id -g\)" = "10001" \]/);
    assert.match(
      entrypoint,
      /\*" 1000 "\*\) fail "worker must not belong to Render's secret-file group"/,
    );
    assert.match(entrypoint, /prepare-checkout\.mjs/);
    assert.match(entrypoint, /preflight\.mjs/);
    assert.match(entrypoint, /exec node --experimental-strip-types/);
    assert.ok(
      entrypoint.indexOf("exec gosu darworker") < entrypoint.indexOf("prepare-checkout.mjs"),
    );
    assert.ok(entrypoint.indexOf("prepare-checkout.mjs") < entrypoint.indexOf("preflight.mjs"));
    assert.ok(entrypoint.indexOf("preflight.mjs") < entrypoint.lastIndexOf("exec node"));

    assert.match(preflight, /verifyPipelineMethodology/);
    assert.match(
      preflight,
      /import \{ validNeonOhioConnection \} from "\.\.\/\.\.\/scripts\/deployment-url-policy\.mjs"/,
    );
    assert.match(preflight, /validNeonOhioConnection\(process\.env\.DATABASE_URL, true\)/);
    assert.match(preflight, /pooled Ohio URL with sslmode=require/);
    assert.match(preflight, /select name from _migrations order by name/);
    assert.doesNotMatch(preflight, /insert into _migrations|npm run db:migrate/i);
    assert.match(preflight, /CPython 3\.12 is required/);
    assert.match(preflight, /pandoc DOCX conversion/);
    assert.match(preflight, /LibreOffice PDF conversion/);
    assert.match(preflight, /\[worker-preflight\] ready/);
  });

  it("freezes the complete Python graph to exact versions", () => {
    const direct = read("deploy/worker/requirements.in");
    const lock = read("deploy/worker/requirements.lock");
    for (const dependency of ["anthropic", "google-genai", "openai", "openpyxl"]) {
      assert.match(direct, new RegExp(`^${dependency}==`, "m"));
      assert.match(lock, new RegExp(`^${dependency}==`, "m"));
    }
    const requirements = lock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    assert.ok(requirements.length > 30, "the lock must include transitive dependencies");
    assert.ok(requirements.every((line) => /^[a-z0-9_.-]+==[^=\s]+$/i.test(line)));
  });

  it("keeps the shell and JavaScript deployment programs syntactically valid", () => {
    execFileSync("sh", ["-n", join(ROOT, "deploy/worker/entrypoint.sh")]);
    for (const script of ["prepare-checkout.mjs", "preflight.mjs"]) {
      execFileSync(process.execPath, ["--check", join(ROOT, "deploy/worker", script)]);
    }
  });
});
