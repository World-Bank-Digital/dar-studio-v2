import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { uid, fingerprint } from "@/lib/utils";
import { model, disclaimer } from "./model";
import { claimableStage, finalLevel, formatScore, isStale, scoreAssessment, suggestedLevel } from "./scoring";
import { chapterReadiness, currentOpenStep, canRecordStep } from "./ladder";
import { assembleDeterministicDraft, draftSystemPrompt, payloadForPrompt, type DraftPayload } from "./draft";
import { assembleMemo } from "./memo";
import { ingestIndicator, ingestQueue, webSearchableIndicators } from "./ingest";
import { economyByName, fetchEconomies, type Economy } from "./countries";
import { citationError, nextProvenance } from "./citation";
import { credibilityFor } from "./credibility";
import { evaluateGauntlet, POLICY_CHAPTERS, type GauntletResult } from "./gauntlet";
import { groupByPillar, searchPublicReadings } from "./websearch";
import { sourceFor } from "./sources";
import { regressionRows } from "./fixture";
import type { Confidence, EvidenceRow, RecordedDecision, Scorecard } from "./types";
import {
  DOSSIER_CANNOT_WRITE_EVIDENCE,
  chunkTopics,
  dossierTopics,
  searchDossierBatch,
  toDossierItem,
  type DossierItem,
} from "./dossier";

export type { Economy };

type EvidenceDb = {
  indicator_id: string;
  value: number | null;
  observation_year: number | null;
  source_name: string | null;
  source_url: string | null;
  confidence: string | null;
  provenance: string | null;
  is_proxy: boolean;
  proxy_note: string | null;
  data_gap: boolean;
  gap_steward: string | null;
  gap_source: string | null;
  suggested_level: number | null;
  assessor_level: number | null;
  assessor_role: string | null;
  assessor_name: string | null;
  assessed_at: string | null;
  notes: string | null;
};

type DecisionDb = {
  step: number;
  option_name: string;
  decider_name: string;
  role: string;
  notes: string | null;
  rejected: string | null;
  payload: string | null;
  created_at: string;
};

function toRow(r: EvidenceDb): EvidenceRow {
  return {
    indicatorId: r.indicator_id,
    value: r.value,
    observationYear: r.observation_year,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    confidence: (r.confidence as EvidenceRow["confidence"]) ?? null,
    provenance: (r.provenance as EvidenceRow["provenance"]) ?? null,
    isProxy: Boolean(r.is_proxy),
    proxyNote: r.proxy_note,
    dataGap: Boolean(r.data_gap),
    gapSteward: r.gap_steward,
    gapSource: r.gap_source,
    suggestedLevel: r.suggested_level,
    assessorLevel: r.assessor_level,
    assessorRole: r.assessor_role,
    assessorName: r.assessor_name,
    assessedAt: r.assessed_at,
    notes: r.notes,
  };
}

function toDecision(d: DecisionDb): RecordedDecision {
  return {
    step: d.step,
    optionName: d.option_name,
    deciderName: d.decider_name,
    role: d.role,
    notes: d.notes,
    rejected: d.rejected,
    createdAt: d.created_at,
    payload: d.payload ? (JSON.parse(d.payload) as { chains?: string[]; rejected?: string[] }) : null,
  };
}

async function writeAudit(
  userId: string,
  countryId: string | null,
  role: string,
  actorName: string,
  action: string,
  detail: string,
) {
  const sql = await getSql();
  await sql`insert into audit (id, user_id, country_id, role, actor_name, action, detail)
    values (${uid()}, ${userId}, ${countryId}, ${role}, ${actorName}, ${action}, ${detail})`;
}

async function persistScore(countryId: string, card: Scorecard) {
  const sql = await getSql();
  await sql`update countries set
    cms = ${card.cms.score},
    ems = ${card.ems.score},
    oes = ${card.oes.score},
    cms_coverage = ${card.cms.coverage},
    ems_coverage = ${card.ems.coverage},
    oes_coverage = ${card.oes.coverage},
    stage_code = ${card.stage.code},
    stage_label = ${card.stage.label},
    levelled_count = ${card.levelledCount},
    imported_count = ${card.importedCount},
    named_gap_count = ${card.namedGapCount},
    stale_count = ${card.staleCount},
    validated_count = ${card.validatedCount},
    core_unmeasured = ${card.unmeasuredCoreGates},
    core_failures = ${card.coreGateFailures},
    updated_at = now()
    where id = ${countryId}`;
}

async function loadEvidence(countryId: string): Promise<EvidenceRow[]> {
  const sql = await getSql();
  const rows = await sql<EvidenceDb>`select * from evidence where country_id = ${countryId}`;
  return rows.map(toRow);
}

async function loadDecisions(countryId: string): Promise<RecordedDecision[]> {
  const sql = await getSql();
  const rows = await sql<DecisionDb>`
    select step, option_name, decider_name, role, notes, rejected, payload, created_at
    from decisions where country_id = ${countryId} order by step`;
  return rows.map(toDecision);
}

async function loadDossier(countryId: string): Promise<DossierItem[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    title: string;
    summary: string;
    year: number | null;
    source_name: string;
    source_url: string;
    host: string | null;
    source_class: string;
    informs: string;
    related_indicator: string | null;
    score: number;
    grade: string;
    quote: string | null;
    collected_at: string;
  }>`select id, title, summary, year, source_name, source_url, host, source_class, informs,
      related_indicator, score, grade, quote, collected_at
    from dossier where country_id = ${countryId} order by score desc, collected_at desc`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    year: r.year,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    host: r.host ?? "",
    sourceClass: r.source_class as DossierItem["sourceClass"],
    informs: r.informs as DossierItem["informs"],
    relatedIndicator: r.related_indicator,
    score: r.score,
    grade: r.grade as DossierItem["grade"],
    quote: r.quote,
    collectedAt: r.collected_at,
  }));
}

