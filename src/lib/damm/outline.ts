/**
 * The Digital Agriculture Roadmap document architecture.
 *
 * This lives apart from `model_v1_3.json` deliberately. That file is the DAMM
 * v1.3 *maturity model* — pillars, indicators, thresholds, the scoring engine's
 * source of truth. The document architecture is a different thing that happens
 * to consume it, and the two now version independently: the roadmap structure
 * below is the 17-chapter form, while the scoring model remains v1.3.
 * Overwriting `dar_outline` in the model file would have entangled them again.
 *
 * Each chapter declares:
 *  - `readyAt` / `inputs` — where it sits on the eight-step decision ladder;
 *  - `kind` — whether it reports evidence or prescribes action.
 *
 * `kind` is the important one. Prescriptive chapters recommend, sequence and
 * cost things, so they stay locked until the evidence gauntlet clears; a
 * diagnostic chapter can be drafted from whatever evidence exists, because
 * describing a weak evidence base is itself a legitimate finding.
 */

export type ChapterKind = "diagnostic" | "prescriptive";

export interface OutlineChapter {
  n: string;
  title: string;
  content: string;
  producedBy: string;
  readyAt: number;
  inputs: number[];
  kind: ChapterKind;
  /** Ladder steps whose government decisions this chapter depends on. */
  needsDecisions?: string[];
  note?: string;
}

