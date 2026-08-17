import { nsoDomainsFor } from "./nso.ts";
import { mandatoryEntries, registryEntry, type SpecialistDesk } from "./registry.ts";
import { scoreEvidence, type EvidenceScore } from "./evidenceScore.ts";
import { formatObserved } from "./scoring.ts";
import type { EvidenceRow } from "./types.ts";

export interface ResearchTask {
  indicatorId: string;
  name: string;
  steward: string;
  specialist: SpecialistDesk;
  priority: "blocking" | "hardening";
  query: string;
  why: string;
}

export interface SpecialistChallenge {
  desk: SpecialistDesk;
  indicatorId: string;
  finding: string;
  action: "downgrade-note" | "require-human";
}

export interface GateLine {
  indicatorId: string;
  name: string;
  specialist: SpecialistDesk;
  kind: "quantitative" | "rubric";
  status: "direct" | "proxy" | "human-validated" | "human-gap" | "proposed" | "missing";
  populated: boolean;
  accounted: boolean;
  grade: EvidenceScore["grade"];
  score: number;
  year: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  fit: EvidenceScore["fit"];
  sourceClass: EvidenceScore["sourceClass"];
  note: string;
  failReason: string | null;
  reading: string;
  value: number | null;
  assessorLevel: number | null;
}

export interface GauntletResult {
  passed: boolean;
  mandatory: number;
  populated: number;
  populatedNeeded: number;
  accounted: number;
  gradeAB: number;
  abShare: number;
  abNeeded: number;
  silentGaps: string[];
  weakReadings: string[];
  lines: GateLine[];
  tasks: ResearchTask[];
  challenges: SpecialistChallenge[];
  summary: string;
}

function rowFor(rows: EvidenceRow[], id: string): EvidenceRow | undefined {
  return rows.find((r) => r.indicatorId === id);
}

