#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  sameNeonDatabaseIdentity,
  validAbsoluteHttpsUrl,
  validNeonOhioConnection,
} from "./deployment-url-policy.mjs";

function text(environment, name) {
  const value = environment[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function publicHostname(value) {
  if (!value || value.includes(":") || value.includes("/") || value.includes("@")) return null;
  try {
    const url = new URL(`https://${value}`);
    return url.hostname === value.toLowerCase() ? url.hostname : null;
  } catch {
    return null;
  }
}

/** Return variable-name-only failures; secret values are never copied into diagnostics. */
export function validateNetlifyEnvironment(environment = process.env) {
  if (environment.NETLIFY !== "true") return [];

  const failures = [];
  const databaseUrl = text(environment, "DATABASE_URL");
  const migrationDatabaseUrl = text(environment, "MIGRATION_DATABASE_URL");
  const darKeySecret = text(environment, "DAR_KEY_SECRET");
  const authUrl = text(environment, "BETTER_AUTH_URL");
  const authSecret = text(environment, "BETTER_AUTH_SECRET");
  const publicHost = text(environment, "VITE_PUBLIC_HOSTNAME");
  const socialEnabled = text(environment, "VITE_GROK_AUTH_ENABLED");
  const artifactGatewayUrl = text(environment, "ARTIFACT_GATEWAY_URL");
  const artifactDeliverySecret = text(environment, "ARTIFACT_DELIVERY_SECRET");
  const expectedDeployGitSha = text(environment, "EXPECTED_DEPLOY_GIT_SHA");
  const commitRef = text(environment, "COMMIT_REF");

  if (text(environment, "CONTEXT") !== "production") {
    failures.push("CONTEXT must be production; Deploy Previews and branch deploys are forbidden");
  }
  if (text(environment, "BRANCH") !== "main") {
    failures.push("BRANCH must be main for the staging production deployment");
  }
  if (
    !expectedDeployGitSha ||
    !commitRef ||
    !/^[0-9a-f]{40}$/.test(expectedDeployGitSha) ||
    !/^[0-9a-f]{40}$/.test(commitRef) ||
    expectedDeployGitSha !== commitRef
  ) {
    failures.push(
      "EXPECTED_DEPLOY_GIT_SHA must be one full Git SHA and exactly match Netlify COMMIT_REF",
    );
  }

  if (!databaseUrl || !validNeonOhioConnection(databaseUrl, true)) {
    failures.push("DATABASE_URL must be Neon's pooled Ohio URL with sslmode=require");
  }
  if (!migrationDatabaseUrl || !validNeonOhioConnection(migrationDatabaseUrl, false)) {
    failures.push("MIGRATION_DATABASE_URL must be Neon's direct Ohio URL with sslmode=require");
  }
  if (
    databaseUrl &&
    migrationDatabaseUrl &&
    validNeonOhioConnection(databaseUrl, true) &&
    validNeonOhioConnection(migrationDatabaseUrl, false) &&
    !sameNeonDatabaseIdentity(databaseUrl, migrationDatabaseUrl)
  ) {
    failures.push(
      "DATABASE_URL and MIGRATION_DATABASE_URL must identify the same Neon endpoint, database, and role",
    );
  }
  if (!darKeySecret || darKeySecret.length < 32) {
    failures.push("DAR_KEY_SECRET must contain at least 32 characters");
  }
  if (!authUrl || !validAbsoluteHttpsUrl(authUrl)) {
    failures.push("BETTER_AUTH_URL must be the exact public HTTPS origin with no path");
  }
  const normalizedPublicHost = publicHostname(publicHost);
  if (!normalizedPublicHost) {
    failures.push("VITE_PUBLIC_HOSTNAME must be a bare public hostname");
  } else if (
    authUrl &&
    validAbsoluteHttpsUrl(authUrl) &&
    new URL(authUrl).hostname !== normalizedPublicHost
  ) {
    failures.push("VITE_PUBLIC_HOSTNAME must match BETTER_AUTH_URL");
  }
  if (!authSecret || authSecret.length < 32) {
    failures.push("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  if (!artifactGatewayUrl || !validAbsoluteHttpsUrl(artifactGatewayUrl)) {
    failures.push("ARTIFACT_GATEWAY_URL must be the Render gateway HTTPS origin");
  }
  if (!artifactDeliverySecret || artifactDeliverySecret.length < 32) {
    failures.push("ARTIFACT_DELIVERY_SECRET must contain at least 32 characters");
  }
  if (text(environment, "VITE_AUTH_ENABLED") !== "true") {
    failures.push("VITE_AUTH_ENABLED must be explicitly set to true");
  }
  if (socialEnabled !== "true" && socialEnabled !== "false") {
    failures.push("VITE_GROK_AUTH_ENABLED must be explicitly set to true or false");
  }

  const brokerNames = ["GROK_AUTH_CLIENT_ID", "GROK_AUTH_CLIENT_SECRET", "GROK_AUTH_ISSUER"];
  const brokerPresent = brokerNames.filter((name) => Boolean(text(environment, name)));
  if (socialEnabled === "true" && brokerPresent.length !== brokerNames.length) {
    failures.push(
      "GROK_AUTH_CLIENT_ID, GROK_AUTH_CLIENT_SECRET, and GROK_AUTH_ISSUER are all required when social auth is enabled",
    );
  }
  if (
    socialEnabled === "true" &&
    text(environment, "GROK_AUTH_ISSUER") &&
    !validAbsoluteHttpsUrl(text(environment, "GROK_AUTH_ISSUER"))
  ) {
    failures.push("GROK_AUTH_ISSUER must be an HTTPS origin with no path");
  }
  if (socialEnabled === "false" && brokerPresent.length > 0) {
    failures.push("remove GROK_AUTH_* values or set VITE_GROK_AUTH_ENABLED=true");
  }

  return failures;
}

export function runDeployPreflight(environment = process.env) {
  const failures = validateNetlifyEnvironment(environment);
  if (environment.NETLIFY !== "true") {
    console.log("[deploy-preflight] non-Netlify build — provider checks skipped.");
    return 0;
  }
  if (failures.length === 0) {
    console.log("[deploy-preflight] Netlify deployment environment is complete.");
    return 0;
  }
  console.error("[deploy-preflight] refusing an incomplete Netlify deployment:");
  for (const failure of failures) console.error(`[deploy-preflight] - ${failure}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runDeployPreflight();
}
