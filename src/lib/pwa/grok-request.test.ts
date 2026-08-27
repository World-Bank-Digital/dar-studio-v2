import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleGrokPwaRequest, type StartRequestResult } from "./grok-request.ts";

const template = "<html><head><title>{{APP_NAME}}</title></head><body>{{APP_URL}}</body></html>";

function nextResult(request: Request, response: Response) {
  let calls = 0;
  return {
    calls: () => calls,
    next: async (): Promise<StartRequestResult<undefined>> => {
      calls += 1;
      return { request, response, pathname: new URL(request.url).pathname, context: undefined };
    },
  };
}

describe("provider-neutral PWA request middleware", () => {
  it("serves the host-named web manifest without entering the router", async () => {
    const request = new Request("https://dar-staging.netlify.app/__grok/manifest.webmanifest");
    const downstream = nextResult(request, new Response("unused"));
    const result = await handleGrokPwaRequest(request, downstream.next, template);
    assert.ok(result instanceof Response);
    assert.equal(downstream.calls(), 0);
    assert.match(await result.text(), /Dar Staging/);
    assert.match(result.headers.get("content-type") ?? "", /manifest\+json/);
  });

  it("serves the iOS install tutorial on document paths", async () => {
    const request = new Request(
      "https://dar-staging.netlify.app/workspace?install=1&platform=ios&keep=yes",
      { headers: { accept: "text/html" } },
    );
    const downstream = nextResult(request, new Response("unused"));
    const result = await handleGrokPwaRequest(request, downstream.next, template);
    assert.ok(result instanceof Response);
    assert.equal(downstream.calls(), 0);
    const body = await result.text();
    assert.match(body, /Dar Staging/);
    assert.match(body, /\/workspace\?keep=yes/);
  });

  it("injects HTML head tags while preserving response identity headers", async () => {
    const request = new Request("https://dar-staging.netlify.app/", {
      headers: { accept: "text/html" },
    });
    const response = new Response("<html><head><title>DAR</title></head><body>ok</body></html>", {
      status: 202,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": "61",
        "x-test": "kept",
      },
    });
    const downstream = nextResult(request, response);
    const result = await handleGrokPwaRequest(request, downstream.next, template);
    assert.ok(!(result instanceof Response));
    assert.equal(result.response.status, 202);
    assert.equal(result.response.headers.get("x-test"), "kept");
    assert.equal(result.response.headers.has("content-length"), false);
    assert.match(await result.response.text(), /__grok\/manifest\.webmanifest/);
  });

  it("passes non-GET and non-HTML responses through unchanged", async () => {
    const post = new Request("https://dar-staging.netlify.app/", { method: "POST" });
    const postResponse = new Response("posted", { status: 201 });
    const postNext = nextResult(post, postResponse);
    const postResult = await handleGrokPwaRequest(post, postNext.next, template);
    assert.ok(!(postResult instanceof Response));
    assert.equal(postResult.response, postResponse);

    const api = new Request("https://dar-staging.netlify.app/api/data");
    const apiResponse = new Response("{}", { headers: { "content-type": "application/json" } });
    const apiNext = nextResult(api, apiResponse);
    const apiResult = await handleGrokPwaRequest(api, apiNext.next, template);
    assert.ok(!(apiResult instanceof Response));
    assert.equal(apiResult.response, apiResponse);
  });
});
