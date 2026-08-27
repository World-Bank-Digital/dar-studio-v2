/**
 * Where QA artefacts are written.
 *
 * The capture scripts were written inside the Grok build sandbox and hard-coded
 * `/workspace/screenshots/`, so every one of them crashed on any other machine —
 * including a developer checkout, CI, and the reviewer's laptop. The path is now
 * derived from the repository itself, which resolves to `/workspace` inside the
 * sandbox and to the checkout everywhere else, so the same command works in both.
 *
 * `SCREENSHOT_DIR` overrides it for CI artefact collection.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root: `/workspace` in the build sandbox, the checkout elsewhere. */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory for QA screenshots. Never `/tmp` — artefacts must outlive the run. */
export function screenshotDir() {
  return process.env.SCREENSHOT_DIR ? resolve(process.env.SCREENSHOT_DIR) : join(projectRoot, "screenshots");
}

/** Full path for a named screenshot, creating the directory on first use. */
export function shotPath(name) {
  const dir = screenshotDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, name.endsWith(".png") ? name : `${name}.png`);
}

/**
 * Roots the output-path guard will accept. The guard itself is kept — it stops
 * these scripts writing a rendered page anywhere on disk — only its notion of
 * "inside the project" is made portable.
 */
export const allowedOutputRoots = [projectRoot, ...(existsSync("/workspace") ? ["/workspace"] : [])];
