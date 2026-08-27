import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("the post-completion human-control surface", () => {
  it("keeps exact-package reviewer downloads narrow without changing owner downloads", async () => {
    const route = await source("../../routes/api/runs/$runId.artifact.ts");

    assert.match(route, /const ownedRun = await getRun/);
    assert.match(route, /if \(!ownedRun && session\.user\.id !== "dev-user"\)/);
    assert.match(route, /getApprovalArtifactAccess\(params\.runId, key, session\.user\.id\)/);
    assert.match(route, /run\.pass !== "workflow" && !ownedRun/);
    assert.match(route, /stored\.artifactSetId !== exactAccess\.artifactSetId/);
    assert.match(route, /stored\.sha256 !== exactAccess\.artifactSha256/);
    assert.match(route, /stored\.sha256 !== exactAccess\.bundleSha256/);
    assert.match(route, /!exactAccess\.packageId \|\| !exactAccess\.targetIdentitySha256/);
  });

  it("uses bearer-aware fetch downloads on every Draft artifact surface", async () => {
    const [runs, documents, identity, button] = await Promise.all([
      source("../../components/damm/RunsTab.tsx"),
      source("../../components/damm/DocumentsTab.tsx"),
      source("../../components/damm/ApprovalPackageIdentity.tsx"),
      source("../../components/damm/ArtifactDownloadButton.tsx"),
    ]);
    for (const surface of [runs, documents, identity]) {
      assert.match(surface, /ArtifactDownloadButton/);
      assert.doesNotMatch(surface, /<a[^>]+href=.*artifact/);
    }
    assert.match(button, /getBearerToken\(\)/);
    assert.match(button, /fetchWorkflowArtifact/);
    assert.doesNotMatch(button, /token.*href|href.*token/i);
  });

  it("shows every row field and never imports the node-crypto policy module into UI", async () => {
    const [reviewer, owner, identity] = await Promise.all([
      source("../../components/damm/AssignedReviewPage.tsx"),
      source("../../components/damm/DarReviewTab.tsx"),
      source("../../components/damm/ApprovalPackageIdentity.tsx"),
    ]);

    assert.match(reviewer, /Additional machine-filled fields/);
    assert.match(reviewer, /row\.payload/);
    assert.match(reviewer, /suggested_level/);
    assert.match(reviewer, /indicatorName/);
    assert.match(reviewer, /Every displayed row needs an explicit decision/);
    assert.match(reviewer, /source resolves to the stated evidence/);
    assert.match(reviewer, /evidence quality and scale/);
    assert.match(reviewer, /reviewerAffirmationSha256/);
    assert.match(owner, /G1, G2, and G3 occur after—not as stages/);
    assert.match(owner, /reviewerAffirmationVersion/);
    assert.match(identity, /approved Draft release—not a canonical Final/);
    for (const clientSource of [reviewer, owner, identity]) {
      assert.doesNotMatch(clientSource, /from ["']@\/lib\/damm-v17\/approvals/);
      assert.doesNotMatch(clientSource, /node:crypto/);
    }
  });

  it("keeps reviewer decision data narrow and makes only pending assignments replaceable", async () => {
    const [reviewer, owner, actions] = await Promise.all([
      source("../../components/damm/AssignedReviewPage.tsx"),
      source("../../components/damm/DarReviewTab.tsx"),
      source("./approval-actions.ts"),
    ]);

    assert.match(reviewer, /review\?\.ownDecision/);
    assert.doesNotMatch(reviewer, /priorDecisions/);
    assert.match(owner, /Replace this pending assignment/);
    assert.match(owner, /expectedActiveAssignmentId: assignment\?\.id \?\? null/);
    assert.match(owner, /original assignment.*immutable audit trail/s);
    assert.match(owner, /Immutable reviewer-assignment audit/);
    assert.match(owner, /state\.assignmentSupersessions\.map/);
    assert.match(actions, /Reviewer replacement requires a reason/);
    assert.match(actions, /expectedActiveAssignmentId: data\.expectedActiveAssignmentId/);
  });
});
