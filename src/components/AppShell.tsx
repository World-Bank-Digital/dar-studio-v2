import { Link, useRouterState } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { disclaimer } from "@/lib/damm-v17/model";
import { ACTING_ROLES, useSessionRole } from "@/lib/session-context";
import { FolderOpen, Scale, Settings } from "lucide-react";

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="currentColor" className="text-forest" />
      <path d="M8 22c3-7 5-11 8-11s5 4 8 11" fill="none" stroke="#f6f3eb" strokeWidth="1.6" />
      <circle cx="16" cy="10" r="1.6" fill="#f6f3eb" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const user = useCurrentUser();

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <div className="border-b border-border bg-white text-forest">
        <p className="mx-auto max-w-6xl px-4 py-1.5 text-center text-[11px] leading-snug sm:text-xs">
          {disclaimer()}
        </p>
      </div>
      <header className="sticky top-0 z-30 border-b border-border bg-bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-ink">
            <Mark />
            <span className="font-display text-lg font-semibold tracking-tight">DAR Studio</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            <NavLink
              to="/"
              active={path === "/"}
              icon={<FolderOpen className="size-4" />}
              label="Portfolio"
            />
            <NavLink
              to="/methodology"
              active={path.startsWith("/methodology")}
              icon={<Scale className="size-4" />}
              label="Methodology"
            />
            <NavLink
              to="/settings"
              active={path.startsWith("/settings")}
              icon={<Settings className="size-4" />}
              label="Settings"
            />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <>
                <RoleChip />
                <UserButton />
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-sm border border-border-strong px-3 py-2 text-sm"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-1 sm:hidden">
          <NavLink to="/" active={path === "/"} label="Portfolio" />
          <NavLink to="/methodology" active={path.startsWith("/methodology")} label="Method" />
          <NavLink to="/settings" active={path.startsWith("/settings")} label="Settings" />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

function NavLink({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={`flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm ${active ? "bg-moss text-ink" : "text-muted hover:bg-moss/50"}`}
    >
      {icon}
      {label}
    </Link>
  );
}

function RoleChip() {
  const { role, setRole } = useSessionRole();
  return (
    <label className="hidden items-center gap-2 text-xs text-muted md:flex">
      Acting as
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="h-9 rounded-sm border border-border bg-surface px-2 text-sm text-ink"
      >
        {ACTING_ROLES.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
    </label>
  );
}