export type CountrySummary = {
  id: string;
  name: string;
  iso3: string;
  currentStep: number;
  step1Done: boolean;
  ingestStatus: string;
  ingestProgress: number;
  ingestTotal: number;
  ingestMessage: string | null;
  cms: number | null;
  ems: number | null;
  oes: number | null;
  stageLabel: string | null;
  levelledCount: number;
  namedGapCount: number;
  staleCount: number;
  coreUnmeasured: number;
  coreFailures: number;
  createdAt: string;
  updatedAt: string;
};

export type DossierJob = {
  status: "idle" | "running" | "done" | "error";
  message: string;
  added: number;
  total: number;
};

const dossierJobs = new Map<string, DossierJob>();
const dossierLocks = new Set<string>();

function dossierJobFor(countryId: string): DossierJob {
  return dossierJobs.get(countryId) ?? { status: "idle", message: "", added: 0, total: 0 };
}

export type Workspace = {
  id: string;
  name: string;
  iso3: string;
  currentStep: number;
  step1Done: boolean;
  ingestStatus: string;
  ingestProgress: number;
  ingestTotal: number;
  ingestMessage: string | null;
  scorecard: Scorecard;
  claim: ReturnType<typeof claimableStage>;
  evidence: EvidenceRow[];
  decisions: RecordedDecision[];
  chapters: ReturnType<typeof chapterReadiness>;
  targeting: { chains: string[]; rejected: string[]; notes: string | null } | null;
  openStep: number;
  gauntlet: GauntletResult;
  dossier: DossierItem[];
  dossierJob: DossierJob;
};

async function loadWorkspaceFor(
  userId: string,
  id: string,
): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: string }> {
  const sql = await getSql();
  const countries = await sql<{
    id: string;
    name: string;
    iso3: string;
    current_step: number;
    step1_completed_at: string | null;
    ingest_status: string;
    ingest_progress: number;
    ingest_total: number;
    ingest_message: string | null;
  }>`select id, name, iso3, current_step, step1_completed_at, ingest_status, ingest_progress, ingest_total, ingest_message
    from countries where id = ${id} and user_id = ${userId} and deleted_at is null`;
  const c = countries[0];
  if (!c) return { ok: false, error: "Not found" };
  const evidence = await loadEvidence(c.id);
  const decisions = await loadDecisions(c.id);
  const scorecard = scoreAssessment(model, evidence);
  const mandateRecorded = decisions.some((d) => d.step === 5);
  const validationRecorded = decisions.some((d) => d.step === 6);
  const step1Done = Boolean(c.step1_completed_at);
  const gauntlet = evaluateGauntlet(evidence, c.iso3);
  const targetingRows = await sql<{ chains: string | null; rejected: string | null; notes: string | null }>`
    select chains, rejected, notes from targeting where country_id = ${c.id}`;
  const t = targetingRows[0];
  const workspace: Workspace = {
    id: c.id,
    name: c.name,
    iso3: c.iso3,
    currentStep: currentOpenStep(decisions, step1Done),
    step1Done,
    ingestStatus: c.ingest_status,
    ingestProgress: c.ingest_progress,
    ingestTotal: c.ingest_total,
    ingestMessage: c.ingest_message,
    scorecard,
    claim: claimableStage(scorecard, {
      currentStep: currentOpenStep(decisions, step1Done),
      mandateRecorded,
      validationRecorded,
      gauntletPassed: gauntlet.passed,
    }),
    evidence,
    decisions,
    chapters: chapterReadiness(model, decisions, step1Done).map((ch) => {
      if (!POLICY_CHAPTERS.has(ch.n) || gauntlet.passed) return ch;
      return {
        ...ch,
        status: "inputs_forming" as const,
        blockers: [...ch.blockers, "Evidence gauntlet has not passed — policy chapters stay locked."],
      };
    }),
    targeting: t
      ? {
          chains: t.chains ? (JSON.parse(t.chains) as string[]) : [],
          rejected: t.rejected ? (JSON.parse(t.rejected) as string[]) : [],
          notes: t.notes,
        }
      : null,
    openStep: currentOpenStep(decisions, step1Done),
    gauntlet,
    dossier: await loadDossier(c.id),
    dossierJob: dossierJobFor(c.id),
  };
  if (c.ingest_status === "running" && !ingestLocks.has(c.id)) {
    kickIngest(c.id, userId, c.iso3, { role: "TTL", name: "system" });
  }
  return { ok: true, workspace };
}

export const getModelPublic = createServerFn({ method: "GET" }).handler(async () => {
  return {
    version: model.version,
    status: model.status,
    prohibitions: model.prohibitions,
    pillars: model.pillars,
    coverage: model.coverage_gates,
    bands: model.bands,
    stage: model.stage_thresholds,
    assessmentYear: model.assessment_year,
    indicatorCount: model.indicators.length,
    coreGates: model.core_gates,
    ladder: model.ladder,
    roles: model.roles,
    darOutline: model.dar_outline,
    methodology: model.methodology,
    glossary: model.glossary,
    disclaimer: disclaimer(),
    indicators: model.indicators,
  };
});

export const listEconomies = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => fetchEconomies());

