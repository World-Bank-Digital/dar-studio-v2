import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer preview-session-secret");
    assert.equal(result.filename, "TST_DAR.zip");
    assert.equal(await result.blob.text(), "zip bytes");
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
      /Not found/,
    );
  });
});
