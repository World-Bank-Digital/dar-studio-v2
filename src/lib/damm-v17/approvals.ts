import { createHash } from "node:crypto";

import type { EvidenceClass } from "./types.ts";

export const APPROVAL_GATES = ["G1", "G2", "G3"] as const;
export type ApprovalGate = (typeof APPROVAL_GATES)[number];

export const APPROVAL_DECISIONS = ["approved", "revisions_required"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_ROLES = ["assessor", "independent_reviewer", "ttl_country_owner"] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

export const APPROVAL_ACTOR_KINDS = ["human", "machine", "service", "vendor", "automated"] as const;
export type ApprovalActorKind = (typeof APPROVAL_ACTOR_KINDS)[number];

export interface HumanReviewAffirmation {
  version: string;
  text: string;
  sha256: string;
}

function humanReviewAffirmation(version: string, text: string): HumanReviewAffirmation {
  return Object.freeze({
    version,
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  });
}

/**
 * Immutable, versioned statements recorded with every G1/G2 decision. G2 mirrors
 * the substantive source/class/ladder checks in the DAMM v1.7 QC Protocol; a bare
 * identity or scope checkbox is not enough to satisfy the gate.
 */
export const HUMAN_REVIEW_AFFIRMATIONS = Object.freeze({
  g1: humanReviewAffirmation(
    "damm.g1-human-affirmation/v1",
    "I affirm that I am the named, authenticated human assessor assigned to G1; I personally reviewed every displayed machine-filled row, and no automated vendor review or machine QC is being represented as my review.",
  ),
  g2: humanReviewAffirmation(
    "damm.g2-human-affirmation/v1",
    "I affirm that I am the named, authenticated independent human reviewer assigned to G2; I am not the G1 assessor; for every displayed scoped row I personally verified that the cited source resolves to the stated evidence, the evidence class is correctly derived, and the ladder level is justified by evidence quality and scale, resolving disagreements by evidence; and no automated vendor review or machine QC is being represented as my review.",
  ),
} satisfies Readonly<Record<"g1" | "g2", HumanReviewAffirmation>>);

export interface ApprovalActor {
  kind: ApprovalActorKind;
  authenticated: boolean;
  authUserId: string;
  displayName: string;
  declaredRole: ApprovalRole;
}

export interface RecordedApprovalDecision {
  gate: ApprovalGate;
  decision: ApprovalDecision;
  actor: ApprovalActor;
  decidedAt: string;
  /** Present on an approved G3 record; omitted for G1/G2 and revision findings. */
  g3Affirmations?: unknown;
}

export type ApprovalPolicyErrorCode =
  | "INVALID_MACHINE_ROW"
  | "INVALID_ROW_CLASSIFICATION"
  | "INVALID_INDICATOR_METADATA"
  | "DUPLICATE_ROW_ID"
  | "ROW_COVERAGE_INVALID"
  | "ACTOR_NOT_AUTHENTICATED_HUMAN"
  | "ACTOR_ROLE_NOT_ALLOWED"
  | "GATE_ALREADY_RECORDED"
  | "G1_REQUIRED"
  | "G2_REQUIRED"
  | "G2_REVIEWER_NOT_INDEPENDENT"
  | "G3_COUNTRY_OWNER_REQUIRED"
  | "G3_AFFIRMATIONS_INVALID";

export class ApprovalPolicyError extends Error {
  readonly code: ApprovalPolicyErrorCode;
  readonly details: Readonly<object>;

  constructor(code: ApprovalPolicyErrorCode, message: string, details: Readonly<object> = {}) {
    super(message);
    this.name = "ApprovalPolicyError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface IndicatorReviewMetadata {
  prerequisite: boolean;
  /** May supply a derived class when an older row did not persist `cls`. */
  classification?: EvidenceClass;
}

export interface CanonicalObservationRow {
  /** The canonical indicator ID, which is also the review row ID. */
  rowId: string;
  indicatorId: string;
  /** Deep-frozen canonical clone of the exact observation row the humans review. */
  payload: CanonicalReviewPayload;
  rowSha256: string;
  classification: EvidenceClass;
  prerequisite: boolean;
}

type JsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
  JsonPrimitive | readonly CanonicalJsonValue[] | { readonly [key: string]: CanonicalJsonValue };
export type CanonicalReviewPayload = Readonly<Record<string, CanonicalJsonValue>>;

const EVIDENCE_CLASSES: readonly EvidenceClass[] = ["Measured", "Documented", "Judged", "Gap"];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJsonValue(value: unknown, path: string): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApprovalPolicyError("INVALID_MACHINE_ROW", `${path} contains a non-finite number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new ApprovalPolicyError(
          "INVALID_MACHINE_ROW",
          `${path}[${index}] contains undefined`,
        );
      }
      return canonicalJsonValue(item, `${path}[${index}]`);
    });
  }
  if (isPlainObject(value)) {
    const canonical: { [key: string]: CanonicalJsonValue } = {};
    for (const key of Object.keys(value).sort(compareText)) {
      const item = value[key];
      // Optional row properties are absent from their canonical representation.
      if (item !== undefined) canonical[key] = canonicalJsonValue(item, `${path}.${key}`);
    }
    return canonical;
  }
  throw new ApprovalPolicyError("INVALID_MACHINE_ROW", `${path} is not canonical JSON data`);
}

function deepFreezeCanonical(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeCanonical(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreezeCanonical(item);
    return Object.freeze(value);
  }
  return value;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(value, "row")))
    .digest("hex");
}

function evidenceClass(value: unknown): value is EvidenceClass {
  return EVIDENCE_CLASSES.some((candidate) => candidate === value);
}

function machineRowFromArtifactEntry(indicatorId: string, entry: unknown): Record<string, unknown> {
  if (!isPlainObject(entry)) {
    throw new ApprovalPolicyError(
      "INVALID_MACHINE_ROW",
      `Indicator ${indicatorId} does not contain a machine-filled row`,
      { indicatorId },
    );
  }

  if (Object.hasOwn(entry, "row")) {
    if (!isPlainObject(entry.row)) {
      throw new ApprovalPolicyError(
        "INVALID_MACHINE_ROW",
        `Indicator ${indicatorId} has an invalid nested machine-filled row`,
        { indicatorId },
      );
    }
    return entry.row;
  }

  return entry;
}

/**
 * Canonicalizes the two persisted Stage 1 observation shapes:
 *
 * - current coordinator output: `{ "1.1": { row: { value, cls, ... }, ... } }`
 * - older/direct output: `{ "1.1": { value, cls, ... } }`
 *
 * Coordinator wrapper fields are deliberately excluded. The hash covers the exact
 * review-relevant row payload plus its indicator identity, derived class and
 * prerequisite status. Callers must pass metadata and the candidate-ID rule from
 * the model pinned to the run. Carried candidates are reviewable, but never scored
 * or treated as prerequisites.
 *
 * This pure TypeScript hash is useful for policy calculations. Persisted approval
 * identities use the database's versioned `expected_human_approval_rows` helper so
 * JSON number lexemes are never rounded or re-rendered by JavaScript.
 */
export function canonicalizeMachineFilledObservationRows(
  artifact: Readonly<Record<string, unknown>>,
  metadataByIndicatorId: Readonly<Record<string, IndicatorReviewMetadata>>,
  candidateIndicatorIdPattern?: string,
): readonly CanonicalObservationRow[] {
  const canonicalRows: CanonicalObservationRow[] = [];
  const seen = new Set<string>();
  const candidatePattern = candidateIndicatorIdPattern
    ? new RegExp(candidateIndicatorIdPattern)
    : null;

  for (const artifactIndicatorId of Object.keys(artifact).sort(compareText)) {
    const indicatorId = artifactIndicatorId.trim();
    if (!indicatorId) {
      throw new ApprovalPolicyError("INVALID_MACHINE_ROW", "An indicator ID cannot be blank");
    }
    if (seen.has(indicatorId)) {
      throw new ApprovalPolicyError(
        "DUPLICATE_ROW_ID",
        `Duplicate canonical row ID ${indicatorId}`,
        { rowId: indicatorId },
      );
    }
    seen.add(indicatorId);

    const metadata =
      metadataByIndicatorId[indicatorId] ??
      (candidatePattern?.test(indicatorId) ? { prerequisite: false } : undefined);
    if (!metadata || typeof metadata.prerequisite !== "boolean") {
      throw new ApprovalPolicyError(
        "INVALID_INDICATOR_METADATA",
        `Indicator ${indicatorId} is missing prerequisite metadata`,
        { indicatorId },
      );
    }

    const row = machineRowFromArtifactEntry(indicatorId, artifact[artifactIndicatorId]);
    if (!Object.hasOwn(row, "value")) {
      throw new ApprovalPolicyError(
        "INVALID_MACHINE_ROW",
        `Indicator ${indicatorId} does not contain a machine-filled observation value`,
        { indicatorId },
      );
    }
    const classification = evidenceClass(row.cls) ? row.cls : metadata.classification;
    if (!classification || !evidenceClass(classification)) {
      throw new ApprovalPolicyError(
        "INVALID_ROW_CLASSIFICATION",
        `Indicator ${indicatorId} has no valid assessment classification`,
        { indicatorId },
      );
    }
    const payload = deepFreezeCanonical(
      canonicalJsonValue(row, `row.${indicatorId}`),
    ) as CanonicalReviewPayload;

    canonicalRows.push(
      Object.freeze({
        rowId: indicatorId,
        indicatorId,
        payload,
        rowSha256: sha256Canonical({
          classification,
          indicator_id: indicatorId,
          prerequisite: metadata.prerequisite,
          row: payload,
        }),
        classification,
        prerequisite: metadata.prerequisite,
      }),
    );
  }

  return Object.freeze(canonicalRows);
}

export const G2_SAMPLE_RATE = 0.15;

export type G2ScopeReason = "prerequisite" | "judged" | "sample";

export interface G2ScopedRow extends CanonicalObservationRow {
  reasons: readonly G2ScopeReason[];
}

export interface G2ReviewScope {
  rows: readonly G2ScopedRow[];
  prerequisiteRowIds: readonly string[];
  judgedRowIds: readonly string[];
  sampledRowIds: readonly string[];
  remainderCount: number;
  sampleSize: number;
}

function uniqueCanonicalRows(
  rows: readonly CanonicalObservationRow[],
): readonly CanonicalObservationRow[] {
  const byId = new Map<string, CanonicalObservationRow>();
  for (const row of rows) {
    const existing = byId.get(row.rowId);
    if (existing) {
      if (
        existing.rowSha256 !== row.rowSha256 ||
        existing.classification !== row.classification ||
        existing.prerequisite !== row.prerequisite
      ) {
        throw new ApprovalPolicyError(
          "DUPLICATE_ROW_ID",
          `Canonical row ID ${row.rowId} identifies different rows`,
          { rowId: row.rowId },
        );
      }
      continue;
    }
    byId.set(row.rowId, row);
  }
  return [...byId.values()].sort((left, right) => compareText(left.rowId, right.rowId));
}

/**
 * Builds the QC Protocol G2 scope. `sampleSeed` should be the immutable complete
 * bundle SHA-256 so the sample is deterministic for one exact Draft package.
 */
export function buildG2ReviewScope(
  rows: readonly CanonicalObservationRow[],
  sampleSeed: string,
): G2ReviewScope {
  if (!sampleSeed.trim()) {
    throw new ApprovalPolicyError("INVALID_MACHINE_ROW", "G2 sample seed cannot be blank");
  }

  const uniqueRows = uniqueCanonicalRows(rows);
  const prerequisiteRowIds = uniqueRows.filter((row) => row.prerequisite).map((row) => row.rowId);
  const judgedRowIds = uniqueRows
    .filter((row) => row.classification === "Judged")
    .map((row) => row.rowId);
  const mandatory = new Set([...prerequisiteRowIds, ...judgedRowIds]);
  const remainder = uniqueRows.filter((row) => !mandatory.has(row.rowId));
  const sampleSize = Math.ceil(remainder.length * G2_SAMPLE_RATE);
  const sampledRowIds = remainder
    .map((row) => ({
      rowId: row.rowId,
      rank: createHash("sha256")
        .update(sampleSeed)
        .update("\0")
        .update(row.rowId)
        .update("\0")
        .update(row.rowSha256)
        .digest("hex"),
    }))
    .sort(
      (left, right) => compareText(left.rank, right.rank) || compareText(left.rowId, right.rowId),
    )
    .slice(0, sampleSize)
    .map(({ rowId }) => rowId)
    .sort(compareText);
  const sampled = new Set(sampledRowIds);

  const scopedRows = uniqueRows
    .filter((row) => mandatory.has(row.rowId) || sampled.has(row.rowId))
    .map((row): G2ScopedRow => {
      const reasons: G2ScopeReason[] = [];
      if (row.prerequisite) reasons.push("prerequisite");
      if (row.classification === "Judged") reasons.push("judged");
      if (sampled.has(row.rowId)) reasons.push("sample");
      return Object.freeze({ ...row, reasons: Object.freeze(reasons) });
    });

  return Object.freeze({
    rows: Object.freeze(scopedRows),
    prerequisiteRowIds: Object.freeze(prerequisiteRowIds),
    judgedRowIds: Object.freeze(judgedRowIds),
    sampledRowIds: Object.freeze(sampledRowIds),
    remainderCount: remainder.length,
    sampleSize,
  });
}

export interface RowCoverageValidation {
  ok: boolean;
  missingRowIds: readonly string[];
  extraRowIds: readonly string[];
  duplicateRowIds: readonly string[];
  duplicateExpectedRowIds: readonly string[];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].sort(compareText);
}

/** Exact means exact: missing, extra and repeated review rows all fail. */
export function validateExactRowCoverage(
  expectedRowIds: readonly string[],
  reviewedRowIds: readonly string[],
): RowCoverageValidation {
  const duplicateExpectedRowIds = duplicates(expectedRowIds);
  const duplicateRowIds = duplicates(reviewedRowIds);
  const expected = new Set(expectedRowIds);
  const reviewed = new Set(reviewedRowIds);
  const missingRowIds = [...expected].filter((rowId) => !reviewed.has(rowId)).sort(compareText);
  const extraRowIds = [...reviewed].filter((rowId) => !expected.has(rowId)).sort(compareText);
  return Object.freeze({
    ok:
      missingRowIds.length === 0 &&
      extraRowIds.length === 0 &&
      duplicateRowIds.length === 0 &&
      duplicateExpectedRowIds.length === 0,
    missingRowIds: Object.freeze(missingRowIds),
    extraRowIds: Object.freeze(extraRowIds),
    duplicateRowIds: Object.freeze(duplicateRowIds),
    duplicateExpectedRowIds: Object.freeze(duplicateExpectedRowIds),
  });
}

export function assertExactRowCoverage(
  expectedRowIds: readonly string[],
  reviewedRowIds: readonly string[],
): void {
  const coverage = validateExactRowCoverage(expectedRowIds, reviewedRowIds);
  if (!coverage.ok) {
    throw new ApprovalPolicyError(
      "ROW_COVERAGE_INVALID",
      "Reviewed rows must exactly match the required gate scope",
      coverage,
    );
  }
}

export const G3_AFFIRMATIONS = Object.freeze([
  Object.freeze({ id: "no_cross_country_ranking", text: "No cross-country ranking" }),
  Object.freeze({
    id: "no_band_as_financing_condition",
    text: "No band as a PDO, DLI, or disbursement condition",
  }),
  Object.freeze({
    id: "no_automatic_financing_decisions",
    text: "No automatic financing decisions",
  }),
  Object.freeze({
    id: "no_public_claim_before_human_review",
    text: "No public claim before human review",
  }),
  Object.freeze({
    id: "parenthesized_bands_acknowledged",
    text: "Parenthesized bands are acknowledged in the transmittal",
  }),
  Object.freeze({
    id: "register_rows_source_tier_verified",
    text: "Register rows are verified to the Source-Tier Protocol or explicitly marked illustrative",
  }),
  Object.freeze({ id: "qc_footer_accurate", text: "The QC footer line is accurate." }),
] as const);

export type G3AffirmationId = (typeof G3_AFFIRMATIONS)[number]["id"];
export const G3_AFFIRMATION_IDS: readonly G3AffirmationId[] = Object.freeze(
  G3_AFFIRMATIONS.map(({ id }) => id),
);
export type G3AffirmationChecklist = Record<G3AffirmationId, boolean>;

export interface G3AffirmationValidation {
  ok: boolean;
  missingIds: readonly G3AffirmationId[];
  extraIds: readonly string[];
  nonBooleanIds: readonly G3AffirmationId[];
  falseIds: readonly G3AffirmationId[];
}

export function validateG3Affirmations(value: unknown): G3AffirmationValidation {
  const checklist = isPlainObject(value) ? value : {};
  const knownIds = new Set<string>(G3_AFFIRMATION_IDS);
  const missingIds = G3_AFFIRMATION_IDS.filter((id) => !Object.hasOwn(checklist, id));
  const extraIds = Object.keys(checklist)
    .filter((id) => !knownIds.has(id))
    .sort(compareText);
  const nonBooleanIds = G3_AFFIRMATION_IDS.filter(
    (id) => Object.hasOwn(checklist, id) && typeof checklist[id] !== "boolean",
  );
  const falseIds = G3_AFFIRMATION_IDS.filter((id) => checklist[id] === false);
  return Object.freeze({
    ok:
      isPlainObject(value) &&
      missingIds.length === 0 &&
      extraIds.length === 0 &&
      nonBooleanIds.length === 0 &&
      falseIds.length === 0,
    missingIds: Object.freeze([...missingIds]),
    extraIds: Object.freeze(extraIds),
    nonBooleanIds: Object.freeze([...nonBooleanIds]),
    falseIds: Object.freeze([...falseIds]),
  });
}

export function assertG3AffirmationsForApproval(
  value: unknown,
): asserts value is G3AffirmationChecklist {
  const validation = validateG3Affirmations(value);
  if (!validation.ok) {
    throw new ApprovalPolicyError(
      "G3_AFFIRMATIONS_INVALID",
      "G3 approval requires all seven QC Protocol affirmations",
      validation,
    );
  }
}

export interface GateDecisionPolicyInput {
  gate: ApprovalGate;
  decision: ApprovalDecision;
  actor: ApprovalActor;
  priorDecisions: readonly RecordedApprovalDecision[];
  expectedRowIds?: readonly string[];
  reviewedRowIds?: readonly string[];
  countryOwnerUserId?: string;
  g3Affirmations?: unknown;
}

function assertAuthenticatedHuman(actor: ApprovalActor): void {
  if (
    actor.kind !== "human" ||
    !actor.authenticated ||
    !actor.authUserId.trim() ||
    !actor.displayName.trim()
  ) {
    throw new ApprovalPolicyError(
      "ACTOR_NOT_AUTHENTICATED_HUMAN",
      "Approval gates require a named, authenticated human actor",
      { actorKind: actor.kind },
    );
  }
}

function validHumanDecision(
  decision: RecordedApprovalDecision | undefined,
  role: ApprovalRole,
): decision is RecordedApprovalDecision {
  return Boolean(
    decision &&
    decision.actor.kind === "human" &&
    decision.actor.authenticated &&
    decision.actor.authUserId.trim() &&
    decision.actor.displayName.trim() &&
    decision.actor.declaredRole === role,
  );
}

function approvedDecision(
  decisions: readonly RecordedApprovalDecision[],
  gate: ApprovalGate,
): RecordedApprovalDecision | undefined {
  return decisions.find((decision) => decision.gate === gate && decision.decision === "approved");
}

/**
 * Enforces actor, order, independence, scope and G3 owner policy before a gate
 * decision is appended. Persistence must still make the append atomic and unique.
 */
export function assertGateDecisionAllowed(input: GateDecisionPolicyInput): void {
  assertAuthenticatedHuman(input.actor);
  if (input.priorDecisions.some((decision) => decision.gate === input.gate)) {
    throw new ApprovalPolicyError(
      "GATE_ALREADY_RECORDED",
      `${input.gate} already has an immutable decision`,
      { gate: input.gate },
    );
  }

  const requiredRole: ApprovalRole =
    input.gate === "G1"
      ? "assessor"
      : input.gate === "G2"
        ? "independent_reviewer"
        : "ttl_country_owner";
  if (input.actor.declaredRole !== requiredRole) {
    throw new ApprovalPolicyError(
      "ACTOR_ROLE_NOT_ALLOWED",
      `${input.gate} requires the ${requiredRole} role`,
      { actualRole: input.actor.declaredRole, requiredRole },
    );
  }

  if (input.gate === "G1") {
    assertExactRowCoverage(input.expectedRowIds ?? [], input.reviewedRowIds ?? []);
    return;
  }

  const g1 = approvedDecision(input.priorDecisions, "G1");
  if (!validHumanDecision(g1, "assessor")) {
    throw new ApprovalPolicyError("G1_REQUIRED", `${input.gate} requires valid human G1 approval`);
  }

  if (input.gate === "G2") {
    if (input.actor.authUserId === g1.actor.authUserId) {
      throw new ApprovalPolicyError(
        "G2_REVIEWER_NOT_INDEPENDENT",
        "G2 must be performed by a different authenticated user from G1",
        { authUserId: input.actor.authUserId },
      );
    }
    assertExactRowCoverage(input.expectedRowIds ?? [], input.reviewedRowIds ?? []);
    return;
  }

  const g2 = approvedDecision(input.priorDecisions, "G2");
  if (
    !validHumanDecision(g2, "independent_reviewer") ||
    g2.actor.authUserId === g1.actor.authUserId
  ) {
    throw new ApprovalPolicyError("G2_REQUIRED", "G3 requires valid independent human G2 approval");
  }
  if (!input.countryOwnerUserId?.trim() || input.actor.authUserId !== input.countryOwnerUserId) {
    throw new ApprovalPolicyError(
      "G3_COUNTRY_OWNER_REQUIRED",
      "G3 must be performed by the configured country owner",
    );
  }
  if (input.decision === "approved") assertG3AffirmationsForApproval(input.g3Affirmations);
}

export type ApprovalLifecycleState =
  | "pre_review_draft"
  | "g1_pending"
  | "g2_pending"
  | "g3_pending"
  | "revisions_required"
  | "approved_draft"
  | "canonical_final";

export type MethodologyVerificationStatus = "canonical" | "legacy_unverified" | "unverified";

export interface ApprovalLifecycleInput {
  reviewStarted: boolean;
  decisions: readonly RecordedApprovalDecision[];
  countryOwnerUserId: string;
  methodologyStatus: MethodologyVerificationStatus;
  methodologyModelStatus: string;
  methodologyRatified: boolean;
}

/** Invalid, automated or out-of-order records never advance the visible lifecycle. */
export function deriveApprovalLifecycle(input: ApprovalLifecycleInput): ApprovalLifecycleState {
  const g1 = input.decisions.find((decision) => decision.gate === "G1");
  if (!validHumanDecision(g1, "assessor")) {
    return input.reviewStarted ? "g1_pending" : "pre_review_draft";
  }
  if (g1.decision === "revisions_required") return "revisions_required";

  const g2 = input.decisions.find((decision) => decision.gate === "G2");
  if (
    !validHumanDecision(g2, "independent_reviewer") ||
    g2.actor.authUserId === g1.actor.authUserId
  ) {
    return "g2_pending";
  }
  if (g2.decision === "revisions_required") return "revisions_required";

  const g3 = input.decisions.find((decision) => decision.gate === "G3");
  if (
    !validHumanDecision(g3, "ttl_country_owner") ||
    !input.countryOwnerUserId.trim() ||
    g3.actor.authUserId !== input.countryOwnerUserId
  ) {
    return "g3_pending";
  }
  if (g3.decision === "revisions_required") return "revisions_required";

  if (!validateG3Affirmations(g3.g3Affirmations).ok) return "g3_pending";

  return input.methodologyStatus === "canonical" &&
    input.methodologyRatified &&
    input.methodologyModelStatus.trim().toLowerCase() === "ratified"
    ? "canonical_final"
    : "approved_draft";
}
