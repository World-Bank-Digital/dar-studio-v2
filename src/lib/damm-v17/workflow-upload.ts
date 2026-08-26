/** Server-side extraction for optional pre-launch workflow documents. */
import {
  MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT,
  MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_PER_DOCUMENT,
} from "./workflow.ts";

export const MAX_WORKFLOW_SOURCE_UPLOAD_BYTES = MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_PER_DOCUMENT;
export const WORKFLOW_EXTRACTABLE_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "md",
  "html",
] as const;

export type WorkflowExtractableExtension = (typeof WORKFLOW_EXTRACTABLE_EXTENSIONS)[number];

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function canonicalText(value: string): string {
  const normalized = value.replaceAll("\0", "").replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (!normalized) throw new Error("No readable text could be extracted from this document.");
  if (Array.from(normalized).length > MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT) {
    throw new Error(
      `The extracted text exceeds ${MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT.toLocaleString()} characters.`,
    );
  }
  return `${normalized}\n`;
}

function htmlText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ");
}

async function spreadsheetText(bytes: Buffer): Promise<string> {
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, dense: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return `# ${name}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
  }).join("\n\n");
}

export function workflowUploadExtension(filename: string): string {
  const leaf = filename.trim().split(/[\\/]/).pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "";
}

export function decodeWorkflowUploadBase64(value: string): Buffer {
  if (!value || value.length > Math.ceil(MAX_WORKFLOW_SOURCE_UPLOAD_BYTES / 3) * 4 + 4) {
    throw new Error("The source document exceeds the 2 MB direct-upload limit.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("The source document payload is not valid base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > MAX_WORKFLOW_SOURCE_UPLOAD_BYTES) {
    throw new Error("The source document exceeds the 2 MB direct-upload limit.");
  }
  return bytes;
}

export async function extractWorkflowUploadText(
  filename: string,
  bytes: Buffer,
): Promise<{ extension: WorkflowExtractableExtension; text: string }> {
  const extension = workflowUploadExtension(filename);
  if (!(WORKFLOW_EXTRACTABLE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error(
      `Unsupported document type .${extension || "(none)"}. Use PDF, DOC, DOCX, XLS, XLSX, CSV, TXT, Markdown, or HTML.`,
    );
  }

  let value: string;
  switch (extension as WorkflowExtractableExtension) {
    case "pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: bytes });
      try {
        value = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
      break;
    }
    case "doc": {
      const WordExtractor = (await import("word-extractor")).default;
      const document = await new WordExtractor().extract(bytes);
      value = [
        document.getBody(),
        document.getFootnotes(),
        document.getEndnotes(),
        document.getHeaders(),
        document.getTextboxes(),
      ]
        .filter(Boolean)
        .join("\n");
      break;
    }
    case "docx": {
      const mammoth = (await import("mammoth")).default;
      value = (await mammoth.extractRawText({ buffer: bytes })).value;
      break;
    }
    case "xls":
    case "xlsx":
      value = await spreadsheetText(bytes);
      break;
    case "html":
      value = htmlText(bytes.toString("utf8"));
      break;
    case "csv":
    case "txt":
    case "md":
      value = bytes.toString("utf8");
      break;
  }
  return { extension: extension as WorkflowExtractableExtension, text: canonicalText(value) };
}
