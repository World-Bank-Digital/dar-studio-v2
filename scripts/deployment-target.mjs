/** Resolve the server adapter without changing ordinary development behavior. */
export function deploymentTarget(command, environment = process.env) {
  if (command !== "build") return null;
  return environment.NETLIFY === "true" ? "netlify" : "vercel";
}
