import { useId, useState } from "react";
import { Download } from "lucide-react";
import { ArtifactDownloadButton } from "./ArtifactDownloadButton";
import { downloadSize, type DownloadGroup as Group } from "@/lib/damm-v17/download-catalog";

export function DownloadGroup({ group }: { group: Group }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(group.options[0]?.id);
  const option = group.options.find((item) => item.id === selected) ?? group.options[0];
  if (!option) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-ink/10 bg-surface p-2">
      <div className="min-w-0">
        <p className="text-xs font-medium">{group.title}</p>
        <p className="text-xs text-subtle">
          {option.format}
          {option.byteSize !== undefined ? ` · ${downloadSize(option.byteSize)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {group.options.length > 1 ? (
          <>
            <label htmlFor={id} className="sr-only">
              {group.title} format
            </label>
            <select
              id={id}
              disabled={busy}
              value={option.id}
              onChange={(event) => setSelected(event.target.value)}
              className="max-w-32 rounded-sm border border-border-strong bg-surface px-2 py-1 text-xs"
            >
              {group.options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.format}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <ArtifactDownloadButton
          onBusyChange={setBusy}
          href={option.href}
          aria-label={`Download ${group.title} (${option.format})`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-border-strong px-2 text-xs font-medium hover:bg-moss"
        >
          <Download className="size-3.5" />
          Download
        </ArtifactDownloadButton>
      </div>
    </div>
  );
}
