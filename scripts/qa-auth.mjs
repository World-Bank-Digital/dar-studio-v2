/**
 * Auth QA loop (`npm run qa:auth`): proves the sign-in surface end to end
 * against a running dev server — fresh signup (triggers the verification
 * email, dev-logged without RESEND_API_KEY), passkey registration and a
 * passkey-only sign-in via Chromium's CDP virtual authenticator.
 *
 * Run against http://localhost:8080 — NOT 127.0.0.1: WebAuthn refuses the
 * rpID "localhost" for a 127.0.0.1 origin (LEARNINGS L16).
 */
import { chromium } from "playwright";

const base = "http://localhost:8080";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const out = { steps: [] };
const step = (s, d) => { out.steps.push({ s, ...d }); console.log("·", s, d ? JSON.stringify(d) : ""); };

// Virtual authenticator: an internal, UV-capable "platform" key.
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
step("virtual authenticator ready", { authenticatorId: authenticatorId.slice(0, 8) });

try {
  // 1. Fresh signup → should trigger the verification dev-mail server-side.
  const email = `passkey.test.${Date.now()}@example.com`;
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("Name").fill("Passkey Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("TestPass123!");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  step("signed up", { email });

  // 2. Register a passkey in Settings.
  await page.goto(base + "/settings", { waitUntil: "networkidle" });
  await page.getByPlaceholder(/Passkey name/i).fill("virtual test key");
  await page.getByRole("button", { name: /Register a passkey/i }).click();
  await page.getByText(/Passkey registered/i).waitFor({ timeout: 20000 });
  const creds = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  step("passkey registered", { storedCredentials: creds.credentials.length });

  // 3. Sign out, then sign back in with ONLY the passkey.
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForURL(/login|\/$/, { timeout: 15000 });
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Sign in with a passkey/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  // Hydration race: the shell SSRs signed-out and flips once useSession
  // resolves — assert with a retrying wait, not an instant snapshot.
  await page.getByRole("button", { name: /Sign out/i }).waitFor({ timeout: 15000 });
  step("passkey sign-in", { signedIn: true });

  console.log("AUTH VERIFY PASS");
} catch (e) {
  console.error("AUTH VERIFY FAIL:", e.message);
  await page.screenshot({ path: "screenshots/auth-verify-fail.png", fullPage: true }).catch(() => null);
  process.exitCode = 1;
} finally {
  await browser.close();
}
