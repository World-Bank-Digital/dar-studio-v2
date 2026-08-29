import { createServerFn } from "@tanstack/react-start";

import { authMiddleware } from "@/lib/auth/middleware";

import type {
  ApprovalAssignment,
  ApprovalPackage,
  ApprovalReviewRow,
  ApprovalStoreErrorValue,
  AssignedApprovalGate,
  AssignedApprovalRole,
  AssignedReview,
  HumanApprovalDecision,
  OwnerApprovalState,
} from "./approval-store.ts";

export type {
  ApprovalAssignment,
  ApprovalPackage,
  ApprovalReviewRow,
  AssignedApprovalGate,
  AssignedApprovalRole,
  AssignedReview,
  HumanApprovalDecision,
  OwnerApprovalState,
};

export type ApprovalActionResult<T> =
  { ok: true; value: T } | { ok: false; error: ApprovalStoreErrorValue };

export type ReviewRowDecision = "approved" | "revisions_required";

export interface ReviewRowSubmission {
  indicatorId: string;
  decision: ReviewRowDecision;
  notes: string;
}

export interface DraftDownload {
  key: string;
  label: string;
  href: string;
}

export interface G3AffirmationView {
  id: string;
  text: string;
}

export interface OwnerApprovalView extends OwnerApprovalState {
  g3Affirmations: readonly G3AffirmationView[];
  originalDraftDownloads: readonly DraftDownload[];
}

export interface AssignedReviewView extends AssignedReview {
  canSubmit: boolean;
  lockedReason: string | null;
  gateMeaning: string;
  humanAffirmation: string;
  humanAffirmationVersion: string;
  humanAffirmationSha256: string;
  originalDraftDownloads: readonly DraftDownload[];
}

const DEV_USER_ID = "dev-user";

function humanRequired(): ApprovalActionResult<never> {
  return {
    ok: false,
    error: {
      code: "AUTH_REQUIRED",
      message:
        "Human approval controls require a registered, named sign-in. The shared development user can generate and download Drafts but can never approve them.",
    },
  };
}

