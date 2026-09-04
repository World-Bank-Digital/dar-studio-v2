import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Sql } from "../db.ts";
import { saveUserSettingsPatch, validateSettingsPatch } from "./settings-store.ts";

function sqlFor(pg: PGlite): Sql {
  type Queryable = {
    query<T>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  };
  const run = (queryable: Queryable): Sql => {
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
    sql.transaction = async (callback) => callback(sql);
    return sql;
  };
  return run(pg);
}

describe("atomic user-settings patches", () => {
  it("preserves every field omitted by a concurrent UI surface", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table user_settings (
        user_id text primary key,
        active_provider text,
        acting_role text not null default 'TTL',
        actor_name text,
        active_search_provider text
      );
    `);
    const sql = sqlFor(pg);
    await sql`insert into user_settings
      (user_id, acting_role, actor_name, active_provider, active_search_provider)
      values (${"user-1"}, ${"Model steward"}, ${"Original actor"}, ${"anthropic"}, ${"exa"})`;

    await saveUserSettingsPatch(sql, "user-1", { actorName: "Edited actor" });
    await saveUserSettingsPatch(sql, "user-1", { activeProvider: "openai" });

    const rows = await sql<{
      acting_role: string;
      actor_name: string;
      active_provider: string;
      active_search_provider: string;
    }>`select acting_role, actor_name, active_provider, active_search_provider
       from user_settings where user_id = ${"user-1"}`;
    assert.deepEqual(rows[0], {
      acting_role: "Model steward",
      actor_name: "Edited actor",
      active_provider: "openai",
      active_search_provider: "exa",
    });
    await pg.close();
  });

  it("rejects an empty patch and strips unknown input fields", () => {
    assert.throws(
      () => validateSettingsPatch({ expectedUserId: "user-1" }),
      /at least one settings field/i,
    );
    assert.deepEqual(
      validateSettingsPatch({
        expectedUserId: "user-1",
        role: "TTL",
        unexpected: "discard me",
      }),
      { expectedUserId: "user-1", role: "TTL" },
    );
  });
});
