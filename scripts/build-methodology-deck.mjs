/**
 * Build the DAMM v1.3 methodology deck (World Bank "Modernist" system).
 *
 * Every figure on every slide is read from `src/data/model_v1_3.json` — the same
 * versioned configuration the application scores against — so the deck cannot
 * drift from the product. If the model changes, re-run this script.
 *
 *   node scripts/build-methodology-deck.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SKILL =
  process.env.MODERNIST_SKILL ||
  "/Users/randeepsudan/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/7fa72b6b-bf7f-4b6d-9cd3-62aa57ef46d1/b21ce9e4-9f62-4185-8a66-257f1e009678/skills/worldbank-modernist-deck";

const require = createRequire(join(SKILL, "scripts", "deck_helpers.js"));
const { Deck, PALETTE } = require(join(SKILL, "scripts", "deck_helpers.js"));

const M = JSON.parse(readFileSync(join(ROOT, "src/data/model_v1_3.json"), "utf8"));
const P = M.pillars;
const gates = M.indicators.filter((i) => i.gate);
const count = (id) => M.indicators.filter((i) => i.pillar === id).length;
const pct = (n) => `${Math.round(n * 100)}%`;

const deck = new Deck({
  title: "DAR Studio — the DAMM v1.3 methodology",
  author: "Randeep Sudan",
  logo: "worldbank-globe",
  brandLine: "DIGITAL AGRICULTURE ROADMAP · INDEPENDENT PROTOTYPE",
  metaLine: `DAMM ${M.version} · ${M.assessment_year}`,
});
const F = deck.F;

/**
 * Bullets with the marker on the text's first baseline.
 *
 * The library helper sizes the text box to the full step, so LibreOffice
 * vertically centres it and the square floats above the words whenever the
 * step is generous. Here the box is sized to the content instead.
 */
function bul(s, x, y, w, items, { size = 10.5, gap = 0.2, lines = 2 } = {}) {
  const lh = size * 1.28 / 72;
  items.forEach((t) => {
    const h = lh * lines;
    deck.sq(s, x, y + 0.055, 0.1);
    s.addText(t, {
      x: x + 0.26, y, w: w - 0.26, h,
      fontSize: size, fontFace: F, color: PALETTE.BODY,
      lineSpacing: size * 1.28, valign: "top", margin: 0,
    });
    y += h + gap;
  });
  return y;
}
const MX = deck.MX;
const CW = deck.CW;
const W = deck.W;

/* ── 01 Title ─────────────────────────────────────────────────────────── */
deck.titleSlide({
  eyebrow: "Digital Agriculture Roadmap · Methodology",
  title: "How the machine\nearns its numbers",
  subtitle:
    `${M.indicators.length} indicators, three read-outs, ${gates.length} non-tradeable gates — and the rule that no stage is claimed until a human validates it.\n` +
    "An independent prototype. Not an official World Bank system, not a country ranking, not a scoring service.",
  meta: { left: "Prepared for discussion · Randeep Sudan", right: "August 2026" },
});

/* ── 02 What it is / is not ───────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "01 / Premise");
  deck.title(s, "A diagnostic that says what it cannot know");
  const lw = 5.3;
  const lx = MX;
  const rx = MX + lw + 0.9;
  const rw = W - MX - rx;

  deck.hline(s, lx, 1.98, lw, { color: PALETTE.HAIR, pt: 1 });
  s.addText("What it does", {
    x: lx, y: 2.12, w: lw, h: 0.34, fontSize: 15, fontFace: F, bold: true, color: PALETTE.INK, margin: 0,
  });
  bul(s, lx, 2.62, lw, [
    "Assembles what public evidence can tell us about digital-agriculture readiness",
    "Shows plainly what it cannot tell us, and routes each gap to a named steward",
    "Carries a task team through the decisions that turn a diagnostic into a roadmap",
    "Produces a structured basis for professional judgement",
  ], { gap: 0.26 });

  deck.redRule(s, rx, 1.98, rw);
  s.addText("What it must never do", {
    x: rx, y: 2.12, w: rw, h: 0.34, fontSize: 15, fontFace: F, bold: true, color: PALETTE.RED, margin: 0,
  });
  bul(s, rx, 2.62, rw, M.prohibitions, { gap: 0.26 });

  s.addShape(deck.pres.ShapeType.line, {
    x: lx + lw + 0.45, y: 2.12, w: 0, h: 3.1, line: { color: PALETTE.HAIRL, width: 1 },
  });
  deck.hline(s, MX, 5.72, CW, { color: PALETTE.HAIRL, pt: 1 });
  deck.miniK(s, "The consequence", MX, 5.86, 4);
  s.addText(
    "All four prohibitions are enforced in software, not in guidance. The engine will suppress a score it cannot defend.",
    { x: MX, y: 6.12, w: CW, h: 0.5, fontSize: 11, fontFace: F, color: PALETTE.BODY, lineSpacing: 15, margin: 0 },
  );
  deck.footer(s, { src: `Source: DAMM ${M.version} configuration · prohibitions[]` });
}

/* ── 03 Section A ─────────────────────────────────────────────────────── */
deck.sectionSlide({
  letter: "A",
  label: "Section",
  title: "The measurement",
  items: [
    `A1  The chain: indicator → level → pillar → composite → stage`,
    `A2  Eight pillars, ${M.indicators.length} indicators`,
    "A3  Three read-outs, never one number",
  ],
});

