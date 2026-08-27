import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { getBearerToken } from "@/lib/auth/client";
import { fetchWorkflowArtifact } from "@/lib/damm-v17/artifact-download";
import { cn } from "@/lib/utils";

export function ArtifactDownloadButton({
  href,
  children,
  className,
  disabled,
  ...buttonProps
}: {
  href: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const artifact = await fetchWorkflowArtifact(href, {
        bearerToken: getBearerToken(),
        baseOrigin: window.location.origin,
      });
      const objectUrl = URL.createObjectURL(artifact.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = artifact.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The artifact could not be downloaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button
        {...buttonProps}
        type="button"
        className={cn(className, busy && "cursor-wait")}
        disabled={disabled || busy}
        onClick={() => void download()}
      >
        {children}
      </button>
      <span className="sr-only" aria-live="polite">
        {busy ? "Downloading artifact" : (error ?? "")}
      </span>
      {error ? (
        <span className="max-w-xs text-xs text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
