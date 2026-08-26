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
import { getPublishedWorkflowArtifact, getRun } from "@/lib/damm-v17/run-store";
import { runPassName } from "@/lib/damm-v17/runs";
import { artifactPath } from "@/lib/damm-v17/worker";
import { artifactsFor } from "@/lib/damm-v17/worker-artifacts";

export const Route = createFileRoute("/api/runs/$runId/artifact")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) return new Response("Sign in first.", { status: 401 });

        const key = new URL(request.url).searchParams.get("key") ?? "";
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
          const advertised = artifactsFor("workflow").some((artifact) => artifact.key === key);
          const stored = advertised
            ? await getPublishedWorkflowArtifact(run.id, key, artifactOwnerUserId)
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
                (!exactAccess.packageId || !exactAccess.targetIdentitySha256)))
          ) {
            return new Response("The assigned package identity does not match this artifact.", {
              status: 409,
            });
          }
          const { createHash } = await import("node:crypto");
          if (createHash("sha256").update(stored.content).digest("hex") !== stored.sha256) {
            return new Response("The stored workflow artifact failed its integrity check.", {
              status: 409,
            });
          }
          const safeFilename = stored.filename.replace(/[^A-Za-z0-9._-]/g, "_");
          const legacy = stored.methodologyStatus === "legacy_unverified";
          const filename = legacy ? `LEGACY-UNVERIFIED_${safeFilename}` : safeFilename;
          const body = new ArrayBuffer(stored.content.byteLength);
          new Uint8Array(body).set(stored.content);
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
