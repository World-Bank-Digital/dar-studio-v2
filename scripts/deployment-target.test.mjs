import assert from "node:assert/strict";
import { test } from "node:test";

import { deploymentTarget } from "./deployment-target.mjs";

test("Netlify's authoritative build flag selects the official adapter", () => {
  assert.equal(deploymentTarget("build", { NETLIFY: "true" }), "netlify");
});

test("ordinary builds retain the existing Vercel target", () => {
  assert.equal(deploymentTarget("build", {}), "vercel");
  assert.equal(deploymentTarget("build", { NETLIFY: "false" }), "vercel");
});

test("serve mode remains provider-neutral", () => {
  assert.equal(deploymentTarget("serve", { NETLIFY: "true" }), null);
});
