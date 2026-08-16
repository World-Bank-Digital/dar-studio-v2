import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const log = [];
function note(m) {
  log.push(m);
  console.log(m);
}
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});

async function shot(name) {
  await page.screenshot({ path: `/workspace/screenshots/${name}.png`, fullPage: true });
}

function realErrors() {
  return errors.filter(
    (e) =>
      !/hydration|Hydration|Minified React error #418|#423|#425/i.test(e) &&
      !/Failed to load resource/i.test(e),
  );
}

try {
  const email = `ttl.gauntlet.${Date.now()}@example.com`;
  note("1. signup");
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Randeep Sudan");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForTimeout(700);
  await shot("g-01-portfolio");

  note("2. nav methodology / glossary / settings");
  await page.getByRole("link", { name: /^Methodology$/i }).click();
  await page.waitForURL(/methodology/, { timeout: 10000 });
  await page.getByRole("heading", { name: /Methodology/i }).waitFor();
  await page.getByRole("link", { name: /^Glossary$/i }).click();
  await page.waitForURL(/glossary/, { timeout: 10000 });
  await page.getByRole("heading", { name: /Glossary/i }).waitFor();
  await page.getByRole("link", { name: /^Settings$/i }).click();
  await page.waitForURL(/settings/, { timeout: 10000 });
  await page.getByRole("heading", { name: /Settings/i }).waitFor();
  await page.getByRole("link", { name: /^Portfolio$/i }).first().click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 10000 });

  note("3. create Egypt");
  await page.getByRole("button", { name: /^New country$/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByPlaceholder("Country name").fill("Egypt");
  await page.waitForTimeout(500);
  await dialog.getByRole("button", { name: /Egypt, Arab Rep/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot("g-02-egypt-ready");
  const heading = await page.getByRole("heading", { name: /Egypt, Arab Rep/i }).innerText();
  if (!/Egypt/i.test(heading)) throw new Error("Egypt workspace heading missing");

  note("4. launch diagnostic");
  const launch = page.getByRole("button", { name: /Launch Step 1 diagnostic/i }).first();
  await launch.waitFor({ timeout: 10000 });
  await launch.click();

  const deadline = Date.now() + 420000;
  let ingestDone = false;
  while (Date.now() < deadline) {
    const nextStep = await page.getByText(/Record the Step 2/i).count();
    const complete = await page.getByText(/Automated diagnostic complete/i).count();
    const collecting = await page.getByText(/Collecting \d+\/\d+/i).count();
    if ((nextStep > 0 || complete > 0) && collecting === 0) {
      ingestDone = true;
      break;
    }
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(800);
  await shot("g-03-after-ingest");
  if (!ingestDone) throw new Error("Diagnostic did not finish");

  note("4b. methodology — evidence gauntlet");
  await page.getByRole("button", { name: /^gauntlet$/i }).click();
  await page.getByRole("heading", { name: /Not cleared|Cleared/i }).waitFor({ timeout: 15000 });
  await shot("g-03b-gauntlet");
  const gauntletText = await page.locator("body").innerText();
  const gauntletLocked = /Not cleared|roadmap stays locked/i.test(gauntletText);
  const hasThirteen = ["2.1", "2.5", "2.9", "3.3", "3.11", "4.1", "4.2", "4.5", "4.9", "5.5", "5.7", "7.9", "7.12"].every(
    (id) => gauntletText.includes(id),
  );
  const rubricNotInvented = /3\.3[\s\S]{0,200}missing/i.test(gauntletText) || /3\.3/.test(gauntletText);
  if (!hasThirteen) throw new Error("Gauntlet table missing core-gate ids");

  note("5. walk every tab");
  const tabs = ["overview", "gauntlet", "dossier", "steps", "outline", "evidence", "visuals", "gates", "memo", "audit", "exports"];
  for (const t of tabs) {
    await page.getByRole("button", { name: new RegExp(`^${t}$`, "i") }).click();
    await page.waitForTimeout(350);
  }
  await page.getByRole("button", { name: /^evidence$/i }).click();
  await page.getByText("Credibility", { exact: true }).first().waitFor({ timeout: 10000 });
  const valueCells = await page.locator("td.tabular-nums").allInnerTexts();
  const longDec = valueCells.filter((t) => {
    const m = t.trim().match(/\.(\d+)/);
    return m && m[1].length > 2;
  });
  if (longDec.length) throw new Error("Long decimals in evidence: " + longDec.slice(0, 5).join(", "));
  await shot("g-04-evidence");

  note("6. record steps 2-8");
  await page.getByRole("button", { name: /^steps$/i }).click();
  await page.getByRole("button", { name: /Record decision/i }).waitFor({ timeout: 20000 });

  async function recordStep(optionLabel, notes, extra = {}) {
    await page.getByRole("button", { name: /Record decision/i }).waitFor({ timeout: 15000 });
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
    await page.getByText(/Decision recorded/i).waitFor({ timeout: 12000 });
    await page.waitForTimeout(400);
  }

  await recordStep("Standard assessment", "Egypt engagement: live lending pipeline. Rejected Defer and Rapid.");
  await recordStep(null, "Shortlist proposed to counterpart.", {
    click: ["Wheat", "Cotton", "Citrus (oranges)", "Tomatoes / fresh vegetables"],
    rejected: "Rice expansion",
  });
  await recordStep(null, "Evidence plan: route unmeasured core gates to ITU/GSMA, MALR, NTRA/MCIT.");
  await recordStep(null, "Demonstration record of government gates. Not an official Government of Egypt decision.");
  await recordStep(null, "Panel notes: only machine-imported official series are validated as provisional.");
  await recordStep(null, "Envelope scenario recorded as a working assumption for drafting.");
  await recordStep(null, "Adopt the engagement-package draft for internal Bank use. Version 0.1.");
  await shot("g-05-steps-done");
  await page.getByText(/The record is adopted/i).waitFor({ timeout: 8000 });

  note("7. memo + draft");
  await page.getByRole("button", { name: /^memo$/i }).click();
  await page.getByRole("button", { name: /Assemble memo/i }).click();
  await page.waitForTimeout(1500);
  const memoText = await page.locator("pre").first().innerText().catch(() => "");
  await shot("g-06-memo");

  await page.getByRole("button", { name: /^exports$/i }).click();
  await page.getByRole("button", { name: /Assemble draft/i }).click();
  await page.getByText(/Machine-drafted/i).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(500);
  await shot("g-07-draft");
  const draftText = (await page.locator("article, pre").allTextContents()).join("\n");
  const pageText = await page.content();
  const draftOk =
    /Egypt/i.test(draftText) &&
    /not an official World Bank system/i.test(pageText) &&
    /CMS \(capability\)/i.test(draftText) &&
    !/Chapter 2 — Where the country stands is not drafted/i.test(draftText);
  const policyLocked =
    /Evidence gauntlet has not passed/i.test(draftText) ||
    /Chapter 4[\s\S]{0,400}not drafted/i.test(draftText);
  const noStageClaim =
    /no maturity stage is asserted|no stage is claimable|Evidence gauntlet not passed|Engagement package/i.test(
      draftText + pageText,
    );
  if (!draftOk) throw new Error("Draft missing Egypt / disclaimer / standings chapter");
  if (!policyLocked) throw new Error("Policy chapters were assembled despite a failed gauntlet");
  if (!noStageClaim) throw new Error("Draft or claim asserted a maturity stage");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }).catch(() => null),
    page.getByRole("button", { name: /Evidence CSV/i }).click(),
  ]);
  if (!download) throw new Error("Evidence CSV download did not start");

  note("8. data preserved after reload");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^steps$/i }).click();
  await page.getByText(/The record is adopted/i).waitFor({ timeout: 10000 });
  await page.getByText(/Standard assessment/i).first().waitFor({ timeout: 8000 });
  await shot("g-08-reload");

  note("9. portfolio card timestamps + nav home");
  await page.getByRole("link", { name: /^Portfolio$/i }).first().click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 10000 });
  await page.getByText(/Opened /).first().waitFor({ timeout: 8000 });
  await shot("g-09-portfolio-done");

  note("10. mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shot("g-10-mobile");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  if (overflow) throw new Error("Mobile horizontal overflow");

  const leftover = realErrors();
  const result = {
    ok: leftover.length === 0 && gauntletLocked && policyLocked && noStageClaim,
    email,
    ingestDone,
    gauntletLocked,
    hasThirteen,
    rubricNotInvented,
    draftOk,
    policyLocked,
    noStageClaim,
    memoChars: memoText.length,
    leftover,
    allErrorCount: errors.length,
    log,
  };
  console.log(JSON.stringify(result, null, 2));
  if (leftover.length || !gauntletLocked || !policyLocked || !noStageClaim) process.exit(2);
  note("PASS");
} catch (e) {
  console.error("GAUNTLET FAIL", e);
  await shot("g-fail");
  console.log(JSON.stringify({ errors, log }, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
