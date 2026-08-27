/**
 * Keeping a worker running.
 *
 * `drain()` empties the queue once and returns. Something has to call it again, and the
 * policy for when is the whole content of this file:
 *
 *  - **Straight back in after work.** A drain that handled something returns with the
 *    queue possibly non-empty; sleeping then would leave a queued country waiting for no
 *    reason.
 *  - **Wait when idle.** An empty queue polled every second is a database query per second
 *    forever.
 *  - **Back off on failure, and cap it.** If the database is unreachable, a tight retry
 *    loop turns one outage into a second problem. The backoff doubles and stops doubling,
 *    so a worker that has been failing for an hour still recovers within a minute of the
 *    database returning.
 *
 * One loop to a process. Dev HMR re-evaluates modules, and a second loop against the same
 * queue would claim runs from the first — which the lease survives, but which spends the
 * budget of whatever it takes over.
 */
import { drain as realDrain, defaultDeps, type WorkerDeps } from "./worker.ts";

export const IDLE_MS = 5_000;
export const BACKOFF_START_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

/** How long to wait before asking again. Pure, so the policy can be checked directly. */
export function nextDelayMs(
  outcome: { handled: number } | { failed: true },
  lastBackoffMs: number,
): { delayMs: number; backoffMs: number } {
  if ("failed" in outcome) {
    const backoffMs = Math.min(
      lastBackoffMs ? lastBackoffMs * 2 : BACKOFF_START_MS,
      BACKOFF_MAX_MS,
    );
    return { delayMs: backoffMs, backoffMs };
  }
  // A successful pass clears the backoff: the next failure should wait two seconds, not
  // resume the minute it had climbed to before the outage ended.
  return { delayMs: outcome.handled > 0 ? 0 : IDLE_MS, backoffMs: 0 };
}

export interface LoopOptions {
  workerId?: string;
  deps?: WorkerDeps;
  drain?: (workerId: string, deps: WorkerDeps) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  onError?: (err: unknown) => void;
}

export interface LoopHandle {
  stop(): void;
  /** Resolves when the loop has actually stopped — used by tests, not by callers. */
  done: Promise<void>;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function runWorkerLoop(opts: LoopOptions = {}): LoopHandle {
  const workerId = opts.workerId ?? `${process.pid}@${process.env.HOSTNAME ?? "local"}`;
  const deps = opts.deps ?? defaultDeps();
  const drain = opts.drain ?? realDrain;
  const sleep = opts.sleep ?? sleepMs;
  const onError =
    opts.onError ?? ((err: unknown) => console.error("[damm-worker]", err));

  let stopped = false;
  let backoffMs = 0;

  const done = (async () => {
    while (!stopped) {
      let delayMs: number;
      try {
        const handled = await drain(workerId, deps);
        ({ delayMs, backoffMs } = nextDelayMs({ handled }, backoffMs));
      } catch (err) {
        onError(err);
        ({ delayMs, backoffMs } = nextDelayMs({ failed: true }, backoffMs));
      }
      if (stopped) break;
      if (delayMs > 0) await sleep(delayMs);
    }
  })();

  return { stop: () => (stopped = true), done };
}

/**
 * Start the one loop this process gets. Returns null when a loop is already running or
 * when the worker is switched off, so a caller can say which happened.
 */
const globalLoop = globalThis as typeof globalThis & { __dammWorkerLoop__?: LoopHandle };

export function startWorkerOnce(opts: LoopOptions = {}): LoopHandle | null {
  if (process.env.DAMM_WORKER === "off") return null;
  if (globalLoop.__dammWorkerLoop__) return null;
  globalLoop.__dammWorkerLoop__ = runWorkerLoop(opts);
  return globalLoop.__dammWorkerLoop__;
}
