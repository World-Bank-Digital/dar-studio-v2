export function validAbsoluteHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function parsedPostgresUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname &&
      url.username &&
      url.password &&
      url.pathname.length > 1
      ? url
      : null;
  } catch {
    return null;
  }
}

function neonEndpoint(url) {
  const [label, ...suffix] = url.hostname.split(".");
  return {
    pooled: label.endsWith("-pooler"),
    hostname: [label.replace(/-pooler$/, ""), ...suffix].join("."),
  };
}

/** Validate the exact Neon Ohio endpoint class used by one deployment role. */
export function validNeonOhioConnection(value, pooled) {
  const url = parsedPostgresUrl(value);
  if (!url || !url.hostname.endsWith(".us-east-2.aws.neon.tech")) return false;
  if (
    url.searchParams.getAll("sslmode").length !== 1 ||
    url.searchParams.get("sslmode") !== "require"
  ) {
    return false;
  }
  return neonEndpoint(url).pooled === pooled;
}

function neonDatabaseIdentity(value) {
  const url = parsedPostgresUrl(value);
  if (!url) return null;
  return {
    hostname: neonEndpoint(url).hostname,
    username: url.username,
    database: url.pathname.slice(1),
  };
}

/** Compare pooled/direct URLs without assuming Neon's optional cluster hostname segment. */
export function sameNeonDatabaseIdentity(pooledUrl, directUrl) {
  if (
    !validNeonOhioConnection(pooledUrl, true) ||
    !validNeonOhioConnection(directUrl, false)
  ) {
    return false;
  }
  const pooled = neonDatabaseIdentity(pooledUrl);
  const direct = neonDatabaseIdentity(directUrl);
  return Boolean(
    pooled &&
      direct &&
      pooled.hostname === direct.hostname &&
      pooled.username === direct.username &&
      pooled.database === direct.database,
  );
}
