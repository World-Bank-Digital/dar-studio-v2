/**
 * Deciding what a finished pass may write into the evidence base.
 *
 * A pass produces a proposal, not a verdict. The rule this file exists to hold is that a
 * machine pass never overwrites a person's entry: an assessor who recorded a value, or
 * placed a ratification hold, has made a judgement, and a background worker replacing it
 * silently is the one thing this surface must not do. Those rows are reported instead,
 * with both readings shown, so the divergence is visible rather than resolved by whoever
 * wrote last.
 *
 * A row a previous pass wrote is not a person's entry, so a later pass may replace it.
 * Machine replacing machine loses nothing that was not already reproducible.
 *
 * A partial pass is importable. Rows it never reached are left exactly as they were and
 * are never written as gaps — the difference between "we did not look" and "we looked and
 * found nothing" is the whole point of the instrument, and it has to survive an import.
 */
import { fixtureToRecord, type EvidenceRecord, type FixtureObservation } from "./evidence.ts";
import { indicatorById } from "./model.ts";

/** The role written on every row a pass imports. Also how a later pass recognises its own. */
export const PIPELINE_ROLE = "Assessment pipeline";

/** A row of `<basename>_input.json`. A superset of the fixture shape. */
export interface PassRow extends FixtureObservation {
  note?: string | null;
  tier_detail?: string | null;
}

export interface Divergence {
  indicatorId: string;
  /** What the assessor recorded, in the words the row carries. */
  yours: string;
  /** What the pass found. */
  found: string;
  assessorName: string | null;
}

export interface ImportPlan {
  /** Rows that may be written. */
  records: EvidenceRecord[];
  /** Rows left alone because a person had entered them, with both readings. */
  held: Divergence[];
  /** Rows the pass never reached. Untouched, and never written as gaps. */
  notReached: string[];
  /** Rows the pass named that this instrument does not have. */
  unknown: string[];
}

/** Human-readable one-line reading of an entry, for showing a divergence. */
function readingOf(r: {
  valueRaw: string | null;
  sourceTier: string | null;
  observationYear: number | null;
  assessorLevel: number | null;
  ratificationHold: boolean;
}): string {
  const bits: string[] = [];
  bits.push(r.valueRaw === null || r.valueRaw === "" ? "no value" : r.valueRaw);
  const meta = [r.sourceTier, r.observationYear ? String(r.observationYear) : null]
    .filter(Boolean)
    .join(", ");
  if (meta) bits.push(`(${meta})`);
  if (r.assessorLevel != null) bits.push(`Level ${r.assessorLevel}`);
  if (r.ratificationHold) bits.push("— level withheld");
  return bits.join(" ");
}

/**
 * A row counts as a person's if someone other than a pass recorded it.
 *
 * The test is the recorded assessor, not whether the row has a value: a ratification hold
 * placed on an empty row is a judgement too, and an import that overwrote it would erase a
 * withheld level, which reads afterwards as a level nobody withheld.
 */
export function isHumanEntry(r: EvidenceRecord): boolean {
  if (r.assessorRole && r.assessorRole !== PIPELINE_ROLE) return true;
  // No assessor recorded, but something is there. Provenance is unknown, and unknown
  // provenance is treated as a person's — the cautious direction is to keep it.
  if (!r.assessorRole && (r.valueRaw !== null || r.ratificationHold)) return true;
  return false;
}

export function planImport(
  existing: EvidenceRecord[],
  passRows: Record<string, PassRow>,
  actor: { role: string; name: string },
): ImportPlan {
  const byId = new Map(existing.map((r) => [r.indicatorId, r]));
  const plan: ImportPlan = { records: [], held: [], notReached: [], unknown: [] };

  for (const [indicatorId, row] of Object.entries(passRows)) {
    if (!indicatorById(indicatorId)) {
      // Carried candidates and anything else outside the instrument. Reported, not
      // silently dropped: a row the pass paid for should not vanish without a word.
      plan.unknown.push(indicatorId);
      continue;
    }
    const current = byId.get(indicatorId);
    const proposed = fixtureToRecord(indicatorId, row, actor);
    if (row.note) proposed.notes = row.note;

    if (current && isHumanEntry(current)) {
      plan.held.push({
        indicatorId,
        yours: readingOf(current),
        found: readingOf(proposed),
        assessorName: current.assessorName,
      });
      continue;
    }
    plan.records.push(proposed);
  }

  for (const r of existing) {
    if (!(r.indicatorId in passRows)) plan.notReached.push(r.indicatorId);
  }
  return plan;
}

/** What the operator should be told the import did. */
export function summariseImport(plan: ImportPlan, rowsInPass: number, rowsInModel: number): string {
  const parts = [`Imported ${plan.records.length} of the ${rowsInPass} rows the pass produced.`];
  if (plan.held.length) {
    parts.push(
      `${plan.held.length} left as ${plan.held.length === 1 ? "it was" : "they were"} — ` +
        `you had entered ${plan.held.length === 1 ? "it" : "them"}, so the pass's reading is shown beside yours rather than replacing it.`,
    );
  }
  if (plan.notReached.length) {
    parts.push(
      `${plan.notReached.length} of the ${rowsInModel} rows were not reached by this pass and are untouched — they are not recorded as gaps.`,
    );
  }
  if (plan.unknown.length) {
    parts.push(`${plan.unknown.length} produced rows are not in this instrument and were not imported.`);
  }
  return parts.join(" ");
}
