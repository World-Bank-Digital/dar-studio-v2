import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { uid, mapLimit } from "@/lib/utils";
import { model, disclaimer } from "./model";
import { claimableStage, finalLevel, formatScore, isStale, scoreAssessment, suggestedLevel } from "./scoring";
import { chapterReadiness, currentOpenStep, canRecordStep } from "./ladder";
import { assembleDeterministicDraft, draftSystemPrompt, extractConditionsBanner, payloadForPrompt, type DraftPayload } from "./draft";
import { assembleMemo } from "./memo";
import { ingestIndicator, ingestQueue, webSearchableIndicators } from "./ingest";
import { economyByName, fetchEconomies, type Economy } from "./countries";
import { citationError, nextProvenance } from "./citation";
import { credibilityFor } from "./credibility";
import { evaluateGauntlet, type GauntletResult } from "./gauntlet";
import { groupByPillar, searchPublicReadings } from "./websearch";
import { sourceFor } from "./sources";
import { demoPackRows } from "./fixture";
import { decryptSecret, encryptSecret, encryptionAvailable, fingerprintSecret, isEncrypted } from "./crypto";
import { PROVIDER_IDS, defaultModelFor, providerDef, verifyProviderKey } from "./providers";
import { SEARCH_PROVIDER_IDS, isSearchProviderId, searchProviderDef, verifySearchKey } from "./search";
import { retrieveVerifiedReadings } from "./retrieval";
import { proposalNote, researchRubric, researchableRubrics } from "./rubric";
import { checkProseFidelity } from "./fidelity";
import { isPrescriptive, shouldProse } from "./outline";
import type { Confidence, EvidenceRow, RecordedDecision, Scorecard } from "./types";
import { nsoDomainsFor } from "./nso";
import {
  DOSSIER_CANNOT_WRITE_EVIDENCE,
  chunkTopics,
  dossierHitFromSearch,
  dossierTopicSpecs,
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
  /** How many drafts have been assembled — lets the Guide show real progress. */
  draftCount: number;
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
    // Draft-first: readiness is never downgraded by the gauntlet. The gate's
    // state reaches the draft as gauntletPassed/gauntletSummary and is stated
    // inside prescriptive chapters as a condition, not a lock.
    chapters: chapterReadiness(model, decisions, step1Done),
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
    draftCount: Number(
      (await sql<{ n: string }>`select count(*) as n from drafts where country_id = ${c.id} and user_id = ${userId}`)[0]?.n ?? 0,
    ),
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

/** A stored credential, decrypted, with the model id the operator chose. */
interface ResolvedKey {
  provider: string;
  key: string;
  modelName: string;
}

async function loadStoredKey(userId: string, provider: string, kind: "llm" | "search"): Promise<ResolvedKey | null> {
  const sql = await getSql();
  const rows = await sql<{ provider: string; key_value: string; model_name: string }>`
    select provider, key_value, model_name from api_keys
    where user_id = ${userId} and provider = ${provider} and kind = ${kind} limit 1`;
  const row = rows[0];
  if (!row) return null;
  try {
    return { provider: row.provider, key: decryptSecret(row.key_value), modelName: row.model_name };
  } catch {
    // A key encrypted under a master secret this environment no longer has is
    // unusable. Surfacing it as "absent" is correct; the operator re-enters it.
    return null;
  }
}

/**
 * The web-search credential.
 *
 * Previously this looked only for an xAI key, so a user who had configured
 * Claude or Gemini got no search at all and no explanation. Search now has its
 * own provider selection, independent of the drafting model.
 */
async function resolveSearchProvider(userId: string): Promise<ResolvedKey | null> {
  const sql = await getSql();
  const settings = await sql<{ active_search_provider: string | null }>`
    select active_search_provider from user_settings where user_id = ${userId}`;
  const active = settings[0]?.active_search_provider;
  if (active && isSearchProviderId(active)) {
    const stored = await loadStoredKey(userId, active, "search");
    if (stored) return stored;
  }
  // No explicit choice: use whichever search key exists.
  for (const id of SEARCH_PROVIDER_IDS) {
    const stored = await loadStoredKey(userId, id, "search");
    if (stored) return stored;
  }
  return null;
}

/**
 * Legacy xAI-native search: the model's own web_search tool, with no page text
 * to check the result against. Kept only for an environment that has a platform
 * xAI key and no search provider configured, and reported as unverified.
 */
async function resolveLegacyXaiKey(userId: string): Promise<string | null> {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  const stored = await loadStoredKey(userId, "xai", "llm");
  return stored?.key ?? null;
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
  confidence: Confidence = "Medium",
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
    confidence = ${confidence},
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

/** How many indicators go into one retrieval batch. Bounded by prompt size, not policy. */
const SEARCH_BATCH_SIZE = 6;
/** Ceiling on batches per run, so one country cannot exhaust an operator's search quota. */
const MAX_SEARCH_BATCHES = 12;

async function setIngestMessage(countryId: string, message: string) {
  const sql = await getSql();
  await sql`update countries set ingest_message = ${message} where id = ${countryId}`;
}

/**
 * Fill remaining quantitative gaps from the public web.
 *
 * Preferred path: a search provider (Exa or Jina) fetches page text, and the
 * drafting model extracts figures from that text only, with every quotation
 * checked against the page before the reading is stored.
 *
 * Fallback path: an xAI key alone, using the model's own search tool. Those
 * readings cannot be verified against retrieved text, so they are recorded with
 * lower confidence and the run says so.
 *
 * Coverage is always reported. A capped run that silently skipped two thirds of
 * the searchable indicators reads as "nothing more was findable", which is the
 * one conclusion the operator must not draw.
 */
async function runWebSearchPass(
  countryId: string,
  userId: string,
  iso3: string,
  countryName: string,
  actor: { role: string; name: string },
) {
  const sql = await getSql();
  const open = await sql<{ indicator_id: string }>`
    select indicator_id from evidence
    where country_id = ${countryId} and value is null and assessor_level is null and data_gap = false`;
  const openIds = new Set(open.map((r) => r.indicator_id));
  const candidates = webSearchableIndicators().filter((i) => openIds.has(i.id));
  if (!candidates.length) return;

  const searchCfg = await resolveSearchProvider(userId);
  const modelCfg = await resolveDraftModel(userId);

  if (!searchCfg) {
    const legacyKey = await resolveLegacyXaiKey(userId);
    if (!legacyKey) {
      await writeAudit(
        userId,
        countryId,
        actor.role,
        actor.name,
        "web_search_skipped",
        `No web-search key configured. ${candidates.length} quantitative gaps remain for a steward.`,
      );
      await setIngestMessage(
        countryId,
        `No search key configured — ${candidates.length} gaps left named. Add an Exa or Jina key in Settings.`,
      );
      return;
    }
    await runLegacySearchPass(countryId, userId, iso3, countryName, actor, legacyKey, candidates);
    return;
  }

  if (!modelCfg) {
    await writeAudit(
      userId,
      countryId,
      actor.role,
      actor.name,
      "web_search_skipped",
      "A search key is configured but no drafting model is active. Extraction needs a model to read the retrieved pages.",
    );
    await setIngestMessage(countryId, "Search key found, but no active model to read the retrieved pages. Choose one in Settings.");
    return;
  }

  const grouped = groupByPillar(candidates);
  const batches: Array<Array<(typeof candidates)[number]>> = [];
  for (const [, inds] of grouped) {
    for (let i = 0; i < inds.length; i += SEARCH_BATCH_SIZE) {
      batches.push(inds.slice(i, i + SEARCH_BATCH_SIZE));
    }
  }
  const running = batches.slice(0, MAX_SEARCH_BATCHES);
  const skipped = batches.slice(MAX_SEARCH_BATCHES).flat();

  let accepted = 0;
  let rejected = 0;
  let documents = 0;
  const errors: string[] = [];

  for (const [index, batch] of running.entries()) {
    await setIngestMessage(countryId, `Searching official sources — batch ${index + 1} of ${running.length}…`);
    const outcome = await retrieveVerifiedReadings({
      search: { providerId: searchCfg.provider, key: searchCfg.key },
      model: { providerId: modelCfg.provider, key: modelCfg.key, modelName: modelCfg.modelName },
      countryName,
      iso3,
      assessmentYear: model.assessment_year,
      indicators: batch.map((i) => {
        const spec = sourceFor(i.id);
        return { id: i.id, name: i.name, anchors: i.anchors, preferredSource: spec?.sourceName, gapNote: spec?.gapNote };
      }),
    });
    documents += outcome.documentsRead;
    rejected += outcome.rejected.length;
    if (outcome.error) errors.push(outcome.error);
    for (const reading of outcome.readings) {
      await persistWebReading(userId, countryId, reading, "High");
      accepted += 1;
    }
    for (const drop of outcome.rejected.slice(0, 3)) {
      await writeAudit(
        userId,
        countryId,
        actor.role,
        actor.name,
        "web_reading_rejected",
        `${drop.indicatorId}: ${drop.reason}${drop.sourceUrl ? ` (${drop.sourceUrl})` : ""}`,
      );
    }
  }

  const summary =
    `Verified search via ${searchCfg.provider}: ${accepted} readings accepted, ${rejected} rejected as uncheckable, ` +
    `${documents} documents read across ${running.length} batches` +
    (skipped.length ? `; ${skipped.length} indicators not searched this run (batch ceiling reached)` : "") +
    (errors.length ? `; errors: ${Array.from(new Set(errors)).slice(0, 2).join(" | ")}` : "");

  await writeAudit(userId, countryId, actor.role, actor.name, "web_search_pass", summary);
  await setIngestMessage(countryId, summary);
}

/** How many rubrics research concurrently. Each is a search plus a long model call. */
const RUBRIC_CONCURRENCY = 3;

/**
 * Research the anchored rubrics on the public web.
 *
 * Every proposal is stored as a machine-researched *suggested* level: it feeds
 * the provisional scores exactly as quantitative machine imports do, and the
 * note carries the clause-mapped rationale, the negative finding, and every
 * citation, so validation is a review of an argued case rather than a blank
 * page. An assessor level set at validation overrides it; the engagement-
 * package rule (no claimable stage before validation) is untouched.
 */
async function runRubricResearchPass(
  countryId: string,
  userId: string,
  iso3: string,
  countryName: string,
  actor: { role: string; name: string },
) {
  const searchCfg = await resolveSearchProvider(userId);
  const modelCfg = await resolveDraftModel(userId);
  if (!searchCfg || !modelCfg) {
    await writeAudit(
      userId,
      countryId,
      actor.role,
      actor.name,
      "rubric_research_skipped",
      `Rubric research needs both a search key and an active model (search: ${searchCfg ? "yes" : "no"}, model: ${modelCfg ? "yes" : "no"}).`,
    );
    return;
  }
  const sql = await getSql();
  const open = await sql<{ indicator_id: string }>`
    select indicator_id from evidence
    where country_id = ${countryId} and value is null and assessor_level is null
      and suggested_level is null and data_gap = false`;
  const openIds = new Set(open.map((r) => r.indicator_id));
  const allTargets = researchableRubrics(model.indicators).filter((i) => openIds.has(i.id));
  const RUBRIC_MAX_PER_RUN = 48;
  const targets = allTargets.slice(0, RUBRIC_MAX_PER_RUN);
  if (allTargets.length > targets.length) {
    await writeAudit(userId, countryId, actor.role, actor.name, "rubric_research_capped",
      `${allTargets.length - targets.length} rubrics deferred to the per-run ceiling of ${RUBRIC_MAX_PER_RUN}.`);
  }
  if (!targets.length) return;

  let proposed = 0;
  let repairedCount = 0;
  let reattributedCount = 0;
  let rejectedCount = 0;
  let documents = 0;
  const errors: string[] = [];
  let done = 0;
  let reported = 0;

  await mapLimit(targets, RUBRIC_CONCURRENCY, async (indicator) => {
    let res: Awaited<ReturnType<typeof researchRubric>>;
    try {
      res = await researchRubric({
        search: { providerId: searchCfg.provider, key: searchCfg.key },
        model: { providerId: modelCfg.provider, key: modelCfg.key, modelName: modelCfg.modelName },
        countryName,
        iso3,
        indicator,
      });
    } catch (err) {
      // One rubric must never cost the other forty-one. A thrown worker
      // rejects the whole mapLimit pool, so the pass died at "41 of 42" with
      // no summary in a live run when one catalogue name broke the query
      // builder. Contained here as an error the summary reports loudly.
      res = { documentsRead: 0, error: `${indicator.id} crashed: ${err instanceof Error ? err.message : String(err)}` };
    }
    documents += res.documentsRead;
    const current = ++done;
    // Concurrent workers' UPDATEs can commit out of order; only ever write a
    // higher count than the last one written.
    if (current > reported) {
      reported = current;
      await setIngestMessage(countryId, `Researching documentary rubrics — ${current} of ${targets.length}…`);
    }
    if (res.error) {
      errors.push(res.error);
      return;
    }
    if (res.rejected) {
      rejectedCount += 1;
      // 300, not 160: quote-failure reasons carry the offending quote and the
      // repair-attempt suffix at the end — truncation was eating the part
      // that says whether the repair pass already had its shot.
      await writeAudit(userId, countryId, actor.role, actor.name, "rubric_rejected", `${res.rejected.indicatorId}: ${res.rejected.reason.slice(0, 300)}`);
      return;
    }
    const p = res.proposal!;
    await sql`update evidence set
      suggested_level = ${p.proposedLevel},
      provenance = ${"machine-researched"},
      source_name = ${p.primary.sourceName},
      source_url = ${p.primary.sourceUrl},
      confidence = ${"Medium"},
      observation_year = ${p.documentYear},
      notes = ${proposalNote(p)}
      where country_id = ${countryId} and indicator_id = ${p.indicatorId} and user_id = ${userId}
        and assessor_level is null and data_gap = false
        and value is null and suggested_level is null`;
    proposed += 1;
    if (res.repaired) repairedCount += 1;
    if (p.reattributions.length) reattributedCount += 1;
  });

  const summary =
    `Rubric research via ${searchCfg.provider}+${modelCfg.provider}: ${proposed} provisional levels proposed` +
    (repairedCount ? ` (${repairedCount} recovered by citation repair)` : "") +
    (reattributedCount ? ` (${reattributedCount} with re-attributed citations)` : "") +
    `, ${rejectedCount} rubrics left named (insufficient or unverifiable evidence), ${documents} documents read of ${targets.length} rubrics` +
    (errors.length ? `; errors: ${Array.from(new Set(errors)).slice(0, 2).join(" | ")}` : "");
  await writeAudit(userId, countryId, actor.role, actor.name, "rubric_research_pass", summary);
  await setIngestMessage(countryId, summary);
}

/** xAI's built-in search tool. Unverifiable, so readings land at Low confidence. */
async function runLegacySearchPass(
  countryId: string,
  userId: string,
  iso3: string,
  countryName: string,
  actor: { role: string; name: string },
  key: string,
  candidates: ReturnType<typeof webSearchableIndicators>,
) {
  const grouped = groupByPillar(candidates);
  let accepted = 0;
  let batches = 0;
  for (const [, inds] of grouped) {
    if (batches >= MAX_SEARCH_BATCHES) break;
    batches += 1;
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
      await persistWebReading(userId, countryId, reading, "Low/Estimated");
      accepted += 1;
    }
  }
  const summary =
    `Unverified search (xAI built-in tool): ${accepted} readings imported at low confidence. ` +
    "Add an Exa or Jina key in Settings to check figures against the source page before they are stored.";
  await writeAudit(userId, countryId, actor.role, actor.name, "web_search_pass_unverified", summary);
  await setIngestMessage(countryId, summary);
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
    await runRubricResearchPass(countryId, userId, iso3, countryName, actor);
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
    // Machine-researched rows carry citation + note as well; a refresh must not
    // leave a "MACHINE-RESEARCHED PROPOSAL" note on an emptied row.
    await sql`update evidence set
      source_name = null, source_url = null, confidence = null, notes = null
      where country_id = ${data.countryId} and user_id = ${context.userId}
        and provenance = 'machine-researched' and assessor_level is null and data_gap = false`;
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
    const rows = demoPackRows(model);
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

    const searchCfg = await resolveSearchProvider(context.userId);
    const legacyKey = searchCfg ? null : await resolveLegacyXaiKey(context.userId);
    if (!searchCfg && !legacyKey) {
      return {
        ok: false as const,
        error: "Add an Exa or Jina search key in Settings before running the country dossier.",
        added: 0,
      };
    }
    if (dossierLocks.has(data.countryId)) {
      return { ok: true as const, added: dossierJobFor(data.countryId).added, started: true as const };
    }
    kickDossier(data.countryId, context.userId, searchCfg, legacyKey, ws.workspace, data.role, data.actorName);
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
  searchCfg: ResolvedKey | null,
  legacyKey: string | null,
  workspace: Workspace,
  role: string,
  actorName: string,
) {
  if (dossierLocks.has(countryId)) return;
  dossierLocks.add(countryId);
  const specs = dossierTopicSpecs(workspace.name, workspace.iso3, workspace.targeting?.chains ?? []);
  const topics = specs.map((s) => s.query);
  // A real search provider takes one topic per query; the legacy model path
  // batched three topics into a single prompt to save calls.
  const units: string[][] = searchCfg ? topics.map((t) => [t]) : chunkTopics(topics, 3);
  dossierJobs.set(countryId, { status: "running", message: `Searching 1 of ${units.length}…`, added: 0, total: units.length });
  const before = await loadEvidence(countryId);
  let added = 0;
  try {
    let i = 0;
    for (const batch of units) {
      i += 1;
      dossierJobs.set(countryId, {
        status: "running",
        message: `Searching public sources ${i} of ${units.length}…`,
        added,
        total: units.length,
      });

      if (searchCfg) {
        const provider = searchProviderDef(searchCfg.provider);
        if (!provider) break;
        // Only statistical topics are confined to the statistics office; a legal
        // or institutional question scoped there returns the wrong site entirely.
        const spec = specs[i - 1];
        const nso = spec?.preferNationalStats ? nsoDomainsFor(workspace.iso3) : [];
        const res = await provider.search({
          key: searchCfg.key,
          query: batch[0],
          numResults: 6,
          includeDomains: nso.length
            ? provider.domainFilterLimit === "all"
              ? nso
              : nso.slice(0, provider.domainFilterLimit)
            : undefined,
          withText: true,
        });
        // Tag the hit with what this topic was asked to inform, so the dossier
        // is browsable by assessment domain rather than one undifferentiated list.
        for (const raw of res.hits) {
          const hit = dossierHitFromSearch(raw, spec?.informs ?? "named-lead");
          if (hit && (await persistDossierHit(userId, countryId, workspace.name, hit))) added += 1;
        }
        continue;
      }

      const part = await searchDossierBatch({
        apiKey: legacyKey!,
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
        total: units.length,
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
      total: units.length,
    });
  } catch (err) {
    dossierJobs.set(countryId, {
      status: "error",
      message: err instanceof Error ? err.message : "Dossier search failed",
      added,
      total: units.length,
    });
  } finally {
    dossierLocks.delete(countryId);
  }
}

function kickDossier(
  countryId: string,
  userId: string,
  searchCfg: ResolvedKey | null,
  legacyKey: string | null,
  workspace: Workspace,
  role: string,
  actorName: string,
) {
  void runDossierJob(countryId, userId, searchCfg, legacyKey, workspace, role, actorName);
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
    // Recompute from thresholds where possible; PRESERVE the stored level where
    // not. All 42 anchored rubrics have no numeric cuts, so recomputation
    // yields null for them — writing that null erased machine-researched
    // proposals on any unrelated edit (review finding #1).
    const suggested = suggestedLevel(ind, value) ?? cur.suggested_level;
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
    const rows = await sql<{
      acting_role: string;
      actor_name: string | null;
      active_provider: string | null;
      active_search_provider: string | null;
    }>`select acting_role, actor_name, active_provider, active_search_provider
       from user_settings where user_id = ${context.userId}`;
    const keys = await sql<{
      id: string;
      provider: string;
      kind: string;
      fingerprint: string;
      last4: string;
      model_name: string;
      encrypted: boolean;
      last_test_ok: boolean | null;
    }>`select id, provider, kind, fingerprint, last4, model_name, encrypted, last_test_ok
       from api_keys where user_id = ${context.userId} order by kind, provider`;
    return {
      role: rows[0]?.acting_role ?? "TTL",
      actorName: rows[0]?.actor_name ?? "",
      activeProvider: rows[0]?.active_provider ?? null,
      activeSearchProvider: rows[0]?.active_search_provider ?? null,
      platformXai: Boolean(process.env.XAI_API_KEY),
      /** False when DAR_KEY_SECRET is unset — the interface must say so plainly. */
      encryptionAvailable: encryptionAvailable(),
      /** Any key written before encryption was switched on, so it can be re-saved. */
      plaintextKeyCount: keys.filter((k) => !k.encrypted).length,
      keys,
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      role: string;
      actorName: string;
      activeProvider?: string | null;
      activeSearchProvider?: string | null;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<{ active_provider: string | null; active_search_provider: string | null }>`
      select active_provider, active_search_provider from user_settings where user_id = ${context.userId}`;
    const provider = data.activeProvider !== undefined ? data.activeProvider : (existing[0]?.active_provider ?? null);
    const search =
      data.activeSearchProvider !== undefined ? data.activeSearchProvider : (existing[0]?.active_search_provider ?? null);
    await sql`insert into user_settings (user_id, acting_role, actor_name, active_provider, active_search_provider)
      values (${context.userId}, ${data.role}, ${data.actorName}, ${provider}, ${search})
      on conflict (user_id) do update set
        acting_role = excluded.acting_role,
        actor_name = excluded.actor_name,
        active_provider = excluded.active_provider,
        active_search_provider = excluded.active_search_provider`;
    return { ok: true as const };
  });

/** Provider and search-provider catalogues, for the Settings form. */
export const listProviders = createServerFn({ method: "GET" }).handler(async () => {
  const models = PROVIDER_IDS.map((id) => {
    const def = providerDef(id)!;
    return { id: def.id, label: def.label, defaultModel: def.defaultModel, consoleUrl: def.consoleUrl };
  });
  const search = SEARCH_PROVIDER_IDS.map((id) => {
    const def = { exa: { label: "Exa", console: "https://dashboard.exa.ai/api-keys" }, jina: { label: "Jina", console: "https://jina.ai/api-dashboard/" } }[id];
    return { id, label: def.label, consoleUrl: def.console };
  });
  return { models, search };
});

export const saveApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { provider: string; key: string; modelName?: string; kind?: "llm" | "search" }) => input)
  .handler(async ({ context, data }) => {
    const key = data.key.trim();
    if (key.length < 8) return { ok: false as const, error: "Key looks too short." };

    const kind = data.kind ?? "llm";
    if (kind === "llm" && !providerDef(data.provider)) {
      return { ok: false as const, error: `Unknown model provider “${data.provider}”.` };
    }
    if (kind === "search" && !isSearchProviderId(data.provider)) {
      return { ok: false as const, error: `Unknown search provider “${data.provider}”.` };
    }

    const sql = await getSql();
    await sql`delete from api_keys where user_id = ${context.userId} and provider = ${data.provider} and kind = ${kind}`;
    const modelName = kind === "search" ? "" : (data.modelName?.trim() || defaultModelFor(data.provider));
    const stored = encryptSecret(key);
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, fingerprint, last4, model_name, encrypted)
      values (${uid()}, ${context.userId}, ${data.provider}, ${kind}, ${stored},
        ${fingerprintSecret(key)}, ${key.slice(-4)}, ${modelName}, ${isEncrypted(stored)})`;

    // Verify at save time, not only when Test is pressed. A first live run
    // shipped a mistyped model id that every later call would have 404'd on;
    // the catalogue check that catches it costs one request and belongs here.
    const warnings: string[] = [];
    if (!isEncrypted(stored)) {
      warnings.push("Stored without encryption — set DAR_KEY_SECRET in the environment to protect keys at rest.");
    }
    let verified: boolean | null = null;
    if (kind === "llm") {
      const check = await verifyProviderKey(data.provider, key, modelName);
      verified = check.ok;
      if (!check.ok && check.error) warnings.push(check.error);
      if (check.warning) warnings.push(check.warning);
      await sql`update api_keys set last_tested_at = now(), last_test_ok = ${check.ok}
        where user_id = ${context.userId} and provider = ${data.provider} and kind = ${kind}`;
    }

    // Storing a key is a statement of intent: if nothing is active yet, this
    // key becomes active. A stored-but-never-selected key silently disables
    // the whole model path, which is how a configured drafter ran as "none".
    const settings = await sql<{ active_provider: string | null; active_search_provider: string | null }>`
      select active_provider, active_search_provider from user_settings where user_id = ${context.userId}`;
    const cur = settings[0];
    const activate =
      kind === "llm"
        ? { column: "active_provider" as const, empty: !cur?.active_provider }
        : { column: "active_search_provider" as const, empty: !cur?.active_search_provider };
    let activated = false;
    if (activate.empty) {
      if (!cur) {
        await sql`insert into user_settings (user_id, acting_role, actor_name, active_provider, active_search_provider)
          values (${context.userId}, ${"TTL"}, ${""},
            ${kind === "llm" ? data.provider : null}, ${kind === "search" ? data.provider : null})
          on conflict (user_id) do nothing`;
      } else if (kind === "llm") {
        await sql`update user_settings set active_provider = ${data.provider} where user_id = ${context.userId}`;
      } else {
        await sql`update user_settings set active_search_provider = ${data.provider} where user_id = ${context.userId}`;
      }
      activated = true;
    }

    return {
      ok: true as const,
      encrypted: isEncrypted(stored),
      verified,
      activated,
      warning: warnings.length ? warnings.join(" ") : undefined,
    };
  });

export const deleteApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from api_keys where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const testApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ provider: string; kind: string; key_value: string; model_name: string }>`
      select provider, kind, key_value, model_name from api_keys where id = ${data.id} and user_id = ${context.userId}`;
    const row = rows[0];
    if (!row) return { ok: false as const, error: "Key not found" };

    let plain: string;
    try {
      plain = decryptSecret(row.key_value);
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Stored key could not be read." };
    }

    const result: { ok: boolean; error?: string; warning?: string } =
      row.kind === "search"
        ? await verifySearchKey(row.provider, plain)
        : await verifyProviderKey(row.provider, plain, row.model_name);

    await sql`update api_keys set last_tested_at = now(), last_test_ok = ${result.ok} where id = ${data.id}`;
    if (!result.ok) return { ok: false as const, error: result.error ?? "Test failed" };
    return { ok: true as const, warning: result.warning ?? null };
  });

/**
 * The active drafting model, decrypted and ready to call.
 *
 * `platform-xai` remains available where the deployment injects `XAI_API_KEY`,
 * so an environment that already had one keeps working without re-entry.
 */
async function resolveDraftModel(userId: string): Promise<ResolvedKey | null> {
  const sql = await getSql();
  const settings = await sql<{ active_provider: string | null }>`
    select active_provider from user_settings where user_id = ${userId}`;
  const active = settings[0]?.active_provider;
  if (!active) return null;
  if (active === "platform-xai") {
    if (!process.env.XAI_API_KEY) return null;
    return { provider: "xai", key: process.env.XAI_API_KEY, modelName: "grok-4.5" };
  }
  return loadStoredKey(userId, active, "llm");
}

/**
 * One prose call through the active provider.
 *
 * Returns the error rather than null-on-everything: a rate limit, a bad key and
 * a genuinely empty completion produce very different advice, and the caller
 * needs to tell the user which happened instead of silently falling back to the
 * deterministic text.
 */
async function llmProse(
  cfg: ResolvedKey,
  system: string,
  user: string,
): Promise<{ text: string | null; error?: string }> {
  const def = providerDef(cfg.provider);
  if (!def) return { text: null, error: `Unknown provider “${cfg.provider}”.` };
  // Chapter prose is a long completion over a large facts block. At the 60s
  // adapter default, 16 of 17 calls in the first live draft timed out and the
  // whole pass silently fell back to deterministic text (LEARNINGS L13).
  // 24k: a reasoning model needs the budget to cover its chain of thought AND
  // the chapter. At 4k DeepSeek burned everything reasoning (L14); at 12k the
  // heavyweight prescriptive chapters (portfolio, policy, financing) still did.
  return def.chat({ key: cfg.key, model: cfg.modelName, system, user, maxTokens: 24_000, temperature: 0.2, timeoutMs: 360_000 });
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

      /** Chapters where model prose was rejected or the call failed. */
      const rejections: string[] = [];
      let modelErrors = 0;

      if (cfg) {
        const facts = payloadForPrompt(payload);
        const stageClaimable = Boolean(payload.claim?.claimable);
        // Prose only for numbered chapters — annexes are the evidence record and
        // stay verbatim. A bounded pool keeps a 17-chapter pass to a few waves
        // without hammering the provider's rate limits.
        const proseTargets = doc.chapters.filter((ch) => ch.ready && shouldProse(ch.n));
        await mapLimit(proseTargets, 4, async (ch) => {
          const kind = isPrescriptive(ch.n) ? "prescriptive" : "diagnostic";
          const { text: prose, error } = await llmProse(
            cfg,
            draftSystemPrompt(kind),
            `Write chapter ${ch.n} ${ch.title}. Use only these facts:\n\n${facts}\n\nDeterministic skeleton:\n${ch.body}`,
          );
          if (error) {
            modelErrors += 1;
            rejections.push(`Chapter ${ch.n}: model call failed — ${error}`);
            return;
          }
          if (!prose) return;

          // Draft-first's conditional banner is a guarantee, not a style: the
          // model rewrites the body, so re-attach the deterministic banner
          // (review finding: `ch.body = prose` silently deleted it).
          const banner = extractConditionsBanner(ch.body);

          // The promise that no figure is invented has to be enforced here, not
          // in the prompt. Prose carrying a number the engine never produced is
          // discarded and the deterministic skeleton stands.
          const check = checkProseFidelity(prose, { facts, payload }, {
            stageClaimable,
            kind,
            assessmentYear: model.assessment_year,
          });
          if (!check.ok) {
            rejections.push(`Chapter ${ch.n}: ${check.reason}`);
            ch.body = `${ch.body}\n\n[Model prose for this chapter was rejected by the fidelity check and discarded. ${check.reason}]`;
            return;
          }
          ch.body = banner ? `${banner}\n\n${prose}` : prose;
          ch.modelName = `${cfg.provider}:${cfg.modelName}`;
        });
        doc.modelName =
          proseTargets.length > 0 && rejections.length === proseTargets.length
            ? "deterministic-assembler"
            : `${cfg.provider}:${cfg.modelName}`;
      }

      const sql = await getSql();
      await sql`insert into drafts (id, user_id, country_id, kind, body, model_name)
        values (${uid()}, ${context.userId}, ${data.countryId}, ${"dar"}, ${JSON.stringify(doc)}, ${doc.modelName})`;
      await writeAudit(
        context.userId,
        data.countryId,
        data.role,
        data.actorName,
        "generate_draft",
        `Draft via ${doc.modelName}` +
          (rejections.length ? ` — ${rejections.length} chapter(s) kept deterministic: ${rejections.slice(0, 3).join("; ")}` : ""),
      );
      return {
        ok: true as const,
        doc,
        usedModel: doc.modelName,
        fidelityRejections: rejections,
        modelErrors,
      };
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
        const { text: prose } = await llmProse(
          cfg,
          draftSystemPrompt() + " Write a short decision memo. Do not pick an option.",
          text,
        );
        // The memo was the one prose path with no fidelity gate — and with
        // rubric research populating core gates, the engine computes a rated
        // stage at Step 1 that unguarded prose could assert as settled.
        if (prose) {
          const check = checkProseFidelity(prose, { facts: text }, {
            stageClaimable: w.claim.claimable,
            assessmentYear: model.assessment_year,
          });
          if (check.ok) text = prose;
        }
      }
      return { ok: true as const, text };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Memo failed", text: "" };
    }
  });

export function scoreLabel(n: number | null): string {
  return formatScore(n);
}
