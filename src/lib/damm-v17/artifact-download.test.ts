import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE } from "./artifact-delivery-contract.ts";
import { artifactFilename, fetchWorkflowArtifact } from "./artifact-download.ts";

describe("authenticated workflow artifact downloads", () => {
  it("parses and sanitizes server filenames", () => {
    assert.equal(artifactFilename('attachment; filename="Draft DAR.pdf"'), "Draft_DAR.pdf");
    assert.equal(
      artifactFilename("attachment; filename*=UTF-8''Country%20DAR.docx"),
      "Country_DAR.docx",
    );
    assert.equal(artifactFilename('attachment; filename="../../secret.txt"'), "secret.txt");
    assert.equal(artifactFilename(null), "workflow-artifact");
  });

  it("attaches the preview bearer without putting it in the artifact URL", async () => {
    let requested = "";
    let init: RequestInit | undefined;
    const result = await fetchWorkflowArtifact("/api/runs/run-1/artifact?key=bundle", {
      baseOrigin: "https://preview.example.test",
      bearerToken: "preview-session-secret",
      fetcher: async (input, requestInit) => {
        requested = String(input);
        init = requestInit;
        return new Response("zip bytes", {
          headers: { "content-disposition": 'attachment; filename="TST_DAR.zip"' },
        });
      },
    });

    assert.equal(requested, "/api/runs/run-1/artifact?key=bundle");
    assert.equal(requested.includes("preview-session-secret"), false);
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer preview-session-secret");
    assert.equal(result.filename, "TST_DAR.zip");
    assert.equal(await result.blob.text(), "zip bytes");
  });

  it("exchanges a same-origin grant for a fixed gateway bearer download without a capability URL", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const deliveryToken = "signed.delivery-capability";
    const result = await fetchWorkflowArtifact("/api/runs/run-1/artifact?key=bundle", {
      baseOrigin: "https://app.example.test",
      bearerToken: null,
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        if (requests.length === 1) {
          return new Response(
            JSON.stringify({
              endpoint: "https://artifacts.example.test/v1/artifacts",
              token: deliveryToken,
              expiresInSeconds: 60,
            }),
            { headers: { "content-type": `${ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE}; charset=utf-8` } },
          );
        }
        return new Response("large bundle bytes", {
          headers: { "content-disposition": 'attachment; filename="Draft_DAR.zip"' },
        });
      },
    });

    assert.deepEqual(
      requests.map((request) => request.url),
      ["/api/runs/run-1/artifact?key=bundle", "https://artifacts.example.test/v1/artifacts"],
    );
    assert.equal(
      requests.some((request) => request.url.includes(deliveryToken)),
      false,
    );
    assert.equal(
      new Headers(requests[1].init?.headers).get("authorization"),
      `Bearer ${deliveryToken}`,
    );
    assert.equal(requests[1].init?.credentials, "omit");
    assert.equal(requests[1].init?.mode, "cors");
    assert.equal(requests[1].init?.redirect, "error");
    assert.equal(result.filename, "Draft_DAR.zip");
    assert.equal(await result.blob.text(), "large bundle bytes");
  });

  it("uses cookie-only same-origin fetches when no preview bearer exists", async () => {
    await fetchWorkflowArtifact("/api/runs/run-1/artifact?key=draft-pdf", {
      baseOrigin: "https://app.example.test",
      bearerToken: null,
      fetcher: async (_input, init) => {
        assert.equal(new Headers(init?.headers).has("authorization"), false);
        assert.equal(init?.credentials, "same-origin");
        return new Response("pdf");
      },
    });
  });

  it("never sends a bearer to another origin and reports server refusals", async () => {
    await assert.rejects(
      fetchWorkflowArtifact("https://attacker.example/artifact", {
        baseOrigin: "https://app.example.test",
        bearerToken: "secret",
        fetcher: async () => assert.fail("cross-origin fetch must not run"),
      }),
      /only be downloaded from this app/,
    );
    await assert.rejects(
      fetchWorkflowArtifact("/api/runs/missing/artifact?key=bundle", {
        baseOrigin: "https://app.example.test",
        bearerToken: null,
        fetcher: async () => new Response("Not found.", { status: 404 }),
      }),
      /unavailable or you no longer have access/,
    );
  });
});

it("does not expose a failed download's raw server diagnostics", async () => {
  await assert.rejects(
    fetchWorkflowArtifact("/api/runs/sim/artifact?key=zip", {
      bearerToken: null,
      baseOrigin: "https://app.test",
      fetcher: async () =>
        new Response("SYNTHETIC_PRIVATE_VALUE https://provider.test/?key=private /var/data", {
          status: 502,
        }),
    }),
    (error) =>
      error instanceof Error &&
      !error.message.includes("SYNTHETIC_PRIVATE_VALUE") &&
      !error.message.includes("provider.test"),
  );
});
