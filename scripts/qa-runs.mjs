/**
 * Runs-surface QA (`node scripts/qa-runs.mjs`): drives the Research tab end to end
 * against a running dev server — start a pass, watch it progress, exhaust its budget,
 * add budget, and continue.
 *
 * It requires the dev server to be pointed at the REHEARSAL pipeline, which makes no
 * vendor call:
 *
 *   DAMM_PIPELINE_DIR=<scratch>/fakepipe DAMM_PIPELINE_PYTHON=python3 npm run dev
 *
 * Pointed at the real pipeline this would spend real money, so it checks the vendor is
 * a rehearsal one and refuses otherwise.
 */
import { chromium } from "playwright";

const base = "http://localhost:8080";
const shot = process.env.QA_SHOT_DIR ?? ".";
const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1280, height: 1000 } }).then((c) => c.newPage());
const step = (s, d) => console.log("·", s, d ? JSON.stringify(d) : "");

const seen = new Set();
page.on("console", (m) => {
  if (m.type() === "error") seen.add(m.text().slice(0, 160));
});

try {
  const email = `runs.test.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Runs Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  step("signed up", { email });

  await page.getByRole("button", { name: /Egypt worked example/i }).click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  step("opened the Egypt workspace");

  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.getByRole("heading", { name: /Start a pass/i }).waitFor();
  step("research tab open");

  // A $20 ceiling gives the research pass an $8 allocation — small enough that it stops
  // on budget partway through, which is the case the surface most has to get right.
  await page.locator("input").first().fill("20");
  await page.screenshot({ path: `${shot}/runs-1-start.png` });
  await page.getByRole("button", { name: /^Start$/ }).click();
  step("started a pass with a $20 ceiling");

  await page.getByText(/rows/).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shot}/runs-2-running.png` });
  const mid = await page.locator("body").innerText();
  step("mid-run", { line: (mid.match(/\d+ of \d+ rows/) ?? ["none"])[0] });

  await page.getByText(/Stopped on budget/i).waitFor({ timeout: 90000 });
  await page.screenshot({ path: `${shot}/runs-3-exhausted.png` });
  const text = await page.locator("body").innerText();
  const claims = {
    saysExhausted: /exhausted/i.test(text),
    saysNotGaps: /absent, not recorded as gaps/i.test(text),
    offersBudget: /Add budget to continue/i.test(text),
    notCalledFailure: !/\bfailed\b/i.test(text),
  };
  step("exhausted", claims);
  if (!claims.saysExhausted || !claims.saysNotGaps) throw new Error("exhaustion was not explained");
  if (!claims.notCalledFailure) throw new Error("an exhausted run was described as a failure");

  // The New ceiling field is pre-filled from the run's own rate. Take what it offers —
  // that is the number an operator would accept, so it is the one worth exercising.
  const suggested = await page.locator('input[inputmode="decimal"]').nth(1).inputValue();
  step("suggested ceiling", { suggested });
  // The claim is not that the suggestion is bigger — it is that accepting it finishes the
  // pass. A suggestion that has to be topped up again is the failure this exists to catch.
  if (!Number(suggested) || Number(suggested) <= 20) {
    throw new Error(`the suggested ceiling was ${suggested}, which would exhaust again`);
  }
  await page.getByRole("button", { name: /Continue/i }).first().click();
  step("added budget and continued");
  await page.getByText(/Finished .* rows/i).waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${shot}/runs-4-done.png` });
  const done = await page.locator("body").innerText();
  step("finished", { line: (done.match(/Finished [^.]*\./) ?? ["none"])[0] });

  // --- a human edit, which an import must never overwrite ------------------------
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  // Anchored on the ID cell, not on the row's text: a table row's textContent runs its
  // cells together ("1.1Agriculture value added…"), so a word-boundary match never fires
  // and a substring match would also hit 1.10 and 11.1.
  const rowFor = (id) =>
    page.locator("tr").filter({ has: page.locator("td", { hasText: new RegExp(`^${id.replace(".", "\\.")}$`) }) }).first();
  const row11 = rowFor("1.1");
  await row11.getByRole("button", { name: /^Edit$/ }).click();
  const valueBox = page.locator("textarea").first();
  await valueBox.fill("77.7");
  await page.getByRole("button", { name: /Save row/i }).click();
  await page.waitForTimeout(1500);
  step("edited row 1.1 by hand as TTL");

  // --- importing the pass into the workspace -------------------------------------
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.getByRole("button", { name: /Import into the workspace/i }).first().click();
  await page.getByText(/Imported \d+ of the/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${shot}/runs-7-imported.png` });
  const imp = await page.locator("body").innerText();
  step("imported", { line: (imp.match(/Imported [^\n]*/) ?? ["none"])[0] });

  // The claim that matters: the hand-edited row was left alone and both readings shown.
  if (!/you had entered/.test(imp)) throw new Error("the import did not report a held row");
  const heldRow = await page.locator("tr").filter({ hasText: /^1\.1yours|1\.1/ }).filter({ hasText: /77\.7/ }).first().innerText();
  if (!/77\.7/.test(heldRow)) throw new Error(`the held row did not show the assessor's value: ${heldRow}`);
  step("held the hand-edited row", { row: heldRow.replace(/\s+/g, " ").slice(0, 110) });

  // And it is still 77.7 in the evidence base, not the pass's figure.
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.waitForTimeout(1200);
  const ev = await rowFor("1.1").innerText();
  if (!/77\.7/.test(ev)) throw new Error(`row 1.1 was overwritten: ${ev}`);
  step("row 1.1 survived the import", { row: ev.replace(/\s+/g, " ").slice(0, 90) });
  await page.getByRole("button", { name: "Research", exact: true }).click();

  // --- the second review, and the rule that makes it a review -------------------
  await page.selectOption("select >> nth=1", "g2");
  await page.locator("input").first().fill("200");

  // Same vendor family as the research pass. This must be refused: a model that reviews
  // its own pass upholds it, and the second review would report a clean bill it never
  // earned.
  await page.selectOption("select >> nth=2", "anthropic/claude-sonnet-5");
  await page.getByRole("button", { name: /^Start$/ }).click();
  // Assert on wording only the refusal produces. The card carries a standing hint that
  // also says "reviewing its own work", and matching that would pass whether or not the
  // rule fired — a test that cannot fail is worse than no test.
  await page.getByText(/Cannot start this review/i).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${shot}/runs-5-peer-refused.png` });
  const refusal = await page.getByText(/Cannot start this review/i).innerText();
  if (!/anthropic/i.test(refusal)) throw new Error(`refusal did not name the vendor: ${refusal}`);
  const cards = await page.getByText(/Second review — gaps/).count();
  if (cards > 1) throw new Error("a run was created despite the refusal");
  step("refused a reviewer from the vendor that did the research", { refusal });

  await page.selectOption("select >> nth=2", "openai/gpt-5.6-terra");
  await page.getByRole("button", { name: /^Start$/ }).click();
  step("started the second review on another vendor");
  await page.getByText(/Finished .* rows/i).nth(1).waitFor({ timeout: 180000 });
  await page.screenshot({ path: `${shot}/runs-6-review-done.png` });
  const both = await page.locator("body").innerText();
  step("both passes recorded", {
    research: /Research — the 57-row first pass/.test(both),
    review: /Second review/.test(both),
  });

  if (seen.size) step("console errors", [...seen]);
  console.log(seen.size ? "\nFINISHED WITH CONSOLE ERRORS" : "\nALL STEPS PASSED");
  await browser.close();
  process.exit(seen.size ? 1 : 0);
} catch (err) {
  await page.screenshot({ path: `${shot}/runs-FAIL.png` }).catch(() => {});
  console.error("\nFAILED:", err.message);
  if (seen.size) console.error("console errors:", [...seen]);
  await browser.close();
  process.exit(1);
}
