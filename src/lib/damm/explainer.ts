/**
 * The model, explained — the first thing a run shows.
 *
 * A diagnostic that opens by collecting 97 indicators without saying what they
 * are, why they are structured this way, or what will be done with them reads
 * as a black box. This explainer is assembled from the versioned model
 * configuration itself — counts, weights, gates, bands and ladder are computed
 * from the same object the engine scores with, so the explanation can never
 * drift from the arithmetic. Deterministic; never sent to a model.
 */

import { model } from "./model.ts";
import type { DammModel } from "./types.ts";

export function modelExplainer(m: DammModel = model): string {
  const pillarIds = Object.keys(m.pillars);
  const aggregated = pillarIds.filter((id) => (m.pillars[id] as { aggregated?: boolean }).aggregated !== false);
  const indicatorCount = m.indicators.length;
  const gateIds = m.core_gates;
  const gates = gateIds
    .map((id) => m.indicators.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const rubricCount = m.indicators.filter((i) => i.method === "Anchored capability rubric").length;
  const quantCount = m.indicators.filter((i) => i.method === "Quantitative threshold").length;
  const bands = m.bands.map((b) => `${b.name} (${b.lo.toFixed(1)}–${b.hi.toFixed(1)})`).join(", ");

  const lines: string[] = [
    `THE MODEL THIS RUN EXECUTES — ${m.model} ${m.version}`,
    "",
    `The Digital Agriculture Maturity Model measures a country's readiness for digital agriculture through ${indicatorCount} indicators organised in ${pillarIds.length} pillars:`,
    "",
  ];
  for (const id of pillarIds) {
    const p = m.pillars[id] as { name: string; role: string; weight?: number; aggregated?: boolean };
    const count = m.indicators.filter((i) => i.pillar === id).length;
    lines.push(
      `- ${id} — ${p.name} (${count} indicators, ${p.role.toLowerCase()}${p.weight ? `, weight ${Math.round(p.weight * 100)}%` : ""}${p.aggregated === false ? ", never aggregated into a score" : ""})`,
    );
  }
  lines.push(
    "",
    `${quantCount} indicators are quantitative thresholds (a number places the country on a 1–5 level); ${rubricCount} are anchored capability rubrics (a written capability — a registry, a law, a coordination body — assessed clause-by-clause against anchor text per level); the remainder profile context and are reported without scoring.`,
    "",
    "HOW EVERY INDICATOR IS COLLECTED. Each collected reading carries four things or it does not enter the evidence base: the source it was taken from (a public URL), the observation year the source states, a credibility grade (A national/official exact and current, through E unusable — uncited readings are capped at E and never scored), and the maturity level the reading supports. What cannot be collected and verified becomes a named gap routed to a steward — never a guess.",
    "",
    `THE READ-OUTS. The model reports three scores on a 1–5 scale and refuses to average them together: CMS (government capability, the ${aggregated.filter((id) => id.startsWith("C") && id !== "C0").length} capability pillars weighted), EMS (the market ecosystem), and OES (outcomes and equity). A pillar below the coverage gate reports Not rated rather than pretending. Score bands: ${bands}.`,
    "",
    `THE CORE GATES. ${gateIds.length} indicators are prerequisites, not trade-offs — one at Level 1 caps the stage; one unmeasured suppresses it:`,
  );
  for (const g of gates) lines.push(`- ${g.id} ${g.name}`);
  lines.push(
    "",
    `THE DECISION LADDER. ${m.ladder.length} steps take the diagnostic to an adopted roadmap. Step 1 (this run) belongs to the machine; every later step is a recorded human decision — engagement, targeting, evidence plan, government mandate, validation, portfolio, adoption.`,
    "",
    "THE PROHIBITIONS, wired into the software:",
  );
  m.prohibitions.forEach((p, i) => lines.push(`${i + 1}. ${p}.`));
  lines.push(
    "",
    "What follows this explanation, in order: collection of every indicator from official statistical systems and verified web research; a wider public-domain sweep for country evidence outside the indicator structure; research into recent strategies and best practices; and assembly of the full roadmap draft with an evidence-health page first.",
  );
  return lines.join("\n");
}

/** One-line summary for the audit trail at run launch. */
export function explainerSummary(m: DammModel = model): string {
  return `${m.model} ${m.version}: ${m.indicators.length} indicators, ${Object.keys(m.pillars).length} pillars, ${m.core_gates.length} core gates, 3 read-outs (CMS/EMS/OES), ${m.ladder.length}-step ladder. Full explanation shown in the workspace and the draft.`;
}
