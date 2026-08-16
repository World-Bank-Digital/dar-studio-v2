import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

try {
  const email = `ttl.gauntletui.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 20000 });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").waitFor({ timeout: 10000 });
  await page.getByPlaceholder("Name").fill("Randeep Sudan");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

  await page.getByRole("button", { name: /^New country$/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByPlaceholder("Country name").fill("Egypt");
  await page.waitForTimeout(600);
  await dialog.getByRole("button", { name: /Egypt, Arab Rep/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  await page.getByRole("heading", { name: /Egypt/i }).waitFor({ timeout: 15000 });

  await page.getByRole("button", { name: /^gauntlet$/i }).click();
  await page.getByRole("heading", { name: /Not cleared|Cleared/i }).waitFor({ timeout: 15000 });
  await page.getByText("2.1", { exact: true }).first().waitFor();
  await page.getByText("7.12", { exact: true }).first().waitFor();
  await page.screenshot({ path: "/workspace/screenshots/egypt-gauntlet.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/workspace/screenshots/egypt-gauntlet-mobile.png", fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );

  const body = await page.content();
  const locked = /Not cleared|roadmap stays locked/i.test(body);
  const hasTasks = /Research tasks|blocking/i.test(body);
  const leftover = errors.filter((e) => !/hydration|Minified React error #418|#423|#425/i.test(e));

  console.log(JSON.stringify({ locked, hasTasks, overflow, leftover, email }, null, 2));
  if (!locked || !hasTasks || leftover.length || overflow) process.exit(2);
} catch (e) {
  await page.screenshot({ path: "/workspace/screenshots/egypt-gauntlet-fail.png", fullPage: true }).catch(() => null);
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