export const DAR_CHAPTERS: OutlineChapter[] = [
  {
    n: "1",
    title: "Executive Summary and Investment Case",
    content: "The central argument, priority investments and decisions required of government.",
    producedBy: "Synthesis of all chapters",
    readyAt: 8,
    inputs: [1, 6, 7, 8],
    kind: "prescriptive",
    needsDecisions: ["G"],
    note: "Written last. A minister should be able to read this alone and understand the argument, the priorities and the decisions required.",
  },
  {
    n: "2",
    title: "Country and Agrifood Diagnostic",
    content:
      "Macroeconomic significance, farm structure, tenure, smallholders, women and youth, value chains, water, climate exposure, finance and markets.",
    producedBy: "C0 context indicators + dossier chapter-1 leads",
    readyAt: 1,
    inputs: [1],
    kind: "diagnostic",
    note: "Distinguishes structural characteristics from outdated statistics. Data whose vintage makes it unsuitable for targeting is flagged in place.",
  },
  {
    n: "3",
    title: "Digital Agriculture Ecosystem Assessment",
    content:
      "Existing registries, advisory platforms, market systems, payments, traceability and private agri-tech — with evidence of actual use, not merely existence.",
    producedBy: "Dossier ecosystem sweep + C1/C2 indicators",
    readyAt: 1,
    inputs: [1],
    kind: "diagnostic",
    note: "The existence of a system is not evidence of its effectiveness. Each entry records purpose, owner, users, scale, evidence of use, interoperability and reuse potential. Provisional from Step 1, but no stage is claimable until the government mandate exists and the read-outs are validated at Step 6.",
  },
  {
    n: "4",
    title: "Farmer Registry Assessment",
    content:
      "Coverage of holdings versus actual cultivators, identification, accuracy, geospatial and tenure linkage, consent, grievance, APIs, ownership and vendor dependency.",
    producedBy: "Registry scorecard (Annex C) + steward validation",
    readyAt: 4,
    inputs: [1, 4],
    kind: "diagnostic",
    note: "Evaluate → remediate, federate, replace or retire. The existing registry is not presumed to be the future registry.",
  },
  {
    n: "5",
    title: "DPI and Interoperability Assessment",
    content:
      "Identity, payments, data exchange, consent, signatures, geospatial infrastructure and cloud — what agriculture should reuse rather than rebuild.",
    producedBy: "DPI maturity assessment (Annex D) + C2 indicators",
    readyAt: 4,
    inputs: [1, 4],
    kind: "diagnostic",
    note: "Farmer identity, social-protection identity, payments, land records and entitlement stay conceptually separate unless an architecture justifies collapsing them.",
  },
  {
    n: "6",
    title: "Institutions and Political Economy",
    content:
      "Institutions mapped by actual function: accountable body, named post, authority, recurrent budget, technical capability and implementation history.",
    producedBy: "Dossier institutional sweep + Step 5 government gates",
    readyAt: 5,
    inputs: [4, 5],
    kind: "diagnostic",
    needsDecisions: ["G"],
    note: "A minister is not an implementation owner. Existing coordination mechanisms are tested before a new unit is proposed.",
  },
  {
    n: "7",
    title: "Inclusion and Last-Mile Delivery",
    content:
      "Whether services reach women who farm without title, tenants, sharecroppers, landless livestock keepers, youth, low-literacy and low-connectivity users.",
    producedBy: "Inclusion indicators + disaggregation review",
    readyAt: 6,
    inputs: [1, 6],
    kind: "diagnostic",
    note: "Inclusion is an architectural test applied to every service, not a chapter appended after design. Registration is not an inclusion outcome.",
  },
  {
    n: "8",
    title: "Technology, Innovation and AI",
    content:
      "Where AI, remote sensing, geospatial analytics and IoT genuinely add value, against problem, user, data, oversight, hosting and recurrent funding.",
    producedBy: "E2 indicators + national AI strategy leads",
    readyAt: 6,
    inputs: [1, 6],
    kind: "diagnostic",
    note: "Mention of agriculture in a national AI strategy is neither authorisation nor implementation capacity.",
  },
  {
    n: "9",
    title: "Strategic Foresight",
    content:
      "External drivers and uncertainties — water, climate extremes, price shocks, fiscal constraints, trade requirements, subsidy reform — as signposts and triggers.",
    producedBy: "Foresight sweep + hazard profile",
    readyAt: 6,
    inputs: [3, 6],
    kind: "diagnostic",
    note: "Uncertainties become signposts, triggers and contingent branches. Probabilities are not asserted without evidence.",
  },
  {
    n: "10",
    title: "Priority Opportunity Portfolio",
    content:
      "The opportunity set scored against impact, farmer value, inclusion, evidence strength, feasibility, readiness, sustainability and risk.",
    producedBy: "Prioritisation framework over the opportunity long-list",
    readyAt: 7,
    inputs: [3, 6, 7],
    kind: "prescriptive",
    note: "Separates no-regret actions, conditional investments, experiments, deferred opportunities and explicit do-not-do items.",
  },
  {
    n: "11",
    title: "Target Digital Agriculture Architecture",
    content: "The target state, its components, reuse decisions, standards and the sequence in which it is built.",
    producedBy: "Architecture and standards (Annex F)",
    readyAt: 7,
    inputs: [6, 7],
    kind: "prescriptive",
  },
  {
    n: "12",
    title: "Policy, Data Governance, Cybersecurity and Trust",
    content:
      "Legal basis, controllers and processors, lawful basis for each linkage, correction, auditability, access rules and exit conditions.",
    producedBy: "Legal sweep + C3 indicators",
    readyAt: 7,
    inputs: [5, 6, 7],
    kind: "prescriptive",
    needsDecisions: ["G"],
    note: "High-risk cross-government joins remain hypotheses until legal and institutional authority is established.",
  },
  {
    n: "13",
    title: "Governance and Delivery Model",
    content: "Who owns, who pays, who operates, and through what channel each service is delivered.",
    producedBy: "Institutional assessment + Step 8 adoption",
    readyAt: 8,
    inputs: [5, 7, 8],
    kind: "prescriptive",
    needsDecisions: ["G"],
  },
  {
    n: "14",
    title: "Investment and Financing Strategy",
    content:
      "Investment objects by phase, cost class, capital versus recurrent, likely payer, partner and private-sector role.",
    producedBy: "Costing assumptions (Annex H) + portfolio scenario",
    readyAt: 7,
    inputs: [6, 7],
    kind: "prescriptive",
    note: "Cost classes (Low / Moderate / High / Very High) are used where costing data are absent, with the drivers named.",
  },
  {
    n: "15",
    title: "Implementation Roadmap",
    content:
      "Phased sequence: evidence and foundations; integration and first scaled services; platform and ecosystem scale.",
    producedBy: "Sequencing over the prioritised portfolio",
    readyAt: 7,
    inputs: [6, 7],
    kind: "prescriptive",
    note: "Phase boundaries are gates, not dates. Time periods are adapted to the country rather than assumed.",
  },
  {
    n: "16",
    title: "Results, Risks, Gates and Adaptive Management",
    content:
      "Baseline, outcome, service, inclusion and institutional indicators; entry conditions, success criteria, stop rules and fallback pathways.",
    producedBy: "Results architecture + gate register",
    readyAt: 8,
    inputs: [4, 6, 8],
    kind: "prescriptive",
    note: "Indicators are not included merely because data exist. Necessary but unavailable indicators are named with their producer.",
  },
  {
    n: "17",
    title: "Consultation Priorities",
    content: "Unresolved questions routed to counterpart, with the decision each affects and the evidence needed.",
    producedBy: "Consultation ledger",
    readyAt: 4,
    inputs: [3, 4],
    kind: "diagnostic",
    note: "The document is pre-consultation unless evidence of real engagement is supplied. Simulated perspectives are never presented as stakeholder views.",
  },
];

