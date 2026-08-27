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
      url.pathname.length > 1
      ? url
      : null;
  } catch {
    return null;
  }
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
  return pooled ? url.hostname.includes("-pooler.") : !url.hostname.includes("-pooler.");
}
