import { it } from "node:test";
import assert from "node:assert/strict";
import { stoppedSummary, type Run } from "./runs.ts";

it("does not render the Nigeria failure transcript in an ordinary run summary", () => {
  const run = {
    pass: "workflow",
    status: "failed",
    rowsDone: 0,
    rowsTotal: 8,
    stoppedReason:
      "40904 BudgetExceededError https://example.test/?key=SYNTHETIC_PRIVATE_VALUE /var/data/checkouts/internal",
  } as Run;
  assert.doesNotMatch(stoppedSummary(run), /SYNTHETIC_PRIVATE_VALUE|https:|40904|checkouts/);
  assert.match(stoppedSummary(run), /0 of 8 stages/);
});

import { publicRunView, publicRunEvent } from "./run-view.ts";

it("redacts persisted diagnostics and worker details before browser serialization", () => {
  const sentinel = "SYNTHETIC_PRIVATE_VALUE";
  const run = {
    id: "fixture",
    userId: "owner",
    countryId: "country",
    countryName: "Fixtureland",
    iso3: "FIX",
    pass: "workflow",
    status: "failed",
    rowsDone: 0,
    rowsTotal: 8,
    ceilingUsd: 500,
    spentUsd: 13.35446735,
    stoppedReason: sentinel,
    claimedBy: sentinel,
    outBasename: sentinel,
    vendor: sentinel,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    claimToken: sentinel,
    unexpectedDiagnostic: sentinel,
  };
  const before = JSON.stringify(run);
  const view = publicRunView(run as Run);
  assert.ok(!JSON.stringify(view).includes(sentinel));
  assert.equal(view.spentUsd, 13.35446735);
  assert.equal(JSON.stringify(run), before);
  for (const kind of ["status", "log", "failed", sentinel]) {
    const event = { id: 1, at: new Date(0), kind, indicatorId: sentinel, message: sentinel };
    const safe = publicRunEvent(event);
    assert.ok(!JSON.stringify(safe).includes(sentinel));
    assert.equal(safe.id, 1);
    assert.equal(event.message, sentinel);
  }
});

it("uses durable stage completion consistently in progress and the failure summary", () => {
  const run = {
    id: "sim",
    pass: "workflow",
    status: "failed",
    rowsDone: 4,
    rowsTotal: 8,
    spentUsd: 0,
    ceilingUsd: 500,
  } as Run;
  const view = publicRunView(run, [{ stageOrdinal: 5 }] as Parameters<typeof publicRunView>[1]);
  assert.equal(view.progress.rowsDone, 5);
  assert.match(view.summary, /Failed after 5 of 8 stages/);
});
