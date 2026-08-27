import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { artifactDeliveryGrant, artifactGatewayOrigin } from "./artifact-delivery.ts";
import { verifyArtifactDeliveryToken } from "./artifact-delivery-token.ts";

const secret = "s".repeat(32);
const identity = {
  runId: "run-1",
  artifactSetId: "set-1",
  key: "bundle",
  sha256: "b".repeat(64),
  subjectUserId: "owner-1",
  accessAs: "country_owner" as const,
  packageId: null,
  assignmentId: null,
  targetIdentitySha256: null,
  bundleSha256: null,
};

describe("artifact delivery grant", () => {
  it("binds the gateway capability without putting it in a URL", () => {
    const grant = artifactDeliveryGrant(identity, {
      ARTIFACT_GATEWAY_URL: "https://dar-artifacts.onrender.com",
      ARTIFACT_DELIVERY_SECRET: secret,
    });
    assert.ok(grant);
    assert.equal(grant.endpoint, "https://dar-artifacts.onrender.com/v1/artifacts");
    assert.equal(grant.endpoint.includes(grant.token), false);
    assert.equal(grant.expiresInSeconds, 60);
    const payload = verifyArtifactDeliveryToken(grant.token, secret);
    assert.deepEqual(
      {
        runId: payload.runId,
        artifactSetId: payload.artifactSetId,
        key: payload.key,
        sha256: payload.sha256,
        subjectUserId: payload.subjectUserId,
        accessAs: payload.accessAs,
        packageId: payload.packageId,
        assignmentId: payload.assignmentId,
        targetIdentitySha256: payload.targetIdentitySha256,
        bundleSha256: payload.bundleSha256,
      },
      identity,
    );
  });

  it("allows local/legacy Vercel bytes but fails closed when Netlify runtime scope is missing", () => {
    assert.equal(artifactDeliveryGrant(identity, {}), null);
    assert.equal(artifactDeliveryGrant(identity, { VERCEL: "1" }), null);
    for (const environment of [
      { NETLIFY: "true" },
      { SITE_ID: "site-id" },
      { CONTEXT: "production" },
      { CONTEXT: "deploy-preview" },
    ]) {
      assert.throws(() => artifactDeliveryGrant(identity, environment), /Netlify.*runtime/i);
    }
    assert.throws(
      () => artifactDeliveryGrant(identity, { ARTIFACT_GATEWAY_URL: "https://x.invalid" }),
      /requires both/i,
    );
    assert.throws(
      () => artifactDeliveryGrant(identity, { ARTIFACT_DELIVERY_SECRET: secret }),
      /requires both/i,
    );
  });

  it("accepts only a clean HTTPS gateway origin", () => {
    assert.equal(artifactGatewayOrigin("https://x.invalid"), "https://x.invalid");
    for (const value of [
      "http://x.invalid",
      "https://x.invalid/path",
      "https://user@x.invalid",
      "https://x.invalid/?query=yes",
    ]) {
      assert.throws(() => artifactGatewayOrigin(value), /HTTPS origin/i);
    }
  });
});
