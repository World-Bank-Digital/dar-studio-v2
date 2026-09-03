import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { validateNetlifyEnvironment } from "./deploy-preflight.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function validEnvironment() {
  return {
    NETLIFY: "true",
    CONTEXT: "production",
    BRANCH: "main",
    EXPECTED_DEPLOY_GIT_SHA: "a".repeat(40),
    COMMIT_REF: "a".repeat(40),
    DATABASE_URL:
      "postgresql://role:secret@ep-dar-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    MIGRATION_DATABASE_URL:
      "postgresql://role:secret@ep-dar.us-east-2.aws.neon.tech/neondb?sslmode=require",
    DAR_KEY_SECRET: "d".repeat(32),
    BETTER_AUTH_URL: "https://dar-staging.netlify.app",
    BETTER_AUTH_SECRET: "b".repeat(32),
    VITE_PUBLIC_HOSTNAME: "dar-staging.netlify.app",
    ARTIFACT_GATEWAY_URL: "https://dar-artifacts.onrender.com",
    ARTIFACT_DELIVERY_SECRET: "a".repeat(32),
    VITE_AUTH_ENABLED: "true",
    VITE_GROK_AUTH_ENABLED: "false",
  };
}

test("a complete email/password-only Netlify environment passes", () => {
  assert.deepEqual(validateNetlifyEnvironment(validEnvironment()), []);
});

test("social auth is all-or-nothing and never falls back to preview credentials", () => {
  const incomplete = { ...validEnvironment(), VITE_GROK_AUTH_ENABLED: "true" };
  assert.match(validateNetlifyEnvironment(incomplete).join("\n"), /GROK_AUTH_CLIENT_ID/);
  const complete = {
    ...incomplete,
    GROK_AUTH_CLIENT_ID: "client",
    GROK_AUTH_CLIENT_SECRET: "secret",
    GROK_AUTH_ISSUER: "https://auth.example.invalid",
  };
  assert.deepEqual(validateNetlifyEnvironment(complete), []);
});

test("Netlify refuses previews, branch deploys, and non-main production builds", () => {
  for (const context of ["deploy-preview", "branch-deploy", "dev", undefined]) {
    const failures = validateNetlifyEnvironment({ ...validEnvironment(), CONTEXT: context });
    assert.match(failures.join("\n"), /CONTEXT must be production/);
  }

  for (const branch of ["feature/deployment-test", undefined]) {
    const failures = validateNetlifyEnvironment({ ...validEnvironment(), BRANCH: branch });
    assert.match(failures.join("\n"), /BRANCH must be main/);
  }
});

test("Netlify refuses to build a commit other than the reviewed release identity", () => {
  const reviewed = "a".repeat(40);
  const exact = {
    ...validEnvironment(),
    EXPECTED_DEPLOY_GIT_SHA: reviewed,
    COMMIT_REF: reviewed,
  };
  assert.deepEqual(validateNetlifyEnvironment(exact), []);

  for (const environment of [
    { ...exact, EXPECTED_DEPLOY_GIT_SHA: undefined },
    { ...exact, COMMIT_REF: undefined },
    { ...exact, COMMIT_REF: "b".repeat(40) },
    { ...exact, EXPECTED_DEPLOY_GIT_SHA: "main" },
  ]) {
    assert.match(
      validateNetlifyEnvironment(environment).join("\n"),
      /EXPECTED_DEPLOY_GIT_SHA.*COMMIT_REF/,
    );
  }
});

test("database endpoints are distinct pooled/direct Neon connections in Ohio", () => {
  const wrongRegion = {
    ...validEnvironment(),
    DATABASE_URL:
      "postgresql://role:secret@ep-dar-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
  };
  assert.match(validateNetlifyEnvironment(wrongRegion).join("\n"), /pooled Ohio/);

  const pooledMigration = {
    ...validEnvironment(),
    MIGRATION_DATABASE_URL:
      "postgresql://role:secret@ep-dar-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  };
  assert.match(validateNetlifyEnvironment(pooledMigration).join("\n"), /direct Ohio/);
});

test("pooled runtime and direct migration URLs identify the same Neon database and role", () => {
  for (const [field, migrationDatabaseUrl] of [
    [
      "endpoint",
      "postgresql://role:secret@ep-other.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ],
    ["database", "postgresql://role:secret@ep-dar.us-east-2.aws.neon.tech/other?sslmode=require"],
    ["role", "postgresql://other:secret@ep-dar.us-east-2.aws.neon.tech/neondb?sslmode=require"],
  ]) {
    const failures = validateNetlifyEnvironment({
      ...validEnvironment(),
      MIGRATION_DATABASE_URL: migrationDatabaseUrl,
    });
    assert.match(
      failures.join("\n"),
      /same Neon endpoint, database, and role/,
      `${field} mismatch must fail closed`,
    );
  }
});

test("cluster-qualified Neon Ohio URLs identify the same pooled and direct endpoint", () => {
  const environment = {
    ...validEnvironment(),
    DATABASE_URL:
      "postgresql://role:secret@ep-dar-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    MIGRATION_DATABASE_URL:
      "postgresql://role:secret@ep-dar.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  };

  assert.deepEqual(validateNetlifyEnvironment(environment), []);

  const wrongCluster = {
    ...environment,
    MIGRATION_DATABASE_URL:
      "postgresql://role:secret@ep-dar.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  };
  assert.match(validateNetlifyEnvironment(wrongCluster).join("\n"), /same Neon endpoint/);
});

test("the public hostname must be bare and match the Better Auth origin", () => {
  const mismatch = { ...validEnvironment(), VITE_PUBLIC_HOSTNAME: "other.netlify.app" };
  assert.match(validateNetlifyEnvironment(mismatch).join("\n"), /must match BETTER_AUTH_URL/);
  const urlInsteadOfHost = {
    ...validEnvironment(),
    VITE_PUBLIC_HOSTNAME: "https://dar-staging.netlify.app",
  };
  assert.match(validateNetlifyEnvironment(urlInsteadOfHost).join("\n"), /bare public hostname/);
});

test("invalid deployment diagnostics never contain secret values", () => {
  const marker = "NEVER-PRINT-THIS-SECRET";
  const failures = validateNetlifyEnvironment({
    NETLIFY: "true",
    DATABASE_URL: marker,
    DAR_KEY_SECRET: marker,
    BETTER_AUTH_SECRET: marker,
    BETTER_AUTH_URL: marker,
    ARTIFACT_GATEWAY_URL: marker,
    ARTIFACT_DELIVERY_SECRET: marker,
  });
  assert.ok(failures.length > 0);
  assert.doesNotMatch(failures.join("\n"), new RegExp(marker));
});

test("the migrator refuses a Netlify build without Neon but keeps local skip behavior", () => {
  const baseEnvironment = { ...process.env };
  delete baseEnvironment.DATABASE_URL;
  delete baseEnvironment.MIGRATION_DATABASE_URL;
  const netlify = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: root,
    env: { ...baseEnvironment, NETLIFY: "true" },
    encoding: "utf8",
  });
  assert.equal(netlify.status, 1);
  assert.match(netlify.stderr, /DATABASE_URL is required on Netlify/);

  const localEnvironment = { ...baseEnvironment };
  delete localEnvironment.NETLIFY;
  const local = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: root,
    env: localEnvironment,
    encoding: "utf8",
  });
  assert.equal(local.status, 0);
  assert.match(local.stdout, /DATABASE_URL not set.*skipping/);
});
