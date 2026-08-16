import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { demoPackRows, regressionRows, uncitedCoreGates } from "./fixture.ts";
import { evaluateGauntlet } from "./gauntlet.ts";
import { model } from "./model.ts";
import { scoreAssessment } from "./scoring.ts";

describe("demonstration pack", () => {
  const demo = demoPackRows(model);

  it("cites every core gate it populates", () => {
    assert.deepEqual(uncitedCoreGates(demo), []);
  });

  it("clears its own readiness gate, so the showcase demonstrates the product working", () => {
    const result = evaluateGauntlet(demo, "BTN");
    assert.equal(
      result.passed,
      true,
      `demonstration pack still fails the gauntlet: ${result.summary}`,
    );
    assert.deepEqual(result.silentGaps, []);
    assert.deepEqual(result.weakReadings, []);
  });

  it("keeps the scores the regression pins — citations change credibility, not values", () => {
    const fromDemo = scoreAssessment(model, demo);
    const fromRegression = scoreAssessment(model, regressionRows(model));
    assert.equal(fromDemo.cms.score, fromRegression.cms.score);
    assert.equal(fromDemo.ems.score, fromRegression.ems.score);
    assert.equal(fromDemo.oes.score, fromRegression.oes.score);
    assert.equal(fromDemo.levelledCount, fromRegression.levelledCount);
  });

  it("gives every populated row a public http(s) URL", () => {
    for (const row of demo) {
      if (row.value == null && row.assessorLevel == null) continue;
      if (row.dataGap) continue;
      assert.match(row.sourceUrl ?? "", /^https:\/\//, `${row.indicatorId} has no public source URL`);
      assert.ok((row.sourceName ?? "").length > 0, `${row.indicatorId} has no source name`);
    }
  });
});

describe("scoring regression fixture", () => {
  it("is left uncited on purpose — it exists to pin the engine, not to demonstrate the product", () => {
    const plain = regressionRows(model);
    assert.ok(uncitedCoreGates(plain).length > 0);
  });
});
