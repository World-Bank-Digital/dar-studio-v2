/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

type Environment = Record<string, string | undefined>;

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/** Provider markers that are available inside the hosted server runtime. */
export function isHostedRuntime(environment: Environment = process.env): boolean {
  return (
    configured(environment.VERCEL) ||
    configured(environment.NETLIFY) ||
    configured(environment.SITE_ID)
  );
}

export interface DatabaseConfiguration {
  source: DbSource;
  databaseUrl?: string;
}

/** Local preview may use PGLite; a hosted process must never do so silently. */
export function resolveDatabaseConfiguration(
  environment: Environment = process.env,
): DatabaseConfiguration {
  const raw = environment.DATABASE_URL;
  const databaseUrl = raw && raw.trim() ? raw : undefined;
  if (databaseUrl) return { source: "neon", databaseUrl };
  if (isHostedRuntime(environment)) {
    throw new Error(
      "DATABASE_URL is required in hosted execution; refusing the ephemeral PGLite fallback.",
    );
  }
  return { source: "pglite" };
}
