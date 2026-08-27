export interface WorkflowArtifactDownload {
  blob: Blob;
  filename: string;
}

export interface WorkflowArtifactFetchOptions {
  bearerToken: string | null;
  /** Browser origin; explicit in tests so bearer safety is deterministic. */
  baseOrigin: string;
  fetcher?: typeof fetch;
}

function safeFilename(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? "";
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || "workflow-artifact";
}

export function artifactFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "workflow-artifact";
  const encoded = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded.trim().replace(/^"|"$/g, "")));
    } catch {
      // Fall through to the conservative plain-filename parser.
    }
  }
  const plain = contentDisposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;\s]*))/i);
  return safeFilename((plain?.[1] ?? plain?.[2] ?? "").trim());
}

/** Fetch one same-origin artifact with cookie auth and the live-preview bearer fallback. */
export async function fetchWorkflowArtifact(
  href: string,
  options: WorkflowArtifactFetchOptions,
): Promise<WorkflowArtifactDownload> {
  const base = new URL(options.baseOrigin);
  const target = new URL(href, base);
  if (target.origin !== base.origin) {
    throw new Error("Workflow artifacts may only be downloaded from this app.");
  }
  const headers = new Headers();
  if (options.bearerToken) headers.set("Authorization", `Bearer ${options.bearerToken}`);
  const response = await (options.fetcher ?? fetch)(`${target.pathname}${target.search}`, {
    method: "GET",
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Artifact download failed (${response.status}).`);
  }
  return {
    blob: await response.blob(),
    filename: artifactFilename(response.headers.get("content-disposition")),
  };
}
