import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  G2_SAMPLE_RATE,
  G3_AFFIRMATION_IDS,
  ApprovalPolicyError,
  assertExactRowCoverage,
  assertG3AffirmationsForApproval,
  assertGateDecisionAllowed,
  buildG2ReviewScope,
  canonicalizeMachineFilledObservationRows,
  deriveApprovalLifecycle,
  validateExactRowCoverage,
  validateG3Affirmations,
  type ApprovalActor,
  type ApprovalActorKind,
  type ApprovalDecision,
  type ApprovalGate,
  type ApprovalPolicyErrorCode,
  type ApprovalRole,
  type CanonicalObservationRow,
  type G3AffirmationChecklist,
  type RecordedApprovalDecision,
} from "./approvals.ts";
import type { EvidenceClass } from "./types.ts";

function actor(
  authUserId: string,
  declaredRole: ApprovalRole,
  kind: ApprovalActorKind = "human",
  displayName = authUserId,
): ApprovalActor {
  return { kind, authenticated: true, authUserId, displayName, declaredRole };
}

function decision(
  gate: ApprovalGate,
  approvalDecision: ApprovalDecision,
  approvalActor: ApprovalActor,
): RecordedApprovalDecision {
  return {
    gate,
    decision: approvalDecision,
    actor: approvalActor,
    decidedAt: "2026-08-27T00:00:00.000Z",
  };
}

function assertPolicyError(action: () => unknown, code: ApprovalPolicyErrorCode): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof ApprovalPolicyError && error.code === code,
  );
}

function allG3Affirmations(value = true): G3AffirmationChecklist {
  return Object.fromEntries(G3_AFFIRMATION_IDS.map((id) => [id, value])) as G3AffirmationChecklist;
}

function canonicalRow(
  rowId: string,
  classification: EvidenceClass = "Measured",
  prerequisite = false,
): CanonicalObservationRow {
  return {
    rowId,
    indicatorId: rowId,
    payload: Object.freeze({ value: rowId }),
    rowSha256: rowId.padStart(64, "0").slice(-64),
    classification,
    prerequisite,
  };
}

describe("machine-filled observation row identity", () => {
  it("canonicalizes nested coordinator and direct persisted rows to the same stable hash", () => {
    const metadata = { "1.1": { prerequisite: true } };
    const nested = canonicalizeMachineFilledObservationRows(
      {
        "1.1": {
          id: "1.1",
          name: "Wrapper metadata is not the assessed row",
          verdict: "generated",
          row: {
            value: "Policy is implemented",
            cls: "Judged",
            src: "Assessment interview",
            year: 2026,
            note: "Review this exact statement",
          },
        },
      },
      metadata,
    );
    const direct = canonicalizeMachineFilledObservationRows(
      {
        "1.1": {
          note: "Review this exact statement",
          year: 2026,
          src: "Assessment interview",
          cls: "Judged",
          value: "Policy is implemented",
        },
      },
      metadata,
    );

    assert.deepEqual(nested, direct);
    assert.deepEqual(nested[0], {
      rowId: "1.1",
      indicatorId: "1.1",
      payload: {
        cls: "Judged",
        note: "Review this exact statement",
        src: "Assessment interview",
        value: "Policy is implemented",
        year: 2026,
      },
      rowSha256: nested[0]?.rowSha256,
      classification: "Judged",
      prerequisite: true,
    });
    assert.match(nested[0]?.rowSha256 ?? "", /^[0-9a-f]{64}$/);
  });

  it("returns a detached, deeply immutable canonical payload", () => {
    const source = {
      value: 3,
      cls: "Measured",
      detail: { labels: ["machine-filled"] },
    };
    const [canonical] = canonicalizeMachineFilledObservationRows(
      { "1.1": source },
      { "1.1": { prerequisite: false } },
    );

    source.detail.labels.push("changed later");
    assert.deepEqual(canonical?.payload, {
      cls: "Measured",
      detail: { labels: ["machine-filled"] },
      value: 3,
    });
    assert.equal(Object.isFrozen(canonical?.payload), true);
    assert.equal(Object.isFrozen(canonical?.payload.detail), true);
    assert.equal(
      Object.isFrozen((canonical?.payload.detail as { labels: readonly string[] }).labels),
      true,
    );
  });

  it("hashes every review-relevant row field while excluding coordinator wrapper fields", () => {
    const metadata = { "1.1": { prerequisite: false } };
    const original = canonicalizeMachineFilledObservationRows(
      { "1.1": { name: "Old name", row: { value: 3, cls: "Measured", note: "A" } } },
      metadata,
    );
    const wrapperOnlyChange = canonicalizeMachineFilledObservationRows(
      { "1.1": { name: "New name", row: { note: "A", cls: "Measured", value: 3 } } },
      metadata,
    );
    const rowChange = canonicalizeMachineFilledObservationRows(
      { "1.1": { name: "Old name", row: { value: 3, cls: "Measured", note: "B" } } },
      metadata,
    );

    assert.equal(original[0]?.rowSha256, wrapperOnlyChange[0]?.rowSha256);
    assert.notEqual(original[0]?.rowSha256, rowChange[0]?.rowSha256);
  });

  it("includes model-authorized carried candidates as non-prerequisite review rows", () => {
    const rows = canonicalizeMachineFilledObservationRows(
      {
        "A1-CAND-IRR": {
          value: 99.8,
          cls: "Measured",
          level: null,
          src: "FAO AQUASTAT",
        },
      },
      {},
      "^(A1|C1|C2|C3|C4|E1|O1)-CAND-[A-Z0-9-]+$",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.indicatorId, "A1-CAND-IRR");
    assert.equal(rows[0]?.prerequisite, false);
    assert.equal(rows[0]?.classification, "Measured");
  });

  it("rejects entries without a machine-filled row, classification, or model metadata", () => {
    assertPolicyError(
      () =>
        canonicalizeMachineFilledObservationRows(
          { "1.1": { row: null } },
          { "1.1": { prerequisite: false } },
        ),
      "INVALID_MACHINE_ROW",
    );
    assertPolicyError(
      () =>
        canonicalizeMachineFilledObservationRows(
          { "1.1": { row: { cls: "Measured" } } },
          { "1.1": { prerequisite: false } },
        ),
      "INVALID_MACHINE_ROW",
    );
    assertPolicyError(
      () =>
        canonicalizeMachineFilledObservationRows(
          { "1.1": { value: "claim" } },
          { "1.1": { prerequisite: false } },
        ),
      "INVALID_ROW_CLASSIFICATION",
    );
  });

  it("supports an explicitly derived classification for older direct rows", () => {
    const rows = canonicalizeMachineFilledObservationRows(
      { "1.1": { value: "claim", src: "Official strategy", tier: "T2" } },
      { "1.1": { prerequisite: false, classification: "Documented" } },
    );
    assert.equal(rows[0]?.classification, "Documented");
  });
});

