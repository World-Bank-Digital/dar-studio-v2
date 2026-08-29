import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clipboard, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import {
  ApprovalPackageIdentity,
  OriginalDraftDownloads,
} from "@/components/damm/ApprovalPackageIdentity";
import { lifecycleLabel } from "@/components/damm/approval-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  assignApprovalReviewerAction,
  getOwnerApprovalStateAction,
  submitCountryOwnerSignoffAction,
  type ApprovalAssignment,
  type ApprovalPackage,
  type AssignedApprovalGate,
  type G3AffirmationView,
  type HumanApprovalDecision,
  type OwnerApprovalView,
  type ReviewRowDecision,
} from "@/lib/damm-v17/approval-actions";

function readableError(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function gateLabel(gate: AssignedApprovalGate): string {
  return gate === "g1" ? "G1 · named assessor" : "G2 · independent human reviewer";
}

function roleLabel(gate: AssignedApprovalGate): string {
  return gate === "g1" ? "Assessor" : "Independent reviewer";
}

function recordedRoleLabel(role: HumanApprovalDecision["declaredRole"]): string {
  if (role === "ttl_country_owner") return "TTL / country owner";
  if (role === "independent_reviewer") return "Independent reviewer";
  return "Assessor";
}

function assignmentDecision(
  decisions: readonly HumanApprovalDecision[],
  gate: AssignedApprovalGate,
): HumanApprovalDecision | undefined {
  return decisions.find((decision) => decision.gate === gate);
}

export function DarReviewTab({ countryId }: { countryId: string }) {
  const [state, setState] = useState<OwnerApprovalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (packageId?: string) => {
    setLoading(true);
    try {
      const result = await getOwnerApprovalStateAction({ data: { countryId, packageId } });
      if (!result.ok) {
        setState(null);
        setError(result.error.message);
      } else {
        setState(result.value);
        setError(null);
      }
    } catch (cause) {
      setState(null);
      setError(readableError(cause, "The human-control state could not be read."));
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !state) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Materializing the exact post-completion review
        package…
      </p>
    );
  }

  if (!state) {
    return (
      <Card className="bg-white p-5">
        <h2 className="text-lg font-semibold">Draft · pre-review</h2>
        <p className="mt-2 text-sm text-muted">
          Human controls become available only after all eight autonomous stages finish and one
          exact hash-verified Stage 8 Draft package can be materialized. They never pause, gate, or
          extend the workflow itself.
        </p>
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error ?? "No exact completed Stage 8 Draft package is available yet."}
        </p>
      </Card>
    );
  }

  const g1 = assignmentDecision(state.decisions, "g1");
  const g2 = assignmentDecision(state.decisions, "g2");
  const g3 = state.decisions.find((item) => item.gate === "g3");
  const selectedHistory = state.packageHistory.find(
    (item) => item.packageId === state.package.id,
  );
  const historicalReadOnly = selectedHistory?.currentMethodology === false;
  const activityLockedReason = historicalReadOnly
    ? "This exact historical package remains audit-readable, but its approval chain is read-only. Start a new current-methodology Draft package for any new G1, G2, or G3 activity."
    : state.lifecycle === "revisions_required"
      ? "This package requires revision; assignments resume only on a new completed Draft package and approval chain."
      : null;
  const g3Unlocked =
    !activityLockedReason && g1?.decision === "approved" && g2?.decision === "approved";
  const refreshSelected = () => refresh(state.package.id);

  return (
    <div className="space-y-5 bg-white">
      <Card className="border border-forest/20 bg-white p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">Post-completion human controls</h1>
              <Badge tone="forest">
                {lifecycleLabel(state.lifecycle, state.package.methodology.modelRatified)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted">
              G1, G2, and G3 occur after—not as stages in—the complete eight-stage Draft DAR
              workflow. Automated derivation, vendor challenge, and machine QC never satisfy a human
              gate. Autonomous execution success means only that a downloadable pre-review Draft
              exists.
            </p>
            <p className="mt-2 text-sm text-muted">
              If any gate requires revisions, the immutable package and decision remain as recorded;
              a revised artifact set must complete as a new Draft package with a new approval chain.
            </p>
          </div>
        </div>
      </Card>

      {state.packageHistory.length > 1 ? (
        <Card className="border border-border bg-white p-5">
          <label className="block text-sm font-semibold" htmlFor="approval-package-history">
            Exact Draft package and approval history
          </label>
          <p className="mt-1 text-sm text-muted">
            Select an immutable package to inspect its own reviewers, decisions, hashes, and release.
            Historical approvals never transfer to another artifact set.
          </p>
          <select
            id="approval-package-history"
            className="mt-3 h-11 w-full rounded-sm border border-border bg-white px-3 text-sm"
            value={state.package.id}
            disabled={loading}
            onChange={(event) => void refresh(event.currentTarget.value)}
          >
            {state.packageHistory.map((item) => (
              <option key={item.packageId} value={item.packageId}>
                {item.currentMethodology ? "Current methodology" : "Historical · read only"} ·{" "}
                {new Date(item.completedAt).toLocaleString()} · run {item.runId}
              </option>
            ))}
          </select>
          {historicalReadOnly ? (
            <p className="mt-3 rounded-sm border border-amber-300 bg-white p-3 text-sm font-medium text-amber-900">
              {activityLockedReason}
            </p>
          ) : null}
        </Card>
      ) : historicalReadOnly ? (
        <Card className="border border-amber-300 bg-white p-5 text-sm font-medium text-amber-900">
          {activityLockedReason}
        </Card>
      ) : null}

      <ApprovalPackageIdentity approvalPackage={state.package} lifecycle={state.lifecycle} />
      <OriginalDraftDownloads downloads={state.originalDraftDownloads} />

      <section className="grid gap-4 lg:grid-cols-2" aria-label="G1 and G2 assignments">
        <ReviewerAssignmentCard
          approvalPackage={state.package}
          gate="g1"
          assignment={state.assignments.find((item) => item.gate === "g1")}
          decision={g1}
          prerequisiteAccepted={true}
          activityLockedReason={activityLockedReason}
          onChanged={refreshSelected}
        />
        <ReviewerAssignmentCard
          approvalPackage={state.package}
          gate="g2"
          assignment={state.assignments.find((item) => item.gate === "g2")}
          decision={g2}
          prerequisiteAccepted={g1?.decision === "approved"}
          activityLockedReason={activityLockedReason}
          onChanged={refreshSelected}
        />
      </section>

      {state.assignmentSupersessions.length ? (
        <Card className="bg-white p-5">
          <h2 className="text-lg font-semibold">Immutable reviewer-assignment audit</h2>
          <p className="mt-1 text-sm text-muted">
            Historical assignments are never rewritten or deleted. Each entry records the exact
            pending assignment that lost access and the successor created in the same transaction.
          </p>
          <ol className="mt-4 space-y-3">
            {state.assignmentSupersessions.map((item) => (
              <li key={item.id} className="rounded-sm border border-border bg-white p-3 text-sm">
                <p className="font-semibold">
                  {item.gate.toUpperCase()} assignment replaced ·{" "}
                  {new Date(item.revokedAt).toLocaleString()}
                </p>
                <p className="mt-1 text-muted">
                  Recorded by {item.revokedByName} · {item.revokedByEmail}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-muted">{item.reason}</p>
                <dl className="mt-2 grid gap-1 text-xs text-subtle sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Revoked assignment</dt>
                    <dd className="break-all">{item.revokedAssignmentId}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Successor assignment</dt>
                    <dd className="break-all">{item.supersedingAssignmentId}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <G3CountryOwnerCard
        approvalPackage={state.package}
        affirmations={state.g3Affirmations}
        decision={g3}
        unlocked={g3Unlocked}
        lockedReason={activityLockedReason}
        onChanged={refreshSelected}
      />

      <ReleaseCard state={state} />
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewerAssignmentCard({
  approvalPackage,
  gate,
  assignment,
  decision,
  prerequisiteAccepted,
  activityLockedReason,
  onChanged,
}: {
  approvalPackage: ApprovalPackage;
  gate: AssignedApprovalGate;
  assignment?: ApprovalAssignment;
  decision?: HumanApprovalDecision;
  prerequisiteAccepted: boolean;
  activityLockedReason: string | null;
  onChanged: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [replacementReason, setReplacementReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sharePath = assignment ? `/review/${encodeURIComponent(assignment.id)}` : null;

  async function assign() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await assignApprovalReviewerAction({
        data: {
          packageId: approvalPackage.id,
          targetIdentitySha256: approvalPackage.targetIdentitySha256,
          bundleSha256: approvalPackage.bundleSha256,
          gate,
          reviewerEmail: email,
          expectedActiveAssignmentId: assignment?.id ?? null,
          replacementReason: assignment ? replacementReason : "",
        },
      });
      if (!result.ok) setMessage(result.error.message);
      else {
        setEmail("");
        setReplacementReason("");
        setMessage(
          assignment
            ? `Replaced the pending assignment with ${result.value.assignment.reviewerName}.`
            : `Assigned ${result.value.assignment.reviewerName}.`,
        );
        await onChanged();
      }
    } catch (cause) {
      setMessage(readableError(cause, `${gate.toUpperCase()} could not be assigned.`));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!sharePath) return;
    const absolute = new URL(sharePath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      setMessage("Review link copied.");
    } catch {
      setMessage(`Share this review link: ${absolute}`);
    }
  }

  return (
    <Card className="bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{gateLabel(gate)}</h2>
          <p className="mt-1 text-sm text-muted">
            {gate === "g1"
              ? "Reviews every machine-filled assessment row in the exact package."
              : "Must be a different authenticated person from G1. Scope is all prerequisites, all Judged rows, plus the deterministic 15% remainder sample."}
          </p>
        </div>
        {decision ? (
          <Badge tone={decision.decision === "approved" ? "ok" : "warn"}>
            {decision.decision === "approved" ? "Accepted" : "Revisions required"}
          </Badge>
        ) : assignment ? (
          <Badge tone="neutral">Assigned</Badge>
        ) : (
          <Badge tone="neutral">Pending</Badge>
        )}
      </div>

      {assignment ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-sm border border-border bg-white p-3 text-sm">
            <p className="font-semibold">{assignment.reviewerName}</p>
            <p className="text-muted">{assignment.reviewerEmail}</p>
            <p className="mt-1 text-xs text-subtle">
              {roleLabel(gate)} · {assignment.scope.length} exact rows · assigned{" "}
              {new Date(assignment.assignedAt).toLocaleString()}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                className="break-all text-sm font-medium text-sage underline underline-offset-4"
                href={sharePath ?? undefined}
              >
                {sharePath}
              </a>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyLink()}>
                <Clipboard className="size-4" aria-hidden="true" /> Copy link
              </Button>
            </div>
          </div>

          {!decision && !activityLockedReason ? (
            <div className="rounded-sm border border-amber-300 bg-white p-3">
              <p className="text-sm font-semibold">Replace this pending assignment</p>
              <p className="mt-1 text-xs text-subtle">
                Use this only when the named reviewer is unavailable or was assigned in error. The
                original assignment and the owner identity, reason, and server time remain in the
                immutable audit trail; the old review link and artifact access are revoked
                atomically.
              </p>
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-subtle">
                  New registered {roleLabel(gate).toLowerCase()} email
                  <Input
                    className="mt-1 bg-white"
                    type="email"
                    autoComplete="email"
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="replacement@example.org"
                  />
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-subtle">
                  Required replacement reason
                  <Textarea
                    className="mt-1 min-h-20 bg-white"
                    value={replacementReason}
                    maxLength={5000}
                    disabled={busy}
                    onChange={(event) => setReplacementReason(event.target.value)}
                    placeholder="Why the original pending assignment must be replaced"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !email.trim() || !replacementReason.trim()}
                  onClick={() => void assign()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Replace pending {gate.toUpperCase()} assignment
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-subtle">
            Registered {roleLabel(gate).toLowerCase()} email
            <Input
              className="mt-1 bg-white"
              type="email"
              autoComplete="email"
              value={email}
              disabled={Boolean(activityLockedReason)}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="reviewer@example.org"
            />
          </label>
          <Button
            type="button"
            disabled={busy || Boolean(activityLockedReason) || !email.trim()}
            onClick={() => void assign()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Assign {gate.toUpperCase()}
          </Button>
          <p className="text-xs text-subtle">
            The server resolves the registered account and freezes its name, email, role, package,
            scope, assigner, and assignment time. Browser-provided identity or roles are never
            trusted.
          </p>
          {activityLockedReason ? (
            <p className="text-xs font-medium text-amber-900">
              {activityLockedReason}
            </p>
          ) : null}
        </div>
      )}

      {gate === "g2" && !prerequisiteAccepted ? (
        <p className="mt-3 flex items-start gap-2 rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> G2 submission is
          locked until this exact package has an accepted human G1 decision.
        </p>
      ) : null}

      {decision ? <CompletedDecision decision={decision} /> : null}
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </Card>
  );
}

function CompletedDecision({ decision }: { decision: HumanApprovalDecision }) {
  return (
    <div className="mt-4 border-t border-border pt-3 text-sm">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden="true" />
        <div>
          <p className="font-semibold">
            Immutable completed {decision.gate.toUpperCase()} decision
          </p>
          <p className="text-muted">
            {decision.reviewerName} · {decision.reviewerEmail} ·{" "}
            {new Date(decision.decidedAt).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-subtle">
            Declared role: {recordedRoleLabel(decision.declaredRole)} · decision ID {decision.id}
          </p>
          {decision.reviewerAffirmationText ? (
            <div className="mt-2 rounded-sm border border-border bg-white p-3 text-xs text-muted">
              <p>{decision.reviewerAffirmationText}</p>
              <p className="mt-2 break-all font-mono text-[11px] text-subtle">
                {decision.reviewerAffirmationVersion} · SHA-256 {decision.reviewerAffirmationSha256}
              </p>
            </div>
          ) : null}
          {decision.notes ? (
            <p className="mt-2 whitespace-pre-wrap text-muted">{decision.notes}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function G3CountryOwnerCard({
  approvalPackage,
  affirmations,
  decision,
  unlocked,
  lockedReason,
  onChanged,
}: {
  approvalPackage: ApprovalPackage;
  affirmations: readonly G3AffirmationView[];
  decision?: HumanApprovalDecision;
  unlocked: boolean;
  lockedReason: string | null;
  onChanged: () => Promise<void>;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [outcome, setOutcome] = useState<ReviewRowDecision>("approved");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const allChecked = affirmations.every((item) => checked[item.id] === true);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await submitCountryOwnerSignoffAction({
        data: {
          packageId: approvalPackage.id,
          targetIdentitySha256: approvalPackage.targetIdentitySha256,
          bundleSha256: approvalPackage.bundleSha256,
          decision: outcome,
          notes,
          affirmations: checked,
        },
      });
      if (!result.ok) setMessage(result.error.message);
      else {
        setMessage("The immutable G3 decision has been recorded.");
        await onChanged();
      }
    } catch (cause) {
      setMessage(readableError(cause, "G3 could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">G3 · TTL / country owner sign-off</h2>
          <p className="mt-1 text-sm text-muted">
            The product-designated TTL / country owner may sign only after accepted G1 and G2. The
            server derives the owner identity, role, and decision time from the authenticated
            account.
          </p>
        </div>
        {decision ? (
          <Badge tone={decision.decision === "approved" ? "ok" : "warn"}>
            {decision.decision === "approved" ? "Signed" : "Revisions required"}
          </Badge>
        ) : (
          <Badge tone="neutral">{unlocked ? "Ready" : "Locked"}</Badge>
        )}
      </div>

      {decision ? (
        <CompletedDecision decision={decision} />
      ) : !unlocked ? (
        <p className="mt-4 flex items-start gap-2 rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {lockedReason ??
            "G3 is locked until valid, accepted human G1 and independent human G2 decisions exist for this exact package."}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold">Seven QC Protocol affirmations</legend>
            <div className="mt-2 grid gap-2">
              {affirmations.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-2 rounded-sm border border-border bg-white p-3 text-sm"
                >
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={checked[item.id] === true}
                    onChange={(event) =>
                      setChecked((current) => ({ ...current, [item.id]: event.target.checked }))
                    }
                  />
                  {item.text}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold">G3 decision</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="g3-outcome"
                  checked={outcome === "approved"}
                  onChange={() => setOutcome("approved")}
                />
                Approve for external circulation
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="g3-outcome"
                  checked={outcome === "revisions_required"}
                  onChange={() => setOutcome("revisions_required")}
                />
                Revisions required
              </label>
            </div>
          </fieldset>

          <Textarea
            className="bg-white"
            maxLength={5000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={
              outcome === "revisions_required"
                ? "Required: explain the revisions needed"
                : "Optional TTL / country-owner notes"
            }
            aria-label="G3 notes"
          />
          <Button
            type="button"
            disabled={
              busy ||
              (outcome === "approved" && !allChecked) ||
              (outcome === "revisions_required" && !notes.trim())
            }
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Record immutable G3 decision
          </Button>
          {outcome === "approved" && !allChecked ? (
            <p className="text-xs text-subtle">All seven affirmations are required for approval.</p>
          ) : null}
        </div>
      )}
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </Card>
  );
}

function ReleaseCard({ state }: { state: OwnerApprovalView }) {
  const releaseLabel = useMemo(
    () =>
      lifecycleLabel(
        state.release?.lifecycle ?? state.lifecycle,
        state.package.methodology.modelRatified,
      ),
    [state.lifecycle, state.package.methodology.modelRatified, state.release?.lifecycle],
  );
  return (
    <Card className="bg-white p-5">
      <h2 className="text-lg font-semibold">Versioned post-completion release</h2>
      {state.release ? (
        <div className="mt-3 text-sm">
          <Badge tone="ok">{releaseLabel}</Badge>
          <p className="mt-3 text-muted">
            Release v{state.release.version} authorizes external circulation under a versioned
            release record tied to the exact reviewed Draft package. The original Stage 8 Draft
            remains separate and unchanged.
          </p>
          <dl className="mt-3 grid gap-1 text-xs text-subtle">
            <div>Release ID: {state.release.id}</div>
            <div className="break-all">
              Release manifest SHA-256: {state.release.manifestSha256}
            </div>
            <div>Created: {new Date(state.release.createdAt).toLocaleString()}</div>
          </dl>
          {!state.package.methodology.modelRatified ? (
            <p className="mt-3 font-medium text-amber-900">
              Methodology is unratified: this is an approved Draft release, never Final or
              methodologically ratified.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No release exists. Pending or incomplete approvals remain visibly Draft and are not
          approved, Final, publication-ready, or authorized for external circulation.
        </p>
      )}
    </Card>
  );
}
