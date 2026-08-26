/**
 * The normative DAR workflow exported by DAMM.
 *
 * The JSON is the contract. This module gives the rest of the app a typed, validated
 * view of it without restating the stage order or execution policy in UI code. Keeping
 * this module browser-safe also lets a surface explain the workflow without importing
 * the worker or Node's filesystem APIs.
 */
import workflowJson from "../../data/dar_workflow_v1.json" with { type: "json" };
import workflowSchemaJson from "../../data/dar_workflow_v1.schema.json" with { type: "json" };
import exportManifestJson from "../../data/dar_workflow_manifest.json" with { type: "json" };

export const WORKFLOW_CONTRACT_FILENAME = "dar_workflow_v1.json";
export const WORKFLOW_SCHEMA_FILENAME = "dar_workflow_v1.schema.json";
export const WORKFLOW_EVENT_SCHEMA_VERSION = "damm.workflow-event/v1";
export const WORKFLOW_INPUT_SCHEMA_VERSION = "damm.workflow-input-snapshot/v1";
export const MAX_WORKFLOW_UPLOAD_DOCUMENTS = 50;
export const MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT = 2_000_000;
export const MAX_WORKFLOW_UPLOAD_CHARACTERS_TOTAL = 10_000_000;
// Kept below common serverless request limits after base64/JSON overhead. Deployments
// with object storage may raise this only when uploads bypass the server-function body.
export const MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_PER_DOCUMENT = 2 * 1024 * 1024;
export const MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_TOTAL = 10 * 1024 * 1024;

/** Strip every client-supplied workflow launch option except the country identifier. */
export function canonicalWorkflowLaunchRequest(input: { countryId: string }): {
  countryId: string;
} {
  return { countryId: input.countryId };
}

/** Frozen, canonical UTF-8 extraction stored durably with the queued run. */
export interface FrozenWorkflowUpload {
  id: string;
  filename: string;
  kind: string;
  mime: string;
  chars: number;
  content: string;
  uploadedAt: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceBase64: string;
  uploaderId: string;
  extractionStatus: "extracted";
}

function decodedBase64Bytes(value: string): number | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function frozenWorkflowUploadViolations(value: unknown): string[] {
  if (!Array.isArray(value)) return ["workflow uploads must be an array"];
  const errors: string[] = [];
  if (value.length > MAX_WORKFLOW_UPLOAD_DOCUMENTS) {
    errors.push(`at most ${MAX_WORKFLOW_UPLOAD_DOCUMENTS} launch documents are allowed`);
  }
  const ids = new Set<string>();
  let total = 0;
  let sourceTotal = 0;
  for (const [index, candidate] of value.entries()) {
    const upload = record(candidate);
    const label = `launch document ${index + 1}`;
    if (!upload) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (typeof upload.id !== "string" || !upload.id.trim()) errors.push(`${label} has no id`);
    else if (ids.has(upload.id)) errors.push(`${label} repeats id ${upload.id}`);
    else ids.add(upload.id);
    if (typeof upload.filename !== "string" || !upload.filename.trim()) {
      errors.push(`${label} has no filename`);
    }
    if (typeof upload.kind !== "string" || !upload.kind.trim()) errors.push(`${label} has no kind`);
    if (typeof upload.mime !== "string" || !upload.mime.trim()) {
      errors.push(`${label} has no original source media type`);
    }
    if (typeof upload.content !== "string") {
      errors.push(`${label} has no UTF-8 text extraction`);
      continue;
    }
    const characters = Array.from(upload.content).length;
    total += characters;
    if (characters > MAX_WORKFLOW_UPLOAD_CHARACTERS_PER_DOCUMENT) {
      errors.push(`${label} exceeds the extracted-text limit`);
    }
    if (upload.chars !== characters) errors.push(`${label} has the wrong character count`);
    if (typeof upload.uploadedAt !== "string" || !Number.isFinite(Date.parse(upload.uploadedAt))) {
      errors.push(`${label} has an invalid upload timestamp`);
    }
    if (typeof upload.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(upload.sourceSha256)) {
      errors.push(`${label} has no original-file digest`);
    }
    if (
      typeof upload.sourceBytes !== "number" ||
      !Number.isSafeInteger(upload.sourceBytes) ||
      upload.sourceBytes < 0 ||
      upload.sourceBytes > MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_PER_DOCUMENT
    ) {
      errors.push(`${label} has an invalid original-file size`);
    } else {
      sourceTotal += upload.sourceBytes;
    }
    if (typeof upload.sourceBase64 !== "string") {
      errors.push(`${label} has no durable original file`);
    } else if (decodedBase64Bytes(upload.sourceBase64) !== upload.sourceBytes) {
      errors.push(`${label} original-file encoding does not match its recorded size`);
    }
    if (typeof upload.uploaderId !== "string" || !upload.uploaderId.trim()) {
      errors.push(`${label} has no stable uploader identity`);
    }
    if (upload.extractionStatus !== "extracted") {
      errors.push(`${label} was not successfully extracted`);
    }
  }
  if (total > MAX_WORKFLOW_UPLOAD_CHARACTERS_TOTAL) {
    errors.push("launch documents exceed the combined extracted-text limit");
  }
  if (sourceTotal > MAX_WORKFLOW_UPLOAD_SOURCE_BYTES_TOTAL) {
    errors.push("launch documents exceed the combined original-file limit");
  }
  return errors;
}

