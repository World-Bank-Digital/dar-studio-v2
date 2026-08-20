const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  PageBreak, LevelFormat, convertInchesToTwip,
} = require("docx");

const D = JSON.parse(fs.readFileSync("/tmp/guide_data.json", "utf8"));
const GREEN = "1F5C3D", INK = "212B24", MUTED = "5A685E", LINE = "DCE1D8", TINT = "EFF3EC";
const FONT = "Arial";

const P = (text, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 280 },
  alignment: o.align,
  indent: o.indent,
  children: [new TextRun({ text, font: FONT, size: o.size ?? 21, color: o.color ?? INK, bold: o.bold, italics: o.italics })],
});

const Rich = (runs, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 280 },
  children: runs.map((r) => new TextRun({ font: FONT, size: 21, color: r.color ?? INK, text: r.t, bold: r.b, italics: r.i })),
});

const H1 = (t) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 380, after: 160 },
  children: [new TextRun({ text: t, font: FONT, size: 30, bold: false, color: GREEN })],
});
const H2 = (t) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 },
  children: [new TextRun({ text: t, font: FONT, size: 24, bold: true, color: INK })],
});
const Kicker = (t) => new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({ text: t.toUpperCase(), font: FONT, size: 16, bold: true, color: GREEN, characterSpacing: 40 })],
});
const Bullet = (t) => new Paragraph({
  numbering: { reference: "bullets", level: 0 }, spacing: { after: 90, line: 280 },
  children: [new TextRun({ text: t, font: FONT, size: 21, color: INK })],
});
const Rule = () => new Paragraph({
  spacing: { before: 60, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE } },
  children: [new TextRun({ text: "", font: FONT, size: 2 })],
});

function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, o = {}) => new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    shading: o.head ? { type: ShadingType.CLEAR, fill: TINT } : undefined,
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    children: [new Paragraph({
      spacing: { after: 0, line: 260 },
      children: [new TextRun({ text: String(text ?? ""), font: FONT, size: o.head ? 17 : 19,
        bold: o.head || o.b, color: o.head ? MUTED : INK })],
    })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: LINE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { head: true, w: widths[i] })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { w: widths[i], b: i === 0 })) })),
    ],
  });
}

const W = [9360];
const kids = [];

// ---------------------------------------------------------------- cover
kids.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: "", size: 2 })] }));
kids.push(Kicker("Digital Agriculture Roadmap · methodology"));
kids.push(new Paragraph({
  spacing: { after: 100 },
  children: [new TextRun({ text: "The Digital Agriculture Maturity Model", font: FONT, size: 48, color: INK })],
}));
kids.push(new Paragraph({
  spacing: { after: 260 },
  children: [new TextRun({ text: `Version ${D.version} — a guidebook to the model as implemented`, font: FONT, size: 26, color: MUTED, italics: true })],
}));
kids.push(Rule());
kids.push(P("This guidebook describes the Digital Agriculture Maturity Model (DAMM) exactly as it is implemented in the DAR Studio prototype: what it measures, how a reading becomes a level, how levels become the three read-outs, what the model refuses to do, and how a diagnostic package becomes a draft roadmap.", { size: 22 }));
kids.push(P("Every figure in this document is read from the model configuration the software scores against, so the guidebook cannot describe a model different from the one that runs.", { color: MUTED, italics: true }));
kids.push(P("August 2026 · Prepared for review · Not an official World Bank document", { color: MUTED, size: 19, after: 240 }));

// ------------------------------------------------------------- contents
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1("Contents"));
[
  ["1.", "What the model is for"],
  ["2.", "The model at a glance"],
  ["3.", "How a reading becomes a level"],
  ["4.", "Evidence quality"],
  ["5.", "The three read-outs"],
  ["6.", "Core gates and the stage cascade"],
  ["7.", "The four-step process"],
  ["8.", "The diagnostic package"],
  ["9.", "From diagnostic package to draft roadmap"],
  ["", "Glossary"],
].forEach(([n, t]) => kids.push(new Paragraph({
  spacing: { after: 110 },
  children: [
    new TextRun({ text: n ? n + "  " : "     ", font: FONT, size: 21, color: GREEN, bold: true }),
    new TextRun({ text: t, font: FONT, size: 21, color: INK }),
  ],
})));

// --------------------------------------------------------------- part 1
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1("1. What the model is for"));
kids.push(P("The DAMM answers one question for a task team: what can public evidence tell us about a country's readiness for digital agriculture, and what can it not tell us? It is a diagnostic instrument. It produces a standardised evidence pack — the diagnostic package — that a Task Team Leader uses as the factual basis for a Digital Agriculture Roadmap."));
kids.push(P("The model is deliberately conservative. Where evidence is thin, it says so and withholds the score rather than computing a confident-looking number from a partial picture. That behaviour is not a limitation to be engineered away; it is the point. A maturity score that overstates is more damaging than one that understates, because it travels into documents that commit money."));

