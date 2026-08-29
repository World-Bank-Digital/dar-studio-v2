import { createHash, randomUUID } from "node:crypto";

import { getSql, type Sql } from "../db.ts";
import {
  ApprovalPolicyError,
  assertGateDecisionAllowed,
  buildG2ReviewScope,
  deriveApprovalLifecycle,
  HUMAN_REVIEW_AFFIRMATIONS,
  type ApprovalActor,
  type ApprovalDecision,
  type ApprovalLifecycleState,
  type CanonicalJsonValue,
  type CanonicalObservationRow,
  type CanonicalReviewPayload,
  type G3AffirmationChecklist,
  type RecordedApprovalDecision,
} from "./approvals.ts";
import {
  DAMM_WORKFLOW_METHODOLOGY,
  methodologyIdentitiesMatch,
  methodologyMatchesCanonical,
  type WorkflowMethodologyIdentity,
} from "./methodology.ts";
import { model } from "./model.ts";
import {
  Stage8BoundaryVerificationError,
  verifyStoredStage8Boundary,
  type StoredWorkflowArtifact,
  type VerifiedStage8Boundary,
} from "./stage8-boundary.server.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "./workflow.ts";

export const APPROVAL_OBSERVATIONS_ARTIFACT_KEY = "data-damm_diagnostic-damm_observations-json";
export const APPROVAL_ASSESSMENT_INPUT_ARTIFACT_KEY = "assessment-input";
const PREVIOUS_DAMM_SOURCE_COMMIT = "92c6ffe8b331347bc05f345785fe409753401a24";
const PREVIOUS_DAMM_WORKFLOW_METHODOLOGY: Readonly<WorkflowMethodologyIdentity> = Object.freeze({
  ...DAMM_WORKFLOW_METHODOLOGY,
  sourceCommit: PREVIOUS_DAMM_SOURCE_COMMIT,
});

export type ApprovalStoreErrorCode =
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_PACKAGE"
  | "ARTIFACT_INTEGRITY"
  | "METHODOLOGY_UNVERIFIED"
  | "HISTORICAL_SOURCE_PIN"
  | "POLICY_VIOLATION"
  | "CONFLICT"
  | "INVALID_STATE";

export interface ApprovalStoreErrorValue {
  code: ApprovalStoreErrorCode | string;
  message: string;
}

export type ApprovalStoreResult<T> =
  { ok: true; value: T } | { ok: false; error: ApprovalStoreErrorValue };

class StoreRefusal extends Error {
  readonly code: ApprovalStoreErrorCode;

  constructor(code: ApprovalStoreErrorCode, message: string) {
    super(message);
    this.name = "StoreRefusal";
    this.code = code;
  }
}

export interface ApprovalScopeRow {
  indicatorId: string;
  rowSha256: string;
  reasons?: readonly string[];
}

export interface ApprovalPackage {
  id: string;
  runId: string;
  countryId: string;
  ownerUserId: string;
  artifactSetId: string;
  bundleSha256: string;
  observationsSha256: string;
  workflowId: string;
  workflowVersion: string;
  workflowContractSha256: string;
  methodology: WorkflowMethodologyIdentity;
  assessmentInputArtifactKey: string;
  assessmentInputSourcePath: string;
  assessmentInputSha256: string;
  machineRowCount: number;
  machineRowSetSha256: string;
  g1Scope: readonly ApprovalScopeRow[];
  g1ScopeSha256: string;
  g2Scope: readonly ApprovalScopeRow[];
  g2ScopeSha256: string;
  g2MandatoryRowCount: number;
  g2RemainderRowCount: number;
  g2SampleRowCount: number;
  targetIdentitySha256: string;
  completedAt: string;
  materializedAt: string;
  createdAt: string;
}

export interface ApprovalReviewRow {
  ordinal: number;
  rowId: string;
  indicatorId: string;
  indicatorName: string;
  rowSha256: string;
  classification: CanonicalObservationRow["classification"];
  prerequisite: boolean;
  payload: CanonicalReviewPayload;
  reasons?: readonly string[];
}

export type AssignedApprovalGate = "g1" | "g2";
export type AssignedApprovalRole = "assessor" | "independent_reviewer";

export interface ApprovalAssignment {
  id: string;
  packageId: string;
  targetIdentitySha256: string;
  gate: AssignedApprovalGate;
  reviewerUserId: string;
  reviewerName: string;
  reviewerEmail: string;
  declaredRole: AssignedApprovalRole;
  assignedByUserId: string;
  assignedByName: string;
  assignedByEmail: string;
  scope: readonly ApprovalScopeRow[];
  scopeSha256: string;
  assignedAt: string;
}

export interface ApprovalAssignmentSupersession {
  id: string;
  revokedAssignmentId: string;
  supersedingAssignmentId: string;
  packageId: string;
  targetIdentitySha256: string;
  gate: AssignedApprovalGate;
  revokedByUserId: string;
  revokedByName: string;
  revokedByEmail: string;
  reason: string;
  revokedAt: string;
}

export interface HumanApprovalDecision {
  id: string;
  packageId: string;
  targetIdentitySha256: string;
  assignmentId: string | null;
  gate: "g1" | "g2" | "g3";
  actorKind: "human";
  reviewerUserId: string;
  reviewerName: string;
  reviewerEmail: string;
  declaredRole: "assessor" | "independent_reviewer" | "ttl_country_owner";
  decision: ApprovalDecision;
  notes: string;
  reviewerAffirmation: boolean;
  reviewerAffirmationVersion: string | null;
  reviewerAffirmationText: string | null;
  reviewerAffirmationSha256: string | null;
  rowReviews: readonly StoredApprovalRowReview[];
  affirmations: Readonly<Record<string, boolean>>;
  decidedAt: string;
}

export interface ApprovalRelease {
  id: string;
  packageId: string;
  targetIdentitySha256: string;
  countryId: string;
  version: number;
  lifecycle: "approved_draft" | "canonical_final";
  externalCirculationAuthorized: true;
  g1DecisionId: string;
  g2DecisionId: string;
  g3DecisionId: string;
  manifest: Readonly<Record<string, CanonicalJsonValue>>;
  manifestSha256: string;
  createdAt: string;
}

export interface OwnerApprovalPackageHistoryEntry {
  packageId: string;
  runId: string;
  artifactSetId: string;
  bundleSha256: string;
  targetIdentitySha256: string;
  completedAt: string;
  sourceCommit: string;
  currentMethodology: boolean;
}

export interface OwnerApprovalState {
  package: ApprovalPackage;
  packageHistory: readonly OwnerApprovalPackageHistoryEntry[];
  rows: readonly ApprovalReviewRow[];
  assignments: readonly ApprovalAssignment[];
  assignmentSupersessions: readonly ApprovalAssignmentSupersession[];
  decisions: readonly HumanApprovalDecision[];
  release: ApprovalRelease | null;
  lifecycle: ApprovalLifecycleState;
}

export interface AssignedReview {
  package: ApprovalPackage;
  assignment: ApprovalAssignment;
  rows: readonly ApprovalReviewRow[];
  /** The authenticated reviewer may only receive the immutable decision for this assignment. */
  ownDecision: HumanApprovalDecision | null;
  lifecycle: ApprovalLifecycleState;
  canSubmit: boolean;
  lockedReason: string | null;
}

export interface ApprovalArtifactAccess {
  runId: string;
  artifactSetId: string;
  artifactKey: string;
  artifactSha256: string;
  artifactOwnerUserId: string;
  ownerUserId: string;
  bundleSha256: string;
  packageId: string | null;
  reviewerAssignmentId: string | null;
  targetIdentitySha256: string | null;
  accessAs: "country_owner" | "assigned_reviewer";
}

interface DbPackageRow {
  id: string;
  run_id: string;
  country_id: string;
  owner_user_id: string;
  artifact_set_id: string;
  bundle_sha256: string;
  observations_sha256: string;
  workflow_id: string;
  workflow_version: string;
  workflow_contract_sha256: string;
  manifest_schema_version: WorkflowMethodologyIdentity["manifestSchemaVersion"];
  damm_model_id: string;
  damm_model_version: string;
  damm_model_revision: number;
  damm_model_status: string;
  damm_model_ratified: boolean;
  damm_model_sha256: string;
  damm_model_schema_sha256: string;
  damm_source_repository: string;
  damm_source_commit: string;
  damm_source_model_path: string;
  damm_source_model_sha256: string;
  damm_source_schema_path: string;
  damm_source_schema_sha256: string;
  census_revision: string;
  census_path: string;
  census_sha256: string;
  engine_version: string;
  engine_path: string;
  engine_sha256: string;
  renderer_version: string;
  renderer_path: string;
  renderer_sha256: string;
  assessment_input_artifact_key: string;
  assessment_input_source_path: string;
  assessment_input_sha256: string;
  machine_row_count: number;
  machine_row_set_sha256: string;
  g1_scope_rows: unknown;
  g1_scope_sha256: string;
  g2_scope_rows: unknown;
  g2_scope_sha256: string;
  g2_mandatory_row_count: number;
  g2_remainder_row_count: number;
  g2_sample_row_count: number;
  target_identity_sha256: string;
  completed_at: Date | string;
  materialized_at: Date | string;
  created_at: Date | string;
}

interface DbApprovalRow {
  ordinal: number;
  indicator_id: string;
  row_sha256: string;
  classification: CanonicalObservationRow["classification"];
  prerequisite: boolean;
  /** Canonical database text; JSON numbers are parsed as exact display strings. */
  row_payload_canonical: string;
}

interface DbAssignmentRow {
  id: string;
  package_id: string;
  target_identity_sha256: string;
  gate: AssignedApprovalGate;
  reviewer_user_id: string;
  reviewer_name: string;
  reviewer_email: string;
  declared_role: AssignedApprovalRole;
  assigned_by_user_id: string;
  assigned_by_name: string;
  assigned_by_email: string;
  scope_rows: unknown;
  scope_sha256: string;
  active: boolean;
  assigned_at: Date | string;
}

interface DbAssignmentSupersessionRow {
  id: string;
  revoked_assignment_id: string;
  superseding_assignment_id: string;
  package_id: string;
  target_identity_sha256: string;
  gate: AssignedApprovalGate;
  revoked_by_user_id: string;
  revoked_by_name: string;
  revoked_by_email: string;
  reason: string;
  revoked_at: Date | string;
}

interface DbDecisionRow {
  id: string;
  package_id: string;
  target_identity_sha256: string;
  assignment_id: string | null;
  gate: HumanApprovalDecision["gate"];
  actor_kind: "human";
  reviewer_user_id: string;
  reviewer_name: string;
  reviewer_email: string;
  declared_role: HumanApprovalDecision["declaredRole"];
  decision: ApprovalDecision;
  notes: string;
  reviewer_affirmation: boolean;
  reviewer_affirmation_version: string | null;
  reviewer_affirmation_text: string | null;
  reviewer_affirmation_sha256: string | null;
  row_reviews: unknown;
  affirmations: unknown;
  decided_at: Date | string;
}

interface DbReleaseRow {
  id: string;
  package_id: string;
  target_identity_sha256: string;
  country_id: string;
  version_number: number;
  lifecycle: ApprovalRelease["lifecycle"];
  external_circulation_authorized: boolean;
  g1_decision_id: string;
  g2_decision_id: string;
  g3_decision_id: string;
  manifest_json: unknown;
  manifest_sha256: string;
  created_at: Date | string;
}

interface DbUser {
  id: string;
  name: string;
  email: string;
}

interface DbMethodologyRow {
  manifest_schema_version: string | null;
  model_id: string | null;
  model_version: string | null;
  model_revision: number | null;
  model_status: string | null;
  model_ratified: boolean | null;
  app_model_sha256: string | null;
  app_model_schema_sha256: string | null;
  source_repository: string | null;
  source_commit: string | null;
  source_model_path: string | null;
  source_model_sha256: string | null;
  source_schema_path: string | null;
  source_schema_sha256: string | null;
  census_revision: string | null;
  census_path: string | null;
  census_sha256: string | null;
  engine_version: string | null;
  engine_path: string | null;
  engine_sha256: string | null;
  renderer_version: string | null;
  renderer_path: string | null;
  renderer_sha256: string | null;
}

