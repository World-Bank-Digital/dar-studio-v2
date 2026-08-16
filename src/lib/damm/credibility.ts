import { isGovernmentHost } from "./nso.ts";
import { scoreEvidence } from "./evidenceScore.ts";

export type CredibilityTier = "A" | "B" | "C" | "D" | "E";

export interface Credibility {
  tier: CredibilityTier;
  score: number;
  label: string;
  note: string;
}

const TIER: Record<CredibilityTier, Omit<Credibility, "tier" | "note">> = {
  A: { score: 95, label: "A — Official statistical system, exact series" },
  B: { score: 80, label: "B — Official statistical system, documented proxy" },
  C: { score: 65, label: "C — Specialized official index" },
  D: { score: 45, label: "D — Reputable research or industry dataset" },
  E: { score: 20, label: "E — Secondary, unofficial, or uncited" },
};

const OFFICIAL_HOSTS = [
  "data.worldbank.org",
  "api.worldbank.org",
  "data360.worldbank.org",
  "data360api.worldbank.org",
  "worldbank.org",
  "itu.int",
  "un.org",
  "undp.org",
  "unesco.org",
  "fao.org",
  "wipo.int",
  "ilo.org",
  "oecd.org",
  "imf.org",
  "publicadministration.un.org",
  "capmas.gov.eg",
];

const RESEARCH_HOSTS = [
  "ourworldindata.org",
  "oxfordinsights.com",
  "ookla.com",
  "opendatawatch.com",
  "gsma.com",
  "speedtest.net",
];

const SPECIALIZED = ["id4d", "findex", "egdi", "gci", "odin", "barro-lee", "education statistics", "gender statistics", "gii", "b-ready", "bready"];
const RESEARCH = ["gsma", "oxford insights", "ookla", "openalex", "scopus", "our world in data", "owid", "wittgenstein", "speedtest"];

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function credibilityFor(input: {
  sourceName?: string | null;
  sourceUrl?: string | null;
  isProxy?: boolean;
  provenance?: string | null;
  dataGap?: boolean;
}): Credibility {
  const name = (input.sourceName ?? "").toLowerCase();
  const host = hostOf(input.sourceUrl);
  const official =
    OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || (host ? isGovernmentHost(host) : false);
  const specialized = SPECIALIZED.some((s) => name.includes(s) || host.includes(s));
  const research =
    RESEARCH.some((s) => name.includes(s)) || RESEARCH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

  let tier: CredibilityTier = "E";
  if (input.provenance === "named-gap" || input.dataGap) {
    tier = "E";
  } else if (official && !input.isProxy) {
    tier = "A";
  } else if (official && input.isProxy) {
    tier = "B";
  } else if (specialized && !input.isProxy) {
    tier = "C";
  } else if (research) {
    tier = "D";
  } else if (input.provenance === "machine-imported" || input.provenance === "proxy") {
    tier = input.isProxy ? "B" : "C";
  } else if (input.provenance === "assessor" || input.provenance === "manual") {
    tier = official ? (input.isProxy ? "B" : "A") : "D";
  }

  const meta = TIER[tier];
  const note =
    tier === "A"
      ? "Primary official series. Used first."
      : tier === "B"
        ? "Official publisher, but the series is a documented proxy for the DAMM indicator."
        : tier === "C"
          ? "Specialized official index. Used when no primary statistical series exists."
          : tier === "D"
            ? "Reputable non-official source. Used only after official series are exhausted."
            : "No verified public reading. Routed as a named gap — not a score.";
  return { tier, score: meta.score, label: meta.label, note };
}

export function confidenceFromCredibility(c: Credibility, isProxy: boolean): "High" | "Medium" | "Low/Estimated" {
  if (isProxy || c.tier === "D" || c.tier === "E") return "Low/Estimated";
  if (c.tier === "A") return "High";
  return "Medium";
}

export function rowCredibility(row: {
  indicatorId?: string;
  value?: number | null;
  observationYear?: number | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  isProxy?: boolean;
  provenance?: string | null;
  dataGap?: boolean;
  assessorLevel?: number | null;
}): Credibility {
  if (row.indicatorId) {
    const s = scoreEvidence({
      indicatorId: row.indicatorId,
      value: row.value,
      observationYear: row.observationYear,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl,
      isProxy: row.isProxy,
      provenance: row.provenance,
      dataGap: row.dataGap,
      assessorLevel: row.assessorLevel,
    });
    return { tier: s.grade, score: s.total, label: s.label, note: s.note };
  }
  return credibilityFor(row);
}

export interface CredibilitySummary {
  count: number;
  mean: number | null;
  byTier: Record<CredibilityTier, number>;
}

/** Mean of imported, cited readings only. Never a DAMM weight. */
export function importedCredibilitySummary(
  rows: Array<{
    indicatorId?: string;
    value?: number | null;
    observationYear?: number | null;
    sourceName?: string | null;
    sourceUrl?: string | null;
    isProxy?: boolean;
    provenance?: string | null;
    dataGap?: boolean;
    assessorLevel?: number | null;
  }>,
): CredibilitySummary {
  const byTier: Record<CredibilityTier, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const imported = rows.filter(
    (r) => r.value !== null && r.value !== undefined && !r.dataGap && r.provenance !== "named-gap",
  );
  if (imported.length === 0) return { count: 0, mean: null, byTier };
  let sum = 0;
  for (const row of imported) {
    const c = rowCredibility(row);
    byTier[c.tier] += 1;
    sum += c.score;
  }
  return { count: imported.length, mean: Math.round(sum / imported.length), byTier };
}

/** Ingest order: official exact → official proxy → specialized official → research. Never invent. */
export const SOURCE_PRIORITY = ["A", "B", "C", "D"] as const;