kids.push(H2("What it is not"));
kids.push(P("Four prohibitions are wired into the software, not merely stated in guidance:"));
[
  "No cross-country ranking. Bands and stages are diagnostic categories, not league-table positions.",
  "No DAMM stage used as a PDO indicator, DLI, or disbursement condition.",
  "No automatic financing, procurement, vendor, or technology decisions arising from the diagnostic.",
  "No stage claimed publicly before human review by the Task Team Leader and steering committee.",
].forEach((t) => kids.push(Bullet(t)));
kids.push(P("The software enforces the fourth by watermarking any stage it computes as provisional and by refusing to present a stage as settled until a human has validated the evidence behind it.", { after: 200 }));

// --------------------------------------------------------------- part 2
kids.push(H1("2. The model at a glance"));
kids.push(table(
  ["Element", "Count", "Note"],
  [
    ["Indicators", String(D.n), "Each carries a source, an observation year, a confidence tag and a level"],
    ["Pillars", String(D.pillars.length), "Seven scored, plus one context profile that is never aggregated"],
    ["Core gates", String(D.gates.length), "Prerequisites; not tradeable against strength elsewhere"],
    ["Read-outs", "3", "CMS, EMS and OES — never averaged into a single number"],
    ["Levels", "5", "Nascent, Emerging, Established, Advanced, Transformative"],
    ["Process steps", String(D.proc.length), "Populate, score evidence quality, compile package, draft roadmap"],
  ],
  [2200, 1200, 5960],
));
kids.push(P(""));
kids.push(P(`Of the ${D.n} indicators, ${D.methods["Quantitative threshold"]} are quantitative thresholds, ${D.methods["Qualitative (capability)"] + D.methods["Qualitative (evidence quality)"]} are qualitative indicators scored against written anchors, and ${D.methods["Context profile (not aggregated)"]} are context profiles that describe the sector without ever entering a maturity score.`));

kids.push(H2("The eight pillars"));
kids.push(table(
  ["Pillar", "Name", "Role", "Weight", "Indicators", "Gates"],
  D.pillars.map((p) => [p.id, p.name, p.role, p.weight === null || p.weight === undefined ? "—" : `${Math.round(p.weight * 100)}%`, String(p.n), p.gates ? String(p.gates) : "—"]),
  [800, 3200, 1500, 1000, 1500, 1360],
));
kids.push(P(""));
kids.push(P("Weights apply within a role family, not across the model. The four capability pillars weight to 1.00 between them, the two ecosystem pillars weight to 1.00 between them, and the single outcome pillar carries the whole of its own read-out. C0 carries no weight at all: it profiles the agricultural sector the roadmap will serve, and interpreting it as digital maturity would be a category error."));

// --------------------------------------------------------------- part 3
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1("3. How a reading becomes a level"));
kids.push(P("Every indicator resolves to a level from 1 to 5, or to nothing at all. There are three routes, and which route applies is a property of the indicator, not a choice made during an assessment."));

kids.push(H2("Quantitative thresholds"));
kids.push(P(`${D.methods["Quantitative threshold"]} indicators carry four numeric thresholds. Where the indicator's direction is Higher, a value at or above the level-5 threshold scores 5, at or above level 4 scores 4, and so on; a value below the level-2 threshold scores 1. Where the direction is Lower — a price, a cost, a loss — the comparison reverses. The software never interpolates, converts units, or combines figures to reach a threshold.`));

kids.push(H2("Qualitative indicators"));
kids.push(Rich([
  { t: `${D.methods["Qualitative (capability)"] + D.methods["Qualitative (evidence quality)"]} indicators` },
  { t: " have no number to fetch. A national farmer registry, an agricultural data-governance framework, a coordination mechanism — these are assessed against a written paragraph describing what each of the five levels looks like. The assessor reads the anchor text and selects the level the evidence supports." },
]));
kids.push(Rich([
  { t: "This is the slow half of an assessment and the half that most needs a human. ", b: true },
  { t: "The machine may propose a level from public documents, but a proposal is treated as requiring validation by default: it is recorded, cited, and argued clause-by-clause against the anchor text, and it feeds provisional scores — but it is not a finding until an assessor confirms it. The assessor's level always wins." },
]));

kids.push(H2("Context profiles"));
kids.push(P(`${D.methods["Context profile (not aggregated)"]} indicators describe the sector — value added per worker, cereal yield, employment share, post-harvest loss — and are reported without a level. They inform the roadmap's opening chapters and are structurally excluded from every score.`));