interface LatestCandidateRow extends DbMethodologyRow {
  run_id: string;
  country_id: string;
  country_name: string;
  iso3: string;
  ceiling_usd: number | string;
  vendor: string | null;
  owner_user_id: string;
  artifact_set_id: string | null;
  completed_at: Date | string | null;
  bundle_artifact_set_id: string | null;
  bundle_sha256: string | null;
  bundle_workflow_id: string | null;
  bundle_workflow_version: string | null;
  bundle_workflow_contract_sha256: string | null;
  bundle_model_version: string | null;
  bundle_model_revision: number | null;
  bundle_model_sha256: string | null;
  bundle_source_commit: string | null;
  bundle_assessment_input_sha256: string | null;
  bundle_content_verified_at: Date | string | null;
  observations_artifact_set_id: string | null;
  observations_sha256: string | null;
  observations_workflow_id: string | null;
  observations_workflow_version: string | null;
  observations_workflow_contract_sha256: string | null;
  observations_model_version: string | null;
  observations_model_revision: number | null;
  observations_model_sha256: string | null;
  observations_source_commit: string | null;
  observations_assessment_input_sha256: string | null;
  observations_content_verified_at: Date | string | null;
}

interface DbStoredWorkflowArtifactRow {
  run_id: string;
  artifact_set_id: string;
  artifact_key: string;
  relative_path: string;
  filename: string;
  content_type: string;
  sha256: string;
  byte_size: number;
  workflow_id: string;
  workflow_version: string;
  workflow_contract_sha256: string;
  damm_model_version: string | null;
  damm_model_revision: number | null;
  damm_model_sha256: string | null;
  damm_source_commit: string | null;
  assessment_input_sha256: string | null;
  content_verified_at: Date | string | null;
  content: unknown;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scopeRows(value: unknown): readonly ApprovalScopeRow[] {
  if (!Array.isArray(value))
    throw new StoreRefusal("INVALID_PACKAGE", "Invalid frozen review scope");
  return Object.freeze(
    value.map((item) => {
      const row = record(item);
      if (
        !row ||
        typeof row.indicatorId !== "string" ||
        typeof row.rowSha256 !== "string" ||
        (row.reasons !== undefined && !Array.isArray(row.reasons))
      ) {
        throw new StoreRefusal("INVALID_PACKAGE", "Invalid frozen review scope row");
      }
      return Object.freeze({
        indicatorId: row.indicatorId,
        rowSha256: row.rowSha256,
        ...(Array.isArray(row.reasons) ? { reasons: Object.freeze(row.reasons.map(String)) } : {}),
      });
    }),
  );
}

function jsonRecord(value: unknown): Readonly<Record<string, CanonicalJsonValue>> {
  const valueRecord = record(value);
  if (!valueRecord) throw new StoreRefusal("INVALID_PACKAGE", "Expected an immutable JSON object");
  return valueRecord as Readonly<Record<string, CanonicalJsonValue>>;
}

/**
 * Parse database-canonical JSON without passing number tokens through JavaScript's
 * binary64 representation. Review payload numerics are display-only, so retaining
 * their exact canonical spelling as strings is safer than rounding an unsafe integer
 * or changing exponent notation. The immutable database-derived row hash remains
 * authoritative.
 */
function exactJsonRecord(canonicalJson: string): Readonly<Record<string, CanonicalJsonValue>> {
  let quotedNumbers = "";
  for (let index = 0; index < canonicalJson.length;) {
    const character = canonicalJson[index];
    if (character === '"') {
      const start = index;
      index += 1;
      let closed = false;
      while (index < canonicalJson.length) {
        if (canonicalJson[index] === "\\") {
          index += 2;
        } else if (canonicalJson[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new StoreRefusal("INVALID_PACKAGE", "Stored row JSON is malformed");
      quotedNumbers += canonicalJson.slice(start, index);
      continue;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      const match = canonicalJson
        .slice(index)
        .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if (!match) throw new StoreRefusal("INVALID_PACKAGE", "Stored row number is malformed");
      quotedNumbers += JSON.stringify(match[0]);
      index += match[0].length;
      continue;
    }
    quotedNumbers += character;
    index += 1;
  }
  try {
    return jsonRecord(JSON.parse(quotedNumbers));
  } catch (error) {
    if (error instanceof StoreRefusal) throw error;
    throw new StoreRefusal("INVALID_PACKAGE", "Stored row JSON is malformed");
  }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stableJsonValue(child)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

type ApprovalTargetIdentitySource = Pick<
  ApprovalPackage,
  | "runId"
  | "artifactSetId"
  | "bundleSha256"
  | "observationsSha256"
  | "workflowId"
  | "workflowVersion"
  | "workflowContractSha256"
  | "methodology"
  | "assessmentInputArtifactKey"
  | "assessmentInputSourcePath"
  | "assessmentInputSha256"
  | "machineRowCount"
  | "machineRowSetSha256"
  | "g1ScopeSha256"
  | "g2ScopeSha256"
  | "completedAt"
>;

function buildApprovalTargetIdentity(source: ApprovalTargetIdentitySource) {
  return {
    schemaVersion: "damm.approval-package/v1",
    workflowRunId: source.runId,
    artifactSetId: source.artifactSetId,
    completeBundleSha256: source.bundleSha256,
    observationsArtifactKey: APPROVAL_OBSERVATIONS_ARTIFACT_KEY,
    observationsSha256: source.observationsSha256,
    workflow: {
      id: source.workflowId,
      version: source.workflowVersion,
      contractSha256: source.workflowContractSha256,
    },
    methodology: source.methodology,
    assessmentInputArtifactKey: source.assessmentInputArtifactKey,
    assessmentInputSourcePath: source.assessmentInputSourcePath,
    assessmentInputSha256: source.assessmentInputSha256,
    machineRowCount: source.machineRowCount,
    machineRowSetSha256: source.machineRowSetSha256,
    g1ScopeSha256: source.g1ScopeSha256,
    g2ScopeSha256: source.g2ScopeSha256,
    completedAt: source.completedAt,
  };
}

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string" && /^\\x[0-9a-f]*$/i.test(value)) {
    return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  }
  return null;
}

function verifiedBytes(value: unknown, byteSize: number | null, sha256: string | null): Uint8Array {
  const content = bytes(value);
  if (
    !content ||
    byteSize === null ||
    sha256 === null ||
    content.byteLength !== Number(byteSize) ||
    createHash("sha256").update(content).digest("hex") !== sha256
  ) {
    throw new StoreRefusal(
      "ARTIFACT_INTEGRITY",
      "Published Draft artifact bytes failed SHA-256 verification",
    );
  }
  return content;
}

function methodologyFromPackage(row: DbPackageRow): WorkflowMethodologyIdentity {
  return {
    manifestSchemaVersion: row.manifest_schema_version,
    modelId: row.damm_model_id,
    modelVersion: row.damm_model_version,
    modelRevision: Number(row.damm_model_revision),
    modelStatus: row.damm_model_status,
    modelRatified: row.damm_model_ratified,
    appModelSha256: row.damm_model_sha256,
    appModelSchemaSha256: row.damm_model_schema_sha256,
    sourceRepository: row.damm_source_repository,
    sourceCommit: row.damm_source_commit,
    sourceModelPath: row.damm_source_model_path,
    sourceModelSha256: row.damm_source_model_sha256,
    sourceSchemaPath: row.damm_source_schema_path,
    sourceSchemaSha256: row.damm_source_schema_sha256,
    censusRevision: row.census_revision,
    censusPath: row.census_path,
    censusSha256: row.census_sha256,
    engineVersion: row.engine_version,
    enginePath: row.engine_path,
    engineSha256: row.engine_sha256,
    rendererVersion: row.renderer_version,
    rendererPath: row.renderer_path,
    rendererSha256: row.renderer_sha256,
  };
}

function methodologyFromDbRow(row: DbMethodologyRow): WorkflowMethodologyIdentity | null {
  const values = [
    row.manifest_schema_version,
    row.model_id,
    row.model_version,
    row.model_revision,
    row.model_status,
    row.model_ratified,
    row.app_model_sha256,
    row.app_model_schema_sha256,
    row.source_repository,
    row.source_commit,
    row.source_model_path,
    row.source_model_sha256,
    row.source_schema_path,
    row.source_schema_sha256,
    row.census_revision,
    row.census_path,
    row.census_sha256,
    row.engine_version,
    row.engine_path,
    row.engine_sha256,
    row.renderer_version,
    row.renderer_path,
    row.renderer_sha256,
  ];
  if (values.some((value) => value === null)) return null;
  return {
    manifestSchemaVersion:
      row.manifest_schema_version as WorkflowMethodologyIdentity["manifestSchemaVersion"],
    modelId: row.model_id as string,
    modelVersion: row.model_version as string,
    modelRevision: Number(row.model_revision),
    modelStatus: row.model_status as string,
    modelRatified: row.model_ratified as boolean,
    appModelSha256: row.app_model_sha256 as string,
    appModelSchemaSha256: row.app_model_schema_sha256 as string,
    sourceRepository: row.source_repository as string,
    sourceCommit: row.source_commit as string,
    sourceModelPath: row.source_model_path as string,
    sourceModelSha256: row.source_model_sha256 as string,
    sourceSchemaPath: row.source_schema_path as string,
    sourceSchemaSha256: row.source_schema_sha256 as string,
    censusRevision: row.census_revision as string,
    censusPath: row.census_path as string,
    censusSha256: row.census_sha256 as string,
    engineVersion: row.engine_version as string,
    enginePath: row.engine_path as string,
    engineSha256: row.engine_sha256 as string,
    rendererVersion: row.renderer_version as string,
    rendererPath: row.renderer_path as string,
    rendererSha256: row.renderer_sha256 as string,
  };
}

function packageFromDb(row: DbPackageRow): ApprovalPackage {
  return Object.freeze({
    id: row.id,
    runId: row.run_id,
    countryId: row.country_id,
    ownerUserId: row.owner_user_id,
    artifactSetId: row.artifact_set_id,
    bundleSha256: row.bundle_sha256,
    observationsSha256: row.observations_sha256,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    workflowContractSha256: row.workflow_contract_sha256,
    methodology: Object.freeze(methodologyFromPackage(row)),
    assessmentInputArtifactKey: row.assessment_input_artifact_key,
    assessmentInputSourcePath: row.assessment_input_source_path,
    assessmentInputSha256: row.assessment_input_sha256,
    machineRowCount: Number(row.machine_row_count),
    machineRowSetSha256: row.machine_row_set_sha256,
    g1Scope: scopeRows(row.g1_scope_rows),
    g1ScopeSha256: row.g1_scope_sha256,
    g2Scope: scopeRows(row.g2_scope_rows),
    g2ScopeSha256: row.g2_scope_sha256,
    g2MandatoryRowCount: Number(row.g2_mandatory_row_count),
    g2RemainderRowCount: Number(row.g2_remainder_row_count),
    g2SampleRowCount: Number(row.g2_sample_row_count),
    targetIdentitySha256: row.target_identity_sha256,
    completedAt: iso(row.completed_at),
    materializedAt: iso(row.materialized_at),
    createdAt: iso(row.created_at),
  });
}

function rowFromDb(row: DbApprovalRow, reasons?: readonly string[]): ApprovalReviewRow {
  const indicatorName =
    indicatorNames.get(row.indicator_id) ??
    (candidateIndicatorPattern.test(row.indicator_id)
      ? `Unscored carried candidate ${row.indicator_id}`
      : undefined);
  if (!indicatorName) {
    throw new StoreRefusal(
      "METHODOLOGY_UNVERIFIED",
      `Unknown canonical indicator ${row.indicator_id}`,
    );
  }
  return Object.freeze({
    ordinal: Number(row.ordinal),
    rowId: row.indicator_id,
    indicatorId: row.indicator_id,
    indicatorName,
    rowSha256: row.row_sha256,
    classification: row.classification,
    prerequisite: row.prerequisite,
    payload: Object.freeze({ ...exactJsonRecord(row.row_payload_canonical) }),
    ...(reasons ? { reasons: Object.freeze([...reasons]) } : {}),
  });
}

function assignmentFromDb(row: DbAssignmentRow): ApprovalAssignment {
  return Object.freeze({
    id: row.id,
    packageId: row.package_id,
    targetIdentitySha256: row.target_identity_sha256,
    gate: row.gate,
    reviewerUserId: row.reviewer_user_id,
    reviewerName: row.reviewer_name,
    reviewerEmail: row.reviewer_email,
    declaredRole: row.declared_role,
    assignedByUserId: row.assigned_by_user_id,
    assignedByName: row.assigned_by_name,
    assignedByEmail: row.assigned_by_email,
    scope: scopeRows(row.scope_rows),
    scopeSha256: row.scope_sha256,
    assignedAt: iso(row.assigned_at),
  });
}

function assignmentSupersessionFromDb(
  row: DbAssignmentSupersessionRow,
): ApprovalAssignmentSupersession {
  return Object.freeze({
    id: row.id,
    revokedAssignmentId: row.revoked_assignment_id,
    supersedingAssignmentId: row.superseding_assignment_id,
    packageId: row.package_id,
    targetIdentitySha256: row.target_identity_sha256,
    gate: row.gate,
    revokedByUserId: row.revoked_by_user_id,
    revokedByName: row.revoked_by_name,
    revokedByEmail: row.revoked_by_email,
    reason: row.reason,
    revokedAt: iso(row.revoked_at),
  });
}

export interface StoredApprovalRowReview {
  indicatorId: string;
  rowSha256: string;
  decision: ApprovalDecision;
  notes: string;
}

function storedRowReviews(value: unknown): readonly StoredApprovalRowReview[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.map((item) => {
      const itemRecord = record(item);
      if (
        !itemRecord ||
        typeof itemRecord.indicatorId !== "string" ||
        typeof itemRecord.rowSha256 !== "string" ||
        (itemRecord.decision !== "approved" && itemRecord.decision !== "revisions_required")
      ) {
        throw new StoreRefusal("INVALID_STATE", "Stored row review is invalid");
      }
      return Object.freeze({
        indicatorId: itemRecord.indicatorId,
        rowSha256: itemRecord.rowSha256,
        decision: itemRecord.decision,
        notes: typeof itemRecord.notes === "string" ? itemRecord.notes : "",
      });
    }),
  );
}

function decisionFromDb(row: DbDecisionRow): HumanApprovalDecision {
  const expectedAffirmation = row.gate === "g3" ? null : HUMAN_REVIEW_AFFIRMATIONS[row.gate];
  if (
    (expectedAffirmation &&
      (row.reviewer_affirmation_version !== expectedAffirmation.version ||
        row.reviewer_affirmation_text !== expectedAffirmation.text ||
        row.reviewer_affirmation_sha256 !== expectedAffirmation.sha256)) ||
    (!expectedAffirmation &&
      (row.reviewer_affirmation_version !== null ||
        row.reviewer_affirmation_text !== null ||
        row.reviewer_affirmation_sha256 !== null))
  ) {
    throw new StoreRefusal(
      "INVALID_STATE",
      "Stored approval decision has an invalid versioned human affirmation",
    );
  }
  const affirmationRecord = record(row.affirmations) ?? {};
  const affirmations = Object.fromEntries(
    Object.entries(affirmationRecord).map(([key, value]) => [key, value === true]),
  );
  return Object.freeze({
    id: row.id,
    packageId: row.package_id,
    targetIdentitySha256: row.target_identity_sha256,
    assignmentId: row.assignment_id,
    gate: row.gate,
    actorKind: "human",
    reviewerUserId: row.reviewer_user_id,
    reviewerName: row.reviewer_name,
    reviewerEmail: row.reviewer_email,
    declaredRole: row.declared_role,
    decision: row.decision,
    notes: row.notes,
    reviewerAffirmation: row.reviewer_affirmation,
    reviewerAffirmationVersion: row.reviewer_affirmation_version,
    reviewerAffirmationText: row.reviewer_affirmation_text,
    reviewerAffirmationSha256: row.reviewer_affirmation_sha256,
    rowReviews: storedRowReviews(row.row_reviews),
    affirmations: Object.freeze(affirmations),
    decidedAt: iso(row.decided_at),
  });
}

function releaseFromDb(row: DbReleaseRow): ApprovalRelease {
  if (!row.external_circulation_authorized) {
    throw new StoreRefusal("INVALID_STATE", "Stored G3 release lacks circulation authorization");
  }
  if (sha256Json(row.manifest_json) !== row.manifest_sha256) {
    throw new StoreRefusal("INVALID_STATE", "Stored release manifest failed SHA-256 verification");
  }
  return Object.freeze({
    id: row.id,
    packageId: row.package_id,
    targetIdentitySha256: row.target_identity_sha256,
    countryId: row.country_id,
    version: Number(row.version_number),
    lifecycle: row.lifecycle,
    externalCirculationAuthorized: true,
    g1DecisionId: row.g1_decision_id,
    g2DecisionId: row.g2_decision_id,
    g3DecisionId: row.g3_decision_id,
    manifest: Object.freeze({ ...jsonRecord(row.manifest_json) }),
    manifestSha256: row.manifest_sha256,
    createdAt: iso(row.created_at),
  });
}

function policyDecision(decision: HumanApprovalDecision): RecordedApprovalDecision {
  return {
    gate: decision.gate.toUpperCase() as RecordedApprovalDecision["gate"],
    decision: decision.decision,
    actor: {
      kind: "human",
      authenticated: true,
      authUserId: decision.reviewerUserId,
      displayName: decision.reviewerName,
      declaredRole: decision.declaredRole,
    },
    decidedAt: decision.decidedAt,
    ...(decision.gate === "g3" ? { g3Affirmations: decision.affirmations } : {}),
  };
}

function approvalLifecycle(
  approvalPackage: ApprovalPackage,
  assignments: readonly ApprovalAssignment[],
  decisions: readonly HumanApprovalDecision[],
): ApprovalLifecycleState {
  return deriveApprovalLifecycle({
    reviewStarted: assignments.length > 0 || decisions.length > 0,
    decisions: decisions.map(policyDecision),
    countryOwnerUserId: approvalPackage.ownerUserId,
    methodologyStatus: methodologyMatchesCanonical(approvalPackage.methodology)
      ? "canonical"
      : "historical_verified",
    methodologyModelStatus: approvalPackage.methodology.modelStatus,
    methodologyRatified: approvalPackage.methodology.modelRatified,
  });
}

function buildReleaseManifest(input: {
  releaseId: string;
  approvalPackage: ApprovalPackage;
  version: number;
  lifecycle: ApprovalRelease["lifecycle"];
  g1: HumanApprovalDecision;
  g2: HumanApprovalDecision;
  g3: HumanApprovalDecision;
}): Readonly<Record<string, CanonicalJsonValue>> {
  const { releaseId, approvalPackage, version, lifecycle, g1, g2, g3 } = input;
  return stableJsonValue({
    schemaVersion: "damm.approval-release/v1",
    releaseId,
    packageId: approvalPackage.id,
    targetIdentitySha256: approvalPackage.targetIdentitySha256,
    countryId: approvalPackage.countryId,
    version,
    lifecycle,
    externalCirculationAuthorized: true,
    runId: approvalPackage.runId,
    artifactSetId: approvalPackage.artifactSetId,
    bundleSha256: approvalPackage.bundleSha256,
    observationsSha256: approvalPackage.observationsSha256,
    workflowContractVersion: approvalPackage.workflowVersion,
    workflowContractSha256: approvalPackage.workflowContractSha256,
    methodology: approvalPackage.methodology,
    assessmentInputArtifactKey: approvalPackage.assessmentInputArtifactKey,
    assessmentInputSourcePath: approvalPackage.assessmentInputSourcePath,
    assessmentInputSha256: approvalPackage.assessmentInputSha256,
    g1DecisionId: g1.id,
    g2DecisionId: g2.id,
    g3DecisionId: g3.id,
    approvals: {
      g1: {
        decisionId: g1.id,
        decision: g1.decision,
        reviewerUserId: g1.reviewerUserId,
        reviewerName: g1.reviewerName,
        reviewerEmail: g1.reviewerEmail,
        declaredRole: g1.declaredRole,
        decidedAt: g1.decidedAt,
        notes: g1.notes,
        affirmationVersion: g1.reviewerAffirmationVersion,
        affirmationText: g1.reviewerAffirmationText,
        affirmationSha256: g1.reviewerAffirmationSha256,
      },
      g2: {
        decisionId: g2.id,
        decision: g2.decision,
        reviewerUserId: g2.reviewerUserId,
        reviewerName: g2.reviewerName,
        reviewerEmail: g2.reviewerEmail,
        declaredRole: g2.declaredRole,
        decidedAt: g2.decidedAt,
        notes: g2.notes,
        affirmationVersion: g2.reviewerAffirmationVersion,
        affirmationText: g2.reviewerAffirmationText,
        affirmationSha256: g2.reviewerAffirmationSha256,
      },
      g3: {
        decisionId: g3.id,
        decision: g3.decision,
        reviewerUserId: g3.reviewerUserId,
        reviewerName: g3.reviewerName,
        reviewerEmail: g3.reviewerEmail,
        declaredRole: g3.declaredRole,
        decidedAt: g3.decidedAt,
        notes: g3.notes,
        affirmations: g3.affirmations,
      },
    },
  }) as Readonly<Record<string, CanonicalJsonValue>>;
}

function verifyReleaseReadIntegrity(
  release: ApprovalRelease,
  approvalPackage: ApprovalPackage,
  decisions: readonly HumanApprovalDecision[],
): void {
  const g1 = decisions.find((decision) => decision.id === release.g1DecisionId);
  const g2 = decisions.find((decision) => decision.id === release.g2DecisionId);
  const g3 = decisions.find((decision) => decision.id === release.g3DecisionId);
  if (
    !g1 ||
    !g2 ||
    !g3 ||
    g1.gate !== "g1" ||
    g2.gate !== "g2" ||
    g3.gate !== "g3" ||
    g1.decision !== "approved" ||
    g2.decision !== "approved" ||
    g3.decision !== "approved" ||
    [g1, g2, g3].some(
      (decision) =>
        decision.packageId !== approvalPackage.id ||
        decision.targetIdentitySha256 !== approvalPackage.targetIdentitySha256,
    ) ||
    release.packageId !== approvalPackage.id ||
    release.targetIdentitySha256 !== approvalPackage.targetIdentitySha256 ||
    release.countryId !== approvalPackage.countryId
  ) {
    throw new StoreRefusal("INVALID_STATE", "Release decisions do not match their exact package");
  }
  const expected = buildReleaseManifest({
    releaseId: release.id,
    approvalPackage,
    version: release.version,
    lifecycle: release.lifecycle,
    g1,
    g2,
    g3,
  });
  if (
    stableJson(expected) !== stableJson(release.manifest) ||
    sha256Json(expected) !== release.manifestSha256
  ) {
    throw new StoreRefusal(
      "INVALID_STATE",
      "Release manifest semantics do not match the immutable package and decisions",
    );
  }
}

function databaseError(error: unknown): ApprovalStoreErrorValue {
  if (error instanceof StoreRefusal) return { code: error.code, message: error.message };
  if (error instanceof ApprovalPolicyError) {
    return { code: error.code, message: error.message };
  }
  const candidate = error as { code?: string; message?: string };
  const message = candidate?.message ?? "Human approval operation failed";
  if (candidate?.code === "23505" || candidate?.code === "40001") {
    return { code: "CONFLICT", message: "Another immutable approval record won this operation" };
  }
  if (candidate?.code === "42501") return { code: "FORBIDDEN", message };
  if (candidate?.code === "28000") return { code: "AUTH_REQUIRED", message };
  if (candidate?.code === "22000" || candidate?.code === "23514") {
    return { code: "INVALID_INPUT", message };
  }
  if (candidate?.code === "55000" || candidate?.code === "23503") {
    return { code: "INVALID_STATE", message };
  }
  return { code: "INVALID_STATE", message };
}

async function resultOf<T>(operation: () => Promise<T>): Promise<ApprovalStoreResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: databaseError(error) };
  }
}

