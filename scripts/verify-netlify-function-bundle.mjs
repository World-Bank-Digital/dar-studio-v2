#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { zipFunctions } from "@netlify/zip-it-and-ship-it";
import JSZip from "jszip";

export const NETLIFY_CLI_VERSION = "27.4.2";
export const NETLIFY_ZISI_VERSION = "15.5.0";
export const NETLIFY_FUNCTION_RUNTIME = "nodejs22.x";
export const NETLIFY_BUILD_NODE_VERSION = "22.22.3";
export const NETLIFY_INCLUDED_FILES = [
  "node_modules/@napi-rs/canvas/**",
  "node_modules/@napi-rs/canvas-linux-x64-gnu/**",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
];

const EXPECTED_FUNCTION_ENTRY = ".netlify/v1/functions/server.mjs";
const EXPECTED_CANVAS_BINARY = "node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node";
const EXPECTED_ARCHIVE_ENTRIES = [
  EXPECTED_FUNCTION_ENTRY,
  "node_modules/@napi-rs/canvas/index.js",
  "node_modules/@napi-rs/canvas/js-binding.js",
  EXPECTED_CANVAS_BINARY,
  "node_modules/pdf-parse/dist/pdf-parse/esm/index.js",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
];

function fail(message) {
  throw new Error(`Netlify function bundle verification failed: ${message}`);
}

export function assertNetlifyFunctionMetadata(results) {
  if (!Array.isArray(results) || results.length !== 1) {
    fail("expected exactly one generated function named server");
  }

  const [server] = results;
  if (server.name !== "server") {
    fail("the generated function is not named server");
  }
  if (server.runtimeVersion !== NETLIFY_FUNCTION_RUNTIME) {
    fail(`server runtime must be ${NETLIFY_FUNCTION_RUNTIME}`);
  }
  if (server.invocationMode !== "stream" || server.runtimeAPIVersion !== 2) {
    fail("server must retain the streamed Functions v2 invocation contract");
  }

  if (
    !Array.isArray(server.routes) ||
    server.routes.length !== 1 ||
    server.routes[0]?.pattern !== "/*" ||
    server.routes[0]?.prefer_static !== true
  ) {
    fail("server must retain the single prefer-static /* route");
  }
}

function assertSafeArchiveEntry(name) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.split("/").includes("..")
  ) {
    fail("the generated archive contains an unsafe entry name");
  }
}

export function assertNetlifyFunctionArchive(entries) {
  if (!Array.isArray(entries)) {
    fail("archive entries were not provided");
  }

  const seen = new Set();
  for (const name of entries) {
    assertSafeArchiveEntry(name);
    if (seen.has(name)) {
      fail("the generated archive contains a duplicate entry");
    }
    seen.add(name);
  }

  for (const required of EXPECTED_ARCHIVE_ENTRIES) {
    if (!seen.has(required)) {
      fail(`the generated archive is missing required entry ${required}`);
    }
  }

  const nativeBinaries = entries.filter((name) => name.endsWith(".node"));
  if (nativeBinaries.length !== 1 || nativeBinaries[0] !== EXPECTED_CANVAS_BINARY) {
    fail("the archive must contain only the Linux x64 GNU canvas native binary");
  }
}

export function createPdfSmokeFixture() {
  const marker = "DAR Netlify PDF smoke";
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${marker}) Tj\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n%DAR\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

async function packageVersion(root, packageName) {
  const packagePath = join(root, "node_modules", ...packageName.split("/"), "package.json");
  const value = JSON.parse(await readFile(packagePath, "utf8"));
  return value.version;
}

async function extractArchive(zip, destination) {
  for (const entry of Object.values(zip.files)) {
    assertSafeArchiveEntry(entry.name);
    if (
      typeof entry.unixPermissions === "number" &&
      (entry.unixPermissions & 0o170000) === 0o120000
    ) {
      fail("the generated archive contains a symbolic link");
    }
    if (entry.dir) continue;

    const outputPath = resolve(destination, entry.name);
    if (!outputPath.startsWith(`${resolve(destination)}${sep}`)) {
      fail("the generated archive entry escapes the extraction root");
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await entry.async("nodebuffer"));
  }
}

async function smokePdfExtraction(extractionRoot) {
  const pdfParseEntry = join(extractionRoot, "node_modules/pdf-parse/dist/pdf-parse/esm/index.js");
  const { PDFParse } = await import(`${pathToFileURL(pdfParseEntry).href}?dar-netlify-audit=1`);
  const parser = new PDFParse({ data: createPdfSmokeFixture() });
  try {
    const result = await parser.getText();
    if (!result.text.includes("DAR Netlify PDF smoke")) {
      fail("the packaged PDF parser did not extract the smoke marker");
    }
  } finally {
    await parser.destroy();
  }
}

export async function verifyNetlifyFunctionBundle({ root = resolve(".") } = {}) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("run this audit inside the pinned Linux/amd64 release container");
  }
  if (process.versions.node !== NETLIFY_BUILD_NODE_VERSION) {
    fail(`Node must be exactly ${NETLIFY_BUILD_NODE_VERSION}`);
  }

  const [cliVersion, zisiVersion] = await Promise.all([
    packageVersion(root, "netlify-cli"),
    packageVersion(root, "@netlify/zip-it-and-ship-it"),
  ]);
  if (cliVersion !== NETLIFY_CLI_VERSION || zisiVersion !== NETLIFY_ZISI_VERSION) {
    fail(
      `expected netlify-cli ${NETLIFY_CLI_VERSION} and zip-it-and-ship-it ${NETLIFY_ZISI_VERSION}`,
    );
  }

  const auditRoot = await mkdtemp(join(tmpdir(), "dar-netlify-function-audit-"));
  try {
    const results = await zipFunctions(
      [join(root, ".netlify/v1/functions")],
      join(auditRoot, "bundles"),
      {
        basePath: root,
        configFileDirectories: [join(root, ".netlify/functions-internal")],
        config: {
          "*": {
            includedFiles: NETLIFY_INCLUDED_FILES,
            includedFilesBasePath: root,
            nodeVersion: NETLIFY_FUNCTION_RUNTIME,
            processDynamicNodeImports: true,
            zipGo: true,
          },
        },
      },
    );
    assertNetlifyFunctionMetadata(results);

    const archiveBytes = await readFile(results[0].path);
    const zip = await JSZip.loadAsync(archiveBytes, {
      checkCRC32: true,
      createFolders: false,
    });
    assertNetlifyFunctionArchive(Object.keys(zip.files));

    const extractionRoot = join(auditRoot, "extracted");
    await mkdir(extractionRoot);
    await extractArchive(zip, extractionRoot);
    await smokePdfExtraction(extractionRoot);
  } finally {
    await rm(auditRoot, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await verifyNetlifyFunctionBundle();
    process.stdout.write(
      `Verified Netlify server bundle: ${NETLIFY_FUNCTION_RUNTIME}, streamed /* route, Linux/x64 PDF extraction.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