kids.push(H2("What every reading carries"));
kids.push(P("A reading that lacks any of the following is not admitted to the evidence base:"));
[
  "The value — a figure for a quantitative indicator, a narrative statement for a qualitative one.",
  "The source, named, with a public URL. A reading without a citable source is capped at the lowest credibility grade and cannot be scored.",
  "The observation year, as stated by the source — not the date the assessment was run.",
  "A confidence tag: High, Medium, Low, or Data Gap.",
].forEach((t) => kids.push(Bullet(t)));

// --------------------------------------------------------------- part 4
kids.push(H1("4. Evidence quality"));
kids.push(P("The model scores the evidence as well as the country. Five concepts combine into an evidence quality index that travels with every read-out."));

kids.push(H2("Confidence"));
kids.push(table(
  ["Tag", "Weight", "Meaning"],
  Object.entries(D.conf).map(([k, v]) => [k, String(v), k === "Data Gap"
    ? "Recorded as an explicit gap and weighted zero — a gap that has been looked for and named, not a blank"
    : k === "High" ? "Official source, exact definition match, current"
    : k === "Medium" ? "Official source with a documented proxy or a minor definitional gap"
    : "Estimated, indirect, or from a non-official source"]),
  [1600, 1200, 6560],
));
kids.push(P(""));

kids.push(H2("Staleness"));
kids.push(P(`Each indicator carries a maximum age — ${D.maxage["2"]} indicators allow two years and ${D.maxage["3"]} allow three. A reading older than its limit is flagged stale automatically. Stale readings still count towards coverage, but they populate the refresh list that a task team works through before finalising a roadmap.`));

kids.push(H2("Coverage, and the refusal to compute"));
kids.push(P("Coverage is the share of a pillar's indicators that carry a level. Below the coverage gate, the pillar does not receive a low score — it reports Not rated. The distinction matters: a low score is a finding about the country, while Not rated is a finding about the evidence."));
kids.push(table(
  ["Gate", "Threshold", "What it governs"],
  [
    ["pillar_min", `${Math.round(D.cov.pillar_min * 100)}%`, "A pillar reads Not rated below this share of indicators levelled"],
    ["cms_min", `${Math.round(D.cov.cms_min * 100)}%`, "Capability coverage required before any overall stage is issued"],
    ["ems_min", `${Math.round(D.cov.ems_min * 100)}%`, "Ecosystem coverage required before EMS is reported"],
    ["evidence_adequacy_min", String(D.cov.evidence_adequacy_min), "Minimum weighted adequacy for a read-out to stand"],
  ],
  [3000, 1200, 5160],
));
kids.push(P(""));
kids.push(P("Two lists fall out of these checks and are the practical output for a task team. The refresh list gathers every stale or low-confidence reading, and drives desk research and mission planning. The verify list gathers every data gap and every unmeasured core gate, and must be closed before a roadmap is finalised."));

// --------------------------------------------------------------- part 5
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1("5. The three read-outs"));
kids.push(P("The model produces three scores on the 1–5 scale and refuses to average them together. A country can build systems without yet moving outcomes; averaging would hide exactly that."));
kids.push(table(
  ["Read-out", "Full name", "Composition"],
  [
    ["CMS", "Capability Maturity Score", "The four capability pillars, weighted. Government's own capability."],
    ["EMS", "Ecosystem Maturity Score", "The two ecosystem pillars, weighted. The market and innovation environment."],
    ["OES", "Outcome & Equity Score", "The outcomes pillar. Inclusion, sustainability, realised results."],
  ],
  [1200, 2600, 5560],
));
kids.push(P(""));
kids.push(H2("Bands"));
kids.push(table(
  ["Level", "Band", "From", "Below"],
  D.bands.map((b) => [String(b.level), b.name, String(b.lo), String(b.hi)]),
  [1100, 3000, 2600, 2660],
));
kids.push(P(""));
kids.push(P("Bands are half-open and mutually exclusive, so a score sits in exactly one band with no boundary ambiguity."));

kids.push(H1("6. Core gates and the stage cascade"));
kids.push(P(`${D.gates.length} indicators are designated core gates. They are prerequisites rather than points to be traded off, and they behave non-compensatively:`));
kids.push(Bullet("A core gate at Level 1 caps the overall stage at Stage 1, however strong the rest of the assessment."));
kids.push(Bullet("A core gate that is unmeasured suppresses the stage entirely. A gap cannot be hidden by not measuring it."));
kids.push(P(""));
kids.push(table(
  ["ID", "Core gate", "Pillar"],
  D.gates.map((g) => [g.id, g.name, g.pillar]),
  [900, 6900, 1560],
));
kids.push(P(""));

