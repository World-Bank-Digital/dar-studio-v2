import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml } from "./utils.ts";

describe("escapeHtml", () => {
  it("escapes markup so draft export cannot emit raw tags", () => {
    assert.equal(
      escapeHtml(`<img title="x's" src=x onerror=alert(1)>`),
      "&lt;img title=&quot;x&#39;s&quot; src=x onerror=alert(1)&gt;",
    );
    assert.equal(escapeHtml(`a & b`), "a &amp; b");
  });
});