export const CANONICAL_STAGE_IDS = [
  "damm_diagnostic",
  "country_research",
  "ai_digital_agriculture",
  "international_lessons",
  "strategic_foresight",
  "investment_options",
  "draft_dar",
  "export_package",
] as const;

export type DarWorkflowStageId = (typeof CANONICAL_STAGE_IDS)[number];

export const CANONICAL_STAGE_BUDGET_ALLOCATIONS: Readonly<
  Record<DarWorkflowStageId, number>
> = {
  damm_diagnostic: 0.45,
  country_research: 0.075,
  ai_digital_agriculture: 0.1,
  international_lessons: 0.075,
  strategic_foresight: 0.1,
  investment_options: 0.05,
  draft_dar: 0.15,
  export_package: 0,
};

export interface DarWorkflowStage {
  ordinal: number;
  id: DarWorkflowStageId;
  title: string;
  depends_on: string[];
  human_input_required: false;
  objective: string;
  optional_inputs: string[];
  fallback_when_optional_inputs_absent: string;
  required_sections?: string[];
  required_artifacts: string[];
}

export interface DarWorkflowContract {
  $schema: string;
  schema_version: "damm.dar-workflow/v1";
  workflow_id: "dar-canonical-v1";
  workflow_version: string;
  status: "normative";
  title: string;
  required_launch_inputs: ["country"];
  optional_launch_inputs: Array<{
    id: string;
    title: string;
    accepted_extensions: string[];
  }>;
  execution_policy: {
    single_launch: true;
    immutable_input_snapshot: true;
    required_human_actions_during_run: [];
    late_input_policy: "new_workflow_version";
    missing_optional_input_policy: "autonomous_research_fallback";
    budget_policy: "preauthorized_ceiling_with_fixed_protected_allocations";
    fixed_stage_budget_allocations: Record<DarWorkflowStageId, number>;
    budget_exhaustion_policy: "bounded_retry_then_terminal_failure";
    transient_failure_policy: "bounded_automatic_retry";
    allowed_active_states: ["queued", "running", "retrying"];
    terminal_states: ["complete", "failed", "cancelled"];
    post_completion_review_only: true;
    output_lifecycle_state: "draft";
  };
  stages: DarWorkflowStage[];
  export_profiles: {
    narrative: string[];
    structured: string[];
    package: string[];
  };
  stage_manifest_required_fields: string[];
  post_completion: {
    review_available_after_stage: "export_package";
    review_required_to_generate_draft: false;
    review_required_for_final_or_publication: true;
    allowed_promotions: ["draft", "final"];
    prohibitions: string[];
  };
}

