import { createHmac, timingSafeEqual } from "node:crypto";

/** Kept deliberately short because the token is a bearer capability. */
export const ARTIFACT_DELIVERY_TOKEN_TTL_SECONDS = 60;

const TOKEN_VERSION = 2 as const;
const PAYLOAD_FIELDS = [
  "v",
  "runId",
  "artifactSetId",
  "key",
  "sha256",
  "subjectUserId",
  "accessAs",
  "packageId",
  "assignmentId",
  "targetIdentitySha256",
  "bundleSha256",
  "exp",
] as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_TOKEN_CHARACTERS = 2048;

export interface ArtifactDeliveryArtifactIdentity {
  runId: string;
  artifactSetId: string;
  key: string;
  sha256: string;
}

export type ArtifactDeliveryAccessBinding =
  | {
      subjectUserId: string;
      accessAs: "country_owner";
      packageId: null;
      assignmentId: null;
      targetIdentitySha256: null;
      bundleSha256: null;
    }
  | {
      subjectUserId: string;
      accessAs: "assigned_reviewer";
      packageId: string;
      assignmentId: string;
      targetIdentitySha256: string;
      bundleSha256: string;
    };

export type ArtifactDeliveryIdentity = ArtifactDeliveryArtifactIdentity &
  ArtifactDeliveryAccessBinding;

export type ArtifactDeliveryTokenPayload = ArtifactDeliveryIdentity & {
  v: typeof TOKEN_VERSION;
  exp: number;
};

export class ArtifactDeliveryTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactDeliveryTokenError";
  }
}

export function requireArtifactDeliverySecret(
  value = process.env.ARTIFACT_DELIVERY_SECRET,
): string {
  if (typeof value !== "string" || value.length < 32) {
    throw new ArtifactDeliveryTokenError(
      "ARTIFACT_DELIVERY_SECRET must be configured with at least 32 characters.",
    );
  }
  return value;
}

