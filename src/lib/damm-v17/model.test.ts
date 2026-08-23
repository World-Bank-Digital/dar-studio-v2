import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  model,
  indicatorById,
  indicatorsFor,
  openDecisionsFor,
  openDefinitionRows,
  pillarIds,
  prerequisites,
  useCaseIds,
} from "./model.ts";

describe("model file contract", () => {
  it("is v1.7, versioned by revision, and generated from the pipeline engine", () => {
    assert.equal(model.version, "1.7");
    assert.ok(model.revision >= 1);
    assert.match(model.generated_from, /engine_v17/);
  });

  it("carries 57 indicators across the seven v1.7 pillars", () => {
    assert.equal(model.indicators.length, 57);
    assert.deepEqual(pillarIds, ["A1", "C1", "C2", "C3", "C4", "E1", "O1"]);
    assert.deepEqual(useCaseIds, ["ADV", "SMF", "MKT", "SCM", "FIN", "AGI"]);
  });

  it("declares the twelve prerequisites, three of them universal", () => {
    assert.equal(prerequisites.length, 12);
    const universal = prerequisites.filter((i) => i.prerequisite === "UNIVERSAL");
    assert.deepEqual(
      universal.map((i) => i.id),
      ["2.1", "2.9", "4.1"],
    );
  });

  it("travels with the four prohibitions", () => {
    assert.equal(model.prohibitions.length, 4);
    assert.ok(model.prohibitions.some((p) => /ranking/i.test(p)));
  });
});

describe("the honesty contract — unratified values say so", () => {
  it("declares itself unratified with twelve open decisions", () => {
    assert.equal(model.ratified, false);
    assert.equal(model.open_decisions.length, 12);
  });

  it("no binding rule claims ratification while its decision is open", () => {
    for (const r of model.binding_rules) {
      assert.equal(r.ratified, false, `binding rule ${r.id}`);
    }
  });

  it("carries the open definitional question on 44 rows, 8 of them prerequisites", () => {
    assert.equal(openDefinitionRows.length, 44);
    const prereqOpen = openDefinitionRows.filter((i) => i.prerequisite !== null);
    assert.equal(prereqOpen.length, 8);
  });

  it("marks every A1 threshold as a test value pending 13.6", () => {
    const a1 = indicatorsFor("A1").filter((i) => i.thresholds);
    assert.ok(a1.length > 0);
    for (const i of a1) {
      assert.equal(i.thresholds_ratified, false, `${i.id} must not read as settled`);
    }
  });

  it("routes a governed field to the decision that owns it", () => {
    assert.deepEqual(
      openDecisionsFor("bands").map((d) => d.id),
      ["13.1"],
    );
    assert.ok(openDecisionsFor("indicators[].thresholds").some((d) => d.id === "13.6"));
    assert.ok(openDecisionsFor("binding_rules").some((d) => d.id === "13.4"));
    assert.ok(openDecisionsFor("indicators[].use_cases").some((d) => d.id === "13.12"));
  });
});

describe("model semantics the scorer depends on", () => {
  it("2.1 is the Egypt headline row: universal prerequisite, rural construct, open question", () => {
    const i = indicatorById("2.1");
    assert.ok(i);
    assert.equal(i.prerequisite, "UNIVERSAL");
    assert.match(i.name, /Rural/);
    assert.ok(i.ratification, "2.1 carries its definitional question on the row");
  });

  it("7.12 binds through UC:AI, the loop-1 ruling awaiting 13.4", () => {
    const i = indicatorById("7.12");
    assert.ok(i);
    assert.equal(i.prerequisite, "UC:AI");
    assert.ok(model.binding_rules.some((r) => r.id === "ai-binds-agi" && !r.ratified));
  });

  it("bands are contiguous and half-open from 1 to 5", () => {
    assert.equal(model.bands[0].lo, 1);
    assert.ok(model.bands.at(-1)!.hi > 5);
    for (let k = 0; k + 1 < model.bands.length; k++) {
      assert.equal(model.bands[k].hi, model.bands[k + 1].lo);
    }
  });

  it("the census absorptions survived: 7.2 carries its five merged v1.5 rows", () => {
    assert.deepEqual(indicatorById("7.2")?.absorbs, ["7.3", "7.4", "7.5", "7.6", "7.7"]);
  });
});
