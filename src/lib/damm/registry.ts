import { model } from "./model.ts";
import type { IndicatorDef, PillarId } from "./types.ts";

export type Disaggregation = "national" | "rural" | "agricultural" | "sex" | "rural-agricultural";
export type SpecialistDesk =
  | "connectivity"
  | "dpi"
  | "legal"
  | "capacity"
  | "responsible-ai"
  | "context"
  | "ecosystem"
  | "outcomes";
export type RegistryKind = "quantitative" | "rubric";

export interface IndicatorRegistryEntry {
  id: string;
  name: string;
  pillar: PillarId;
  definition: string;
  disaggregation: Disaggregation;
  preferredYearFrom: number;
  preferredYearTo: number;
  maxAge: number;
  proxies: string[];
  nationalFirst: string;
  internationalFallback: string;
  steward: string;
  mandatory: boolean;
  kind: RegistryKind;
  specialist: SpecialistDesk;
}

interface Overlay {
  definition: string;
  disaggregation?: Disaggregation;
  proxies?: string[];
  nationalFirst?: string;
  internationalFallback?: string;
  steward?: string;
}

const YEAR = model.assessment_year;

const OVERLAY: Record<string, Overlay> = {
  "2.1": {
    definition: "Share of the rural population living in an area with at least 3G mobile coverage.",
    disaggregation: "rural",
    proxies: ["National 3G population coverage (ITU) — label as proxy; replace with a rural cut when the regulator publishes one."],
    nationalFirst: "National telecom regulator coverage maps / NTRA, MCIT or equivalent statistical yearbook",
    internationalFallback: "ITU DataHub MOB_COV_3G via World Bank Data360 (national, proxy)",
    steward: "Telecom regulator / ITU",
  },
  "2.5": {
    definition: "Price of a mobile-broadband basket as a percentage of GNI per capita. Lower is better.",
    disaggregation: "national",
    proxies: ["ITU data-only mobile broadband basket; World Bank ICT price basket"],
    nationalFirst: "National regulator published tariff basket / NSO ICT prices",
    internationalFallback: "ITU ICT price basket via World Bank Data360",
    steward: "Telecom regulator / ITU",
  },
  "2.9": {
    definition: "Share of the rural population with access to electricity.",
    disaggregation: "rural",
    proxies: ["National electricity access if no rural series exists — proxy only"],
    nationalFirst: "National statistical office / energy ministry rural access table",
    internationalFallback: "World Bank WDI EG.ELC.ACCS.RU.ZS",
    steward: "Statistics office / energy ministry",
  },
  "3.3": {
    definition: "Existence and operational use of a national farmer registry or equivalent producer database.",
    disaggregation: "agricultural",
    proxies: [],
    nationalFirst: "Ministry of agriculture farmer-registry decree, coverage report or census frame",
    internationalFallback: "No international substitute. Documentary lead only.",
    steward: "Ministry of Agriculture",
  },
  "3.11": {
    definition: "Published interoperability standards or a data-exchange framework for agricultural data.",
    disaggregation: "agricultural",
    proxies: [],
    nationalFirst: "Agriculture ministry / digital authority interoperability notice or API standard",
    internationalFallback: "No scored international substitute. Documentary lead only.",
    steward: "Digital authority / Ministry of Agriculture",
  },
  "4.1": {
    definition: "A data-protection or privacy law that is in force and applies to personal data, including farmer data.",
    disaggregation: "national",
    proxies: ["UNCTAD / UN data-protection law tracker as a presence check, not a quality score"],
    nationalFirst: "Official gazette / data-protection authority",
    internationalFallback: "UNCTAD data-protection law listing (presence only)",
    steward: "Data-protection authority",
  },
  "4.2": {
    definition: "Strength of the national cybersecurity legal and institutional framework, as scored by the ITU Global Cybersecurity Index.",
    disaggregation: "national",
    proxies: ["National cybersecurity strategy presence is not a substitute for the GCI score"],
    nationalFirst: "National cybersecurity agency published GCI self-assessment, if any",
    internationalFallback: "ITU Global Cybersecurity Index via World Bank Data360",
    steward: "Cybersecurity agency / ITU",
  },
  "4.5": {
    definition: "A documented agricultural data-governance framework (roles, access, sharing, stewardship).",
    disaggregation: "agricultural",
    proxies: [],
    nationalFirst: "Ministry of agriculture or statistics office data-governance circular",
    internationalFallback: "No scored international substitute.",
    steward: "Ministry of Agriculture / statistics office",
  },
  "4.9": {
    definition: "A standing inter-ministerial coordination mechanism whose mandate includes digital agriculture.",
    disaggregation: "agricultural",
    proxies: [],
    nationalFirst: "Cabinet decree, ToR or minutes of the digital-agriculture steering body",
    internationalFallback: "No scored international substitute.",
    steward: "Cabinet / digital authority",
  },
  "5.5": {
    definition: "Share of public extension workers who have received training in digital tools, in the last max-age window.",
    disaggregation: "agricultural",
    proxies: ["Training throughput (headcount trained) if the denominator is published"],
    nationalFirst: "Ministry of agriculture extension directorate training returns",
    internationalFallback: "No comparable global series. FAO / GFRAS notes are leads only.",
    steward: "Ministry of Agriculture extension directorate",
  },
  "5.7": {
    definition: "A dedicated digital or AI unit inside the ministry of agriculture (or a formally mandated equivalent).",
    disaggregation: "agricultural",
    proxies: [],
    nationalFirst: "Ministerial organogram, establishment circular or budget line",
    internationalFallback: "No scored international substitute.",
    steward: "Ministry of Agriculture",
  },
  "7.9": {
    definition: "Cybersecurity controls applied to agricultural digital systems (registries, advisory, markets), not only the national GCI.",
    disaggregation: "agricultural",
    proxies: ["National GCI is a related reading for 4.2, not a substitute here"],
    nationalFirst: "Agriculture-system security audit, CERT advisory or ministry CISO report",
    internationalFallback: "No scored international substitute.",
    steward: "Ministry of Agriculture CISO / national CERT",
  },
  "7.12": {
    definition: "Documented farmer consent and data-rights practice in agricultural AI or digital-advisory systems.",
    disaggregation: "agricultural",
    proxies: [],
    nationalFirst: "Consent policy, DPIA or farmer-facing terms issued by the ministry or a major public platform",
    internationalFallback: "No scored international substitute.",
    steward: "Data-protection authority / Ministry of Agriculture",
  },
};

