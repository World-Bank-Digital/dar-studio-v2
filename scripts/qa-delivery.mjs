/**
 * The delivery gauntlet: end-to-end proof that the studio produces a roadmap.
 *
 * The original qa-gauntlet.mjs asserted `gauntletLocked` — it certified the
 * *locked* state as success, so it could never detect the product failing to
 * deliver. This loop walks the whole journey and passes only when a roadmap
 * actually assembles:
 *
 *   sign in → new country → Step 1 diagnostic (official cascade + verified
 *   web search via the stored search/model keys) → human-clear the failing
 *   core gates through the evidence editor → gauntlet CLEARED → record
 *   steps 2–8 → assemble the 17-chapter draft → assert every chapter and
 *   annex is drafted, prescriptive chapters included → export → reload.
 *
 * It signs in as the key-holding account (keys are per-user), so the live
 * retrieval and prose paths are exercised, not mocked. Each run writes a JSON
 * report under qa-reports/ so consecutive runs can be compared.
 *
 * Usage: node scripts/qa-delivery.mjs [base-url]
 *   QA_EMAIL / QA_PASSWORD override the account (default: the local QA seed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { projectRoot, shotPath } from "./qa-paths.mjs";

const base = process.argv[2] || "http://127.0.0.1:8080";
const email = process.env.QA_EMAIL || "dbcheck@example.com";
const password = process.env.QA_PASSWORD || "TestPass123!";

const INGEST_DEADLINE_MS = 90 * 60 * 1000; // WB cascade + verified search + rubric research (variants + citation repair add real minutes)
const DRAFT_DEADLINE_MS = 45 * 60 * 1000; // 17 prose calls, pool of 4 — run 10 lost a race by seconds when the provider was degraded (draft landed at minute 30)

const report = {
  startedAt: new Date().toISOString(),
  base,
  phases: {},
  ok: false,
};
const errors = [];
const log = [];
function note(m) {
  log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
  console.log(m);
}
function phase(name, data) {
  report.phases[name] = { at: new Date().toISOString(), ...data };
  note(`✔ ${name}${data ? " " + JSON.stringify(data).slice(0, 140) : ""}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
async function shot(name) {
  await page.screenshot({ path: shotPath(name), fullPage: true });
}

/**
 * Open a workspace view through the grouped navigation (Guide / Evidence /
 * Decisions / Outputs). Keys stay the old internal tab ids so call sites read
 * the same; labels are what the TTL now sees.
 */
const NAV = {
  gauntlet: ["Evidence", "Readiness"],
  evidence: ["Evidence", "Indicators"],
  dossier: ["Evidence", "Documents"],
  findings: ["Evidence", "Findings"],
  uploads: ["Evidence", "Foresight"],
  steps: ["Decisions", "Steps 2\u20138"],
  exports: ["Outputs", "Draft & exports"],
  redteam: ["Outputs", "Red team"],
};
async function tab(name) {
  const [group, sub] = NAV[name];
  await page.getByRole("button", { name: group, exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: sub, exact: true }).first().click();
  await page.waitForTimeout(500);
}

/** Gate lines still failing, read straight from the gauntlet table. */
async function failingGates() {
  await tab("gauntlet");
  await page.getByText(/READINESS GATE/i).waitFor({ timeout: 15000 });
  return page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll("table tr")) {
      const cells = [...tr.querySelectorAll("td")].map((td) => td.innerText.trim());
      if (!cells.length) continue;
      const id = (cells[0].match(/^(\d+\.\d+)/) || [])[1];
      if (!id) continue;
      const why = cells[cells.length - 1];
      if (why && why !== "—") out.push({ id, why: why.slice(0, 120) });
    }
    return out;
  });
}

/**
 * Play the human: record an assessor level with a national citation for one
 * core gate, through the same editor and validation a real assessor uses.
 */
