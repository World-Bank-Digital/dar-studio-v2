import { artifactsFor } from "./worker-artifacts.ts";

export interface DownloadOption {
  id: string;
  href: string;
  format: string;
  byteSize?: number;
}
export interface DownloadGroup {
  id: string;
  title: string;
  options: DownloadOption[];
}
export interface PackageDownload {
  key: string;
  byteSize?: number;
}
export interface StageDownload {
  artifactId: string;
  stageId: string;
  key: string;
  filename: string;
  byteSize?: number;
}
const formats: Record<string, string> = {
  docx: "Word",
  xlsx: "Excel",
  md: "Markdown",
  pdf: "PDF",
  html: "HTML",
  json: "JSON",
  csv: "CSV",
  zip: "ZIP",
};
export function downloadFormat(extension: string): string {
  return formats[extension.toLowerCase()] ?? extension.toUpperCase();
}
export function downloadSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function title(key: string): string {
  if (key.endsWith("_report")) return "Report";
  if (key === "cost_benefit_workbook") return "Cost-benefit workbook";
  if (key === "stage_manifest") return "Stage manifest";
  if (key === "source_inventory") return "Source inventory";
  return key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
function sorted(groups: DownloadGroup[]): DownloadGroup[] {
  const order = ["PDF", "Word", "HTML", "Markdown"];
  return groups.map((g) => ({
    ...g,
    options: g.options.sort((a, b) => {
      const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : 10);
      return rank(a.format) - rank(b.format);
    }),
  }));
}
export function stageDownloads(
  runId: string,
  stageId: string,
  originals: StageDownload[],
  packaged: PackageDownload[],
) {
  const groups = new Map<string, DownloadGroup>();
  const add = (key: string, option: DownloadOption) => {
    const group = groups.get(key) ?? { id: key, title: title(key), options: [] };
    group.options.push(option);
    groups.set(key, group);
  };
  const available = new Map(packaged.map((a) => [a.key, a]));
  for (const link of artifactsFor("workflow")) {
    const source = link.workflowSource;
    if (
      source?.kind !== "package" ||
      source.selector.stageId !== stageId ||
      !available.has(link.key)
    )
      continue;
    const key = source.selector.artifactId;
    if (!key) continue;
    add(key, {
      id: link.key,
      href: `/api/runs/${encodeURIComponent(runId)}/artifact?key=${encodeURIComponent(link.key)}`,
      format: downloadFormat(link.extension ?? ""),
      byteSize: available.get(link.key)?.byteSize,
    });
  }
  // Packaged versions replace their working-paper group; never mix identities or invent formats.
  const packagedKeys = new Set(groups.keys());
  for (const artifact of originals.filter((a) => a.stageId === stageId)) {
    if (packagedKeys.has(artifact.key)) continue;
    add(artifact.key, {
      id: artifact.artifactId,
      href: `/api/runs/${encodeURIComponent(runId)}/artifact?stageArtifact=${encodeURIComponent(artifact.artifactId)}`,
      format: downloadFormat(artifact.filename.split(".").at(-1) ?? "file"),
      byteSize: artifact.byteSize,
    });
  }
  const all = sorted([...groups.values()]);
  return {
    primary: all.filter((g) => g.id.endsWith("_report") || g.id === "cost_benefit_workbook"),
    supporting: all.filter(
      (g) =>
        !g.id.endsWith("_report") && !["cost_benefit_workbook", "stage_manifest"].includes(g.id),
    ),
    technical: all.filter((g) => g.id === "stage_manifest"),
  };
}
export function finalDownloads(runId: string, available: PackageDownload[]): DownloadGroup[] {
  const byKey = new Map(available.map((a) => [a.key, a]));
  return [
    { id: "bundle", title: "Complete DAR package", keys: ["bundle"] },
    {
      id: "draft",
      title: "Draft DAR",
      keys: ["draft-pdf", "draft-docx", "draft-html", "draft-md"],
    },
    { id: "cost-benefit", title: "Cost-benefit workbook", keys: ["cost-benefit-xlsx"] },
    { id: "sources", title: "Consolidated sources", keys: ["sources-xlsx", "sources-csv"] },
  ]
    .map((group) => ({
      id: group.id,
      title: group.title,
      options: group.keys
        .filter((key) => byKey.has(key))
        .map((key) => {
          const link = artifactsFor("workflow").find((a) => a.key === key)!;
          return {
            id: key,
            href: `/api/runs/${encodeURIComponent(runId)}/artifact?key=${encodeURIComponent(key)}`,
            format: downloadFormat(link.extension ?? ""),
            byteSize: byKey.get(key)?.byteSize,
          };
        }),
    }))
    .filter((g) => g.options.length);
}