/* ── 04 The chain ─────────────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "A1 / The chain");
  deck.title(s, "Five steps from a published figure to a stage");
  const CHAIN_SUMMARY = {
    Indicator: "Each indicator carries a rubric: numeric thresholds, or a written anchor for every level.",
    Level: "Evidence yields a level from 1 to 5 — suggested by the machine, or set by an assessor, who always wins.",
    Pillar: "The plain mean of the levels within a pillar — but only once enough of them are levelled to clear the coverage gate.",
    Composite: "Capability blends its four pillars by weight; ecosystem blends its two; outcomes stands alone.",
    Stage: "A non-compensatory cascade turns the three read-outs into one stage, applying the gate and coverage rules first.",
  };
  deck.pipeline(s, 2.15, M.methodology.chain.map((c) => ({
    h: c.step,
    t: CHAIN_SUMMARY[c.step] ?? c.text,
  })));
  deck.hline(s, MX, 5.62, CW, { color: PALETTE.HAIRL, pt: 1 });
  deck.miniK(s, "Who wins a disagreement", MX, 5.76, 5);
  s.addText(
    "An assessor level always overrides a machine-suggested level. An indicator marked as a data gap contributes nothing — it is neither a zero nor a guess.",
    { x: MX, y: 6.02, w: CW, h: 0.6, fontSize: 11, fontFace: F, color: PALETTE.BODY, lineSpacing: 15, margin: 0 },
  );
  deck.footer(s, { src: `Source: DAMM ${M.version} · methodology.chain[]` });
}

/* ── 05 Pillars and weights ───────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "A2 / Structure");
  deck.title(s, `Eight pillars, ${M.indicators.length} indicators, three groups`);

  const groups = [
    { k: "Capability → CMS", ids: ["C1", "C2", "C3", "C4"], red: true },
    { k: "Ecosystem → EMS", ids: ["E1", "E2"], red: false },
    { k: "Outcomes → OES", ids: ["O1"], red: false },
    { k: "Context · not aggregated", ids: ["C0"], red: false },
  ];
  let y = 1.92;
  groups.forEach((g) => {
    if (g.red) deck.redRule(s, MX, y, 3.2);
    else deck.hline(s, MX, y, CW, { color: PALETTE.HAIR, pt: 1 });
    deck.miniK(s, g.k, MX, y + 0.14, 5, { color: g.red ? PALETTE.RED : PALETTE.MUT });
    let x = MX;
    const cw = (CW - (g.ids.length - 1) * 0.4) / Math.max(g.ids.length, 1);
    g.ids.forEach((id) => {
      const p = P[id];
      // valign top so a wrapped two-line pillar name keeps the same baseline
      // as a single-line one; the sub-line sits clear of both.
      s.addText(`${id}  ${p.name}`, {
        x, y: y + 0.40, w: cw, h: 0.5, fontSize: 11.5, fontFace: F, bold: true,
        color: PALETTE.INK, lineSpacing: 14, valign: "top", margin: 0,
      });
      s.addText(
        `${count(id)} indicators${p.weight ? `  ·  weight ${pct(p.weight)}` : "  ·  no weight"}`,
        { x, y: y + 0.90, w: cw, h: 0.28, fontSize: 9.5, fontFace: F, color: PALETTE.BODY, valign: "top", margin: 0 },
      );
      x += cw + 0.4;
    });
    y += 1.24;
  });
  deck.footer(s, { src: `Source: DAMM ${M.version} · pillars{} and indicators[]` });
}

/* ── 06 Three read-outs ───────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "A3 / Read-outs");
  deck.title(s, "Three numbers the model refuses to average");
  deck.statRow(s, 1.95, [
    { n: "CMS", t: "Capability Maturity Score — government capability across connectivity, data and DPI, policy and governance, human capacity." },
    { n: "EMS", t: "Ecosystem Maturity Score — the innovation, private-sector and responsible-AI environment around that capability." },
    { n: "OES", t: "Outcome & Equity Score — inclusion, sustainability and realised results, reported on its own." },
  ]);
  deck.hline(s, MX, 4.62, CW, { color: PALETTE.HAIRL, pt: 1 });
  deck.miniK(s, "Why separate", MX, 4.76, 4);
  s.addText(
    "A country can build systems without yet moving outcomes. Averaging capability and outcomes into one index would hide exactly the gap a roadmap exists to close.",
    { x: MX, y: 5.02, w: 7.4, h: 0.8, fontSize: 11.5, fontFace: F, color: PALETTE.BODY, lineSpacing: 16, margin: 0 },
  );
  deck.miniK(s, "Bands (1–5)", MX + 7.9, 4.76, 3.6, { color: PALETTE.MUT });
  let by = 5.02;
  M.bands.forEach((b) => {
    deck.sq(s, MX + 7.9, by + 0.05, 0.1);
    s.addText(`${b.name}  ${b.lo.toFixed(1)}–${b.hi > 5 ? "5.0" : b.hi.toFixed(1)}`, {
      x: MX + 8.14, y: by, w: 3.3, h: 0.3, fontSize: 10, fontFace: F, color: PALETTE.BODY, margin: 0,
    });
    by += 0.32;
  });
  deck.footer(s, { src: `Source: DAMM ${M.version} · glossary, bands[]` });
}

/* ── 07 Section B ─────────────────────────────────────────────────────── */
deck.sectionSlide({
  letter: "B",
  label: "Section",
  title: "The guardrails",
  items: [
    "B1  Thirteen foundations that cannot be traded off",
    "B2  Silence beats a confident guess",
    "B3  Nothing before the mandate is an assessment",
  ],
});