function requireHumanId(userId: string): void {
  if (!userId.trim() || userId === "dev-user") {
    throw new StoreRefusal(
      "AUTH_REQUIRED",
      "Human approval requires a registered Better Auth identity; preview dev-user is not eligible",
    );
  }
}

function requireApprovalDecision(value: unknown): asserts value is ApprovalDecision {
  if (value !== "approved" && value !== "revisions_required") {
    throw new StoreRefusal("INVALID_INPUT", "Approval decision is invalid");
  }
}

function requireNotes(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 5000) {
    throw new StoreRefusal("INVALID_INPUT", "Approval notes must be at most 5,000 characters");
  }
}

async function registeredUser(userId: string, sql: Sql): Promise<DbUser> {
  requireHumanId(userId);
  const rows = await sql.query<DbUser>(
    `select "id" as id, "name" as name, "email" as email
     from "user" where "id" = $1 and "id" <> 'dev-user' limit 1`,
    [userId],
  );
  if (!rows[0]) {
    throw new StoreRefusal("AUTH_REQUIRED", "Human approval identity is not a registered user");
  }
  return rows[0];
}

async function lockActiveCountryOwnership(
  approvalPackage: ApprovalPackage,
  ownerUserId: string,
  sql: Sql,
): Promise<void> {
  const rows = await sql.query<{ id: string }>(
    `select id from countries
     where id = $1 and user_id = $2 and deleted_at is null
     limit 1 for update`,
    [approvalPackage.countryId, ownerUserId],
  );
  if (!rows[0]) {
    throw new StoreRefusal(
      "FORBIDDEN",
      "This package owner is no longer the active owner of the country workspace",
    );
  }
}

