import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileRejections, splitRejections } from "./decisions.ts";

describe("rejection reconciliation (the run-13 contradiction)", () => {
  it("fills the structured list from a free-text line — the shape that shipped the contradiction", () => {
    const r = reconcileRejections({ text: "Rice expansion", list: [] });
    assert.deepEqual(r.list, ["Rice expansion"]);
    assert.equal(r.text, "Rice expansion");
  });

  it("fills the free-text line from a structured list", () => {
    const r = reconcileRejections({ text: "", list: ["Rice expansion", "Sugarcane"] });
    assert.equal(r.text, "Rice expansion; Sugarcane");
    assert.deepEqual(r.list, ["Rice expansion", "Sugarcane"]);
  });

  it("merges both sides without duplicating what they share", () => {
    const r = reconcileRejections({ text: "Rice expansion, Maize", list: ["Rice Expansion", "Sugarcane"] });
    assert.deepEqual(r.list, ["Rice Expansion", "Sugarcane", "Maize"]);
    assert.equal(r.text, "Rice Expansion; Sugarcane; Maize");
  });

  it("records nothing when nothing was rejected", () => {
    const r = reconcileRejections({ text: "", list: [] });
    assert.deepEqual(r.list, []);
    assert.equal(r.text, null, "an empty rejection is null, not an empty string masquerading as a record");
  });

  it("splits on both separators and drops the gaps", () => {
    assert.deepEqual(splitRejections("Rice; Maize, , Sorghum;"), ["Rice", "Maize", "Sorghum"]);
  });
});
