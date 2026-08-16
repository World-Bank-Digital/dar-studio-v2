// NOTE: written for the pre-2026-08-17 flat-tab UI; the workspace now uses
// grouped navigation. qa-delivery.mjs and qa-auth.mjs are the canonical loops.
import { chromium } from "playwright";
import { shotPath } from "./qa-paths.mjs";

const base = process.argv[2] || "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

async function shot(name) {
  await page.screenshot({ path: shotPath(name), fullPage: true });
}

const email = `ttl.egypt.${Date.now()}@example.com`;
await page.goto(base + "/login", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Need an account/i }).click();
await page.getByPlaceholder("Name").fill("Randeep Sudan");
await page.getByPlaceholder("Email").fill(email);
await page.getByPlaceholder("Password").fill("TestPass123!");
await page.getByRole("button", { name: /Create account/i }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => null);
await page.waitForTimeout(600);
await shot("portfolio");

await page.getByRole("button", { name: /New country/i }).click();
await page.getByPlaceholder("Country name").fill("Egypt");
await page.waitForTimeout(400);
const egyptRow = page.getByRole("button", { name: /Egypt/i }).first();
await egyptRow.waitFor({ timeout: 15000 });
await egyptRow.click();
await page.waitForURL(/\/c\//, { timeout: 20000 });
await page.waitForTimeout(800);
await shot("egypt-ready");

const launch = page.getByRole("button", { name: /Launch Step 1 diagnostic/i }).first();
if (await launch.count()) {
  await launch.click();
}

const deadline = Date.now() + 360000;
while (Date.now() < deadline) {
  const collecting = await page.getByText(/of \d+ public series|Collecting \d+\/\d+/i).count();
  const nextStep = await page.getByText(/Record the Step 2/i).count();
  const complete = await page.getByText(/Automated diagnostic complete/i).count();
  if ((nextStep > 0 || complete > 0) && collecting === 0) break;
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(800);
await shot("egypt-workspace");

await page.getByRole("button", { name: /^evidence$/i }).click();
await page.waitForTimeout(500);
await page.getByText("Credibility", { exact: true }).first().waitFor({ timeout: 10000 });
await shot("egypt-evidence");

await page.getByRole("button", { name: /^steps$/i }).click();
await page.getByRole("button", { name: /Record decision/i }).waitFor({ timeout: 30000 });
await page.waitForTimeout(400);

async function recordStep(optionLabel, notes, extra) {
  await page.getByRole("button", { name: /Record decision/i }).waitFor({ timeout: 15000 });
  if (optionLabel) {
    const select = page.locator("form select").first();
    if (await select.count()) {
      await select.selectOption({ label: optionLabel }).catch(async () => {
        await select.selectOption(optionLabel).catch(() => null);
      });
    }
  }
  if (extra?.chains || extra?.click) {
    const chainInput = page.locator("form input").nth(1);
    if (extra.chains && (await chainInput.count())) await chainInput.fill(extra.chains);
    for (const name of extra.click ?? []) {
      const chip = page.getByRole("button", { name, exact: true });
      if (await chip.count()) await chip.click();
    }
  }
  const notesBox = page.locator("form textarea");
  await notesBox.fill(notes);
  await page.getByRole("button", { name: /Record decision/i }).click();
  await page.getByText(/Decision recorded/i).waitFor({ timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(500);
}

await recordStep("Standard assessment", "Egypt engagement: live lending pipeline. Rejected Defer — government digital-agriculture demand is documented. Rejected Rapid — core gates are mostly unmeasured.");
await recordStep(null, "Shortlist proposed to counterpart. Rejected rice expansion given water-policy sensitivity.", {
  click: ["Wheat", "Cotton", "Citrus (oranges)", "Tomatoes / fresh vegetables"],
  rejected: "Rice expansion",
});
await recordStep(null, "Evidence plan: route unmeasured core gates to ITU/GSMA (2.1, 2.5), MALR (3.3, 3.11, 4.5, 4.9, 5.5, 5.7), NTRA/MCIT (4.1, 4.2), and farmer-consent steward (7.12). Mission after mandate.");
await page.locator("select").first().selectOption("Steering committee").catch(() => null);
await recordStep(null, "Demonstration record of government gates: mandate letter, inter-ministerial steering committee, endorsed wheat / cotton / citrus / horticulture shortlist. Not an official Government of Egypt decision.");
await recordStep(null, "Panel notes: only machine-imported World Bank series are validated as provisional. Core gates remain unmeasured — stage stays unclaimable.");
await recordStep(null, "Envelope scenario recorded as a working assumption for drafting. No financing instrument is selected.");
await recordStep(null, "Adopt the engagement-package draft for internal Bank use. Disclose only after counterpart review. Version 0.1.");
await shot("egypt-steps-done");

await page.getByRole("button", { name: /^exports$/i }).click();
await page.getByRole("button", { name: /Assemble draft/i }).click();
await page.getByText(/Machine-drafted/i).first().waitFor({ timeout: 120000 });
await page.waitForTimeout(600);
await shot("egypt-draft");

const body = await page.locator("article, pre").allTextContents();
const text = body.join("\n");
const draftOk =
  /Egypt/i.test(text) &&
  /not an official World Bank system/i.test(await page.content()) &&
  (/named gap|not rated|no stage is claimable|engagement package/i.test(text) ||
    /World Bank/i.test(text));

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await shot("mobile-home");
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
);

await browser.close();

const result = { overflow, errors, email, draftOk, textSample: text.slice(0, 400) };
console.log(JSON.stringify(result, null, 2));
if (errors.length || overflow || !draftOk) process.exit(2);
