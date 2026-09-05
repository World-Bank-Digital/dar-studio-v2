import { completedWorkflowStageCount } from "./completed-stage-progress.ts";
import { DAR_WORKFLOW } from "./workflow.ts";
import { progressOf, stoppedSummary, type Run } from "./runs.ts";
import type { RunEventRow } from "./run-store.ts";
import type { CompletedStageArtifactMetadata } from "./completed-stage-artifacts.server.ts";

/** Explicit browser projection: persisted diagnostics and capabilities stay server-side. */
export function publicRunView(
  run: Run,
  completedStageArtifacts: CompletedStageArtifactMetadata[] = [],
  packagedArtifacts: { key: string; byteSize: number }[] = [],
) {
  const safe: Run = {
    id: run.id,
    userId: run.userId,
    countryId: run.countryId,
    countryName: run.countryName,
    iso3: run.iso3,
    pass: run.pass,
    status: run.status,
    ceilingUsd: run.ceilingUsd,
    spentUsd: run.spentUsd,
    rowsTotal: run.rowsTotal,
    rowsDone:
      run.pass === "workflow"
        ? completedWorkflowStageCount(
            run.status,
            run.rowsDone,
            completedStageArtifacts,
            DAR_WORKFLOW.stages.length,
          )
        : run.rowsDone,
    vendor: null,
    outBasename: "",
    claimedBy: null,
    heartbeatAt: null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    stoppedReason: null,
  };
  return {
    ...safe,
    progress: progressOf(safe),
    summary: stoppedSummary(safe),
    completedStageArtifacts: completedStageArtifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      stageId: artifact.stageId,
      stageOrdinal: artifact.stageOrdinal,
      key: artifact.key,
      filename: artifact.filename,
      byteSize: artifact.byteSize,
    })),
    packagedArtifacts: packagedArtifacts.map((artifact) => ({
      key: artifact.key,
      byteSize: artifact.byteSize,
    })),
  };
}

/** Never treat free-form provider/worker output as product copy, including historical events. */
export function publicRunEvent(event: RunEventRow): RunEventRow {
  const messages: Record<string, string> = {
    status: "Run status updated.",
    stage_started: "A workflow stage started.",
    stage_complete: "A workflow stage completed.",
    workflow_complete: "Workflow completed.",
    failed: "The run stopped before completion.",
  };
  const kind = Object.hasOwn(messages, event.kind) ? event.kind : "update";
  return {
    id: event.id,
    at: event.at,
    kind,
    indicatorId: null,
    message: messages[kind] ?? "Workflow activity recorded.",
  };
}
