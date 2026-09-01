export interface DurableStagePublication {
  stageOrdinal: number;
}

/**
 * Reconcile the event-derived counter with the durable completed-stage archive.
 * The archive is canonical-prefix-only, so its highest ordinal is authoritative
 * when the final worker reconciliation commits before the matching UI event.
 */
export function completedWorkflowStageCount(
  status: string,
  eventRowsDone: number,
  publications: readonly DurableStagePublication[],
  stageCount: number,
): number {
  const durableOrdinal = publications.reduce(
    (highest, publication) => Math.max(highest, publication.stageOrdinal),
    0,
  );
  return Math.min(
    stageCount,
    Math.max(status === "done" ? stageCount : 0, eventRowsDone, durableOrdinal),
  );
}