export const DAR_ANNEXES: OutlineChapter[] = [
  ["A", "Data and Indicators", "Full indicator register with values, years, sources and credibility grades.", 1],
  ["B", "Ecosystem Inventory", "Every identified system with owner, users, scale and evidence of use.", 1],
  ["C", "Farmer Registry Scorecard", "Detailed registry assessment against each evaluated dimension.", 4],
  ["D", "DPI Maturity Assessment", "Identity, payments, exchange, consent, geospatial and cloud readiness.", 4],
  ["E", "Use-Case Profiles", "Problem, user, data, oversight, hosting and funding for each proposed use case.", 7],
  ["F", "Architecture and Standards", "Target architecture, interfaces and the standards adopted.", 7],
  ["G", "Legal and Responsible-AI Issues", "Legal basis, obligations, and responsible-AI risks per proposed system.", 6],
  ["H", "Costing Assumptions", "What drives each cost class and what would be needed to cost it properly.", 7],
  ["I", "Evidence Gaps", "Every named gap, its steward, and the decision it blocks.", 1],
  ["J", "Contradiction Ledger", "Competing claims, the stronger evidence, and whether the disagreement affects strategy.", 1],
  ["K", "Consultation Questions", "Prioritised questions by counterpart and decision affected.", 4],
].map(([n, title, content, readyAt]) => ({
  n: n as string,
  title: title as string,
  content: content as string,
  producedBy: "Assembled from the evidence base",
  readyAt: readyAt as number,
  inputs: [readyAt as number],
  kind: "diagnostic" as ChapterKind,
}));

export const DAR_OUTLINE: OutlineChapter[] = [...DAR_CHAPTERS, ...DAR_ANNEXES];

/**
 * Chapters that prescribe rather than describe, and therefore stay locked until
 * the evidence gauntlet clears. Derived from `kind` so the two can never drift.
 */
export const PRESCRIPTIVE_CHAPTERS: Set<string> = new Set(
  DAR_OUTLINE.filter((c) => c.kind === "prescriptive").map((c) => c.n),
);

export function outlineChapter(n: string): OutlineChapter | undefined {
  return DAR_OUTLINE.find((c) => c.n === n);
}

export function isPrescriptive(n: string): boolean {
  return PRESCRIPTIVE_CHAPTERS.has(n);
}

/**
 * Whether a section's body may be rewritten by the drafting model.
 *
 * Annexes never are. They are the evidence record itself — indicator tables,
 * scorecards, ledgers — and rewriting the record is exactly what the product
 * promises not to do. It also cut a 28-call drafting pass down to 17.
 */
export function shouldProse(n: string): boolean {
  return /^\d+$/.test(n);
}
