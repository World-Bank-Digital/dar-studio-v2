#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * in ../migrations to DATABASE_URL. Each file is applied in one transaction and
 * recorded in a `_migrations` table, so it runs once and is safe to re-run.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read .env when the variable is not already in the environment. The dev server reads it,
// so without this the app runs against Neon locally while the migrator quietly skips —
// and the schema the app needs is never applied to the database it is actually using.
// Deploys pass DATABASE_URL in the environment and never reach this.
if (!process.env.DATABASE_URL && !process.env.MIGRATION_DATABASE_URL) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // No .env is the normal case in CI and on a deploy.
  }
}

// Deploys use Neon's direct endpoint for schema ownership while application
// traffic and the worker use the pooled DATABASE_URL.
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  if (process.env.NETLIFY === "true") {
    console.error(
      "[migrate] DATABASE_URL is required on Netlify — refusing a deploy without durable Neon storage.",
    );
    process.exit(1);
  }
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const migrationsDir = join(root, "migrations");

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let migrationLockHeld = false;
  try {
    // Two provider builds can overlap. Serialize the complete read/apply/record
    // pass on one Postgres session; disconnects release this lock automatically.
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      "dar-studio:schema-migrations:v1",
    ]);
    migrationLockHeld = true;
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name),
    );

    let files;
    try {
      files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      console.log("[migrate] no migrations/ directory — nothing to do.");
      return;
    }

    let count = 0;
    for (const name of files) {
      if (applied.has(name)) continue;
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    if (migrationLockHeld) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
          "dar-studio:schema-migrations:v1",
        ]);
      } catch {
        // A dead connection already released its session lock. Preserve the
        // migration error rather than replacing it with an unlock error.
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
