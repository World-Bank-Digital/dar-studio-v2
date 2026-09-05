import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completedWorkflowStageCount } from "./completed-stage-progress.ts";

describe("completed workflow stage progress", () => {
  it("uses the immutable publication when its completion event has not reached the UI", () => {
    assert.equal(
      completedWorkflowStageCount(
        "failed",
        4,
        [
          { stageOrdinal: 1 },
          { stageOrdinal: 2 },
          { stageOrdinal: 3 },
          { stageOrdinal: 4 },
          { stageOrdinal: 5 },
        ],
        8,
      ),
      5,
    );
  });

  it("retains Stage 8 completion for a finished workflow", () => {
    assert.equal(completedWorkflowStageCount("done", 7, [{ stageOrdinal: 7 }], 8), 8);
  });
});

import { workflowStageLabel } from "./completed-stage-progress.ts";

it("shows a terminal Stage 6 stop and does not promise later work", () => {
  assert.equal(workflowStageLabel("failed", 5, 5), "Complete");
  assert.equal(workflowStageLabel("failed", 5, 6), "Stopped before completion");
  assert.equal(workflowStageLabel("failed", 5, 7), "Not run");
  assert.equal(workflowStageLabel("cancelled", 5, 6), "Cancelled before completion");
  assert.equal(workflowStageLabel("queued", 0, 1), "Queued");
});
