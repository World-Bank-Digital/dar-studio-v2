import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getDarReviewState, recordDarReview } from "@/lib/damm-v17/run-actions";

type ReviewOutcome = "reviewed" | "revisions_required";

interface ReviewState {
  available: boolean;
  target: {
    runId: string;
    artifactSetId: string;
    bundleSha256: string;
    completedAt: string;
    methodologyStatus: "canonical" | "legacy_unverified";
  } | null;
  reviews: Array<{
    id: string;
    runId: string;
    bundleSha256: string;
    outcome: ReviewOutcome;
    notes: string;
    reviewedAt: string;
    methodologyStatus: "canonical" | "legacy_unverified";
  }>;
}

export function DarReviewTab({ countryId }: { countryId: string }) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [outcome, setOutcome] = useState<ReviewOutcome>("reviewed");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await getDarReviewState({ data: { countryId } });
    setState(result as ReviewState);
  }, [countryId]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "The review record could not be read."),
    );
  }, [refresh]);

  async function save() {
    if (!state?.target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordDarReview({
        data: {
          countryId,
          runId: state.target.runId,
          artifactSetId: state.target.artifactSetId,
          bundleSha256: state.target.bundleSha256,
          outcome,
          notes,
        },
      });
      if (!result.ok) setError(result.error);
      else {
        setNotes("");
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Reading post-completion review state…
      </p>
    );
  }

  if (!state.available || !state.target) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Draft DAR review is not available yet</h2>
        <p className="mt-2 text-sm text-muted">
          Review opens only after all eight stages complete and the hash-verified Stage 8 package
          is published. It is never an input or gate during the active workflow.
        </p>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </Card>
    );
  }

  const currentReviews = state.reviews.filter((review) => review.runId === state.target?.runId);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" />
          <div>
            <h2 className="text-sm font-semibold">Review the completed Draft DAR package</h2>
            <p className="mt-1 text-xs text-muted">
              Stage 8 completed {new Date(state.target.completedAt).toLocaleString()}. This review
              is permanently associated with bundle SHA-256 {state.target.bundleSha256.slice(0, 16)}…
            </p>
            {state.target.methodologyStatus === "legacy_unverified" ? (
              <p className="mt-2 text-xs font-medium text-amber-800" role="status">
                Legacy package: this run predates methodology identity recording. Downloads are
                SHA-256 checked and marked LEGACY-UNVERIFIED.
              </p>
            ) : null}
          </div>
        </div>
        <fieldset className="mt-4 flex flex-wrap gap-4 text-sm">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
            Outcome
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={outcome === "reviewed"}
              onChange={() => setOutcome("reviewed")}
            />
            Reviewed as Draft DAR
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={outcome === "revisions_required"}
              onChange={() => setOutcome("revisions_required")}
            />
            Revisions required
          </label>
        </fieldset>
        <Textarea
          className="mt-3"
          maxLength={5000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional review notes"
          aria-label="Draft DAR review notes"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Record review
          </Button>
          <span className="text-xs text-subtle">
            Review is required only before promotion to final/publication, not to generate the draft.
          </span>
        </div>
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Recorded reviews for this package</h2>
        {currentReviews.length ? (
          <ul className="mt-3 space-y-2">
            {currentReviews.map((review) => (
              <li key={review.id} className="rounded-sm border border-ink/10 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {review.outcome === "reviewed" ? "Reviewed as Draft DAR" : "Revisions required"}
                  </span>
                  <span className="text-xs text-subtle">
                    {new Date(review.reviewedAt).toLocaleString()}
                  </span>
                </div>
                {review.methodologyStatus === "legacy_unverified" ? (
                  <p className="mt-1 text-xs font-medium text-amber-800">
                    Legacy methodology identity was not recorded.
                  </p>
                ) : null}
                {review.notes ? <p className="mt-2 whitespace-pre-wrap text-muted">{review.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No review has been recorded for this package.</p>
        )}
      </Card>
    </div>
  );
}
