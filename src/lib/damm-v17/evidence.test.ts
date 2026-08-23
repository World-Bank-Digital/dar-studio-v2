import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { model } from "./model.ts";
import { Scorer } from "./scorer.ts";
import { fixtureToRecord, toObservations, deriveRow, numericValue } from "./evidence.ts";
import type { FixtureObservation } from "./evidence.ts";
import type { PillarId, UseCaseId } from "./types.ts";

import egyptObs from "./fixtures/egypt-observations.json" with { type: "json" };
import egyptExpected from "./fixtures/egypt-expected.json" with { type: "json" };
import nigeriaObs from "./fixtures/nigeria-observations.json" with { type: "json" };
import nigeriaExpected from "./fixtures/nigeria-expected.json" with { type: "json" };

/**
 * The demonstration pack stores the real Egypt and Nigeria assessments as
 * evidence rows. This round trip — fixture → stored record → observation →
 * scorer — must land on the very same figures the assessment pipeline
 * published, or the storage mapping is losing information.
 */
describe("evidence round trip reproduces the pipeline", () => {
  const scorer = new Scorer(model);
  const actor = { role: "TTL", name: "Demonstration" };

  for (const [name, fixture, expected] of [
    ["Egypt", egyptObs, egyptExpected],
    ["Nigeria", nigeriaObs, nigeriaExpected],
  ] as const) {
    it(`${name}: stored rows score identically to the pipeline's run`, () => {
      const rows = Object.entries(fixture).map(([id, f]) =>
        fixtureToRecord(id, f as FixtureObservation, actor),
      );
      const got = scorer.run(toObservations(rows));

      assert.deepEqual(got.counts, expected.counts, `${name} counts`);
      assert.equal(got.rated, expected.rated, `${name} rated`);
      assert.equal(got.held, expected.held, `${name} held`);
      for (const [p, e] of Object.entries(expected.pillars)) {
        const g = got.pillars[p as PillarId];
        assert.equal(g.mean, e.mean, `${name} ${p} mean`);
        assert.equal(g.band, e.band, `${name} ${p} band`);
        assert.equal(g.rated, e.rated, `${name} ${p} rated`);
        assert.equal(g.held, e.held, `${name} ${p} held`);
        assert.equal(g.weak, e.weak, `${name} ${p} weak`);
        assert.equal(g.stale, e.stale, `${name} ${p} stale`);
      }
      for (const [uc, e] of Object.entries(expected.matrix)) {
        const g = got.matrix[uc as UseCaseId];
        assert.equal(g.status, e.status, `${name} ${uc} status`);
        assert.equal(g.mean, e.mean, `${name} ${uc} mean`);
      }
      for (const [id, status] of Object.entries(expected.prereq)) {
        assert.equal(got.prereq[id]?.status, status, `${name} prereq ${id}`);
      }
    });
  }

  it("derived per-row readings agree with the fixture classes and levels", () => {
    const actorD = { role: "TTL", name: "Demonstration" };
    for (const [id, f] of Object.entries(egyptObs)) {
      const rec = fixtureToRecord(id, f as FixtureObservation, actorD);
      const def = model.indicators.find((i) => i.id === id)!;
      const d = deriveRow(def, rec);
      assert.equal(d.cls, (f as FixtureObservation).cls, `Egypt ${id} class`);
      assert.equal(d.level, (f as FixtureObservation).level ?? null, `Egypt ${id} level`);
    }
  });
});

describe("value parsing", () => {
  it("scores exactly-one-number strings as numbers, prose as prose", () => {
    assert.equal(numericValue("42.8"), 42.8);
    assert.equal(numericValue("  7402.2 "), 7402.2);
    assert.equal(numericValue("99.8% national"), null);
    assert.equal(numericValue("Law in force since 2020"), null);
    assert.equal(numericValue(""), null);
    assert.equal(numericValue(null), null);
  });
});
