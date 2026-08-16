import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DAR_ANNEXES,
  DAR_CHAPTERS,
  DAR_OUTLINE,
  PRESCRIPTIVE_CHAPTERS,
  isPrescriptive,
  outlineChapter,
} from "./outline.ts";

describe("roadmap architecture", () => {
  it("has 17 chapters and 11 annexes", () => {
    assert.equal(DAR_CHAPTERS.length, 17);
    assert.equal(DAR_ANNEXES.length, 11);
    assert.equal(DAR_OUTLINE.length, 28);
  });

  it("numbers chapters 1 to 17 with no gaps", () => {
    assert.deepEqual(
      DAR_CHAPTERS.map((c) => c.n),
      Array.from({ length: 17 }, (_, i) => String(i + 1)),
    );
  });

  it("opens with the executive summary and closes with consultation priorities", () => {
    assert.match(DAR_CHAPTERS[0].title, /Executive Summary/);
    assert.match(DAR_CHAPTERS[16].title, /Consultation Priorities/);
  });

  it("writes the executive summary last, at the adoption step", () => {
    assert.equal(outlineChapter("1")?.readyAt, 8);
  });

  it("keeps every chapter number unique across chapters and annexes", () => {
    const ids = DAR_OUTLINE.map((c) => c.n);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("gives every entry a producer and a place on the ladder", () => {
    for (const c of DAR_OUTLINE) {
      assert.ok(c.title.length > 0, `${c.n} has no title`);
      assert.ok(c.producedBy.length > 0, `${c.n} has no producer`);
      assert.ok(c.readyAt >= 1 && c.readyAt <= 8, `${c.n} readyAt out of range`);
      assert.ok(c.inputs.length > 0, `${c.n} has no inputs`);
    }
  });
});

describe("prescriptive gating", () => {
  it("gates the chapters that recommend, sequence or cost", () => {
    for (const n of ["1", "10", "11", "12", "13", "14", "15", "16"]) {
      assert.equal(isPrescriptive(n), true, `chapter ${n} should be gated`);
    }
  });

  it("leaves the diagnostic chapters ungated — describing weak evidence is a finding", () => {
    for (const n of ["2", "3", "4", "5", "6", "7", "8", "9", "17"]) {
      assert.equal(isPrescriptive(n), false, `chapter ${n} should not be gated`);
    }
  });

  it("never gates an annex", () => {
    for (const a of DAR_ANNEXES) assert.equal(isPrescriptive(a.n), false);
  });

  it("derives the gated set from kind, so the two cannot drift", () => {
    const fromKind = DAR_OUTLINE.filter((c) => c.kind === "prescriptive").map((c) => c.n);
    assert.deepEqual([...PRESCRIPTIVE_CHAPTERS].sort(), fromKind.sort());
  });

  it("covers the domains the method requires a view on", () => {
    const titles = DAR_CHAPTERS.map((c) => c.title).join(" | ");
    for (const topic of [
      /Agrifood Diagnostic/,
      /Ecosystem Assessment/,
      /Farmer Registry/,
      /DPI and Interoperability/,
      /Institutions and Political Economy/,
      /Inclusion/,
      /Technology, Innovation and AI/,
      /Strategic Foresight/,
      /Opportunity Portfolio/,
      /Architecture/,
      /Data Governance/,
      /Governance and Delivery/,
      /Investment and Financing/,
      /Implementation Roadmap/,
      /Results, Risks, Gates/,
    ]) {
      assert.match(titles, topic);
    }
  });
});

describe("prose eligibility", () => {
  it("allows model prose only on numbered chapters", async () => {
    const { shouldProse } = await import("./outline.ts");
    assert.equal(shouldProse("1"), true);
    assert.equal(shouldProse("17"), true);
    assert.equal(shouldProse("A"), false, "annexes are the evidence record — never rewritten");
    assert.equal(shouldProse("J"), false);
  });
});
