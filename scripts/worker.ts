/**
 * The pipeline worker as its own process (`npm run worker`).
 *
 * The dev server starts a worker for convenience, but that is a dev-server plugin and a
 * production build has no such hook — deployed without this, every run would sit at
 * "queued" with nothing ever coming for it, while the workspace showed a queue that
 * looked alive. This is the other half.
 *
 * It has to run on a machine that has the pipeline repository and its virtualenv, because
 * that is what it spawns. That rules out serverless: a Vercel function cannot host a
 * 25-minute Python process. A small always-on box, or a container with the pipeline baked
 * in, is what this expects.
 *
 * Vendor keys are not this process's business. The pipeline reads its own repo-root .env
 * and the values never enter the app.
 *
 *   DATABASE_URL=…  DAMM_PIPELINE_DIR=~/DAR/Claude/DAMM  npm run worker
 */
import { hostname } from "node:os";

import { dbSource } from "../src/lib/db.ts";
import { pipelineDir, pipelinePython } from "../src/lib/damm-v17/worker.ts";
import { runWorkerLoop } from "../src/lib/damm-v17/worker-loop.ts";

// A standalone worker on the PGLite fallback opens its OWN in-memory database, polls a
// queue nobody writes to, and reports for duty forever. Refused rather than left to look
// healthy: the failure is invisible from both ends.
if (dbSource !== "neon") {
  console.error(
    "[worker] DATABASE_URL is not set.\n" +
      "         Without it this process opens a private in-memory database and would\n" +
      "         poll a queue that nothing writes to. Set DATABASE_URL to the same\n" +
      "         database the app uses, or run the app with `npm run dev`, which starts\n" +
      "         a worker inside the dev server against its own queue.",
  );
  process.exit(1);
}

const workerId = `${hostname()}:${process.pid}`;
console.log(`[worker] ${workerId}`);
console.log(`[worker] pipeline   ${pipelineDir()}`);
console.log(`[worker] interpreter ${pipelinePython()}`);
console.log("[worker] watching the run queue");

const loop = runWorkerLoop({ workerId });

// On a signal, stop claiming and let the run in flight finish. Killing a pipeline
// mid-row throws away the row it was paying for; the checkpoint is only written between
// rows. A worker that never gets to exit is handled by the claim lease, not by force.
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) {
      console.log("\n[worker] second signal — exiting now, the claim lease will free the run");
      process.exit(130);
    }
    stopping = true;
    console.log(`\n[worker] ${sig} — finishing the run in flight, then stopping. Signal again to exit now.`);
    loop.stop();
  });
}

await loop.done;
console.log("[worker] stopped");
