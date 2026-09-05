/**
 * Serving what a pass produced.
 *
 * The roadmap is an HTML document on the worker's disk, and without a way to read it a
 * generation run is a run you can watch finish and never see the result of.
 *
 * Two things this route is careful about. The artifact is addressed by a key from a
 * closed list and the path is built from the run's own basename, so nothing the caller
 * sends becomes part of a filename. A run normally belongs to the caller; the only exception is a
 * registered G1/G2 reviewer assigned to that exact immutable workflow package. Assignment access
 * never extends to the country workspace or to non-workflow artifacts.
 */
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/server";
import type { ApprovalArtifactAccess } from "@/lib/damm-v17/approval-store";
import { ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE } from "@/lib/damm-v17/artifact-delivery-contract";
import { artifactDeliveryGrant } from "@/lib/damm-v17/artifact-delivery";
import {
  getCompletedStageArtifactMetadata,
  resolveCompletedStageArtifactDownload,
} from "@/lib/damm-v17/completed-stage-artifacts.server";
import {
  getPublishedWorkflowArtifactContent,
  getPublishedWorkflowArtifactMetadata,
  getRun,
} from "@/lib/damm-v17/run-store";
import { runPassName } from "@/lib/damm-v17/runs";
import { artifactPath } from "@/lib/damm-v17/worker";
import { artifactsFor } from "@/lib/damm-v17/worker-artifacts";

