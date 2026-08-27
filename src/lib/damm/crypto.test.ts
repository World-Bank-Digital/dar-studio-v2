import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret, encryptionAvailable, fingerprintSecret, isEncrypted } from "./crypto.ts";

const SECRET = "a-master-secret-long-enough-for-scrypt";

describe("key encryption with DAR_KEY_SECRET set", () => {
  let previous: string | undefined;

  before(() => {
    previous = process.env.DAR_KEY_SECRET;
    process.env.DAR_KEY_SECRET = SECRET;
  });

  after(() => {
    if (previous === undefined) delete process.env.DAR_KEY_SECRET;
    else process.env.DAR_KEY_SECRET = previous;
  });

  it("reports that encryption is available", () => {
    assert.equal(encryptionAvailable(), true);
  });

  it("round-trips a key", () => {
    const key = "sk-ant-api03-abcdefghijklmnop";
    const blob = encryptSecret(key);
    assert.equal(isEncrypted(blob), true);
    assert.notEqual(blob, key);
    assert.equal(decryptSecret(blob), key);
  });

  it("never leaves the key readable in the stored blob", () => {
    const key = "sk-secret-value-12345";
    assert.equal(encryptSecret(key).includes("secret-value"), false);
  });

  it("produces a different ciphertext each time, so blobs cannot be compared", () => {
    const key = "sk-same-key";
    assert.notEqual(encryptSecret(key), encryptSecret(key));
  });

  it("passes through a legacy plaintext row unchanged", () => {
    assert.equal(decryptSecret("sk-written-before-encryption"), "sk-written-before-encryption");
  });

  it("refuses a tampered blob rather than returning garbage", () => {
    const blob = encryptSecret("sk-original");
    const parts = blob.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    assert.throws(() => decryptSecret(parts.join(":")));
  });

  it("fingerprints the key without exposing it", () => {
    const fp = fingerprintSecret("sk-abcdef");
    assert.equal(fp.includes("abcdef"), false);
    assert.equal(fp, fingerprintSecret("sk-abcdef"));
    assert.notEqual(fp, fingerprintSecret("sk-different"));
  });
});

describe("key storage with no DAR_KEY_SECRET", () => {
  let previous: string | undefined;

  before(() => {
    previous = process.env.DAR_KEY_SECRET;
    delete process.env.DAR_KEY_SECRET;
  });

  after(() => {
    if (previous !== undefined) process.env.DAR_KEY_SECRET = previous;
  });

  it("says so, rather than pretending keys are protected", () => {
    assert.equal(encryptionAvailable(), false);
  });

  it("stores the key as-is and marks it unencrypted so the interface can warn", () => {
    const stored = encryptSecret("sk-plain");
    assert.equal(stored, "sk-plain");
    assert.equal(isEncrypted(stored), false);
  });

  it("refuses a short secret instead of deriving a weak key from it", () => {
    process.env.DAR_KEY_SECRET = "tooshort";
    assert.equal(encryptionAvailable(), false);
    delete process.env.DAR_KEY_SECRET;
  });
});