describe("deterministic G2 scope", () => {
  it("includes every prerequisite and Judged row plus ceil(15%) of the remainder", () => {
    assert.equal(G2_SAMPLE_RATE, 0.15);
    const rows = [
      canonicalRow("r00", "Judged", true),
      canonicalRow("r01", "Measured", true),
      canonicalRow("r02", "Judged"),
      ...Array.from({ length: 9 }, (_, index) => canonicalRow(`r${index + 3}`)),
    ];

    const scope = buildG2ReviewScope(rows, "a".repeat(64));
    const sameScope = buildG2ReviewScope([...rows].reverse(), "a".repeat(64));

    assert.deepEqual(scope, sameScope);
    assert.deepEqual(scope.prerequisiteRowIds, ["r00", "r01"]);
    assert.deepEqual(scope.judgedRowIds, ["r00", "r02"]);
    assert.equal(scope.remainderCount, 9);
    assert.equal(scope.sampleSize, 2);
    assert.equal(scope.sampledRowIds.length, 2);
    assert.equal(scope.rows.length, 5);
    assert.deepEqual(scope.rows.find((row) => row.rowId === "r00")?.reasons, [
      "prerequisite",
      "judged",
    ]);
    assert.equal(new Set(scope.rows.map((row) => row.rowId)).size, scope.rows.length);
  });

  it("deduplicates identical source rows and never samples a mandatory row", () => {
    const required = canonicalRow("required", "Judged", true);
    const scope = buildG2ReviewScope(
      [required, required, canonicalRow("remainder")],
      "bundle-hash",
    );
    assert.equal(scope.rows.filter((row) => row.rowId === "required").length, 1);
    assert.equal(scope.sampledRowIds.includes("required"), false);
  });

  it("rejects conflicting rows that reuse one row ID", () => {
    assertPolicyError(
      () =>
        buildG2ReviewScope(
          [canonicalRow("same", "Measured"), canonicalRow("same", "Judged")],
          "bundle-hash",
        ),
      "DUPLICATE_ROW_ID",
    );
  });
});

describe("exact gate coverage", () => {
  it("accepts only the exact required set, independent of order", () => {
    assert.deepEqual(validateExactRowCoverage(["a", "b"], ["b", "a"]), {
      ok: true,
      missingRowIds: [],
      extraRowIds: [],
      duplicateRowIds: [],
      duplicateExpectedRowIds: [],
    });
  });

  it("reports and rejects missing, extra and duplicate review rows", () => {
    const coverage = validateExactRowCoverage(["a", "b"], ["b", "b", "c"]);
    assert.deepEqual(coverage, {
      ok: false,
      missingRowIds: ["a"],
      extraRowIds: ["c"],
      duplicateRowIds: ["b"],
      duplicateExpectedRowIds: [],
    });
    assertPolicyError(
      () => assertExactRowCoverage(["a", "b"], ["b", "b", "c"]),
      "ROW_COVERAGE_INVALID",
    );
  });
});