async function latestCandidate(countryId: string, ownerUserId: string, sql: Sql) {
  const rows = await sql.query<LatestCandidateRow>(
    `select workflow_run.id as run_id, workflow_run.country_id,
            workflow_run.country_name, upper(workflow_run.iso3) as iso3,
            workflow_run.ceiling_usd, workflow_run.vendor,
            workflow_run.user_id as owner_user_id,
            workflow_run.workflow_artifact_set_id as artifact_set_id,
            workflow_run.finished_at as completed_at,
            methodology.manifest_schema_version, methodology.model_id,
            methodology.model_version, methodology.model_revision,
            methodology.model_status, methodology.model_ratified,
            methodology.app_model_sha256, methodology.app_model_schema_sha256,
            methodology.source_repository, methodology.source_commit,
            methodology.source_model_path, methodology.source_model_sha256,
            methodology.source_schema_path, methodology.source_schema_sha256,
            methodology.census_revision, methodology.census_path, methodology.census_sha256,
            methodology.engine_version, methodology.engine_path, methodology.engine_sha256,
            methodology.renderer_version, methodology.renderer_path, methodology.renderer_sha256,
            bundle.artifact_set_id as bundle_artifact_set_id,
            bundle.sha256 as bundle_sha256, bundle.workflow_id as bundle_workflow_id,
            bundle.workflow_version as bundle_workflow_version,
            bundle.workflow_contract_sha256 as bundle_workflow_contract_sha256,
            bundle.damm_model_version as bundle_model_version,
            bundle.damm_model_revision as bundle_model_revision,
            bundle.damm_model_sha256 as bundle_model_sha256,
            bundle.damm_source_commit as bundle_source_commit,
            bundle.assessment_input_sha256 as bundle_assessment_input_sha256,
            bundle.content_verified_at as bundle_content_verified_at,
            observations.artifact_set_id as observations_artifact_set_id,
            observations.sha256 as observations_sha256,
            observations.workflow_id as observations_workflow_id,
            observations.workflow_version as observations_workflow_version,
            observations.workflow_contract_sha256 as observations_workflow_contract_sha256,
            observations.damm_model_version as observations_model_version,
            observations.damm_model_revision as observations_model_revision,
            observations.damm_model_sha256 as observations_model_sha256,
            observations.damm_source_commit as observations_source_commit,
            observations.assessment_input_sha256 as observations_assessment_input_sha256,
            observations.content_verified_at as observations_content_verified_at
     from runs workflow_run
     join countries country
       on country.id = workflow_run.country_id
      and country.id = $1 and country.user_id = $2 and country.deleted_at is null
     left join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
     left join workflow_run_artifacts bundle
       on bundle.run_id = workflow_run.id
      and bundle.artifact_set_id = workflow_run.workflow_artifact_set_id
      and bundle.artifact_key = 'bundle'
     left join workflow_run_artifacts observations
       on observations.run_id = workflow_run.id
      and observations.artifact_set_id = workflow_run.workflow_artifact_set_id
      and observations.artifact_key = $3
     where workflow_run.user_id = $2 and workflow_run.pass = 'workflow'
       and workflow_run.status = 'done'
     order by workflow_run.finished_at desc nulls last, workflow_run.created_at desc
     limit 1
     for update of workflow_run`,
    [countryId, ownerUserId, APPROVAL_OBSERVATIONS_ARTIFACT_KEY],
  );
  if (!rows[0]) {
    throw new StoreRefusal("NOT_FOUND", "No completed Stage 8 Draft exists for this country");
  }
  return rows[0];
}

async function verifyCompleteStoredArtifactSet(
  candidate: LatestCandidateRow,
  methodology: WorkflowMethodologyIdentity,
  assessmentInputSha256: string,
  sql: Sql,
): Promise<VerifiedStage8Boundary> {
  if (!candidate.artifact_set_id) {
    throw new StoreRefusal("INVALID_PACKAGE", "Completed workflow has no artifact-set identity");
  }
  // latestCandidate already holds the parent run lock. Lock the complete selected set
  // next, in primary-key order, so byte verification and immutable package insertion
  // share the same run -> artifact ordering as staging and publication.
  const rows = await sql.query<DbStoredWorkflowArtifactRow>(
    `select run_id, artifact_set_id, artifact_key, relative_path, filename, content_type,
            sha256, byte_size, workflow_id, workflow_version, workflow_contract_sha256,
            damm_model_version, damm_model_revision, damm_model_sha256,
            damm_source_commit, assessment_input_sha256, content_verified_at, content
     from workflow_run_artifacts
     where run_id = $1 and artifact_set_id = $2
     order by artifact_key
     for update`,
    [candidate.run_id, candidate.artifact_set_id],
  );
  const artifacts: StoredWorkflowArtifact[] = rows.map((row) => {
    if (
      row.damm_model_version !== methodology.modelVersion ||
      Number(row.damm_model_revision) !== methodology.modelRevision ||
      row.damm_model_sha256 !== methodology.appModelSha256 ||
      row.damm_source_commit !== methodology.sourceCommit ||
      row.assessment_input_sha256 !== assessmentInputSha256 ||
      row.content_verified_at === null
    ) {
      throw new StoreRefusal(
        "METHODOLOGY_UNVERIFIED",
        `Draft artifact ${row.artifact_key} lacks the exact canonical methodology identity`,
      );
    }
    const content = bytes(row.content);
    if (!content) {
      throw new StoreRefusal(
        "ARTIFACT_INTEGRITY",
        `Draft artifact ${row.artifact_key} has unavailable stored bytes`,
      );
    }
    return {
      runId: row.run_id,
      artifactSetId: row.artifact_set_id,
      artifactKey: row.artifact_key,
      relativePath: row.relative_path,
      filename: row.filename,
      contentType: row.content_type,
      sha256: row.sha256,
      byteSize: Number(row.byte_size),
      workflowId: row.workflow_id,
      workflowVersion: row.workflow_version,
      workflowContractSha256: row.workflow_contract_sha256,
      content,
    };
  });
  try {
    const boundary = await verifyStoredStage8Boundary(
      {
        runId: candidate.run_id,
        artifactSetId: candidate.artifact_set_id,
        pass: "workflow",
        status: "done",
        countryName: candidate.country_name,
        iso3: candidate.iso3,
        ceilingUsd: Number(candidate.ceiling_usd),
        vendor: candidate.vendor,
        workflowId: DAR_WORKFLOW.workflow_id,
        workflowVersion: DAR_WORKFLOW.workflow_version,
        workflowContractSha256: DAR_WORKFLOW_SHA256,
      },
      artifacts,
    );
    if (
      boundary.bundleSha256 !== candidate.bundle_sha256 ||
      boundary.assessmentInputArtifactKey !== APPROVAL_ASSESSMENT_INPUT_ARTIFACT_KEY ||
      boundary.assessmentInputSha256 !== assessmentInputSha256
    ) {
      throw new StoreRefusal(
        "ARTIFACT_INTEGRITY",
        "The verified Stage 8 package identity differs from its approval candidate",
      );
    }
    return boundary;
  } catch (error) {
    if (error instanceof StoreRefusal) throw error;
    if (error instanceof Stage8BoundaryVerificationError) {
      throw new StoreRefusal(
        error.code === "INVALID_ARTIFACT_BYTES" ? "ARTIFACT_INTEGRITY" : "INVALID_PACKAGE",
        `Stage 8 Draft verification failed: ${error.message}`,
      );
    }
    throw error;
  }
}

function verifyCandidate(
  candidate: LatestCandidateRow,
  expectedMethodology: WorkflowMethodologyIdentity = DAMM_WORKFLOW_METHODOLOGY,
): {
  methodology: WorkflowMethodologyIdentity;
  assessmentInputSha256: string;
  completedAt: string;
} {
  const methodology = methodologyFromDbRow(candidate);
  if (!methodology || !methodologyIdentitiesMatch(methodology, expectedMethodology)) {
    throw new StoreRefusal(
      "METHODOLOGY_UNVERIFIED",
      "Legacy or methodology-unverified Draft packages cannot enter the canonical approval chain",
    );
  }
  if (!candidate.artifact_set_id || !candidate.completed_at) {
    throw new StoreRefusal(
      "INVALID_PACKAGE",
      "Completed workflow has no immutable published artifact set",
    );
  }
  const artifactsMatch =
    candidate.bundle_artifact_set_id === candidate.artifact_set_id &&
    candidate.observations_artifact_set_id === candidate.artifact_set_id &&
    candidate.bundle_workflow_id === DAR_WORKFLOW.workflow_id &&
    candidate.observations_workflow_id === DAR_WORKFLOW.workflow_id &&
    candidate.bundle_workflow_version === DAR_WORKFLOW.workflow_version &&
    candidate.observations_workflow_version === DAR_WORKFLOW.workflow_version &&
    candidate.bundle_workflow_contract_sha256 === DAR_WORKFLOW_SHA256 &&
    candidate.observations_workflow_contract_sha256 === DAR_WORKFLOW_SHA256 &&
    candidate.bundle_model_version === methodology.modelVersion &&
    candidate.observations_model_version === methodology.modelVersion &&
    Number(candidate.bundle_model_revision) === methodology.modelRevision &&
    Number(candidate.observations_model_revision) === methodology.modelRevision &&
    candidate.bundle_model_sha256 === methodology.appModelSha256 &&
    candidate.observations_model_sha256 === methodology.appModelSha256 &&
    candidate.bundle_source_commit === methodology.sourceCommit &&
    candidate.observations_source_commit === methodology.sourceCommit &&
    typeof candidate.bundle_assessment_input_sha256 === "string" &&
    candidate.bundle_assessment_input_sha256 === candidate.observations_assessment_input_sha256 &&
    candidate.bundle_content_verified_at !== null &&
    candidate.observations_content_verified_at !== null;
  if (!artifactsMatch) {
    throw new StoreRefusal(
      "METHODOLOGY_UNVERIFIED",
      "Draft artifacts do not carry one complete canonical workflow and methodology identity",
    );
  }
  const assessmentInputSha256 = candidate.bundle_assessment_input_sha256;
  if (typeof assessmentInputSha256 !== "string") {
    throw new StoreRefusal("INVALID_PACKAGE", "Draft has no immutable assessment-input digest");
  }
  return {
    methodology,
    assessmentInputSha256,
    completedAt: iso(candidate.completed_at),
  };
}