kids.push(H2("The stage floors"));
kids.push(P("A stage is reached only when every floor for that stage is met. The achieved stage is the highest whose floors are all satisfied — a country between two sets of floors sits at the lower stage."));
kids.push(table(
  ["Stage", "CMS floor", "EMS floor", "OES floor"],
  [
    ["Stage 2", String(D.stage.stage2_cms), "—", "—"],
    ["Stage 3", String(D.stage.stage3_cms), String(D.stage.stage3_ems), "—"],
    ["Stage 4", String(D.stage.stage4_cms), String(D.stage.stage4_ems), String(D.stage.stage4_oes)],
    ["Stage 5", String(D.stage.stage5_cms ?? "—"), String(D.stage.stage5_ems ?? "—"), String(D.stage.stage5_oes ?? "—")],
  ],
  [2200, 2400, 2400, 2360],
));
kids.push(P(""));
kids.push(Rich([
  { t: "Leapfrog fragility. ", b: true },
  { t: `Where the gap between foundational and transformational capability exceeds ${D.leapfrog}, the assessment is flagged as leapfrog-fragile: advanced applications resting on foundations that cannot carry them. The flag is diagnostic, not punitive — it tells a task team where a roadmap's sequencing risk lies.` },
]));

// --------------------------------------------------------------- part 7
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1("7. The four-step process"));
D.proc.forEach((s) => {
  kids.push(H2(`Step ${s.step} — ${s.name}`));
  kids.push(Rich([{ t: "Executor: ", b: true }, { t: s.executor }, { t: "   ·   " }, { t: "Output: ", b: true }, { t: s.output }], { after: 100 }));
  kids.push(P(s.guidance));
});
kids.push(Rich([{ t: "Where the mandate sits. ", b: true }, { t: "Steps 1 to 3 run on public evidence at any time and produce an internal diagnostic package. The government mandate gates the roadmap, not the diagnostic: nothing is called a Digital Agriculture Roadmap before the government has mandated the work, and the package is watermarked accordingly." }]));

kids.push(H1("8. The diagnostic package"));
kids.push(P("The diagnostic package is the single artefact handed to the Task Team Leader. It answers seven questions in one document:"));
kids.push(table(
  ["Question", "Answered by"],
  [
    ["What is this country's provisional maturity?", "Headline read-outs and provisional stage"],
    ["Are the prerequisites in place?", "Core-gate audit"],
    ["Where is capability concentrated?", "Pillar snapshot"],
    ["How much should I trust the evidence?", "Evidence quality index"],
    ["What are the binding constraints?", "Top constraints, ranked by ascending level"],
    ["What must I refresh before finalising?", "Refresh list"],
    ["What gaps must I close?", "Verify list"],
  ],
  [5200, 4160],
));
kids.push(P(""));
kids.push(P("The stage on the package is provisional. A Task Team Leader may accept or override it while drafting; if overridden, the rationale belongs in the roadmap's methodology chapter."));

kids.push(H1("9. From diagnostic package to draft roadmap"));
kids.push(P("The DAR Studio prototype continues past Step 3. Having assembled and quality-scored the evidence, it drafts the roadmap itself — a full document with chapters and annexes — which the task team then reviews and corrects."));
kids.push(P("Three disciplines govern that drafting, and they are worth stating because they are what make a machine-drafted document reviewable:"));
kids.push(Bullet("Numbers are never invented. A language model writes connective prose over engine facts; any passage containing a figure the evidence base does not hold is rejected and discarded before it reaches the document."));
kids.push(Bullet("Provenance is inline. Every figure carries its source, observation year and credibility grade in place, and machine-proposed levels are labelled as proposals pending validation."));
kids.push(Bullet("Recommendations that rest on thin evidence are written as an explicit hypothesis with the evidence required and the decision gate that would confirm it, rather than as settled advice."));
kids.push(P("The draft opens with an evidence-health page: what the evidence can and cannot yet carry, and a ranked list of what to strengthen first. Reviewing and correcting an argued, cited document is a materially different task from authoring one from a blank page, and it is the task the tool is designed to create."));

// -------------------------------------------------------------- glossary
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1("Glossary"));
kids.push(table(
  ["Term", "Definition"],
  D.gloss.map((g) => [`${g.term}${g.name && g.name !== g.term ? ` — ${g.name}` : ""}`, g.text]),
  [2400, 6960],
));

kids.push(P(""));
kids.push(Rule());
kids.push(P(`Generated from the model configuration in use (DAMM v${D.version}). Independent prototype — not an official World Bank system, not a country ranking, not a scoring service.`, { color: MUTED, size: 18 }));

const doc = new Document({
  creator: "DAR Studio",
  title: `DAMM v${D.version} Guidebook`,
  description: "A guidebook to the Digital Agriculture Maturity Model as implemented",
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.28), hanging: convertInchesToTwip(0.18) } } } }],
    }],
  },
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1180, bottom: 1100, left: 1440, right: 1440 } } },
    children: kids,
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync("/tmp/guidebook/DAMM-v1.5-Guidebook.docx", b);
  console.log("wrote DAMM-v1.5-Guidebook.docx", b.length, "bytes");
});
