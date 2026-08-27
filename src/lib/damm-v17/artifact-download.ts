import {
  ARTIFACT_DELIVERY_ENDPOINT_PATH,
  ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE,
  type ArtifactDeliveryGrant,
} from "./artifact-delivery-contract.ts";

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

function deliveryGrant(response: Response): Promise<ArtifactDeliveryGrant | null> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE) return Promise.resolve(null);
  return response.json().then((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Artifact delivery returned an invalid authorization grant.");
    }
    const candidate = value as Record<string, unknown>;
    const fields = Object.keys(candidate);
    if (
      fields.length !== 3 ||
      !["endpoint", "token", "expiresInSeconds"].every((field) => field in candidate) ||
      typeof candidate.endpoint !== "string" ||
      typeof candidate.token !== "string" ||
      candidate.token.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(candidate.token) ||
      !Number.isSafeInteger(candidate.expiresInSeconds) ||
      (candidate.expiresInSeconds as number) < 1 ||
      (candidate.expiresInSeconds as number) > 60
    ) {
      throw new Error("Artifact delivery returned an invalid authorization grant.");
    }
    let endpoint: URL;
    try {
      endpoint = new URL(candidate.endpoint);
    } catch {
      throw new Error("Artifact delivery returned an invalid gateway endpoint.");
    }
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== ARTIFACT_DELIVERY_ENDPOINT_PATH ||
      endpoint.search ||
      endpoint.hash ||
      candidate.endpoint.includes(candidate.token)
    ) {
      throw new Error("Artifact delivery returned an invalid gateway endpoint.");
    }
    return {
      endpoint: endpoint.href,
      token: candidate.token,
      expiresInSeconds: candidate.expiresInSeconds as number,
    };
  });
}

async function artifactFromResponse(response: Response): Promise<WorkflowArtifactDownload> {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Artifact download failed (${response.status}).`);
  }
  return {
    blob: await response.blob(),
    filename: artifactFilename(response.headers.get("content-disposition")),
  };
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
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) return artifactFromResponse(response);

  const grant = await deliveryGrant(response);
  if (!grant) return artifactFromResponse(response);

  const gatewayHeaders = new Headers({ Authorization: `Bearer ${grant.token}` });
  const gatewayResponse = await (options.fetcher ?? fetch)(grant.endpoint, {
    method: "GET",
    credentials: "omit",
    mode: "cors",
    headers: gatewayHeaders,
    redirect: "error",
    cache: "no-store",
  });
  if (grant.endpoint.includes(grant.token)) {
    throw new Error("Artifact delivery refused a capability-bearing URL.");
  }
  return artifactFromResponse(gatewayResponse);
}
