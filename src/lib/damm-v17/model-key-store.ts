import type { Sql } from "../db.ts";
import { decryptSecret } from "../damm/crypto.ts";
import {
  refreshModelCatalogue,
  selectableModelIds,
  verifySelectableModel,
  type ModelListResult,
} from "../damm/providers.ts";

export type ModelCredentialRef = { scope: "personal"; id: string } | { scope: "team"; id: string };

export interface ModelCredentialRequest {
  expectedUserId: string;
  credential: ModelCredentialRef;
}

export interface ModelSelectionRequest extends ModelCredentialRequest {
  model: string;
}

interface ModelCredentialRow {
  id: string;
  provider: string;
  key_value: string;
  model_name: string;
}

export interface ModelKeyDependencies {
  decrypt(stored: string): string;
  refresh(provider: string, key: string): Promise<ModelListResult>;
  verify(
    provider: string,
    key: string,
    model: string,
  ): Promise<{ ok: true; model: string } | { ok: false; error: string }>;
  now(): Date;
}

type ModelSelectionResult = {
  ok: true;
  provider: string;
  selectedModel: string;
  verifiedAt: string;
};

export type ModelSelectionCommitHook = (
  transaction: Sql,
  result: ModelSelectionResult,
) => Promise<void>;

const dependencies: ModelKeyDependencies = {
  decrypt: decryptSecret,
  refresh: refreshModelCatalogue,
  verify: verifySelectableModel,
  now: () => new Date(),
};

function requestRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid model credential request.");
  }
  return input as Record<string, unknown>;
}

/** Strip untrusted browser input to the identity fields used by the server. */
export function validateModelCredentialRequest(input: unknown): ModelCredentialRequest {
  const source = requestRecord(input);
  const credential = requestRecord(source.credential);
  const expectedUserId =
    typeof source.expectedUserId === "string" ? source.expectedUserId.trim() : "";
  const scope = credential.scope;
  const id = typeof credential.id === "string" ? credential.id.trim() : "";
  if (
    !expectedUserId ||
    (scope !== "personal" && scope !== "team") ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)
  ) {
    throw new Error("Invalid model credential request.");
  }
  return { expectedUserId, credential: { scope, id } };
}

/** Validate a model id before any credential or provider access occurs. */
export function validateModelSelectionRequest(input: unknown): ModelSelectionRequest {
  const source = requestRecord(input);
  const request = validateModelCredentialRequest(source);
  const model = typeof source.model === "string" ? source.model.trim() : "";
  if (selectableModelIds([model])[0] !== model) {
    throw new Error("Invalid model selection request.");
  }
  return { ...request, model };
}

async function readCredential(
  sql: Sql,
  userId: string,
  credential: ModelCredentialRef,
  canManageTeam: boolean,
): Promise<ModelCredentialRow | null> {
  if (credential.scope === "team") {
    if (!canManageTeam) return null;
    const rows = await sql<ModelCredentialRow>`select id, provider, key_value, model_name
      from team_keys where id = ${credential.id} and kind = 'llm'`;
    return rows[0] ?? null;
  }
  const rows = await sql<ModelCredentialRow>`select id, provider, key_value, model_name
    from api_keys
    where id = ${credential.id} and user_id = ${userId} and kind = 'llm'`;
  return rows[0] ?? null;
}

function readableSecret(
  row: ModelCredentialRow,
  deps: ModelKeyDependencies,
): { ok: true; key: string } | { ok: false; error: string } {
  try {
    return { ok: true, key: deps.decrypt(row.key_value) };
  } catch {
    return { ok: false, error: "Stored key could not be read securely." };
  }
}

export async function refreshStoredModelCatalogue(
  sql: Sql,
  userId: string,
  request: ModelCredentialRequest,
  canManageTeam: boolean,
  deps: ModelKeyDependencies = dependencies,
): Promise<
  | {
      ok: true;
      provider: string;
      selectedModel: string;
      models: string[];
      complete: boolean;
      truncated: boolean;
      refreshedAt: string;
    }
  | { ok: false; error: string }
> {
  if (request.expectedUserId !== userId) {
    return { ok: false, error: "Authenticated user changed; reload settings before continuing." };
  }
  const row = await readCredential(sql, userId, request.credential, canManageTeam);
  if (!row) return { ok: false, error: "Model key not found." };
  const secret = readableSecret(row, deps);
  if (!secret.ok) return secret;
  const catalogue = await deps.refresh(row.provider, secret.key);
  if (!catalogue.ok) {
    return { ok: false, error: catalogue.error ?? "The provider catalogue could not be read." };
  }
  return {
    ok: true,
    provider: row.provider,
    selectedModel: row.model_name,
    models: catalogue.models ?? [],
    complete: catalogue.complete === true,
    truncated: catalogue.truncated === true,
    refreshedAt: deps.now().toISOString(),
  };
}

export async function selectStoredModel(
  sql: Sql,
  userId: string,
  request: ModelSelectionRequest,
  canManageTeam: boolean,
  deps: ModelKeyDependencies = dependencies,
  afterUpdate?: ModelSelectionCommitHook,
): Promise<ModelSelectionResult | { ok: false; error: string }> {
  if (request.expectedUserId !== userId) {
    return { ok: false, error: "Authenticated user changed; reload settings before continuing." };
  }
  const row = await readCredential(sql, userId, request.credential, canManageTeam);
  if (!row) return { ok: false, error: "Model key not found." };
  const secret = readableSecret(row, deps);
  if (!secret.ok) return secret;
  const selection = await deps.verify(row.provider, secret.key, request.model);
  if (!selection.ok) return selection;

  const verifiedAt = deps.now();
  const result: ModelSelectionResult = {
    ok: true,
    provider: row.provider,
    selectedModel: selection.model,
    verifiedAt: verifiedAt.toISOString(),
  };

  return sql.transaction(async (transaction) => {
    const updated =
      request.credential.scope === "team"
        ? await transaction<{ id: string }>`update team_keys set model_name = ${selection.model}
            where id = ${row.id} and kind = 'llm' and provider = ${row.provider}
              and key_value = ${row.key_value} and model_name = ${row.model_name}
            returning id`
        : await transaction<{ id: string }>`update api_keys
            set model_name = ${selection.model}, last_tested_at = ${verifiedAt}, last_test_ok = true
            where id = ${row.id} and user_id = ${userId} and kind = 'llm'
              and provider = ${row.provider} and key_value = ${row.key_value}
              and model_name = ${row.model_name}
            returning id`;
    if (!updated.length) {
      return {
        ok: false as const,
        error:
          "The stored credential changed during model verification, or another selection was saved; refresh and try again.",
      };
    }
    await afterUpdate?.(transaction, result);
    return result;
  });
}
