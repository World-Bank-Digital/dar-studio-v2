/**
 * CLI deck export: render the consulting-style roadmap deck for a workspace
 * straight from the database, using the SAME shaping and rendering modules
 * the in-app export uses (deck.ts). Useful for pulling a deck out of a QA
 * workspace or scripting deliverables.
 *
 *   node --env-file=.env scripts/export-deck.ts <countryId> [out.pptx]
 *
 * Reads evidence, the latest draft, findings and uploads; writes the .pptx.
 * Soft-deleted workspaces are allowed — a QA run's deck stays exportable.
 */
import { writeFileSync } from "node:fs";
import { getSql } from "../src/lib/db.ts";
import { model } from "../src/lib/damm/model.ts";
import { buildDeckSlides, slidesForChapters, closingSlides, renderDeck } from "../src/lib/damm/deck.ts";
import { scoreAssessment, claimableStage, finalLevel, suggestedLevel, isStale } from "../src/lib/damm/scoring.ts";
import { chapterReadiness } from "../src/lib/damm/ladder.ts";
import type { DraftPayload } from "../src/lib/damm/draft.ts";
import type { EvidenceRow, RecordedDecision } from "../src/lib/damm/types.ts";

const countryId = process.argv[2];
if (!countryId) {
  console.error("usage: node --env-file=.env scripts/export-deck.ts <countryId> [out.pptx]");
  process.exit(1);
}

const sql = await getSql();
const countries = await sql<{ id: string; name: string; iso3: string; user_id: string }>`
  select id, name, iso3, user_id from countries where id = ${countryId}`;
if (!countries.length) {
  console.error(`No workspace ${countryId}`);
  process.exit(1);
}
const c = countries[0];
const out = process.argv[3] ?? `DAR-${c.iso3}-roadmap-deck.pptx`;

const drafts = await sql<{ body: string }>`
  select body from drafts where country_id = ${c.id} and kind = ${"dar"} order by drafted_at desc limit 1`;
if (!drafts.length) {
  console.error("No assembled draft for this workspace — assemble one first.");
  process.exit(1);
}
const doc = JSON.parse(drafts[0].body) as { chapters: Array<{ n: string; title: string; body: string }> };

const evidenceRows = await sql<{
  indicator_id: string; value: number | null; observation_year: number | null; source_name: string | null;
  source_url: string | null; confidence: string | null; provenance: string | null; is_proxy: boolean;
  proxy_note: string | null; data_gap: boolean; gap_steward: string | null; suggested_level: number | null;
  assessor_level: number | null;
}>`select indicator_id, value, observation_year, source_name, source_url, confidence, provenance, is_proxy,
   proxy_note, data_gap, gap_steward, suggested_level, assessor_level from evidence where country_id = ${c.id}`;
const evidence: EvidenceRow[] = model.indicators.map((ind) => {
  const e = evidenceRows.find((r) => r.indicator_id === ind.id);
  return {
    indicatorId: ind.id,
    value: e?.value ?? null,
    observationYear: e?.observation_year ?? null,
    sourceName: e?.source_name ?? null,
    sourceUrl: e?.source_url ?? null,
    confidence: (e?.confidence ?? null) as EvidenceRow["confidence"],
    provenance: (e?.provenance ?? null) as EvidenceRow["provenance"],
    isProxy: e?.is_proxy ?? false,
    proxyNote: e?.proxy_note ?? null,
    dataGap: e?.data_gap ?? false,
    gapSteward: e?.gap_steward ?? null,
    gapSource: null,
    suggestedLevel: e?.suggested_level ?? null,
    assessorLevel: e?.assessor_level ?? null,
    assessorRole: null,
    assessorName: null,
    assessedAt: null,
    notes: null,
  };
});

const decisionRows = await sql<{ step: number; option_name: string; decider_name: string; role: string; created_at: string; notes: string | null; rejected: string | null }>`
  select step, option_name, decider_name, role, created_at, notes, rejected from decisions where country_id = ${c.id} order by step`;
const decisions: RecordedDecision[] = decisionRows.map((d) => ({
  step: d.step, optionName: d.option_name, deciderName: d.decider_name, role: d.role,
  createdAt: d.created_at, notes: d.notes, rejected: d.rejected,
}));

const findingRows = await sql<{ kind: string; claim: string; quote: string; source_name: string | null; source_url: string; published_year: number | null; credibility: string | null; pillar_hint: string | null }>`
  select kind, claim, quote, source_name, source_url, published_year, credibility, pillar_hint
  from findings where country_id = ${c.id} order by created_at desc limit 200`;
const uploadRows = await sql<{ filename: string; chars: number; content: string }>`
  select filename, chars, content from uploads where country_id = ${c.id} order by uploaded_at desc limit 10`;

const card = scoreAssessment(model, evidence);
const mandate = decisions.some((d) => d.step === 5);
const validation = decisions.some((d) => d.step === 6);
const payload: DraftPayload = {
  countryName: c.name,
  iso3: c.iso3,
  generatedAt: new Date().toISOString(),
  modelVersion: model.version,
  assessmentYear: model.assessment_year,
  currentStep: decisions.length ? Math.max(...decisions.map((d) => d.step)) : 1,
  mandateRecorded: mandate,
  validationRecorded: validation,
  scorecard: card,
  claim: claimableStage(card, { currentStep: decisions.length ? Math.max(...decisions.map((d) => d.step)) : 1, mandateRecorded: mandate, validationRecorded: validation }),
  chapters: chapterReadiness(model, decisions, true),
  decisions,
  evidence: model.indicators.map((ind) => {
    const e = evidence.find((r) => r.indicatorId === ind.id)!;
    const suggested = e.suggestedLevel ?? suggestedLevel(ind, e.value);
    const final = finalLevel({ dataGap: e.dataGap, assessorLevel: e.assessorLevel, suggestedLevel: suggested });
    return {
      id: ind.id, name: ind.name, pillar: ind.pillar, role: ind.role,
      value: e.value, year: e.observationYear, source: e.sourceName, sourceUrl: e.sourceUrl,
      confidence: e.confidence, provenance: e.provenance, proxy: e.isProxy, proxyNote: e.proxyNote,
      dataGap: e.dataGap, gapSteward: e.gapSteward, suggested, assessor: e.assessorLevel, final,
      stale: isStale(ind, e, model.assessment_year, final), gate: ind.gate,
    };
  }),
  targeting: null,
  gauntletPassed: undefined,
  gauntletSummary: undefined,
  findings: findingRows.map((f) => ({
    kind: f.kind === "practice" ? ("practice" as const) : ("opportunistic" as const),
    claim: f.claim, quote: f.quote, sourceName: f.source_name, sourceUrl: f.source_url,
    publishedYear: f.published_year, credibility: f.credibility, pillarHint: f.pillar_hint,
  })),
  foresight: uploadRows.map((u) => ({ filename: u.filename, chars: u.chars, excerpt: u.content.slice(0, 1200) })),
};

const slides = [...buildDeckSlides(payload), ...slidesForChapters(payload, doc.chapters), ...closingSlides(payload)];
const base64 = await renderDeck({ slides, countryName: c.name });
writeFileSync(out, Buffer.from(base64, "base64"));
console.log(`${out}: ${slides.length} slides, ${Buffer.from(base64, "base64").length.toLocaleString()} bytes`);
process.exit(0);
