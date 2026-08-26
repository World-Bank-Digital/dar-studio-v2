export type ApprovalLifecycle =
  | "pre_review_draft"
  | "g1_pending"
  | "g2_pending"
  | "g3_pending"
  | "revisions_required"
  | "approved_draft"
  | "canonical_final";

export function lifecycleLabel(lifecycle: ApprovalLifecycle, methodologyRatified: boolean): string {
  switch (lifecycle) {
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
    default:
      return "Draft · pre-review";
  }
}
