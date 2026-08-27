import type { ApprovalLifecycleState } from "@/lib/damm-v17/approval-lifecycle";

export type ApprovalLifecycle = ApprovalLifecycleState;

export function lifecycleLabel(lifecycle: ApprovalLifecycle, methodologyRatified: boolean): string {
  switch (lifecycle) {
    case "draft_pre_review":
      return "Draft · pre-review";
    case "g1_pending":
      return "Draft · G1 pending";
    case "g2_pending":
      return "Draft · G2 pending";
    case "g3_pending":
      return "Draft · G3 pending";
    case "revisions_required":
      return "Draft · revisions required";
    case "approved_draft":
      return "Approved Draft release";
    case "canonical_final":
      return methodologyRatified ? "Canonical Final release" : "Approved Draft release";
  }
}
