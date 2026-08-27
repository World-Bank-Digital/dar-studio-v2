import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { AssignedReviewPage } from "@/components/damm/AssignedReviewPage";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/review/$assignmentId")({ component: ReviewAssignmentRoute });

function ReviewAssignmentRoute() {
  const { assignmentId } = Route.useParams();
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-white text-ink">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Confirming the assigned reviewer…
        </p>
      </main>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return (
    <div className="min-h-dvh bg-white text-ink">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <a href="/" className="font-display text-lg font-semibold text-ink">
            DAR Studio · Human Review
          </a>
          <p className="text-xs text-muted">Exact-package, read-only assignment access</p>
          <div className="ml-auto">
            <UserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl bg-white px-4 py-6">
        <AssignedReviewPage assignmentId={assignmentId} />
      </main>
    </div>
  );
}
