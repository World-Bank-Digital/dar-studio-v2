import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { DAR_WORKFLOW } from "./workflow.ts";
import {
  MAX_WORKFLOW_SOURCE_UPLOAD_BYTES,
  WORKFLOW_EXTRACTABLE_EXTENSIONS,
  decodeWorkflowUploadBase64,
  extractWorkflowUploadText,
} from "./workflow-upload.ts";

describe("optional workflow document extraction", () => {
  it("truthfully implements every extension advertised by all five categories", () => {
    const advertised = new Set(
      DAR_WORKFLOW.optional_launch_inputs.flatMap((category) => category.accepted_extensions),
    );
    assert.deepEqual([...advertised].sort(), [...WORKFLOW_EXTRACTABLE_EXTENSIONS].sort());
  });

  it("canonicalizes text and removes executable HTML content", async () => {
    const text = await extractWorkflowUploadText("notes.txt", Buffer.from("one\r\ntwo"));
    assert.equal(text.text, "one\ntwo\n");
    const html = await extractWorkflowUploadText(
      "brief.html",
      Buffer.from("<h1>Plan &amp; delivery</h1><script>ignore me</script><p>Next</p>"),
    );
    assert.equal(html.text, "Plan & delivery\n Next\n");
  });

  it("reads both legacy XLS and modern XLSX as real spreadsheets", async () => {
    const XLSX = await import("@e965/xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Investment", "Benefit"],
        ["Irrigation", 42],
      ]),
      "Options",
    );
    for (const extension of ["xls", "xlsx"] as const) {
      const bytes = XLSX.write(workbook, {
        type: "buffer",
        bookType: extension === "xls" ? "biff8" : "xlsx",
      }) as Buffer;
      const result = await extractWorkflowUploadText(`options.${extension}`, bytes);
      assert.match(result.text, /Investment,Benefit/);
      assert.match(result.text, /Irrigation,42/);
    }
  });

  it("extracts a genuine DOCX file", async () => {
    const fixture = new URL(
      "../../../node_modules/mammoth/test/test-data/single-paragraph.docx",
      import.meta.url,
    );
    const result = await extractWorkflowUploadText("brief.docx", await readFile(fixture));
    assert.ok(result.text.trim().length > 0);
  });

  it("enforces the direct-upload request limit before decoding", () => {
    const tooLarge = Buffer.alloc(MAX_WORKFLOW_SOURCE_UPLOAD_BYTES + 1).toString("base64");
    assert.throws(() => decodeWorkflowUploadBase64(tooLarge), /2 MB direct-upload limit/);
    assert.throws(() => decodeWorkflowUploadBase64("not base64"), /valid base64/);
  });
});
