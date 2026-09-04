/**
 * DAR Studio server layer — DAMM v1.7 domain on the surviving chassis.
 *
 * The domain half works the way the scoring workbook does: an assessor edits
 * the six entry columns (value, source, source URL, tier, year, assessor
 * level) plus the ratification hold and notes; everything else — evidence
 * class, level, staleness, pillar profile, prerequisites, the readiness
 * matrix — is derived by the scorer on every write and stored only as a
 * summary for list views. Nothing derivable is ever entered, and no entry is
 * ever silently rewritten.
 *
 * The chassis half (settings, personal and team API keys) is carried over
 * from the previous layer unchanged in behavior: BYOK encryption, save-time
 * verification, and admin-managed team keys all work as before.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { uid } from "@/lib/utils";

import { model } from "./model.ts";
import { Scorer } from "./scorer.ts";
import {
  deriveRow,
  fixtureToRecord,
  toObservations,
  type EvidenceRecord,
  type FixtureObservation,
} from "./evidence.ts";
import type { Assessment, SourceTier } from "./types.ts";

import egyptObs from "./fixtures/egypt-observations.json" with { type: "json" };
import nigeriaObs from "./fixtures/nigeria-observations.json" with { type: "json" };

import { economyByName, fetchEconomies, type Economy } from "@/lib/damm/countries";
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  fingerprintSecret,
  isEncrypted,
} from "@/lib/damm/crypto";
import {
  PROVIDER_IDS,
  defaultModelFor,
  providerDef,
  verifyProviderKey,
} from "@/lib/damm/providers";
import { SEARCH_PROVIDER_IDS, isSearchProviderId, verifySearchKey } from "@/lib/damm/search";
import { teamAdminEmails } from "@/lib/damm/teamkeys";
import {
  saveUserSettingsPatch,
  validateSettingsPatch,
  type UserSettingsMutation,
} from "./settings-store.ts";

export type { Economy };

const scorer = new Scorer(model);

/* ---------- storage shapes ---------- */

type EvidenceDb = {
  id: string;
  indicator_id: string;
  value_raw: string | null;
  observation_year: number | null;
  source_name: string | null;
  source_url: string | null;
  source_tier: string | null;
  assessor_level: number | null;
  ratification_hold: boolean;
  assessor_role: string | null;
  assessor_name: string | null;
  assessed_at: string | null;
  notes: string | null;
};

function toRecord(r: EvidenceDb): EvidenceRecord {
  return {
    indicatorId: r.indicator_id,
    valueRaw: r.value_raw,
    observationYear: r.observation_year,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    sourceTier: (r.source_tier as SourceTier) || null,
    assessorLevel: r.assessor_level,
    ratificationHold: Boolean(r.ratification_hold),
    assessorRole: r.assessor_role,
    assessorName: r.assessor_name,
    assessedAt: r.assessed_at,
    notes: r.notes,
  };
}

export async function writeAudit(
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

export async function loadRecords(countryId: string): Promise<EvidenceRecord[]> {
  const sql = await getSql();
  const rows = await sql<EvidenceDb>`select * from evidence where country_id = ${countryId}`;
  return rows.map(toRecord);
}

/** Rescore from the stored rows and persist the derived summary for list views. */
export async function rescore(countryId: string): Promise<Assessment> {
  const rows = await loadRecords(countryId);
  const assessment = scorer.run(toObservations(rows));
  const sql = await getSql();
  await sql`update countries set
    assessment = ${JSON.stringify(assessment)},
    model_version = ${`${model.version} rev${model.revision}`},
    updated_at = now()
    where id = ${countryId}`;
  return assessment;
}

/* ---------- portfolio ---------- */

export interface CountrySummary {
  id: string;
  name: string;
  iso3: string;
  modelVersion: string | null;
  assessment: Assessment | null;
  createdAt: string;
  updatedAt: string;
}

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
      model_version: string | null;
      assessment: Assessment | string | null;
      created_at: string;
      updated_at: string;
    }>`select id, name, iso3, model_version, assessment, created_at, updated_at
      from countries where user_id = ${context.userId} and deleted_at is null
      order by updated_at desc`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      iso3: r.iso3,
      modelVersion: r.model_version,
      assessment:
        typeof r.assessment === "string"
          ? (JSON.parse(r.assessment) as Assessment)
          : (r.assessment ?? null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })) satisfies CountrySummary[];
  });

