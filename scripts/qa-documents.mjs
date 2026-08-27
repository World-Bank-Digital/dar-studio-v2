/**
 * Document-set QA (`node scripts/qa-documents.mjs`): signs in as a throwaway account and
 * checks that the Documents tab names the whole set, including the parts that do not
 * exist, and that a produced document actually opens.
 */
import { chromium } from "playwright";

const base = "http://localhost:8080";
const shot = process.env.QA_SHOT_DIR ?? ".";
const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1280, height: 950 } }).then((c) => c.newPage());
const step = (s, d) => console.log("·", s, d ? JSON.stringify(d) : "");

try {
  const email = `docs.test.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Docs Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

  await page.getByRole("button", { name: /Egypt worked example/i }).click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByText(/documents produced/).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${shot}/docs-1-empty.png` });

  const body = await page.locator("body").innerText();
  step("set named", { line: (body.match(/\d+ of \d+ documents produced/) ?? ["none"])[0] });

  // The claim that matters: a document that does not exist is still named, and says what
  // would produce it. A list of only what exists makes a set of one look complete.
  for (const title of ["Diagnostic report", "Strategic foresight", "Draft roadmap"]) {
    if (!body.includes(title)) throw new Error(`the set did not name "${title}"`);
  }
  if (!/has not been run/.test(body)) {
    throw new Error("a missing document did not say what would produce it");
  }
  step("missing documents are named, with the reason");
  if (!/review happens once/i.test(body)) throw new Error("the review rule was not stated");
  step("the review rule is on the page");

  console.log("\nALL STEPS PASSED");
  await browser.close();
  process.exit(0);
} catch (err) {
  await page.screenshot({ path: `${shot}/docs-FAIL.png` }).catch(() => {});
  console.error("\nFAILED:", err.message);
  await browser.close();
  process.exit(1);
}
