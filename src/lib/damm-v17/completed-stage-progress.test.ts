import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completedWorkflowStageCount } from "./completed-stage-progress.ts";

describe("completed workflow stage progress", () => {
  it("uses the immutable publication when its completion event has not reached the UI", () => {
    assert.equal(
      completedWorkflowStageCount(
        "failed",
        4,
        [{ stageOrdinal: 1 }, { stageOrdinal: 2 }, { stageOrdinal: 3 }, { stageOrdinal: 4 },
          { stageOrdinal: 5 }],
        8,
      ),
      5,
    );
  });

  it("retains Stage 8 completion for a finished workflow", () => {
    assert.equal(completedWorkflowStageCount("done", 7, [{ stageOrdinal: 7 }], 8), 8);
  });
});
