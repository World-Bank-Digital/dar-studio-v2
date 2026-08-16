import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./qa-paths.mjs";
import { ingestIndicator, ingestQueue } from "../src/lib/damm/ingest.ts";
import { model } from "../src/lib/damm/model.ts";
import { registryEntry } from "../src/lib/damm/registry.ts";
import { sourceFor } from "../src/lib/damm/sources.ts";
import { scoreEvidence } from "../src/lib/damm/evidenceScore.ts";
import { formatObserved } from "../src/lib/damm/scoring.ts";

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function promptFor(ind, entry) {
  const cut = entry?.disaggregation ?? "national";
  return [
    `Egypt — ${ind.id} ${ind.name}.`,
    `Definition: ${entry?.definition ?? ind.name}`,
    `Required cut: ${cut}. Preferred years ${entry?.preferredYearFrom ?? ""}–${entry?.preferredYearTo ?? model.assessment_year}.`,
    `Try national first (${entry?.nationalFirst ?? "NSO / line ministry"}), then ${entry?.internationalFallback ?? "official international"}.`,
    `Return only: value, unit, observation year, source organisation, exact publication title, URL, and whether the series is DIRECT or PROXY for this definition.`,
    `If you cannot find a cited official figure, say MISSING and name the steward who should hold it. Do not invent a number.`,
  ].join(" ");
}

const queue = ingestQueue();
const rows = [];
let i = 0;
for (const spec of queue) {
  i += 1;
  const ind = model.indicators.find((x) => x.id === spec.indicatorId);
  if (!ind) continue;
  const entry = registryEntry(ind.id);
  const mapped = sourceFor(ind.id);
  process.stderr.write(`[${i}/${queue.length}] ${ind.id} ${spec.kind}\n`);
  const result = await ingestIndicator("EGY", spec);
  const imported = result.status === "imported";
  const scored = scoreEvidence({
    indicatorId: ind.id,
    value: imported ? result.value : null,
    observationYear: imported ? result.observationYear : null,
    sourceName: result.sourceName ?? mapped?.sourceName,
    sourceUrl: result.sourceUrl ?? mapped?.sourceUrl,
    isProxy: Boolean(result.isProxy ?? mapped?.isProxy),
    provenance: imported ? "machine-imported" : "named-gap",
    dataGap: !imported,
  });
  rows.push({
    indicator_id: ind.id,
    name: ind.name,
    pillar_id: ind.pillar,
    pillar_name: (ind.pillar_name ?? "").replace(/^C\d:\s*|^E\d:\s*|^O\d:\s*/, ""),
    role: ind.role,
    core_gate: ind.gate ? "yes" : "no",
    kind: entry?.kind ?? "",
    method: ind.method,
    disaggregation: entry?.disaggregation ?? "",
    max_age: ind.max_age,
    preferred_years: `${entry?.preferredYearFrom ?? ""}–${entry?.preferredYearTo ?? ""}`,
    definition: entry?.definition ?? "",
    national_first: entry?.nationalFirst ?? "",
    international_fallback: entry?.internationalFallback ?? "",
    steward: entry?.steward ?? mapped?.steward ?? "",
    app_fetch_kind: spec.kind,
    app_series: mapped?.series ?? mapped?.data360Indicator ?? mapped?.owidSlug ?? "",
    app_mapped_source: mapped?.sourceName ?? "",
    app_mapped_url: mapped?.sourceUrl ?? "",
    app_proxy: mapped?.isProxy || result.isProxy ? "yes" : "no",
    app_proxy_note: result.proxyNote ?? mapped?.proxyNote ?? mapped?.gapNote ?? "",
    app_status: imported ? scored.fit : "missing",
    app_value: imported && result.value != null ? formatObserved(result.value) : "",
    app_year: imported ? result.observationYear ?? "" : "",
    app_source_name: imported ? result.sourceName ?? "" : "",
    app_source_url: imported ? result.sourceUrl ?? "" : "",
    app_grade: imported ? scored.grade : "E",
    app_score_100: imported ? scored.total : 0,
    perplexity_value: "",
    perplexity_year: "",
    perplexity_source: "",
    perplexity_url: "",
    perplexity_direct_or_proxy: "",
    perplexity_notes: "",
    same_as_app: "",
    perplexity_prompt: promptFor(ind, entry),
  });
}

const headers = Object.keys(rows[0]);
const lines = [headers.join(",")];
for (const row of rows) {
  lines.push(headers.map((h) => csvCell(row[h])).join(","));
}

mkdirSync(join(projectRoot, "exports"), { recursive: true });
const csvPath = join(projectRoot, "exports", "DAR_Egypt_indicator_comparison.csv");
writeFileSync(csvPath, "\uFEFF" + lines.join("\n"), "utf8");

const captured = rows.filter((r) => r.app_status !== "missing").length;
const gates = rows.filter((r) => r.core_gate === "yes");
const gateHit = gates.filter((r) => r.app_status !== "missing").length;
const summary = {
  country: "Egypt",
  iso3: "EGY",
  indicators: rows.length,
  pillars: [...new Set(rows.map((r) => r.pillar_id))].length,
  app_captured: captured,
  core_gates_captured: `${gateHit}/${gates.length}`,
  csv: csvPath,
};
console.log(JSON.stringify(summary, null, 2));