export const listCountries = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: Record<string, never>) => input)
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      name: string;
      iso3: string;
      current_step: number;
      step1_completed_at: string | null;
      ingest_status: string;
      ingest_progress: number;
      ingest_total: number;
      ingest_message: string | null;
      cms: number | null;
      ems: number | null;
      oes: number | null;
      stage_label: string | null;
      levelled_count: number;
      named_gap_count: number;
      stale_count: number;
      core_unmeasured: number;
      core_failures: number;
      created_at: string;
      updated_at: string;
    }>`select id, name, iso3, current_step, step1_completed_at, ingest_status, ingest_progress,
      ingest_total, ingest_message, cms, ems, oes, stage_label, levelled_count, named_gap_count,
      stale_count, core_unmeasured, core_failures, created_at, updated_at
      from countries where user_id = ${context.userId} and deleted_at is null
      order by updated_at desc`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      iso3: r.iso3,
      currentStep: r.current_step,
      step1Done: Boolean(r.step1_completed_at),
      ingestStatus: r.ingest_status,
      ingestProgress: r.ingest_progress,
      ingestTotal: r.ingest_total,
      ingestMessage: r.ingest_message,
      cms: r.cms,
      ems: r.ems,
      oes: r.oes,
      stageLabel: r.stage_label,
      levelledCount: r.levelled_count,
      namedGapCount: r.named_gap_count,
      staleCount: r.stale_count,
      coreUnmeasured: r.core_unmeasured,
      coreFailures: r.core_failures,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })) satisfies CountrySummary[];
  });

async function seedEvidenceRows(userId: string, countryId: string, iso3: string, actor: { role: string; name: string }) {
  const sql = await getSql();
  const queue = ingestQueue();
  for (const spec of queue) {
    const gap = spec.kind === "named-gap";
    await sql`insert into evidence (
      id, user_id, country_id, indicator_id, provenance, gap_steward, gap_source, source_name, source_url, is_proxy, proxy_note
    ) values (
      ${uid()}, ${userId}, ${countryId}, ${spec.indicatorId},
      ${gap ? "named-gap" : null},
      ${gap ? spec.steward : null},
      ${gap ? spec.sourceName : null},
      ${spec.sourceName},
      ${spec.sourceUrl ?? null},
      ${Boolean(spec.isProxy)},
      ${spec.proxyNote ?? null}
    )`;
  }
  await sql`update countries set ingest_status = 'idle', ingest_progress = 0,
    ingest_total = ${queue.filter((s) => s.kind !== "named-gap").length}, ingest_message = ${"Ready. The TTL launches the Step 1 diagnostic."}
    where id = ${countryId}`;
  await writeAudit(userId, countryId, actor.role, actor.name, "create_country", `Opened ${iso3}. Diagnostic not yet launched.`);
}

export const createCountry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const eco = economyByName(await fetchEconomies(), data.name);
    if (!eco) return { ok: false as const, error: "Choose a country from the World Bank economy list." };
    const sql = await getSql();
    const id = uid();
    await sql`insert into countries (id, user_id, name, iso3) values (${id}, ${context.userId}, ${eco.name}, ${eco.iso3})`;
    await seedEvidenceRows(context.userId, id, eco.iso3, { role: data.role, name: data.actorName });
    return { ok: true as const, id, name: eco.name, iso3: eco.iso3 };
  });

const ingestLocks = new Set<string>();

async function completeStep1(countryId: string, userId: string, actor: { role: string; name: string }) {
  const sql = await getSql();
  const rows = await loadEvidence(countryId);
  await persistScore(countryId, scoreAssessment(model, rows));
  await sql`update countries set ingest_status = 'done', ingest_message = ${"Automated diagnostic complete. The machine hands over."},
    step1_completed_at = coalesce(step1_completed_at, now()), current_step = greatest(current_step, 2)
    where id = ${countryId}`;
  await writeAudit(userId, countryId, actor.role, actor.name, "step1_complete", "Machine handed over");
}

async function persistIngestResult(
  userId: string,
  rowId: string,
  spec: ReturnType<typeof ingestQueue>[number],
  result: Awaited<ReturnType<typeof ingestIndicator>>,
) {
  const sql = await getSql();
  await sql`update evidence set
    value = ${result.value ?? null},
    observation_year = ${result.observationYear ?? null},
    source_name = ${result.sourceName ?? spec.sourceName},
    source_url = ${result.sourceUrl ?? spec.sourceUrl ?? null},
    confidence = ${result.confidence ?? null},
    provenance = ${result.provenance ?? "named-gap"},
    is_proxy = ${result.isProxy ?? false},
    proxy_note = ${result.proxyNote ?? null},
    gap_steward = ${result.gapSteward ?? spec.steward},
    gap_source = ${result.gapSource ?? spec.sourceName},
    suggested_level = ${result.suggestedLevel ?? null},
    notes = ${result.notes ?? null}
    where id = ${rowId} and user_id = ${userId}`;
}

async function resolveSearchKey(userId: string): Promise<string | null> {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  const sql = await getSql();
  const keys = await sql<{ key_value: string }>`
    select key_value from api_keys where user_id = ${userId} and provider = ${"xai"} limit 1`;
  return keys[0]?.key_value ?? null;
}

async function persistWebReading(
  userId: string,
  countryId: string,
  reading: {
    id: string;
    value: number;
    year: number;
    sourceName: string;
    sourceUrl: string;
    quote: string | null;
    isProxy: boolean;
    proxyNote: string | null;
  },
) {
  const sql = await getSql();
  const spec = sourceFor(reading.id);
  const ind = model.indicators.find((i) => i.id === reading.id);
  if (!ind) return;
  const suggested = suggestedLevel(ind, reading.value);
  await sql`update evidence set
    value = ${reading.value},
    observation_year = ${reading.year},
    source_name = ${reading.sourceName},
    source_url = ${reading.sourceUrl},
    confidence = ${"Medium"},
    provenance = ${"machine-imported"},
    is_proxy = ${reading.isProxy},
    proxy_note = ${reading.proxyNote},
    suggested_level = ${suggested},
    notes = ${reading.quote}
    where country_id = ${countryId} and indicator_id = ${reading.id} and user_id = ${userId}
      and assessor_level is null and data_gap = false
      and (value is null or provenance is distinct from 'machine-imported' or ${reading.isProxy} = false)`;
  void spec;
}

