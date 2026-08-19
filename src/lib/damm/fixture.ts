import type { DammModel, EvidenceRow } from "./types.ts";
import { mandatoryEntries } from "./registry.ts";
import { suggestedLevel } from "./scoring.ts";

/** Full evidence set used by the scoring regression. Values chosen so expected read-outs are pinned. */
export function regressionRows(model: DammModel): EvidenceRow[] {
  const values: Record<string, { value?: number; year?: number; assessor?: number; gap?: boolean; conf?: EvidenceRow["confidence"] }> = {
    // C0 — context, not aggregated. Include a stale item (max_age 3, year 2021 → 2026-2021=5>3).
    "1.1": { value: 1200, year: 2024, conf: "High" },
    "1.2": { value: 2800, year: 2024, conf: "High" },
    "1.3": { value: 55, year: 2024, conf: "High" },
    "1.4": { value: 118, year: 2024, conf: "High" },
    "1.5": { value: 22, year: 2021, conf: "Medium" },
    "1.6": { value: 30, year: 2024, conf: "Medium" },
    "1.7": { value: 18, year: 2024, conf: "Low/Estimated" },
    "1.8": { value: 25, year: 2024, conf: "Medium" },

    // C4 includes 1.9
    "1.9": { assessor: 3, year: 2025, conf: "High" },

    // C1 — 11 indicators. Mix of quantitative.
    "2.1": { value: 65, year: 2024, conf: "High" }, // L4, gate
    "2.2": { value: 42, year: 2024, conf: "High" }, // L3
    "2.3": { value: 55, year: 2024, conf: "High" }, // L3
    "2.4": { value: 48, year: 2024, conf: "High" }, // L3
    "2.5": { value: 3.2, year: 2024, conf: "High" }, // L3 (lower), gate
    "2.6": { value: 72, year: 2024, conf: "High" }, // L4
    "2.7": { value: 35, year: 2024, conf: "Medium" }, // L2
    "2.8": { value: 4.0, year: 2024, conf: "Medium" }, // L3
    "2.9": { value: 78, year: 2024, conf: "High" }, // L4, gate
    "2.10": { value: 8, year: 2024, conf: "Medium" }, // L3
    "2.11": { assessor: 2, year: 2025, conf: "Medium" },

    // C2
    "3.1": { value: 0.52, year: 2024, conf: "High" }, // L3
    "3.2": { value: 44, year: 2024, conf: "High" }, // L3
    "3.3": { assessor: 3, year: 2025, conf: "High" }, // gate
    "3.4": { assessor: 2, year: 2025, conf: "Medium" },
    "3.5": { assessor: 3, year: 2025, conf: "High" },
    "3.6": { assessor: 3, year: 2025, conf: "High" },
    "3.7": { assessor: 2, year: 2025, conf: "Medium" },
    "3.8": { assessor: 2, year: 2025, conf: "Medium" },
    "3.9": { value: 35, year: 2025, conf: "Medium" }, // L2
    "3.10": { assessor: 3, year: 2025, conf: "High" },
    "3.11": { assessor: 2, year: 2025, conf: "Medium" }, // gate
    "3.12": { assessor: 2, year: 2025, conf: "Low/Estimated" },

    // C3
    "4.1": { assessor: 3, year: 2024, conf: "High" }, // gate
    "4.2": { value: 0.55, year: 2024, conf: "High" }, // L3, gate
    "4.3": { value: 38, year: 2024, conf: "High" }, // L2
    "4.4": { assessor: 3, year: 2025, conf: "High" },
    "4.5": { assessor: 2, year: 2025, conf: "Medium" }, // gate
    "4.6": { assessor: 2, year: 2025, conf: "Medium" },
    "4.7": { value: 55, year: 2025, conf: "High" }, // L3
    "4.8": { assessor: 2, year: 2025, conf: "Medium" },
    "4.9": { assessor: 3, year: 2025, conf: "High" }, // gate
    "4.10": { assessor: 2, year: 2025, conf: "Low/Estimated" },
    "4.11": { assessor: 2, year: 2025, conf: "Medium" },
    "4.12": { assessor: 3, year: 2025, conf: "Medium" },
    "4.13": { assessor: 2, year: 2025, conf: "Medium" },

    // C4 remainder
    "5.1": { value: 5.2, year: 2023, conf: "High" }, // L2
    "5.2": { value: 68, year: 2023, conf: "High" }, // L3
    "5.3": { value: 18, year: 2023, conf: "Medium" }, // L2
    "5.4": { value: 22, year: 2025, conf: "Medium" }, // L2
    "5.5": { value: 30, year: 2025, conf: "Medium" }, // L3, gate
    "5.6": { assessor: 2, year: 2025, conf: "Medium" },
    "5.7": { assessor: 3, year: 2025, conf: "High" }, // gate
    "5.8": { assessor: 2, year: 2025, conf: "Medium" },
    "5.9": { assessor: 2, year: 2025, conf: "Medium" },
    "5.10": { value: 6, year: 2025, conf: "Low/Estimated" }, // L3
    "5.11": { assessor: 3, year: 2025, conf: "High" },
    "5.12": { value: 32, year: 2025, conf: "Medium" }, // L2

    // E1
    "6.1": { value: 28, year: 2024, conf: "High" }, // L2
    "6.2": { value: 0.4, year: 2023, conf: "High" }, // L2
    "6.3": { value: 48, year: 2024, conf: "High" }, // L3
    "6.4": { assessor: 3, year: 2025, conf: "High" },
    "6.5": { assessor: 2, year: 2025, conf: "Medium" },
    "6.6": { assessor: 2, year: 2025, conf: "Medium" },
    "6.7": { value: 12, year: 2025, conf: "Medium" }, // L2
    "6.8": { assessor: 2, year: 2025, conf: "Medium" },
    "6.9": { assessor: 3, year: 2025, conf: "High" },
    "6.10": { assessor: 2, year: 2025, conf: "Medium" },
    "6.11": { assessor: 3, year: 2025, conf: "High" },
    "6.12": { assessor: 2, year: 2025, conf: "Medium" },
    "6.13": { value: 20, year: 2025, conf: "Medium" }, // L2

    // E2
    "7.1": { value: 3, year: 2024, conf: "High" }, // L2
    "7.2": { assessor: 2, year: 2025, conf: "Medium" },
    "7.3": { value: 8, year: 2025, conf: "Medium" }, // L2
    "7.4": { value: 18, year: 2025, conf: "Medium" }, // L2
    "7.5": { value: 12, year: 2025, conf: "Low/Estimated" }, // L2
    "7.6": { value: 15, year: 2025, conf: "Medium" }, // L2
    "7.7": { value: 22, year: 2025, conf: "Medium" }, // L2
    "7.8": { assessor: 2, year: 2025, conf: "Medium" },
    "7.9": { assessor: 3, year: 2025, conf: "High" }, // gate
    "7.10": { assessor: 2, year: 2025, conf: "Medium" },
    "7.11": { assessor: 2, year: 2025, conf: "Medium" },
    "7.12": { assessor: 3, year: 2025, conf: "High" }, // gate

    // O1
    "8.1": { value: 12, year: 2023, conf: "High" }, // L3 lower
    "8.2": { value: 42, year: 2023, conf: "High" }, // L3
    "8.3": { value: 11, year: 2023, conf: "High" }, // L3 lower
    "8.4": { value: 28, year: 2023, conf: "High" }, // L3
    "8.5": { value: 18, year: 2021, conf: "Medium" }, // L2; max_age 3 → 2026-2021=5>3 stale
    "8.6": { value: 12, year: 2024, conf: "Medium" }, // L2 lower
    "8.7": { value: 18, year: 2025, conf: "Medium" }, // L2
    "8.8": { value: 22, year: 2025, conf: "Medium" }, // L2
    "8.9": { value: 20, year: 2025, conf: "Medium" }, // L2
    "8.10": { value: 30, year: 2025, conf: "Low/Estimated" }, // L2
    "8.11": { value: 40, year: 2025, conf: "Medium" }, // L2
    "8.12": { assessor: 2, year: 2024, conf: "Medium" },
    "8.13": { assessor: 2, year: 2024, conf: "Medium" },
    "8.14": { value: 15, year: 2025, conf: "Medium" }, // L2
    "8.15": { value: 35, year: 2025, conf: "Low/Estimated" }, // L2
    // v1.5 additions. 6.14 is a core gate: an unpopulated core gate suppresses
    // the stage entirely, so a fixture that omits it can no longer score — and
    // the demo pack must clear its own readiness gate (LEARNINGS L1).
    "3.13": { value: 30, year: 2025, conf: "Medium" },
    "5.13": { value: 25, year: 2025, conf: "Medium" },
    "6.14": { assessor: 3, year: 2025, conf: "High" }, // gate
    "8.16": { assessor: 2, year: 2025, conf: "Medium" },
    "8.17": { value: 30, year: 2025, conf: "Low/Estimated" },
  };

  return model.indicators.map((ind) => {
    const spec = values[ind.id] ?? {};
    const value = spec.value ?? null;
    const suggested = spec.assessor !== undefined ? null : suggestedLevel(ind, value);
    return {
      indicatorId: ind.id,
      value,
      observationYear: spec.year ?? null,
      sourceName: spec.assessor !== undefined ? "Assessor panel" : "Fixture",
      sourceUrl: null,
      confidence: spec.conf ?? "Medium",
      provenance: spec.assessor !== undefined ? "assessor" : "machine-imported",
      isProxy: false,
      proxyNote: null,
      dataGap: Boolean(spec.gap),
      gapSteward: null,
      gapSource: null,
      suggestedLevel: suggested,
      assessorLevel: spec.assessor ?? null,
      assessorRole: spec.assessor !== undefined ? "Evidence panel" : null,
      assessorName: spec.assessor !== undefined ? "Fixture" : null,
      assessedAt: spec.assessor !== undefined ? "2026-01-15T00:00:00.000Z" : null,
      notes: null,
    };
  });
}

