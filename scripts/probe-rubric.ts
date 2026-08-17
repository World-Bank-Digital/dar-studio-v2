/**
 * Live probe: research ONE rubric with the stored keys, printing the funnel a
 * delivery run only shows in aggregate — queries tried, hosts read, and the
 * proposal or the precise rejection. Exists because the acid-test registry
 * (3.3) burned three 70-minute delivery runs where a two-minute probe would
 * have named the problem (LEARNINGS L19/L21).
 *
 *   node --env-file=.env --experimental-strip-types scripts/probe-rubric.ts 3.3
 *
 * Read-only against the app database (keys are loaded, nothing is written);
 * it spends real Jina/OpenRouter quota.
 */
import { getSql } from "../src/lib/db.ts";
import { decryptSecret } from "../src/lib/damm/crypto.ts";
import { model } from "../src/lib/damm/model.ts";
import { researchRubric, buildRubricQueries } from "../src/lib/damm/rubric.ts";
import { isSearchProviderId } from "../src/lib/damm/search.ts";

const QA_EMAIL = "dbcheck@example.com";
const indicatorId = process.argv[2] ?? "3.3";

const indicator = model.indicators.find((i) => i.id === indicatorId);
if (!indicator) {
  console.error(`No indicator ${indicatorId}`);
  process.exit(1);
}

const sql = await getSql();
const users = await sql<{ id: string }>`select id from "user" where email = ${QA_EMAIL}`;
if (!users.length) {
  console.error(`No user ${QA_EMAIL}`);
  process.exit(1);
}
const userId = users[0].id;

async function key(kind: "llm" | "search") {
  const rows = await sql<{ provider: string; key_value: string; model_name: string }>`
    select provider, key_value, model_name from api_keys where user_id = ${userId} and kind = ${kind}`;
  const row = rows[0];
  if (!row) throw new Error(`No stored ${kind} key`);
  return { provider: row.provider, key: decryptSecret(row.key_value), modelName: row.model_name };
}

const search = await key("search");
const llm = await key("llm");
if (!isSearchProviderId(search.provider)) throw new Error(`Bad search provider ${search.provider}`);

console.log(`Indicator ${indicator.id} — ${indicator.name}`);
console.log("Queries:", JSON.stringify(buildRubricQueries(indicator, "Egypt, Arab Rep.")));
const started = Date.now();
const res = await researchRubric({
  search: { providerId: search.provider, key: search.key },
  model: { providerId: llm.provider, key: llm.key, modelName: llm.modelName },
  countryName: "Egypt, Arab Rep.",
  iso3: "EGY",
  indicator,
});
console.log(`\n${((Date.now() - started) / 1000).toFixed(0)}s · documentsRead=${res.documentsRead}${res.repaired ? " · repaired" : ""}`);
if (res.error) console.log("ERROR:", res.error);
if (res.rejected) console.log("REJECTED:", res.rejected.reason);
if (res.proposal) {
  console.log(`PROPOSAL: L${res.proposal.proposedLevel}`);
  console.log("  primary:", res.proposal.primary.sourceUrl);
  console.log("  quote:", res.proposal.primary.quote.slice(0, 140));
  console.log("  whyNotHigher:", (res.proposal.whyNotHigher ?? "").slice(0, 200));
  if (res.proposal.reattributions.length) console.log("  reattributed:", res.proposal.reattributions.join(" · "));
}
process.exit(0);
