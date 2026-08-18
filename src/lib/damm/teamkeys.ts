/**
 * Team-key administration. Admins are configured by the operator through
 * DAR_ADMIN_EMAILS — never self-appointed, never granted through the UI.
 * Kept alias-free so the policy is unit-testable (actions.ts pulls in the
 * server stack, which the test runner cannot resolve).
 */
export function teamAdminEmails(): string[] {
  return (process.env.DAR_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
