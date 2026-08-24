/**
 * Auth email delivery (server-only).
 *
 * Email cannot exist without a delivery provider, so this module is explicit
 * about its two modes rather than pretending:
 *
 *  - `RESEND_API_KEY` set → real delivery via Resend's HTTP API. `EMAIL_FROM`
 *    names the sender (Resend's onboarding sender works before a domain is
 *    verified, but only to the account owner's own address).
 *  - No key → **dev mode**: the full email is written to the server console,
 *    prefixed `[mailer:dev]`, and the result says `sent: false`. The flow is
 *    testable end-to-end; nobody is misled into thinking mail went out.
 *
 * Sending never throws and is always awaited out-of-band by callers — a mail
 * provider outage must never block or fail a sign-in.
 */

export interface MailResult {
  sent: boolean;
  mode: "resend" | "dev";
  error?: string;
}

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
}

const APP_NAME = "DAR Studio";

function resendKey(): string | undefined {
  const v = process.env.RESEND_API_KEY?.trim();
  return v ? v : undefined;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || `${APP_NAME} <onboarding@resend.dev>`;
}

/** True when real email delivery is configured. */
export function mailConfigured(): boolean {
  return Boolean(resendKey());
}

export async function sendAuthMail(mail: AuthMail): Promise<MailResult> {
  const key = resendKey();
  if (!key) {
    // Dev mode: visible, honest, greppable.
    console.log(
      `[mailer:dev] would send to=${mail.to} subject="${mail.subject}"\n` +
        mail.text.split("\n").map((l) => `[mailer:dev]   ${l}`).join("\n"),
    );
    return { sent: false, mode: "dev" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: fromAddress(), to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[mailer] resend returned ${res.status}: ${detail}`);
      return { sent: false, mode: "resend", error: `Resend returned ${res.status}` };
    }
    return { sent: true, mode: "resend" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    console.error(`[mailer] ${msg}`);
    return { sent: false, mode: "resend", error: msg };
  }
}

/* ---------- message builders (pure; unit-tested) ---------- */

export function buildVerificationMail(input: { email: string; name?: string | null; url: string }): AuthMail {
  const who = input.name?.trim() ? input.name.trim() : input.email;
  return {
    to: input.email,
    subject: `Verify your email for ${APP_NAME}`,
    text: [
      `Hello ${who},`,
      "",
      `Confirm this address for your ${APP_NAME} account by opening the link below:`,
      "",
      input.url,
      "",
      "If you did not create this account, ignore this message.",
    ].join("\n"),
  };
}

export function buildPasswordResetMail(input: {
  email: string;
  name?: string | null;
  url: string;
}): AuthMail {
  const who = input.name?.trim() ? input.name.trim() : input.email;
  return {
    to: input.email,
    subject: `Reset your ${APP_NAME} password`,
    text: [
      `Hello ${who},`,
      "",
      `Someone asked to reset the password for your ${APP_NAME} account. Open the link`,
      "below to choose a new one. It can be used once, and it expires in an hour.",
      "",
      input.url,
      "",
      "If this was not you, ignore this message — nothing has changed, and your current",
      "password still works.",
    ].join("\n"),
  };
}

export function buildSignInNotification(input: {
  email: string;
  name?: string | null;
  at: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}): AuthMail {
  const who = input.name?.trim() ? input.name.trim() : input.email;
  const lines = [
    `Hello ${who},`,
    "",
    `A sign-in to your ${APP_NAME} account just occurred.`,
    "",
    `Time: ${input.at.toISOString()}`,
  ];
  if (input.ipAddress) lines.push(`IP address: ${input.ipAddress}`);
  if (input.userAgent) lines.push(`Browser: ${input.userAgent.slice(0, 120)}`);
  lines.push("", "If this was you, no action is needed. If not, change your password now.");
  return { to: input.email, subject: `New sign-in to ${APP_NAME}`, text: lines.join("\n") };
}
