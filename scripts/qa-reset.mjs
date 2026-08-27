/**
 * Password-reset QA (`node scripts/qa-reset.mjs`): proves the whole loop against a
 * running dev server — request a link, read it out of the dev mailer's console output,
 * set a new password, sign in with it, and confirm the link cannot be used twice.
 *
 * It uses a throwaway account it creates itself. Nothing here touches a real one.
 *
 * Pass the dev server's log file as DEV_LOG so the link can be read; without
 * RESEND_API_KEY the mailer prints the message instead of sending it.
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const base = "http://localhost:8080";
const devLog = process.env.DEV_LOG;
if (!devLog) throw new Error("set DEV_LOG to the dev server's log file");

const browser = await chromium.launch({ headless: true });
const page = await browser.newContext().then((c) => c.newPage());
const step = (s, d) => console.log("·", s, d ? JSON.stringify(d) : "");

/** The most recent reset link the dev mailer printed for this address. */
async function resetLinkFor(email) {
  const log = await readFile(devLog, "utf8");
  const links = [...log.matchAll(/https?:\/\/[^\s]*reset-password[^\s]*/g)].map((m) => m[0]);
  const after = log.lastIndexOf(email);
  if (after === -1) return null;
  // Take the last link printed at or after this address was last named.
  const tail = log.slice(after);
  const inTail = [...tail.matchAll(/https?:\/\/[^\s]*reset-password[^\s]*/g)].map((m) => m[0]);
  return (inTail.length ? inTail : links).at(-1) ?? null;
}

try {
  const email = `reset.test.${Date.now()}@example.com`;
  const first = "FirstPass123!";
  const second = "SecondPass456!";

  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Reset Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(first);
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  step("signed up", { email });

  await page.goto(base + "/api/auth/sign-out", { waitUntil: "networkidle" }).catch(() => {});
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Forgotten your password/i }).click();
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: /Send a reset link/i }).click();
  await page.getByText(/a reset link is on its way/i).waitFor({ timeout: 15000 });
  step("asked for a link, and was told nothing about whether the address exists");

  await page.waitForTimeout(1500);
  const link = await resetLinkFor(email);
  if (!link) throw new Error("no reset link was printed by the dev mailer");
  step("link issued", { link: link.slice(0, 60) + "…" });

  await page.goto(link, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Set a new password/i }).waitFor();

  // A mistyped confirmation must be caught here: the person cannot sign in to check.
  await page.getByPlaceholder("New password", { exact: true }).fill(second);
  await page.getByPlaceholder("New password again").fill("NotTheSame789!");
  await page.getByRole("button", { name: /Set the password/i }).click();
  await page.getByText(/do not match/i).waitFor({ timeout: 10000 });
  step("caught a mistyped confirmation");

  await page.getByPlaceholder("New password again").fill(second);
  await page.getByRole("button", { name: /Set the password/i }).click();
  await page.waitForURL(/\/login/, { timeout: 20000 });
  step("password set");

  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(second);
  await page.getByRole("button", { name: /Sign in with email/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  step("signed in with the new password");

  // Single use: the same link must not work again.
  await page.goto(base + "/api/auth/sign-out", { waitUntil: "networkidle" }).catch(() => {});
  await page.goto(link, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  if (!/cannot be used/i.test(body)) {
    throw new Error("a spent reset link was still accepted");
  }
  step("the spent link was refused, and said why");

  console.log("\nALL STEPS PASSED");
  await browser.close();
  process.exit(0);
} catch (err) {
  await page.screenshot({ path: (process.env.QA_SHOT_DIR ?? ".") + "/reset-FAIL.png" }).catch(() => {});
  console.error("\nFAILED:", err.message);
  await browser.close();
  process.exit(1);
}
