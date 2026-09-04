import type { Sql } from "../db.ts";

export type UserSettingsFields = {
  role?: string;
  actorName?: string;
  activeProvider?: string | null;
  activeSearchProvider?: string | null;
};

export type UserSettingsMutation = UserSettingsFields & {
  expectedUserId: string;
};

const FIELD_NAMES = ["role", "actorName", "activeProvider", "activeSearchProvider"] as const;

export function validateSettingsPatch(input: unknown): UserSettingsMutation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Settings patch must be an object.");
  }
  const source = input as Record<string, unknown>;
  if (typeof source.expectedUserId !== "string" || !source.expectedUserId.trim()) {
    throw new Error("Settings patch requires the expected authenticated user.");
  }

  const patch: UserSettingsMutation = { expectedUserId: source.expectedUserId };
  for (const field of FIELD_NAMES) {
    const value = source[field];
    if (value === undefined) continue;
    const permitsNull = field === "activeProvider" || field === "activeSearchProvider";
    if (typeof value !== "string" && !(permitsNull && value === null)) {
      throw new Error(`Invalid settings field: ${field}.`);
    }
    Object.assign(patch, { [field]: value });
  }
  if (FIELD_NAMES.every((field) => patch[field] === undefined)) {
    throw new Error("Provide at least one settings field.");
  }
  return patch;
}

/** Atomically updates only the supplied settings fields, preserving all siblings. */
export async function saveUserSettingsPatch(
  sql: Sql,
  userId: string,
  patch: UserSettingsFields,
): Promise<void> {
  const hasRole = patch.role !== undefined;
  const hasActorName = patch.actorName !== undefined;
  const hasProvider = patch.activeProvider !== undefined;
  const hasSearchProvider = patch.activeSearchProvider !== undefined;

  await sql`insert into user_settings
    (user_id, acting_role, actor_name, active_provider, active_search_provider)
    values (
      ${userId},
      ${patch.role ?? "TTL"},
      ${patch.actorName ?? ""},
      ${patch.activeProvider ?? null},
      ${patch.activeSearchProvider ?? null}
    )
    on conflict (user_id) do update set
      acting_role = case
        when ${hasRole} then excluded.acting_role else user_settings.acting_role end,
      actor_name = case
        when ${hasActorName} then excluded.actor_name else user_settings.actor_name end,
      active_provider = case
        when ${hasProvider} then excluded.active_provider else user_settings.active_provider end,
      active_search_provider = case
        when ${hasSearchProvider}
          then excluded.active_search_provider else user_settings.active_search_provider end`;
}
