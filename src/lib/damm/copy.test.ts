import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The app describes itself as it is — never by contrast with what it used to
 * be. A field guide that says "no longer locks" or an empty-state that brags
 * "no waiting, no gates" is writing release notes into product copy; the
 * reader has no previous version to compare against (user directive,
 * 2026-08-18).
 */
const BANNED = [
  "no longer",
  "no waiting",
  "No waiting",
  "no gates",
  "No gates",
  "used to be",
  "previous version",
  "has been simplified",
  "now appears",
  "folded into",
  "that rule is untouched",
];

const ROOT = join(import.meta.dirname, "..", "..", "..");
const USER_FACING = [
  "docs/TTL-GUIDE.md",
  "src/components/damm/WorkspaceView.tsx",
];

describe("self-contained product copy", () => {
  for (const rel of USER_FACING) {
    it(`${rel} never narrates its own history`, () => {
      const text = readFileSync(join(ROOT, rel), "utf8");
      for (const phrase of BANNED) {
        assert.ok(!text.includes(phrase), `"${phrase}" found in ${rel}`);
      }
    });
  }
});
