type Environment = Record<string, string | undefined>;

export interface BrokerCredentials {
  issuer: string;
  clientId: string;
  clientSecret: string;
  source: "deployment" | "preview";
}

export interface AuthMode {
  hosted: boolean;
  explicitBaseURL?: string;
  authSecret?: string;
  broker: BrokerCredentials | null;
  brokerConfigured: boolean;
  authConfigured: boolean;
}

export interface ResolveAuthModeInput {
  environment: Environment;
  emailAndPasswordEnabled: boolean;
  previewBroker: Omit<BrokerCredentials, "source">;
}

function text(environment: Environment, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

function validHttpsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export class HostedAuthConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: Iterable<string>) {
    const uniqueVariables = [...new Set(variables)].sort();
    super(`Hosted authentication configuration is invalid: ${uniqueVariables.join(", ")}`);
    this.name = "HostedAuthConfigurationError";
    this.variables = uniqueVariables;
  }
}

/** Resolve deployed, preview, and disabled auth without mixing credential sets. */
export function resolveAuthMode(input: ResolveAuthModeInput): AuthMode {
  const { environment, emailAndPasswordEnabled, previewBroker } = input;
  const hosted = text(environment, "NETLIFY") === "true" || Boolean(text(environment, "SITE_ID"));
  const explicitBaseURL = text(environment, "BETTER_AUTH_URL");
  const authSecret = text(environment, "BETTER_AUTH_SECRET");
  const authEnabled = text(environment, "VITE_AUTH_ENABLED");
  const socialAuthSetting = text(environment, "VITE_GROK_AUTH_ENABLED");
  const authDisabled = authEnabled === "false";
  const socialAuthEnabled = socialAuthSetting !== "false";
  const configuredIssuer = text(environment, "GROK_AUTH_ISSUER");
  const configuredClientId = text(environment, "GROK_AUTH_CLIENT_ID");
  const configuredClientSecret = text(environment, "GROK_AUTH_CLIENT_SECRET");
  const hasAnyConfiguredBrokerValue = Boolean(
    configuredIssuer || configuredClientId || configuredClientSecret,
  );
  const configuredBroker =
    configuredIssuer && configuredClientId && configuredClientSecret
      ? {
          issuer: configuredIssuer,
          clientId: configuredClientId,
          clientSecret: configuredClientSecret,
          source: "deployment" as const,
        }
      : null;

  if (hosted) {
    const invalidVariables: string[] = [];
    if (authEnabled !== "true") invalidVariables.push("VITE_AUTH_ENABLED");
    if (!validHttpsOrigin(explicitBaseURL)) invalidVariables.push("BETTER_AUTH_URL");
    if (!authSecret || authSecret.length < 32) invalidVariables.push("BETTER_AUTH_SECRET");
    if (socialAuthSetting !== "true" && socialAuthSetting !== "false") {
      invalidVariables.push("VITE_GROK_AUTH_ENABLED");
    }
    if (socialAuthSetting === "true") {
      if (!configuredIssuer || !validHttpsOrigin(configuredIssuer)) {
        invalidVariables.push("GROK_AUTH_ISSUER");
      }
      if (!configuredClientId) invalidVariables.push("GROK_AUTH_CLIENT_ID");
      if (!configuredClientSecret) invalidVariables.push("GROK_AUTH_CLIENT_SECRET");
    }
    if (invalidVariables.length) throw new HostedAuthConfigurationError(invalidVariables);
  }

  let broker: BrokerCredentials | null = null;
  if (!authDisabled && socialAuthEnabled) {
    if (configuredBroker) {
      broker = configuredBroker;
    } else if (!explicitBaseURL && !hasAnyConfiguredBrokerValue) {
      broker = { ...previewBroker, source: "preview" };
    }
  }

  const brokerConfigured = broker !== null;
  return {
    hosted,
    explicitBaseURL,
    authSecret,
    broker,
    brokerConfigured,
    authConfigured: !authDisabled && (emailAndPasswordEnabled || brokerConfigured),
  };
}