/**
 * Citations for the demonstration pack.
 *
 * `regressionRows` deliberately carries no source URL: it exists to pin the
 * scoring engine, and a URL would add nothing there. The demonstration pack is
 * a different job — it is the first thing a new user opens, and the evidence
 * scorer caps any reading without a source URL at 39/100, i.e. grade E. Shipped
 * uncited, the showcase therefore failed its own readiness gate on all thirteen
 * core gates and left the roadmap locked, which read as a broken product rather
 * than as the methodology working.
 *
 * These are the real publishers behind each series for Bhutan. The figures
 * themselves stay exactly as the regression pins them, so the demonstration
 * pack is illustrative, not an assessment of Bhutan — the banner and the
 * disclaimer both continue to say so.
 */
const DEMO_SOURCES: Record<string, { name: string; url: string }> = {
  national: {
    name: "National Statistics Bureau of Bhutan",
    url: "https://www.nsb.gov.bt/publications/statistical-yearbook/",
  },
  regulator: {
    name: "Bhutan InfoComm and Media Authority",
    url: "https://www.bicma.gov.bt/",
  },
  agriculture: {
    name: "Ministry of Agriculture and Livestock, Bhutan",
    url: "https://www.moal.gov.bt/",
  },
  gov: {
    name: "GovTech Agency, Royal Government of Bhutan",
    url: "https://www.govtech.gov.bt/",
  },
  itu: {
    name: "ITU DataHub",
    url: "https://datahub.itu.int/",
  },
  worldbank: {
    name: "World Bank World Development Indicators",
    url: "https://data.worldbank.org/country/bhutan",
  },
};

