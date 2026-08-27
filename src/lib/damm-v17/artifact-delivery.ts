import {
  ARTIFACT_DELIVERY_TOKEN_TTL_SECONDS,
  issueArtifactDeliveryToken,
  type ArtifactDeliveryIdentity,
} from "./artifact-delivery-token.ts";
import {
  ARTIFACT_DELIVERY_ENDPOINT_PATH,
  type ArtifactDeliveryGrant,
} from "./artifact-delivery-contract.ts";

type Environment = Record<string, string | undefined>;
const NETLIFY_CONTEXTS = new Set(["production", "deploy-preview", "branch-deploy", "dev"]);

function netlifyRuntime(environment: Environment): boolean {
  return (
    environment.NETLIFY === "true" ||
    Boolean(environment.SITE_ID?.trim()) ||
    NETLIFY_CONTEXTS.has(environment.CONTEXT?.trim() ?? "")
  );
}

export function artifactGatewayOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("ARTIFACT_GATEWAY_URL must be an HTTPS origin with no path.");
  }
  return url.origin;
}

/** Null keeps local/legacy-Vercel byte delivery; Netlify and partial config fail closed. */
export function artifactDeliveryGrant(
  identity: ArtifactDeliveryIdentity,
  environment: Environment = process.env,
): ArtifactDeliveryGrant | null {
  const gateway = environment.ARTIFACT_GATEWAY_URL?.trim();
  const secret = environment.ARTIFACT_DELIVERY_SECRET;
  if (!gateway && !secret) {
    if (netlifyRuntime(environment)) {
      throw new Error("Netlify artifact delivery requires gateway configuration at runtime.");
    }
    return null;
  }
  if (!gateway || !secret) {
    throw new Error("Artifact delivery requires both gateway URL and delivery secret.");
  }
  return {
    endpoint: new URL(ARTIFACT_DELIVERY_ENDPOINT_PATH, artifactGatewayOrigin(gateway)).href,
    token: issueArtifactDeliveryToken(identity, secret),
    expiresInSeconds: ARTIFACT_DELIVERY_TOKEN_TTL_SECONDS,
  };
}
