/**
 * Suggested value-chain shortlists for the Step 3 targeting decision.
 * These are hypotheses for the TTL to accept or reject — not scored evidence.
 */
export interface ChainSuggestion {
  name: string;
  why: string;
  sourceName: string;
  sourceUrl: string;
}

const GENERIC: ChainSuggestion[] = [
  {
    name: "Staple cereals",
    why: "Usually the largest smallholder footprint and the first place a digital bind shows up.",
    sourceName: "FAO statistical yearbook — crops",
    sourceUrl: "https://www.fao.org/faostat/en/#data/QCL",
  },
  {
    name: "Horticulture (fresh vegetables)",
    why: "Perishability makes market and advisory services high-leverage if demand evidence exists.",
    sourceName: "FAO statistical yearbook — crops",
    sourceUrl: "https://www.fao.org/faostat/en/#data/QCL",
  },
];

const BY_ISO3: Record<string, ChainSuggestion[]> = {
  EGY: [
    {
      name: "Wheat",
      why: "Strategic staple; Egypt is among the world’s largest wheat importers. Digital advisory and soil/irrigation data bind here first.",
      sourceName: "USDA FAS Grain and Feed Annual — Egypt",
      sourceUrl: "https://www.fas.usda.gov/data/egypt-grain-and-feed-annual",
    },
    {
      name: "Cotton",
      why: "Long-staple cotton remains a policy and export crop; ginning and traceability are digital-bind candidates.",
      sourceName: "USDA FAS Cotton and Products Annual — Egypt",
      sourceUrl: "https://www.fas.usda.gov/data/egypt-cotton-and-products-annual",
    },
    {
      name: "Citrus (oranges)",
      why: "Egypt is a leading fresh-orange exporter; cold-chain, SPS and market platforms are the digital binds.",
      sourceName: "USDA FAS Citrus Annual — Egypt",
      sourceUrl: "https://www.fas.usda.gov/data/egypt-citrus-annual",
    },
    {
      name: "Sugarcane",
      why: "Upper-Egypt irrigation-intensive crop; water-use and mill logistics are documented digital-bind candidates.",
      sourceName: "USDA FAS Sugar Annual — Egypt",
      sourceUrl: "https://www.fas.usda.gov/data/egypt-sugar-annual",
    },
    {
      name: "Tomatoes / fresh vegetables",
      why: "High post-harvest loss and rapid price swings; market-information and advisory platforms are the usual bind.",
      sourceName: "FAO FAOSTAT crop production",
      sourceUrl: "https://www.fao.org/faostat/en/#data/QCL",
    },
    {
      name: "Dates",
      why: "Growing export crop in the New Lands; quality grading and traceability are the digital binds.",
      sourceName: "FAO FAOSTAT crop production",
      sourceUrl: "https://www.fao.org/faostat/en/#data/QCL",
    },
    {
      name: "Rice (Nile Delta)",
      why: "Water-policy sensitive Delta staple; irrigation scheduling and input advisory are the usual binds.",
      sourceName: "USDA FAS Grain and Feed Annual — Egypt",
      sourceUrl: "https://www.fas.usda.gov/data/egypt-grain-and-feed-annual",
    },
  ],
};

export function chainSuggestions(iso3: string): ChainSuggestion[] {
  return BY_ISO3[iso3.toUpperCase()] ?? GENERIC;
}
