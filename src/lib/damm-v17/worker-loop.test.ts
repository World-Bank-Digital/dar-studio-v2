import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  IDLE_MS,
  nextDelayMs,
  runWorkerLoop,
} from "./worker-loop.ts";
import type { WorkerDeps } from "./worker.ts";

describe("when to ask the queue again", () => {
  it("goes straight back in after handling something", () => {
    // A drain that did work returns with the queue possibly non-empty. Sleeping here
    // leaves a queued country waiting for no reason.
    assert.equal(nextDelayMs({ handled: 2 }, 0).delayMs, 0);
  });

  it("waits when there was nothing to do", () => {
    assert.equal(nextDelayMs({ handled: 0 }, 0).delayMs, IDLE_MS);
  });

  it("backs off on failure, doubling", () => {
    const first = nextDelayMs({ failed: true }, 0);
    assert.equal(first.delayMs, BACKOFF_START_MS);
    assert.equal(nextDelayMs({ failed: true }, first.backoffMs).delayMs, BACKOFF_START_MS * 2);
  });

  it("stops doubling, so a long outage still recovers quickly", () => {
    assert.equal(nextDelayMs({ failed: true }, BACKOFF_MAX_MS).delayMs, BACKOFF_MAX_MS);
  });

  it("clears the backoff after a pass that worked", () => {
    // Otherwise the first failure after an outage resumes the minute it had climbed to.
    assert.equal(nextDelayMs({ handled: 0 }, BACKOFF_MAX_MS).backoffMs, 0);
  });
});

describe("the loop itself", () => {
  const deps = {} as WorkerDeps;

  it("keeps draining until it is stopped", async () => {
    let calls = 0;
    const loop = runWorkerLoop({
      deps,
      drain: async () => {
        calls++;
        if (calls >= 3) loop.stop();
        return 1;
      },
      sleep: async () => {},
    });
    await loop.done;
    assert.equal(calls, 3);
  });

  it("survives a drain that throws, and reports it rather than swallowing it", async () => {
    // A database blip should slow the worker down, not end it: a dead loop leaves every
    // queued run sitting at "queued" with nothing ever coming for it.
    const errors: unknown[] = [];
    const waited: number[] = [];
    let calls = 0;
    const loop = runWorkerLoop({
      deps,
      drain: async () => {
        calls++;
        if (calls === 1) throw new Error("database unreachable");
        loop.stop();
        return 0;
      },
      sleep: async (ms) => void waited.push(ms),
      onError: (e) => errors.push(e),
    });
    await loop.done;
    assert.equal(calls, 2, "should have tried again after the failure");
    assert.equal(errors.length, 1);
    assert.deepEqual(waited, [BACKOFF_START_MS]);
  });

  it("does not start another drain once it has been stopped mid-wait", async () => {
    // Stop arrives while the loop is idling. It should end there rather than complete
    // one more pass, because the process asking it to stop may be shutting down.
    let calls = 0;
    const loop = runWorkerLoop({
      deps,
      drain: async () => {
        calls++;
        return 0;
      },
      sleep: async () => loop.stop(),
    });
    await loop.done;
    assert.equal(calls, 1);
  });

  it("passes a live stop predicate into the active drain", async () => {
    let sawStopped = false;
    const loop = runWorkerLoop({
      deps,
      drain: async (_workerId, _deps, shouldStop) => {
        await Promise.resolve();
        loop.stop();
        sawStopped = shouldStop();
        return 1;
      },
      sleep: async () => {},
    });

    await loop.done;
    assert.equal(sawStopped, true);
  });
});
