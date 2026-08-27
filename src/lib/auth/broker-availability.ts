const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether the login page should offer broker-backed social providers. */
export function brokerAvailable(hostname: string, deploymentEnabled = true): boolean {
  const host = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (host.endsWith(".grok-sandbox.com")) return true;
  return deploymentEnabled;
}
