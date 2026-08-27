import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { validNeonOhioConnection } from "../../scripts/deployment-url-policy.mjs";
import { verifyPipelineMethodology } from "../../src/lib/damm-v17/worker.ts";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = "/var/data";
const REQUIRED_SECRETS = [
  "DATABASE_URL",
  "EXA_API_KEY",
  "JINA_API_KEY",
  "PERPLEXITY_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
];
const MINIMUM_FREE_BYTES = 512n * 1024n * 1024n;

function fail(message) {
  throw new Error(message);
}

function command(filename, args, options = {}) {
  try {
    return execFileSync(filename, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout ?? 30_000,
      env: options.env ?? process.env,
    }).trim();
  } catch {
    fail(`${options.label ?? filename} is unavailable or failed its smoke check`);
  }
}

async function assertRuntimePaths(pipelineDir, python) {
  if (process.env.DAMM_DATA_ROOT !== DATA_ROOT) fail("DAMM_DATA_ROOT must be /var/data");
  const dataRoot = await realpath(DATA_ROOT);
  const pipelineRoot = await realpath(pipelineDir);
  const manifest = JSON.parse(
    await readFile(path.join(APP_ROOT, "src/data/damm_model_manifest.json"), "utf8"),
  );
  if (
    path.dirname(pipelineRoot) !== path.join(dataRoot, "checkouts") ||
    path.basename(pipelineRoot) !== manifest.source.commit
  ) {
    fail("DAMM_PIPELINE_DIR is not the manifest-versioned persistent checkout");
  }
  const pipelineStat = await lstat(pipelineDir);
  if (!pipelineStat.isDirectory() || pipelineStat.isSymbolicLink()) {
    fail("DAMM_PIPELINE_DIR must be a real directory");
  }
  await access(path.join(pipelineDir, "gauntlet/loop-1"), constants.R_OK | constants.W_OK);
  await access(python, constants.X_OK);

  const envFile = path.join(pipelineDir, ".env");
  const envStat = await lstat(envFile);
  if (
    !envStat.isFile() ||
    envStat.isSymbolicLink() ||
    envStat.size !== 0 ||
    (envStat.mode & 0o077) !== 0
  ) {
    fail("the DAMM checkout .env must be an empty mode-600 regular file");
  }

  const disk = await statfs(DATA_ROOT, { bigint: true });
  const freeBytes = disk.bavail * disk.bsize;
  if (freeBytes < MINIMUM_FREE_BYTES) fail("the persistent disk has less than 512 MiB free");
  return { commit: manifest.source.commit, freeBytes };
}

function assertPython(python) {
  const script = `
import importlib.metadata as metadata
import json
import sys
if sys.version_info[:2] != (3, 12):
    raise SystemExit("CPython 3.12 is required")
import anthropic
import openai
import openpyxl
from google import genai
print(json.dumps({
    "python": ".".join(map(str, sys.version_info[:3])),
    "anthropic": metadata.version("anthropic"),
    "google-genai": metadata.version("google-genai"),
    "openai": metadata.version("openai"),
    "openpyxl": metadata.version("openpyxl"),
}, sort_keys=True))
`;
  const output = command(python, ["-B", "-c", script], {
    label: "the pinned Python runtime",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return JSON.parse(output);
}

async function assertStage8Converters() {
  const root = await mkdtemp(path.join(tmpdir(), "damm-stage8-preflight-"));
  try {
    const markdown = path.join(root, "stage8-smoke.md");
    const docx = path.join(root, "stage8-smoke.docx");
    const pdf = path.join(root, "stage8-smoke.pdf");
    const profile = path.join(root, "libreoffice-profile");
    await writeFile(markdown, "# Stage 8 converter smoke check\n\nDraft DAR.\n");
    command("pandoc", [markdown, "--standalone", "--output", docx], {
      label: "pandoc DOCX conversion",
      timeout: 60_000,
    });
    command(
      "soffice",
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        root,
        docx,
      ],
      { label: "LibreOffice PDF conversion", timeout: 90_000 },
    );
    const [docxHeader, pdfHeader] = await Promise.all([
      readFile(docx).then((value) => value.subarray(0, 2).toString("binary")),
      readFile(pdf).then((value) => value.subarray(0, 5).toString("ascii")),
    ]);
    if (docxHeader !== "PK" || pdfHeader !== "%PDF-") {
      fail("Stage 8 converters produced invalid DOCX or PDF bytes");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertMigrations(databaseUrl) {
  const expected = (await readdir(path.join(APP_ROOT, "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    application_name: "dar-studio-worker-preflight",
  });
  try {
    const result = await pool.query("select name from _migrations order by name");
    const applied = new Set(result.rows.map((row) => String(row.name)));
    const missing = expected.filter((name) => !applied.has(name));
    if (missing.length) fail(`database is missing migrations: ${missing.join(", ")}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("database is missing migrations:")) {
      throw error;
    }
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    fail(`database migration readiness check failed${code}`);
  } finally {
    await pool.end().catch(() => undefined);
  }
  return expected.length;
}

async function main() {
  const missing = REQUIRED_SECRETS.filter((name) => !process.env[name]?.trim());
  if (missing.length) fail(`required secrets are empty: ${missing.join(", ")}`);
  if (!validNeonOhioConnection(process.env.DATABASE_URL, true)) {
    fail("DATABASE_URL must be Neon's pooled Ohio URL with sslmode=require");
  }

  const pipelineDir = process.env.DAMM_PIPELINE_DIR;
  const python = process.env.DAMM_PIPELINE_PYTHON;
  if (!pipelineDir || !python) fail("DAMM pipeline paths are not configured");
  if (Number(process.versions.node.split(".")[0]) < 22) fail("Node.js 22 or newer is required");

  const runtime = await assertRuntimePaths(pipelineDir, python);
  const methodology = verifyPipelineMethodology(pipelineDir);
  if (!methodology.ok) fail(methodology.reason);
  const pythonVersions = assertPython(python);
  await assertStage8Converters();
  const migrationCount = await assertMigrations(process.env.DATABASE_URL);

  const freeGiB = Number(runtime.freeBytes / (1024n * 1024n * 1024n));
  console.log(
    `[worker-preflight] ready commit=${runtime.commit} node=${process.versions.node} ` +
      `python=${pythonVersions.python} migrations=${migrationCount} free_gib=${freeGiB}`,
  );
}

main().catch((error) => {
  console.error(`[worker-preflight] failed: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
});
