import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  DAMM_MODEL_EXPORT,
  DAMM_MODEL_FILENAME,
  DAMM_MODEL_IDENTITY,
  DAMM_MODEL_SCHEMA_FILENAME,
  DAMM_MODEL_SCHEMA_SHA256,
  DAMM_MODEL_SHA256,
  DAMM_MODEL_SOURCE_SHA256,
  DAMM_RUNTIME_IDENTITY,
  chapterMayCite,
  darChapter,
  model,
  indicatorById,
  indicatorsFor,
  openDecisionsFor,
  openDefinitionRows,
  pillarIds,
  prerequisites,
  useCaseIds,
} from "./model.ts";
import { canonicalIndicatorCensus } from "./methodology.ts";

async function fileSha256(filename: string): Promise<string> {
  const bytes = await readFile(new URL(`../../data/${filename}`, import.meta.url));
  return createHash("sha256").update(bytes).digest("hex");
}

describe("model file contract", () => {
  it("is the exact pinned DAMM export named by its cryptographic manifest", async () => {
    assert.equal(await fileSha256(DAMM_MODEL_FILENAME), DAMM_MODEL_SHA256);
    assert.equal(await fileSha256(DAMM_MODEL_SCHEMA_FILENAME), DAMM_MODEL_SCHEMA_SHA256);
    assert.equal(DAMM_MODEL_SOURCE_SHA256[DAMM_MODEL_EXPORT.source.model_path], DAMM_MODEL_SHA256);
    assert.equal(
      DAMM_MODEL_SOURCE_SHA256[DAMM_MODEL_EXPORT.source.schema_path],
      "20abd0d06355d7426610158cc5c799b17229e00defff0ebb35044c18c946df93",
    );
  });

  it("binds its draft model identity to one immutable upstream revision", () => {
    assert.deepEqual(DAMM_MODEL_IDENTITY, {
      modelId: model.model,
      version: model.version,
      revision: model.revision,
      status: model.status,
      ratified: model.ratified,
      sourceRepository: "https://github.com/World-Bank-Digital/DAMM",
      sourceCommit: "141ebd4db7fb8ebb0d21ed64ead6aef24a7d7027",
      sourceModelPath: "model/DAMM-v1.7-model.json",
      sourceSchemaPath: "model/DAMM-v1.7-model.schema.json",
      modelSha256: DAMM_MODEL_SHA256,
      schemaSha256: DAMM_MODEL_SCHEMA_SHA256,
    });
    assert.equal(Object.isFrozen(DAMM_MODEL_IDENTITY), true);
    assert.equal(DAMM_MODEL_EXPORT.model_status, "draft for review");
    assert.equal(DAMM_MODEL_EXPORT.ratified, false);
  });

  it("pins the indicator census, engine, and renderer used by every build", () => {
    assert.deepEqual(DAMM_RUNTIME_IDENTITY, {
      indicator_census: {
        revision: "DAMM-v1.7-r2",
        path: "generated:model_v1_7.json#indicators",
        sha256: "f42b21112ae383aabb40c71331ee4c0071f6b5aed99aba747a7087e3db3eaac1",
      },
      engine: {
        version: "1.7",
        path: model.generated_from,
        sha256: "8a133af8653e9933c14b09b2897aa89be4dedc18446d9395f021a12183e27062",
      },
      renderer: {
        version: "1.7",
        path: "gauntlet/loop-1/render_v17.py",
        sha256: "98f2a52e0be7f54ff38095db86a3f01525527661a4e6993f7c2ee0da1d2cb9c3",
      },
    });
    assert.equal(Object.isFrozen(DAMM_RUNTIME_IDENTITY), true);
    assert.equal(Object.isFrozen(DAMM_RUNTIME_IDENTITY.engine), true);
    const censusBytes = `${JSON.stringify(canonicalIndicatorCensus(), null, 2)}\n`;
    assert.equal(
      createHash("sha256").update(censusBytes).digest("hex"),
      DAMM_RUNTIME_IDENTITY.indicator_census.sha256,
    );
  });

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

  it("ruling 13.4: 7.12 binds by data use, not by the AGI column alone", () => {
    const i = indicatorById("7.12");
    assert.ok(i);
    const cols = i.prerequisite!.slice(3).split(",");
    assert.ok(cols.includes("AGI"), "agricultural intelligence still binds");
    assert.ok(cols.length > 1, "and it is no longer AGI alone — that was the ruling");
    assert.ok(!cols.includes("AI"), "the UC:AI special case is gone from the model");
    // The column set itself is a 13.3 mapping question and is not ratified.
    assert.ok(model.binding_rules.some((r) => r.id === "ai-binds-agi" && !r.ratified));
  });

  it("bands are contiguous and half-open from 1 to 5", () => {
    assert.equal(model.bands[0].lo, 1);
    assert.ok(model.bands.at(-1)!.hi > 5);
    for (let k = 0; k + 1 < model.bands.length; k++) {
      assert.equal(model.bands[k].hi, model.bands[k + 1].lo);
    }
  });

  it("ruling 13.7: absorptions survived and now carry their names, unscored", () => {
    const abs = indicatorById("7.2")?.absorbs ?? [];
    assert.deepEqual(
      abs.map((a) => a.id),
      ["7.3", "7.4", "7.5", "7.6", "7.7"],
    );
    // The names were recovered from the v1.5 workbook; a bare id nests nothing.
    assert.ok(
      abs.every((a) => a.name.length > 5),
      "every sub-reading carries the name it is nested under",
    );
  });
});

