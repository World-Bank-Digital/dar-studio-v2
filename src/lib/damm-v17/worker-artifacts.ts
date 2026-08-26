/**
 * What each pass produces, for the surfaces that link to it.
 *
 * Split from `worker.ts` because that module reaches node:child_process and node:fs, and
 * a browser bundle importing it to render a link would pull the whole worker in. The
 * paths stay in `worker.ts`, where the filesystem belongs; only the labels are here.
 */
import type { RunPass } from "./runs.ts";
import { DAR_WORKFLOW } from "./workflow.ts";

export type WorkflowPackageCategory =
  "narrative" | "structured" | "source_inventory" | "source_inventory_consolidated" | "workflow";

export interface WorkflowPackageSelector {
  /** Stage 8 artifact directory that contains this package-manifest category. */
  groupArtifactKey?: "narrative_exports" | "structured_exports" | "source_inventory_exports";
  category: WorkflowPackageCategory;
  stageId?: string;
  artifactId?: string;
  extension: string;
}

export type WorkflowArtifactSource =
  | { kind: "root"; path: "workflow-manifest.json" | "workflow-events.jsonl" }
  | { kind: "stage8"; artifactKey: "workflow_manifest" | "complete_bundle" }
  | { kind: "package"; selector: WorkflowPackageSelector };

export interface ArtifactLink {
  key: string;
  label: string;
  /** Present for canonical-workflow downloads; legacy paths remain worker-owned. */
  extension?: string;
  workflowSource?: WorkflowArtifactSource;
}

const NARRATIVE_FORMATS = ["md", "docx", "pdf", "html"] as const;
const FORMAT_LABEL: Record<(typeof NARRATIVE_FORMATS)[number], string> = {
  md: "Markdown",
  docx: "Word",
  pdf: "PDF",
  html: "HTML",
};

const completedStages = DAR_WORKFLOW.stages.slice(0, -1);
const draftStage = completedStages.find((stage) => stage.id === "draft_dar");
const otherStages = completedStages.filter((stage) => stage.id !== "draft_dar");

function reportArtifactId(stage: (typeof completedStages)[number]): string {
  const report = stage.required_artifacts.find((artifact) => artifact.endsWith("_report"));
  if (!report) throw new Error(`Canonical stage ${stage.id} has no narrative report artifact`);
  return report;
}

function narrativeLinks(stage: (typeof completedStages)[number]): ArtifactLink[] {
  const artifactId = reportArtifactId(stage);
  return NARRATIVE_FORMATS.map((extension) => ({
    key: stage.id === "draft_dar" ? `draft-${extension}` : `narrative-${stage.id}-${extension}`,
    label: `${stage.title} (${FORMAT_LABEL[extension]})`,
    extension,
    workflowSource: {
      kind: "package" as const,
      selector: {
        groupArtifactKey: "narrative_exports" as const,
        category: "narrative" as const,
        stageId: stage.id,
        artifactId,
        extension,
      },
    },
  }));
}

