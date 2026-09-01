import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  artifactAppOrigin,
  createArtifactGatewayHandler,
  createPostgresArtifactRepository,
  requireArtifactGatewayDatabaseUrl,
} from "./artifact-gateway.ts";
import { artifactDeliveryGrant } from "../src/lib/damm-v17/artifact-delivery.ts";
import { ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE } from "../src/lib/damm-v17/artifact-delivery-contract.ts";
import { issueArtifactDeliveryToken } from "../src/lib/damm-v17/artifact-delivery-token.ts";

const secret = "0123456789abcdef0123456789abcdef";
const sha256 = "f40a912044d47ea7c32f37340db4fd5eb853ffb8fcd983f605d9eb4f8b02fbc2";
const identity = {
  runId: "workflow-run-1",
  artifactSetId: "claim-token-1",
  key: "bundle",
  sha256,
  subjectUserId: "owner-user-1",
  accessAs: "country_owner",
  packageId: null,
  assignmentId: null,
  targetIdentitySha256: null,
  bundleSha256: null,
};
const reviewerIdentity = {
  ...identity,
  subjectUserId: "reviewer-user-1",
  accessAs: "assigned_reviewer",
  packageId: "approval-package-1",
  assignmentId: "reviewer-assignment-1",
  targetIdentitySha256: "c".repeat(64),
  bundleSha256: sha256,
};
const now = new Date("2026-08-28T00:00:00.000Z");
const appOrigin = "https://app.example.test";
const gatewayUrl = "https://artifact-gateway.example/v1/artifacts";

function verifiedArtifact(overrides = {}) {
  return {
    runId: identity.runId,
    artifactSetId: identity.artifactSetId,
    key: identity.key,
    sha256,
    filename: "Nigeria Draft DAR.zip",
    contentType: "application/zip",
    byteSize: 12,
    methodologyStatus: "canonical",
    async *chunks() {
      yield Buffer.from("bundle ");
      yield Buffer.from("bytes");
    },
    ...overrides,
  };
}