async function insertCountry(
  userId: string,
  name: string,
  iso3: string,
  records: EvidenceRecord[],
  actor: { role: string; name: string },
  auditDetail: string,
) {
  const sql = await getSql();
  const id = uid();
  await sql`insert into countries (id, user_id, name, iso3) values (${id}, ${userId}, ${name}, ${iso3})`;
  for (const r of records) {
    await sql`insert into evidence (
      id, user_id, country_id, indicator_id, value_raw, observation_year,
      source_name, source_url, source_tier, assessor_level, ratification_hold,
      assessor_role, assessor_name, assessed_at, notes
    ) values (
      ${uid()}, ${userId}, ${id}, ${r.indicatorId}, ${r.valueRaw}, ${r.observationYear},
      ${r.sourceName}, ${r.sourceUrl}, ${r.sourceTier}, ${r.assessorLevel}, ${r.ratificationHold},
      ${r.assessorRole}, ${r.assessorName}, ${r.assessedAt}, ${r.notes}
    )`;
  }
  await rescore(id);
  await writeAudit(userId, id, actor.role, actor.name, "create_country", auditDetail);
  return id;
}

function emptyRecords(): EvidenceRecord[] {
  return model.indicators.map((i) => ({
    indicatorId: i.id,
    valueRaw: null,
    observationYear: null,
    sourceName: null,
    sourceUrl: null,
    sourceTier: null,
    assessorLevel: null,
    ratificationHold: false,
    assessorRole: null,
    assessorName: null,
    assessedAt: null,
    notes: null,
  }));
}

export const createCountry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const eco = economyByName(await fetchEconomies(), data.name);
    if (!eco)
      return { ok: false as const, error: "Choose a country from the World Bank economy list." };
    const id = await insertCountry(
      context.userId,
      eco.name,
      eco.iso3,
      emptyRecords(),
      { role: data.role, name: data.actorName },
      `Opened ${eco.iso3}: ${model.indicators.length} indicator rows, all awaiting evidence.`,
    );
    return { ok: true as const, id, name: eco.name, iso3: eco.iso3 };
  });

/**
 * The demonstration pack is the real thing: the Egypt and Nigeria assessments
 * produced by the model's own test runs, loaded row for row — values, sources,
 * tiers, holds and gaps exactly as recorded. A unit test holds the stored form
 * to the pipeline's published figures.
 */
const DEMO: Record<string, { name: string; obs: Record<string, FixtureObservation> }> = {
  EGY: { name: "Egypt, Arab Rep.", obs: egyptObs as Record<string, FixtureObservation> },
  NGA: { name: "Nigeria", obs: nigeriaObs as Record<string, FixtureObservation> },
};

export const loadDemoPack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { which: "EGY" | "NGA"; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const demo = DEMO[data.which];
    if (!demo) return { ok: false as const, error: "Unknown demonstration pack." };
    const actor = { role: "Assessment pipeline", name: "Worked example" };
    const records = Object.entries(demo.obs).map(([iid, f]) => fixtureToRecord(iid, f, actor));
    const id = await insertCountry(
      context.userId,
      demo.name,
      data.which,
      records,
      { role: data.role, name: data.actorName },
      `Loaded the ${demo.name} worked example — the assessment produced by the model's test runs.`,
    );
    return { ok: true as const, id };
  });

export const deleteCountry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; role: string; actorName: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ name: string }>`
      update countries set deleted_at = now()
      where id = ${data.id} and user_id = ${context.userId} and deleted_at is null
      returning name`;
    if (!rows.length) return { ok: false as const, error: "Country not found" };
    await writeAudit(
      context.userId,
      data.id,
      data.role,
      data.actorName,
      "delete_country",
      `Removed ${rows[0].name}.`,
    );
    return { ok: true as const };
  });