describe("DAR outline and its evidence bindings", () => {
  it("carries 11 chapters: 1-10 plus the annex", () => {
    assert.deepEqual(
      model.dar_outline.map((c) => c.n),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "A"],
    );
  });

  it("marks chapters 3-10 prescriptive, so they render as proposed not evidenced", () => {
    for (const c of model.dar_outline) {
      const expected = ["1", "2", "A"].includes(c.n) ? "diagnostic" : "prescriptive";
      assert.equal(c.kind, expected, `chapter ${c.n}`);
    }
  });

  it("binds every chapter to evidence the model actually declares", () => {
    const ids = new Set(model.indicators.map((i) => i.id));
    const derived = new Set(Object.keys(model.derived_sources));
    for (const c of model.dar_outline) {
      for (const p of c.binding.pillars) assert.ok(p in model.pillars, `${c.n}: ${p}`);
      for (const u of c.binding.use_cases) assert.ok(u in model.use_cases, `${c.n}: ${u}`);
      for (const i of c.binding.indicators) {
        if (i !== "*") assert.ok(ids.has(i), `${c.n}: ${i}`);
      }
      for (const d of c.binding.derived) assert.ok(derived.has(d), `${c.n}: ${d}`);
    }
  });

  it("keeps the costs chapter honest — the model holds no cost data", () => {
    const costs = darChapter("5");
    assert.ok(costs);
    assert.deepEqual(costs.binding.pillars, [], "no pillar may be cited as a cost basis");
    assert.match(costs.note, /carries no cost, budget or financing data/i);
    assert.match(costs.note, /canonical Stage 6/);
    assert.match(costs.note, /never constitute an automatic financing decision/);
  });

  it("stops a chapter citing evidence outside its binding", () => {
    // Financing may cite the agri-fintech row; it may not reach for connectivity.
    assert.equal(chapterMayCite("5", "indicators", "6.14"), true);
    assert.equal(chapterMayCite("5", "pillars", "C1"), false);
    // Policy actions own C3; they do not own the outcomes pillar.
    assert.equal(chapterMayCite("6", "pillars", "C3"), true);
    assert.equal(chapterMayCite("6", "pillars", "O1"), false);
    // The annex may cite everything.
    assert.equal(chapterMayCite("A", "indicators", "2.1"), true);
    assert.equal(chapterMayCite("A", "pillars", "E1"), true);
  });

  it("routes the delivery-risk flags to governance, where they block nothing", () => {
    assert.deepEqual(darChapter("7")?.binding.prerequisites, ["4.9", "5.7"]);
    assert.match(darChapter("7")!.note, /block nothing/);
  });
});

describe("foresight and candidate indicators", () => {
  it("declares a named, unratified method of three steps", () => {
    assert.equal(model.foresight.ratified, false);
    assert.deepEqual(
      model.foresight.steps.map((s) => s.id),
      ["scenarios", "preferred_future", "backcasting"],
    );
  });

  it("binds milestones to the instrument with a target level and year", () => {
    assert.deepEqual(model.foresight.milestone_binding.fields, [
      "indicator_id",
      "target_level",
      "target_year",
    ]);
    assert.match(model.foresight.milestone_binding.fallback, /CANDIDATE/);
  });

  it("bars a candidate indicator from every aggregate", () => {
    const never = model.candidate_indicators.never.join(" ");
    for (const forbidden of ["pillar mean", "layer mean", "use-case mean", "readiness matrix"]) {
      assert.match(never, new RegExp(forbidden));
    }
    assert.match(model.candidate_indicators.disposition, /never automatic/);
  });

  it("accepts the existing candidate ids the worked examples already carry", () => {
    const pattern = new RegExp(model.candidate_indicators.id_pattern);
    assert.ok(pattern.test("A1-CAND-IMP"));
    assert.ok(pattern.test("A1-CAND-IRR"));
    assert.ok(!pattern.test("1.1"), "a scored indicator id is not a candidate id");
  });
});
