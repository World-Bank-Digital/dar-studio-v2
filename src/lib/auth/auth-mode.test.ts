import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HostedAuthConfigurationError, resolveAuthMode } from "./auth-mode.ts";

const previewBroker = {
  issuer: "https://auth.grok.me",
  clientId: "preview-client",
  clientSecret: "preview-secret",
};

function resolve(environment: Record<string, string | undefined>, emailAndPasswordEnabled = true) {
  return resolveAuthMode({ environment, emailAndPasswordEnabled, previewBroker });
}

describe("auth mode resolution", () => {
  it("uses the complete baked credential set only for dynamic preview origins", () => {
    const mode = resolve({});

    assert.equal(mode.hosted, false);
    assert.equal(mode.explicitBaseURL, undefined);
    assert.equal(mode.authSecret, undefined);
    assert.deepEqual(mode.broker, { ...previewBroker, source: "preview" });
    assert.equal(mode.brokerConfigured, true);
    assert.equal(mode.authConfigured, true);
  });

  it("never falls back to preview credentials for a fixed public origin", () => {
    const mode = resolve({
      BETTER_AUTH_URL: "https://dar-staging.netlify.app",
      VITE_GROK_AUTH_ENABLED: "true",
    });

    assert.equal(mode.explicitBaseURL, "https://dar-staging.netlify.app");
    assert.equal(mode.broker, null);
    assert.equal(mode.brokerConfigured, false);
    assert.equal(mode.authConfigured, true);
  });

  it("fails closed when a Netlify runtime is missing hosted-only values", () => {
    assert.throws(
      () => resolve({ NETLIFY: "true" }),
      (error) => {
        assert.ok(error instanceof HostedAuthConfigurationError);
        assert.deepEqual(error.variables, [
          "BETTER_AUTH_SECRET",
          "BETTER_AUTH_URL",
          "VITE_AUTH_ENABLED",
          "VITE_GROK_AUTH_ENABLED",
        ]);
        assert.doesNotMatch(
          error.message,
          /preview-client|preview-secret|https:\/\/auth\.grok\.me/,
        );
        return true;
      },
    );
  });

  it("treats SITE_ID as hosted and never generates preview auth material", () => {
    const secret = "s".repeat(32);
    const mode = resolve({
      SITE_ID: "netlify-site-id",
      VITE_AUTH_ENABLED: "true",
      BETTER_AUTH_URL: "https://dar-staging.netlify.app",
      BETTER_AUTH_SECRET: secret,
      VITE_GROK_AUTH_ENABLED: "false",
    });

    assert.equal(mode.hosted, true);
    assert.equal(mode.authSecret, secret);
    assert.equal(mode.broker, null);
    assert.equal(mode.authConfigured, true);
  });

  it("rejects partial or invalid hosted broker configuration by variable name", () => {
    assert.throws(
      () =>
        resolve({
          NETLIFY: "true",
          VITE_AUTH_ENABLED: "true",
          BETTER_AUTH_URL: "https://dar-staging.netlify.app",
          BETTER_AUTH_SECRET: "s".repeat(32),
          VITE_GROK_AUTH_ENABLED: "true",
          GROK_AUTH_ISSUER: "http://auth.example.com",
          GROK_AUTH_CLIENT_ID: "deployed-client",
        }),
      (error) => {
        assert.ok(error instanceof HostedAuthConfigurationError);
        assert.deepEqual(error.variables, ["GROK_AUTH_CLIENT_SECRET", "GROK_AUTH_ISSUER"]);
        assert.doesNotMatch(error.message, /deployed-client|auth\.example\.com/);
        return true;
      },
    );
  });

  it("accepts a complete hosted social configuration without preview credentials", () => {
    const mode = resolve({
      NETLIFY: "true",
      VITE_AUTH_ENABLED: "true",
      BETTER_AUTH_URL: "https://dar-staging.netlify.app",
      BETTER_AUTH_SECRET: "s".repeat(32),
      VITE_GROK_AUTH_ENABLED: "true",
      GROK_AUTH_ISSUER: "https://auth.example.com",
      GROK_AUTH_CLIENT_ID: "deployed-client",
      GROK_AUTH_CLIENT_SECRET: "deployed-secret",
    });

    assert.equal(mode.hosted, true);
    assert.equal(mode.broker?.source, "deployment");
    assert.equal(mode.brokerConfigured, true);
    assert.equal(mode.authConfigured, true);
  });

  it("keeps real email/password authentication when social auth is disabled", () => {
    const mode = resolve({
      BETTER_AUTH_URL: "https://dar-staging.netlify.app",
      VITE_AUTH_ENABLED: "true",
      VITE_GROK_AUTH_ENABLED: "false",
    });

    assert.equal(mode.broker, null);
    assert.equal(mode.authConfigured, true);
  });

  it("uses only a complete dedicated broker credential set", () => {
    const complete = resolve({
      BETTER_AUTH_URL: "https://dar-staging.netlify.app",
      VITE_GROK_AUTH_ENABLED: "true",
      GROK_AUTH_ISSUER: "https://auth.example.com",
      GROK_AUTH_CLIENT_ID: "deployed-client",
      GROK_AUTH_CLIENT_SECRET: "deployed-secret",
    });
    assert.deepEqual(complete.broker, {
      issuer: "https://auth.example.com",
      clientId: "deployed-client",
      clientSecret: "deployed-secret",
      source: "deployment",
    });

    const partial = resolve({ GROK_AUTH_CLIENT_ID: "partial-client" });
    assert.equal(partial.broker, null);
    assert.equal(partial.authConfigured, true);
  });

  it("turns off real authentication only through the global auth switch", () => {
    const mode = resolve({ VITE_AUTH_ENABLED: "false" });
    assert.equal(mode.broker, null);
    assert.equal(mode.authConfigured, false);

    assert.equal(
      resolve(
        {
          BETTER_AUTH_URL: "https://dar-staging.netlify.app",
          VITE_GROK_AUTH_ENABLED: "false",
        },
        false,
      ).authConfigured,
      false,
    );
  });

  it("does not permit the global auth switch to disable a hosted runtime", () => {
    assert.throws(
      () =>
        resolve({
          NETLIFY: "true",
          VITE_AUTH_ENABLED: "false",
          BETTER_AUTH_URL: "https://dar-staging.netlify.app",
          BETTER_AUTH_SECRET: "s".repeat(32),
          VITE_GROK_AUTH_ENABLED: "false",
        }),
      (error) =>
        error instanceof HostedAuthConfigurationError &&
        error.variables.length === 1 &&
        error.variables[0] === "VITE_AUTH_ENABLED",
    );
  });
});