/* ---------- workspace ---------- */

export interface WorkspaceRow extends EvidenceRecord {
  cls: string;
  level: number | null;
  stale: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  iso3: string;
  updatedAt: string;
  modelVersion: string;
  evidence: WorkspaceRow[];
  assessment: Assessment;
}

async function loadWorkspaceFor(
  userId: string,
  countryId: string,
): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: string }> {
  const sql = await getSql();
  const c = await sql<{ id: string; name: string; iso3: string; updated_at: string }>`
    select id, name, iso3, updated_at from countries
    where id = ${countryId} and user_id = ${userId} and deleted_at is null`;
  if (!c.length) return { ok: false, error: "Country not found" };
  const records = await loadRecords(countryId);
  const assessment = scorer.run(toObservations(records));
  const evidence: WorkspaceRow[] = records.map((r) => {
    const def = model.indicators.find((i) => i.id === r.indicatorId);
    const d = def ? deriveRow(def, r) : { cls: "" as const, level: null, stale: false };
    return { ...r, cls: d.cls, level: d.level, stale: d.stale };
  });
  return {
    ok: true,
    workspace: {
      id: c[0].id,
      name: c[0].name,
      iso3: c[0].iso3,
      updatedAt: c[0].updated_at,
      modelVersion: `${model.version} rev${model.revision}`,
      evidence,
      assessment,
    },
  };
}

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string }) => input)
  .handler(async ({ context, data }) => loadWorkspaceFor(context.userId, data.countryId));

const TIERS = new Set(["T1", "T2", "T3", "T4", "T5"]);

export const updateEvidence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      countryId: string;
      indicatorId: string;
      role: string;
      actorName: string;
      valueRaw?: string | null;
      observationYear?: number | null;
      sourceName?: string | null;
      sourceUrl?: string | null;
      sourceTier?: string | null;
      assessorLevel?: number | null;
      ratificationHold?: boolean;
      notes?: string | null;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const def = model.indicators.find((i) => i.id === data.indicatorId);
    if (!def) return { ok: false as const, error: "Unknown indicator" };
    if (data.sourceTier !== undefined && data.sourceTier !== null && !TIERS.has(data.sourceTier)) {
      return { ok: false as const, error: "Tier must be T1–T5." };
    }
    if (
      data.assessorLevel !== undefined &&
      data.assessorLevel !== null &&
      !(Number.isInteger(data.assessorLevel) && data.assessorLevel >= 1 && data.assessorLevel <= 5)
    ) {
      return { ok: false as const, error: "The assessor level is 1–5." };
    }
    const sql = await getSql();
    const curRows = await sql<EvidenceDb>`
      select * from evidence
      where country_id = ${data.countryId} and indicator_id = ${data.indicatorId} and user_id = ${context.userId}`;
    const cur = curRows[0];
    if (!cur) return { ok: false as const, error: "Row not found" };

    const pick = <T>(next: T | undefined, prev: T): T => (next !== undefined ? next : prev);
    const valueRaw = pick(data.valueRaw, cur.value_raw);
    const assessorLevel = pick(data.assessorLevel, cur.assessor_level);
    const hold = pick(data.ratificationHold, cur.ratification_hold);
    const touchedLevel = data.assessorLevel !== undefined;

    await sql`update evidence set
      value_raw = ${valueRaw},
      observation_year = ${pick(data.observationYear, cur.observation_year)},
      source_name = ${pick(data.sourceName, cur.source_name)},
      source_url = ${pick(data.sourceUrl, cur.source_url)},
      source_tier = ${pick(data.sourceTier, cur.source_tier)},
      assessor_level = ${assessorLevel},
      ratification_hold = ${hold},
      assessor_role = ${touchedLevel ? data.role : cur.assessor_role},
      assessor_name = ${touchedLevel ? data.actorName : cur.assessor_name},
      assessed_at = ${touchedLevel ? new Date().toISOString() : cur.assessed_at},
      notes = ${pick(data.notes, cur.notes)}
      where id = ${cur.id}`;

    const assessment = await rescore(data.countryId);
    const derived = deriveRow(
      def,
      toRecord({
        ...cur,
        value_raw: valueRaw,
        assessor_level: assessorLevel,
        ratification_hold: hold,
        observation_year: pick(data.observationYear, cur.observation_year),
        source_name: pick(data.sourceName, cur.source_name),
        source_url: pick(data.sourceUrl, cur.source_url),
        source_tier: pick(data.sourceTier, cur.source_tier),
        notes: pick(data.notes, cur.notes),
      }),
    );
    await writeAudit(
      context.userId,
      data.countryId,
      data.role,
      data.actorName,
      "update_evidence",
      `${data.indicatorId}: class=${derived.cls || "empty"} level=${derived.level ?? "—"}${hold ? " (hold)" : ""} tier=${pick(data.sourceTier, cur.source_tier) ?? "—"}`,
    );
    return { ok: true as const, assessment };
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { countryId: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      at: string;
      role: string;
      actor_name: string;
      action: string;
      detail: string | null;
    }>`
      select at, role, actor_name, action, detail from audit
      where country_id = ${data.countryId} and user_id = ${context.userId}
      order by at desc limit 200`;
    return rows.map((r) => ({
      at: r.at,
      role: r.role,
      actorName: r.actor_name,
      action: r.action,
      detail: r.detail,
    }));
  });