const candidateIndicatorPattern = new RegExp(model.candidate_indicators.id_pattern);
const indicatorNames = new Map(model.indicators.map((indicator) => [indicator.id, indicator.name]));

async function packageRows(packageId: string, sql: Sql): Promise<ApprovalReviewRow[]> {
  const rows = await sql.query<DbApprovalRow>(
    `select ordinal, indicator_id, row_sha256, classification, prerequisite,
            canonical_human_approval_json_v1(row_payload) as row_payload_canonical
     from workflow_approval_rows where package_id = $1 order by ordinal`,
    [packageId],
  );
  return rows.map((row) => rowFromDb(row));
}

/**
 * The database function is the versioned authority for persisted row identity. It
 * parses JSON numbers losslessly as PostgreSQL numerics, so application materialization
 * cannot diverge on values such as `18.0`, `1e-7`, or unsafe JavaScript integers.
 */
async function expectedApprovalRows(
  assessmentInputContent: Uint8Array,
  sql: Sql,
): Promise<ApprovalReviewRow[]> {
  const rows = await sql.query<DbApprovalRow>(
    `select ordinal, indicator_id, row_sha256, classification, prerequisite,
            canonical_human_approval_json_v1(row_payload) as row_payload_canonical
     from expected_human_approval_rows_v1($1::bytea)
     order by ordinal`,
    [assessmentInputContent],
  );
  return rows.map((row) => rowFromDb(row));
}

async function packageAssignments(packageId: string, sql: Sql): Promise<ApprovalAssignment[]> {
  const rows = await sql.query<DbAssignmentRow>(
    `select assignment.*
     from workflow_approval_assignments assignment
     where assignment.package_id = $1
       and assignment.active
       and not exists (
         select 1 from workflow_approval_assignment_supersessions supersession
         where supersession.revoked_assignment_id = assignment.id
       )
     order by assignment.assigned_at, assignment.gate`,
    [packageId],
  );
  return rows.map(assignmentFromDb);
}

async function packageAssignmentSupersessions(
  packageId: string,
  sql: Sql,
): Promise<ApprovalAssignmentSupersession[]> {
  const rows = await sql.query<DbAssignmentSupersessionRow>(
    `select * from workflow_approval_assignment_supersessions
     where package_id = $1 order by revoked_at, id`,
    [packageId],
  );
  return rows.map(assignmentSupersessionFromDb);
}

async function packageDecisions(packageId: string, sql: Sql): Promise<HumanApprovalDecision[]> {
  const rows = await sql.query<DbDecisionRow>(
    `select * from workflow_approval_decisions where package_id = $1 order by decided_at, gate`,
    [packageId],
  );
  return rows.map(decisionFromDb);
}

async function packageRelease(packageId: string, sql: Sql): Promise<ApprovalRelease | null> {
  const rows = await sql.query<DbReleaseRow>(
    `select * from workflow_approval_releases where package_id = $1 limit 1`,
    [packageId],
  );
  return rows[0] ? releaseFromDb(rows[0]) : null;
}

function exactScopeForRows(rows: readonly ApprovalReviewRow[]): readonly ApprovalScopeRow[] {
  return rows.map((row) => ({ indicatorId: row.indicatorId, rowSha256: row.rowSha256 }));
}

async function verifyPackageReadIntegrity(
  approvalPackage: ApprovalPackage,
  rows: readonly ApprovalReviewRow[],
  sql: Sql,
): Promise<void> {
  const frozenMethodologies = await sql.query<DbMethodologyRow>(
    `select manifest_schema_version, model_id, model_version, model_revision,
            model_status, model_ratified, app_model_sha256, app_model_schema_sha256,
            source_repository, source_commit, source_model_path, source_model_sha256,
            source_schema_path, source_schema_sha256, census_revision, census_path,
            census_sha256, engine_version, engine_path, engine_sha256,
            renderer_version, renderer_path, renderer_sha256
     from workflow_run_methodology where run_id = $1 limit 1`,
    [approvalPackage.runId],
  );
  const frozenMethodology = frozenMethodologies[0]
    ? methodologyFromDbRow(frozenMethodologies[0])
    : null;
  if (
    !frozenMethodology ||
    !methodologyIdentitiesMatch(approvalPackage.methodology, frozenMethodology)
  ) {
    throw new StoreRefusal(
      "METHODOLOGY_UNVERIFIED",
      "Approval package methodology does not match its immutable workflow launch identity",
    );
  }
  if (rows.length !== approvalPackage.machineRowCount) {
    throw new StoreRefusal("INVALID_STATE", "Approval package row count failed verification");
  }
  const assessmentInputArtifacts = await sql.query<{
    content: unknown;
    byte_size: number;
    sha256: string;
    relative_path: string;
  }>(
    `select content, byte_size, sha256, relative_path from workflow_run_artifacts
     where run_id = $1 and artifact_set_id = $2 and artifact_key = $3 and sha256 = $4
     limit 1`,
    [
      approvalPackage.runId,
      approvalPackage.artifactSetId,
      approvalPackage.assessmentInputArtifactKey,
      approvalPackage.assessmentInputSha256,
    ],
  );
  const assessmentInputArtifact = assessmentInputArtifacts[0];
  if (
    !assessmentInputArtifact ||
    assessmentInputArtifact.relative_path !== approvalPackage.assessmentInputSourcePath
  ) {
    throw new StoreRefusal("INVALID_STATE", "Exact Stage 1 assessment input is unavailable");
  }
  const assessmentInputBytes = verifiedBytes(
    assessmentInputArtifact.content,
    assessmentInputArtifact.byte_size,
    assessmentInputArtifact.sha256,
  );
  const canonical = await expectedApprovalRows(assessmentInputBytes, sql);
  if (canonical.length !== rows.length) {
    throw new StoreRefusal(
      "INVALID_STATE",
      "Approval rows differ from the Stage 1 artifact row set",
    );
  }
  for (const [index, row] of rows.entries()) {
    const expected = canonical[index];
    if (
      !expected ||
      expected.indicatorId !== row.indicatorId ||
      expected.rowSha256 !== row.rowSha256 ||
      expected.classification !== row.classification ||
      expected.prerequisite !== row.prerequisite ||
      stableJson(expected.payload) !== stableJson(row.payload)
    ) {
      throw new StoreRefusal(
        "INVALID_STATE",
        `Approval row ${row.indicatorId} failed hash verification`,
      );
    }
  }
  const machineRowSetSha256 = sha256Json(
    rows.map((row) => ({
      indicatorId: row.indicatorId,
      rowSha256: row.rowSha256,
      classification: row.classification,
      prerequisite: row.prerequisite,
    })),
  );
  const expectedG1 = exactScopeForRows(rows);
  const g2Protocol = buildG2ReviewScope(canonical, approvalPackage.bundleSha256);
  const expectedG2: readonly ApprovalScopeRow[] = g2Protocol.rows.map((row) => ({
    indicatorId: row.indicatorId,
    rowSha256: row.rowSha256,
    reasons: [...row.reasons],
  }));
  const mandatoryCount = new Set([...g2Protocol.prerequisiteRowIds, ...g2Protocol.judgedRowIds])
    .size;
  if (
    machineRowSetSha256 !== approvalPackage.machineRowSetSha256 ||
    sha256Json(expectedG1) !== approvalPackage.g1ScopeSha256 ||
    stableJson(expectedG1) !== stableJson(approvalPackage.g1Scope) ||
    sha256Json(expectedG2) !== approvalPackage.g2ScopeSha256 ||
    stableJson(expectedG2) !== stableJson(approvalPackage.g2Scope) ||
    mandatoryCount !== approvalPackage.g2MandatoryRowCount ||
    g2Protocol.remainderCount !== approvalPackage.g2RemainderRowCount ||
    g2Protocol.sampleSize !== approvalPackage.g2SampleRowCount
  ) {
    throw new StoreRefusal("INVALID_STATE", "Frozen G1/G2 package scopes failed verification");
  }
  if (
    sha256Json(buildApprovalTargetIdentity(approvalPackage)) !==
    approvalPackage.targetIdentitySha256
  ) {
    throw new StoreRefusal("INVALID_STATE", "Approval package target identity failed verification");
  }
}

function requireCurrentApprovalActivity(approvalPackage: ApprovalPackage): void {
  if (!methodologyMatchesCanonical(approvalPackage.methodology)) {
    throw new StoreRefusal(
      "METHODOLOGY_UNVERIFIED",
      "This historical Draft package remains audit-readable, but new approval activity requires the current methodology",
    );
  }
}

async function packageById(
  packageId: string,
  sql: Sql,
  options: { lock?: boolean; ownerUserId?: string } = {},
): Promise<ApprovalPackage> {
  const ownerClause = options.ownerUserId ? "and owner_user_id = $2" : "";
  const lockClause = options.lock ? "for update" : "";
  const rows = await sql.query<DbPackageRow>(
    `select * from workflow_approval_packages
     where id = $1 ${ownerClause}
     limit 1 ${lockClause}`,
    options.ownerUserId ? [packageId, options.ownerUserId] : [packageId],
  );
  if (!rows[0]) throw new StoreRefusal("NOT_FOUND", "Approval package not found");
  const approvalPackage = packageFromDb(rows[0]);
  await verifyPackageReadIntegrity(
    approvalPackage,
    await packageRows(approvalPackage.id, sql),
    sql,
  );
  return approvalPackage;
}

