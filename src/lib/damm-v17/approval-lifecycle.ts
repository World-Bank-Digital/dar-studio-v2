/** Honest post-completion states for one immutable Draft package and its approval chain. */
export type ApprovalLifecycleState =
  | "draft_pre_review"
  | "g1_pending"
  | "g2_pending"
  | "g3_pending"
  | "revisions_required"
  | "approved_draft"
  | "canonical_final";
