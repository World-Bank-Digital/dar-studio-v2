import { chromium } from "playwright";

const base = "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

async function shot(name) {
  await page.screenshot({ path: `/workspace/screenshots/${name}.png`, fullPage: true });
}

async function createEgypt() {
  await page.getByRole("button", { name: /^New country$/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByPlaceholder("Country name").fill("Egypt");
  await page.waitForTimeout(400);
  await dialog.getByRole("button", { name: /Egypt, Arab Rep/i }).first().click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.getByRole("link", { name: /Portfolio/i }).first().click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
  await page.waitForTimeout(700);
}

try {
  const email = `ttl.times.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Time Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForTimeout(600);

  await createEgypt();
  await page.waitForTimeout(1500);
  await createEgypt();
  await shot("card-times");

  const opened = page.getByText(/Opened /);
  const count = await opened.count();
  const texts = [];
  for (let i = 0; i < count; i++) texts.push(await opened.nth(i).innerText());
  console.log(JSON.stringify({ count, texts, errors }, null, 2));

  if (count < 2) {
    console.error("FAIL: expected two Opened timestamps");
    process.exit(1);
  }
  if (!texts.every((t) => /Opened /.test(t) && /\d/.test(t))) {
    console.error("FAIL: timestamp format missing", texts);
    process.exit(1);
  }

  await page.getByRole("button", { name: /Remove Egypt/i }).first().click();
  await page.waitForTimeout(300);
  await shot("card-times-confirm");
  const confirm = page.getByRole("dialog");
  const dialogText = await confirm.innerText();
  console.log("dialog:", dialogText.replace(/\s+/g, " "));
  if (!/Opened /.test(dialogText)) {
    console.error("FAIL: confirm dialog missing opened time");
    process.exit(1);
  }
  console.log("PASS");
} catch (e) {
  console.error(e);
  await shot("card-times-error");
  process.exit(1);
} finally {
  await browser.close();
}