function words(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const structuredLinks: ArtifactLink[] = completedStages.flatMap((stage) => {
  const report = reportArtifactId(stage);
  const data = stage.required_artifacts.filter(
    (artifact) => ![report, "source_inventory", "stage_manifest"].includes(artifact),
  );
  data.push("stage_manifest");
  return data.map((artifactId) => {
    const extension = artifactId === "cost_benefit_workbook" ? "xlsx" : "json";
    const key =
      stage.id === "draft_dar" && artifactId === "dar_source_data"
        ? "dar-data-json"
        : artifactId === "cost_benefit_workbook"
          ? "cost-benefit-xlsx"
          : `data-${stage.id}-${artifactId}-${extension}`;
    return {
      key,
      label:
        artifactId === "stage_manifest"
          ? `${stage.title} — stage manifest`
          : `${stage.title} — ${words(artifactId)}`,
      extension,
      workflowSource: {
        kind: "package" as const,
        selector: {
          groupArtifactKey: "structured_exports" as const,
          category: "structured" as const,
          stageId: stage.id,
          artifactId,
          extension,
        },
      },
    };
  });
});

const rawSourceInventoryLinks: ArtifactLink[] = completedStages
  .filter((stage) => stage.required_artifacts.includes("source_inventory"))
  .map((stage) => ({
    key: `sources-${stage.id}-json`,
    label: `${stage.title} — source inventory (JSON)`,
    extension: "json",
    workflowSource: {
      kind: "package" as const,
      selector: {
        groupArtifactKey: "source_inventory_exports" as const,
        category: "source_inventory" as const,
        stageId: stage.id,
        artifactId: "source_inventory",
        extension: "json",
      },
    },
  }));

const consolidatedSourceLinks: ArtifactLink[] = ["xlsx", "csv"].map((extension) => ({
  key: `sources-${extension}`,
  label: `Consolidated source inventory (${extension.toUpperCase()})`,
  extension,
  workflowSource: {
    kind: "package" as const,
    selector: {
      groupArtifactKey: "source_inventory_exports" as const,
      category: "source_inventory_consolidated" as const,
      extension,
    },
  },
}));

const packagedWorkflowLinks: ArtifactLink[] = [
  ["package-workflow-manifest", "Packaged workflow manifest", "workflow_manifest"],
  ["package-workflow-contract", "Packaged canonical workflow contract", "workflow_contract"],
  ["package-input-snapshot", "Packaged immutable input snapshot", "input_snapshot"],
].map(([key, label, artifactId]) => ({
  key,
  label,
  extension: "json",
  workflowSource: {
    kind: "package" as const,
    selector: {
      category: "workflow" as const,
      artifactId,
      extension: "json",
    },
  },
}));

if (!draftStage) throw new Error("Canonical workflow has no Draft DAR stage");

const WORKFLOW_ARTIFACTS: ArtifactLink[] = [
  {
    key: "manifest",
    label: "Workflow manifest",
    extension: "json",
    workflowSource: { kind: "root", path: "workflow-manifest.json" },
  },
  {
    key: "events",
    label: "Workflow event log",
    extension: "jsonl",
    workflowSource: { kind: "root", path: "workflow-events.jsonl" },
  },
  {
    key: "package-manifest",
    label: "DAR package manifest",
    extension: "json",
    workflowSource: { kind: "stage8", artifactKey: "workflow_manifest" },
  },
  {
    key: "bundle",
    label: "Complete DAR bundle",
    extension: "zip",
    workflowSource: { kind: "stage8", artifactKey: "complete_bundle" },
  },
  ...narrativeLinks(draftStage),
  ...otherStages.flatMap(narrativeLinks),
  ...structuredLinks,
  ...consolidatedSourceLinks,
  ...rawSourceInventoryLinks,
  ...packagedWorkflowLinks,
];

const ARTIFACTS: Record<RunPass, ArtifactLink[]> = {
  workflow: WORKFLOW_ARTIFACTS,
  research: [
    { key: "input", label: "Engine input" },
    { key: "trail", label: "Research trail" },
  ],
  g2: [
    { key: "input", label: "Reviewed engine input" },
    { key: "findings", label: "Review findings" },
  ],
  scans: [
    { key: "scans", label: "Scan findings" },
    { key: "register", label: "Initiative register" },
  ],
  foresight: [
    { key: "foresight", label: "Foresight report" },
    { key: "foresight-json", label: "Scenarios and milestones" },
  ],
  generation: [
    { key: "dar", label: "Draft roadmap" },
    { key: "dar-json", label: "Roadmap source" },
  ],
  diagnostic: [
    { key: "diagnostic", label: "Diagnostic report" },
    { key: "scored", label: "Scored assessment" },
  ],
};

export function artifactsFor(pass: RunPass): ArtifactLink[] {
  return ARTIFACTS[pass] ?? [];
}

/**
 * The canonical workflow's completed download set.
 *
 * A1: review happens once, at the end, on the completed set — not per artifact. So the
 * set has to be nameable even when it is incomplete, and a missing document has to say
 * which pass would produce it rather than simply not appearing.
 */
export interface DocumentSlot {
  key: string;
  title: string;
  what: string;
  pass: RunPass;
  artifactKey: string;
}

export const DOCUMENT_SLOTS: DocumentSlot[] = [
  {
    key: "draft-md",
    title: "Draft DAR — Markdown",
    what: "The integrated Draft DAR in a portable source format.",
    pass: "workflow",
    artifactKey: "draft-md",
  },
  {
    key: "draft-docx",
    title: "Draft DAR — Word",
    what: "The integrated Draft DAR as an editable Word document.",
    pass: "workflow",
    artifactKey: "draft-docx",
  },
  {
    key: "draft-pdf",
    title: "Draft DAR — PDF",
    what: "The integrated Draft DAR in a fixed-layout reading format.",
    pass: "workflow",
    artifactKey: "draft-pdf",
  },
  {
    key: "draft-html",
    title: "Draft DAR — HTML",
    what: "The integrated Draft DAR for browser reading.",
    pass: "workflow",
    artifactKey: "draft-html",
  },
  {
    key: "dar-data-json",
    title: "DAR source data — JSON",
    what: "Structured source data supporting the integrated Draft DAR.",
    pass: "workflow",
    artifactKey: "dar-data-json",
  },
  {
    key: "cost-benefit-xlsx",
    title: "Cost-benefit workbook — Excel",
    what: "The Stage 6 investment appraisal and cost-benefit workbook.",
    pass: "workflow",
    artifactKey: "cost-benefit-xlsx",
  },
  {
    key: "sources-xlsx",
    title: "Source inventory — Excel",
    what: "The consolidated inventory of sources used across all eight stages.",
    pass: "workflow",
    artifactKey: "sources-xlsx",
  },
  {
    key: "bundle",
    title: "Complete DAR bundle",
    what: "Every report, spreadsheet, inventory, manifest, and export in one ZIP package.",
    pass: "workflow",
    artifactKey: "bundle",
  },
  {
    key: "manifest",
    title: "Workflow manifest",
    what: "The versioned, hash-recorded provenance manifest for this Draft DAR run.",
    pass: "workflow",
    artifactKey: "manifest",
  },
];
