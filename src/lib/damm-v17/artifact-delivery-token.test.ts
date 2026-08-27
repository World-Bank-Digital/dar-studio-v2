import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  ARTIFACT_DELIVERY_TOKEN_TTL_SECONDS,
  issueArtifactDeliveryToken,
  requireArtifactDeliverySecret,
  verifyArtifactDeliveryToken,
} from "./artifact-delivery-token.ts";

const secret = "0123456789abcdef0123456789abcdef";
const identity = {
  runId: "workflow-run-1",
  artifactSetId: "claim-token-1",
  key: "bundle",
  sha256: "a".repeat(64),
  subjectUserId: "user-owner-1",
  accessAs: "country_owner" as const,
  packageId: null,
  assignmentId: null,
  targetIdentitySha256: null,
  bundleSha256: null,
};

function signedPayload(payload: string): string {
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("short-lived artifact delivery tokens", () => {
  it("round-trips one exact immutable artifact and authenticated subject without profile PII", () => {
    const token = issueArtifactDeliveryToken(identity, secret, {
      now: new Date("2026-08-28T00:00:00.000Z"),
    });

    assert.deepEqual(
      verifyArtifactDeliveryToken(token, secret, new Date("2026-08-28T00:00:30.000Z")),
      {
        ...identity,
        exp: 1787875260,
        v: 2,
      },
    );
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    assert.deepEqual(Object.keys(payload), [
      "v",
      "runId",
      "artifactSetId",
      "key",
      "sha256",
      "subjectUserId",
      "accessAs",
      "packageId",
      "assignmentId",
      "targetIdentitySha256",
      "bundleSha256",
      "exp",
    ]);
    assert.equal(JSON.stringify(payload).includes("email"), false);
    assert.equal(JSON.stringify(payload).includes("name"), false);
  });

  it("binds reviewer access to the exact active assignment and immutable package", () => {
    const reviewerIdentity = {
      ...identity,
      subjectUserId: "user-reviewer-1",
      accessAs: "assigned_reviewer" as const,
      packageId: "package-1",
      assignmentId: "assignment-1",
      targetIdentitySha256: "c".repeat(64),
      bundleSha256: identity.sha256,
    };
    const token = issueArtifactDeliveryToken(reviewerIdentity, secret, {
      now: new Date("2026-08-28T00:00:00.000Z"),
    });
    assert.deepEqual(
      verifyArtifactDeliveryToken(token, secret, new Date("2026-08-28T00:00:30.000Z")),
      { ...reviewerIdentity, exp: 1787875260, v: 2 },
    );
    assert.throws(
      () =>
        issueArtifactDeliveryToken({ ...reviewerIdentity, assignmentId: "" }, secret, {
          now: new Date(),
        }),
      /assignment/i,
    );
  });

  it("expires at the fixed short-lived boundary", () => {
    const issuedAt = new Date("2026-08-28T00:00:00.000Z");
    const token = issueArtifactDeliveryToken(identity, secret, { now: issuedAt });
    assert.equal(ARTIFACT_DELIVERY_TOKEN_TTL_SECONDS, 60);
    assert.throws(
      () => verifyArtifactDeliveryToken(token, secret, new Date("2026-08-28T00:01:00.000Z")),
      /expired/i,
    );
  });

  it("rejects signature tampering and a different bundle identity", () => {
    const token = issueArtifactDeliveryToken(identity, secret, {
      now: new Date("2026-08-28T00:00:00.000Z"),
    });
    const [encoded, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    changed.artifactSetId = "claim-token-2";
    const changedEncoded = Buffer.from(JSON.stringify(changed)).toString("base64url");

    assert.throws(
      () =>
        verifyArtifactDeliveryToken(
          `${changedEncoded}.${signature}`,
          secret,
          new Date("2026-08-28T00:00:30.000Z"),
        ),
      /signature/i,
    );
  });

  it("rejects unknown fields and non-canonical payload encoding even when signed", () => {
    const unknown = signedPayload(
      JSON.stringify({
        v: 2,
        runId: identity.runId,
        artifactSetId: identity.artifactSetId,
        key: identity.key,
        sha256: identity.sha256,
        subjectUserId: identity.subjectUserId,
        accessAs: identity.accessAs,
        packageId: identity.packageId,
        assignmentId: identity.assignmentId,
        targetIdentitySha256: identity.targetIdentitySha256,
        bundleSha256: identity.bundleSha256,
        exp: 1787875260,
        reviewerEmail: "person@example.test",
      }),
    );
    const reordered = signedPayload(
      JSON.stringify({
        exp: 1787875260,
        bundleSha256: identity.bundleSha256,
        targetIdentitySha256: identity.targetIdentitySha256,
        assignmentId: identity.assignmentId,
        packageId: identity.packageId,
        accessAs: identity.accessAs,
        subjectUserId: identity.subjectUserId,
        sha256: identity.sha256,
        key: identity.key,
        artifactSetId: identity.artifactSetId,
        runId: identity.runId,
        v: 2,
      }),
    );

    assert.throws(
      () => verifyArtifactDeliveryToken(unknown, secret, new Date("2026-08-28T00:00:30.000Z")),
      /fields/i,
    );
    assert.throws(
      () => verifyArtifactDeliveryToken(reordered, secret, new Date("2026-08-28T00:00:30.000Z")),
      /canonical/i,
    );
  });

  it("fails closed for weak deployment secrets and malformed values", () => {
    assert.throws(() => requireArtifactDeliverySecret(undefined), /ARTIFACT_DELIVERY_SECRET/);
    assert.throws(() => requireArtifactDeliverySecret("short"), /32/);
    assert.equal(requireArtifactDeliverySecret(secret), secret);
    assert.throws(() => verifyArtifactDeliveryToken("not-a-token", secret, new Date()), /format/i);
    assert.throws(
      () =>
        issueArtifactDeliveryToken({ ...identity, sha256: "A".repeat(64) }, secret, {
          now: new Date(),
        }),
      /SHA-256/i,
    );
  });
});