/** Materialize the exact latest completed canonical Draft and both immutable review scopes. */
export async function ensureApprovalPackage(
  countryId: string,
  ownerUserId: string,
  database?: Sql,
): Promise<ApprovalStoreResult<ApprovalPackage>> {
  return resultOf(async () => {
    requireHumanId(ownerUserId);
    if (!countryId.trim()) throw new StoreRefusal("INVALID_INPUT", "Country ID is required");
    const sql = database ?? (await getSql());
    return sql.transaction(async (transaction) => {
      await registeredUser(ownerUserId, transaction);
      const candidate = await latestCandidate(countryId, ownerUserId, transaction);
      const candidateMethodology = methodologyFromDbRow(candidate);
      if (
        candidateMethodology &&
        methodologyIdentitiesMatch(candidateMethodology, PREVIOUS_DAMM_WORKFLOW_METHODOLOGY)
      ) {
        if (candidate.artifact_set_id) {
          const historical = await transaction.query<DbPackageRow>(
            `select * from workflow_approval_packages
             where run_id = $1 and artifact_set_id = $2 limit 1`,
            [candidate.run_id, candidate.artifact_set_id],
          );
          if (historical[0]) {
            return packageById(historical[0].id, transaction, { ownerUserId });
          }
        }
        verifyCandidate(candidate, PREVIOUS_DAMM_WORKFLOW_METHODOLOGY);
        throw new StoreRefusal(
          "HISTORICAL_SOURCE_PIN",
          "The latest completed Draft uses the exact preceding DAMM source pin and cannot start a new approval chain",
        );
      }
      const verified = verifyCandidate(candidate);
      const boundary = await verifyCompleteStoredArtifactSet(
        candidate,
        verified.methodology,
        verified.assessmentInputSha256,
        transaction,
      );
      const rows = await expectedApprovalRows(boundary.assessmentInputContent, transaction);
      if (rows.length === 0) {
        throw new StoreRefusal(
          "INVALID_PACKAGE",
          "Stage 1 contains no machine-filled assessment rows",
        );
      }

      const g1Scope: readonly ApprovalScopeRow[] = Object.freeze(
        rows.map((row) =>
          Object.freeze({ indicatorId: row.indicatorId, rowSha256: row.rowSha256 }),
        ),
      );
      const g2ProtocolScope = buildG2ReviewScope(rows, candidate.bundle_sha256 as string);
      const g2Scope: readonly ApprovalScopeRow[] = Object.freeze(
        g2ProtocolScope.rows.map((row) =>
          Object.freeze({
            indicatorId: row.indicatorId,
            rowSha256: row.rowSha256,
            reasons: Object.freeze([...row.reasons]),
          }),
        ),
      );
      const machineRowSetSha256 = sha256Json(
        rows.map((row) => ({
          indicatorId: row.indicatorId,
          rowSha256: row.rowSha256,
          classification: row.classification,
          prerequisite: row.prerequisite,
        })),
      );
      const g1ScopeSha256 = sha256Json(g1Scope);
      const g2ScopeSha256 = sha256Json(g2Scope);
      const targetIdentitySha256 = sha256Json(
        buildApprovalTargetIdentity({
          runId: candidate.run_id,
          artifactSetId: candidate.artifact_set_id as string,
          bundleSha256: candidate.bundle_sha256 as string,
          observationsSha256: candidate.observations_sha256 as string,
          workflowId: DAR_WORKFLOW.workflow_id,
          workflowVersion: DAR_WORKFLOW.workflow_version,
          workflowContractSha256: DAR_WORKFLOW_SHA256,
          methodology: verified.methodology,
          assessmentInputArtifactKey: boundary.assessmentInputArtifactKey,
          assessmentInputSourcePath: boundary.assessmentInputSourcePath,
          assessmentInputSha256: verified.assessmentInputSha256,
          machineRowCount: rows.length,
          machineRowSetSha256,
          g1ScopeSha256,
          g2ScopeSha256,
          completedAt: verified.completedAt,
        }),
      );

      const existing = await transaction.query<DbPackageRow>(
        `select * from workflow_approval_packages
         where run_id = $1 and artifact_set_id = $2 limit 1`,
        [candidate.run_id, candidate.artifact_set_id],
      );
      if (existing[0]) {
        if (existing[0].target_identity_sha256 !== targetIdentitySha256) {
          throw new StoreRefusal(
            "INVALID_STATE",
            "Existing immutable package identity does not match the published Draft",
          );
        }
        return packageById(existing[0].id, transaction);
      }

      const approvalPackageId = `approval-package-${targetIdentitySha256}`;
      await transaction`
        insert into workflow_approval_packages
          (id, run_id, country_id, owner_user_id, artifact_set_id,
           bundle_artifact_key, bundle_sha256, observations_artifact_key,
           observations_sha256, workflow_id, workflow_version,
           workflow_contract_sha256, manifest_schema_version, damm_model_id,
           damm_model_version, damm_model_revision, damm_model_status,
           damm_model_ratified, damm_model_sha256, damm_model_schema_sha256,
           damm_source_repository, damm_source_commit, damm_source_model_path,
           damm_source_model_sha256, damm_source_schema_path,
           damm_source_schema_sha256, census_revision, census_path, census_sha256,
           engine_version, engine_path, engine_sha256, renderer_version,
           renderer_path, renderer_sha256, assessment_input_artifact_key,
           assessment_input_source_path, assessment_input_sha256,
           machine_row_count, machine_row_set_sha256, g1_scope_rows,
           g1_scope_row_count, g1_scope_sha256, g2_scope_rows, g2_scope_row_count,
           g2_scope_sha256, g2_mandatory_row_count, g2_remainder_row_count,
           g2_sample_row_count, target_identity_sha256, completed_at)
        values
          (${approvalPackageId}, ${candidate.run_id}, ${candidate.country_id},
           ${ownerUserId}, ${candidate.artifact_set_id}, 'bundle',
           ${candidate.bundle_sha256}, ${APPROVAL_OBSERVATIONS_ARTIFACT_KEY},
           ${candidate.observations_sha256}, ${DAR_WORKFLOW.workflow_id},
           ${DAR_WORKFLOW.workflow_version}, ${DAR_WORKFLOW_SHA256},
           ${verified.methodology.manifestSchemaVersion}, ${verified.methodology.modelId},
           ${verified.methodology.modelVersion}, ${verified.methodology.modelRevision},
           ${verified.methodology.modelStatus}, ${verified.methodology.modelRatified},
           ${verified.methodology.appModelSha256}, ${verified.methodology.appModelSchemaSha256},
           ${verified.methodology.sourceRepository}, ${verified.methodology.sourceCommit},
           ${verified.methodology.sourceModelPath}, ${verified.methodology.sourceModelSha256},
           ${verified.methodology.sourceSchemaPath}, ${verified.methodology.sourceSchemaSha256},
           ${verified.methodology.censusRevision}, ${verified.methodology.censusPath},
           ${verified.methodology.censusSha256}, ${verified.methodology.engineVersion},
           ${verified.methodology.enginePath}, ${verified.methodology.engineSha256},
           ${verified.methodology.rendererVersion}, ${verified.methodology.rendererPath},
           ${verified.methodology.rendererSha256}, ${boundary.assessmentInputArtifactKey},
           ${boundary.assessmentInputSourcePath}, ${verified.assessmentInputSha256},
           ${rows.length}, ${machineRowSetSha256}, ${JSON.stringify(g1Scope)}::jsonb,
           ${g1Scope.length}, ${g1ScopeSha256}, ${JSON.stringify(g2Scope)}::jsonb,
           ${g2Scope.length}, ${g2ScopeSha256},
           ${new Set([...g2ProtocolScope.prerequisiteRowIds, ...g2ProtocolScope.judgedRowIds]).size},
           ${g2ProtocolScope.remainderCount}, ${g2ProtocolScope.sampleSize},
           ${targetIdentitySha256},
           (select finished_at from runs where id = ${candidate.run_id}))`;

      // Keep arbitrary-precision JSON numerics inside PostgreSQL from parsing through
      // JavaScript and back. The same versioned helper enforces these rows at commit.
      await transaction.query(
        `insert into workflow_approval_rows
          (package_id, target_identity_sha256, ordinal, indicator_id, row_sha256,
           classification, prerequisite, row_payload)
         select $1, $2, expected.ordinal, expected.indicator_id, expected.row_sha256,
                expected.classification, expected.prerequisite, expected.row_payload
         from expected_human_approval_rows_v1($3::bytea) expected
         order by expected.ordinal`,
        [approvalPackageId, targetIdentitySha256, boundary.assessmentInputContent],
      );
      await transaction.query(
        `update workflow_approval_packages set materialized_at = now()
         where id = $1 and materialized_at is null`,
        [approvalPackageId],
      );
      return packageById(approvalPackageId, transaction);
    });
  });
}

/**
 * Return one exact materialized package owned by this authenticated country owner.
 * Without an explicit package ID the latest package remains the default, while the
 * returned history makes earlier immutable approval chains directly auditable.
 */
export async function getOwnerApprovalState(
  countryId: string,
  ownerUserId: string,
  database?: Sql,
  requestedPackageId?: string,
): Promise<ApprovalStoreResult<OwnerApprovalState>> {
  return resultOf(async () => {
    requireHumanId(ownerUserId);
    const packageId = requestedPackageId?.trim();
    if (requestedPackageId !== undefined && !packageId) {
      throw new StoreRefusal("INVALID_INPUT", "Approval package ID is required");
    }
    const sql = database ?? (await getSql());
    return sql.transaction(async (transaction) => {
      // Decisions and their release commit atomically. A repeatable read keeps the
      // aggregate from observing G3 on one statement and its release on another.
      // PGlite and production Postgres both support this transaction mode.
      await transaction.query("set transaction isolation level repeatable read read only");
      await registeredUser(ownerUserId, transaction);
      const packages = await transaction.query<DbPackageRow>(
        `select package.*
         from workflow_approval_packages package
         where package.country_id = $1 and package.owner_user_id = $2
         order by package.completed_at desc, package.created_at desc, package.id desc`,
        [countryId, ownerUserId],
      );
      if (!packages[0]) {
        throw new StoreRefusal("NOT_FOUND", "No approval package has been materialized");
      }
      const selected = packageId
        ? packages.find((candidate) => candidate.id === packageId)
        : packages[0];
      if (!selected) {
        throw new StoreRefusal("NOT_FOUND", "Approval package not found");
      }
      const approvalPackage = await packageById(selected.id, transaction, { ownerUserId });
      const [rows, assignments, assignmentSupersessions, decisions, release] = await Promise.all([
        packageRows(approvalPackage.id, transaction),
        packageAssignments(approvalPackage.id, transaction),
        packageAssignmentSupersessions(approvalPackage.id, transaction),
        packageDecisions(approvalPackage.id, transaction),
        packageRelease(approvalPackage.id, transaction),
      ]);
      if (release) verifyReleaseReadIntegrity(release, approvalPackage, decisions);
      return {
        package: approvalPackage,
        packageHistory: Object.freeze(
          packages.map((item) =>
            Object.freeze({
              packageId: item.id,
              runId: item.run_id,
              artifactSetId: item.artifact_set_id,
              bundleSha256: item.bundle_sha256,
              targetIdentitySha256: item.target_identity_sha256,
              completedAt: iso(item.completed_at),
              sourceCommit: item.damm_source_commit,
              currentMethodology: methodologyMatchesCanonical(methodologyFromPackage(item)),
            }),
          ),
        ),
        rows,
        assignments,
        assignmentSupersessions,
        decisions,
        release,
        lifecycle: approvalLifecycle(approvalPackage, assignments, decisions),
      };
    });
  });
}

/**
 * Open owner controls without allowing a newer unmaterialized prior-pin run to
 * hide an older immutable package. Only the methodology-cutover refusal falls
 * back to package history; integrity and package failures remain visible.
 */
export async function openOwnerApprovalState(
  countryId: string,
  ownerUserId: string,
  database?: Sql,
  requestedPackageId?: string,
): Promise<ApprovalStoreResult<OwnerApprovalState>> {
  if (requestedPackageId !== undefined) {
    return getOwnerApprovalState(countryId, ownerUserId, database, requestedPackageId);
  }
  const prepared = await ensureApprovalPackage(countryId, ownerUserId, database);
  if (!prepared.ok) {
    if (prepared.error.code !== "HISTORICAL_SOURCE_PIN") return prepared;
    const historical = await getOwnerApprovalState(countryId, ownerUserId, database);
    if (historical.ok || historical.error.code !== "NOT_FOUND") return historical;
    return prepared;
  }
  return getOwnerApprovalState(countryId, ownerUserId, database);
}

export interface AssignApprovalReviewerInput {
  packageId: string;
  /** Optimistic guard from the package the owner was shown; never persisted as authority. */
  expectedTargetIdentitySha256: string;
  /** Optimistic guard from the package the owner was shown; never persisted as authority. */
  expectedBundleSha256: string;
  gate: AssignedApprovalGate;
  reviewerEmail: string;
  declaredRole: AssignedApprovalRole;
  ownerUserId: string;
  /** Required when replacing the gate's current active assignment. */
  expectedActiveAssignmentId?: string | null;
  /** Required, trimmed, and immutably audited when replacing an active assignment. */
  replacementReason?: string;
  /** Optional only for deterministic integration tests; normal callers omit it. */
  id?: string;
}