function cleanText(value: unknown, maximum: number, label = "Text"): string {
  if (typeof value !== "string") return "";
  if (value.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer`);
  return value.trim();
}

function requiredText(value: unknown, label: string): string {
  const cleaned = cleanText(value, 500, label);
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function decision(value: unknown): ReviewRowDecision {
  if (value !== "approved" && value !== "revisions_required") {
    throw new Error("A valid decision is required");
  }
  return value;
}

async function draftDownloads(runId: string): Promise<readonly DraftDownload[]> {
  // The server serializes the canonical catalogue so clients never invent or
  // silently drift artifact keys (there is deliberately no integrated Draft XLSX).
  const { DOCUMENT_SLOTS } = await import("./worker-artifacts.ts");
  return DOCUMENT_SLOTS.map((slot) => ({
    key: slot.artifactKey,
    label: slot.title,
    href: `/api/runs/${encodeURIComponent(runId)}/artifact?key=${encodeURIComponent(slot.artifactKey)}`,
  }));
}

async function gatePresentation(gate: AssignedApprovalGate): Promise<{
  gateMeaning: string;
  humanAffirmation: string;
  humanAffirmationVersion: string;
  humanAffirmationSha256: string;
}> {
  const { HUMAN_REVIEW_AFFIRMATIONS } = await import("./approvals.ts");
  return gate === "g1"
    ? {
        gateMeaning:
          "G1 requires the named assessor to review every machine-filled assessment row in this exact Draft package.",
        humanAffirmation: HUMAN_REVIEW_AFFIRMATIONS.g1.text,
        humanAffirmationVersion: HUMAN_REVIEW_AFFIRMATIONS.g1.version,
        humanAffirmationSha256: HUMAN_REVIEW_AFFIRMATIONS.g1.sha256,
      }
    : {
        gateMeaning:
          "G2 is an independent human review of 100% of prerequisite rows, 100% of Judged rows, and a deterministic 15% sample of the remainder, all frozen to this exact Draft package.",
        humanAffirmation: HUMAN_REVIEW_AFFIRMATIONS.g2.text,
        humanAffirmationVersion: HUMAN_REVIEW_AFFIRMATIONS.g2.version,
        humanAffirmationSha256: HUMAN_REVIEW_AFFIRMATIONS.g2.sha256,
      };
}

// Opening owner controls may append the immutable approval-package snapshot on first use,
// so this is intentionally POST rather than a cacheable/safe GET.
export const getOwnerApprovalStateAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; packageId?: string }) => ({
    countryId: requiredText(input.countryId, "Country ID"),
    packageId:
      input.packageId === undefined
        ? undefined
        : requiredText(input.packageId, "Approval package ID"),
  }))
  .handler(async ({ context, data }): Promise<ApprovalActionResult<OwnerApprovalView>> => {
    if (context.userId === DEV_USER_ID) return humanRequired();
    const store = await import("./approval-store.ts");
    const state = await store.openOwnerApprovalState(
      data.countryId,
      context.userId,
      undefined,
      data.packageId,
    );
    if (!state.ok) return state;
    const { G3_AFFIRMATIONS } = await import("./approvals.ts");
    return {
      ok: true,
      value: {
        ...state.value,
        g3Affirmations: G3_AFFIRMATIONS.map(({ id, text }) => ({ id, text })),
        originalDraftDownloads: await draftDownloads(state.value.package.runId),
      },
    };
  });

export const assignApprovalReviewerAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      packageId: string;
      targetIdentitySha256: string;
      bundleSha256: string;
      gate: AssignedApprovalGate;
      reviewerEmail: string;
      expectedActiveAssignmentId?: string | null;
      replacementReason?: string;
    }) => {
      if (input.gate !== "g1" && input.gate !== "g2") throw new Error("Invalid review gate");
      const expectedActiveAssignmentId =
        input.expectedActiveAssignmentId === null || input.expectedActiveAssignmentId === undefined
          ? null
          : requiredText(input.expectedActiveAssignmentId, "Active assignment ID");
      const replacementReason = cleanText(input.replacementReason, 5000, "Replacement reason");
      if (expectedActiveAssignmentId && !replacementReason) {
        throw new Error("Reviewer replacement requires a reason");
      }
      if (!expectedActiveAssignmentId && replacementReason) {
        throw new Error("A replacement reason requires an active assignment");
      }
      return {
        packageId: requiredText(input.packageId, "Approval package ID"),
        targetIdentitySha256: requiredText(input.targetIdentitySha256, "Package identity SHA-256"),
        bundleSha256: requiredText(input.bundleSha256, "Bundle SHA-256"),
        gate: input.gate,
        reviewerEmail: requiredText(input.reviewerEmail, "Registered reviewer email").toLowerCase(),
        expectedActiveAssignmentId,
        replacementReason,
      };
    },
  )
  .handler(async ({ context, data }) => {
    if (context.userId === DEV_USER_ID) return humanRequired();
    const store = await import("./approval-store.ts");
    const declaredRole: AssignedApprovalRole =
      data.gate === "g1" ? "assessor" : "independent_reviewer";
    const assigned = await store.assignApprovalReviewer({
      packageId: data.packageId,
      expectedTargetIdentitySha256: data.targetIdentitySha256,
      expectedBundleSha256: data.bundleSha256,
      gate: data.gate,
      reviewerEmail: data.reviewerEmail,
      declaredRole,
      ownerUserId: context.userId,
      expectedActiveAssignmentId: data.expectedActiveAssignmentId,
      replacementReason: data.replacementReason,
    });
    if (!assigned.ok) return assigned;
    return {
      ok: true as const,
      value: {
        assignment: assigned.value,
        sharePath: `/review/${encodeURIComponent(assigned.value.id)}`,
      },
    };
  });

export const getAssignedReviewAction = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { assignmentId: string }) => ({
    assignmentId: requiredText(input.assignmentId, "Assignment ID"),
  }))
  .handler(async ({ context, data }): Promise<ApprovalActionResult<AssignedReviewView>> => {
    if (context.userId === DEV_USER_ID) return humanRequired();
    const store = await import("./approval-store.ts");
    const review = await store.getAssignedReview(data.assignmentId, context.userId);
    if (!review.ok) return review;
    const presentation = await gatePresentation(review.value.assignment.gate);
    return {
      ok: true,
      value: {
        ...review.value,
        ...presentation,
        originalDraftDownloads: await draftDownloads(review.value.package.runId),
      },
    };
  });

export const submitAssignedReviewAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      assignmentId: string;
      decision: ReviewRowDecision;
      notes: string;
      rows: readonly ReviewRowSubmission[];
      affirmation: boolean;
      affirmationVersion: string;
      affirmationSha256: string;
    }) => ({
      assignmentId: requiredText(input.assignmentId, "Assignment ID"),
      decision: decision(input.decision),
      notes: cleanText(input.notes, 5000, "Gate notes"),
      rows: Array.isArray(input.rows)
        ? input.rows.map((row) => ({
            indicatorId: requiredText(row?.indicatorId, "Indicator ID"),
            decision: decision(row?.decision),
            notes: cleanText(row?.notes, 5000, `Notes for ${row?.indicatorId || "review row"}`),
          }))
        : [],
      affirmation: input.affirmation === true,
      affirmationVersion: requiredText(input.affirmationVersion, "Affirmation version"),
      affirmationSha256: requiredText(input.affirmationSha256, "Affirmation SHA-256"),
    }),
  )
  .handler(async ({ context, data }) => {
    if (context.userId === DEV_USER_ID) return humanRequired();
    const store = await import("./approval-store.ts");
    return store.submitAssignedReview({
      assignmentId: data.assignmentId,
      reviewerUserId: context.userId,
      decision: data.decision,
      notes: data.notes,
      rows: data.rows,
      affirmation: data.affirmation,
      expectedAffirmationVersion: data.affirmationVersion,
      expectedAffirmationSha256: data.affirmationSha256,
    });
  });

export const submitCountryOwnerSignoffAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      packageId: string;
      targetIdentitySha256: string;
      bundleSha256: string;
      decision: ReviewRowDecision;
      notes: string;
      affirmations: Readonly<Record<string, unknown>>;
    }) => ({
      packageId: requiredText(input.packageId, "Approval package ID"),
      targetIdentitySha256: requiredText(input.targetIdentitySha256, "Package identity SHA-256"),
      bundleSha256: requiredText(input.bundleSha256, "Bundle SHA-256"),
      decision: decision(input.decision),
      notes: cleanText(input.notes, 5000, "G3 notes"),
      affirmations:
        input.affirmations && typeof input.affirmations === "object"
          ? Object.fromEntries(
              Object.entries(input.affirmations).map(([id, checked]) => [id, checked === true]),
            )
          : {},
    }),
  )
  .handler(async ({ context, data }) => {
    if (context.userId === DEV_USER_ID) return humanRequired();
    const store = await import("./approval-store.ts");
    return store.submitCountryOwnerSignoff({
      packageId: data.packageId,
      expectedTargetIdentitySha256: data.targetIdentitySha256,
      expectedBundleSha256: data.bundleSha256,
      ownerUserId: context.userId,
      decision: data.decision,
      notes: data.notes,
      affirmations: data.affirmations,
    });
  });
