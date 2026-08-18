/**
 * The roadmap as a consulting-grade deck.
 *
 * Slide CONTENT is shaped here as pure data (testable, deterministic — every
 * figure comes from the same payload the draft renders, so the deck cannot
 * say what the document does not). Slide RENDERING happens in the server
 * action with pptxgenjs. Style: action titles that state the takeaway as a
 * sentence; half-page density per slide; a flat, architectural look — thin
 * rules, kicker labels, the app's forest green as the single accent; no
 * images (also keeps pptxgenjs's image parser away from untrusted input).
 *
 * The engagement-package rule follows the deck: when no stage is claimable,
 * the deck says so on its own slide and never renders a stage as a result.
 */

import type { DraftPayload } from "./draft.ts";
import { formatPct, formatScore } from "./scoring.ts";
import { modelExplainer } from "./explainer.ts";
import { model as dammModel } from "./model.ts";

export interface DeckSlide {
  kind: "title" | "section" | "content" | "table" | "closing";
  /** Uppercase kicker above the title ("EVIDENCE", "DIAGNOSTIC", …). */
  kicker?: string;
  /** Action title: a sentence stating the takeaway, not a label. */
  title: string;
  bullets?: string[];
  /** Two-column support: rendered side by side when present. */
  rightBullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  /** Source line rendered at the foot of the slide. */
  source?: string;
  note?: string;
}

const MAX_BULLETS = 8;

