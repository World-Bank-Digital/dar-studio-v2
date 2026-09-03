#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const OUTPUT_ROOTS = ["dist", ".netlify"];
const variableNames = [...new Set(process.argv.slice(2))];

function fail(message) {
  console.error(`[release-secret-scan] ${message}`);
  process.exitCode = 1;
}

function encodedForms(value) {
  const forms = new Set([value, Buffer.from(value).toString("base64"), encodeURIComponent(value)]);
  if (/\r|\n/.test(value)) {
    forms.add(value.replace(/\r?\n/g, ""));
    forms.add(JSON.stringify(value).slice(1, -1));
  }
  return [...forms].map((form) => Buffer.from(form));
}

async function filesBelow(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`refusing symbolic link ${relative(process.cwd(), path)}`);
  }
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) {
    throw new Error(`refusing non-file output ${relative(process.cwd(), path)}`);
  }
  const children = await readdir(path);
  const files = [];
  for (const child of children.sort()) files.push(...(await filesBelow(resolve(path, child))));
  return files;
}

if (variableNames.length === 0) {
  fail("at least one secret environment-variable name is required");
} else {
  const secrets = [];
  for (const name of variableNames) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      fail(`invalid secret variable name ${name}`);
      continue;
    }
    const value = process.env[name];
    if (!value || value.length <= 4) {
      fail(`secret variable ${name} is missing or too short to scan safely`);
      continue;
    }
    secrets.push({ name, forms: encodedForms(value) });
  }

  if (process.exitCode !== 1) {
    try {
      const files = [];
      for (const root of OUTPUT_ROOTS) files.push(...(await filesBelow(resolve(root))));
      for (const file of files) {
        const content = await readFile(file);
        for (const secret of secrets) {
          if (secret.forms.some((form) => content.indexOf(form) >= 0)) {
            fail(`refusing output containing ${secret.name} in ${relative(process.cwd(), file)}`);
          }
        }
      }
      if (process.exitCode !== 1) {
        console.log(
          `[release-secret-scan] scanned ${files.length} files; no configured secret found.`,
        );
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : "release output could not be scanned");
    }
  }
}
