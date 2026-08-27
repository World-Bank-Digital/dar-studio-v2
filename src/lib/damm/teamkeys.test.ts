import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { teamAdminEmails } from "./teamkeys.ts";

describe("team-key administration (feature: team BYOK)", () => {
  const prev = process.env.DAR_ADMIN_EMAILS;
  afterEach(() => {
    if (prev === undefined) delete process.env.DAR_ADMIN_EMAILS;
    else process.env.DAR_ADMIN_EMAILS = prev;
  });

  it("admins are configured, not self-appointed — parsed from DAR_ADMIN_EMAILS", () => {
    process.env.DAR_ADMIN_EMAILS = " Alice@Example.com, bob@team.org ,,";
    assert.deepEqual(teamAdminEmails(), ["alice@example.com", "bob@team.org"]);
  });

  it("no configuration means no admins — never a default-open role", () => {
    delete process.env.DAR_ADMIN_EMAILS;
    assert.deepEqual(teamAdminEmails(), []);
  });
});