async function clearGate(id) {
  await tab("evidence");
  const coreOnly = page.getByLabel(/Core gates/i);
  if (!(await coreOnly.isChecked().catch(() => false))) await coreOnly.check().catch(() => null);
  const row = page
    .locator("tr")
    .filter({ has: page.locator("td", { hasText: new RegExp(`^${id.replace(".", "\\.")}$`) }) })
    .first();
  // Click the id cell, never the row centre: on rows that already carry a
  // source link the centre lands on the anchor, whose stopPropagation swallows
  // the click and the editor never opens (first live run, gate 4.1).
  await row.locator("td").first().click();
  await page.getByText(/Assessor level \(wins over the machine\)/i).waitFor({ timeout: 15000 });
  await page.getByLabel(/Observation year/i).fill("2025");
  await page.getByLabel(/Source name/i).fill("Ministry of Agriculture and Land Reclamation");
  await page.getByLabel(/^Source URL$/i).fill("https://www.moalr.gov.eg/");
  await page.getByLabel(/Assessor level/i).selectOption("3");
  // Not getByLabel: the wrapping <label> includes the textarea's own content in
  // the accessible name, so a machine-researched note breaks /^Notes$/ (run-4
  // failure — the first run in which a core gate carried a proposal).
  await page
    .locator("textarea")
    .last()
    .fill("QA delivery loop — scripted demonstration record, not an official Government of Egypt reading.");
  await page.getByRole("button", { name: /Save and recompute/i }).click();
  await page.getByText(/Assessor level \(wins over the machine\)/i).waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(400);
}

/** Record one ladder decision, mirroring the real Steps form. */
async function recordStep(optionLabel, notes, extra = {}) {
  await page.getByRole("button", { name: /Record decision/i }).waitFor({ timeout: 20000 });
  if (optionLabel) {
    const select = page.locator("form select").first();
    if (await select.count()) {
      await select.selectOption({ label: optionLabel }).catch(async () => {
        await select.selectOption(optionLabel).catch(() => null);
      });
    }
  }
  if (extra.click) {
    for (const name of extra.click) {
      const chip = page.getByRole("button", { name, exact: true });
      if (await chip.count()) await chip.click();
    }
  }
  if (extra.rejected) {
    const rej = page.getByLabel(/Explicitly rejected/i);
    if (await rej.count()) await rej.fill(extra.rejected);
  }
  await page.locator("form textarea").fill(notes);
  await page.getByRole("button", { name: /Record decision/i }).click();
  await page.getByText(/Decision recorded/i).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
}

