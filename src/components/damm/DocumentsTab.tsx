/**
 * The document set a country's assessment produces.
 *
 * A1 says review happens once, at the end, on the completed set — not one artifact at a
 * time. So this names the whole set, including the parts that do not exist yet. Listing
 * only what has been produced would make a set of one look finished, and would leave a
 * reader to infer from an absence that nothing was meant to be there.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { countryDocuments, type DocumentState } from "@/lib/damm-v17/run-actions";
import { CheckCircle2, CircleDashed, ExternalLink, Loader2 } from "lucide-react";

export function DocumentsTab({ countryId }: { countryId: string }) {
  const [docs, setDocs] = useState<DocumentState[] | null>(null);
  const [status, setStatus] = useState("");
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await countryDocuments({ data: { countryId } });
      setDocs(res.documents);
      setStatus(res.status);
      setComplete(res.complete);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the document set.");
    }
  }, [countryId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!docs)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Reading the document set…
      </p>
    );

  const ready = docs.filter((d) => d.href).length;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-sm font-semibold">
          {ready} of {docs.length} documents produced
        </h2>
        <p className="mt-2 text-xs text-muted">{status}</p>
        {!complete && (
          <p className="mt-2 text-xs text-muted">
            The set is not complete, so it is not ready for that review. Each document
            below says what would produce it.
          </p>
        )}
      </Card>

      {docs.map((d) => (
        <Card key={d.key} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {d.href ? (
                  <CheckCircle2 className="size-4 shrink-0 text-forest" />
                ) : (
                  <CircleDashed className="size-4 shrink-0 text-subtle" />
                )}
                <span className="text-sm font-semibold">{d.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{d.what}</p>
              <p className="mt-1 text-xs text-subtle">
                {d.producedAt
                  ? `Produced ${new Date(d.producedAt).toLocaleString()} by the ${d.pass} pass.`
                  : d.missingBecause}
              </p>
            </div>
            {d.href ? (
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm",
                  "border border-border-strong bg-surface px-3 text-xs font-medium",
                  "text-ink hover:bg-moss",
                )}
              >
                <ExternalLink className="size-3.5" />
                Open
              </a>
            ) : (
              <span className="shrink-0 text-xs text-subtle">Not produced</span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