describe("human gate policy", () => {
  const assessor = actor("user-g1", "assessor", "human", "Named assessor");
  const g1 = decision("G1", "approved", assessor);
  const reviewer = actor("user-g2", "independent_reviewer", "human", "Named reviewer");
  const g2 = decision("G2", "approved", reviewer);
  const owner = actor("user-owner", "ttl_country_owner", "human", "Named TTL / country owner");

  it("never permits machine, service, vendor, or automated actors to satisfy G1 or G2", () => {
    for (const kind of ["machine", "service", "vendor", "automated"] as const) {
      assertPolicyError(
        () =>
          assertGateDecisionAllowed({
            gate: "G1",
            decision: "approved",
            actor: actor(`${kind}-id`, "assessor", kind),
            priorDecisions: [],
            expectedRowIds: ["row"],
            reviewedRowIds: ["row"],
          }),
        "ACTOR_NOT_AUTHENTICATED_HUMAN",
      );
      assertPolicyError(
        () =>
          assertGateDecisionAllowed({
            gate: "G2",
            decision: "approved",
            actor: actor(`${kind}-id`, "independent_reviewer", kind),
            priorDecisions: [g1],
            expectedRowIds: ["row"],
            reviewedRowIds: ["row"],
          }),
        "ACTOR_NOT_AUTHENTICATED_HUMAN",
      );
    }
  });

  it("also rejects an unauthenticated named human", () => {
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          gate: "G1",
          decision: "approved",
          actor: { ...assessor, authenticated: false },
          priorDecisions: [],
          expectedRowIds: [],
          reviewedRowIds: [],
        }),
      "ACTOR_NOT_AUTHENTICATED_HUMAN",
    );
  });

  it("enforces G2 independence by authenticated user ID, regardless of name or role label", () => {
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          gate: "G2",
          decision: "approved",
          actor: actor("user-g1", "independent_reviewer", "human", "A different display name"),
          priorDecisions: [g1],
          expectedRowIds: ["row"],
          reviewedRowIds: ["row"],
        }),
      "G2_REVIEWER_NOT_INDEPENDENT",
    );
    assert.doesNotThrow(() =>
      assertGateDecisionAllowed({
        gate: "G2",
        decision: "approved",
        actor: reviewer,
        priorDecisions: [g1],
        expectedRowIds: ["row"],
        reviewedRowIds: ["row"],
      }),
    );
  });

  it("rejects an automated stored G1 instead of treating it as a prerequisite approval", () => {
    const automatedG1 = decision("G1", "approved", actor("bot", "assessor", "automated"));
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          gate: "G2",
          decision: "approved",
          actor: reviewer,
          priorDecisions: [automatedG1],
          expectedRowIds: [],
          reviewedRowIds: [],
        }),
      "G1_REQUIRED",
    );
  });

  it("rejects G3 before valid G1 and G2 and restricts it to the configured country owner", () => {
    const g3Input = {
      gate: "G3" as const,
      decision: "approved" as const,
      actor: owner,
      countryOwnerUserId: "user-owner",
      g3Affirmations: allG3Affirmations(),
    };
    assertPolicyError(
      () => assertGateDecisionAllowed({ ...g3Input, priorDecisions: [] }),
      "G1_REQUIRED",
    );
    assertPolicyError(
      () => assertGateDecisionAllowed({ ...g3Input, priorDecisions: [g1] }),
      "G2_REQUIRED",
    );
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          ...g3Input,
          actor: actor("someone-else", "ttl_country_owner"),
          priorDecisions: [g1, g2],
        }),
      "G3_COUNTRY_OWNER_REQUIRED",
    );
    assert.doesNotThrow(() => assertGateDecisionAllowed({ ...g3Input, priorDecisions: [g1, g2] }));
  });

  it("rejects replacing a completed gate identity or decision", () => {
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          gate: "G1",
          decision: "revisions_required",
          actor: actor("replacement", "assessor"),
          priorDecisions: [g1],
          expectedRowIds: ["row"],
          reviewedRowIds: ["row"],
        }),
      "GATE_ALREADY_RECORDED",
    );
  });

  it("applies exact row coverage to both G1 and G2", () => {
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          gate: "G1",
          decision: "approved",
          actor: assessor,
          priorDecisions: [],
          expectedRowIds: ["a", "b"],
          reviewedRowIds: ["a"],
        }),
      "ROW_COVERAGE_INVALID",
    );
    assertPolicyError(
      () =>
        assertGateDecisionAllowed({
          gate: "G2",
          decision: "approved",
          actor: reviewer,
          priorDecisions: [g1],
          expectedRowIds: ["a", "b"],
          reviewedRowIds: ["a", "b", "c"],
        }),
      "ROW_COVERAGE_INVALID",
    );
  });
});

