import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isHostedRuntime, resolveDatabaseConfiguration } from "./db-config.ts";

describe("database deployment configuration", () => {
  it("uses PGLite only when no hosted provider marker is present", () => {
    assert.deepEqual(resolveDatabaseConfiguration({}), { source: "pglite" });
    assert.equal(isHostedRuntime({}), false);
  });

  it("selects Neon whenever a database URL is configured", () => {
    const databaseUrl = "postgresql://example.invalid/dar";
    assert.deepEqual(resolveDatabaseConfiguration({ DATABASE_URL: databaseUrl }), {
      source: "neon",
      databaseUrl,
    });
  });

  for (const marker of ["VERCEL", "NETLIFY", "SITE_ID"] as const) {
    it(`refuses missing or whitespace DATABASE_URL on ${marker}`, () => {
      assert.equal(isHostedRuntime({ [marker]: "true" }), true);
      assert.throws(
        () => resolveDatabaseConfiguration({ [marker]: "true", DATABASE_URL: "   " }),
        /DATABASE_URL is required.*refusing.*PGLite/i,
      );
    });
  }
});