/* ---------- settings and BYOK keys (chassis, carried over) ---------- */

async function isTeamAdmin(userId: string): Promise<boolean> {
  const emails = teamAdminEmails();
  if (!emails.length) return false;
  const sql = await getSql();
  const rows = await sql<{ email: string }>`select email from "user" where id = ${userId}`;
  return Boolean(rows[0] && emails.includes(rows[0].email.toLowerCase()));
}

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
    const teamKeys = await sql<{
      id: string;
      provider: string;
      kind: string;
      last4: string;
      model_name: string;
      created_at: string;
    }>`
      select id, provider, kind, last4, model_name, created_at from team_keys order by kind, provider`;
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
      /** Whether this user may manage team keys (DAR_ADMIN_EMAILS). */
      isTeamAdmin: await isTeamAdmin(context.userId),
      /** Admin-managed shared keys — identity only, never the key material. */
      teamKeys,
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: UserSettingsMutation) => validateSettingsPatch(input))
  .handler(async ({ context, data }) => {
    if (context.userId !== data.expectedUserId) {
      throw new Error("Authenticated user changed; reload settings before saving.");
    }
    const sql = await getSql();
    await saveUserSettingsPatch(sql, context.userId, data);
    return { ok: true as const };
  });

/** Provider and search-provider catalogues, for the Settings form. */
export const listProviders = createServerFn({ method: "GET" }).handler(async () => {
  const models = PROVIDER_IDS.map((id) => {
    const def = providerDef(id)!;
    return {
      id: def.id,
      label: def.label,
      defaultModel: def.defaultModel,
      consoleUrl: def.consoleUrl,
    };
  });
  const search = SEARCH_PROVIDER_IDS.map((id) => {
    const def = {
      exa: { label: "Exa", console: "https://dashboard.exa.ai/api-keys" },
      jina: { label: "Jina", console: "https://jina.ai/api-dashboard/" },
    }[id];
    return { id, label: def.label, consoleUrl: def.console };
  });
  return { models, search };
});

export const saveApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: { provider: string; key: string; modelName?: string; kind?: "llm" | "search" }) =>
      input,
  )
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
    const modelName =
      kind === "search" ? "" : data.modelName?.trim() || defaultModelFor(data.provider);
    const stored = encryptSecret(key);
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, fingerprint, last4, model_name, encrypted)
      values (${uid()}, ${context.userId}, ${data.provider}, ${kind}, ${stored},
        ${fingerprintSecret(key)}, ${key.slice(-4)}, ${modelName}, ${isEncrypted(stored)})`;

    // Verify at save time, not only when Test is pressed. A first live run
    // shipped a mistyped model id that every later call would have 404'd on;
    // the catalogue check that catches it costs one request and belongs here.
    const warnings: string[] = [];
    if (!isEncrypted(stored)) {
      warnings.push(
        "Stored without encryption — set DAR_KEY_SECRET in the environment to protect keys at rest.",
      );
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
    const settings = await sql<{
      active_provider: string | null;
      active_search_provider: string | null;
    }>`
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

