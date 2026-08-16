import { isGovernmentHost } from "./nso.ts";
import { registryEntry, type SourceClass } from "./registry.ts";

export type EvidenceGrade = "A" | "B" | "C" | "D" | "E";

export interface EvidenceScoreInput {
  indicatorId: string;
  value?: number | null;
  observationYear?: number | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  isProxy?: boolean;
  provenance?: string | null;
  dataGap?: boolean;
  assessorLevel?: number | null;
}

export interface EvidenceScore {
  total: number;
  grade: EvidenceGrade;
  label: string;
  note: string;
  sourceClass: SourceClass;
  fit: "direct" | "proxy" | "missing";
  parts: {
    authority: number;
    definition: number;
    recency: number;
    disaggregation: number;
  };
  caps: string[];
}

const OFFICIAL_INTL = [
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
];

const SPECIALIZED_HOST = ["oxfordinsights.com", "opendatawatch.com"];
const SPECIALIZED_NAME = ["egdi", "gci", "odin", "gii", "b-ready", "bready", "id4d", "findex", "government ai readiness"];
const DONOR_NAME = ["usaid", "fcdo", "afd", "giz", "jica", "ifad", "cgiar", "agra", "mastercard foundation"];
const RESEARCH_HOST = ["ourworldindata.org", "openalex.org"];
const RESEARCH_NAME = ["our world in data", "owid", "barro-lee", "wittgenstein", "openalex", "scopus", "peer-reviewed"];
const PRIVATE_HOST = ["gsma.com", "ookla.com", "speedtest.net"];
const PRIVATE_NAME = ["gsma", "ookla", "speedtest"];

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function classifySource(sourceName?: string | null, sourceUrl?: string | null): SourceClass {
  const name = (sourceName ?? "").toLowerCase();
  const host = hostOf(sourceUrl);
  if (host && isGovernmentHost(host)) return "national";
  if (/\b(nso|capmas|national statistical|ministry of|regulator|official gazette)\b/.test(name) && !OFFICIAL_INTL.some((h) => host.endsWith(h))) {
    return "national";
  }
  if (OFFICIAL_INTL.some((h) => host === h || host.endsWith(`.${h}`)) || /\b(world bank|wdi|itu datahub|unesco|fao|ilo)\b/.test(name)) {
    return "international";
  }
  if (SPECIALIZED_HOST.some((h) => host.endsWith(h)) || SPECIALIZED_NAME.some((s) => name.includes(s))) return "specialized";
  if (DONOR_NAME.some((s) => name.includes(s))) return "donor";
  if (PRIVATE_HOST.some((h) => host.endsWith(h)) || PRIVATE_NAME.some((s) => name.includes(s))) return "private";
  if (RESEARCH_HOST.some((h) => host.endsWith(h)) || RESEARCH_NAME.some((s) => name.includes(s))) return "research";
  if (!host && !name) return "other";
  return "other";
}

const AUTHORITY: Record<SourceClass, number> = {
  national: 40,
  international: 36,
  specialized: 30,
  donor: 22,
  research: 16,
  private: 12,
  other: 0,
};

export function gradeFromScore(total: number): EvidenceGrade {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  if (total >= 40) return "D";
  return "E";
}

const GRADE_LABEL: Record<EvidenceGrade, string> = {
  A: "A — National or official exact series, current, matching definition",
  B: "B — Official series with a documented proxy or minor cut gap",
  C: "C — Specialized official index or older official series",
  D: "D — Donor, research or industry dataset",
  E: "E — Missing, unofficial, or cannot be used to score",
};

export function scoreEvidence(input: EvidenceScoreInput): EvidenceScore {
  const caps: string[] = [];
  const entry = registryEntry(input.indicatorId);
  const missing =
    input.provenance === "named-gap" ||
    Boolean(input.dataGap) ||
    (input.value == null && input.assessorLevel == null);

  if (missing && input.provenance === "named-gap") {
    return {
      total: 0,
      grade: "E",
      label: GRADE_LABEL.E,
      note: "Named gap — no verified reading. Routed to a steward, not scored.",
      sourceClass: "other",
      fit: "missing",
      parts: { authority: 0, definition: 0, recency: 0, disaggregation: 0 },
      caps: ["named-gap"],
    };
  }
  if (missing && input.dataGap) {
    return {
      total: 0,
      grade: "E",
      label: GRADE_LABEL.E,
      note: "Human-marked data gap. Counted as accounted, not as a reading.",
      sourceClass: "other",
      fit: "missing",
      parts: { authority: 0, definition: 0, recency: 0, disaggregation: 0 },
      caps: ["human-data-gap"],
    };
  }
  if (missing) {
    return {
      total: 0,
      grade: "E",
      label: GRADE_LABEL.E,
      note: "No value and no assessor level.",
      sourceClass: "other",
      fit: "missing",
      parts: { authority: 0, definition: 0, recency: 0, disaggregation: 0 },
      caps: ["empty"],
    };
  }

  const sourceClass = classifySource(input.sourceName, input.sourceUrl);
  const authority = AUTHORITY[sourceClass];
  const isProxy = Boolean(input.isProxy);
  const required = entry?.disaggregation ?? "national";
  const wantsCut = required === "rural" || required === "agricultural" || required === "rural-agricultural" || required === "sex";

  let definition = 25;
  let fit: EvidenceScore["fit"] = "direct";
  if (isProxy) {
    definition = 12;
    fit = "proxy";
  }

  const year = input.observationYear;
  const maxAge = entry?.maxAge ?? 3;
  const assessmentYear = entry?.preferredYearTo ?? 2026;
  let recency = 20;
  if (year == null) {
    recency = 10;
    caps.push("year-unknown");
  } else {
    const age = assessmentYear - year;
    if (age <= maxAge) recency = 20;
    else if (age <= maxAge + 1) recency = 10;
    else recency = 0;
  }

  let disaggregation = 15;
  if (wantsCut && isProxy) disaggregation = 5;
  else if (wantsCut && sourceClass === "international") {
    const name = `${input.sourceName ?? ""} ${input.sourceUrl ?? ""}`.toLowerCase();
    const hasCut =
      name.includes("rural") ||
      name.includes(".ru.") ||
      name.includes("agricult") ||
      name.includes("female") ||
      name.includes("women");
    if (!hasCut) {
      disaggregation = 5;
      caps.push(`national-series-for-${required}-indicator`);
    }
  }

  let total = authority + definition + recency + disaggregation;
  if (total > 100) total = 100;

  if (!input.sourceUrl) {
    total = Math.min(total, 39);
    caps.push("no-url");
  }
  if (sourceClass === "other" && !input.sourceUrl) {
    total = Math.min(total, 39);
  }
  if (isProxy && total >= 85) {
    total = 84;
    caps.push("proxy-cannot-be-A");
  }
  if (total > 39 && (caps.includes("no-url") || sourceClass === "other") && !input.sourceUrl) {
    total = 39;
  }

  const grade = gradeFromScore(total);
  const noteParts = [
    `Authority ${authority}/40 (${sourceClass}).`,
    `Definition ${definition}/25 (${fit}).`,
    `Recency ${recency}/20.`,
    `Disaggregation ${disaggregation}/15 (${required}).`,
  ];
  if (caps.length) noteParts.push(`Caps: ${caps.join(", ")}.`);

  return {
    total,
    grade,
    label: GRADE_LABEL[grade],
    note: noteParts.join(" "),
    sourceClass,
    fit,
    parts: { authority, definition, recency, disaggregation },
    caps,
  };
}