function formatGateReading(
  kind: "quantitative" | "rubric",
  name: string,
  row: EvidenceRow | undefined,
): string {
  if (row?.dataGap && row.assessorLevel == null && row.value == null) return "Explicit data gap";
  if (kind === "rubric") {
    if (row?.assessorLevel != null) return `Assessor level ${row.assessorLevel}`;
    if (row?.provenance === "machine-researched" && row.suggestedLevel != null) {
      return `Proposed L${row.suggestedLevel} (machine-researched)`;
    }
    return "Documentary — unmeasured";
  }
  if (row?.value == null) return "No series";
  const unit = /\(%|percent|per cent/i.test(name) ? "%" : "";
  return `${formatObserved(row.value)}${unit}`;
}

function specialistChallenge(line: GateLine): SpecialistChallenge | null {
  if (line.status === "human-gap" || line.status === "human-validated") return null;
  if (line.status === "proposed") {
    return {
      desk: line.specialist,
      indicatorId: line.indicatorId,
      finding: `${line.specialist} desk: ${line.name} carries a machine-researched proposal. Confirm, correct or reject it — the proposal's rationale and citations are on the evidence row.`,
      action: "require-human",
    };
  }
  if (line.kind === "rubric" && line.status === "missing") {
    return {
      desk: line.specialist,
      indicatorId: line.indicatorId,
      finding: `${line.specialist} desk: ${line.name} is a documentary gate with no proposal. Attach a primary document or mark an explicit data gap.`,
      action: "require-human",
    };
  }
  if (line.fit === "proxy" && (line.specialist === "connectivity" || line.name.toLowerCase().includes("rural"))) {
    return {
      desk: line.specialist,
      indicatorId: line.indicatorId,
      finding: `${line.specialist} desk: reading is a documented proxy (likely national for a rural/ag cut). Keep it labelled proxy. Do not promote to A.`,
      action: "downgrade-note",
    };
  }
  if (line.grade === "C" || line.grade === "D") {
    return {
      desk: line.specialist,
      indicatorId: line.indicatorId,
      finding: `${line.specialist} desk: grade ${line.grade} is not enough for a core gate. Find a national exact series or mark a human data gap.`,
      action: "require-human",
    };
  }
  return null;
}

export function evaluateGauntlet(rows: EvidenceRow[], iso3 = "XXX"): GauntletResult {
  const mandatory = mandatoryEntries();
  const populatedNeeded = Math.ceil(mandatory.length * 0.8);
  const lines: GateLine[] = [];
  const challenges: SpecialistChallenge[] = [];

  for (const entry of mandatory) {
    const row = rowFor(rows, entry.id);
    const scored = scoreEvidence({
      indicatorId: entry.id,
      value: row?.value ?? null,
      observationYear: row?.observationYear ?? null,
      sourceName: row?.sourceName,
      sourceUrl: row?.sourceUrl,
      isProxy: row?.isProxy,
      provenance: row?.provenance,
      dataGap: row?.dataGap,
      assessorLevel: row?.assessorLevel ?? null,
      suggestedLevel: row?.suggestedLevel ?? null,
    });
    const humanGap = Boolean(row?.dataGap);
    const humanValidated = row?.assessorLevel != null;
    const proposed = row?.provenance === "machine-researched" && row?.suggestedLevel != null;
    const hasReading = row?.value != null || humanValidated || proposed;
    const populated = hasReading && !humanGap;
    const accounted = populated || humanGap;

    let status: GateLine["status"] = "missing";
    if (humanGap && !hasReading) status = "human-gap";
    else if (humanValidated) status = "human-validated";
    else if (proposed) status = "proposed";
    else if (scored.fit === "proxy") status = "proxy";
    else if (hasReading && scored.fit === "direct") status = "direct";
    else if (row?.provenance === "named-gap") status = "missing";

    const ab = populated && (scored.grade === "A" || scored.grade === "B");
    let failReason: string | null = null;
    if (!accounted) failReason = "Unmeasured — machine named gap is not an accounted reading.";
    else if (populated && !ab && !humanGap) failReason = `Grade ${scored.grade} (${scored.total}/100) is below A/B and is not a human-marked gap.`;

    const line: GateLine = {
      indicatorId: entry.id,
      name: entry.name,
      specialist: entry.specialist,
      kind: entry.kind,
      status,
      populated,
      accounted,
      grade: scored.grade,
      score: scored.total,
      year: row?.observationYear ?? null,
      sourceName: row?.sourceName ?? null,
      sourceUrl: row?.sourceUrl ?? null,
      fit: scored.fit,
      sourceClass: scored.sourceClass,
      note: scored.note,
      failReason,
      reading: formatGateReading(entry.kind, entry.name, row),
      value: row?.value ?? null,
      assessorLevel: row?.assessorLevel ?? null,
    };
    lines.push(line);
    const challenge = specialistChallenge(line);
    if (challenge) challenges.push(challenge);
  }

  const populated = lines.filter((l) => l.populated).length;
  const accounted = lines.filter((l) => l.accounted).length;
  const gradeAB = lines.filter((l) => l.populated && (l.grade === "A" || l.grade === "B")).length;
  const abShare = populated === 0 ? 0 : gradeAB / populated;
  const abNeeded = populated === 0 ? populatedNeeded : Math.ceil(populated * 0.6);
  const silentGaps = lines.filter((l) => !l.accounted).map((l) => l.indicatorId);
  const weakReadings = lines.filter((l) => l.populated && l.grade !== "A" && l.grade !== "B").map((l) => l.indicatorId);

  const passed =
    populated >= populatedNeeded &&
    gradeAB >= abNeeded &&
    silentGaps.length === 0 &&
    weakReadings.length === 0;

  const domains = nsoDomainsFor(iso3);
  const site = domains.length ? domains.map((d) => `site:${d}`).join(" OR ") : "national statistics office";

  const tasks: ResearchTask[] = lines
    .filter((l) => l.failReason)
    .map((l) => {
      const entry = registryEntry(l.indicatorId);
      return {
        indicatorId: l.indicatorId,
        name: l.name,
        steward: entry?.steward ?? "Evidence panel",
        specialist: l.specialist,
        priority: l.populated ? "hardening" : "blocking",
        query: `${site} ${entry?.definition ?? l.name} ${entry?.preferredYearFrom ?? ""}–${entry?.preferredYearTo ?? ""}`,
        why: l.failReason ?? "Unaccounted core gate.",
      };
    });

  const summary = passed
    ? `Gauntlet passed. ${populated} of ${mandatory.length} core gates populated (need ${populatedNeeded}); ${gradeAB} of those are A/B.`
    : `Gauntlet not cleared. ${populated}/${mandatory.length} populated (need ${populatedNeeded}); ${gradeAB} A/B (need ${abNeeded} of the populated set); ${silentGaps.length} silent gaps; ${weakReadings.length} weak readings. Prescriptive chapters carry the conditional banner.`;

  return {
    passed,
    mandatory: mandatory.length,
    populated,
    populatedNeeded,
    accounted,
    gradeAB,
    abShare,
    abNeeded,
    silentGaps,
    weakReadings,
    lines,
    tasks,
    challenges,
    summary,
  };
}

/**
 * The prescriptive chapter set (conditional-banner carriers while the gauntlet
 * is uncleared). Kept as a named re-export for older tests and callers.
 */
export { PRESCRIPTIVE_CHAPTERS as POLICY_CHAPTERS } from "./outline.ts";
