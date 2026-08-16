import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { WorkspaceView } from "@/components/damm/WorkspaceView";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/c/$id")({ component: CountryPage });

function CountryPage() {
  const { id } = Route.useParams();
  const { user } = useCurrentUserState();
  return (
    <AppShell>
      {user ? (
        <WorkspaceView id={id} />
      ) : (
        <p className="text-sm text-muted">
          Sign in to open this workspace.{" "}
          <Link to="/login" className="text-sage underline">
            Sign in
          </Link>
        </p>
      )}
    </AppShell>
  );
}
