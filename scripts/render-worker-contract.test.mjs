import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
const service = (blueprint, name) => {
  const blocks = blueprint.split(/(?=^ {2}- type:)/m);
  const block = blocks.find((candidate) => candidate.includes(`\n    name: ${name}\n`));
  assert.ok(block, `render.yaml must define ${name}`);
  return block;
};

describe("Render worker deployment contract", () => {
  it("deploys one Ohio worker with a persistent disk and the full shutdown window", () => {
    const blueprint = read("render.yaml");
    const worker = service(blueprint, "dar-studio-worker");
    assert.equal((blueprint.match(/^\s*- type: worker$/gm) ?? []).length, 1);
    assert.match(worker, /^\s+runtime: docker$/m);
    assert.match(worker, /^\s+region: ohio$/m);
    assert.match(worker, /^\s+plan: 1c-2g$/m);
    assert.match(worker, /^\s+dockerfilePath: \.\/Dockerfile\.worker$/m);
    assert.match(worker, /^\s+autoDeployTrigger: off$/m);
    assert.match(worker, /^\s+numInstances: 1$/m);
    assert.match(worker, /^\s+maxShutdownDelaySeconds: 300$/m);
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
    const gateway = service(read("render.yaml"), "dar-studio-artifacts");
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
    assert.match(dockerfile, /git config --system --add safe\.directory \/opt\/damm-seed/);
    assert.doesNotMatch(dockerfile, /chown[^\n]*\/opt\/(?:app|damm-seed|damm-venv)/);
  });

  it("takes the DAMM repository and commit only from the canonical manifest", () => {
    const dockerfile = read("Dockerfile.worker");
    const manifest = JSON.parse(read("src/data/damm_model_manifest.json"));
    assert.match(dockerfile, /damm_model_manifest\.json/);
    assert.match(dockerfile, /git clone --no-checkout/);
    assert.match(dockerfile, /git -C \/opt\/damm-seed checkout --detach "\$commit"/);
    assert.match(dockerfile, /verifyPipelineMethodology/);
    assert.doesNotMatch(dockerfile, new RegExp(manifest.source.commit));
    assert.doesNotMatch(dockerfile, /World-Bank-Digital\/DAMM/);
  });

  it("runs all upstream test roots without writing executable bytecode", () => {
    const dockerfile = read("Dockerfile.worker");
    for (const root of [
      "model",
      "workflow",
      "gauntlet/loop-1",
      "gauntlet/loop-1/research_pipeline",
    ]) {
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
    assert.match(prepare, /await rename\(temporary, target\)/);
    assert.match(prepare, /constants\.O_NOFOLLOW/);
    assert.match(prepare, /stat\.size !== 0/);
  });

  it("fails closed before starting Node and never runs database migrations", () => {
    const entrypoint = read("deploy/worker/entrypoint.sh");
    const preflight = read("deploy/worker/preflight.mjs");
    assert.match(entrypoint, /mountpoint -q "\$DATA_ROOT"/);
    assert.match(entrypoint, /gosu darworker/);
    assert.match(entrypoint, /prepare-checkout\.mjs/);
    assert.match(entrypoint, /preflight\.mjs/);
    assert.match(entrypoint, /exec node --experimental-strip-types/);
    assert.ok(entrypoint.indexOf("preflight.mjs") < entrypoint.indexOf("exec node"));

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
