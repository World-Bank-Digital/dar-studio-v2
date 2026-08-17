import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelExplainer, explainerSummary } from "./explainer.ts";
import { model } from "./model.ts";

describe("model explainer (pipeline revision point 2)", () => {
  const text = modelExplainer();

  it("is computed from the model configuration, not hardcoded prose", () => {
    assert.ok(text.includes(`${model.indicators.length} indicators`));
    assert.ok(text.includes(`${model.core_gates.length} indicators are prerequisites`));
    for (const gateId of model.core_gates) {
      assert.ok(text.includes(`- ${gateId} `), `core gate ${gateId} missing`);
    }
    for (const pillarId of Object.keys(model.pillars)) {
      assert.ok(text.includes(`- ${pillarId} — `), `pillar ${pillarId} missing`);
    }
  });

  it("explains the collection contract: source, year, credibility, level", () => {
    assert.match(text, /source it was taken from/);
    assert.match(text, /observation year/);
    assert.match(text, /credibility grade/);
    assert.match(text, /maturity level/);
    assert.match(text, /named gap/);
  });

  it("carries the three read-outs, the bands, the ladder and every prohibition", () => {
    assert.match(text, /CMS/);
    assert.match(text, /EMS/);
    assert.match(text, /OES/);
    for (const b of model.bands) assert.ok(text.includes(b.name));
    assert.ok(text.includes(`${model.ladder.length} steps`));
    for (const p of model.prohibitions) assert.ok(text.includes(p), `prohibition missing: ${p}`);
  });

  it("names the run sequence that follows it", () => {
    assert.match(text, /official statistical systems/);
    assert.match(text, /public-domain sweep/);
    assert.match(text, /strategies and best practices/);
  });

  it("summarises to one audit line", () => {
    const s = explainerSummary();
    assert.ok(s.length < 300);
    assert.ok(s.includes("97 indicators"));
  });
});
