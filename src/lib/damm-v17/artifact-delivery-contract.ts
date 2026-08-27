/** The capability is sent in an authorization header and must never be embedded in this URL. */
export const ARTIFACT_DELIVERY_ENDPOINT_PATH = "/v1/artifacts";
export const ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE =
  "application/vnd.dar-studio.artifact-delivery+json";

export interface ArtifactDeliveryGrant {
  endpoint: string;
  token: string;
  expiresInSeconds: number;
}
