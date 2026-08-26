/**
 * Serving what a pass produced.
 *
 * The roadmap is an HTML document on the worker's disk, and without a way to read it a
 * generation run is a run you can watch finish and never see the result of.
 *
 * Two things this route is careful about. The artifact is addressed by a key from a
 * closed list and the path is built from the run's own basename, so nothing the caller
 * sends becomes part of a filename. And the run must belong to the caller — a run id is
 * guessable enough that ownership has to be checked rather than assumed.
 */
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/server";
import { getPublishedWorkflowArtifact, getRun } from "@/lib/damm-v17/run-store";
import { artifactPath } from "@/lib/damm-v17/worker";
import { artifactsFor } from "@/lib/damm-v17/worker-artifacts";

export const Route = createFileRoute("/api/runs/$runId/artifact")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user?.id) return new Response("Sign in first.", { status: 401 });

        const run = await getRun(params.runId, session.user.id);
        // A run that is not yours and a run that does not exist answer the same way.
        if (!run || run.userId !== session.user.id) {
          return new Response("Not found.", { status: 404 });
        }

        const key = new URL(request.url).searchParams.get("key") ?? "";
        if (run.pass === "workflow") {
          const advertised = artifactsFor("workflow").some((artifact) => artifact.key === key);
          const stored = advertised
            ? await getPublishedWorkflowArtifact(run.id, key, session.user.id)
            : null;
          if (!stored) {
            return new Response(
              `The completed workflow has no verified artifact called "${key}".`,
              {
                status: 404,
              },
            );
          }
          const { createHash } = await import("node:crypto");
          if (createHash("sha256").update(stored.content).digest("hex") !== stored.sha256) {
            return new Response("The stored workflow artifact failed its integrity check.", {
              status: 409,
            });
          }
          const filename = stored.filename.replace(/[^A-Za-z0-9._-]/g, "_");
          const body = new ArrayBuffer(stored.content.byteLength);
          new Uint8Array(body).set(stored.content);
          return new Response(body, {
            headers: {
              "content-type": stored.contentType,
              "content-disposition": `attachment; filename="${filename}"`,
              "cache-control": "no-store",
              "x-content-sha256": stored.sha256,
            },
          });
        }

        const found = artifactPath(run, key);
        if (!found) {
          return new Response(`The ${run.pass} pass produces no artifact called "${key}".`, {
            status: 404,
          });
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