async function runWebSearchPass(
  countryId: string,
  userId: string,
  iso3: string,
  countryName: string,
  _actor: { role: string; name: string },
) {
  const key = await resolveSearchKey(userId);
  if (!key) return;
  const sql = await getSql();
  const open = await sql<{ indicator_id: string }>`
    select indicator_id from evidence
    where country_id = ${countryId} and value is null and assessor_level is null and data_gap = false`;
  const openIds = new Set(open.map((r) => r.indicator_id));
  const candidates = webSearchableIndicators().filter((i) => openIds.has(i.id));
  if (!candidates.length) return;
  const grouped = groupByPillar(candidates);
  let done = 0;
  for (const [, inds] of grouped) {
    if (done >= 4) break;
    done += 1;
    const batch = inds.slice(0, 8).map((i) => {
      const spec = sourceFor(i.id);
      return { id: i.id, name: i.name, anchors: i.anchors, preferredSource: spec?.sourceName, gapNote: spec?.gapNote };
    });
    const { readings } = await searchPublicReadings({
      apiKey: key,
      countryName,
      iso3,
      assessmentYear: model.assessment_year,
      indicators: batch,
    });
    for (const reading of readings) {
      await persistWebReading(userId, countryId, reading);
    }
  }
}

async function runCountryIngest(countryId: string, userId: string, iso3: string, actor: { role: string; name: string }) {
  if (ingestLocks.has(countryId)) return;
  ingestLocks.add(countryId);
  try {
    const sql = await getSql();
    const queue = ingestQueue();
    const countries = await sql<{ name: string }>`select name from countries where id = ${countryId}`;
    const countryName = countries[0]?.name ?? iso3;
    while (true) {
      const p = (
        await sql<{ id: string; indicator_id: string }>`
        select id, indicator_id from evidence
        where country_id = ${countryId} and provenance is distinct from 'named-gap'
          and value is null and assessor_level is null and data_gap = false
        order by indicator_id
        limit 1`
      )[0];
      if (!p) break;
      const spec = queue.find((s) => s.indicatorId === p.indicator_id);
      if (!spec || spec.kind === "named-gap") {
        await sql`update evidence set provenance = ${"named-gap"} where id = ${p.id}`;
        continue;
      }
      const result = await ingestIndicator(iso3, spec);
      await persistIngestResult(userId, p.id, spec, result);
      const progressRows = await sql<{ ingest_progress: number }>`select ingest_progress from countries where id = ${countryId}`;
      await sql`update countries set ingest_progress = ${(progressRows[0]?.ingest_progress ?? 0) + 1}, ingest_message = ${`${p.indicator_id}: ${result.message}`}
        where id = ${countryId}`;
    }
    await runWebSearchPass(countryId, userId, iso3, countryName, actor);
    await completeStep1(countryId, userId, actor);
  } catch (err) {
    const sql = await getSql();
    const msg = err instanceof Error ? err.message : "Ingest failed";
    await sql`update countries set ingest_status = 'error', ingest_message = ${msg} where id = ${countryId}`;
    await writeAudit(userId, countryId, actor.role, actor.name, "ingest_error", msg);
  } finally {
    ingestLocks.delete(countryId);
  }
}

function kickIngest(countryId: string, userId: string, iso3: string, actor: { role: string; name: string }) {
  void runCountryIngest(countryId, userId, iso3, actor);
}

export const launchDiagnostic = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const countries = await sql<{
      id: string;
      iso3: string;
      ingest_status: string;
      step1_completed_at: string | null;
    }>`select id, iso3, ingest_status, step1_completed_at from countries
      where id = ${data.countryId} and user_id = ${context.userId} and deleted_at is null`;
    const c = countries[0];
    if (!c) return { ok: false as const, error: "Country not found" };
    if (c.step1_completed_at && c.ingest_status === "done") return { ok: true as const, alreadyDone: true };
    const total = ingestQueue().filter((s) => s.kind !== "named-gap").length;
    await sql`update countries set ingest_status = 'running', ingest_progress = 0, ingest_total = ${total},
      ingest_message = ${"TTL launched Step 1. Collecting verified public series…"}
      where id = ${data.countryId}`;
    await writeAudit(
      context.userId,
      data.countryId,
      data.role,
      data.actorName,
      "launch_diagnostic",
      `TTL launched the Step 1 diagnostic for ${c.iso3}`,
    );
    kickIngest(data.countryId, context.userId, c.iso3, { role: data.role, name: data.actorName });
    return { ok: true as const, alreadyDone: false };
  });

export const refreshPublicEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const countries = await sql<{ id: string; iso3: string }>`
      select id, iso3 from countries where id = ${data.countryId} and user_id = ${context.userId} and deleted_at is null`;
    const c = countries[0];
    if (!c) return { ok: false as const, error: "Country not found" };
    await sql`update evidence set
      value = null, observation_year = null, suggested_level = null, provenance = null
      where country_id = ${data.countryId} and user_id = ${context.userId}
        and assessor_level is null and data_gap = false
        and provenance is distinct from 'named-gap'`;
    const total = ingestQueue().filter((s) => s.kind !== "named-gap").length;
    await sql`update countries set ingest_status = 'running', ingest_progress = 0, ingest_total = ${total},
      ingest_message = ${"Refreshing public series…"}, step1_completed_at = null
      where id = ${data.countryId}`;
    await writeAudit(context.userId, data.countryId, data.role, data.actorName, "refresh_public", `TTL refreshed public series for ${c.iso3}`);
    kickIngest(data.countryId, context.userId, c.iso3, { role: data.role, name: data.actorName });
    return { ok: true as const };
  });

