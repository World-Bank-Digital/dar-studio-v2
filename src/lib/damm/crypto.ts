import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for stored provider API keys.
 *
 * Keys are the user's own credentials and must not be readable from a database
 * dump. Ciphertext is AES-256-GCM and self-describing:
 *
 *   v1:<base64 iv>:<base64 auth tag>:<base64 ciphertext>
 *
 * The master secret comes from `DAR_KEY_SECRET`. When it is absent — a fresh
 * local checkout with no env — we fall back to storing the raw key and say so
 * loudly via `encryptionAvailable()`, which the Settings page surfaces. A silent
 * fallback would be worse than no encryption at all: the operator would believe
 * keys were protected when they were not.
 */

const PREFIX = "v1";
const SALT = "dar-studio-v2/api-keys";

function masterKey(): Buffer | null {
  const secret = process.env.DAR_KEY_SECRET;
  if (!secret || secret.trim().length < 16) return null;
  return scryptSync(secret.trim(), SALT, 32);
}

/** True when `DAR_KEY_SECRET` is set well enough to encrypt with. */
export function encryptionAvailable(): boolean {
  return masterKey() !== null;
}

/** True when `value` is a ciphertext blob this module produced. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

/**
 * Encrypt a secret for storage. Returns the plaintext unchanged when no master
 * secret is configured, so local development keeps working; callers must check
 * `encryptionAvailable()` if they need to warn.
 */
export function encryptSecret(plain: string): string {
  const key = masterKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/**
 * Decrypt a stored secret. Rows written before encryption was enabled are
 * plaintext and pass through untouched, so enabling `DAR_KEY_SECRET` never
 * orphans an existing key — the next save re-writes it encrypted.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const key = masterKey();
  if (!key) throw new Error("Stored key is encrypted but DAR_KEY_SECRET is not set in this environment.");
  const [, ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Stored key is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Non-reversible display fingerprint. Never derived from the ciphertext. */
export function fingerprintSecret(plain: string): string {
  const h = scryptSync(plain, `${SALT}/fingerprint`, 8);
  return h.toString("hex");
}

/** Constant-time compare, for tests and any future key-rotation check. */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
