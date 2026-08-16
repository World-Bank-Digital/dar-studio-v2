import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml } from "./utils.ts";

describe("escapeHtml", () => {
  it("escapes markup so draft export cannot emit raw tags", () => {
    assert.equal(escapeHtml(`<img src=x onerror=alert(1)>`), "<img src=x onerror=alert(1)>");
    assert.equal(escapeHtml(`a & b`), "a & b");
  });
});
