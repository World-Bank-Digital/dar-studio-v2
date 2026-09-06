import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  CANONICAL_STAGE_IDS,
  DAR_WORKFLOW,
  DAR_WORKFLOW_EXPORT,
  DAR_WORKFLOW_SCHEMA_SHA256,
  DAR_WORKFLOW_SHA256,
  WORKFLOW_CONTRACT_FILENAME,
  WORKFLOW_SCHEMA_FILENAME,
  assertCanonicalWorkflow,
  canonicalWorkflowLaunchRequest,
  workflowContractViolations,
} from "./workflow.ts";

async function fileSha256(filename: string): Promise<string> {
  const bytes = await readFile(new URL(`../../data/${filename}`, import.meta.url));
  return createHash("sha256").update(bytes).digest("hex");
}

describe("the exported canonical DAR workflow", () => {
  it("preserves a lower maximum spend for the complete workflow", () => {
    const request = canonicalWorkflowLaunchRequest({
      countryId: "country-1",
      budgetLimitUsd: 200,
    } as { countryId: string });
    assert.deepEqual(request, { countryId: "country-1", ceilingUsd: 200 });
  });

  it("rejects invalid or oversized spending limits instead of defaulting to $500", () => {
    for (const budgetLimitUsd of [0, -1, 500.01, 1.001, NaN, Infinity, "200", null, true]) {
      assert.throws(
        () =>
          canonicalWorkflowLaunchRequest({ countryId: "country-1", budgetLimitUsd } as {
            countryId: string;
          }),
        /maximum spend/i,
      );
    }
    assert.deepEqual(canonicalWorkflowLaunchRequest({ countryId: "country-1" }), {
      countryId: "country-1",
    });
    for (const budgetLimitUsd of [0.01, 19.99, 200, 483.81, 500]) {
      assert.equal(
        canonicalWorkflowLaunchRequest({ countryId: "country-1", budgetLimitUsd }).ceilingUsd,
        budgetLimitUsd,
      );
    }
  });

  it("strips client attempts to choose the canonical ceiling or vendor", () => {
    const request = canonicalWorkflowLaunchRequest({
      countryId: "country-1",
      ceilingUsd: 9_999_999,
      vendor: "untrusted/vendor",
    } as { countryId: string });
    assert.deepEqual(request, { countryId: "country-1" });
  });

  it("is the exact DAMM export named by its cryptographic manifest", async () => {
    assert.equal(await fileSha256(WORKFLOW_CONTRACT_FILENAME), DAR_WORKFLOW_SHA256);
    assert.equal(await fileSha256(WORKFLOW_SCHEMA_FILENAME), DAR_WORKFLOW_SCHEMA_SHA256);
    assert.equal(
      DAR_WORKFLOW_EXPORT.workflow_version,
      DAR_WORKFLOW.workflow_version,
      "the manifest and contract must describe the same workflow version",
    );
  });

  it("has the agreed eight stages, including the separate AI assessment", () => {
    assert.deepEqual(
      DAR_WORKFLOW.stages.map((stage) => stage.id),
      CANONICAL_STAGE_IDS,
    );
    assert.equal(DAR_WORKFLOW.stages[2].id, "ai_digital_agriculture");
    assert.deepEqual(DAR_WORKFLOW.stages[2].required_sections, [
      "as_is",
      "peer_experience",
      "recommended_agenda",
    ]);
  });

  it("requires only country at launch and never waits for optional uploads", () => {
    assert.deepEqual(DAR_WORKFLOW.required_launch_inputs, ["country"]);
    assert.equal(
      DAR_WORKFLOW.execution_policy.missing_optional_input_policy,
      "autonomous_research_fallback",
    );
    for (const stage of DAR_WORKFLOW.stages) {
      assert.equal(stage.human_input_required, false, stage.id);
      assert.ok(stage.fallback_when_optional_inputs_absent.length > 0, stage.id);
    }
  });

  it("allows no human gate, pause, budget top-up, or review during the active run", () => {
    const policy = DAR_WORKFLOW.execution_policy;
    assert.equal(policy.single_launch, true);
    assert.equal(policy.immutable_input_snapshot, true);
    assert.deepEqual(policy.required_human_actions_during_run, []);
    assert.deepEqual(policy.allowed_active_states, ["queued", "running", "retrying"]);
    assert.equal(policy.budget_exhaustion_policy, "bounded_retry_then_terminal_failure");
    assert.equal(policy.transient_failure_policy, "bounded_automatic_retry");
    assert.equal(policy.post_completion_review_only, true);
    assert.equal(DAR_WORKFLOW.post_completion.review_required_to_generate_draft, false);
    assert.equal(DAR_WORKFLOW.post_completion.review_available_after_stage, "export_package");
  });

  it("validates the invariants on import and rejects a human-gated copy", () => {
    assert.doesNotThrow(() => assertCanonicalWorkflow(DAR_WORKFLOW));
    const changed = structuredClone(DAR_WORKFLOW) as unknown as Record<string, unknown>;
    const policy = changed.execution_policy as Record<string, unknown>;
    policy.required_human_actions_during_run = ["approve stage 4"];
    assert.match(workflowContractViolations(changed).join("; "), /no human actions/);

    const paused = structuredClone(DAR_WORKFLOW) as unknown as Record<string, unknown>;
    const pausedPolicy = paused.execution_policy as Record<string, unknown>;
    pausedPolicy.allowed_active_states = ["queued", "running", "awaiting_human"];
    assert.match(workflowContractViolations(paused).join("; "), /never wait for a person/);

    const reordered = structuredClone(DAR_WORKFLOW) as unknown as Record<string, unknown>;
    const stages = reordered.stages as Array<Record<string, unknown>>;
    stages[5].depends_on = ["strategic_foresight"];
    stages[2].required_sections = ["as_is"];
    stages[7].required_artifacts = ["complete_bundle"];
    const violations = workflowContractViolations(reordered).join("; ");
    assert.match(violations, /wrong dependency graph/);
    assert.match(violations, /wrong required sections/);
    assert.match(violations, /wrong required artifacts/);
  });
});