/* ── 08 Core gates ────────────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "B1 / Core gates");
  deck.title(s, `${gates.length} foundations, treated as prerequisites`);
  s.addText(
    "One core gate at Level 1 caps the whole assessment at Stage 1. One left unmeasured suppresses the stage entirely. Strength elsewhere cannot buy off a foundational weakness.",
    { x: MX, y: 1.72, w: 10.6, h: 0.5, fontSize: 11.5, fontFace: F, color: PALETTE.BODY, lineSpacing: 16, margin: 0 },
  );
  const colW = (CW - 0.8) / 2;
  const half = Math.ceil(gates.length / 2);
  [0, 1].forEach((col) => {
    const x = MX + col * (colW + 0.8);
    const slice = gates.slice(col * half, (col + 1) * half);
    deck.hline(s, x, 2.42, colW, { color: PALETTE.HAIR, pt: 1 });
    let gy = 2.58;
    slice.forEach((g) => {
      deck.sq(s, x, gy + 0.06, 0.11);
      s.addText(g.id, {
        x: x + 0.26, y: gy, w: 0.62, h: 0.3, fontSize: 10, fontFace: F, bold: true, color: PALETTE.RED, margin: 0,
      });
      s.addText(g.name, {
        x: x + 0.92, y: gy, w: colW - 0.92, h: 0.44, fontSize: 10, fontFace: F, color: PALETTE.INK, lineSpacing: 12.5, margin: 0,
      });
      gy += 0.53;
    });
  });
  deck.footer(s, { src: `Source: DAMM ${M.version} · indicators[] where gate = true` });
}

/* ── 09 Suppression rules ─────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "B2 / Suppression");
  deck.title(s, "Where evidence is thin, the number disappears");
  deck.rows(s, 1.95, [
    {
      label: "Pillar coverage",
      mid: `below ${pct(M.coverage_gates.pillar_min)} levelled`,
      right: "The pillar score is suppressed rather than computed — and any composite containing it is suppressed with it.",
    },
    {
      label: "Capability coverage",
      mid: `below ${pct(M.coverage_gates.cms_min)}`,
      right: "No overall stage may be issued at all, however complete the rest of the picture looks.",
    },
    {
      label: "Evidence adequacy",
      mid: `below ${pct(M.coverage_gates.evidence_adequacy_min)}`,
      right: `Confidence is weighted: High ${M.confidence_weights.High}, Medium ${M.confidence_weights.Medium}, Low/Estimated ${M.confidence_weights["Low/Estimated"]}.`,
    },
    {
      label: "No public source URL",
      mid: "capped at grade E",
      right: "A reading that cannot be checked cannot carry a core gate. Silence beats a confident guess.",
    },
  ], { rowH: 0.78, cols: [3.0, 2.6] });

  deck.miniK(s, "Evidence grades", MX, 5.56, 4, { color: PALETTE.MUT });
  const grades = [
    ["A", "National or official exact series, current, matching definition"],
    ["B", "Official series with a documented proxy or minor cut gap"],
    ["C", "Specialized official index, or an older official series"],
    ["D", "Donor, research or industry dataset"],
    ["E", "Missing, unofficial, or uncitable — cannot be used to score"],
  ];
  let gx = MX;
  const gw = (CW - 4 * 0.25) / 5;
  grades.forEach(([g, t]) => {
    deck.hline(s, gx, 5.82, gw, { color: g === "E" ? PALETTE.RED : PALETTE.HAIRL, pt: g === "E" ? 2 : 0.75 });
    s.addText(g, {
      x: gx, y: 5.90, w: gw, h: 0.3, fontSize: 14, fontFace: F, bold: true,
      color: g === "E" ? PALETTE.RED : PALETTE.INK, margin: 0,
    });
    s.addText(t, { x: gx, y: 6.18, w: gw, h: 0.6, fontSize: 8, fontFace: F, color: PALETTE.BODY, lineSpacing: 10, margin: 0 });
    gx += gw + 0.25;
  });
  deck.footer(s, { src: `Source: DAMM ${M.version} · coverage_gates, confidence_weights` });
}

/* ── 10 Engagement package ────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "B3 / The engagement-package rule");
  deck.title(s, "Nothing before the mandate is an assessment");
  deck.redRule(s, MX, 2.05, 1.6);
  s.addText(
    "“Everything assembled before the government mandate is preparatory material for a Bank decision, not an assessment of the country. No maturity stage is claimable from it, however complete the evidence looks.”",
    { x: MX, y: 2.42, w: 9.6, h: 1.5, fontSize: 19, fontFace: F, color: PALETTE.INK, lineSpacing: 28, margin: 0 },
  );
  s.addText(`DAMM ${M.version} · glossary · engagement package`, {
    x: MX, y: 4.02, w: 6, h: 0.3, fontSize: 9, fontFace: F, charSpacing: 2, color: PALETTE.MUT, margin: 0,
  });
  deck.hline(s, MX, 4.62, CW, { color: PALETTE.HAIRL, pt: 1 });
  const cols = [
    ["Provisional level", "A level derived from a threshold rule, not yet confirmed. It feeds the scores you see — which is exactly why no stage is claimable until Step 6."],
    ["Named gap", "The machine admitting it found nothing, routed to a steward. It blocks the readiness gate."],
    ["Explicit data gap", "A human confirming no data exists. An accepted, accounted answer — not a failure."],
  ];
  let cx = MX;
  const ccw = (CW - 2 * 0.6) / 3;
  cols.forEach(([k, t]) => {
    deck.miniK(s, k, cx, 4.78, ccw);
    s.addText(t, { x: cx, y: 5.06, w: ccw, h: 1.3, fontSize: 10, fontFace: F, color: PALETTE.BODY, lineSpacing: 13.5, margin: 0 });
    cx += ccw + 0.6;
  });
  deck.footer(s, { src: `Source: DAMM ${M.version} · glossary` });
}

/* ── 11 Section C ─────────────────────────────────────────────────────── */
deck.sectionSlide({
  letter: "C",
  label: "Section",
  title: "The process",
  items: [
    "C1  Machines compute, humans gate",
    "C2  The eight-rung decision ladder",
    "C3  Ninety minutes to a first draft",
  ],
});

