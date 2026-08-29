import {
  DAMM_MODEL_EXPORT,
  DAMM_MODEL_IDENTITY,
  DAMM_MODEL_SOURCE_SHA256,
  DAMM_RUNTIME_IDENTITY,
  model,
} from "./model.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "./workflow.ts";

/** Immutable methodology identity copied into the database at workflow launch. */
export interface WorkflowMethodologyIdentity {
  manifestSchemaVersion: "damm.model-export/v1";
  modelId: string;
  modelVersion: string;
  modelRevision: number;
  modelStatus: string;
  modelRatified: boolean;
  appModelSha256: string;
  appModelSchemaSha256: string;
  sourceRepository: string;
  sourceCommit: string;
  sourceModelPath: string;
  sourceModelSha256: string;
  sourceSchemaPath: string;
  sourceSchemaSha256: string;
  censusRevision: string;
  censusPath: string;
  censusSha256: string;
  engineVersion: string;
  enginePath: string;
  engineSha256: string;
  rendererVersion: string;
  rendererPath: string;
  rendererSha256: string;
}

export const DAMM_WORKFLOW_METHODOLOGY: Readonly<WorkflowMethodologyIdentity> = Object.freeze({
  manifestSchemaVersion: DAMM_MODEL_EXPORT.schema_version,
  modelId: DAMM_MODEL_IDENTITY.modelId,
  modelVersion: DAMM_MODEL_IDENTITY.version,
  modelRevision: DAMM_MODEL_IDENTITY.revision,
  modelStatus: DAMM_MODEL_IDENTITY.status,
  modelRatified: DAMM_MODEL_IDENTITY.ratified,
  appModelSha256: DAMM_MODEL_IDENTITY.modelSha256,
  appModelSchemaSha256: DAMM_MODEL_IDENTITY.schemaSha256,
  sourceRepository: DAMM_MODEL_IDENTITY.sourceRepository,
  sourceCommit: DAMM_MODEL_IDENTITY.sourceCommit,
  sourceModelPath: DAMM_MODEL_IDENTITY.sourceModelPath,
  sourceModelSha256: DAMM_MODEL_SOURCE_SHA256[DAMM_MODEL_IDENTITY.sourceModelPath],
  sourceSchemaPath: DAMM_MODEL_IDENTITY.sourceSchemaPath,
  sourceSchemaSha256: DAMM_MODEL_SOURCE_SHA256[DAMM_MODEL_IDENTITY.sourceSchemaPath],
  censusRevision: DAMM_RUNTIME_IDENTITY.indicator_census.revision,
  censusPath: DAMM_RUNTIME_IDENTITY.indicator_census.path,
  censusSha256: DAMM_RUNTIME_IDENTITY.indicator_census.sha256,
  engineVersion: DAMM_RUNTIME_IDENTITY.engine.version,
  enginePath: DAMM_RUNTIME_IDENTITY.engine.path,
  engineSha256: DAMM_RUNTIME_IDENTITY.engine.sha256,
  rendererVersion: DAMM_RUNTIME_IDENTITY.renderer.version,
  rendererPath: DAMM_RUNTIME_IDENTITY.renderer.path,
  rendererSha256: DAMM_RUNTIME_IDENTITY.renderer.sha256,
});

const METHODOLOGY_KEYS = Object.keys(
  DAMM_WORKFLOW_METHODOLOGY,
) as (keyof WorkflowMethodologyIdentity)[];

export function methodologyMatchesCanonical(value: WorkflowMethodologyIdentity): boolean {
  return methodologyIdentitiesMatch(value, DAMM_WORKFLOW_METHODOLOGY);
}

/** Exact identity equality for immutable launch/package snapshots, including historical pins. */
export function methodologyIdentitiesMatch(
  left: WorkflowMethodologyIdentity,
  right: WorkflowMethodologyIdentity,
): boolean {
  return METHODOLOGY_KEYS.every((key) => left[key] === right[key]);
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortedJsonValue(child)]),
    );
  }
  return value;
}

/** The downstream census is generated from the model, never maintained as a second list. */
export function canonicalIndicatorCensus(): Record<string, unknown> {
  return sortedJsonValue({
    schema_version: "damm.indicator-census/v1",
    model_id: DAMM_MODEL_IDENTITY.modelId,
    model_version: DAMM_MODEL_IDENTITY.version,
    model_revision: DAMM_MODEL_IDENTITY.revision,
    indicators: model.indicators,
  }) as Record<string, unknown>;
}

/**
 * Per-run build manifest. The assessment input digest is obtained from the verified
 * Stage 1 manifest; every other field comes from the launch-frozen methodology identity.
 */
export function runMethodologyManifest(
  runId: string,
  assessmentInput: { path: string; sha256: string },
): Record<string, unknown> {
  return {
    schema_version: "damm.run-methodology/v1",
    run_id: runId,
    workflow: {
      workflow_id: DAR_WORKFLOW.workflow_id,
      workflow_version: DAR_WORKFLOW.workflow_version,
      contract_sha256: DAR_WORKFLOW_SHA256,
    },
    model: {
      id: DAMM_WORKFLOW_METHODOLOGY.modelId,
      version: DAMM_WORKFLOW_METHODOLOGY.modelVersion,
      revision: DAMM_WORKFLOW_METHODOLOGY.modelRevision,
      status: DAMM_WORKFLOW_METHODOLOGY.modelStatus,
      ratified: DAMM_WORKFLOW_METHODOLOGY.modelRatified,
      app_sha256: DAMM_WORKFLOW_METHODOLOGY.appModelSha256,
      app_schema_sha256: DAMM_WORKFLOW_METHODOLOGY.appModelSchemaSha256,
      source_sha256: DAMM_WORKFLOW_METHODOLOGY.sourceModelSha256,
      source_schema_sha256: DAMM_WORKFLOW_METHODOLOGY.sourceSchemaSha256,
    },
    source: {
      repository: DAMM_WORKFLOW_METHODOLOGY.sourceRepository,
      commit: DAMM_WORKFLOW_METHODOLOGY.sourceCommit,
      model_path: DAMM_WORKFLOW_METHODOLOGY.sourceModelPath,
      schema_path: DAMM_WORKFLOW_METHODOLOGY.sourceSchemaPath,
    },
    indicator_census: {
      revision: DAMM_WORKFLOW_METHODOLOGY.censusRevision,
      path: DAMM_WORKFLOW_METHODOLOGY.censusPath,
      sha256: DAMM_WORKFLOW_METHODOLOGY.censusSha256,
    },
    engine: {
      version: DAMM_WORKFLOW_METHODOLOGY.engineVersion,
      path: DAMM_WORKFLOW_METHODOLOGY.enginePath,
      sha256: DAMM_WORKFLOW_METHODOLOGY.engineSha256,
    },
    renderer: {
      version: DAMM_WORKFLOW_METHODOLOGY.rendererVersion,
      path: DAMM_WORKFLOW_METHODOLOGY.rendererPath,
      sha256: DAMM_WORKFLOW_METHODOLOGY.rendererSha256,
    },
    assessment_input: assessmentInput,
  };
}