export const loadDemoPack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = uid();
    await sql`insert into countries (id, user_id, name, iso3, ingest_status, ingest_progress, ingest_total, ingest_message, step1_completed_at, current_step)
      values (${id}, ${context.userId}, ${"Bhutan"}, ${"BTN"}, ${"done"}, ${0}, ${0}, ${"Demonstration pack loaded — public fetch skipped."}, now(), ${2})`;
    const rows = regressionRows(model);
    for (const r of rows) {
      await sql`insert into evidence (
        id, user_id, country_id, indicator_id, value, observation_year, source_name, source_url,
        confidence, provenance, is_proxy, proxy_note, data_gap, gap_steward, gap_source,
        suggested_level, assessor_level, assessor_role, assessor_name, assessed_at, notes
      ) values (
        ${uid()}, ${context.userId}, ${id}, ${r.indicatorId}, ${r.value}, ${r.observationYear},
        ${r.sourceName}, ${r.sourceUrl}, ${r.confidence}, ${r.provenance}, ${r.isProxy}, ${r.proxyNote},
        ${r.dataGap}, ${r.gapSteward}, ${r.gapSource}, ${r.suggestedLevel}, ${r.assessorLevel},
        ${r.assessorRole}, ${r.assessorName}, ${r.assessedAt}, ${r.notes}
      )`;
    }
    await persistScore(id, scoreAssessment(model, rows));
    await writeAudit(context.userId, id, data.role, data.actorName, "load_demo", "Loaded Bhutan demonstration pack");
    return { ok: true as const, id };
  });

export const deleteCountry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`update countries set deleted_at = now() where id = ${data.id} and user_id = ${context.userId}`;
    await writeAudit(context.userId, data.id, data.role, data.actorName, "delete_country", "Country removed from portfolio");
    return { ok: true as const } as { ok: true } | { ok: false; error: string };
  });

export const ingestTick = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const countries = await sql<{
      id: string;
      iso3: string;
      ingest_status: string;
      ingest_progress: number;
      ingest_total: number;
    }>`select id, iso3, ingest_status, ingest_progress, ingest_total from countries
      where id = ${data.countryId} and user_id = ${context.userId} and deleted_at is null`;
    const c = countries[0];
    if (!c) return { ok: false as const, error: "Country not found", done: true };
    if (c.ingest_status === "done") return { ok: true as const, done: true, progress: c.ingest_progress, total: c.ingest_total };
    if (c.ingest_status !== "running") return { ok: true as const, done: false, progress: c.ingest_progress, total: c.ingest_total };
    if (ingestLocks.has(data.countryId)) {
      return { ok: true as const, done: false, progress: c.ingest_progress, total: c.ingest_total };
    }
    kickIngest(data.countryId, context.userId, c.iso3, { role: data.role, name: data.actorName });
    return { ok: true as const, done: false, progress: c.ingest_progress, total: c.ingest_total };
  });

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => loadWorkspaceFor(context.userId, data.id));

export const runDossierSearch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    if (!DOSSIER_CANNOT_WRITE_EVIDENCE) {
      return { ok: false as const, error: "Dossier persist misconfigured", added: 0 };
    }
    const ws = await loadWorkspaceFor(context.userId, data.countryId);
    if (!ws.ok) return { ok: false as const, error: ws.error, added: 0 };
    const key = await resolveSearchKey(context.userId);
    if (!key) {
      return { ok: false as const, error: "Add an xAI key in Settings before running the country dossier.", added: 0 };
    }
    if (dossierLocks.has(data.countryId)) {
      return { ok: true as const, added: dossierJobFor(data.countryId).added, started: true as const };
    }
    kickDossier(data.countryId, context.userId, key, ws.workspace, data.role, data.actorName);
    return { ok: true as const, added: 0, started: true as const };
  });

async function persistDossierHit(
  userId: string,
  countryId: string,
  countryName: string,
  hit: Parameters<typeof toDossierItem>[0],
) {
  const item = toDossierItem(hit, countryName, model.assessment_year, uid());
  if (item.score < 30) return false;
  const sql = await getSql();
  await sql`insert into dossier (
      id, user_id, country_id, title, summary, year, source_name, source_url, host,
      source_class, informs, related_indicator, score, grade, quote
    ) values (
      ${item.id}, ${userId}, ${countryId}, ${item.title}, ${item.summary}, ${item.year},
      ${item.sourceName}, ${item.sourceUrl}, ${item.host}, ${item.sourceClass}, ${item.informs},
      ${item.relatedIndicator}, ${item.score}, ${item.grade}, ${item.quote}
    )
    on conflict (country_id, source_url) do update set
      title = excluded.title,
      summary = excluded.summary,
      year = excluded.year,
      source_name = excluded.source_name,
      host = excluded.host,
      source_class = excluded.source_class,
      informs = excluded.informs,
      related_indicator = excluded.related_indicator,
      score = excluded.score,
      grade = excluded.grade,
      quote = excluded.quote,
      collected_at = now()`;
  return true;
}