describe("G3 affirmations", () => {
  it("defines and requires all seven protocol affirmations", () => {
    assert.deepEqual(G3_AFFIRMATION_IDS, [
      "no_cross_country_ranking",
      "no_band_as_financing_condition",
      "no_automatic_financing_decisions",
      "no_public_claim_before_human_review",
      "parenthesized_bands_acknowledged",
      "register_rows_source_tier_verified",
      "qc_footer_accurate",
    ]);
    assert.doesNotThrow(() => assertG3AffirmationsForApproval(allG3Affirmations()));
  });

  it("rejects false, missing, extra, and non-boolean checklist values", () => {
    const invalid: Record<string, unknown> = {
      ...allG3Affirmations(),
      no_cross_country_ranking: false,
      qc_footer_accurate: "yes",
      unexpected: true,
    };
    delete invalid.no_automatic_financing_decisions;

    const validation = validateG3Affirmations(invalid);
    assert.equal(validation.ok, false);
    assert.deepEqual(validation.missingIds, ["no_automatic_financing_decisions"]);
    assert.deepEqual(validation.extraIds, ["unexpected"]);
    assert.deepEqual(validation.nonBooleanIds, ["qc_footer_accurate"]);
    assert.deepEqual(validation.falseIds, ["no_cross_country_ranking"]);
    assertPolicyError(() => assertG3AffirmationsForApproval(invalid), "G3_AFFIRMATIONS_INVALID");
  });
});

describe("honest Draft lifecycle", () => {
  const g1Actor = actor("g1", "assessor");
  const g2Actor = actor("g2", "independent_reviewer");
  const g3Actor = actor("owner", "ttl_country_owner");
  const g1 = decision("G1", "approved", g1Actor);
  const g2 = decision("G2", "approved", g2Actor);
  const g3 = {
    ...decision("G3", "approved", g3Actor),
    g3Affirmations: allG3Affirmations(),
  };
  const base = {
    reviewStarted: false,
    decisions: [] as readonly RecordedApprovalDecision[],
    countryOwnerUserId: "owner",
    methodologyStatus: "canonical" as const,
    methodologyModelStatus: "draft for review",
    methodologyRatified: false,
  };

  it("keeps autonomous completion visibly pre-review Draft", () => {
    assert.equal(deriveApprovalLifecycle(base), "draft_pre_review");
    assert.equal(deriveApprovalLifecycle({ ...base, reviewStarted: true }), "g1_pending");
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [decision("G1", "approved", actor("bot", "assessor", "automated"))],
      }),
      "draft_pre_review",
    );
  });

  it("advances only through independent, ordered human decisions", () => {
    assert.equal(deriveApprovalLifecycle({ ...base, decisions: [g1] }), "g2_pending");
    assert.equal(deriveApprovalLifecycle({ ...base, decisions: [g1, g2] }), "g3_pending");
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [g1, decision("G2", "approved", actor("g1", "independent_reviewer"))],
      }),
      "g2_pending",
    );
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [decision("G1", "revisions_required", g1Actor)],
      }),
      "revisions_required",
    );
  });

  it("never calls an unratified or methodology-unverified approved package canonical Final", () => {
    assert.equal(deriveApprovalLifecycle({ ...base, decisions: [g1, g2, g3] }), "approved_draft");
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [g1, g2, g3],
        methodologyStatus: "legacy_unverified",
        methodologyRatified: true,
      }),
      "approved_draft",
    );
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [g1, g2, g3],
        methodologyStatus: "historical_verified",
        methodologyModelStatus: "ratified",
        methodologyRatified: true,
      }),
      "approved_draft",
      "an integrity-verified historical pin is still ineligible for canonical Final",
    );
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [g1, g2, g3],
        methodologyModelStatus: "ratified",
        methodologyRatified: true,
      }),
      "canonical_final",
    );
    assert.equal(
      deriveApprovalLifecycle({ ...base, decisions: [g1, g2, g3], methodologyRatified: true }),
      "approved_draft",
      "a ratification flag cannot override the recorded draft methodology status",
    );
    assert.equal(
      deriveApprovalLifecycle({
        ...base,
        decisions: [
          g1,
          g2,
          { ...g3, g3Affirmations: { ...allG3Affirmations(), qc_footer_accurate: false } },
        ],
      }),
      "g3_pending",
      "an invalid stored G3 checklist cannot advance lifecycle",
    );
  });
});