export async function assignApprovalReviewer(
  input: AssignApprovalReviewerInput,
  database?: Sql,
): Promise<ApprovalStoreResult<ApprovalAssignment>> {
  return resultOf(async () => {
    requireHumanId(input.ownerUserId);
    const expectedRole = input.gate === "g1" ? "assessor" : "independent_reviewer";
    if (input.declaredRole !== expectedRole) {
      throw new StoreRefusal(
        "INVALID_INPUT",
        `${input.gate.toUpperCase()} requires ${expectedRole}`,
      );
    }
    const reviewerEmail = input.reviewerEmail.trim();
    if (!reviewerEmail) throw new StoreRefusal("INVALID_INPUT", "Reviewer email is required");
    const sql = database ?? (await getSql());
    return sql.transaction(async (transaction) => {
      const approvalPackage = await packageById(input.packageId, transaction, {
        lock: true,
        ownerUserId: input.ownerUserId,
      });
      requireCurrentApprovalActivity(approvalPackage);
      if (approvalPackage.ownerUserId !== input.ownerUserId) {
        throw new StoreRefusal("FORBIDDEN", "Only the country owner may assign reviewers");
      }
      if (
        input.expectedTargetIdentitySha256 !== approvalPackage.targetIdentitySha256 ||
        input.expectedBundleSha256 !== approvalPackage.bundleSha256
      ) {
        throw new StoreRefusal(
          "CONFLICT",
          "The displayed Draft package changed; reload before assigning a reviewer",
        );
      }
      await lockActiveCountryOwnership(approvalPackage, input.ownerUserId, transaction);
      const owner = await registeredUser(input.ownerUserId, transaction);
      const reviewers = await transaction.query<DbUser>(
        `select "id" as id, "name" as name, "email" as email from "user"
         where lower("email") = lower($1) and "id" <> 'dev-user' limit 1`,
        [reviewerEmail],
      );
      const reviewer = reviewers[0];
      if (!reviewer) {
        throw new StoreRefusal("NOT_FOUND", "Reviewer must first register with Better Auth");
      }
      const scope = input.gate === "g1" ? approvalPackage.g1Scope : approvalPackage.g2Scope;
      const scopeSha256 =
        input.gate === "g1" ? approvalPackage.g1ScopeSha256 : approvalPackage.g2ScopeSha256;
      const assignmentId = input.id?.trim() || randomUUID();
      const activeAssignments = await transaction.query<DbAssignmentRow>(
        `select assignment.*
         from workflow_approval_assignments assignment
         where assignment.package_id = $1 and assignment.gate = $2
           and assignment.active
           and not exists (
             select 1 from workflow_approval_assignment_supersessions supersession
             where supersession.revoked_assignment_id = assignment.id
           )
         limit 1`,
        [approvalPackage.id, input.gate],
      );
      const activeAssignment = activeAssignments[0];
      const expectedActiveAssignmentId = input.expectedActiveAssignmentId?.trim();
      const replacementReason = input.replacementReason?.trim() ?? "";
      if (activeAssignment) {
        if (!expectedActiveAssignmentId || expectedActiveAssignmentId !== activeAssignment.id) {
          throw new StoreRefusal(
            "CONFLICT",
            "The active reviewer assignment changed; reload before replacing it",
          );
        }
        if (!replacementReason || replacementReason.length > 5000) {
          throw new StoreRefusal(
            "INVALID_INPUT",
            "Reviewer replacement requires a reason of at most 5,000 characters",
          );
        }
        await transaction.query(
          `insert into workflow_approval_assignment_supersessions
            (id, revoked_assignment_id, superseding_assignment_id, package_id,
             target_identity_sha256, gate, revoked_by_user_id, revoked_by_name,
             revoked_by_email, reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            randomUUID(),
            activeAssignment.id,
            assignmentId,
            approvalPackage.id,
            approvalPackage.targetIdentitySha256,
            input.gate,
            owner.id,
            owner.name,
            owner.email,
            replacementReason,
          ],
        );
      } else {
        if (
          input.expectedActiveAssignmentId !== undefined &&
          input.expectedActiveAssignmentId !== null
        ) {
          throw new StoreRefusal(
            "CONFLICT",
            "The expected reviewer assignment is no longer active; reload before assigning",
          );
        }
        if (replacementReason) {
          throw new StoreRefusal(
            "INVALID_INPUT",
            "A replacement reason is only valid when replacing an active assignment",
          );
        }
      }
      const inserted = await transaction.query<DbAssignmentRow>(
        `insert into workflow_approval_assignments
          (id, package_id, target_identity_sha256, gate, reviewer_user_id,
           reviewer_name, reviewer_email, declared_role, assigned_by_user_id,
           assigned_by_name, assigned_by_email, scope_rows, scope_row_count, scope_sha256)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
         returning *`,
        [
          assignmentId,
          approvalPackage.id,
          approvalPackage.targetIdentitySha256,
          input.gate,
          reviewer.id,
          reviewer.name,
          reviewer.email,
          input.declaredRole,
          owner.id,
          owner.name,
          owner.email,
          JSON.stringify(scope),
          scope.length,
          scopeSha256,
        ],
      );
      return assignmentFromDb(inserted[0]);
    });
  });
}

export async function getAssignedReview(
  assignmentId: string,
  reviewerUserId: string,
  database?: Sql,
): Promise<ApprovalStoreResult<AssignedReview>> {
  return resultOf(async () => {
    requireHumanId(reviewerUserId);
    const sql = database ?? (await getSql());
    await registeredUser(reviewerUserId, sql);
    const assignments = await sql.query<DbAssignmentRow>(
      `select assignment.* from workflow_approval_assignments assignment
       where assignment.id = $1 and assignment.reviewer_user_id = $2
         and assignment.active
         and not exists (
           select 1 from workflow_approval_assignment_supersessions supersession
           where supersession.revoked_assignment_id = assignment.id
         )
       limit 1`,
      [assignmentId, reviewerUserId],
    );
    if (!assignments[0]) throw new StoreRefusal("NOT_FOUND", "Assigned review not found");
    const assignment = assignmentFromDb(assignments[0]);
    const approvalPackage = await packageById(assignment.packageId, sql);
    const allRows = await packageRows(approvalPackage.id, sql);
    const byIndicator = new Map(allRows.map((row) => [row.indicatorId, row]));
    const rows = assignment.scope.map((scopeRow) => {
      const stored = byIndicator.get(scopeRow.indicatorId);
      if (!stored || stored.rowSha256 !== scopeRow.rowSha256) {
        throw new StoreRefusal(
          "INVALID_STATE",
          "Assigned review scope no longer matches its package",
        );
      }
      return Object.freeze({
        ...stored,
        ...(scopeRow.reasons ? { reasons: scopeRow.reasons } : {}),
      });
    });
    const [priorDecisions, assignmentsForLifecycle] = await Promise.all([
      packageDecisions(approvalPackage.id, sql),
      packageAssignments(approvalPackage.id, sql),
    ]);
    const terminal = priorDecisions.find((decision) => decision.decision === "revisions_required");
    const alreadyDecided = priorDecisions.some((decision) => decision.gate === assignment.gate);
    const acceptedG1 = priorDecisions.some(
      (decision) => decision.gate === "g1" && decision.decision === "approved",
    );
    const currentMethodology = methodologyMatchesCanonical(approvalPackage.methodology);
    const canSubmit =
      currentMethodology &&
      !terminal &&
      !alreadyDecided &&
      (assignment.gate === "g1" || acceptedG1);
    const lockedReason = canSubmit
      ? null
      : !currentMethodology
        ? "This historical package remains audit-readable, but its methodology is no longer current; start a new Draft package for approval."
        : terminal
        ? "This package requires revision; its approval chain is closed."
        : alreadyDecided
          ? `${assignment.gate.toUpperCase()} already has an immutable decision.`
          : "G2 controls unlock only after accepted human G1 review.";
    return {
      package: approvalPackage,
      assignment,
      rows,
      ownDecision:
        priorDecisions.find((decision) => decision.assignmentId === assignment.id) ?? null,
      lifecycle: approvalLifecycle(approvalPackage, assignmentsForLifecycle, priorDecisions),
      canSubmit,
      lockedReason,
    };
  });
}

export interface ApprovalRowReviewInput {
  indicatorId: string;
  decision: ApprovalDecision;
  notes?: string;
}

export interface SubmitAssignedReviewInput {
  assignmentId: string;
  reviewerUserId: string;
  decision: ApprovalDecision;
  notes: string;
  rows: readonly ApprovalRowReviewInput[];
  affirmation: boolean;
  expectedAffirmationVersion: string;
  expectedAffirmationSha256: string;
}

function normalizeRowReviews(
  input: SubmitAssignedReviewInput,
  scope: readonly ApprovalScopeRow[],
): StoredApprovalRowReview[] {
  requireApprovalDecision(input.decision);
  requireNotes(input.notes);
  if (!Array.isArray(input.rows)) {
    throw new StoreRefusal("INVALID_INPUT", "Review rows must be an array");
  }
  const byIndicator = new Map<string, ApprovalRowReviewInput>();
  for (const row of input.rows) {
    if (!row || typeof row.indicatorId !== "string") {
      throw new StoreRefusal("INVALID_INPUT", "Each review row needs an indicator ID");
    }
    requireApprovalDecision(row.decision);
    if (row.notes !== undefined) requireNotes(row.notes);
    if (byIndicator.has(row.indicatorId)) {
      throw new StoreRefusal("INVALID_INPUT", `Review row ${row.indicatorId} is duplicated`);
    }
    byIndicator.set(row.indicatorId, row);
  }
  const normalized = scope.map((scopeRow) => {
    const submitted = byIndicator.get(scopeRow.indicatorId);
    if (!submitted) {
      throw new StoreRefusal("INVALID_INPUT", `Review row ${scopeRow.indicatorId} is missing`);
    }
    const notes = submitted.notes?.trim() ?? "";
    if (submitted.decision === "revisions_required" && !notes) {
      throw new StoreRefusal(
        "INVALID_INPUT",
        `Revision notes are required for ${scopeRow.indicatorId}`,
      );
    }
    return {
      indicatorId: scopeRow.indicatorId,
      rowSha256: scopeRow.rowSha256,
      decision: submitted.decision,
      notes,
    };
  });
  if (byIndicator.size !== scope.length) {
    throw new StoreRefusal("INVALID_INPUT", "Review contains rows outside its immutable scope");
  }
  const hasRevision = normalized.some((row) => row.decision === "revisions_required");
  if ((input.decision === "revisions_required") !== hasRevision) {
    throw new StoreRefusal(
      "INVALID_INPUT",
      "Gate decision must agree with the immutable set of row decisions",
    );
  }
  if (input.decision === "revisions_required" && !input.notes.trim()) {
    throw new StoreRefusal("INVALID_INPUT", "A revisions-required decision needs gate notes");
  }
  if (!input.affirmation) {
    throw new StoreRefusal("INVALID_INPUT", "Every G1/G2 decision requires human affirmation");
  }
  return normalized;
}

export async function submitAssignedReview(
  input: SubmitAssignedReviewInput,
  database?: Sql,
): Promise<ApprovalStoreResult<HumanApprovalDecision>> {
  return resultOf(async () => {
    requireHumanId(input.reviewerUserId);
    const sql = database ?? (await getSql());
    return sql.transaction(async (transaction) => {
      const assignments = await transaction.query<DbAssignmentRow>(
        `select assignment.* from workflow_approval_assignments assignment
         where assignment.id = $1 and assignment.reviewer_user_id = $2
           and assignment.active
           and not exists (
             select 1 from workflow_approval_assignment_supersessions supersession
             where supersession.revoked_assignment_id = assignment.id
           )
         limit 1`,
        [input.assignmentId, input.reviewerUserId],
      );
      if (!assignments[0]) throw new StoreRefusal("NOT_FOUND", "Assigned review not found");
      const assignment = assignmentFromDb(assignments[0]);
      const approvalPackage = await packageById(assignment.packageId, transaction, { lock: true });
      requireCurrentApprovalActivity(approvalPackage);
      await registeredUser(input.reviewerUserId, transaction);
      const prior = await packageDecisions(approvalPackage.id, transaction);
      const rowReviews = normalizeRowReviews(input, assignment.scope);
      const actor: ApprovalActor = {
        kind: "human",
        authenticated: true,
        authUserId: assignment.reviewerUserId,
        displayName: assignment.reviewerName,
        declaredRole: assignment.declaredRole,
      };
      assertGateDecisionAllowed({
        gate: assignment.gate.toUpperCase() as "G1" | "G2",
        decision: input.decision,
        actor,
        priorDecisions: prior.map(policyDecision),
        expectedRowIds: assignment.scope.map((row) => row.indicatorId),
        reviewedRowIds: input.rows.map((row) => row.indicatorId),
      });
      const versionedAffirmation = HUMAN_REVIEW_AFFIRMATIONS[assignment.gate];
      if (
        input.expectedAffirmationVersion !== versionedAffirmation.version ||
        input.expectedAffirmationSha256 !== versionedAffirmation.sha256
      ) {
        throw new StoreRefusal(
          "CONFLICT",
          "The displayed human-review affirmation changed; reload it before deciding",
        );
      }
      const inserted = await transaction.query<DbDecisionRow>(
        `insert into workflow_approval_decisions
          (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
           reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
           notes, reviewer_affirmation, reviewer_affirmation_version,
           reviewer_affirmation_text, reviewer_affirmation_sha256, row_reviews,
           affirmations)
         values ($1, $2, $3, $4, $5, 'human', $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16::jsonb, '{}'::jsonb)
         returning *`,
        [
          randomUUID(),
          approvalPackage.id,
          approvalPackage.targetIdentitySha256,
          assignment.id,
          assignment.gate,
          assignment.reviewerUserId,
          assignment.reviewerName,
          assignment.reviewerEmail,
          assignment.declaredRole,
          input.decision,
          input.notes.trim(),
          input.affirmation,
          versionedAffirmation.version,
          versionedAffirmation.text,
          versionedAffirmation.sha256,
          JSON.stringify(rowReviews),
        ],
      );
      return decisionFromDb(inserted[0]);
    });
  });
}

export interface SubmitCountryOwnerSignoffInput {
  packageId: string;
  /** Optimistic guard only; the locked server package remains authoritative. */
  expectedTargetIdentitySha256: string;
  /** Optimistic guard only; the locked server package remains authoritative. */
  expectedBundleSha256: string;
  ownerUserId: string;
  decision: ApprovalDecision;
  notes: string;
  affirmations: G3AffirmationChecklist | Readonly<Record<string, unknown>>;
}

export interface CountryOwnerSignoffResult {
  decision: HumanApprovalDecision;
  release: ApprovalRelease | null;
  lifecycle: ApprovalLifecycleState;
}

export async function submitCountryOwnerSignoff(
  input: SubmitCountryOwnerSignoffInput,
  database?: Sql,
): Promise<ApprovalStoreResult<CountryOwnerSignoffResult>> {
  return resultOf(async () => {
    requireHumanId(input.ownerUserId);
    requireApprovalDecision(input.decision);
    requireNotes(input.notes);
    if (!record(input.affirmations)) {
      throw new StoreRefusal("INVALID_INPUT", "G3 affirmations must be an object");
    }
    const sql = database ?? (await getSql());
    return sql.transaction(async (transaction) => {
      const approvalPackage = await packageById(input.packageId, transaction, {
        lock: true,
        ownerUserId: input.ownerUserId,
      });
      requireCurrentApprovalActivity(approvalPackage);
      if (approvalPackage.ownerUserId !== input.ownerUserId) {
        throw new StoreRefusal("FORBIDDEN", "Only the authenticated country owner may record G3");
      }
      if (
        input.expectedTargetIdentitySha256 !== approvalPackage.targetIdentitySha256 ||
        input.expectedBundleSha256 !== approvalPackage.bundleSha256
      ) {
        throw new StoreRefusal(
          "CONFLICT",
          "The displayed Draft package changed; reload before recording G3",
        );
      }
      await lockActiveCountryOwnership(approvalPackage, input.ownerUserId, transaction);
      const owner = await registeredUser(input.ownerUserId, transaction);
      const prior = await packageDecisions(approvalPackage.id, transaction);
      const actor: ApprovalActor = {
        kind: "human",
        authenticated: true,
        authUserId: owner.id,
        displayName: owner.name,
        declaredRole: "ttl_country_owner",
      };
      assertGateDecisionAllowed({
        gate: "G3",
        decision: input.decision,
        actor,
        priorDecisions: prior.map(policyDecision),
        countryOwnerUserId: approvalPackage.ownerUserId,
        g3Affirmations: input.affirmations,
      });
      if (input.decision === "revisions_required" && !input.notes.trim()) {
        throw new StoreRefusal("INVALID_INPUT", "A revisions-required G3 decision needs notes");
      }
      const inserted = await transaction.query<DbDecisionRow>(
        `insert into workflow_approval_decisions
          (id, package_id, target_identity_sha256, assignment_id, gate, actor_kind,
           reviewer_user_id, reviewer_name, reviewer_email, declared_role, decision,
           notes, reviewer_affirmation, row_reviews, affirmations)
         values ($1, $2, $3, null, 'g3', 'human', $4, $5, $6, 'ttl_country_owner',
                 $7, $8, true, '[]'::jsonb, $9::jsonb)
         returning *`,
        [
          randomUUID(),
          approvalPackage.id,
          approvalPackage.targetIdentitySha256,
          owner.id,
          owner.name,
          owner.email,
          input.decision,
          input.notes.trim(),
          JSON.stringify(input.affirmations),
        ],
      );
      const g3Decision = decisionFromDb(inserted[0]);
      if (input.decision === "revisions_required") {
        return { decision: g3Decision, release: null, lifecycle: "revisions_required" };
      }

      const g1 = prior.find(
        (decision) => decision.gate === "g1" && decision.decision === "approved",
      );
      const g2 = prior.find(
        (decision) => decision.gate === "g2" && decision.decision === "approved",
      );
      if (!g1 || !g2) throw new StoreRefusal("INVALID_STATE", "Accepted G1 and G2 are required");
      const versions = await transaction.query<{ next_version: number }>(
        `select coalesce(max(version_number), 0) + 1 as next_version
         from workflow_approval_releases where country_id = $1`,
        [approvalPackage.countryId],
      );
      const version = Number(versions[0]?.next_version ?? 1);
      const lifecycle: ApprovalRelease["lifecycle"] =
        approvalPackage.methodology.modelRatified &&
        approvalPackage.methodology.modelStatus.toLowerCase() === "ratified"
          ? "canonical_final"
          : "approved_draft";
      const releaseId = randomUUID();
      const manifest = buildReleaseManifest({
        releaseId,
        approvalPackage,
        version,
        lifecycle,
        g1,
        g2,
        g3: g3Decision,
      });
      const manifestSha256 = sha256Json(manifest);
      const releases = await transaction.query<DbReleaseRow>(
        `insert into workflow_approval_releases
          (id, package_id, target_identity_sha256, country_id, version_number,
           lifecycle, external_circulation_authorized, g1_decision_id,
           g2_decision_id, g3_decision_id, manifest_json, manifest_sha256)
         values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10::jsonb, $11)
         returning *`,
        [
          releaseId,
          approvalPackage.id,
          approvalPackage.targetIdentitySha256,
          approvalPackage.countryId,
          version,
          lifecycle,
          g1.id,
          g2.id,
          g3Decision.id,
          JSON.stringify(manifest),
          manifestSha256,
        ],
      );
      const release = releaseFromDb(releases[0]);
      verifyReleaseReadIntegrity(release, approvalPackage, [...prior, g3Decision]);
      return { decision: g3Decision, release, lifecycle };
    });
  });
}

/** Authorize downloads without ever broadening a reviewer beyond their exact package. */
export async function getApprovalArtifactAccess(
  runId: string,
  artifactKey: string,
  userId: string,
  database?: Sql,
): Promise<ApprovalStoreResult<ApprovalArtifactAccess>> {
  return resultOf(async () => {
    requireHumanId(userId);
    const sql = database ?? (await getSql());
    await registeredUser(userId, sql);
    const rows = await sql.query<{
      run_id: string;
      artifact_set_id: string;
      artifact_key: string;
      artifact_sha256: string;
      artifact_owner_user_id: string;
      bundle_sha256: string;
      package_id: string | null;
      reviewer_assignment_id: string | null;
      target_identity_sha256: string | null;
      owner_access: boolean;
      reviewer_access: boolean;
    }>(
      `select workflow_run.id as run_id,
              workflow_run.workflow_artifact_set_id as artifact_set_id,
              artifact.artifact_key, artifact.sha256 as artifact_sha256,
              workflow_run.user_id as artifact_owner_user_id,
              bundle.sha256 as bundle_sha256,
              package.id as package_id,
              active_reviewer.assignment_id as reviewer_assignment_id,
              package.target_identity_sha256,
              (workflow_run.user_id = $3) as owner_access,
              (active_reviewer.assignment_id is not null) as reviewer_access
       from runs workflow_run
       join workflow_run_artifacts artifact
         on artifact.run_id = workflow_run.id
        and artifact.artifact_set_id = workflow_run.workflow_artifact_set_id
        and artifact.artifact_key = $2
       join workflow_run_artifacts bundle
         on bundle.run_id = workflow_run.id
        and bundle.artifact_set_id = workflow_run.workflow_artifact_set_id
        and bundle.artifact_key = 'bundle'
       left join workflow_approval_packages package
         on package.run_id = workflow_run.id
        and package.artifact_set_id = workflow_run.workflow_artifact_set_id
       left join lateral (
                select assignment.id as assignment_id
                from workflow_approval_assignments assignment
                where assignment.package_id = package.id
                  and assignment.target_identity_sha256 = package.target_identity_sha256
                  and assignment.reviewer_user_id = $3
                  and assignment.active
                  and not exists (
                    select 1 from workflow_approval_assignment_supersessions supersession
                    where supersession.revoked_assignment_id = assignment.id
                  )
                limit 1
       ) active_reviewer on true
       where workflow_run.id = $1 and workflow_run.pass = 'workflow'
         and workflow_run.status = 'done'
         and artifact.workflow_id = $4
         and artifact.workflow_version = $5
         and artifact.workflow_contract_sha256 = $6
         and artifact.content_verified_at is not null
       limit 1`,
      [
        runId,
        artifactKey,
        userId,
        DAR_WORKFLOW.workflow_id,
        DAR_WORKFLOW.workflow_version,
        DAR_WORKFLOW_SHA256,
      ],
    );
    const row = rows[0];
    if (!row || (!row.owner_access && !row.reviewer_access)) {
      throw new StoreRefusal(
        "FORBIDDEN",
        "Artifact access is not authorized for this exact package",
      );
    }
    if (
      row.reviewer_access &&
      (!row.package_id || !row.reviewer_assignment_id || !row.target_identity_sha256)
    ) {
      throw new StoreRefusal(
        "INVALID_STATE",
        "Reviewer access has no exact immutable package binding",
      );
    }
    if (row.package_id) {
      const approvalPackage = await packageById(row.package_id, sql);
      if (
        approvalPackage.targetIdentitySha256 !== row.target_identity_sha256 ||
        approvalPackage.runId !== row.run_id ||
        approvalPackage.artifactSetId !== row.artifact_set_id ||
        approvalPackage.bundleSha256 !== row.bundle_sha256
      ) {
        throw new StoreRefusal(
          "INVALID_STATE",
          "Artifact authorization failed exact-package verification",
        );
      }
    }
    return {
      runId: row.run_id,
      artifactSetId: row.artifact_set_id,
      artifactKey: row.artifact_key,
      artifactSha256: row.artifact_sha256,
      artifactOwnerUserId: row.artifact_owner_user_id,
      ownerUserId: row.artifact_owner_user_id,
      bundleSha256: row.bundle_sha256,
      packageId: row.package_id,
      reviewerAssignmentId: row.reviewer_assignment_id,
      targetIdentitySha256: row.target_identity_sha256,
      accessAs: row.owner_access ? "country_owner" : "assigned_reviewer",
    };
  });
}