export const Route = createFileRoute("/api/runs/$runId/artifact")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) return new Response("Sign in first.", { status: 401 });

        const search = new URL(request.url).searchParams;
        const key = search.get("key") ?? "";
        const stageArtifactId = search.get("stageArtifact") ?? "";
        // Historical raw logs may contain provider diagnostics. Keep their bytes immutable
        // and expose only the sanitized event view through the application.
        if (key === "events") return new Response("Not found.", { status: 404 });
        if (key && stageArtifactId) {
          return new Response("Choose one artifact identity.", { status: 400 });
        }
        const ownedRun = await getRun(params.runId, session.user.id);
        let run = ownedRun;
        let artifactOwnerUserId = session.user.id;
        let exactAccess: ApprovalArtifactAccess | null = null;

        // Preserve the existing owner path, including legacy/unverified Draft warnings.
        // Only an otherwise unauthorized caller may enter through an exact G1/G2 assignment.
        if (!ownedRun && session.user.id !== "dev-user") {
          const { getApprovalArtifactAccess } = await import("@/lib/damm-v17/approval-store");
          const access = await getApprovalArtifactAccess(params.runId, key, session.user.id);
          if (!access.ok) return new Response("Not found.", { status: 404 });
          exactAccess = access.value;
          artifactOwnerUserId = access.value.artifactOwnerUserId;
          run = ownedRun ?? (await getRun(params.runId, artifactOwnerUserId));
        }

        // A missing run and an unauthorized run answer identically. Non-workflow
        // artifacts remain strictly owner-only; assignments grant no workspace access.
        if (!run || run.userId !== artifactOwnerUserId || (run.pass !== "workflow" && !ownedRun)) {
          return new Response("Not found.", { status: 404 });
        }

        if (run.pass === "workflow") {
          if (stageArtifactId) {
            // Progressive stage outputs are country-owner working papers. They are not
            // part of the exact Stage 8 package assigned at G1/G2 and therefore never
            // inherit reviewer access.
            if (!ownedRun || exactAccess) return new Response("Not found.", { status: 404 });
            const stored = await getCompletedStageArtifactMetadata(
              run.id,
              stageArtifactId,
              session.user.id,
            );
            if (!stored)
              return new Response("Completed-stage artifact not found.", { status: 404 });
            const safeFilename = stored.filename.replace(/[^A-Za-z0-9._-]/g, "_");
            try {
              const grant = artifactDeliveryGrant({
                runId: stored.runId,
                artifactSetId: stored.stageId,
                key: stored.artifactId,
                sha256: stored.sha256,
                subjectUserId: session.user.id,
                accessAs: "country_owner",
                packageId: null,
                assignmentId: null,
                targetIdentitySha256: null,
                bundleSha256: null,
              });
              if (grant) {
                return new Response(JSON.stringify(grant), {
                  status: 200,
                  headers: {
                    "content-type": `${ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE}; charset=utf-8`,
                    "cache-control": "no-store",
                    "referrer-policy": "no-referrer",
                    "x-content-sha256": stored.sha256,
                    "x-damm-stage-id": stored.stageId,
                  },
                });
              }
            } catch {
              return new Response("Artifact delivery is not configured safely.", { status: 503 });
            }
            const download = await resolveCompletedStageArtifactDownload(
              run.id,
              stageArtifactId,
              session.user.id,
            );
            if (!download) {
              return new Response(
                "The stored completed-stage artifact failed its integrity check.",
                {
                  status: 409,
                },
              );
            }
            const body = new ArrayBuffer(download.content.byteLength);
            new Uint8Array(body).set(download.content);
            return new Response(body, {
              headers: {
                "content-type": download.contentType,
                "content-disposition": `attachment; filename="${safeFilename}"`,
                "cache-control": "no-store",
                "x-content-sha256": download.sha256,
                "x-damm-stage-id": download.stageId,
              },
            });
          }
          const advertised = artifactsFor("workflow").some((artifact) => artifact.key === key);
          const stored = advertised
            ? await getPublishedWorkflowArtifactMetadata(run.id, key, artifactOwnerUserId)
            : null;
          if (!stored) {
            return new Response(
              `The completed Draft workflow has no stored artifact called "${key}".`,
              {
                status: 404,
              },
            );
          }
          if (
            exactAccess &&
            (stored.runId !== exactAccess.runId ||
              stored.artifactSetId !== exactAccess.artifactSetId ||
              stored.key !== exactAccess.artifactKey ||
              stored.sha256 !== exactAccess.artifactSha256 ||
              (stored.key === "bundle" && stored.sha256 !== exactAccess.bundleSha256) ||
              (exactAccess.accessAs === "assigned_reviewer" &&
                (!exactAccess.packageId ||
                  !exactAccess.reviewerAssignmentId ||
                  !exactAccess.targetIdentitySha256)))
          ) {
            return new Response("The assigned package identity does not match this artifact.", {
              status: 409,
            });
          }
          const safeFilename = stored.filename.replace(/[^A-Za-z0-9._-]/g, "_");
          const legacy = stored.methodologyStatus === "legacy_unverified";
          const filename = legacy ? `LEGACY-UNVERIFIED_${safeFilename}` : safeFilename;
          try {
            const accessBinding =
              exactAccess?.accessAs === "assigned_reviewer"
                ? {
                    subjectUserId: session.user.id,
                    accessAs: "assigned_reviewer" as const,
                    packageId: exactAccess.packageId!,
                    assignmentId: exactAccess.reviewerAssignmentId!,
                    targetIdentitySha256: exactAccess.targetIdentitySha256!,
                    bundleSha256: exactAccess.bundleSha256,
                  }
                : {
                    subjectUserId: session.user.id,
                    accessAs: "country_owner" as const,
                    packageId: null,
                    assignmentId: null,
                    targetIdentitySha256: null,
                    bundleSha256: null,
                  };
            const grant = artifactDeliveryGrant({
              runId: stored.runId,
              artifactSetId: stored.artifactSetId,
              key: stored.key,
              sha256: stored.sha256,
              ...accessBinding,
            });
            if (grant) {
              return new Response(JSON.stringify(grant), {
                status: 200,
                headers: {
                  "content-type": `${ARTIFACT_DELIVERY_GRANT_MEDIA_TYPE}; charset=utf-8`,
                  "cache-control": "no-store",
                  "referrer-policy": "no-referrer",
                  "x-content-sha256": stored.sha256,
                },
              });
            }
          } catch {
            return new Response("Artifact delivery is not configured safely.", { status: 503 });
          }

          const content = await getPublishedWorkflowArtifactContent(stored);
          if (!content) {
            return new Response("The stored workflow artifact failed its integrity check.", {
              status: 409,
            });
          }
          const body = new ArrayBuffer(content.byteLength);
          new Uint8Array(body).set(content);
          return new Response(body, {
            headers: {
              "content-type": stored.contentType,
              "content-disposition": `attachment; filename="${filename}"`,
              "cache-control": "no-store",
              "x-content-sha256": stored.sha256,
              "x-damm-methodology-status": stored.methodologyStatus,
              ...(legacy
                ? {
                    warning:
                      '299 DAR-Studio "Legacy artifact: DAMM methodology identity was not recorded"',
                  }
                : {}),
            },
          });
        }

        const found = artifactPath(run, key);
        if (!found) {
          return new Response(
            `The ${runPassName(run.pass)} produces no artifact called "${key}".`,
            { status: 404 },
          );
        }

        try {
          const { readFile } = await import("node:fs/promises");
          const body = await readFile(found.path);
          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": found.artifact.contentType,
              // Shown in the browser rather than downloaded: the roadmap is meant to be
              // read, and a download would put the reading a step further away.
              "content-disposition": `inline; filename="${run.outBasename}${found.artifact.filename}"`,
              "cache-control": "no-store",
            },
          });
        } catch {
          return new Response(
            `${found.artifact.label} is not on disk. The pass may not have reached the ` +
              `point of writing it, or the worker ran in a different pipeline directory.`,
            { status: 404 },
          );
        }
      },
    },
  },
});
