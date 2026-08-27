// NOTE: written for the pre-2026-08-17 flat-tab UI; the workspace now uses
// grouped navigation. qa-delivery.mjs and qa-auth.mjs are the canonical loops.
import { chromium } from "playwright";
import { shotPath } from "./qa-paths.mjs";

const base = "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));

async function shot(name) {
  await page.screenshot({ path: shotPath(name), fullPage: true });
}

const email = `ttl.dec.${Date.now()}@example.com`;
await page.goto(base + "/login", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Need an account/i }).click();
await page.getByPlaceholder("Name").fill("Dec Tester");
await page.getByPlaceholder("Email").fill(email);
await page.getByPlaceholder("Password").fill("TestPass123!");
await page.getByRole("button", { name: /Create account/i }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
await page.getByRole("button", { name: /Load Bhutan pack/i }).click();
await page.waitForURL(/\/c\//, { timeout: 20000 });
await page.waitForTimeout(800);
await page.getByRole("button", { name: /^evidence$/i }).click();
await page.waitForTimeout(500);
await shot("decimals-evidence");

const cells = await page.locator("td.tabular-nums").allInnerTexts();
const numeric = cells.map((t) => t.trim()).filter((t) => /^-?\d/.test(t));
const long = numeric.filter((t) => {
  const m = t.match(/\.(\d+)/);
  return m && m[1].length > 2;
});
console.log(JSON.stringify({ sample: numeric.slice(0, 20), long }, null, 2));
if (long.length) {
  console.error("FAIL long decimals", long);
  process.exit(1);
}
console.log("PASS");
await browser.close();