function deskFor(pillar: PillarId): SpecialistDesk {
  if (pillar === "C1") return "connectivity";
  if (pillar === "C2") return "dpi";
  if (pillar === "C3") return "legal";
  if (pillar === "C4") return "capacity";
  if (pillar === "E2") return "responsible-ai";
  if (pillar === "C0") return "context";
  if (pillar === "E1") return "ecosystem";
  return "outcomes";
}

function guessDisagg(ind: IndicatorDef): Disaggregation {
  const n = ind.name.toLowerCase();
  if (/rural/.test(n) && /agricult|farmer/.test(n)) return "rural-agricultural";
  if (/rural/.test(n)) return "rural";
  if (/farmer|agricult|smallholder|extension/.test(n)) return "agricultural";
  if (/women|female|gender/.test(n)) return "sex";
  return "national";
}

function buildEntry(ind: IndicatorDef): IndicatorRegistryEntry {
  const over = OVERLAY[ind.id];
  const kind: RegistryKind = ind.direction !== "N/A" && Array.isArray(ind.cuts) && ind.cuts.length > 0 ? "quantitative" : "rubric";
  const disaggregation = over?.disaggregation ?? guessDisagg(ind);
  return {
    id: ind.id,
    name: ind.name,
    pillar: ind.pillar,
    definition: over?.definition ?? `${ind.name}. Method: ${ind.method}.`,
    disaggregation,
    preferredYearFrom: YEAR - ind.max_age,
    preferredYearTo: YEAR,
    maxAge: ind.max_age,
    proxies: over?.proxies ?? (kind === "quantitative" ? ["A documented national series with the same unit"] : []),
    nationalFirst: over?.nationalFirst ?? (ind.source_type === "Local" ? "National statistical office or line ministry publication" : "National statistical office series that matches the international definition"),
    internationalFallback: over?.internationalFallback ?? (kind === "quantitative" ? "World Bank / UN / ITU official statistical system" : "No international substitute — documentary lead only"),
    steward: over?.steward ?? (ind.source_type === "Local" ? "Line ministry / statistics office" : "Statistics office / international statistical system"),
    mandatory: Boolean(ind.gate),
    kind,
    specialist: deskFor(ind.pillar),
  };
}

export const REGISTRY: IndicatorRegistryEntry[] = model.indicators.map(buildEntry);

const BY_ID = new Map(REGISTRY.map((e) => [e.id, e]));

export function registryEntry(id: string): IndicatorRegistryEntry | undefined {
  return BY_ID.get(id);
}

export function mandatoryEntries(): IndicatorRegistryEntry[] {
  return REGISTRY.filter((e) => e.mandatory);
}

export const SOURCE_LADDER = [
  "national",
  "international",
  "specialized",
  "donor",
  "research",
  "private",
  "other",
] as const;

export type SourceClass = (typeof SOURCE_LADDER)[number];
