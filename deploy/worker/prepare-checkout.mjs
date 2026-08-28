import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = path.join(APP_ROOT, "src/data/damm_model_manifest.json");
const DATA_ROOT = process.env.DAMM_DATA_ROOT ?? "/var/data";
const SEED_ROOT = "/opt/damm-seed";

function fail(message) {
  throw new Error(message);
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

async function plainDirectory(filename, label) {
  const stat = await lstat(filename).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) fail(`${label} is not a real directory`);
  return realpath(filename);
}

export async function validateCheckout(root, repository, commit, label) {
  const canonicalRoot = await plainDirectory(root, label);
  const gitDirectory = await lstat(path.join(root, ".git")).catch(() => null);
  if (!gitDirectory?.isDirectory() || gitDirectory.isSymbolicLink()) {
    fail(`${label} has no real Git metadata directory`);
  }
  const topLevel = await realpath(git(root, "rev-parse", "--show-toplevel"));
  if (topLevel !== canonicalRoot) fail(`${label} is not its Git top-level directory`);
  const fetchOrigins = git(root, "remote", "get-url", "--all", "origin");
  const pushOrigins = git(root, "remote", "get-url", "--push", "--all", "origin");
  if (fetchOrigins !== repository || pushOrigins !== repository) {
    fail(`${label} does not have the canonical credential-free origin`);
  }
  if (git(root, "rev-parse", "HEAD") !== commit) fail(`${label} is not the manifest commit`);
  if (git(root, "rev-list", "--count", "--all") !== "1" || git(root, "tag", "--list")) {
    fail(`${label} contains Git history beyond the manifest commit`);
  }
  if (git(root, "status", "--porcelain=v1", "--untracked-files=no")) {
    fail(`${label} has tracked changes`);
  }
  return canonicalRoot;
}

async function ensureBlankVendorEnv(root) {
  const filename = path.join(root, ".env");
  let handle;
  try {
    handle = await open(
      filename,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0) {
      fail("the DAMM checkout .env must be an empty regular file");
    }
  } finally {
    await handle?.close();
  }
  await chmod(filename, 0o600);
}

async function main() {
  if (DATA_ROOT !== "/var/data") fail("DAMM_DATA_ROOT must be /var/data");
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const repository = manifest?.source?.repository;
  const commit = manifest?.source?.commit;
  if (
    repository !== "https://github.com/World-Bank-Digital/DAMM" ||
    typeof commit !== "string" ||
    !/^[0-9a-f]{40}$/.test(commit)
  ) {
    fail("the app DAMM source identity is invalid");
  }

  const canonicalDataRoot = await plainDirectory(DATA_ROOT, "the persistent disk");
  const checkoutsRoot = path.join(canonicalDataRoot, "checkouts");
  await mkdir(checkoutsRoot, { recursive: false, mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  if ((await plainDirectory(checkoutsRoot, "the checkout directory")) !== checkoutsRoot) {
    fail("the checkout directory escapes the persistent disk");
  }

  const target = path.join(checkoutsRoot, commit);
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    await validateCheckout(target, repository, commit, "the persistent DAMM checkout");
    await ensureBlankVendorEnv(target);
    process.stderr.write(`[worker-checkout] reusing DAMM ${commit}\n`);
    process.stdout.write(target);
    return;
  }

  await validateCheckout(SEED_ROOT, repository, commit, "the image DAMM seed");
  let temporary = await mkdtemp(path.join(checkoutsRoot, `.prepare-${commit}-`));
  try {
    execFileSync("git", ["clone", "--no-local", "--no-checkout", "--", SEED_ROOT, temporary], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120_000,
    });
    git(temporary, "checkout", "--detach", commit);
    git(temporary, "remote", "set-url", "origin", repository);
    git(temporary, "fsck", "--strict", "--no-dangling");
    await validateCheckout(temporary, repository, commit, "the prepared DAMM checkout");
    await rename(temporary, target);
    temporary = null;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }

  await validateCheckout(target, repository, commit, "the persistent DAMM checkout");
  await ensureBlankVendorEnv(target);
  process.stderr.write(`[worker-checkout] installed DAMM ${commit}\n`);
  process.stdout.write(target);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[worker-checkout] failed: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