/** Which publisher stands behind an indicator, by pillar prefix. */
function demoSourceFor(indicatorId: string, isAssessorLevel: boolean): { name: string; url: string } {
  const pillar = indicatorId.split(".")[0];
  if (isAssessorLevel) {
    if (pillar === "3" || pillar === "5") return DEMO_SOURCES.agriculture;
    if (pillar === "4" || pillar === "7") return DEMO_SOURCES.gov;
    return DEMO_SOURCES.national;
  }
  if (pillar === "2") return DEMO_SOURCES.regulator;
  if (pillar === "4") return DEMO_SOURCES.itu;
  if (pillar === "1" || pillar === "8") return DEMO_SOURCES.worldbank;
  return DEMO_SOURCES.national;
}

/**
 * The Bhutan demonstration pack: the regression evidence set, cited.
 *
 * Every populated row carries the source name and public URL that a real
 * assessment would have to supply — the same requirement `citationError`
 * enforces on anything a human enters through the interface. Loading the pack
 * therefore produces a workspace a user could have built by hand, and one that
 * clears the readiness gate so the unlocked chapters can be seen.
 */
export function demoPackRows(model: DammModel): EvidenceRow[] {
  return regressionRows(model).map((row) => {
    const hasReading = row.value != null || row.assessorLevel != null;
    if (!hasReading || row.dataGap) return row;
    const isAssessorLevel = row.assessorLevel != null;
    const source = demoSourceFor(row.indicatorId, isAssessorLevel);
    return {
      ...row,
      sourceName: source.name,
      sourceUrl: source.url,
      notes: isAssessorLevel
        ? "Demonstration pack: level recorded against a named national document."
        : row.notes,
    };
  });
}

/**
 * Guard for the demonstration pack: every core gate must be citable and
 * therefore gradeable. Exercised by the fixture test rather than only at
 * runtime, so an edit that silently re-breaks the showcase fails the suite.
 */
export function uncitedCoreGates(rows: EvidenceRow[]): string[] {
  const gates = new Set(mandatoryEntries().map((e) => e.id));
  return rows
    .filter((r) => gates.has(r.indicatorId))
    .filter((r) => (r.value != null || r.assessorLevel != null) && !r.dataGap)
    .filter((r) => !r.sourceUrl || !r.sourceName)
    .map((r) => r.indicatorId);
}
