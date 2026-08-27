/**
 * Setting a new password from a reset link.
 *
 * The link carries a single-use token that Better Auth issued and expires after an hour.
 * Two things this screen is careful about:
 *
 *  - **It says what went wrong.** A token that has expired or already been used produces a
 *    specific message and a way back, rather than a form that silently refuses.
 *  - **It confirms the new password twice.** The person using this screen cannot sign in,
 *    so a typo here locks them out again and the only tell would be a second failed
 *    sign-in.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { disclaimer } from "@/lib/damm-v17/model";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
    error: typeof search.error === "string" ? search.error : "",
  }),
});

/** Better Auth's own minimum. Stated here so the message appears before the round trip. */
const MIN_LENGTH = 8;

function ResetPassword() {
  const nav = useNavigate();
  const { token, error: linkError } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Better Auth redirects here with ?error=INVALID_TOKEN when the link is spent or stale.
  const badLink = !token || linkError;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Choose a password of at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== again) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await authClient.resetPassword({ newPassword: password, token });
      if (res.error) throw new Error(res.error.message ?? "The reset did not go through.");
      setDone(true);
      setTimeout(() => nav({ to: "/login" }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The reset did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <Card className="w-full max-w-md rounded-2xl p-8">
        <p className="text-xs font-medium uppercase tracking-widest text-sage">Independent prototype</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Set a new password</h1>

        {badLink ? (
          <>
            <p className="mt-4 text-sm text-muted">
              This link cannot be used. A reset link works once and expires an hour after it
              is sent, so it may already have been used or simply be too old.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block text-sm text-sage underline-offset-2 hover:underline"
            >
              Ask for a new one
            </Link>
          </>
        ) : done ? (
          <p className="mt-4 rounded-sm border border-border bg-moss/30 px-3 py-2 text-sm text-muted">
            Your password is set. Taking you to sign in…
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <p className="text-sm text-muted">
              Choose a password of at least {MIN_LENGTH} characters, and type it twice — you
              cannot sign in to check it afterwards.
            </p>
            <Input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <Input
              type="password"
              placeholder="New password again"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              required
              autoComplete="new-password"
            />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Working…" : "Set the password"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-subtle">{disclaimer()}</p>
      </Card>
    </main>
  );
}
