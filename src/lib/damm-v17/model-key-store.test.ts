import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../db.ts";
import type { ModelListResult } from "../damm/providers.ts";
import {
  refreshStoredModelCatalogue,
  selectStoredModel,
  validateModelCredentialRequest,
  validateModelSelectionRequest,
} from "./model-key-store.ts";

function sqlFor(pg: PGlite): Sql {
  type Queryable = {
    query<T>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
  const wrap = (queryable: Queryable, transaction?: Sql["transaction"]): Sql => {
    const sql = (async <T = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> => {
      let query = strings[0];
      for (let index = 0; index < values.length; index += 1) {
        query += `$${index + 1}${strings[index + 1]}`;
      }
      return (await queryable.query<T>(query, values)).rows;
    }) as Sql;
    sql.query = async <T = Record<string, unknown>>(query: string, values: unknown[] = []) =>
      (await queryable.query<T>(query, values)).rows;
    sql.transaction = transaction ?? (async (callback) => callback(sql));
    return sql;
  };
  return wrap(pg as Queryable, (callback) =>
    pg.transaction(async (transaction) => callback(wrap(transaction as Queryable))),
  );
}

async function database(): Promise<{ pg: PGlite; sql: Sql }> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create table api_keys (
      id text primary key,
      user_id text not null,
      provider text not null,
      kind text not null,
      key_value text not null,
      model_name text not null,
      last_tested_at timestamptz,
      last_test_ok boolean
    );
    create table team_keys (
      id text primary key,
      provider text not null,
      kind text not null,
      key_value text not null,
      model_name text not null
    );
  `);
  return { pg, sql: sqlFor(pg) };
}

describe("stored model-key catalogue", () => {
  it("refreshes an owned personal key without returning its secret", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-1"}, ${"user-1"}, ${"openai"}, ${"llm"}, ${"encrypted-secret"}, ${"gpt-old"})`;

    const result = await refreshStoredModelCatalogue(
      sql,
      "user-1",
      { expectedUserId: "user-1", credential: { scope: "personal", id: "key-1" } },
      false,
      {
        decrypt: (stored) => {
          assert.equal(stored, "encrypted-secret");
          return "sk-private";
        },
        refresh: async (provider, key) => {
          assert.equal(provider, "openai");
          assert.equal(key, "sk-private");
          return { ok: true, models: ["gpt-new", "gpt-stable"], complete: true };
        },
        verify: async (_provider, _key, model) => ({ ok: true, model }),
        now: () => new Date("2026-09-05T00:00:00.000Z"),
      },
    );

    assert.deepEqual(result, {
      ok: true,
      provider: "openai",
      selectedModel: "gpt-old",
      models: ["gpt-new", "gpt-stable"],
      complete: true,
      truncated: false,
      refreshedAt: "2026-09-05T00:00:00.000Z",
    });
    assert.doesNotMatch(JSON.stringify(result), /private|encrypted-secret/);
    await pg.close();
  });

  it("does not reveal another user's key or an administrator-owned team key", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-other"}, ${"user-2"}, ${"openai"}, ${"llm"}, ${"other-secret"}, ${"gpt"})`;
    await sql`insert into team_keys (id, provider, kind, key_value, model_name)
      values (${"team-1"}, ${"anthropic"}, ${"llm"}, ${"team-secret"}, ${"claude"})`;
    let usedSecret = false;
    const deps = {
      decrypt: () => {
        usedSecret = true;
        return "should-not-be-read";
      },
      refresh: async () => ({ ok: true as const, models: ["model"], complete: true }),
      verify: async (_provider: string, _key: string, model: string) => ({
        ok: true as const,
        model,
      }),
      now: () => new Date("2026-09-05T00:00:00.000Z"),
    };

    assert.deepEqual(
      await refreshStoredModelCatalogue(
        sql,
        "user-1",
        {
          expectedUserId: "user-1",
          credential: { scope: "personal", id: "key-other" },
        },
        false,
        deps,
      ),
      { ok: false, error: "Model key not found." },
    );
    assert.deepEqual(
      await refreshStoredModelCatalogue(
        sql,
        "user-1",
        { expectedUserId: "user-1", credential: { scope: "team", id: "team-1" } },
        false,
        deps,
      ),
      { ok: false, error: "Model key not found." },
    );
    assert.equal(usedSecret, false);
    await pg.close();
  });

  it("treats omitted catalogue-completeness metadata as partial", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-1"}, ${"user-1"}, ${"openai"}, ${"llm"}, ${"secret"}, ${"gpt-old"})`;

    const result = await refreshStoredModelCatalogue(
      sql,
      "user-1",
      { expectedUserId: "user-1", credential: { scope: "personal", id: "key-1" } },
      false,
      {
        decrypt: (stored) => stored,
        refresh: async () => ({ ok: true, models: ["gpt-new"] }) as unknown as ModelListResult,
        verify: async (_provider, _key, model) => ({ ok: true, model }),
        now: () => new Date("2026-09-05T00:00:30.000Z"),
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.complete, false);
    await pg.close();
  });

  it("does not expose decryption diagnostics or touch the provider on a corrupt secret", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-1"}, ${"user-1"}, ${"openai"}, ${"llm"}, ${"corrupt-secret"}, ${"gpt-old"})`;
    let contactedProvider = false;

    const result = await refreshStoredModelCatalogue(
      sql,
      "user-1",
      { expectedUserId: "user-1", credential: { scope: "personal", id: "key-1" } },
      false,
      {
        decrypt: () => {
          throw new Error("DAR_KEY_SECRET is wrong; corrupt-secret");
        },
        refresh: async () => {
          contactedProvider = true;
          return { ok: true, models: ["gpt-new"], complete: true };
        },
        verify: async (_provider, _key, model) => ({ ok: true, model }),
        now: () => new Date("2026-09-05T00:00:45.000Z"),
      },
    );

    assert.deepEqual(result, { ok: false, error: "Stored key could not be read securely." });
    assert.doesNotMatch(JSON.stringify(result), /DAR_KEY_SECRET|corrupt-secret|wrong/i);
    assert.equal(contactedProvider, false);
    await pg.close();
  });

  it("revalidates and atomically updates an owned personal key's selected model", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-1"}, ${"user-1"}, ${"openai"}, ${"llm"}, ${"encrypted-secret"}, ${"gpt-old"})`;

    const result = await selectStoredModel(
      sql,
      "user-1",
      {
        expectedUserId: "user-1",
        credential: { scope: "personal", id: "key-1" },
        model: "gpt-new",
      },
      false,
      {
        decrypt: () => "sk-private",
        refresh: async () => ({ ok: true, models: ["gpt-new"], complete: true }),
        verify: async (provider, key, model) => {
          assert.deepEqual([provider, key, model], ["openai", "sk-private", "gpt-new"]);
          return { ok: true, model };
        },
        now: () => new Date("2026-09-05T00:01:00.000Z"),
      },
    );

    assert.deepEqual(result, {
      ok: true,
      provider: "openai",
      selectedModel: "gpt-new",
      verifiedAt: "2026-09-05T00:01:00.000Z",
    });
    const rows = await sql<{ model_name: string; last_test_ok: boolean }>`
      select model_name, last_test_ok from api_keys where id = ${"key-1"}`;
    assert.deepEqual(rows[0], { model_name: "gpt-new", last_test_ok: true });
    await pg.close();
  });

  it("lets an authorised administrator select a team model without exposing the key", async () => {
    const { pg, sql } = await database();
    await sql`insert into team_keys (id, provider, kind, key_value, model_name)
      values (${"team-1"}, ${"anthropic"}, ${"llm"}, ${"team-secret"}, ${"claude-old"})`;

    const result = await selectStoredModel(
      sql,
      "admin-1",
      {
        expectedUserId: "admin-1",
        credential: { scope: "team", id: "team-1" },
        model: "claude-new",
      },
      true,
      {
        decrypt: (stored) => {
          assert.equal(stored, "team-secret");
          return "sk-team";
        },
        refresh: async () => ({ ok: true, models: ["claude-new"], complete: true }),
        verify: async (provider, key, model) => {
          assert.deepEqual([provider, key, model], ["anthropic", "sk-team", "claude-new"]);
          return { ok: true, model };
        },
        now: () => new Date("2026-09-05T00:01:30.000Z"),
      },
    );

    assert.deepEqual(result, {
      ok: true,
      provider: "anthropic",
      selectedModel: "claude-new",
      verifiedAt: "2026-09-05T00:01:30.000Z",
    });
    assert.doesNotMatch(JSON.stringify(result), /team-secret|sk-team/);
    const rows = await sql<{ model_name: string }>`
      select model_name from team_keys where id = ${"team-1"}`;
    assert.deepEqual(rows[0], { model_name: "claude-new" });
    await pg.close();
  });

  it("refuses to write a selection when the credential changes during verification", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-1"}, ${"user-1"}, ${"openai"}, ${"llm"}, ${"secret-v1"}, ${"gpt-old"})`;

    const result = await selectStoredModel(
      sql,
      "user-1",
      {
        expectedUserId: "user-1",
        credential: { scope: "personal", id: "key-1" },
        model: "gpt-new",
      },
      false,
      {
        decrypt: (stored) => stored,
        refresh: async () => ({ ok: true, models: ["gpt-new"], complete: true }),
        verify: async (_provider, _key, model) => {
          await sql`update api_keys set key_value = ${"secret-v2"} where id = ${"key-1"}`;
          return { ok: true, model };
        },
        now: () => new Date("2026-09-05T00:02:00.000Z"),
      },
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /credential changed during model verification/i);
    const rows = await sql<{ key_value: string; model_name: string }>`
      select key_value, model_name from api_keys where id = ${"key-1"}`;
    assert.deepEqual(rows[0], { key_value: "secret-v2", model_name: "gpt-old" });
    await pg.close();
  });

  it("refuses a last-writer-wins overwrite when the selected model changes concurrently", async () => {
    const { pg, sql } = await database();
    await sql`insert into api_keys (id, user_id, provider, kind, key_value, model_name)
      values (${"key-1"}, ${"user-1"}, ${"openai"}, ${"llm"}, ${"secret-v1"}, ${"gpt-old"})`;

    const result = await selectStoredModel(
      sql,
      "user-1",
      {
        expectedUserId: "user-1",
        credential: { scope: "personal", id: "key-1" },
        model: "gpt-new",
      },
      false,
      {
        decrypt: (stored) => stored,
        refresh: async () => ({ ok: true, models: ["gpt-new"], complete: true }),
        verify: async (_provider, _key, model) => {
          await sql`update api_keys set model_name = ${"gpt-other"} where id = ${"key-1"}`;
          return { ok: true, model };
        },
        now: () => new Date("2026-09-05T00:02:30.000Z"),
      },
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /credential changed during model verification/i);
    const rows = await sql<{ model_name: string }>`
      select model_name from api_keys where id = ${"key-1"}`;
    assert.deepEqual(rows[0], { model_name: "gpt-other" });
    await pg.close();
  });

  it("rolls back a team model update when its audit write fails", async () => {
    const { pg, sql } = await database();
    await sql`insert into team_keys (id, provider, kind, key_value, model_name)
      values (${"team-1"}, ${"anthropic"}, ${"llm"}, ${"team-secret"}, ${"claude-old"})`;

    await assert.rejects(
      () =>
        selectStoredModel(
          sql,
          "admin-1",
          {
            expectedUserId: "admin-1",
            credential: { scope: "team", id: "team-1" },
            model: "claude-new",
          },
          true,
          {
            decrypt: (stored) => stored,
            refresh: async () => ({ ok: true, models: ["claude-new"], complete: true }),
            verify: async (_provider, _key, model) => ({ ok: true, model }),
            now: () => new Date("2026-09-05T00:03:00.000Z"),
          },
          async () => {
            throw new Error("simulated audit failure");
          },
        ),
      /simulated audit failure/i,
    );
    const rows = await sql<{ model_name: string }>`
      select model_name from team_keys where id = ${"team-1"}`;
    assert.deepEqual(rows[0], { model_name: "claude-old" });
    await pg.close();
  });

  it("validates the runtime request shape and strips unknown browser fields", () => {
    assert.deepEqual(
      validateModelCredentialRequest({
        expectedUserId: "user-1",
        credential: { scope: "personal", id: "key-1", provider: "attacker-choice" },
        key: "must-not-pass",
      }),
      {
        expectedUserId: "user-1",
        credential: { scope: "personal", id: "key-1" },
      },
    );
    assert.deepEqual(
      validateModelSelectionRequest({
        expectedUserId: "user-1",
        credential: { scope: "team", id: "team-1" },
        model: " claude-opus-5 ",
      }),
      {
        expectedUserId: "user-1",
        credential: { scope: "team", id: "team-1" },
        model: "claude-opus-5",
      },
    );
    for (const invalid of [
      null,
      {},
      { expectedUserId: "user-1", credential: { scope: "other", id: "key-1" } },
      { expectedUserId: "user-1", credential: { scope: "personal", id: "" } },
      { expectedUserId: "user-1", credential: { scope: "personal", id: "key 1" } },
    ]) {
      assert.throws(() => validateModelCredentialRequest(invalid), /model credential request/i);
    }
    assert.throws(
      () =>
        validateModelSelectionRequest({
          expectedUserId: "user-1",
          credential: { scope: "personal", id: "key-1" },
          model: "contains whitespace",
        }),
      /model selection request/i,
    );
  });
});