function clip(s: string, n = 220): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/** The first sentences of a chapter's body, minus banners and headings — the chapter's own words as its takeaway. */
export function chapterTakeaway(body: string, maxChars = 320): string {
  const stripped = body
    .replace(/^CONDITIONS ON THIS CHAPTER[\s\S]*?\n\n/, "")
    .replace(/^[A-Z][A-Z .—-]{8,}$/gm, "")
    .replace(/^#+ .*$/gm, "")
    .trim();
  const para = stripped.split(/\n\n+/).find((p) => p.trim().length > 60) ?? stripped;
  return clip(para, maxChars);
}

export function buildDeckSlides(p: DraftPayload): DeckSlide[] {
  const s = p.scorecard;
  const slides: DeckSlide[] = [];
  const src = (label: string) => `${label} · DAR Studio, DAMM ${p.modelVersion} · generated ${p.generatedAt.slice(0, 10)}`;

  slides.push({
    kind: "title",
    kicker: "DIGITAL AGRICULTURE ROADMAP — FIRST DRAFT",
    title: p.countryName,
    bullets: [
      `Assessment year ${p.assessmentYear} · DAMM ${p.modelVersion}`,
      `Claimable statement: ${p.claim.display}`,
      "Machine-drafted for human review — not an official World Bank document",
    ],
  });

  // The deck opens the way the run and the document do: the model, explained.
  const explainer = modelExplainer(dammModel).split("\n\n");
  slides.push({
    kind: "content",
    kicker: "THE MODEL",
    title: "One maturity model runs the whole diagnostic — and this deck cannot drift from it",
    bullets: explainer.slice(1, 4).map((b) => clip(b, 260)),
    rightBullets: explainer.slice(4, 7).map((b) => clip(b, 260)),
    source: src("Model configuration (versioned)"),
  });

  slides.push({
    kind: "content",
    kicker: "EVIDENCE",
    title: evidenceHeadline(p),
    bullets: [
      `${s.levelledCount} of ${p.evidence.length} indicators carry a level; ${s.importedCount} imported from official statistics`,
      `${p.evidence.filter((e) => e.provenance === "machine-researched").length} machine-researched rubric proposals await validation`,
      `${s.namedGapCount} named gaps routed to stewards; ${s.dataGapCount} explicit data gaps; ${s.staleCount} stale readings`,
      `Core gates: ${s.gates.length - s.gates.filter((g) => g.unmeasured).length} measured of ${s.gates.length}; ${s.coreGateFailures} at Level 1`,
    ],
    rightBullets: (p.findings?.length || p.foresight?.length)
      ? [
          ...(p.findings?.length ? [`${p.findings.filter((f) => f.kind === "opportunistic").length} public-domain findings beyond the indicator frame (quote-verified)`] : []),
          ...(p.findings?.length ? [`${p.findings.filter((f) => f.kind === "practice").length} recent practices collected as comparators`] : []),
          ...(p.foresight?.length ? [`${p.foresight.length} strategic-foresight document${p.foresight.length === 1 ? "" : "s"} provided by the task team`] : []),
        ]
      : undefined,
    source: src("Evidence base, Annex A"),
  });

  slides.push({
    kind: "table",
    kicker: "READ-OUTS",
    title: p.claim.claimable
      ? `Validated read-outs: CMS ${formatScore(s.cms.score)}, EMS ${formatScore(s.ems.score)}, OES ${formatScore(s.oes.score)}`
      : "Three read-outs are computed but no maturity stage is claimable before validation",
    table: {
      headers: ["Read-out", "Score", "Band", "Coverage", "Status"],
      rows: [
        ["CMS — capability", formatScore(s.cms.score), s.cms.band ?? "Not rated", formatPct(s.cms.coverage), s.cms.suppressedReason ? clip(s.cms.suppressedReason, 60) : "Reported"],
        ["EMS — ecosystem", formatScore(s.ems.score), s.ems.band ?? "Not rated", formatPct(s.ems.coverage), s.ems.suppressedReason ? clip(s.ems.suppressedReason, 60) : "Reported"],
        ["OES — outcomes", formatScore(s.oes.score), s.oes.band ?? "Not rated", formatPct(s.oes.coverage), s.oes.suppressedReason ? clip(s.oes.suppressedReason, 60) : "Reported"],
      ],
    },
    note: `Engine cascade: ${s.stage.label}. ${p.claim.explanation}`,
    source: src("Scorecard"),
  });

  slides.push({
    kind: "table",
    kicker: "PILLARS",
    title: "Pillar coverage decides what may be scored — thin pillars stay honestly unrated",
    table: {
      headers: ["Pillar", "Score", "Band", "Coverage", "Levelled"],
      rows: s.pillars
        .filter((pl) => pl.aggregated)
        .map((pl) => [`${pl.id} ${pl.name}`, formatScore(pl.score), pl.band ?? "Not rated", formatPct(pl.coverage), `${pl.scored}/${pl.total}`]),
    },
    source: src("Scorecard"),
  });

  slides.push({
    kind: "table",
    kicker: "CORE GATES",
    title: coreGateHeadline(p),
    table: {
      headers: ["Gate", "Status", "Note"],
      rows: s.gates.map((g) => [
        `${g.id} ${g.name}`,
        g.unmeasured ? "Unmeasured" : `Level ${g.finalLevel}`,
        g.failed ? "Failing — caps the stage" : g.stale ? "Stale" : g.unmeasured ? "Suppresses the stage" : "—",
      ]),
    },
    source: src("Core gates, Annex A"),
  });

  slides.push({ kind: "section", kicker: "PART TWO", title: "The roadmap, chapter by chapter" });

  return slides;
}

function evidenceHeadline(p: DraftPayload): string {
  const s = p.scorecard;
  const pct = Math.round((s.levelledCount / Math.max(1, p.evidence.length)) * 100);
  if (pct >= 60) return `The machine populated ${pct}% of the register — review, not authoring, is the human task`;
  if (pct >= 35) return `${pct}% of the register is machine-populated; the health page ranks what to strengthen first`;
  return `Public evidence populates ${pct}% of the register so far — the named gaps are the work programme`;
}

function coreGateHeadline(p: DraftPayload): string {
  const s = p.scorecard;
  if (s.coreGateFailures > 0) return `${s.coreGateFailures} core gate${s.coreGateFailures === 1 ? "" : "s"} at Level 1 cap${s.coreGateFailures === 1 ? "s" : ""} any stage — prerequisites before trade-offs`;
  if (s.unmeasuredCoreGates > 0) return `${s.unmeasuredCoreGates} unmeasured core gate${s.unmeasuredCoreGates === 1 ? "" : "s"} suppress${s.unmeasuredCoreGates === 1 ? "es" : ""} the stage until evidence arrives`;
  return "All thirteen core gates are measured — the foundation for a claimable stage is in place";
}

/** One dense slide per drafted chapter: the chapter's own takeaway + its evidence anchors. */
export function slidesForChapters(
  p: DraftPayload,
  chapterBodies: Array<{ n: string; title: string; body: string }>,
): DeckSlide[] {
  const out: DeckSlide[] = [];
  const numbered = chapterBodies
    .filter((c) => /^\d+$/.test(c.n))
    .sort((a, b) => Number(a.n) - Number(b.n));
  for (const ch of numbered) {
    const conditional = /^CONDITIONS ON THIS CHAPTER/.test(ch.body);
    const bullets = ch.body
      .split("\n")
      .filter((l) => l.trim().startsWith("- "))
      .map((l) => clip(l.trim().slice(2), 180))
      .slice(0, MAX_BULLETS);
    out.push({
      kind: "content",
      kicker: `CHAPTER ${ch.n}${conditional ? " · CONDITIONAL" : ""}`,
      title: clip(`${ch.title}: ${chapterTakeaway(ch.body, 200)}`, 240),
      bullets: bullets.length ? bullets.slice(0, Math.ceil(bullets.length / 2)) : [chapterTakeaway(ch.body)],
      rightBullets: bullets.length > 1 ? bullets.slice(Math.ceil(bullets.length / 2)) : undefined,
      note: conditional ? "Recommendations in this chapter are conditional scenarios until the evidence readiness gate clears." : undefined,
      source: `Chapter ${ch.n} of the draft · every figure carries its citation in the document`,
    });
  }
  return out;
}

/** The closing slides: findings, practices, foresight, ladder, disclaimer. */
export function closingSlides(p: DraftPayload): DeckSlide[] {
  const slides: DeckSlide[] = [];
  const opportunistic = (p.findings ?? []).filter((f) => f.kind === "opportunistic");
  const practices = (p.findings ?? []).filter((f) => f.kind === "practice");

  if (opportunistic.length) {
    slides.push({
      kind: "content",
      kicker: "ECOSYSTEM",
      title: `${opportunistic.length} cited public-domain findings widen the picture beyond the indicator frame`,
      bullets: opportunistic.slice(0, 5).map((f) => clip(`${f.claim} (${f.publishedYear ?? "n.d."})`, 190)),
      rightBullets: opportunistic.slice(5, 10).map((f) => clip(`${f.claim} (${f.publishedYear ?? "n.d."})`, 190)),
      source: "Annex B — every finding carries a verbatim, checked quote and its URL",
    });
  }
  if (practices.length) {
    slides.push({
      kind: "content",
      kicker: "COMPARATORS",
      title: "Recent strategies elsewhere show what peers are committing to — comparators, not prescriptions",
      bullets: practices.slice(0, 6).map((f) => clip(`${f.claim} (${f.publishedYear ?? "n.d."})`, 200)),
      source: "Practice research — past-year window, any country or institution",
    });
  }
  if (p.foresight?.length) {
    slides.push({
      kind: "content",
      kicker: "FORESIGHT",
      title: "Task-team foresight material is cited alongside the evidence, never blended into it",
      bullets: p.foresight.map((u) => clip(`${u.filename} — ${u.excerpt}`, 220)),
      source: "User-provided strategic-foresight uploads",
    });
  }

  slides.push({
    kind: "table",
    kicker: "DECISIONS",
    title: p.decisions.length >= 7
      ? "All seven ladder decisions are recorded — the roadmap rests on named choices"
      : `${p.decisions.length} of 7 ladder decisions recorded — the rest are stated as assumptions in the text`,
    table: {
      headers: ["Step", "Decision", "Recorded"],
      rows: [2, 3, 4, 5, 6, 7, 8].map((step) => {
        const d = p.decisions.find((x) => x.step === step);
        return [`Step ${step}`, d ? clip(d.optionName, 70) : "—", d ? `${d.deciderName} (${d.role})` : "not yet"];
      }),
    },
    source: "Decision ladder, Steps 2–8",
  });

  slides.push({
    kind: "closing",
    kicker: "STATUS",
    title: p.claim.claimable ? `Claimable: ${p.claim.display}` : "No maturity stage is claimable before human validation",
    bullets: [
      "This deck is machine-assembled from the draft's evidence base and carries its citations by reference.",
      "Prescriptive content remains conditional until the evidence readiness gate clears.",
      "Not an official World Bank document. Not a country ranking. No DAMM score may serve as a PDO indicator, DLI or disbursement condition.",
    ],
  });

  return slides;
}

/* ---------- rendering (pptxgenjs; shapes and text only) ---------- */

const DECK_INK = "212B24";
const DECK_ACCENT = "1F5C3D";
const DECK_MUTED = "5A685E";
const DECK_LINE = "DCE1D8";
const DECK_PAPER = "FAF9F4";

/**
 * Render the shaped slides with pptxgenjs. Flat and architectural: hairline
 * rules, uppercase letterspaced kickers, a single green accent, action titles,
 * sources in the footer. Text and shapes only — no images, by design.
 */
export async function renderDeck(input: {
  slides: DeckSlide[];
  countryName: string;
}): Promise<string> {
  const { default: PptxGen } = await import("pptxgenjs");
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.author = "DAR Studio";
  pptx.title = `Digital Agriculture Roadmap — ${input.countryName}`;

  let pageNo = 0;
  for (const s of input.slides) {
    pageNo += 1;
    const slide = pptx.addSlide();
    slide.background = { color: s.kind === "section" || s.kind === "closing" ? DECK_ACCENT : DECK_PAPER };
    const dark = s.kind === "section" || s.kind === "closing";
    const ink = dark ? "FFFFFF" : DECK_INK;
    const sub = dark ? "CFE0D5" : DECK_MUTED;

    if (s.kicker) {
      slide.addText(s.kicker, {
        x: 0.6, y: 0.42, w: 12.1, h: 0.34,
        fontFace: "Arial", fontSize: 10.5, color: dark ? "9CC8AD" : DECK_ACCENT,
        charSpacing: 3, bold: true,
      });
    }
    slide.addText(s.title, {
      x: 0.6, y: s.kind === "title" ? 2.3 : 0.78, w: 12.1, h: s.kind === "title" ? 1.6 : 1.15,
      fontFace: "Arial", fontSize: s.kind === "title" ? 40 : s.kind === "section" ? 30 : 20,
      color: ink, bold: false, lineSpacingMultiple: 1.05,
    });
    if (!dark) {
      slide.addShape(pptx.ShapeType.line, { x: 0.6, y: s.kind === "title" ? 4.05 : 1.98, w: 12.1, h: 0, line: { color: DECK_LINE, width: 0.75 } });
    }

    const bodyTop = s.kind === "title" ? 4.35 : 2.25;
    const bullet = { code: "2022" } as const;
    if (s.table) {
      const rows = [
        s.table.headers.map((h) => ({
          text: h.toUpperCase(),
          options: { bold: true, color: DECK_MUTED, fontSize: 9.5, charSpacing: 1.5, fill: { color: "EFF3EC" } },
        })),
        ...s.table.rows.map((r) => r.map((c) => ({ text: c, options: { color: DECK_INK, fontSize: 11 } }))),
      ];
      slide.addTable(rows, {
        x: 0.6, y: bodyTop, w: 12.1,
        fontFace: "Arial", border: { type: "solid", color: DECK_LINE, pt: 0.5 },
        autoPage: false, rowH: 0.32, valign: "middle",
      });
    } else if (s.rightBullets?.length) {
      slide.addText((s.bullets ?? []).map((b) => ({ text: b, options: { bullet, breakLine: true, paraSpaceAfter: 8 } })), {
        x: 0.6, y: bodyTop, w: 5.9, h: 4.4, fontFace: "Arial", fontSize: 12.5, color: ink, valign: "top",
      });
      slide.addText(s.rightBullets.map((b) => ({ text: b, options: { bullet, breakLine: true, paraSpaceAfter: 8 } })), {
        x: 6.8, y: bodyTop, w: 5.9, h: 4.4, fontFace: "Arial", fontSize: 12.5, color: ink, valign: "top",
      });
    } else if (s.bullets?.length) {
      slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet, breakLine: true, paraSpaceAfter: 10 } })), {
        x: 0.6, y: bodyTop, w: 12.1, h: 4.4, fontFace: "Arial", fontSize: s.kind === "title" ? 14 : 13, color: ink, valign: "top",
      });
    }

    if (s.note) {
      slide.addText(s.note, { x: 0.6, y: 6.4, w: 12.1, h: 0.4, fontFace: "Arial", fontSize: 10.5, italic: true, color: sub });
    }
    if (s.source) {
      slide.addText(s.source, { x: 0.6, y: 6.95, w: 10.5, h: 0.3, fontFace: "Arial", fontSize: 8.5, color: sub });
    }
    slide.addText(String(pageNo), { x: 12.5, y: 6.95, w: 0.5, h: 0.3, fontFace: "Arial", fontSize: 8.5, color: sub, align: "right" });
  }

  const out = (await pptx.write({ outputType: "base64" })) as string;
  return out;
}
