import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

import {
  ApprovalPackageIdentity,
  OriginalDraftDownloads,
} from "@/components/damm/ApprovalPackageIdentity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  getAssignedReviewAction,
  submitAssignedReviewAction,
  type ApprovalReviewRow,
  type AssignedReviewView,
  type HumanApprovalDecision,
  type ReviewRowDecision,
} from "@/lib/damm-v17/approval-actions";

type RowDraft = { decision: ReviewRowDecision | ""; notes: string };

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function payloadText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function payloadField(row: ApprovalReviewRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row.payload[key];
    if (value !== null && value !== undefined && value !== "") return payloadText(value);
  }
  return "—";
}

function safeSourceUrl(value: string): string | null {
  if (value === "—") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function roleLabel(role: string): string {
  return role === "independent_reviewer" ? "Independent reviewer" : "Assessor";
}

function scopedMeaning(row: ApprovalReviewRow, gate: "g1" | "g2"): readonly string[] {
  if (gate === "g1") return ["Every machine-filled row (G1)"];
  const reasons = row.reasons ?? [];
  return reasons.map((reason) => {
    if (reason === "prerequisite") return "100% prerequisite scope";
    if (reason === "judged") return "100% Judged scope";
    if (reason === "sample") return "Deterministic 15% remainder sample";
    return reason;
  });
}

export function AssignedReviewPage({ assignmentId }: { assignmentId: string }) {
  const [review, setReview] = useState<AssignedReviewView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [gateNotes, setGateNotes] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAssignedReviewAction({ data: { assignmentId } });
      if (!result.ok) {
        setReview(null);
        setError(result.error.message);
        return;
      }
      setReview(result.value);
      const completed = result.value.ownDecision;
      const recordedRows = new Map(
        (completed?.rowReviews ?? []).map((row) => [row.indicatorId, row]),
      );
      setDrafts(
        Object.fromEntries(
          result.value.rows.map((row) => {
            const recorded = recordedRows.get(row.indicatorId);
            return [
              row.indicatorId,
              { decision: recorded?.decision ?? "", notes: recorded?.notes ?? "" },
            ];
          }),
        ),
      );
      setGateNotes(completed?.notes ?? "");
      setAffirmed(completed?.reviewerAffirmation ?? false);
      setError(null);
    } catch (cause) {
      setReview(null);
      setError(errorText(cause, "The assigned review could not be opened."));
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const completed = useMemo(() => review?.ownDecision ?? null, [review]);
  const allRowsDecided = Boolean(
    review?.rows.every((row) => drafts[row.indicatorId]?.decision !== ""),
  );
  const revisionRows =
    review?.rows.filter((row) => drafts[row.indicatorId]?.decision === "revisions_required") ?? [];
  const allRevisionRowsHaveNotes = revisionRows.every((row) =>
    Boolean(drafts[row.indicatorId]?.notes.trim()),
  );
  const overallDecision: ReviewRowDecision =
    revisionRows.length > 0 ? "revisions_required" : "approved";
  const canSubmit = Boolean(
    review?.canSubmit &&
    !completed &&
    allRowsDecided &&
    allRevisionRowsHaveNotes &&
    affirmed &&
    (overallDecision === "approved" || gateNotes.trim()),
  );

  async function submit() {
    if (!review || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const result = await submitAssignedReviewAction({
        data: {
          assignmentId,
          decision: overallDecision,
          notes: gateNotes,
          affirmation: affirmed,
          affirmationVersion: review.humanAffirmationVersion,
          affirmationSha256: review.humanAffirmationSha256,
          rows: review.rows.map((row) => ({
            indicatorId: row.indicatorId,
            decision: drafts[row.indicatorId]?.decision || "revisions_required",
            notes: drafts[row.indicatorId]?.notes ?? "",
          })),
        },
      });
      if (!result.ok) setError(result.error.message);
      else await refresh();
    } catch (cause) {
      setError(errorText(cause, "The immutable review decision could not be recorded."));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !review) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Opening the exact assigned Draft package…
      </p>
    );
  }

  if (!review) {
    return (
      <Card className="bg-white p-5">
        <h1 className="text-xl font-semibold">Assigned review unavailable</h1>
        <p className="mt-2 text-sm text-muted">
          Sign in with the registered account named on this assignment. Review links do not grant
          country-workspace access and cannot be transferred between people or packages.
        </p>
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error ?? "This assignment could not be found."}
        </p>
      </Card>
    );
  }

  const gate = review.assignment.gate.toUpperCase();
  return (
    <div className="space-y-5 bg-white">
      <Card className="border border-forest/20 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-sage">
                {gate} · {roleLabel(review.assignment.declaredRole)}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">Human review of a completed Draft DAR</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted">{review.gateMeaning}</p>
            </div>
          </div>
          <Badge tone={completed ? (completed.decision === "approved" ? "ok" : "warn") : "neutral"}>
            {completed
              ? completed.decision === "approved"
                ? "Completed · accepted"
                : "Completed · revisions required"
              : review.canSubmit
                ? "Ready for human review"
                : "Locked"}
          </Badge>
        </div>
        <p className="mt-3 rounded-sm border border-border bg-white p-3 text-sm text-muted">
          This is post-completion control, not a ninth workflow stage. The autonomous workflow has
          already finished. Vendor challenge and machine QC have zero human-approval effect.
        </p>
      </Card>

      <ApprovalPackageIdentity approvalPackage={review.package} lifecycle={review.lifecycle} />
      <OriginalDraftDownloads downloads={review.originalDraftDownloads} />

      <Card className="bg-white p-5">
        <h2 className="text-lg font-semibold">Immutable assignment</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Named reviewer
            </dt>
            <dd>{review.assignment.reviewerName}</dd>
            <dd className="text-muted">{review.assignment.reviewerEmail}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Declared role
            </dt>
            <dd>{roleLabel(review.assignment.declaredRole)}</dd>
            <dd className="text-muted">
              Assigned {new Date(review.assignment.assignedAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Exact scope
            </dt>
            <dd>{review.rows.length} rows</dd>
            <dd className="break-all text-xs text-muted">{review.assignment.scopeSha256}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">
              Assignment ID
            </dt>
            <dd className="break-all text-xs">{review.assignment.id}</dd>
          </div>
        </dl>
      </Card>

      {!review.canSubmit && !completed ? (
        <Card className="border border-amber-300 bg-white p-5">
          <p className="flex items-start gap-2 text-sm text-amber-900">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {review.lockedReason ?? "This gate is not available yet."}
          </p>
          {review.assignment.gate === "g2" ? (
            <p className="mt-2 text-sm text-muted">
              Its frozen scope remains visible: 100% of prerequisite rows, 100% of Judged rows, and
              the deterministic 15% sample of the remaining rows. Submission unlocks only after
              valid accepted G1 on this package.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="bg-white p-5">
        <h2 className="text-lg font-semibold">{gate} row-review checklist</h2>
        <ol className="mt-3 grid gap-2 text-sm text-muted">
          {review.assignment.gate === "g1" ? (
            <>
              <li>
                1. Review every machine-filled row displayed below; omission cannot satisfy G1.
              </li>
              <li>
                2. Inspect the indicator, value, source, year, tier, class, level, and every
                additional machine-filled field bound by the row hash.
              </li>
              <li>3. Confirm the row or require revisions with a specific row note.</li>
            </>
          ) : (
            <>
              <li>
                1. Review independently from G1; the G1 assessor and automated systems cannot
                satisfy this assignment.
              </li>
              <li>
                2. Complete every displayed row in the frozen protocol scope: all prerequisites, all
                Judged rows, and the deterministic 15% remainder sample.
              </li>
              <li>
                3. Re-check that the cited source resolves to the stated evidence and that the
                evidence class was derived correctly.
              </li>
              <li>
                4. Re-check that the ladder level is justified by evidence quality and scale;
                resolve any disagreement by evidence.
              </li>
              <li>5. Confirm the row or require revisions with a specific row note.</li>
            </>
          )}
        </ol>
      </Card>

      <section aria-labelledby="review-rows-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="review-rows-heading" className="text-xl font-semibold">
              Exact scoped rows
            </h2>
            <p className="mt-1 text-sm text-muted">
              {completed
                ? "This completed decision is immutable and read-only."
                : `${Object.values(drafts).filter((item) => item.decision).length} of ${review.rows.length} rows decided.`}
            </p>
          </div>
          <Badge tone="neutral">{review.rows.length} rows</Badge>
        </div>
        <div className="mt-4 space-y-3">
          {review.rows.map((row) => (
            <ReviewRowCard
              key={`${row.indicatorId}:${row.rowSha256}`}
              row={row}
              gate={review.assignment.gate}
              value={drafts[row.indicatorId] ?? { decision: "", notes: "" }}
              readOnly={Boolean(completed) || !review.canSubmit}
              onChange={(next) => setDrafts((current) => ({ ...current, [row.indicatorId]: next }))}
            />
          ))}
        </div>
      </section>

      <Card className="bg-white p-5">
        {completed ? (
          <CompletedReview decision={completed} />
        ) : (
          <>
            <h2 className="text-lg font-semibold">Record the immutable {gate} decision</h2>
            <p className="mt-1 text-sm text-muted">
              The overall decision is derived from the exact row decisions: any revisions-required
              row makes the gate decision revisions required.
            </p>
            <div className="mt-3">
              <Badge tone={overallDecision === "approved" ? "ok" : "warn"}>
                {overallDecision === "approved" ? "Accepted if submitted" : "Revisions required"}
              </Badge>
            </div>
            <Textarea
              className="mt-3 bg-white"
              maxLength={5000}
              value={gateNotes}
              onChange={(event) => setGateNotes(event.target.value)}
              placeholder={
                overallDecision === "revisions_required"
                  ? "Required: summarize the revisions needed"
                  : "Optional gate-level notes"
              }
              disabled={!review.canSubmit}
              aria-label={`${gate} decision notes`}
            />
            <label className="mt-3 flex items-start gap-2 rounded-sm border border-border bg-white p-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={affirmed}
                disabled={!review.canSubmit}
                onChange={(event) => setAffirmed(event.target.checked)}
              />
              {review.humanAffirmation}
            </label>
            <p className="mt-1 break-all font-mono text-[11px] text-subtle">
              {review.humanAffirmationVersion} · SHA-256 {review.humanAffirmationSha256}
            </p>
            <Button
              className="mt-3"
              type="button"
              disabled={!canSubmit || saving}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Record immutable {gate} decision
            </Button>
            {!allRowsDecided ? (
              <p className="mt-2 text-xs text-subtle">
                Every displayed row needs an explicit decision.
              </p>
            ) : !allRevisionRowsHaveNotes ? (
              <p className="mt-2 text-xs text-subtle">
                Every revisions-required row needs a specific note.
              </p>
            ) : !affirmed ? (
              <p className="mt-2 text-xs text-subtle">
                The explicit human and role affirmation is required.
              </p>
            ) : overallDecision === "revisions_required" && !gateNotes.trim() ? (
              <p className="mt-2 text-xs text-subtle">Gate-level revision notes are required.</p>
            ) : null}
          </>
        )}
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function ReviewRowCard({
  row,
  gate,
  value,
  readOnly,
  onChange,
}: {
  row: ApprovalReviewRow;
  gate: "g1" | "g2";
  value: RowDraft;
  readOnly: boolean;
  onChange: (next: RowDraft) => void;
}) {
  const sourceUrlText = payloadField(row, "source_url", "src_url", "url");
  const sourceUrl = safeSourceUrl(sourceUrlText);
  const source = payloadField(row, "source", "src", "source_title");
  const displayedKeys = new Set(["value", "source", "year", "tier", "cls", "level"]);
  const additionalFields = Object.entries(row.payload)
    .filter(([key]) => !displayedKeys.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return (
    <Card className="bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold">Indicator {row.indicatorId}</p>
          {row.indicatorName ? (
            <p className="mt-1 text-sm font-medium text-ink">{row.indicatorName}</p>
          ) : null}
          <p className="mt-1 break-all font-mono text-[11px] text-subtle">
            Row SHA-256 {row.rowSha256}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{row.classification}</Badge>
          {row.prerequisite ? <Badge tone="warn">Prerequisite</Badge> : null}
          {scopedMeaning(row, gate).map((meaning) => (
            <Badge key={meaning} tone="neutral">
              {meaning}
            </Badge>
          ))}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Value</dt>
          <dd className="mt-1 whitespace-pre-wrap text-ink">{payloadField(row, "value")}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Source</dt>
          <dd className="mt-1 whitespace-pre-wrap">{source}</dd>
          {sourceUrl ? (
            <a
              className="mt-1 block break-all text-xs text-sage underline underline-offset-4"
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {sourceUrl}
            </a>
          ) : sourceUrlText !== "—" ? (
            <p className="mt-1 break-all text-xs text-muted">{sourceUrlText}</p>
          ) : null}
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Year</dt>
          <dd className="mt-1">{payloadField(row, "year")}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Source tier</dt>
          <dd className="mt-1">{payloadField(row, "tier", "source_tier")}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Class</dt>
          <dd className="mt-1">{row.classification}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Level</dt>
          <dd className="mt-1">{payloadField(row, "level", "suggested_level")}</dd>
        </div>
      </dl>

      {additionalFields.length ? (
        <div className="mt-4 rounded-sm border border-border bg-white p-3">
          <h3 className="text-sm font-semibold">Additional machine-filled fields</h3>
          <p className="mt-1 text-xs text-muted">
            These fields are also bound by the row SHA-256 and must be visible before approval.
          </p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {additionalFields.map(([key, fieldValue]) => (
              <div key={key} className="min-w-0 border-t border-border pt-2">
                <dt className="break-all font-mono text-xs font-semibold text-subtle">{key}</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap text-ink">
                  {payloadText(fieldValue)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <fieldset className="mt-4 border-t border-border pt-4" disabled={readOnly}>
        <legend className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Human row decision
        </legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`row-${row.indicatorId}`}
              checked={value.decision === "approved"}
              onChange={() => onChange({ ...value, decision: "approved" })}
            />
            Confirmed
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`row-${row.indicatorId}`}
              checked={value.decision === "revisions_required"}
              onChange={() => onChange({ ...value, decision: "revisions_required" })}
            />
            Revisions required
          </label>
        </div>
        <Textarea
          className="mt-3 min-h-20 bg-white"
          maxLength={5000}
          value={value.notes}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
          placeholder={
            value.decision === "revisions_required"
              ? "Required: identify the correction needed for this exact row"
              : "Optional row note"
          }
          aria-label={`Review note for indicator ${row.indicatorId}`}
        />
      </fieldset>
    </Card>
  );
}

function CompletedReview({ decision }: { decision: HumanApprovalDecision }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden="true" />
      <div>
        <h2 className="text-lg font-semibold">Immutable completed decision</h2>
        <p className="mt-1 text-sm text-muted">
          {decision.reviewerName} · {decision.reviewerEmail} · {roleLabel(decision.declaredRole)} ·{" "}
          {new Date(decision.decidedAt).toLocaleString()}
        </p>
        <p className="mt-2 text-sm">
          Outcome: {decision.decision === "approved" ? "Accepted" : "Revisions required"} ·{" "}
          {decision.rowReviews.length} exact row decisions
        </p>
        <p className="mt-1 text-xs text-subtle">
          Human/role affirmation recorded: {decision.reviewerAffirmation ? "yes" : "no"} · decision
          ID {decision.id}
        </p>
        {decision.reviewerAffirmationText ? (
          <div className="mt-3 rounded-md border border-line bg-white p-3 text-xs text-muted">
            <p>{decision.reviewerAffirmationText}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-subtle">
              {decision.reviewerAffirmationVersion} · SHA-256 {decision.reviewerAffirmationSha256}
            </p>
          </div>
        ) : null}
        {decision.notes ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{decision.notes}</p>
        ) : null}
        <p className="mt-3 text-xs font-medium text-subtle">
          Completed identities, roles, rows, notes, hashes, and timestamps are read-only and cannot
          be altered in this screen.
        </p>
      </div>
    </div>
  );
}