async function runDossierJob(
  countryId: string,
  userId: string,
  apiKey: string,
  workspace: Workspace,
  role: string,
  actorName: string,
) {
  if (dossierLocks.has(countryId)) return;
  dossierLocks.add(countryId);
  const topics = dossierTopics(workspace.name, workspace.iso3, workspace.targeting?.chains ?? []);
  const batches = chunkTopics(topics, 3);
  dossierJobs.set(countryId, { status: "running", message: `Searching 1 of ${batches.length}…`, added: 0, total: batches.length });
  const before = await loadEvidence(countryId);
  let added = 0;
  try {
    let i = 0;
    for (const batch of batches) {
      i += 1;
      dossierJobs.set(countryId, {
        status: "running",
        message: `Searching public sources ${i} of ${batches.length}…`,
        added,
        total: batches.length,
      });
      const part = await searchDossierBatch({
        apiKey,
        countryName: workspace.name,
        iso3: workspace.iso3,
        assessmentYear: model.assessment_year,
        topics: batch,
      });
      for (const hit of part.hits) {
        if (await persistDossierHit(userId, countryId, workspace.name, hit)) added += 1;
      }
    }
    const after = await loadEvidence(countryId);
    const evidenceChanged =
      JSON.stringify(before.map((r) => [r.indicatorId, r.value, r.assessorLevel])) !==
      JSON.stringify(after.map((r) => [r.indicatorId, r.value, r.assessorLevel]));
    if (evidenceChanged) {
      dossierJobs.set(countryId, {
        status: "error",
        message: "Stopped: dossier must not write the evidence table.",
        added,
        total: batches.length,
      });
      return;
    }
    await writeAudit(
      userId,
      countryId,
      role,
      actorName,
      "dossier_search",
      `Country dossier stored ${added} cited items. Evidence table unchanged.`,
    );
    dossierJobs.set(countryId, {
      status: "done",
      message: added ? `Stored ${added} cited items. None written to the diagnostic.` : "Search finished. No citable items found.",
      added,
      total: batches.length,
    });
  } catch (err) {
    dossierJobs.set(countryId, {
      status: "error",
      message: err instanceof Error ? err.message : "Dossier search failed",
      added,
      total: batches.length,
    });
  } finally {
    dossierLocks.delete(countryId);
  }
}

function kickDossier(countryId: string, userId: string, apiKey: string, workspace: Workspace, role: string, actorName: string) {
  void runDossierJob(countryId, userId, apiKey, workspace, role, actorName);
}

export const updateEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      countryId: string;
      indicatorId: string;
      role: string;
      actorName: string;
      assessorLevel?: number | null;
      dataGap?: boolean;
      value?: number | null;
      observationYear?: number | null;
      confidence?: Confidence | null;
      notes?: string | null;
      sourceName?: string | null;
      sourceUrl?: string | null;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const ind = model.indicators.find((i) => i.id === data.indicatorId);
    if (!ind) return { ok: false as const, error: "Unknown indicator" };
    const curRows = await sql<EvidenceDb & { id: string }>`
      select * from evidence where country_id = ${data.countryId} and indicator_id = ${data.indicatorId} and user_id = ${context.userId}`;
    const cur = curRows[0];
    if (!cur) return { ok: false as const, error: "Row not found" };
    const value = data.value !== undefined ? data.value : cur.value;
    const suggested = suggestedLevel(ind, value);
    const assessor = data.assessorLevel !== undefined ? data.assessorLevel : cur.assessor_level;
    const dataGap = data.dataGap !== undefined ? data.dataGap : cur.data_gap;
    const sourceName = data.sourceName !== undefined ? data.sourceName : cur.source_name;
    const sourceUrl = data.sourceUrl !== undefined ? data.sourceUrl : cur.source_url;
    const cite = citationError({
      dataGap: Boolean(dataGap),
      value,
      assessorLevel: assessor,
      sourceName,
      sourceUrl,
    });
    if (cite) return { ok: false as const, error: cite };
    const now = assessor !== null && assessor !== undefined ? new Date().toISOString() : cur.assessed_at;
    const provenance = nextProvenance({
      dataGap: Boolean(dataGap),
      assessorLevel: assessor,
      value,
      current: cur.provenance,
    });
    await sql`update evidence set
      value = ${value},
      observation_year = ${data.observationYear !== undefined ? data.observationYear : cur.observation_year},
      source_name = ${sourceName},
      source_url = ${sourceUrl},
      confidence = ${data.confidence !== undefined ? data.confidence : cur.confidence},
      data_gap = ${dataGap},
      suggested_level = ${suggested},
      assessor_level = ${assessor},
      assessor_role = ${assessor !== null && assessor !== undefined ? data.role : cur.assessor_role},
      assessor_name = ${assessor !== null && assessor !== undefined ? data.actorName : cur.assessor_name},
      assessed_at = ${now},
      notes = ${data.notes !== undefined ? data.notes : cur.notes},
      provenance = ${provenance}
      where id = ${cur.id}`;
    const rows = await loadEvidence(data.countryId);
    const card = scoreAssessment(model, rows);
    await persistScore(data.countryId, card);
    await writeAudit(
      context.userId,
      data.countryId,
      data.role,
      data.actorName,
      "update_evidence",
      `${data.indicatorId}: assessor=${assessor ?? "—"} gap=${dataGap} value=${value ?? "—"} (final ${finalLevel({
        dataGap: Boolean(dataGap),
        assessorLevel: assessor,
        suggestedLevel: suggested,
      }) ?? "none"})`,
    );
    return { ok: true as const, scorecard: card };
  });

