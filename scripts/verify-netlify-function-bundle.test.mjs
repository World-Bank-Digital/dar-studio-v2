import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertNetlifyFunctionArchive,
  assertNetlifyFunctionMetadata,
  createPdfSmokeFixture,
} from "./verify-netlify-function-bundle.mjs";

const validMetadata = () => ({
  name: "server",
  runtimeVersion: "nodejs22.x",
  invocationMode: "stream",
  runtimeAPIVersion: 2,
  routes: [{ pattern: "/*", prefer_static: true }],
});

const validEntries = () => [
  ".netlify/v1/functions/server.mjs",
  "node_modules/@napi-rs/canvas/index.js",
  "node_modules/@napi-rs/canvas/js-binding.js",
  "node_modules/@napi-rs/canvas-linux-x64-gnu/package.json",
  "node_modules/@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node",
  "node_modules/@napi-rs/canvas-linux-x64-musl/package.json",
  "node_modules/pdf-parse/dist/pdf-parse/esm/index.js",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
];

test("the audited Netlify function keeps its streamed root route and Node 22 runtime", () => {
  assert.doesNotThrow(() => assertNetlifyFunctionMetadata([validMetadata()]));

  for (const mutation of [
    { runtimeVersion: "nodejs24.x" },
    { invocationMode: "buffered" },
    { runtimeAPIVersion: 1 },
    { routes: [] },
  ]) {
    assert.throws(
      () => assertNetlifyFunctionMetadata([{ ...validMetadata(), ...mutation }]),
      /Netlify function bundle verification failed/,
    );
  }
});

test("the audited archive requires only the Linux x64 GNU canvas binary", () => {
  assert.doesNotThrow(() => assertNetlifyFunctionArchive(validEntries()));

  for (const entries of [
    validEntries().filter((entry) => entry !== "node_modules/@napi-rs/canvas/index.js"),
    validEntries().filter((entry) => !entry.endsWith(".node")),
    validEntries().filter(
      (entry) => entry !== "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ),
    [...validEntries(), "node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node"],
    [...validEntries(), "node_modules/@napi-rs/canvas-linux-x64-musl/skia.linux-x64-musl.node"],
  ]) {
    assert.throws(
      () => assertNetlifyFunctionArchive(entries),
      /Netlify function bundle verification failed/,
    );
  }
});

test("the PDF smoke fixture is a bounded one-page PDF containing the audit marker", () => {
  const bytes = createPdfSmokeFixture();
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(bytes.byteLength > 100 && bytes.byteLength < 4096);
  assert.match(bytes.toString("latin1"), /^%PDF-1\.4/);
  assert.match(bytes.toString("latin1"), /DAR Netlify PDF smoke/);
  assert.match(bytes.toString("latin1"), /startxref\n\d+\n%%EOF\n$/);
});
