import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("the application canvas", () => {
  it("pins the global theme, document, and browser chrome to white", async () => {
    const [styles, root] = await Promise.all([
      source("../../styles.css"),
      source("../../routes/__root.tsx"),
    ]);

    assert.match(styles, /--color-bg:\s*#ffffff;/);
    assert.match(styles, /--color-bg-elevated:\s*#ffffff;/);
    assert.match(styles, /--color-surface:\s*#ffffff;/);
    assert.match(styles, /html\s*\{[^}]*background:\s*#ffffff;/s);
    assert.match(styles, /body\s*\{[^}]*background:\s*#ffffff;/s);
    assert.match(styles, /color-scheme:\s*light;/);
    assert.match(root, /name:\s*"theme-color",\s*content:\s*"#ffffff"/);
    assert.match(root, /<body className="min-h-dvh bg-white text-ink">/);
  });

  it("keeps fallback and sign-in completion pages white in dark-mode browsers", async () => {
    const [errorPage, popup] = await Promise.all([
      source("../error-component.tsx"),
      source("../auth/popup.server.ts"),
    ]);

    assert.match(errorPage, /bg-white text-ink/);
    assert.doesNotMatch(errorPage, /dark:bg-/);
    assert.match(popup, /background:#fff;color:#1c1f1a;color-scheme:light/);
  });

  it("keeps persistent chrome and modal backdrops on the white canvas", async () => {
    const [shell, portfolio] = await Promise.all([
      source("../../components/AppShell.tsx"),
      source("../../routes/index.tsx"),
    ]);

    assert.match(shell, /min-h-dvh bg-bg text-ink/);
    assert.match(shell, /border-b border-border bg-white text-forest/);
    assert.doesNotMatch(shell, /bg-forest text-forest-fg/);
    assert.equal(portfolio.match(/bg-white\/90 p-4 backdrop-blur-sm/g)?.length, 2);
    assert.match(portfolio, /max-w-md rounded-2xl border border-subtle p-6/);
    assert.match(portfolio, /max-w-lg rounded-2xl border border-subtle p-6/);
    assert.doesNotMatch(portfolio, /fixed inset-0[^"\n]*bg-ink/);
  });
});
