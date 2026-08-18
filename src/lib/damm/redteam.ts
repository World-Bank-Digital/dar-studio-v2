/**
 * Red-team QC over the assembled draft.
 *
 * The fidelity gate polices model prose at generation time; the red team
 * reviews the FINAL document the way a hostile quality reviewer would — after
 * assembly, across every chapter, deterministic checks first and an
 * adversarial model pass on top when a key is active.
 *
 * Two disciplines carried over from the rest of the app:
 *  - a red-team finding must exhibit its evidence: the excerpt is checked
 *    verbatim against the chapter text, and a finding whose exhibit cannot be
 *    located is dropped — a reviewer that fabricates quotations is worse than
 *    no reviewer;
 *  - findings inform the human editor. Nothing here edits the draft.
 */

import { model } from "./model.ts";
import { verifyQuote } from "./search.ts";
import { parseJsonArray } from "./websearch.ts";
import { isPrescriptive } from "./outline.ts";
import { mapLimit } from "../utils.ts";
import type { ChatInput, ChatResult } from "./providers.ts";

export type RedTeamSeverity = "high" | "medium" | "low";

export interface RedTeamFinding {
  chapter: string;
  category: string;
  severity: RedTeamSeverity;
  /** Verbatim exhibit from the chapter. */
  excerpt: string;
  note: string;
  source: "deterministic" | "model";
}

/** Chapters the scans apply to: the numbered body of the roadmap, not the model page, health page or annex record. */
export function reviewableChapters<T extends { n: string }>(chapters: T[]): T[] {
  return chapters.filter((c) => /^\d+$/.test(c.n));
}

/**
 * Remove the fidelity gate's own annotation before reviewing a chapter.
 *
 * When model prose fails the fidelity check the chapter carries a bracketed
 * note that QUOTES the offending phrases in order to report them — "…stage
 * assertions the evidence does not license: is Advanced, are Established".
 * That note is the safety machinery being honest about what it refused to
 * publish; it is not the document asserting anything. The first live red-team
 * run flagged five of these as unclaimable-stage claims (9% of its findings),
 * which is a guard misreading its sibling guard's audit trail — the L15 class,
 * where a false positive names a category the guard misunderstood.
 */