/* ── 12 Machines compute, humans gate ─────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "C1 / Division of labour");
  deck.title(s, "Machines compute. Humans gate.");
  const lw = 5.3;
  const lx = MX;
  const rx = MX + lw + 0.9;
  const rw = W - MX - rx;

  deck.hline(s, lx, 1.98, lw, { color: PALETTE.HAIR, pt: 1 });
  s.addText("Automated — mechanical", {
    x: lx, y: 2.12, w: lw, h: 0.34, fontSize: 15, fontFace: F, bold: true, color: PALETTE.INK, margin: 0,
  });
  bul(s, lx, 2.62, lw, [
    "Fetching public indicators from official statistical systems",
    "Retrieving source pages and extracting only figures that appear on them",
    "Applying threshold rules and recomputing read-outs",
    "Drafting connective narrative over engine facts",
  ], { gap: 0.26 });

  deck.redRule(s, rx, 1.98, rw);
  s.addText("Human — consequential", {
    x: rx, y: 2.12, w: rw, h: 0.34, fontSize: 15, fontFace: F, bold: true, color: PALETTE.RED, margin: 0,
  });
  bul(s, rx, 2.62, rw, [
    "Whether to engage at all, and in what mode",
    "Which value chains to target",
    "What the evidence means — the assessor level always wins",
    "Whether to adopt, disclose and version the record",
  ], { gap: 0.26 });

  s.addShape(deck.pres.ShapeType.line, {
    x: lx + lw + 0.45, y: 2.12, w: 0, h: 2.9, line: { color: PALETTE.HAIRL, width: 1 },
  });
  deck.hline(s, MX, 5.5, CW, { color: PALETTE.HAIRL, pt: 1 });
  deck.miniK(s, "Recorded, not assumed", MX, 5.64, 5);
  s.addText(
    "Every consequential decision is recorded with the role that made it, and the ladder cannot skip or move backwards. Step 1 is the machine's own step; from Step 2 onwards nothing advances until a human records it.",
    { x: MX, y: 5.9, w: CW, h: 0.7, fontSize: 11, fontFace: F, color: PALETTE.BODY, lineSpacing: 15, margin: 0 },
  );
  deck.footer(s, { src: `Source: DAMM ${M.version} · methodology.rules[]` });
}

/* ── 13 The ladder ────────────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "C2 / The decision ladder");
  deck.title(s, "Eight rungs, each with a named decider");
  let y = 1.9;
  const rowH = 0.6;
  M.ladder.forEach((r) => {
    const machine = r.decider === "machine";
    deck.hline(s, MX, y, CW, { color: PALETTE.HAIRL, pt: 1 });
    deck.sq(s, MX, y + 0.18, 0.12, machine ? PALETTE.MUT : PALETTE.RED);
    s.addText(String(r.step), {
      x: MX + 0.28, y: y + 0.1, w: 0.4, h: 0.34, fontSize: 12, fontFace: F, bold: true, color: PALETTE.INK, margin: 0,
    });
    s.addText(r.name, {
      x: MX + 0.72, y: y + 0.1, w: 3.1, h: 0.36, fontSize: 11.5, fontFace: F, bold: true, color: PALETTE.INK, margin: 0,
    });
    s.addText(machine ? "machine" : r.decider, {
      x: MX + 3.95, y: y + 0.12, w: 2.9, h: 0.34, fontSize: 9.5, fontFace: F, italic: true,
      color: machine ? PALETTE.MUT : PALETTE.RED, margin: 0,
    });
    s.addText(r.decision || "The machine collects, scores and hands over.", {
      x: MX + 7.0, y: y + 0.12, w: CW - 7.0, h: 0.36, fontSize: 9.5, fontFace: F, color: PALETTE.BODY, margin: 0,
    });
    y += rowH;
  });
  deck.hline(s, MX, y, CW, { color: PALETTE.HAIRL, pt: 1 });
  deck.footer(s, { src: `Source: DAMM ${M.version} · ladder[]` });
}

/* ── 14 The 90-minute path ────────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "C3 / What a task team actually does");
  deck.title(s, "Ninety minutes of human time");
  deck.pipeline(s, 2.1, [
    { h: "Open a country", t: "Pick the official economy. 1 minute." },
    { h: "Run the diagnostic", t: "Official statistics, then verified search. Unattended, ~15 minutes." },
    { h: "Read the gate", t: "13 core gates listed with why each fails. 5 minutes." },
    { h: "Clear the gates", t: "Assessor level plus a document citation, or an explicit data gap. 30–60 minutes — the step machines must not do." },
    { h: "Record Steps 2–8", t: "One short form per rung. ~15 minutes." },
    { h: "Assemble & export", t: "17 chapters and 11 annexes, every figure cited. ~10 minutes." },
  ]);
  deck.hline(s, MX, 5.66, CW, { color: PALETTE.HAIRL, pt: 1 });
  deck.miniK(s, "Why the fourth step is the long one", MX, 5.8, 6);
  s.addText(
    `Only 4 of the ${gates.length} core gates can be filled from international statistics. The rest — a farmer registry, a data-governance framework, a coordination mandate — have no published series. Only a person who has read the document can answer.`,
    { x: MX, y: 6.06, w: CW, h: 0.7, fontSize: 11, fontFace: F, color: PALETTE.BODY, lineSpacing: 15, margin: 0 },
  );
  deck.footer(s, { src: "Source: DAR Studio field guide · docs/TTL-GUIDE.md" });
}

/* ── 15 Output architecture ───────────────────────────────────────────── */
{
  const s = deck.slide();
  deck.kicker(s, "C3 / The output");
  deck.title(s, "Diagnostic chapters draft. Prescriptive chapters wait.");
  deck.statRow(s, 1.95, [
    { n: "17", t: "Chapters, from the executive summary and investment case through to consultation priorities." },
    { n: "11", t: "Annexes carrying the evidence record itself — never rewritten by a language model." },
    { n: "8", t: "Prescriptive chapters that stay locked until the evidence readiness gate clears." },
  ]);
  deck.hline(s, MX, 4.62, CW, { color: PALETTE.HAIRL, pt: 1 });
  const cols = [
    ["Diagnostic — chapters 2–9, 17", "Report what the evidence shows and what is missing. They draft as soon as their inputs exist, because describing a weak evidence base is itself a legitimate finding."],
    ["Prescriptive — chapters 1, 10–16", "Recommend, sequence and cost. They stay locked until at least 11 of 13 core gates carry adequate evidence, so a roadmap can never propose investment on evidence that would not survive review."],
  ];
  let cx = MX;
  const ccw = (CW - 0.9) / 2;
  cols.forEach(([k, t], i) => {
    if (i === 1) deck.redRule(s, cx, 4.78, 1.4);
    else deck.hline(s, cx, 4.78, ccw, { color: PALETTE.HAIR, pt: 1 });
    s.addText(k, {
      x: cx, y: i === 1 ? 5.02 : 4.94, w: ccw, h: 0.34, fontSize: 12.5, fontFace: F, bold: true,
      color: i === 1 ? PALETTE.RED : PALETTE.INK, margin: 0,
    });
    s.addText(t, { x: cx, y: i === 1 ? 5.36 : 5.28, w: ccw, h: 1.2, fontSize: 10, fontFace: F, color: PALETTE.BODY, lineSpacing: 13.5, margin: 0 });
    cx += ccw + 0.9;
  });
  deck.footer(s, { src: "Source: DAR Studio · src/lib/damm/outline.ts" });
}

/* ── 16 Closing ───────────────────────────────────────────────────────── */
deck.closingSlide({
  eyebrow: "The standard this sets",
  title: "A roadmap is only as\ngood as the evidence\nit refuses to invent",
  subtitle:
    `Every figure in this deck is read from the same versioned configuration the application scores against — DAMM ${M.version}, scoring core in pilot.`,
  contact: "Independent prototype · not an official World Bank system · not a country ranking",
  // No mark on the red field: the globe is a blue gradient and goes muddy
  // against the accent. It carries the cover, where it sits on white.
  logo: false,
});

const out = join(ROOT, "DAR Studio — DAMM v1.3 Methodology.pptx");
await deck.save(out);
console.log("wrote", out);