export const recordDecision = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      countryId: string;
      step: number;
      optionName: string;
      deciderName: string;
      role: string;
      actorName: string;
      notes: string;
      rejected: string;
      payload?: { chains?: string[]; rejected?: string[] } | null;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const countries = await sql<{ step1_completed_at: string | null }>`
      select step1_completed_at from countries where id = ${data.countryId} and user_id = ${context.userId}`;
    const c = countries[0];
    if (!c) return { ok: false as const, error: "Not found" };
    const decisions = await loadDecisions(data.countryId);
    if (!canRecordStep(decisions, Boolean(c.step1_completed_at), data.step)) {
      return { ok: false as const, error: "The ladder cannot skip or move backwards. Record the previous step first." };
    }
    if (!data.deciderName.trim()) return { ok: false as const, error: "Decider name is required." };
    if (!data.optionName.trim()) return { ok: false as const, error: "A decision option is required." };
    await sql`insert into decisions (id, user_id, country_id, step, option_name, decider_name, role, notes, rejected, payload)
      values (${uid()}, ${context.userId}, ${data.countryId}, ${data.step}, ${data.optionName.trim()},
        ${data.deciderName.trim()}, ${data.role}, ${data.notes.trim() || null}, ${data.rejected.trim() || null},
        ${data.payload ? JSON.stringify(data.payload) : null})`;
    if (data.step === 3 && data.payload) {
      await sql`insert into targeting (country_id, user_id, chains, rejected, notes)
        values (${data.countryId}, ${context.userId}, ${JSON.stringify(data.payload.chains ?? [])},
          ${JSON.stringify(data.payload.rejected ?? [])}, ${data.notes.trim() || null})
        on conflict (country_id) do update set chains = excluded.chains, rejected = excluded.rejected, notes = excluded.notes`;
    }
    await sql`update countries set current_step = ${data.step >= 8 ? 8 : data.step + 1}, updated_at = now() where id = ${data.countryId}`;
    await writeAudit(
      context.userId,
      data.countryId,
      data.role,
      data.actorName,
      "record_decision",
      `Step ${data.step}: ${data.optionName} by ${data.deciderName}`,
    );
    return { ok: true as const };
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    return sql<{ id: string; at: string; role: string; actor_name: string; action: string; detail: string }>`
      select id, at, role, actor_name, action, detail from audit
      where user_id = ${context.userId} and country_id = ${data.countryId}
      order by at desc limit 200`;
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ acting_role: string; actor_name: string | null; active_provider: string | null }>`
      select acting_role, actor_name, active_provider from user_settings where user_id = ${context.userId}`;
    const keys = await sql<{
      id: string;
      provider: string;
      fingerprint: string;
      last4: string;
      model_name: string;
      last_test_ok: boolean | null;
    }>`select id, provider, fingerprint, last4, model_name, last_test_ok from api_keys where user_id = ${context.userId}`;
    return {
      role: rows[0]?.acting_role ?? "TTL",
      actorName: rows[0]?.actor_name ?? "",
      activeProvider: rows[0]?.active_provider ?? null,
      platformXai: Boolean(process.env.XAI_API_KEY),
      keys,
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { role: string; actorName: string; activeProvider?: string | null }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<{ active_provider: string | null }>`
      select active_provider from user_settings where user_id = ${context.userId}`;
    const provider = data.activeProvider !== undefined ? data.activeProvider : (existing[0]?.active_provider ?? null);
    await sql`insert into user_settings (user_id, acting_role, actor_name, active_provider)
      values (${context.userId}, ${data.role}, ${data.actorName}, ${provider})
      on conflict (user_id) do update set acting_role = excluded.acting_role, actor_name = excluded.actor_name, active_provider = excluded.active_provider`;
    return { ok: true as const };
  });

export const saveApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { provider: string; key: string; modelName: string }) => input)
  .handler(async ({ context, data }) => {
    const key = data.key.trim();
    if (key.length < 8) return { ok: false as const, error: "Key looks too short." };
    const sql = await getSql();
    await sql`delete from api_keys where user_id = ${context.userId} and provider = ${data.provider}`;
    const modelName =
      data.modelName.trim() ||
      (data.provider === "openai" ? "gpt-4.1-mini" : data.provider === "anthropic" ? "claude-sonnet-4-5" : "grok-4.5");
    await sql`insert into api_keys (id, user_id, provider, key_value, fingerprint, last4, model_name)
      values (${uid()}, ${context.userId}, ${data.provider}, ${key}, ${fingerprint(key)}, ${key.slice(-4)}, ${modelName})`;
    return { ok: true as const };
  });

export const deleteApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from api_keys where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

function providerEndpoint(provider: string) {
  if (provider === "openai") return "https://api.openai.com/v1/models";
  if (provider === "anthropic") return "https://api.anthropic.com/v1/models";
  if (provider === "xai") return "https://api.x.ai/v1/models";
  return null;
}