function requireIdentityText(value: unknown, label: string): string {
  const hasControlCharacter =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || hasControlCharacter) {
    throw new ArtifactDeliveryTokenError(`${label} is invalid.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new ArtifactDeliveryTokenError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function requireIdentity(input: {
  runId: unknown;
  artifactSetId: unknown;
  key: unknown;
  sha256: unknown;
  subjectUserId: unknown;
  accessAs: unknown;
  packageId: unknown;
  assignmentId: unknown;
  targetIdentitySha256: unknown;
  bundleSha256: unknown;
}): ArtifactDeliveryIdentity {
  const artifact = {
    runId: requireIdentityText(input.runId, "Run ID"),
    artifactSetId: requireIdentityText(input.artifactSetId, "Artifact-set ID"),
    key: requireIdentityText(input.key, "Artifact key"),
    sha256: requireSha256(input.sha256, "Artifact SHA-256"),
  };
  const subjectUserId = requireIdentityText(input.subjectUserId, "Authenticated subject");
  if (input.accessAs === "country_owner") {
    if (
      input.packageId !== null ||
      input.assignmentId !== null ||
      input.targetIdentitySha256 !== null ||
      input.bundleSha256 !== null
    ) {
      throw new ArtifactDeliveryTokenError("Country-owner access fields are invalid.");
    }
    return {
      ...artifact,
      subjectUserId,
      accessAs: "country_owner",
      packageId: null,
      assignmentId: null,
      targetIdentitySha256: null,
      bundleSha256: null,
    };
  }
  if (input.accessAs !== "assigned_reviewer") {
    throw new ArtifactDeliveryTokenError("Artifact access type is invalid.");
  }
  return {
    ...artifact,
    subjectUserId,
    accessAs: "assigned_reviewer",
    packageId: requireIdentityText(input.packageId, "Approval-package ID"),
    assignmentId: requireIdentityText(input.assignmentId, "Reviewer-assignment ID"),
    targetIdentitySha256: requireSha256(input.targetIdentitySha256, "Approval target SHA-256"),
    bundleSha256: requireSha256(input.bundleSha256, "Bundle SHA-256"),
  };
}

function epochSeconds(now: Date): number {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token time is invalid.");
  }
  return Math.floor(milliseconds / 1000);
}

function canonicalPayload(payload: ArtifactDeliveryTokenPayload): string {
  return JSON.stringify({
    v: payload.v,
    runId: payload.runId,
    artifactSetId: payload.artifactSetId,
    key: payload.key,
    sha256: payload.sha256,
    subjectUserId: payload.subjectUserId,
    accessAs: payload.accessAs,
    packageId: payload.packageId,
    assignmentId: payload.assignmentId,
    targetIdentitySha256: payload.targetIdentitySha256,
    bundleSha256: payload.bundleSha256,
    exp: payload.exp,
  });
}

function encodePayload(payload: ArtifactDeliveryTokenPayload): string {
  return Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
}

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload, "ascii").digest();
}

export function issueArtifactDeliveryToken(
  input: ArtifactDeliveryIdentity,
  secretValue?: string,
  options: { now?: Date } = {},
): string {
  const secret = requireArtifactDeliverySecret(secretValue);
  const identity = requireIdentity(input);
  const payload: ArtifactDeliveryTokenPayload = {
    v: TOKEN_VERSION,
    ...identity,
    exp: epochSeconds(options.now ?? new Date()) + ARTIFACT_DELIVERY_TOKEN_TTL_SECONDS,
  };
  const encoded = encodePayload(payload);
  const token = `${encoded}.${sign(encoded, secret).toString("base64url")}`;
  if (token.length > MAX_TOKEN_CHARACTERS) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token is too large.");
  }
  return token;
}

function decodeCanonicalBase64Url(value: string, label: string): Buffer {
  if (!BASE64URL.test(value)) {
    throw new ArtifactDeliveryTokenError(`Artifact delivery token ${label} has invalid format.`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new ArtifactDeliveryTokenError(`Artifact delivery token ${label} is not canonical.`);
  }
  return decoded;
}

function parsePayload(encoded: string): ArtifactDeliveryTokenPayload {
  const bytes = decodeCanonicalBase64Url(encoded, "payload");
  let candidate: unknown;
  try {
    candidate = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ArtifactDeliveryTokenError("Artifact delivery token payload is not valid JSON.");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token payload fields are invalid.");
  }
  const record = candidate as Record<string, unknown>;
  const fields = Object.keys(record);
  if (
    fields.length !== PAYLOAD_FIELDS.length ||
    !PAYLOAD_FIELDS.every((field) => field in record)
  ) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token payload fields are invalid.");
  }
  if (record.v !== TOKEN_VERSION) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token version is unsupported.");
  }
  if (!Number.isSafeInteger(record.exp) || (record.exp as number) < 1) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token expiry is invalid.");
  }
  const identity = requireIdentity({
    runId: record.runId as string,
    artifactSetId: record.artifactSetId as string,
    key: record.key as string,
    sha256: record.sha256 as string,
    subjectUserId: record.subjectUserId as string,
    accessAs: record.accessAs,
    packageId: record.packageId,
    assignmentId: record.assignmentId,
    targetIdentitySha256: record.targetIdentitySha256,
    bundleSha256: record.bundleSha256,
  });
  const payload: ArtifactDeliveryTokenPayload = {
    v: TOKEN_VERSION,
    ...identity,
    exp: record.exp as number,
  };
  if (encodePayload(payload) !== encoded) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token payload is not canonical.");
  }
  return payload;
}

export function verifyArtifactDeliveryToken(
  token: string,
  secretValue?: string,
  now = new Date(),
): ArtifactDeliveryTokenPayload {
  const secret = requireArtifactDeliverySecret(secretValue);
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARACTERS) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token format is invalid.");
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token format is invalid.");
  }
  const [encoded, signatureText] = parts;
  const supplied = decodeCanonicalBase64Url(signatureText, "signature");
  const expected = sign(encoded, secret);
  const comparable = supplied.length === expected.length ? supplied : Buffer.alloc(expected.length);
  const signatureMatches = timingSafeEqual(comparable, expected);
  if (supplied.length !== expected.length || !signatureMatches) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token signature is invalid.");
  }
  const payload = parsePayload(encoded);
  if (payload.exp <= epochSeconds(now)) {
    throw new ArtifactDeliveryTokenError("Artifact delivery token has expired.");
  }
  return payload;
}
