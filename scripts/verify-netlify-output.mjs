#!/usr/bin/env node

import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = join(root, ".netlify/v1/functions/server.mjs");

await Promise.all([
  access(join(root, "dist/client")),
  access(join(root, "dist/server/server.js")),
  access(wrapper),
]);

const module = await import(`${pathToFileURL(wrapper).href}?verify=${Date.now()}`);
if (typeof module.default !== "function") {
  throw new Error("Netlify output has no fetch handler.");
}

const manifest = await module.default(
  new Request("https://dar-staging.netlify.app/__grok/manifest.webmanifest"),
);
if (manifest.status !== 200 || !(await manifest.text()).includes("Dar Staging")) {
  throw new Error("Netlify output did not preserve the dynamic PWA manifest.");
}

const install = await module.default(
  new Request("https://dar-staging.netlify.app/?install=1&platform=ios", {
    headers: { accept: "text/html" },
  }),
);
if (install.status !== 200 || !(await install.text()).includes("Dar Staging")) {
  throw new Error("Netlify output did not preserve the install tutorial.");
}

console.log("[verify-netlify] adapter output and deployed PWA routes passed.");