export function stripMachineryNotes(body: string): string {
  return body
    .replace(/\[Model prose for this chapter was rejected by the fidelity check[\s\S]*?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const COMPARISON_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /\b(?:ranks?|ranked|ranking)\b[^.]{0,80}\b(?:among|against|globally|regionally|countries)\b/i, note: "Cross-country ranking language — prohibited by the model." },
  { re: /\b(?:outperforms?|outpaces?|lags behind|ahead of|behind)\b[^.]{0,60}\b(?:countries|peers|neighbours|neighbors|region)\b/i, note: "Cross-country comparison — prohibited by the model." },
  { re: /\b(?:regional|global) leader\b/i, note: "Ranking claim — prohibited by the model." },
  { re: /\btop performer\b/i, note: "Ranking claim — prohibited by the model." },
];

/** Sentence containing the match, clipped — the exhibit must be locatable verbatim. */
function sentenceAround(body: string, index: number): string {
  const start = Math.max(body.lastIndexOf(".", index) + 1, body.lastIndexOf("\n", index) + 1, 0);
  const endDot = body.indexOf(".", index);
  const endNl = body.indexOf("\n", index);
  const end = Math.min(endDot < 0 ? body.length : endDot + 1, endNl < 0 ? body.length : endNl);
  return body.slice(start, end).trim().slice(0, 240);
}

export function checkComparisons(chapter: string, body: string): RedTeamFinding[] {
  const out: RedTeamFinding[] = [];
  for (const { re, note } of COMPARISON_PATTERNS) {
    const m = re.exec(body);
    if (m) {
      out.push({
        chapter,
        category: "prohibited-comparison",
        severity: "high",
        excerpt: sentenceAround(body, m.index),
        note,
        source: "deterministic",
      });
    }
  }
  return out;
}

/**
 * Band and stage words asserted as achieved while no stage is claimable.
 * "the country is Established" is a claim; "the Established band (2.6–3.4)"
 * is a definition — the assertion patterns require the copula.
 */
export function checkStageAssertions(chapter: string, body: string, claimable: boolean): RedTeamFinding[] {
  if (claimable) return [];
  const bands = model.bands.map((b) => b.name).join("|");
  const patterns = [
    new RegExp(`\\b(?:is|are|remains|has become)\\s+(?:an?\\s+)?(?:${bands})\\b`, "i"),
    /\bis at Stage \d\b/i,
    /\bhas (?:reached|achieved) Stage \d\b/i,
  ];
  const out: RedTeamFinding[] = [];
  for (const re of patterns) {
    const m = re.exec(body);
    if (m) {
      out.push({
        chapter,
        category: "unclaimable-stage",
        severity: "high",
        excerpt: sentenceAround(body, m.index),
        note: "Asserts a maturity band or stage while no stage is claimable (engagement-package rule).",
        source: "deterministic",
      });
    }
  }
  return out;
}

const OWNER_MARKERS = /\b(?:ministry|ministries|agency|authority|department|unit|owner|payer|financed|funded|budget|legal basis|delivery channel|counterpart|steward)\b/i;

/** Prescriptive sentences that direct action but name nobody to own or pay for it. */
export function checkOwnerlessRecommendations(chapter: string, body: string): RedTeamFinding[] {
  if (!isPrescriptive(chapter)) return [];
  const out: RedTeamFinding[] = [];
  for (const raw of body.split(/(?<=\.)\s+/)) {
    if (out.length >= 3) break;
    const s = raw.trim();
    if (s.length < 40 || s.startsWith("-")) continue;
    if (!/\b(?:should|must|needs to|is recommended)\b/i.test(s)) continue;
    if (OWNER_MARKERS.test(s)) continue;
    if (/\bhypothesis\b/i.test(s)) continue; // the sanctioned thin-evidence form
    out.push({
      chapter,
      category: "ownerless-recommendation",
      severity: "medium",
      excerpt: s.slice(0, 240),
      note: "A recommendation without an owner, payer, legal basis or delivery channel — name one or downgrade to a hypothesis.",
      source: "deterministic",
    });
  }
  return out;
}

export function deterministicRedTeam(
  chapters: Array<{ n: string; body: string }>,
  claimable: boolean,
): RedTeamFinding[] {
  const out: RedTeamFinding[] = [];
  for (const ch of reviewableChapters(chapters)) {
    const body = stripMachineryNotes(ch.body);
    out.push(...checkComparisons(ch.n, body));
    out.push(...checkStageAssertions(ch.n, body, claimable));
    out.push(...checkOwnerlessRecommendations(ch.n, body));
  }
  return out;
}

/* ---------- adversarial model pass ---------- */

export const RED_TEAM_SYSTEM =
  "You are a hostile quality reviewer for an international development institution, reviewing one chapter of a " +
  "machine-drafted Digital Agriculture Roadmap before it reaches a human editor. Find what would embarrass the " +
  "institution: internal contradictions, claims presented as established that the chapter's own evidence does not " +
  "carry, overreach beyond the cited material, and ambiguity that could mislead a decision-maker. You quote your " +
  "exhibits VERBATIM from the chapter — a fabricated or paraphrased exhibit invalidates the finding. Finding " +
  "nothing is an acceptable result; inventing a finding is not.";

export function buildRedTeamPrompt(input: { chapter: string; title: string; body: string }): string {
  return [
    `Review chapter ${input.chapter} — ${input.title}.`,
    "",
    "Return ONLY a JSON array (possibly empty) of at most 5 findings:",
    '[{ "category": "contradiction"|"unsupported-claim"|"overreach"|"ambiguity",',
    '   "severity": "high"|"medium"|"low",',
    '   "excerpt": string (a VERBATIM span of 8-25 consecutive words copied from the chapter),',
    '   "note": string (one sentence: what is wrong and what the editor should do) }]',
    "Rules:",
    "- The excerpt must be copied character-for-character from the chapter text below. It is checked; a finding whose excerpt is not found is discarded.",
    "- Judge only this chapter's internal consistency and its use of its own cited material. Do not import outside knowledge of the country.",
    "- A stated condition, hypothesis, named gap or conditional banner is the document working as designed — not a finding.",
    "",
    "Chapter text:",
    input.body.slice(0, 24_000),
  ].join("\n");
}

export function validateRedTeamFindings(
  raw: string,
  chapter: string,
  body: string,
): RedTeamFinding[] {
  const out: RedTeamFinding[] = [];
  for (const item of parseJsonArray(raw)) {
    if (out.length >= 5) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const category = String(r.category ?? "").trim();
    if (!["contradiction", "unsupported-claim", "overreach", "ambiguity"].includes(category)) continue;
    const severity = String(r.severity ?? "").trim() as RedTeamSeverity;
    if (!["high", "medium", "low"].includes(severity)) continue;
    const excerpt = String(r.excerpt ?? "").trim();
    const note = String(r.note ?? "").trim();
    if (!excerpt || note.length < 15) continue;
    // The reviewer exhibits its evidence or the finding does not exist.
    if (!verifyQuote(body, excerpt).ok) continue;
    out.push({ chapter, category, severity, excerpt: excerpt.slice(0, 300), note: note.slice(0, 300), source: "model" });
  }
  return out;
}

/** Run the adversarial pass over reviewable chapters with an injected chat. */
export async function modelRedTeam(
  chapters: Array<{ n: string; title: string; body: string }>,
  chat: (input: Pick<ChatInput, "system" | "user">) => Promise<ChatResult>,
): Promise<{ findings: RedTeamFinding[]; errors: string[] }> {
  const findings: RedTeamFinding[] = [];
  const errors: string[] = [];
  await mapLimit(reviewableChapters(chapters), 4, async (ch) => {
    // Contained per chapter — one bad call must not cost the other sixteen
    // reviews (the L20 lesson, applied here from the start).
    try {
      const body = stripMachineryNotes(ch.body);
      const res = await chat({
        system: RED_TEAM_SYSTEM,
        user: buildRedTeamPrompt({ chapter: ch.n, title: ch.title, body }),
      });
      if (res.error || !res.text) {
        errors.push(`${ch.n}: ${res.error ?? "no output"}`);
        return;
      }
      findings.push(...validateRedTeamFindings(res.text, ch.n, body));
    } catch (err) {
      errors.push(`${ch.n} crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { findings, errors };
}
