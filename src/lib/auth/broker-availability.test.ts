import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { brokerAvailable } from "./broker-availability.ts";

describe("broker availability", () => {
  it("keeps the baked preview broker available only on sandbox hosts", () => {
    assert.equal(brokerAvailable("example.grok-sandbox.com", false), true);
    assert.equal(brokerAvailable("dar-staging.netlify.app", false), false);
  });

  it("shows deployed social providers only when explicitly enabled", () => {
    assert.equal(brokerAvailable("dar-staging.netlify.app", true), true);
    assert.equal(brokerAvailable("dar-staging.netlify.app", false), false);
  });

  it("never offers broker callbacks on loopback", () => {
    assert.equal(brokerAvailable("localhost", true), false);
    assert.equal(brokerAvailable("127.0.0.1", true), false);
    assert.equal(brokerAvailable("[::1]", true), false);
  });
});