/**
 * Save a TEAM key: admin only (DAR_ADMIN_EMAILS). Same encryption and
 * save-time verification as a personal key; used by every team member as the
 * fallback whenever they hold no personal key of that kind.
 */
export const saveTeamKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: { provider: string; key: string; modelName?: string; kind?: "llm" | "search" }) =>
      input,
  )
  .handler(async ({ context, data }) => {
    if (!(await isTeamAdmin(context.userId))) {
      return {
        ok: false as const,
        error: "Team keys can only be managed by an administrator (DAR_ADMIN_EMAILS).",
      };
    }
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
    const modelName =
      kind === "search" ? "" : data.modelName?.trim() || defaultModelFor(data.provider);
    const stored = encryptSecret(key);
    await sql`delete from team_keys where provider = ${data.provider} and kind = ${kind}`;
    await sql`insert into team_keys (id, kind, provider, key_value, fingerprint, last4, model_name, created_by)
      values (${uid()}, ${kind}, ${data.provider}, ${stored}, ${fingerprintSecret(key)}, ${key.slice(-4)}, ${modelName}, ${context.userId})`;

    const warnings: string[] = [];
    if (!isEncrypted(stored)) {
      warnings.push(
        "Stored without encryption — set DAR_KEY_SECRET in the environment to protect keys at rest.",
      );
    }
    let verified: boolean | null = null;
    if (kind === "llm") {
      const check = await verifyProviderKey(data.provider, key, modelName);
      verified = check.ok;
      if (!check.ok && check.error) warnings.push(check.error);
      if (check.warning) warnings.push(check.warning);
    }
    await writeAudit(
      context.userId,
      null,
      "Admin",
      "team-keys",
      "team_key_saved",
      `${kind} key for ${data.provider} (…${key.slice(-4)}) stored for the team.`,
    );
    return {
      ok: true as const,
      encrypted: isEncrypted(stored),
      verified,
      warning: warnings.length ? warnings.join(" ") : undefined,
    };
  });

export const deleteTeamKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    if (!(await isTeamAdmin(context.userId))) {
      return {
        ok: false as const,
        error: "Team keys can only be managed by an administrator (DAR_ADMIN_EMAILS).",
      };
    }
    const sql = await getSql();
    const rows = await sql<{ provider: string; kind: string }>`
      delete from team_keys where id = ${data.id} returning provider, kind`;
    if (rows.length) {
      await writeAudit(
        context.userId,
        null,
        "Admin",
        "team-keys",
        "team_key_removed",
        `${rows[0].kind} key for ${rows[0].provider} removed from the team.`,
      );
    }
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

export const testApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      provider: string;
      kind: string;
      key_value: string;
      model_name: string;
    }>`
      select provider, kind, key_value, model_name from api_keys where id = ${data.id} and user_id = ${context.userId}`;
    const row = rows[0];
    if (!row) return { ok: false as const, error: "Key not found" };

    let plain: string;
    try {
      plain = decryptSecret(row.key_value);
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Stored key could not be read.",
      };
    }

    const result: { ok: boolean; error?: string; warning?: string } =
      row.kind === "search"
        ? await verifySearchKey(row.provider, plain)
        : await verifyProviderKey(row.provider, plain, row.model_name);

    await sql`update api_keys set last_tested_at = now(), last_test_ok = ${result.ok} where id = ${data.id}`;
    if (!result.ok) return { ok: false as const, error: result.error ?? "Test failed" };
    return { ok: true as const, warning: result.warning ?? null };
  });