export interface DarWorkflowExportManifest {
  schema_version: "damm.workflow-export/v1";
  workflow_id: "dar-canonical-v1";
  workflow_version: string;
  sha256: Record<string, string>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

/**
 * Validate the safety properties the app relies on, not merely that the JSON parses.
 * The full JSON Schema remains exported below for downstream validators; these checks
 * are deliberately the invariants that would make a launch require a person or run a
 * different sequence if they drifted.
 */
export function workflowContractViolations(value: unknown): string[] {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return ["workflow contract must be an object"];

  if (root.schema_version !== "damm.dar-workflow/v1") errors.push("unexpected schema_version");
  if (root.workflow_id !== "dar-canonical-v1") errors.push("unexpected workflow_id");
  if (root.status !== "normative") errors.push("workflow is not normative");
  if (!sameStrings(root.required_launch_inputs, ["country"])) {
    errors.push("country must be the only required launch input");
  }

  const policy = record(root.execution_policy);
  if (!policy) {
    errors.push("execution_policy is missing");
  } else {
    if (policy.single_launch !== true) errors.push("workflow must use one launch");
    if (policy.immutable_input_snapshot !== true) errors.push("launch inputs must be immutable");
    if (!sameStrings(policy.required_human_actions_during_run, [])) {
      errors.push("active workflow must require no human actions");
    }
    if (!sameStrings(policy.allowed_active_states, ["queued", "running", "retrying"])) {
      errors.push("active workflow states must never wait for a person");
    }
    if (!sameStrings(policy.terminal_states, ["complete", "failed", "cancelled"])) {
      errors.push("workflow terminal states must settle without a human gate");
    }
    if (policy.late_input_policy !== "new_workflow_version") {
      errors.push("late inputs must start a new immutable workflow version");
    }
    if (policy.missing_optional_input_policy !== "autonomous_research_fallback") {
      errors.push("missing optional uploads must trigger autonomous research");
    }
    if (policy.budget_policy !== workflowJson.execution_policy.budget_policy) {
      errors.push("workflow budget policy does not match the normative contract");
    }
    const allocations = record(policy.fixed_stage_budget_allocations);
    const allocationEntries = Object.entries(CANONICAL_STAGE_BUDGET_ALLOCATIONS);
    if (
      !allocations ||
      Object.keys(allocations).length !== allocationEntries.length ||
      allocationEntries.some(([stageId, share]) => allocations[stageId] !== share)
    ) {
      errors.push("workflow stage budget allocations are not the protected canonical shares");
    } else {
      const total = Object.values(allocations).reduce<number>(
        (sum, share) => sum + (typeof share === "number" ? share : Number.NaN),
        0,
      );
      if (!Number.isFinite(total) || Math.abs(total - 1) > Number.EPSILON) {
        errors.push("workflow stage budget allocations must sum to the launch ceiling");
      }
    }
    if (policy.budget_exhaustion_policy !== "bounded_retry_then_terminal_failure") {
      errors.push("workflow budget exhaustion must settle without a human top-up");
    }
    if (policy.transient_failure_policy !== "bounded_automatic_retry") {
      errors.push("transient failures must retry automatically");
    }
    if (policy.post_completion_review_only !== true) {
      errors.push("human review must be post-completion only");
    }
    if (policy.output_lifecycle_state !== "draft") errors.push("workflow output must be a draft");
  }

  const stages = Array.isArray(root.stages) ? root.stages : [];
  if (stages.length !== CANONICAL_STAGE_IDS.length) {
    errors.push("workflow must contain exactly eight stages");
  }
  const seen = new Set<string>();
  stages.forEach((candidate, index) => {
    const stage = record(candidate);
    const expectedId = CANONICAL_STAGE_IDS[index];
    const normative = workflowJson.stages[index];
    if (!stage) {
      errors.push(`stage ${index + 1} must be an object`);
      return;
    }
    if (stage.ordinal !== index + 1) errors.push(`stage ${index + 1} has the wrong ordinal`);
    if (stage.id !== expectedId) errors.push(`stage ${index + 1} must be ${expectedId}`);
    if (stage.human_input_required !== false) {
      errors.push(`stage ${String(stage.id)} requires human input`);
    }
    if (
      typeof stage.fallback_when_optional_inputs_absent !== "string" ||
      stage.fallback_when_optional_inputs_absent.length === 0
    ) {
      errors.push(`stage ${String(stage.id)} has no missing-input fallback`);
    }
    const dependencies = Array.isArray(stage.depends_on) ? stage.depends_on : [];
    if (!sameStrings(stage.depends_on, normative?.depends_on ?? [])) {
      errors.push(`stage ${String(stage.id)} has the wrong dependency graph`);
    }
    if (!sameStrings(stage.required_artifacts, normative?.required_artifacts ?? [])) {
      errors.push(`stage ${String(stage.id)} has the wrong required artifacts`);
    }
    if (
      normative?.required_sections !== undefined &&
      !sameStrings(stage.required_sections, normative.required_sections)
    ) {
      errors.push(`stage ${String(stage.id)} has the wrong required sections`);
    }
    for (const dependency of dependencies) {
      if (typeof dependency !== "string" || !seen.has(dependency)) {
        errors.push(`stage ${String(stage.id)} depends on a stage that has not completed`);
      }
    }
    if (typeof stage.id === "string") seen.add(stage.id);
  });

  const optional = Array.isArray(root.optional_launch_inputs) ? root.optional_launch_inputs : [];
  if (optional.length !== workflowJson.optional_launch_inputs.length) {
    errors.push("workflow must expose exactly the five canonical optional document categories");
  }
  workflowJson.optional_launch_inputs.forEach((expected, index) => {
    const candidate = record(optional[index]);
    if (
      !candidate ||
      candidate.id !== expected.id ||
      !sameStrings(candidate.accepted_extensions, expected.accepted_extensions)
    ) {
      errors.push(`optional document category ${index + 1} does not match the canonical contract`);
    }
  });

  const exports = record(root.export_profiles);
  if (!exports) {
    errors.push("export profiles are missing");
  } else {
    if (!sameStrings(exports.narrative, ["md", "docx", "pdf", "html"])) {
      errors.push("narrative exports must include md, docx, pdf, and html");
    }
    if (!sameStrings(exports.structured, ["xlsx", "csv", "json"])) {
      errors.push("structured exports must include xlsx, csv, and json");
    }
    if (!sameStrings(exports.package, ["zip", "json"])) {
      errors.push("package exports must include zip and json");
    }
  }

  const post = record(root.post_completion);
  if (!post) {
    errors.push("post_completion policy is missing");
  } else {
    if (post.review_available_after_stage !== "export_package") {
      errors.push("review must remain unavailable until the export package is complete");
    }
    if (post.review_required_to_generate_draft !== false) {
      errors.push("draft generation must not wait for review");
    }
    if (post.review_required_for_final_or_publication !== true) {
      errors.push("finalization and publication must require review");
    }
  }

  return errors;
}

export function assertCanonicalWorkflow(value: unknown): asserts value is DarWorkflowContract {
  const violations = workflowContractViolations(value);
  if (violations.length) {
    throw new Error(`Invalid DAR workflow contract: ${violations.join("; ")}`);
  }
}

assertCanonicalWorkflow(workflowJson);

export const DAR_WORKFLOW: DarWorkflowContract = workflowJson;
export const DAR_WORKFLOW_SCHEMA = workflowSchemaJson;
export const DAR_WORKFLOW_EXPORT = exportManifestJson as DarWorkflowExportManifest;
export const DAR_WORKFLOW_SHA256 = DAR_WORKFLOW_EXPORT.sha256[WORKFLOW_CONTRACT_FILENAME];
export const DAR_WORKFLOW_SCHEMA_SHA256 = DAR_WORKFLOW_EXPORT.sha256[WORKFLOW_SCHEMA_FILENAME];
export const WORKFLOW_STAGES = DAR_WORKFLOW.stages;
export const WORKFLOW_STAGE_COUNT = CANONICAL_STAGE_IDS.length;

const SHA256 = /^[a-f0-9]{64}$/;
if (
  DAR_WORKFLOW_EXPORT.workflow_id !== DAR_WORKFLOW.workflow_id ||
  DAR_WORKFLOW_EXPORT.workflow_version !== DAR_WORKFLOW.workflow_version ||
  !SHA256.test(DAR_WORKFLOW_SHA256 ?? "") ||
  !SHA256.test(DAR_WORKFLOW_SCHEMA_SHA256 ?? "")
) {
  throw new Error("DAR workflow export manifest does not match the workflow contract");
}
