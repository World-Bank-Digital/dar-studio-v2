import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_SLOTS,
  documentsForExactWorkflowPackage,
  type WorkflowDocumentPackage,
} from "./worker-artifacts.ts";

const latestPackage: WorkflowDocumentPackage = {
  runId: "run-latest",
  artifactSetId: "set-latest",
  bundleSha256: "a".repeat(64),
  completedAt: "2026-08-27T09:00:00.000Z",
};

describe("the exact Stage 8 Draft document set", () => {
  it("marks one complete package downloadable without losing its identity", () => {
    const result = documentsForExactWorkflowPackage(
      latestPackage,
      new Set(DOCUMENT_SLOTS.map((slot) => slot.artifactKey)),
    );

    assert.equal(result.complete, true);
    assert.deepEqual(result.package, latestPackage);
    assert.ok(result.documents.every((document) => document.runId === latestPackage.runId));
    assert.ok(
      result.documents.every((document) => document.artifactSetId === latestPackage.artifactSetId),
    );
    assert.ok(
      result.documents.every((document) => document.bundleSha256 === latestPackage.bundleSha256),
    );
  });

  it("never fills a missing latest-package artifact from an older complete run", () => {
    const missingKey = "draft-pdf";
    const olderPackageKeys = new Set(DOCUMENT_SLOTS.map((slot) => slot.artifactKey));
    const latestPackageKeys = new Set(
      DOCUMENT_SLOTS.map((slot) => slot.artifactKey).filter((key) => key !== missingKey),
    );

    // The unsafe old implementation effectively used this union and would call it complete.
    assert.ok(DOCUMENT_SLOTS.every((slot) => olderPackageKeys.has(slot.artifactKey)));
    const result = documentsForExactWorkflowPackage(latestPackage, latestPackageKeys);

    assert.equal(result.complete, false);
    const missing = result.documents.find((document) => document.artifactKey === missingKey);
    assert.ok(missing);
    assert.equal(missing.runId, latestPackage.runId);
    assert.equal(missing.artifactSetId, latestPackage.artifactSetId);
    assert.equal(missing.bundleSha256, latestPackage.bundleSha256);
    assert.equal(missing.href, null);
    assert.match(missing.missingBecause ?? "", /selected Stage 8 Draft package/);
    assert.ok(result.documents.every((document) => document.runId !== "run-older"));
  });

  it("does not describe a completed attempt without a verified package as complete", () => {
    const result = documentsForExactWorkflowPackage(null, new Set(), {
      runId: "run-without-package",
      status: "done",
    });

    assert.equal(result.complete, false);
    assert.equal(result.package, null);
    assert.ok(result.documents.every((document) => document.href === null));
    assert.ok(result.documents.every((document) => document.runId === "run-without-package"));
    assert.match(result.documents[0].missingBecause ?? "", /no hash-verified Stage 8 Draft/);
  });
});
