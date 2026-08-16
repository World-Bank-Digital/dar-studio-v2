import { chromium } from "playwright";

const base = "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});

async function shot(name) {
  await page.screenshot({ path: `/workspace/screenshots/${name}.png`, fullPage: true });
}

try {
  const email = `ttl.delete.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Delete Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: /New country/i }).click();
  await page.getByPlaceholder("Country name").fill("Egypt");
  await page.waitForTimeout(500);
  const egyptRow = page.getByRole("button", { name: /Egypt, Arab Rep/i }).first();
  await egyptRow.waitFor({ timeout: 15000 });
  await egyptRow.click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  await page.waitForTimeout(600);

  await page.getByRole("link", { name: /Portfolio/i }).first().click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot("delete-before");

  const card = page.getByRole("heading", { name: /Egypt, Arab Rep/i });
  await card.waitFor({ timeout: 10000 });
  console.log("egypt visible before delete");

  await page.getByRole("button", { name: /Remove Egypt/i }).click();
  await page.waitForTimeout(300);
  await shot("delete-confirm");

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 5000 });
  const dialogText = await dialog.innerText();
  console.log("dialog:", dialogText.replace(/\s+/g, " ").slice(0, 200));

  await page.getByRole("button", { name: /^Remove$/i }).click();
  await page.waitForTimeout(1500);
  await shot("delete-after");

  const stillThere = await page.getByRole("heading", { name: /Egypt, Arab Rep/i }).count();
  const emptyState = await page.getByText(/No countries yet/i).count();
  console.log(JSON.stringify({ stillThere, emptyState, errors }, null, 2));

  if (stillThere > 0) {
    console.error("FAIL: Egypt still listed after delete");
    process.exit(1);
  }
  if (emptyState === 0) {
    console.error("FAIL: empty state not shown");
    process.exit(1);
  }
  console.log("PASS: Egypt removed from portfolio");
} catch (e) {
  console.error("TEST ERROR", e);
  await shot("delete-error");
  process.exit(1);
} finally {
  await browser.close();
}
