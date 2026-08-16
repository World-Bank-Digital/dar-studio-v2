import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildSignInNotification, buildVerificationMail, mailConfigured, sendAuthMail } from "./mailer.ts";

describe("auth mail builders", () => {
  it("verification mail carries the link and the recipient", () => {
    const m = buildVerificationMail({ email: "a@b.c", name: "Randeep", url: "https://x/verify?t=1" });
    assert.equal(m.to, "a@b.c");
    assert.match(m.subject, /Verify/i);
    assert.ok(m.text.includes("https://x/verify?t=1"));
    assert.ok(m.text.includes("Randeep"));
  });

  it("falls back to the address when there is no name", () => {
    const m = buildVerificationMail({ email: "a@b.c", name: null, url: "https://x" });
    assert.match(m.text, /Hello a@b\.c/);
  });

  it("sign-in notification names time, ip and browser when known", () => {
    const m = buildSignInNotification({
      email: "a@b.c",
      name: "R",
      at: new Date("2026-08-17T10:00:00Z"),
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0 Test",
    });
    assert.match(m.subject, /New sign-in/i);
    assert.ok(m.text.includes("2026-08-17T10:00:00.000Z"));
    assert.ok(m.text.includes("203.0.113.9"));
    assert.ok(m.text.includes("Mozilla/5.0 Test"));
  });

  it("omits ip/browser lines when unknown rather than printing null", () => {
    const m = buildSignInNotification({ email: "a@b.c", at: new Date() });
    assert.doesNotMatch(m.text, /null|undefined/);
  });
});

describe("dev-mode delivery (no RESEND_API_KEY)", () => {
  let prev: string | undefined;
  before(() => {
    prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
  });
  after(() => {
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
  });

  it("reports honestly that nothing was sent, and never throws", async () => {
    assert.equal(mailConfigured(), false);
    const res = await sendAuthMail({ to: "a@b.c", subject: "s", text: "t" });
    assert.deepEqual(res, { sent: false, mode: "dev" });
  });
});
