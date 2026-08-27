import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "./utils.ts";

describe("mapLimit", () => {
  it("preserves order regardless of completion order", async () => {
    const out = await mapLimit([50, 5, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    assert.deepEqual(out, [50, 5, 20]);
  });

  it("never exceeds the concurrency bound", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
    });
    assert.ok(peak <= 4, `peak concurrency ${peak} exceeded 4`);
    assert.ok(peak >= 2, "pool never actually ran concurrently");
  });

  it("handles an empty list", async () => {
    assert.deepEqual(await mapLimit([], 4, async (x) => x), []);
  });
});
