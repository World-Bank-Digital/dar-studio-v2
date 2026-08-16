// NOTE: written for the pre-2026-08-17 flat-tab UI; the workspace now uses
// grouped navigation. qa-delivery.mjs and qa-auth.mjs are the canonical loops.
import { chromium } from "playwright";
import { shotPath } from "./qa-paths.mjs";

const base = process.argv[2] || "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  const email = `ttl.dossier.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Randeep Sudan");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

  await page.getByRole("button", { name: /^New country$/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByPlaceholder("Country name").fill("Egypt");
  await page.waitForTimeout(500);
  await dialog.getByRole("button", { name: /Egypt, Arab Rep/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });

  await page.getByRole("button", { name: /^dossier$/i }).click();
  await page.getByRole("heading", { name: /Country dossier/i }).waitFor({ timeout: 10000 });
  await page.getByText(/cannot write an indicator|never write the evidence/i).first().waitFor();
  await page.getByRole("button", { name: /Build country dossier/i }).waitFor();
  await page.screenshot({ path: shotPath("dossier-empty"), fullPage: true });

  await page.getByRole("button", { name: /^gauntlet$/i }).click();
  await page.getByRole("heading", { name: /Not cleared|Cleared/i }).waitFor({ timeout: 10000 });

  const leftover = errors.filter((e) => !/hydration|Minified React error #418|#423|#425/i.test(e));
  console.log(JSON.stringify({ ok: leftover.length === 0, leftover, email }, null, 2));
  if (leftover.length) process.exit(2);
} catch (e) {
  await page.screenshot({ path: shotPath("dossier-fail"), fullPage: true }).catch(() => null);
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
