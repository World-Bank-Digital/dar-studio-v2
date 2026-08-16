export type SourceKind = "worldbank" | "derived" | "data360" | "owid" | "named-gap";
export type SourceScale = "as-is" | "index100-to-01";

export interface SourceSpec {
  indicatorId: string;
  kind: SourceKind;
  series?: string;
  seriesB?: string;
  derive?: "subtract";
  databaseId?: string;
  data360Indicator?: string;
  data360Sex?: string;
  data360Age?: string;
  data360Unit?: string;
  owidSlug?: string;
  scale?: SourceScale;
  sourceName: string;
  sourceUrl?: string;
  steward: string;
  isProxy?: boolean;
  proxyNote?: string;
  gapNote?: string;
  fallbacks?: Omit<SourceSpec, "indicatorId" | "fallbacks">[];
}

/**
 * DAMM → public series, ordered by publisher credibility.
 * Official statistical systems first; specialized official indices next;
 * research/industry last. A named gap is a routing instruction, not a score.
 */
export const SOURCE_MAP: SourceSpec[] = [
  { indicatorId: "1.1", kind: "worldbank", series: "NV.AGR.EMPL.KD", sourceName: "World Bank WDI", sourceUrl: "https://data.worldbank.org/indicator/NV.AGR.EMPL.KD", steward: "Statistics office" },
  { indicatorId: "1.2", kind: "worldbank", series: "AG.YLD.CREL.KG", sourceName: "World Bank WDI", sourceUrl: "https://data.worldbank.org/indicator/AG.YLD.CREL.KG", steward: "Statistics office" },
  { indicatorId: "1.3", kind: "worldbank", series: "SL.AGR.EMPL.ZS", sourceName: "World Bank WDI / ILO", sourceUrl: "https://data.worldbank.org/indicator/SL.AGR.EMPL.ZS", steward: "Statistics office" },
  { indicatorId: "1.4", kind: "worldbank", series: "AG.PRD.FOOD.XD", sourceName: "World Bank WDI / FAO", sourceUrl: "https://data.worldbank.org/indicator/AG.PRD.FOOD.XD", steward: "Statistics office" },
  { indicatorId: "1.5", kind: "named-gap", sourceName: "National post-harvest assessment", steward: "Ministry of Agriculture", gapNote: "No comparable global series. Route to the agriculture ministry / FAO FLW contact." },
  { indicatorId: "1.6", kind: "named-gap", sourceName: "Agricultural census / LSMS-ISA", steward: "Statistics office", gapNote: "Smallholder market access is a local survey item." },
  { indicatorId: "1.7", kind: "named-gap", sourceName: "Agricultural finance survey", steward: "Ministry of Agriculture / Central bank", gapNote: "Share of farmers with formal credit. Local survey or central-bank microdata." },
  { indicatorId: "1.8", kind: "named-gap", sourceName: "CSA practice survey", steward: "Ministry of Agriculture", gapNote: "Climate-smart practice adoption is a local survey item." },
  { indicatorId: "1.9", kind: "named-gap", sourceName: "Programme documentation", steward: "Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring against documentary evidence." },

  {
    indicatorId: "2.1",
    kind: "data360",
    databaseId: "ITU_DH",
    data360Indicator: "MOB_COV_3G",
    data360Unit: "PT_POP",
    sourceName: "ITU DataHub — population covered by at least 3G (national, via World Bank Data360)",
    sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
    steward: "ITU / digital authority",
    isProxy: true,
    proxyNote: "Proxy: national 3G population coverage. DAMM asks for rural coverage. Replace with a rural-filtered ITU/GSMA reading when the regulator publishes one.",
  },
  {
    indicatorId: "2.2",
    kind: "data360",
    databaseId: "ITU_DH",
    data360Indicator: "MOB_COV_4G",
    data360Unit: "PT_POP",
    sourceName: "ITU DataHub — population covered by at least 4G (national, via World Bank Data360)",
    sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
    steward: "ITU / digital authority",
    isProxy: true,
    proxyNote: "Proxy: national 4G population coverage. DAMM asks for rural coverage. Replace with a rural-filtered ITU/GSMA reading when the regulator publishes one.",
  },
  {
    indicatorId: "2.3",
    kind: "data360",
    databaseId: "ITU_DH",
    data360Indicator: "ACT_MOB_SB",
    data360Unit: "SB_10P2_HB",
    sourceName: "ITU DataHub — active mobile-broadband subscriptions per 100 inhabitants (via World Bank Data360)",
    sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
    steward: "ITU",
    fallbacks: [
      {
        kind: "worldbank",
        series: "IT.CEL.SETS.P2",
        sourceName: "World Bank WDI (mobile cellular subscriptions)",
        sourceUrl: "https://data.worldbank.org/indicator/IT.CEL.SETS.P2",
        steward: "ITU",
        isProxy: true,
        proxyNote: "Proxy: mobile cellular subscriptions per 100, not active mobile broadband. Used only if the ITU DataHub series is empty.",
      },
    ],
  },
  { indicatorId: "2.4", kind: "worldbank", series: "IT.NET.USER.ZS", sourceName: "World Bank WDI / ITU", sourceUrl: "https://data.worldbank.org/indicator/IT.NET.USER.ZS", steward: "ITU / statistics office" },
  {
    indicatorId: "2.5",
    kind: "data360",
    databaseId: "ITU_DH",
    data360Indicator: "PRI_DO_MOB",
    data360Unit: "PT_GNI_PS",
    sourceName: "ITU ICT Price Basket — data-only mobile-broadband (% of GNI per capita, via World Bank Data360)",
    sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_DH",
    steward: "ITU",
  },
  { indicatorId: "2.6", kind: "named-gap", sourceName: "Global Findex / GSMA", sourceUrl: "https://www.worldbank.org/en/publication/globalfindex", steward: "Global Findex", gapNote: "Adults with a mobile phone. Findex Digital Connectivity Tracker or GSMA Intelligence — no stable public series code yet." },
  { indicatorId: "2.7", kind: "named-gap", sourceName: "Rural household / farmer survey", steward: "Statistics office", gapNote: "Smartphone ownership among the rural/agricultural population is local." },
  { indicatorId: "2.8", kind: "named-gap", sourceName: "Rural tariff survey", steward: "Regulator / GSMA", gapNote: "USD per GB in rural areas. Regulator or GSMA pricing." },
  { indicatorId: "2.9", kind: "worldbank", series: "EG.ELC.ACCS.RU.ZS", sourceName: "World Bank WDI", sourceUrl: "https://data.worldbank.org/indicator/EG.ELC.ACCS.RU.ZS", steward: "Statistics office / energy ministry" },
  { indicatorId: "2.10", kind: "named-gap", sourceName: "Ookla / national QoS", steward: "Regulator", gapNote: "Average download speed in agricultural areas. National QoS or crowd-sourced speed tests, rural filter." },
  { indicatorId: "2.11", kind: "named-gap", sourceName: "Device-financing programme files", steward: "Ministry of Agriculture / digital authority", gapNote: "Anchored rubric — panel scoring." },

  {
    indicatorId: "3.1",
    kind: "data360",
    databaseId: "UN_EGDI",
    data360Indicator: "UN_EGDI_EGDI",
    sourceName: "UN DESA E-Government Development Index (via World Bank Data360)",
    sourceUrl: "https://data360.worldbank.org/en/dataset/UN_EGDI",
    steward: "UN DESA EGDI",
  },
  { indicatorId: "3.2", kind: "named-gap", sourceName: "Open Data Watch ODIN", sourceUrl: "https://odin.opendatawatch.com/", steward: "Open Data Watch ODIN", gapNote: "ODIN score is published by Open Data Watch. No stable public API series yet." },
  { indicatorId: "3.3", kind: "named-gap", sourceName: "Farmer registry documentation", steward: "Ministry of Agriculture", gapNote: "Core gate. Anchored rubric — panel scoring." },
  { indicatorId: "3.4", kind: "named-gap", sourceName: "Land administration system", steward: "Lands ministry", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "3.5", kind: "named-gap", sourceName: "National agricultural data portal", steward: "Ministry of Agriculture / statistics office", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "3.6", kind: "named-gap", sourceName: "Hydromet / agriculture MoU and advisory logs", steward: "Met service / Ministry of Agriculture", gapNote: "Anchored rubric — climate-services chain." },
  { indicatorId: "3.7", kind: "named-gap", sourceName: "EO programme files", steward: "Space / agriculture agency", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "3.8", kind: "named-gap", sourceName: "National soil information system", steward: "Ministry of Agriculture / soil institute", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "3.9", kind: "named-gap", sourceName: "Advisory platform user statistics", steward: "Ministry of Agriculture / private-sector panel", gapNote: "Share of platforms / reach metric as defined in the workbook." },
  { indicatorId: "3.10", kind: "named-gap", sourceName: "Market-platform documentation", steward: "Ministry of Agriculture / private-sector panel", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "3.11", kind: "named-gap", sourceName: "Interoperability standard / gazette", steward: "Digital authority / Ministry of Agriculture", gapNote: "Core gate. Anchored rubric — panel scoring." },
  { indicatorId: "3.12", kind: "named-gap", sourceName: "Dataset catalogue", steward: "Digital authority", gapNote: "Anchored rubric — panel scoring." },

  { indicatorId: "4.1", kind: "named-gap", sourceName: "National gazette / UNCTAD data-protection tracker", sourceUrl: "https://unctad.org/page/data-protection-and-privacy-legislation-worldwide", steward: "Digital authority / justice ministry", gapNote: "Core gate. Anchored rubric on the law and its operation, not a binary exists/not." },
  {
    indicatorId: "4.2",
    kind: "data360",
    databaseId: "ITU_GCI",
    data360Indicator: "ITU_GCI_GCI_OVRL_SCRE",
    scale: "index100-to-01",
    sourceName: "ITU Global Cybersecurity Index overall score (via World Bank Data360)",
    sourceUrl: "https://data360.worldbank.org/en/dataset/ITU_GCI",
    steward: "ITU",
  },
  { indicatorId: "4.3", kind: "named-gap", sourceName: "Oxford Insights Government AI Readiness Index", sourceUrl: "https://oxfordinsights.com/ai-readiness/ai-readiness-index/", steward: "Oxford Insights", gapNote: "Government AI Readiness Index. No stable public API series." },
  { indicatorId: "4.4", kind: "named-gap", sourceName: "National digital agriculture strategy", steward: "Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "4.5", kind: "named-gap", sourceName: "Agricultural data-governance instrument", steward: "Digital authority / Ministry of Agriculture", gapNote: "Core gate. Anchored rubric — panel scoring." },
  { indicatorId: "4.6", kind: "named-gap", sourceName: "National AI strategy", steward: "Digital authority", gapNote: "Anchored rubric — panel scoring." },
  {
    indicatorId: "4.7",
    kind: "data360",
    databaseId: "WB_ID4D",
    data360Indicator: "E_ID",
    sourceName: "World Bank ID4D — digital ID (e-ID) coverage",
    sourceUrl: "https://id4d.worldbank.org/global-dataset",
    steward: "ID4D / national ID authority",
    fallbacks: [
      {
        kind: "named-gap",
        sourceName: "ID4D / national ID authority",
        sourceUrl: "https://id4d.worldbank.org/global-dataset",
        steward: "ID4D / national ID authority",
        gapNote: "E-ID coverage is the DAMM series. Foundational ID ownership is not a substitute.",
      },
    ],
  },
  { indicatorId: "4.8", kind: "named-gap", sourceName: "Data-sovereignty provisions", steward: "Digital authority / justice ministry", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "4.9", kind: "named-gap", sourceName: "Inter-ministerial ToR / minutes", steward: "Ministry of Agriculture / digital authority", gapNote: "Core gate. Anchored rubric — panel scoring." },
  { indicatorId: "4.10", kind: "named-gap", sourceName: "Competition authority files", steward: "Competition authority", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "4.11", kind: "named-gap", sourceName: "Public-procurement rules", steward: "Procurement authority", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "4.12", kind: "named-gap", sourceName: "Spectrum plan", steward: "Regulator", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "4.13", kind: "named-gap", sourceName: "Responsible-AI guidance", steward: "Digital authority / Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring." },

  { indicatorId: "5.1", kind: "worldbank", series: "BAR.SCHL.15UP", sourceName: "World Bank Education Statistics — Barro-Lee average years of schooling (age 15+)", sourceUrl: "https://data.worldbank.org/indicator/BAR.SCHL.15UP", steward: "UNDP / statistics office", isProxy: true, proxyNote: "Proxy: Barro-Lee average years of total schooling, age 15+. Authoritative replacement is UNDP HDR mean years of schooling (adults 25+).", fallbacks: [{ kind: "owid", owidSlug: "mean-years-of-schooling", sourceName: "Our World in Data — mean years of schooling (Wittgenstein Centre / Barro-Lee long-run)", sourceUrl: "https://ourworldindata.org/grapher/mean-years-of-schooling", steward: "UNDP / statistics office", isProxy: true, proxyNote: "Fallback compilation. Used only if the World Bank Education Statistics series is empty." }] },
  { indicatorId: "5.2", kind: "worldbank", series: "SE.ADT.LITR.ZS", sourceName: "World Bank WDI / UNESCO UIS", sourceUrl: "https://data.worldbank.org/indicator/SE.ADT.LITR.ZS", steward: "Statistics office / UNESCO" },
  { indicatorId: "5.3", kind: "data360", databaseId: "UNESCO_UIS", data360Indicator: "UNESCO_UIS_GRAD_STEM", data360Unit: "PT_GRDTS", sourceName: "UNESCO UIS — STEM share of tertiary graduates (via World Bank Data360)", sourceUrl: "https://data360.worldbank.org/en/dataset/UNESCO_UIS", steward: "UNESCO / higher-education ministry", isProxy: true, proxyNote: "Proxy: STEM share of graduates, not STEM enrolment. Closer to the DAMM construct than all-fields tertiary enrolment.", fallbacks: [{ kind: "worldbank", series: "SE.TER.ENRR", sourceName: "World Bank WDI / UNESCO (tertiary enrolment, all fields)", sourceUrl: "https://data.worldbank.org/indicator/SE.TER.ENRR", steward: "UNESCO / higher-education ministry", isProxy: true, proxyNote: "Proxy: gross tertiary enrolment, all fields. Used only if the UNESCO STEM-graduate series is empty." }] },
  { indicatorId: "5.4", kind: "named-gap", sourceName: "Farmer digital-literacy survey", steward: "Ministry of Agriculture / statistics office", gapNote: "Local survey." },
  { indicatorId: "5.5", kind: "named-gap", sourceName: "Extension workforce records", steward: "Ministry of Agriculture", gapNote: "Core gate. Share of extension workers trained in digital tools." },
  { indicatorId: "5.6", kind: "named-gap", sourceName: "Extension workforce records", steward: "Ministry of Agriculture", gapNote: "Anchored rubric — farmer-to-digital-extension-worker ratio." },
  { indicatorId: "5.7", kind: "named-gap", sourceName: "Ministry organogram / budget", steward: "Ministry of Agriculture", gapNote: "Core gate. Anchored rubric — dedicated digital/AI unit." },
  { indicatorId: "5.8", kind: "named-gap", sourceName: "University programme catalogue", steward: "Higher-education ministry", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "5.9", kind: "named-gap", sourceName: "Training-programme files", steward: "Ministry of Agriculture / higher-education ministry", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "5.10", kind: "named-gap", sourceName: "Training reach statistics", steward: "Ministry of Agriculture", gapNote: "Annual reach as % of farmer population." },
  { indicatorId: "5.11", kind: "named-gap", sourceName: "Agency digital-maturity assessment", steward: "Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "5.12", kind: "named-gap", sourceName: "Workforce gender statistics", steward: "Ministry of Agriculture", gapNote: "Gender balance in the digital-agriculture workforce." },

  { indicatorId: "6.1", kind: "named-gap", sourceName: "WIPO Global Innovation Index", sourceUrl: "https://www.wipo.int/web-publications/global-innovation-index-2025/en/gii-2025-results.html", steward: "WIPO GII", gapNote: "GII score is published by WIPO. No stable public API series in Data360 yet." },
  { indicatorId: "6.2", kind: "worldbank", series: "GB.XPD.RSDV.GD.ZS", sourceName: "World Bank WDI / UNESCO", sourceUrl: "https://data.worldbank.org/indicator/GB.XPD.RSDV.GD.ZS", steward: "Statistics office / science ministry" },
  { indicatorId: "6.3", kind: "named-gap", sourceName: "World Bank B-READY", sourceUrl: "https://www.worldbank.org/en/businessready", steward: "B-READY", gapNote: "Business Ready score. World Bank B-READY, not the retired Doing Business series. Data360 publishes pillar scores only — no overall score is invented." },
  { indicatorId: "6.4", kind: "named-gap", sourceName: "Agtech firm register", steward: "Private-sector panel", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.5", kind: "named-gap", sourceName: "Investment databases", steward: "Private-sector panel / finance seat", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.6", kind: "named-gap", sourceName: "Accelerator landscape", steward: "Private-sector panel", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.7", kind: "named-gap", sourceName: "Agribusiness survey", steward: "Private-sector panel", gapNote: "Share of agribusiness firms using AI/ML." },
  { indicatorId: "6.8", kind: "named-gap", sourceName: "Sandbox instrument", steward: "Regulator / digital authority", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.9", kind: "named-gap", sourceName: "PPP register", steward: "Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.10", kind: "named-gap", sourceName: "Budget / grant records", steward: "Finance seat / Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.11", kind: "named-gap", sourceName: "DFS platform documentation", steward: "Central bank / private-sector panel", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.12", kind: "named-gap", sourceName: "DPG adoption record", steward: "Digital authority", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "6.13", kind: "named-gap", sourceName: "SME digital-adoption survey", steward: "Private-sector panel / statistics office", gapNote: "SME access to digital agriculture tools." },

  { indicatorId: "7.1", kind: "named-gap", sourceName: "Scopus / OpenAlex AI publications", steward: "Science ministry", gapNote: "AI-related publications per million. Bibliometric extract, not a WDI series." },
  { indicatorId: "7.2", kind: "named-gap", sourceName: "Public-sector AI inventory", steward: "Ministry of Agriculture / digital authority", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "7.3", kind: "named-gap", sourceName: "Advisory reach statistics", steward: "Ministry of Agriculture", gapNote: "Farmer reach of AI-enabled advisory." },
  { indicatorId: "7.4", kind: "named-gap", sourceName: "Detection-system coverage", steward: "Ministry of Agriculture", gapNote: "Coverage of AI crop/pest/disease detection." },
  { indicatorId: "7.5", kind: "named-gap", sourceName: "Agri-finance AI deployments", steward: "Central bank / private-sector panel", gapNote: "Coverage of AI in agricultural finance." },
  { indicatorId: "7.6", kind: "named-gap", sourceName: "Traceability / logistics systems", steward: "Private-sector panel", gapNote: "Coverage of AI in supply-chain optimisation." },
  { indicatorId: "7.7", kind: "named-gap", sourceName: "Climate-risk AI services", steward: "Met service / Ministry of Agriculture", gapNote: "Coverage of AI climate forecasting for agriculture." },
  { indicatorId: "7.8", kind: "named-gap", sourceName: "Workforce / vacancy data", steward: "Ministry of Agriculture", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "7.9", kind: "named-gap", sourceName: "Sector security assessments", steward: "National CERT / digital authority", gapNote: "Core gate. Recast in v1.3 — do not import the national GCI as the score." },
  { indicatorId: "7.10", kind: "named-gap", sourceName: "Model cards / farmer-facing notices", steward: "Digital authority / independent challenger", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "7.11", kind: "named-gap", sourceName: "Bias-assessment reports", steward: "Independent challenger / digital authority", gapNote: "Anchored rubric — panel scoring." },
  { indicatorId: "7.12", kind: "named-gap", sourceName: "Consent / data-rights records", steward: "Digital authority / farmer representative", gapNote: "Core gate. Anchored rubric — panel scoring." },

  { indicatorId: "8.1", kind: "worldbank", series: "SN.ITK.DEFC.ZS", sourceName: "World Bank WDI / FAO", sourceUrl: "https://data.worldbank.org/indicator/SN.ITK.DEFC.ZS", steward: "Statistics office / FAO" },
  { indicatorId: "8.2", kind: "worldbank", series: "FX.OWN.TOTL.FE.ZS", sourceName: "Global Findex (female account ownership)", sourceUrl: "https://data.worldbank.org/indicator/FX.OWN.TOTL.FE.ZS", steward: "Global Findex" },
  { indicatorId: "8.3", kind: "derived", series: "FX.OWN.TOTL.MA.ZS", seriesB: "FX.OWN.TOTL.FE.ZS", derive: "subtract", sourceName: "Global Findex (male minus female account ownership)", sourceUrl: "https://data.worldbank.org/indicator/FX.OWN.TOTL.FE.ZS", steward: "Global Findex" },
  {
    indicatorId: "8.4",
    kind: "data360",
    databaseId: "WB_FINDEX",
    data360Indicator: "WB_FINDEX_MOBILEACCOUNT_T_D",
    data360Sex: "_T",
    data360Age: "Y_GE15",
    sourceName: "Global Findex — mobile money account (via World Bank Data360)",
    sourceUrl: "https://www.worldbank.org/en/publication/globalfindex",
    steward: "Global Findex",
    fallbacks: [
      {
        kind: "worldbank",
        series: "FX.OWN.MMNY.ZS",
        sourceName: "Global Findex (mobile money account, WDI code)",
        sourceUrl: "https://data.worldbank.org/indicator/FX.OWN.MMNY.ZS",
        steward: "Global Findex",
        isProxy: true,
        proxyNote: "Legacy WDI code. Prefer the Data360 Findex mobile-account series.",
      },
    ],
  },
  { indicatorId: "8.5", kind: "worldbank", series: "SG.OWN.LDAL.FE.ZS", sourceName: "World Bank Gender Statistics (women who own land, alone or jointly)", sourceUrl: "https://data.worldbank.org/indicator/SG.OWN.LDAL.FE.ZS", steward: "FAO / statistics office", isProxy: true, proxyNote: "Proxy: Gender Statistics series on women who own land alone or jointly. Confirm against FAO Gender and Land Rights / the agricultural census share of female holders." },
  { indicatorId: "8.6", kind: "named-gap", sourceName: "GSMA / Findex gender gap in mobile ownership", sourceUrl: "https://www.worldbank.org/en/publication/globalfindex", steward: "GSMA / Global Findex", gapNote: "Percentage-point gap in mobile phone ownership." },
  { indicatorId: "8.7", kind: "named-gap", sourceName: "Farmer demand and use survey", steward: "Ministry of Agriculture / statistics office", gapNote: "FDUS / household survey." },
  { indicatorId: "8.8", kind: "named-gap", sourceName: "Farmer demand and use survey", steward: "Ministry of Agriculture / statistics office", gapNote: "FDUS / household survey." },
  { indicatorId: "8.9", kind: "named-gap", sourceName: "Farmer demand and use survey", steward: "Ministry of Agriculture / statistics office", gapNote: "FDUS / household survey." },
  { indicatorId: "8.10", kind: "named-gap", sourceName: "FDUS / household expenditure survey", steward: "Statistics office", gapNote: "Share of bottom-quintile rural households for whom the defined digital-agriculture basket costs ≤5% of expenditure." },
  { indicatorId: "8.11", kind: "named-gap", sourceName: "Platform language audit", steward: "Digital authority / farmer representative", gapNote: "Share of major platforms offering local-language services." },
  { indicatorId: "8.12", kind: "named-gap", sourceName: "Impact-evidence register", steward: "Evidence panel / independent challenger", gapNote: "Scores the QUALITY of yield-impact evidence, not the size of claimed impact." },
  { indicatorId: "8.13", kind: "named-gap", sourceName: "Impact-evidence register", steward: "Evidence panel / independent challenger", gapNote: "Scores the QUALITY of income-impact evidence, not the size of claimed impact." },
  { indicatorId: "8.14", kind: "named-gap", sourceName: "Climate-service reach statistics", steward: "Met service / Ministry of Agriculture", gapNote: "Farmers using digital climate services." },
  { indicatorId: "8.15", kind: "named-gap", sourceName: "Environmental-sustainability assessment", steward: "Environment ministry / Ministry of Agriculture", gapNote: "Environmental sustainability of digital agriculture systems." },
];

export function sourceFor(id: string): SourceSpec | undefined {
  return SOURCE_MAP.find((s) => s.indicatorId === id);
}

export function fetchableSpecs(): SourceSpec[] {
  return SOURCE_MAP.filter((s) => s.kind !== "named-gap");
}
