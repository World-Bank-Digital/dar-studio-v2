/**
 * The delivery gauntlet, looped until every stage passes.
 *
 * `qa:delivery` is fail-fast by design — the first broken stage stops the run
 * and names itself. That is right for a verdict and wrong for getting to one:
 * runs 10, 11 and 12 each failed in a late stage and threw away one to two
 * hours of completed upstream work, because every attempt began by creating a
 * fresh workspace.
 *
 * This wrapper keeps the verdict and removes the waste. It runs the gauntlet,
 * and on failure re-enters the SAME workspace at the stage that failed, after
 * a backoff long enough to matter — the dominant failure mode is a rate-limited
 * search provider (LEARNINGS L22), and retrying a throttled provider
 * immediately is how throttling becomes refusal.
 *
 *   node scripts/qa-loop.mjs                        # up to 4 attempts, real backoff
 *   node scripts/qa-loop.mjs --attempts 6
 *   node scripts/qa-loop.mjs --workspace <id>       # resume an existing workspace
 *   node scripts/qa-loop.mjs --backoff 5,10         # minutes, for a quick rehearsal
 *
 * The workspace is never deleted: its evidence, findings, red-team findings,
 * uploads, drafts and deck stay in place for inspection.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./qa-paths.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const maxAttempts = Number(flag("--attempts", "4"));
const backoffMinutes = (flag("--backoff", "5,15,30") ?? "5,15,30").split(",").map(Number);
let workspaceId = flag("--workspace");
const base = flag("--base", "http://127.0.0.1:8080");

const reportsDir = join(projectRoot, "qa-reports");
const loopStartedAt = new Date().toISOString();
const attempts = [];

function log(m) {
  console.log(`[loop] ${new Date().toISOString().slice(11, 19)} ${m}`);
}

/** The newest report file written after `since` — the attempt's own verdict. */
function latestReportAfter(since) {
  mkdirSync(reportsDir, { recursive: true });
  const candidates = readdirSync(reportsDir)
    .filter((f) => f.startsWith("delivery-") && f.endsWith(".json"))
    .map((f) => ({ f, path: join(reportsDir, f) }))
    .map((x) => ({ ...x, json: JSON.parse(readFileSync(x.path, "utf8")) }))
    .filter((x) => x.json.startedAt && x.json.startedAt >= since);
  candidates.sort((a, b) => a.json.startedAt.localeCompare(b.json.startedAt));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function runGauntlet(args) {
  return new Promise((resolve) => {
    const child = spawn("node", [join(projectRoot, "scripts", "qa-delivery.mjs"), ...args], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = false;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const startedAt = new Date().toISOString();
  const args = [base];
  let resumeFrom = null;
  if (workspaceId) {
    args.push("--workspace", workspaceId);
    // Resume precisely where the previous attempt broke; a first attempt on a
    // named workspace re-enters from the top and skips what is already done.
    const prev = attempts[attempts.length - 1];
    if (prev?.failedStage) {
      resumeFrom = prev.failedStage;
      args.push("--from", resumeFrom);
    }
  }
  log(`attempt ${attempt}/${maxAttempts}${workspaceId ? ` · workspace ${workspaceId}` : " · fresh workspace"}${resumeFrom ? ` · from ${resumeFrom}` : ""}`);

  const code = await runGauntlet(args);
  const found = latestReportAfter(startedAt);
  const json = found?.json ?? {};

  // A workspace created by the first attempt is what every later attempt reuses.
  const url = json.phases?.country?.countryUrl;
  if (!workspaceId && url) {
    workspaceId = url.split("/c/")[1]?.split(/[?#]/)[0] ?? null;
    if (workspaceId) log(`workspace for later attempts: ${workspaceId}`);
  }

  attempts.push({
    attempt,
    startedAt,
    exitCode: code,
    ok: code === 0,
    resumedFrom: resumeFrom,
    failedStage: json.failedStage ?? null,
    error: json.error ?? null,
    report: found?.f ?? null,
    phases: Object.fromEntries(
      Object.entries(json.phases ?? {}).map(([k, v]) => [k, v?.skipped ? "skipped" : "ran"]),
    ),
  });

  if (code === 0) {
    passed = true;
    log(`PASS on attempt ${attempt}`);
    break;
  }

  log(`attempt ${attempt} failed at stage "${json.failedStage ?? "unknown"}": ${json.error ?? `exit ${code}`}`);
  if (!workspaceId) {
    log("no workspace was created — the failure is before any work exists; not looping.");
    break;
  }
  if (attempt === maxAttempts) break;

  const waitMin = backoffMinutes[Math.min(attempt - 1, backoffMinutes.length - 1)];
  log(`waiting ${waitMin} min before resuming (a throttled provider needs real time — L22)`);
  await sleep(waitMin * 60 * 1000);
}

const loopReport = {
  startedAt: loopStartedAt,
  finishedAt: new Date().toISOString(),
  ok: passed,
  workspaceId,
  maxAttempts,
  attempts,
};
mkdirSync(reportsDir, { recursive: true });
const path = join(reportsDir, `loop-${loopStartedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(path, JSON.stringify(loopReport, null, 2));
log(`loop report: ${path}`);
log(`workspace retained for inspection: ${workspaceId ?? "(none created)"}`);

if (!passed) {
  console.error(`[loop] FAILED after ${attempts.length} attempt(s).`);
  process.exit(1);
}
console.log("[loop] DELIVERY PASS — every stage succeeded; the workspace is retained.");
