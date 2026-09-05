import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DownloadGroup } from "./DownloadGroup";
import { countryDocuments, type DocumentState } from "@/lib/damm-v17/run-actions";
import { finalDownloads, downloadFormat } from "@/lib/damm-v17/download-catalog";

export function DocumentsTab({ countryId }: { countryId: string }) {
  const [docs, setDocs] = useState<DocumentState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<{ key: string; byteSize?: number }[]>([]);
  const [complete, setComplete] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await countryDocuments({ data: { countryId } });
      setDocs(result.documents);
      setComplete(result.complete);
      setDownloads(result.downloads);
      setError(null);
    } catch {
      setError("Could not load the documents. Please refresh and try again.");
    }
  }, [countryId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <p role="alert" className="text-sm text-red-700">
        {error}
      </p>
    );
  if (!docs)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" />
        Loading documents…
      </p>
    );
  const available = docs.filter((d) => d.href);
  const runId = available[0]?.runId;
  const groups = runId ? finalDownloads(runId, downloads) : [];
  const supporting = available.filter((d) => ["dar-data-json", "manifest"].includes(d.artifactKey));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Draft DAR downloads</h2>
        <p className="mt-2 text-xs text-muted">
          {complete
            ? "Complete package · Draft, awaiting review."
            : "The final package is not yet complete. Completed working papers remain available in the Workflow tab."}
        </p>
        <p className="mt-1 text-xs text-subtle">
          All files shown here belong to one immutable package.
        </p>
      </Card>
      {groups.map((group) => (
        <DownloadGroup key={group.id} group={group} />
      ))}
      {!groups.length ? (
        <p className="text-sm text-muted">Final downloads become available after Stage 8.</p>
      ) : null}
      {supporting.length ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            Supporting data and provenance
          </summary>
          <div className="mt-2 space-y-2">
            {supporting.map((d) => (
              <DownloadGroup
                key={d.key}
                group={{
                  id: d.key,
                  title: d.title,
                  options: [
                    {
                      id: d.key,
                      href: d.href!,
                      format: downloadFormat("json"),
                      byteSize: d.byteSize,
                    },
                  ],
                }}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