export const testApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const keys = await sql<{ provider: string; key_value: string; model_name: string }>`
      select provider, key_value, model_name from api_keys where id = ${data.id} and user_id = ${context.userId}`;
    const key = keys[0];
    if (!key) return { ok: false as const, error: "Key not found" };
    const url = providerEndpoint(key.provider);
    if (!url) return { ok: false as const, error: "Unknown provider" };
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${key.key_value}` };
      if (key.provider === "anthropic") {
        headers["x-api-key"] = key.key_value;
        headers["anthropic-version"] = "2023-06-01";
        delete headers.Authorization;
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      const ok = res.ok;
      let modelOk = true;
      if (ok) {
        try {
          const body = (await res.json()) as { data?: Array<{ id: string }> };
          if (Array.isArray(body.data) && key.model_name) modelOk = body.data.some((m) => m.id === key.model_name);
        } catch {
          /* ignore */
        }
      }
      await sql`update api_keys set last_tested_at = now(), last_test_ok = ${ok && modelOk} where id = ${data.id}`;
      if (!ok) return { ok: false as const, error: `Provider returned ${res.status}` };
      if (!modelOk) return { ok: false as const, error: `Key works but model “${key.model_name}” was not in the provider list.` };
      return { ok: true as const };
    } catch (err) {
      await sql`update api_keys set last_tested_at = now(), last_test_ok = ${false} where id = ${data.id}`;
      return { ok: false as const, error: err instanceof Error ? err.message : "Test failed" };
    }
  });

async function resolveDraftModel(userId: string) {
  const sql = await getSql();
  const settings = await sql<{ active_provider: string | null }>`
    select active_provider from user_settings where user_id = ${userId}`;
  const active = settings[0]?.active_provider;
  if (!active) return null;
  if (active === "platform-xai") {
    if (!process.env.XAI_API_KEY) return null;
    return { provider: "xai", key: process.env.XAI_API_KEY, modelName: "grok-4.5" };
  }
  const keys = await sql<{ key_value: string; model_name: string; provider: string }>`
    select key_value, model_name, provider from api_keys where user_id = ${userId} and provider = ${active}`;
  if (keys[0]) return { provider: keys[0].provider, key: keys[0].key_value, modelName: keys[0].model_name };
  return null;
}

async function llmProse(cfg: { provider: string; key: string; modelName: string }, system: string, user: string) {
  try {
    if (cfg.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.modelName,
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(40000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { content?: Array<{ text?: string }> };
      return body.content?.[0]?.text ?? null;
    }
    const base = cfg.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.modelName,
        max_tokens: 1200,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export const generateDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    try {
      const ws = await loadWorkspaceFor(context.userId, data.countryId);
      if (!ws.ok) return { ok: false as const, error: ws.error, fallback: true };
      const w = ws.workspace;
      const payload: DraftPayload = {
        countryName: w.name,
        iso3: w.iso3,
        generatedAt: new Date().toISOString(),
        modelVersion: model.version,
        assessmentYear: model.assessment_year,
        currentStep: w.openStep,
        mandateRecorded: w.decisions.some((d) => d.step === 5),
        validationRecorded: w.decisions.some((d) => d.step === 6),
        scorecard: w.scorecard,
        claim: w.claim,
        chapters: w.chapters,
        decisions: w.decisions,
        evidence: model.indicators.map((ind) => {
          const e = w.evidence.find((r) => r.indicatorId === ind.id);
          const suggested = e?.suggestedLevel ?? suggestedLevel(ind, e?.value ?? null);
          const final = e
            ? finalLevel({ dataGap: e.dataGap, assessorLevel: e.assessorLevel, suggestedLevel: suggested })
            : null;
          const cred = credibilityFor({
            sourceName: e?.sourceName,
            sourceUrl: e?.sourceUrl,
            isProxy: Boolean(e?.isProxy),
            provenance: e?.provenance,
            dataGap: Boolean(e?.dataGap),
          });
          return {
            id: ind.id,
            name: ind.name,
            pillar: ind.pillar,
            role: ind.role,
            value: e?.value ?? null,
            year: e?.observationYear ?? null,
            source: e?.sourceName ?? null,
            sourceUrl: e?.sourceUrl ?? null,
            confidence: e?.confidence ?? null,
            credibilityTier: cred.tier,
            credibilityScore: cred.score,
            provenance: e?.provenance ?? null,
            proxy: e?.isProxy ?? false,
            proxyNote: e?.proxyNote ?? null,
            dataGap: e?.dataGap ?? false,
            gapSteward: e?.gapSteward ?? null,
            suggested,
            assessor: e?.assessorLevel ?? null,
            final,
            stale: e ? isStale(ind, e, model.assessment_year, final) : false,
            gate: ind.gate,
          };
        }),
        targeting: w.targeting,
        gauntletPassed: w.gauntlet.passed,
        gauntletSummary: w.gauntlet.summary,
        dossier: w.dossier,
      };
      const doc = assembleDeterministicDraft(model, payload);
      const cfg = await resolveDraftModel(context.userId);
      if (cfg) {
        const facts = payloadForPrompt(payload);
        for (const ch of doc.chapters) {
          if (!ch.ready) continue;
          const prose = await llmProse(
            cfg,
            draftSystemPrompt(),
            `Write connective prose for chapter ${ch.n} ${ch.title}. Use only these facts:\n\n${facts}\n\nDeterministic skeleton:\n${ch.body}`,
          );
          if (prose) {
            ch.body = prose;
            ch.modelName = `${cfg.provider}:${cfg.modelName}`;
          }
        }
        doc.modelName = `${cfg.provider}:${cfg.modelName}`;
      }
      const sql = await getSql();
      await sql`insert into drafts (id, user_id, country_id, kind, body, model_name)
        values (${uid()}, ${context.userId}, ${data.countryId}, ${"dar"}, ${JSON.stringify(doc)}, ${doc.modelName})`;
      await writeAudit(context.userId, data.countryId, data.role, data.actorName, "generate_draft", `Draft via ${doc.modelName}`);
      return { ok: true as const, doc, usedModel: doc.modelName };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Draft failed",
        fallback: true,
      };
    }
  });

export const generateMemo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string; step: number }) => input)
  .handler(async ({ context, data }) => {
    try {
      const ws = await loadWorkspaceFor(context.userId, data.countryId);
      if (!ws.ok) return { ok: false as const, error: ws.error, text: "" };
      const w = ws.workspace;
      let text = assembleMemo({
        model,
        countryName: w.name,
        iso3: w.iso3,
        step: data.step,
        scorecard: w.scorecard,
        decisions: w.decisions,
        step1Done: w.step1Done,
        mandateRecorded: w.decisions.some((d) => d.step === 5),
        validationRecorded: w.decisions.some((d) => d.step === 6),
      });
      const cfg = await resolveDraftModel(context.userId);
      if (cfg) {
        const prose = await llmProse(cfg, draftSystemPrompt() + " Write a short decision memo. Do not pick an option.", text);
        if (prose) text = prose;
      }
      return { ok: true as const, text };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Memo failed", text: "" };
    }
  });

export function scoreLabel(n: number | null): string {
  return formatScore(n);
}
