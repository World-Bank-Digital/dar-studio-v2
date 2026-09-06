import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("the gateway package loads and serves health using only its Docker COPY inputs", () => {
  const staged = mkdtempSync(join(tmpdir(), "dar-gateway-package-"));
  try {
    const allowed = new Set(read("Dockerfile.artifact-gateway.dockerignore").split("\n"));
    for (const line of read("Dockerfile.artifact-gateway").split("\n")) {
      if (!line.startsWith("COPY --chown=node:node ")) continue;
      const fields = line.split(/\s+/).slice(2);
      const destination = fields.pop();
      for (const source of fields) {
        assert.ok(allowed.has(`!${source}`), `${source} must be in the Docker context`);
        const target = join(staged, destination.endsWith("/") ? destination + source.split("/").pop() : destination);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(root, source), target);
      }
    }
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { createArtifactGatewayHandler } from './scripts/artifact-gateway.ts';
      const handler = createArtifactGatewayHandler({
        appOrigin: 'https://dar.example', secret: 'synthetic-package-test-secret-0000000000000000',
        repository: { open() { throw new Error('Health must not open storage'); } },
      });
      const response = await handler(new Request('https://gateway.example/healthz'));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok' });
    `], { cwd: staged, env: {}, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
});

test("the Netlify contract uses the official adapter and the repository build", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.devDependencies["@netlify/vite-plugin-tanstack-start"], "1.3.18");
  assert.equal(pkg.devDependencies["@netlify/zip-it-and-ship-it"], "15.5.0");
  assert.equal(pkg.devDependencies["netlify-cli"], "27.4.2");
  assert.match(pkg.scripts.build, /^node scripts\/deploy-preflight\.mjs && vite build/);
  assert.match(pkg.scripts["verify:netlify"], /NETLIFY=true npm run build:dev/);
  const toml = read("netlify.toml");
  assert.match(toml, /command = "npm run build"/);
  assert.match(toml, /publish = "dist\/client"/);
  assert.match(
    toml,
    /included_files = \["node_modules\/@napi-rs\/canvas\/\*\*", "node_modules\/@napi-rs\/canvas-linux-x64-gnu\/\*\*", "node_modules\/pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs"\]/,
  );
  assert.doesNotMatch(toml, /node_modules\/@napi-rs\/canvas-\*\/\*\*/);
  assert.equal(read(".node-version").trim(), "22.22.3");
  assert.match(read(".gitignore"), /^\.netlify\/$/m);
});

test("the existing Nitro/PWA contract remains beside the Netlify adapter", () => {
  const vite = read("vite.config.ts");
  assert.match(vite, /target === "netlify"[\s\S]*netlify\(\)/);
  assert.match(vite, /preset: "vercel"/);
  assert.match(vite, /serverDir: "\.\/server"/);
  assert.match(vite, /host: "0\.0\.0\.0"/);
  assert.match(vite, /port: 8080/);

  const start = read("src/start.ts");
  assert.match(start, /createCsrfMiddleware/);
  assert.match(start, /handlerType === "serverFn"/);
  assert.match(start, /handleGrokPwaRequest/);
  assert.match(start, /requestMiddleware: \[csrfMiddleware, grokPwaRequestMiddleware\]/);
});

test("the artifact gateway image is pinned, unprivileged, and pg-only", () => {
  const dockerfile = read("Dockerfile.artifact-gateway");
  assert.match(dockerfile, /^FROM node:22\.22\.3-bookworm-slim@sha256:[a-f0-9]{64}$/m);
  assert.match(
    dockerfile,
    /COPY --chown=node:node deploy\/artifact-gateway\/package\.json deploy\/artifact-gateway\/package-lock\.json/,
  );
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts --no-audit --no-fund/);
  assert.match(dockerfile, /artifact-delivery-contract\.ts/);
  assert.match(dockerfile, /artifact-limits\.ts/);
  assert.match(dockerfile, /deployment-url-policy\.mjs/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /\/healthz/);
  const dockerignore = read("Dockerfile.artifact-gateway.dockerignore");
  assert.match(dockerignore, /^!src\/lib\/damm-v17\/artifact-delivery-contract\.ts$/m);
  assert.match(dockerignore, /^!src\/lib\/damm-v17\/artifact-limits\.ts$/m);
  assert.match(dockerignore, /^!scripts\/deployment-url-policy\.mjs$/m);

  const runtime = JSON.parse(read("deploy/artifact-gateway/package.json"));
  assert.deepEqual(runtime.dependencies, { pg: "8.16.3" });
  const lock = JSON.parse(read("deploy/artifact-gateway/package-lock.json"));
  assert.equal(lock.packages["node_modules/pg"].version, "8.16.3");
});

test("worker, Stage 8 verification, and gateway share one publication-size policy", () => {
  const limits = read("src/lib/damm-v17/artifact-limits.ts");
  assert.match(limits, /MAX_WORKFLOW_ARTIFACT_BYTES = 50 \* 1024 \* 1024/);
  assert.match(limits, /MAX_WORKFLOW_BUNDLE_BYTES = 250 \* 1024 \* 1024/);
  assert.match(limits, /MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES = 400 \* 1024 \* 1024/);
  for (const consumer of [
    "src/lib/damm-v17/worker.ts",
    "src/lib/damm-v17/stage8-boundary.server.ts",
    "scripts/artifact-gateway.ts",
  ]) {
    assert.match(read(consumer), /artifact-limits\.ts/);
  }
});