function gatewayFetch(repository) {
  const handler = createArtifactGatewayHandler({
    repository,
    secret,
    appOrigin,
    now: () => now,
  });
  return (token, init = {}) =>
    handler(
      new Request(gatewayUrl, {
        method: "GET",
        ...init,
        headers: {
          Origin: appOrigin,
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    );
}

describe("Render artifact delivery gateway", () => {
  it("starts only with a pooled Neon Ohio connection requiring TLS", () => {
    const valid =
      "postgresql://role:secret@ep-dar-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
    assert.equal(requireArtifactGatewayDatabaseUrl(valid), valid);
    const clusterQualified =
      "postgresql://role:secret@ep-dar-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    assert.equal(requireArtifactGatewayDatabaseUrl(clusterQualified), clusterQualified);
    for (const candidate of [
      undefined,
      "postgresql://role:secret@ep-dar.us-east-2.aws.neon.tech/neondb?sslmode=require",
      "postgresql://role:secret@ep-dar-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
      "postgresql://role:secret@ep-dar-pooler.us-east-2.aws.neon.tech/neondb",
      `${valid}&sslmode=disable`,
    ]) {
      assert.throws(() => requireArtifactGatewayDatabaseUrl(candidate), /pooled Ohio/);
    }
  });

  it("accepts the bearer grant emitted by Netlify without putting it in a URL", async () => {
    const issuedAt = new Date();
    const grant = artifactDeliveryGrant(identity, {
      ARTIFACT_GATEWAY_URL: "https://artifact-gateway.example",
      ARTIFACT_DELIVERY_SECRET: secret,
    });
    assert.ok(grant);
    assert.equal(grant.endpoint, gatewayUrl);
    assert.equal(grant.endpoint.includes(grant.token), false);

    const handler = createArtifactGatewayHandler({
      repository: {
        async open() {
          return { ok: true, artifact: verifiedArtifact() };
        },
      },
      secret,
      appOrigin,
      now: () => issuedAt,
    });
    const response = await handler(
      new Request(grant.endpoint, {
        headers: { Origin: appOrigin, Authorization: `Bearer ${grant.token}` },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "bundle bytes");
  });

  it("streams a synthetic bundle larger than 20 MiB through only the fixed header-authorized gateway", async () => {
    const chunkBytes = 1024 * 1024;
    const fullChunkCount = 20;
    const fullChunk = Buffer.alloc(chunkBytes, 0xa5);
    const tail = Buffer.from("bounded synthetic Stage 8 bundle tail", "utf8");
    const byteSize = fullChunkCount * fullChunk.byteLength + tail.byteLength;
    assert.ok(byteSize > 20 * 1024 * 1024);

    const expectedHash = createHash("sha256");
    for (let index = 0; index < fullChunkCount; index += 1) expectedHash.update(fullChunk);
    expectedHash.update(tail);
    const largeSha256 = expectedHash.digest("hex");
    const largeIdentity = { ...identity, sha256: largeSha256 };
    const grant = artifactDeliveryGrant(largeIdentity, {
      ARTIFACT_GATEWAY_URL: "https://artifact-gateway.example",
      ARTIFACT_DELIVERY_SECRET: secret,
    });
    assert.ok(grant);

    // This is the complete same-origin authorization response: small, no-store JSON,
    // never a redirect or a proxy for the artifact bytes.
    const grantJson = JSON.stringify(grant);
    const netlifyResponse = new Response(grantJson, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": `${ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE}; charset=utf-8`,
      },
    });
    assert.equal(netlifyResponse.status, 200);
    assert.equal(netlifyResponse.headers.has("location"), false);
    assert.equal(netlifyResponse.headers.get("cache-control"), "no-store");
    assert.ok(Buffer.byteLength(grantJson) < 4096);
    assert.equal(grant.endpoint, gatewayUrl);
    assert.equal(grant.endpoint.includes(grant.token), false);

    let opened = 0;
    const handler = createArtifactGatewayHandler({
      repository: {
        async open(candidate) {
          opened += 1;
          assert.deepEqual(
            {
              runId: candidate.runId,
              artifactSetId: candidate.artifactSetId,
              key: candidate.key,
              sha256: candidate.sha256,
              subjectUserId: candidate.subjectUserId,
              accessAs: candidate.accessAs,
            },
            {
              runId: largeIdentity.runId,
              artifactSetId: largeIdentity.artifactSetId,
              key: largeIdentity.key,
              sha256: largeIdentity.sha256,
              subjectUserId: largeIdentity.subjectUserId,
              accessAs: largeIdentity.accessAs,
            },
          );
          return {
            ok: true,
            artifact: verifiedArtifact({
              sha256: largeSha256,
              filename: "Synthetic Large Draft DAR.zip",
              byteSize,
              async *chunks() {
                for (let index = 0; index < fullChunkCount; index += 1) yield fullChunk;
                yield tail;
              },
            }),
          };
        },
      },
      secret,
      appOrigin,
    });
    const gatewayRequest = new Request(grant.endpoint, {
      headers: { Origin: appOrigin, Authorization: `Bearer ${grant.token}` },
    });
    assert.equal(gatewayRequest.url, gatewayUrl);
    assert.equal(gatewayRequest.url.includes(grant.token), false);
    assert.equal(gatewayRequest.headers.get("authorization"), `Bearer ${grant.token}`);

    const response = await handler(gatewayRequest);
    assert.equal(opened, 1);
    assert.equal(response.status, 200);
    assert.equal(response.redirected, false);
    assert.equal(response.headers.has("location"), false);
    assert.equal(response.headers.get("content-length"), String(byteSize));
    assert.equal(response.headers.get("x-content-sha256"), largeSha256);

    const reader = response.body?.getReader();
    assert.ok(reader);
    const deliveredHash = createHash("sha256");
    let deliveredBytes = 0;
    let deliveredChunks = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      deliveredChunks += 1;
      deliveredBytes += next.value.byteLength;
      deliveredHash.update(next.value);
    }
    assert.equal(deliveredChunks, fullChunkCount + 1);
    assert.equal(deliveredBytes, byteSize);
    assert.equal(deliveredHash.digest("hex"), largeSha256);
  });

  it("delivers only the token-bound published artifact with private download headers", async () => {
    const requested = [];
    const repository = {
      async open(candidate) {
        requested.push(candidate);
        return candidate.artifactSetId === identity.artifactSetId
          ? { ok: true, artifact: verifiedArtifact() }
          : { ok: false, reason: "not_found" };
      },
    };
    const fetchGateway = gatewayFetch(repository);
    const token = issueArtifactDeliveryToken(identity, secret, { now });
    const response = await fetchGateway(token);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "bundle bytes");
    assert.equal(response.headers.get("content-length"), "12");
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="Nigeria_Draft_DAR.zip"',
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-sha256"), sha256);
    assert.equal(response.headers.get("access-control-allow-origin"), appOrigin);
    assert.match(response.headers.get("access-control-expose-headers"), /Content-Disposition/);
    assert.deepEqual(requested, [{ ...identity, exp: 1787875260, v: 2 }]);
  });

  it("does not disclose or open artifacts for tampered, expired, or other-set tokens", async () => {
    let opens = 0;
    const repository = {
      async open(candidate) {
        opens += 1;
        return candidate.artifactSetId === identity.artifactSetId
          ? { ok: true, artifact: verifiedArtifact() }
          : { ok: false, reason: "not_found" };
      },
    };
    const fetchGateway = gatewayFetch(repository);
    const valid = issueArtifactDeliveryToken(identity, secret, { now });
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    const expired = issueArtifactDeliveryToken(identity, secret, {
      now: new Date("2026-08-27T23:58:00.000Z"),
    });
    const otherSet = issueArtifactDeliveryToken(
      { ...identity, artifactSetId: "another-published-package" },
      secret,
      { now },
    );

    for (const token of [tampered, expired, otherSet]) {
      const response = await fetchGateway(token);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "Not found.");
    }
    assert.equal(opens, 1, "only the validly signed other-set identity reaches storage");
  });

  it("refuses a database integrity failure before any artifact bytes are delivered", async () => {
    const fetchGateway = gatewayFetch({
      async open() {
        return { ok: false, reason: "integrity" };
      },
    });
    const token = issueArtifactDeliveryToken(identity, secret, { now });
    const response = await fetchGateway(token);
    assert.equal(response.status, 409);
    assert.equal(await response.text(), "The stored artifact failed its integrity check.");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("falls back safely when stored media-type metadata contains a control character", async () => {
    const fetchGateway = gatewayFetch({
      async open() {
        return {
          ok: true,
          artifact: verifiedArtifact({ contentType: "application/zip\tunsafe" }),
        };
      },
    });
    const token = issueArtifactDeliveryToken(identity, secret, { now });
    const response = await fetchGateway(token);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal(await response.text(), "bundle bytes");
  });

  it("provides a data-free health response without opening artifact storage", async () => {
    let opened = false;
    const handler = createArtifactGatewayHandler({
      appOrigin,
      secret,
      now: () => now,
      repository: {
        async open() {
          opened = true;
          return { ok: false, reason: "not_found" };
        },
      },
    });
    const response = await handler(new Request("https://artifact-gateway.example/healthz"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(opened, false);
  });

  it("allows CORS only for the explicit app origin and Authorization-only preflight", async () => {
    const handler = createArtifactGatewayHandler({
      repository: {
        async open() {
          return { ok: false, reason: "not_found" };
        },
      },
      secret,
      appOrigin,
      now: () => now,
    });
    const valid = await handler(
      new Request(gatewayUrl, {
        method: "OPTIONS",
        headers: {
          Origin: appOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
    );
    assert.equal(valid.status, 204);
    assert.equal(valid.headers.get("access-control-allow-origin"), appOrigin);
    assert.equal(valid.headers.get("access-control-allow-headers"), "Authorization");

    for (const request of [
      new Request(gatewayUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
      new Request(gatewayUrl, {
        headers: {
          Origin: "https://attacker.example",
          Authorization: `Bearer ${issueArtifactDeliveryToken(identity, secret, { now })}`,
        },
      }),
      new Request(`${gatewayUrl}/capability-must-not-be-in-a-url`, {
        headers: { Origin: appOrigin },
      }),
    ]) {
      const refused = await handler(request);
      assert.equal(refused.status, 404);
      assert.equal(refused.headers.has("access-control-allow-origin"), false);
      assert.equal(await refused.text(), "Not found.");
    }
    assert.equal(artifactAppOrigin(appOrigin), appOrigin);
    assert.throws(() => artifactAppOrigin("http://app.example.test"), /APP_ORIGIN/);
  });
});

describe("Neon immutable artifact repository", () => {
  it("streams an owner-only completed-stage artifact without requiring Stage 8", async () => {
    const content = Buffer.from("completed stage report");
    const stageSha256 = createHash("sha256").update(content).digest("hex");
    const stageIdentity = {
      ...identity,
      artifactSetId: "damm_diagnostic",
      key: "a".repeat(64),
      sha256: stageSha256,
    };
    const queries = [];
    const database = {
      async query(text, params) {
        queries.push({ text, params });
        if (text.includes("workflow_stage_publications") && text.includes("substring")) {
          const offset = Number(params[4]) - 1;
          const length = Number(params[5]);
          return { rows: [{ chunk: content.subarray(offset, offset + length) }] };
        }
        if (text.includes("workflow_stage_publications")) {
          return {
            rows: [
              {
                artifact_scope: "stage",
                run_id: stageIdentity.runId,
                artifact_set_id: stageIdentity.artifactSetId,
                artifact_key: stageIdentity.key,
                filename: "diagnostic-report.html",
                content_type: "text/html",
                sha256: stageSha256,
                byte_size: String(content.byteLength),
                actual_byte_size: String(content.byteLength),
                actual_sha256: stageSha256,
                artifact_set_byte_size: String(content.byteLength),
                actual_artifact_set_byte_size: String(content.byteLength),
                content_verified_at: now,
                methodology_status: "canonical",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const opened = await createPostgresArtifactRepository(database, { chunkBytes: 7 }).open({
      ...stageIdentity,
      exp: 1787875260,
      v: 2,
    });

    assert.equal(opened.ok, true);
    assert.ok(opened.ok);
    const chunks = [];
    for await (const chunk of opened.artifact.chunks()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), content.toString());
    assert.equal(queries.length, 6);
    assert.match(queries[0].text, /workflow_run_artifacts/);
    assert.match(queries[1].text, /workflow_stage_publications/);
    for (const query of queries.slice(2)) {
      assert.match(query.text, /workflow_stage_publications/);
      assert.deepEqual(query.params.slice(0, 4), [
        stageIdentity.runId,
        stageIdentity.artifactSetId,
        stageIdentity.key,
        stageIdentity.sha256,
      ]);
      assert.deepEqual(query.params.slice(6), [
        stageIdentity.subjectUserId,
        "country_owner",
        null,
        null,
        null,
        null,
      ]);
    }
  });

  it("binds metadata and chunks to the exact currently-published run/set/key/SHA", async () => {
    const queries = [];
    const bytes = Buffer.from("bundle bytes");
    const database = {
      async query(text, params) {
        queries.push({ text, params });
        if (text.includes("substring(artifact.content")) {
          const offset = Number(params[4]) - 1;
          const length = Number(params[5]);
          return { rows: [{ chunk: bytes.subarray(offset, offset + length) }] };
        }
        return {
          rows: [
            {
              run_id: identity.runId,
              artifact_set_id: identity.artifactSetId,
              artifact_key: identity.key,
              filename: "Nigeria Draft DAR.zip",
              content_type: "application/zip",
              sha256,
              byte_size: "12",
              actual_byte_size: "12",
              actual_sha256: sha256,
              artifact_set_byte_size: "12",
              actual_artifact_set_byte_size: "12",
              content_verified_at: now,
              methodology_status: "canonical",
            },
          ],
        };
      },
    };
    const repository = createPostgresArtifactRepository(database, { chunkBytes: 7 });

    const result = await repository.open({ ...identity, exp: 1787875260, v: 2 });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    const chunks = [];
    for await (const chunk of result.artifact.chunks()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString("utf8"), "bundle bytes");
    assert.deepEqual(queries[0].params.slice(0, 4), [
      identity.runId,
      identity.artifactSetId,
      identity.key,
      identity.sha256,
    ]);
    assert.match(queries[0].text, /workflow_artifact_set_id = \$2/);
    assert.match(queries[0].text, /encode\(sha256\(artifact\.content\), 'hex'\)/);
    assert.deepEqual(queries[0].params.slice(7), [
      "country_owner",
      identity.subjectUserId,
      null,
      null,
      null,
      null,
    ]);
    for (const query of queries.slice(1)) {
      assert.deepEqual(query.params.slice(0, 4), [
        identity.runId,
        identity.artifactSetId,
        identity.key,
        identity.sha256,
      ]);
      assert.deepEqual(query.params.slice(6), [
        identity.subjectUserId,
        "country_owner",
        null,
        null,
        null,
        null,
      ]);
    }
  });

  it("rechecks an exact reviewer assignment for metadata and every chunk while owners remain authorized", async () => {
    let reviewerActive = true;
    const bytes = Buffer.from("bundle bytes");
    const queries = [];
    const row = {
      run_id: identity.runId,
      artifact_set_id: identity.artifactSetId,
      artifact_key: identity.key,
      filename: "bundle.zip",
      content_type: "application/zip",
      sha256,
      byte_size: "12",
      actual_byte_size: "12",
      actual_sha256: sha256,
      artifact_set_byte_size: "12",
      actual_artifact_set_byte_size: "12",
      content_verified_at: now,
      methodology_status: "canonical",
    };
    const database = {
      async query(text, params) {
        queries.push({ text, params });
        const chunk = text.includes("substring(artifact.content");
        const accessAs = params[7];
        const authorized = accessAs === "country_owner" || reviewerActive;
        if (!authorized) return { rows: [] };
        if (chunk) {
          const offset = Number(params[4]) - 1;
          const length = Number(params[5]);
          return { rows: [{ chunk: bytes.subarray(offset, offset + length) }] };
        }
        return { rows: [row] };
      },
    };
    const repository = createPostgresArtifactRepository(database, { chunkBytes: 7 });
    const reviewerPayload = { ...reviewerIdentity, exp: 1787875260, v: 2 };
    const opened = await repository.open(reviewerPayload);
    assert.equal(opened.ok, true);
    assert.ok(opened.ok);
    const reviewerMetadataQuery = queries[0];
    assert.deepEqual(reviewerMetadataQuery.params.slice(7), [
      "assigned_reviewer",
      reviewerIdentity.subjectUserId,
      reviewerIdentity.packageId,
      reviewerIdentity.assignmentId,
      reviewerIdentity.targetIdentitySha256,
      reviewerIdentity.bundleSha256,
    ]);
    assert.match(reviewerMetadataQuery.text, /assignment\.id = \$11/);
    assert.match(reviewerMetadataQuery.text, /assignment\.reviewer_user_id = \$9/);
    assert.match(reviewerMetadataQuery.text, /workflow_approval_assignment_supersessions/);

    reviewerActive = false;
    await assert.rejects(async () => {
      for await (const _chunk of opened.artifact.chunks()) {
        // Revocation is checked before each chunk is yielded.
      }
    }, /changed while it was being delivered/);
    assert.deepEqual(await repository.open(reviewerPayload), { ok: false, reason: "not_found" });

    const ownerPayload = { ...identity, exp: 1787875260, v: 2 };
    const owner = await repository.open(ownerPayload);
    assert.equal(owner.ok, true);
    assert.ok(owner.ok);
    const ownerChunks = [];
    for await (const chunk of owner.artifact.chunks()) ownerChunks.push(chunk);
    assert.equal(Buffer.concat(ownerChunks).toString("utf8"), "bundle bytes");
  });

  it("fails closed before streaming when Neon bytes, digest, or package limits disagree", async () => {
    for (const { changed, candidate = identity } of [
      { changed: { actual_byte_size: "11" } },
      { changed: { actual_sha256: "0".repeat(64) } },
      {
        candidate: { ...identity, key: "stage-8-markdown" },
        changed: {
          artifact_key: "stage-8-markdown",
          byte_size: String(50 * 1024 * 1024 + 1),
          actual_byte_size: String(50 * 1024 * 1024 + 1),
          artifact_set_byte_size: String(50 * 1024 * 1024 + 1),
          actual_artifact_set_byte_size: String(50 * 1024 * 1024 + 1),
        },
      },
      {
        changed: {
          byte_size: String(250 * 1024 * 1024 + 1),
          actual_byte_size: String(250 * 1024 * 1024 + 1),
          artifact_set_byte_size: String(250 * 1024 * 1024 + 1),
          actual_artifact_set_byte_size: String(250 * 1024 * 1024 + 1),
        },
      },
      {
        changed: {
          artifact_set_byte_size: String(400 * 1024 * 1024 + 1),
          actual_artifact_set_byte_size: String(400 * 1024 * 1024 + 1),
        },
      },
      { changed: { actual_artifact_set_byte_size: "13" } },
    ]) {
      const database = {
        async query() {
          return {
            rows: [
              {
                run_id: identity.runId,
                artifact_set_id: identity.artifactSetId,
                artifact_key: identity.key,
                filename: "bundle.zip",
                content_type: "application/zip",
                sha256,
                byte_size: "12",
                actual_byte_size: "12",
                actual_sha256: sha256,
                artifact_set_byte_size: "12",
                actual_artifact_set_byte_size: "12",
                content_verified_at: now,
                methodology_status: "canonical",
                ...changed,
              },
            ],
          };
        },
      };
      const result = await createPostgresArtifactRepository(database).open({
        ...candidate,
        exp: 1787875260,
        v: 2,
      });
      assert.deepEqual(result, { ok: false, reason: "integrity" });
    }
  });

  it("keeps a verified legacy Draft downloadable and best-effort stamps first verification", async () => {
    const queries = [];
    const bytes = Buffer.from("bundle bytes");
    const database = {
      async query(text, params) {
        queries.push({ text, params });
        if (/^\s*update workflow_run_artifacts artifact/i.test(text)) {
          throw new Error("simulated verification-stamp write failure");
        }
        if (text.includes("substring(artifact.content")) {
          const offset = Number(params[4]) - 1;
          const length = Number(params[5]);
          return { rows: [{ chunk: bytes.subarray(offset, offset + length) }] };
        }
        return {
          rows: [
            {
              run_id: identity.runId,
              artifact_set_id: identity.artifactSetId,
              artifact_key: identity.key,
              filename: "bundle.zip",
              content_type: "application/zip",
              sha256,
              byte_size: "12",
              actual_byte_size: "12",
              actual_sha256: sha256,
              artifact_set_byte_size: "12",
              actual_artifact_set_byte_size: "12",
              content_verified_at: null,
              methodology_status: "legacy_unverified",
            },
          ],
        };
      },
    };

    const result = await createPostgresArtifactRepository(database).open({
      ...identity,
      exp: 1787875260,
      v: 2,
    });

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    const chunks = [];
    for await (const chunk of result.artifact.chunks()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString("utf8"), "bundle bytes");
    assert.match(
      queries[0].text,
      /methodology\.run_id is not null[\s\S]*content_verified_at is not null/,
    );
    assert.equal(queries.length, 3);
    assert.match(queries[1].text, /^\s*update workflow_run_artifacts artifact/i);
    assert.deepEqual(queries[1].params, [
      identity.runId,
      identity.artifactSetId,
      identity.key,
      identity.sha256,
    ]);
    assert.doesNotMatch(queries[2].text, /content_verified_at is not null/);
  });

  it("keeps an unverified canonical artifact fail-closed", async () => {
    const database = {
      async query() {
        return {
          rows: [
            {
              run_id: identity.runId,
              artifact_set_id: identity.artifactSetId,
              artifact_key: identity.key,
              filename: "bundle.zip",
              content_type: "application/zip",
              sha256,
              byte_size: "12",
              actual_byte_size: "12",
              actual_sha256: sha256,
              artifact_set_byte_size: "12",
              actual_artifact_set_byte_size: "12",
              content_verified_at: null,
              methodology_status: "canonical",
            },
          ],
        };
      },
    };

    const result = await createPostgresArtifactRepository(database).open({
      ...identity,
      exp: 1787875260,
      v: 2,
    });

    assert.deepEqual(result, { ok: false, reason: "integrity" });
  });
});