try {
  note("1. sign in as the key-holding account");
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: /Sign in with email/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  phase("signin", { email });

  note("2. create a fresh Egypt workspace");
  await page.getByRole("button", { name: /^New country$/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByPlaceholder("Country name").fill("Egypt");
  await page.waitForTimeout(700);
  await dialog.getByRole("button", { name: /Egypt, Arab Rep/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  const countryUrl = page.url();
  phase("country", { countryUrl });

  note("3. launch the Step 1 diagnostic (official cascade + verified web search)");
  const launch = page.getByRole("button", { name: /Launch Step 1 diagnostic/i }).first();
  await launch.waitFor({ timeout: 10000 });
  await launch.click();
  const ingestStart = Date.now();
  let ingestDone = false;
  while (Date.now() - ingestStart < INGEST_DEADLINE_MS) {
    const done = await page.getByText(/Automated diagnostic complete|Record the Step 2/i).count();
    const searching = await page.getByText(/Searching official sources|Collecting \d+\/\d+/i).count();
    if (done > 0 && searching === 0) {
      ingestDone = true;
      break;
    }
    await page.waitForTimeout(4000);
  }
  await shot("d-01-after-ingest");
  if (!ingestDone) throw new Error("Step 1 diagnostic did not finish inside the deadline");
  phase("ingest", { minutes: Math.round((Date.now() - ingestStart) / 6000) / 10 });

  note("3b. the wide sweeps must have produced cited findings (a silent zero is a broken pass)");
  await tab("findings");
  await page.getByText(/Public-domain findings/i).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  {
    const body = await page.locator("body").innerText();
    const findingCards = (body.match(/Verified quote: /g) || []).length;
    const practiceSection = /Recent strategies and practices/.test(body);
    report.phases.sweeps = { findingCards, practiceSection };
    note(`   sweeps: ${findingCards} findings visible; practice section=${practiceSection}`);
    if (!practiceSection) throw new Error("findings tab is missing the practices section");
    if (findingCards === 0) throw new Error("the wide sweeps stored zero findings — the pass ran dry (L17 class)");
  }
  await shot("d-01a-findings");
  phase("sweeps", report.phases.sweeps);

  note("3c. upload strategic-foresight material; the draft must cite it");
  await tab("uploads");
  await page.getByText(/Strategic-foresight material/i).waitFor({ timeout: 15000 });
  {
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join: joinPath } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(joinPath(tmpdir(), "dar-qa-"));
    const fixture = joinPath(dir, "qa-foresight-scenarios.txt");
    writeFileSync(
      fixture,
      "QA strategic foresight fixture. Scenario Alpha assumes accelerated smallholder platform adoption by 2032; Scenario Beta assumes stalled rural connectivity investment. Prepared for the delivery loop.",
    );
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByText(/readable characters stored/i).waitFor({ timeout: 20000 });
  }
  await shot("d-01a2-foresight");
  phase("foresight", { uploaded: true });

  note("4. draft-first: assemble the full DAR immediately, before any human step");
  await tab("exports");
  await page.getByRole("button", { name: /Assemble draft/i }).click();
  await page.getByText(/Machine-drafted/i).first().waitFor({ timeout: DRAFT_DEADLINE_MS });
  await page.waitForTimeout(1500);
  {
    const body = await page.locator("body").innerText();
    const chapters = new Set([...body.matchAll(/^(\d{1,2})\.\s.{4,80}$/gm)].map((m) => Number(m[1]))).size;
    const annexes = new Set([...body.matchAll(/^[A-K]\.\s.{4,80}$/gm)].map((m) => m[0][0])).size;
    const health = /Evidence health/.test(body);
    const modelPage = /THE MODEL THIS RUN EXECUTES/.test(body);
    const undrafted = (body.match(/is not drafted/gi) || []).length;
    const noClaim = /no stage claimable/i.test(body);
    const conditional = /CONDITIONS ON THIS CHAPTER/.test(body);
    const citesForesight = /qa-foresight-scenarios\.txt/.test(body);
    report.phases.draftFirst = { chapters, annexes, health, modelPage, undrafted, noClaim, conditional, citesForesight };
    note(`   draft-first: chapters=${chapters} annexes=${annexes} health=${health} model=${modelPage} undrafted=${undrafted} noClaim=${noClaim} conditional=${conditional} foresight=${citesForesight}`);
    if (chapters !== 17 || annexes !== 11) throw new Error(`draft-first expected 17+11, saw ${chapters}+${annexes}`);
    if (!health) throw new Error("draft-first: evidence-health page missing");
    if (!modelPage) throw new Error("draft-first: the draft must open by explaining the model it runs on");
    if (undrafted > 0) throw new Error(`draft-first: ${undrafted} sections undrafted`);
    if (!noClaim) throw new Error("draft-first: the engagement-package rule must still withhold the stage");
    if (!conditional) throw new Error("draft-first: prescriptive chapters should carry the conditional banner pre-validation");
    if (!citesForesight) throw new Error("draft-first: the uploaded strategic-foresight material is not cited in the draft");
  }
  await shot("d-01b-draft-first");
  phase("draftFirstAssembled", report.phases.draftFirst);

  note("5. gauntlet: read the failing gates, then clear them as the human");
  let failing = await failingGates();
  report.phases.gatesBefore = { failing: failing.length, ids: failing.map((f) => f.id) };
  await shot("d-02-gauntlet-before");
  for (const gate of failing) {
    note(`   clearing ${gate.id} — ${gate.why.slice(0, 60)}`);
    await clearGate(gate.id);
  }
  failing = await failingGates();
  await shot("d-03-gauntlet-after");
  const clearedText = await page.locator("body").innerText();
  const cleared = /Cleared — policy chapters may assemble|Gauntlet passed/i.test(clearedText);
  if (!cleared || failing.length > 0) {
    throw new Error(`gauntlet still locked after human pass: ${failing.map((f) => `${f.id}(${f.why})`).join("; ")}`);
  }
  phase("gauntletCleared", { humanCleared: report.phases.gatesBefore.failing });

  note("6. record steps 2–8");
  await tab("steps");
  await recordStep("Standard assessment", "QA delivery loop: live lending pipeline demonstration. Rejected Defer and Rapid.");
  await recordStep(null, "Shortlist proposed to counterpart.", {
    click: ["Wheat", "Cotton", "Citrus (oranges)", "Tomatoes / fresh vegetables"],
    rejected: "Rice expansion",
  });
  await recordStep(null, "Evidence plan: route unmeasured core gates to ITU/GSMA, MALR, NTRA/MCIT.");
  await recordStep(null, "Demonstration record of government gates. Not an official Government of Egypt decision.");
  await recordStep(null, "Panel notes: machine-imported official series validated as provisional; human-cleared gates carry demonstration citations.");
  await recordStep(null, "Envelope scenario recorded as a working assumption for drafting.");
  await recordStep(null, "Adopt the engagement-package draft for internal review. Version 0.1.");
  await page.getByText(/The record is adopted/i).waitFor({ timeout: 10000 });
  phase("ladder", { steps: "2-8 recorded" });

  note("7. re-assemble with the validated evidence (live model prose + fidelity gate)");
  await tab("exports");
  await page.getByRole("button", { name: /Assemble draft/i }).click();
  await page.getByText(/Machine-drafted/i).first().waitFor({ timeout: DRAFT_DEADLINE_MS });
  await page.waitForTimeout(1500);
  await shot("d-04-draft");

  const body = await page.locator("body").innerText();
  const chapterHeads = [...body.matchAll(/^(\d{1,2})\.\s.{4,80}$/gm)].map((m) => Number(m[1]));
  const annexHeads = [...body.matchAll(/^[A-K]\.\s.{4,80}$/gm)].map((m) => m[0][0]);
  const notDrafted = (body.match(/is not drafted/gi) || []).length;
  const gauntletBlocked = /Evidence gauntlet has not passed/i.test(body);
  // Count per-chapter attributions only. The document header also names the
  // model, which once made a fully-deterministic draft look like "1 chapter of
  // prose" (LEARNINGS L13) — so subtract it when present.
  const attributions = (body.match(/Machine-drafted by openrouter:/gi) || []).length;
  const prosed = Math.max(0, attributions - 1);
  const fidelityRejected = (body.match(/rejected by the fidelity check/gi) || []).length;

  report.phases.draft = {
    chapters: new Set(chapterHeads).size,
    annexes: new Set(annexHeads).size,
    notDrafted,
    gauntletBlocked,
    chaptersWithModelProse: prosed,
    fidelityRejected,
  };
  note(`   chapters=${new Set(chapterHeads).size} annexes=${new Set(annexHeads).size} notDrafted=${notDrafted} prose=${prosed} fidelityRejected=${fidelityRejected}`);

  if (new Set(chapterHeads).size !== 17) throw new Error(`expected 17 chapters, saw ${new Set(chapterHeads).size}`);
  if (new Set(annexHeads).size !== 11) throw new Error(`expected 11 annexes, saw ${new Set(annexHeads).size}`);
  if (gauntletBlocked) throw new Error("draft still reports the gauntlet as unpassed");
  if (notDrafted > 0) throw new Error(`${notDrafted} sections remain undrafted after a full ladder`);
  // The deterministic fallback is honest but must not silently become the norm:
  // when a drafting model is configured, a majority of chapters must carry its
  // prose (fidelity rejections count as the pipeline working, so they add back).
  if (prosed + fidelityRejected < 9) {
    throw new Error(`model prose reached only ${prosed} of 17 chapters (${fidelityRejected} fidelity-rejected) — check the audit tab for provider errors`);
  }
  phase("draftAssembled", report.phases.draft);

  note("7b. red-team the final draft (deterministic + adversarial)");
  await tab("redteam");
  await page.getByRole("button", { name: /Run red team/i }).click();
  // 17 adversarial chapter reviews at concurrency 4 on a reasoning model.
  await page.getByText(/Red team reviewed \d+ chapters/i).waitFor({ timeout: 25 * 60 * 1000 });
  {
    const summaryText = await page.getByText(/Red team reviewed \d+ chapters/i).first().innerText();
    const m = summaryText.match(/reviewed (\d+) chapters: (\d+) finding/i);
    report.phases.redTeam = { reviewed: m ? Number(m[1]) : 0, findings: m ? Number(m[2]) : 0, summary: summaryText.slice(0, 200) };
    note(`   red team: ${summaryText.slice(0, 140)}`);
    if (!m || Number(m[1]) < 17) throw new Error(`red team reviewed ${m ? m[1] : 0} chapters; expected 17`);
    if (/adversarial pass skipped/i.test(summaryText)) throw new Error("red team ran without the adversarial pass despite an active model");
  }
  await shot("d-04b-redteam");
  phase("redTeam", report.phases.redTeam);

  note("7c. export the consulting deck");
  await tab("exports");
  const [deckDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }).catch(() => null),
    page.getByRole("button", { name: /Roadmap deck/i }).click(),
  ]);
  if (!deckDownload) throw new Error("Deck download did not start");
  {
    const path = await deckDownload.path();
    const { statSync } = await import("node:fs");
    const size = path ? statSync(path).size : 0;
    report.phases.deck = { filename: deckDownload.suggestedFilename(), bytes: size };
    note(`   deck: ${deckDownload.suggestedFilename()} (${Math.round(size / 1024)} KB)`);
    if (!/\.pptx$/.test(deckDownload.suggestedFilename())) throw new Error("deck export is not a .pptx");
    if (size < 20_000) throw new Error(`deck file suspiciously small: ${size} bytes`);
  }
  phase("deck", report.phases.deck);

  note("8. exports and persistence");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
    page.getByRole("button", { name: /Evidence CSV/i }).click(),
  ]);
  if (!download) throw new Error("Evidence CSV download did not start");
  await page.reload({ waitUntil: "networkidle" });
  await tab("steps");
  await page.getByText(/The record is adopted/i).waitFor({ timeout: 15000 });
  await shot("d-05-reload");
  phase("persistence", { csv: true, reload: true });

  const realErrors = errors.filter(
    (e) => !/hydration|Minified React error #418|#423|#425|Failed to load resource/i.test(e),
  );
  report.ok = realErrors.length === 0;
  report.consoleErrors = realErrors;
  report.finishedAt = new Date().toISOString();

  mkdirSync(join(projectRoot, "qa-reports"), { recursive: true });
  const reportPath = join(projectRoot, "qa-reports", `delivery-${report.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(reportPath, JSON.stringify({ ...report, log }, null, 2));
  note(`report: ${reportPath}`);

  if (!report.ok) {
    console.error("console errors:", realErrors);
    process.exit(2);
  }
  note("DELIVERY PASS — the studio produced a complete, gate-cleared roadmap.");
} catch (e) {
  console.error("DELIVERY FAIL:", e.message);
  await shot("d-fail");
  report.error = e.message;
  report.finishedAt = new Date().toISOString();
  mkdirSync(join(projectRoot, "qa-reports"), { recursive: true });
  writeFileSync(
    join(projectRoot, "qa-reports", `delivery-${report.startedAt.replace(/[:.]/g, "-")}-FAIL.json`),
    JSON.stringify({ ...report, log, errors }, null, 2),
  );
  process.exit(1);
} finally {
  await browser.close();
}
