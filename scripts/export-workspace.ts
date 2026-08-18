/**
 * Dump everything a workspace holds, for inspection outside the app.
 *
 *   node --env-file=.env scripts/export-workspace.ts <countryId> [outDir]
 *
 * Writes, into `exports/<iso3>-<short id>/`:
 *   draft.html           the assembled roadmap, all chapters and annexes
 *   deck.pptx            the consulting-style deck (same renderer as the app)
 *   evidence.csv         all 97 indicators with source, year, credibility, level
 *   findings.csv         public-domain sweep + practice comparators, with quotes
 *   red-team.csv         QC findings with their verbatim exhibits
 *   uploads/             extracted text of strategic-foresight material
 *   audit.csv            the run's audit trail
 *   README.md            what each file is and how it was produced
 *
 * Soft-deleted workspaces export fine: a retired QA run stays inspectable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSql } from "../src/lib/db.ts";
import { projectRoot } from "./qa-paths.mjs";

const countryId = process.argv[2];
if (!countryId) {
  console.error("usage: node --env-file=.env scripts/export-workspace.ts <countryId> [outDir]");
  process.exit(1);
}

const sql = await getSql();
const countries = await sql<{ id: string; name: string; iso3: string; deleted_at: string | null }>`
  select id, name, iso3, deleted_at from countries where id = ${countryId}`;
if (!countries.length) {
  console.error(`No workspace ${countryId}`);
  process.exit(1);
}
const c = countries[0];
const outDir = process.argv[3] ?? join(projectRoot, "exports", `${c.iso3}-${c.id.slice(0, 8)}`);
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "uploads"), { recursive: true });

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv = (headers: string[], rows: unknown[][]) =>
  [headers.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";

const written: string[] = [];
function write(name: string, content: string | Buffer) {
  writeFileSync(join(outDir, name), content);
  written.push(name);
}

/* draft */
const drafts = await sql<{ body: string; model_name: string | null; drafted_at: string }>`
  select body, model_name, drafted_at from drafts where country_id = ${c.id} and kind = ${"dar"}
  order by drafted_at desc limit 1`;
if (drafts.length) {
  const doc = JSON.parse(drafts[0].body) as {
    title: string; disclaimer: string; generatedAt: string; modelName: string;
    chapters: Array<{ n: string; title: string; body: string; machineDrafted: boolean; modelName: string }>;
  };
  const esc = (t: string) => t.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
  const html = [
    "<!doctype html><meta charset=utf-8>",
    `<title>${esc(doc.title)}</title>`,
    "<style>body{font:16px/1.6 Georgia,serif;max-width:52rem;margin:2rem auto;padding:0 1.2rem;color:#212B24}" +
      "h1{font-size:1.9rem}h2{font-size:1.25rem;margin-top:2.4rem;border-top:1px solid #DCE1D8;padding-top:1.2rem}" +
      "pre{white-space:pre-wrap;font:inherit}.d{background:#EFF3EC;border-left:3px solid #1F5C3D;padding:.8rem 1rem;font-size:.9rem}" +
      ".m{color:#5A685E;font-size:.8rem}</style>",
    `<h1>${esc(doc.title)}</h1>`,
    `<p class=d>${esc(doc.disclaimer)}</p>`,
    `<p class=m>Generated ${esc(doc.generatedAt)} · ${esc(doc.modelName)}</p>`,
    ...doc.chapters.map(
      (ch) =>
        `<h2>${esc(ch.n)}. ${esc(ch.title)}</h2><p class=m>${esc(ch.modelName)}</p><pre>${esc(ch.body)}</pre>`,
    ),
  ].join("\n");
  write("draft.html", html);
}

/* deck */
if (drafts.length) {
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("node", ["--env-file=.env", join(projectRoot, "scripts", "export-deck.ts"), c.id, join(outDir, "deck.pptx")], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    written.push("deck.pptx");
  } catch (err) {
    console.error("deck export failed:", err instanceof Error ? err.message : err);
  }
}

/* evidence */
const ev = await sql<Record<string, unknown>>`
  select indicator_id, value, observation_year, source_name, source_url, confidence, provenance,
         is_proxy, proxy_note, data_gap, gap_steward, suggested_level, assessor_level, assessor_name, notes
  from evidence where country_id = ${c.id} order by indicator_id`;
write(
  "evidence.csv",
  csv(
    ["indicator_id", "value", "observation_year", "source_name", "source_url", "confidence", "provenance",
     "is_proxy", "proxy_note", "data_gap", "gap_steward", "suggested_level", "assessor_level", "assessor_name", "notes"],
    ev.map((r) => Object.values(r)),
  ),
);

/* findings */
const fi = await sql<Record<string, unknown>>`
  select kind, claim, quote, source_name, source_url, published_year, credibility, pillar_hint, created_at
  from findings where country_id = ${c.id} order by kind, created_at`;
write("findings.csv", csv(["kind", "claim", "quote", "source_name", "source_url", "published_year", "credibility", "pillar_hint", "created_at"], fi.map((r) => Object.values(r))));

/* red team */
const rt = await sql<Record<string, unknown>>`
  select chapter, category, severity, excerpt, note, source, created_at
  from review_findings where country_id = ${c.id}
  order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, chapter`;
write("red-team.csv", csv(["chapter", "category", "severity", "excerpt", "note", "source", "created_at"], rt.map((r) => Object.values(r))));

/* uploads */
const ups = await sql<{ filename: string; chars: number; content: string }>`
  select filename, chars, content from uploads where country_id = ${c.id} order by uploaded_at`;
for (const u of ups) {
  const safe = u.filename.replace(/[^\w.-]/g, "_");
  writeFileSync(join(outDir, "uploads", `${safe}.txt`), u.content);
}

/* audit */
const au = await sql<Record<string, unknown>>`
  select at, role, actor_name, action, detail from audit where country_id = ${c.id} order by at`;
write("audit.csv", csv(["at", "role", "actor_name", "action", "detail"], au.map((r) => Object.values(r))));

/* decisions */
const de = await sql<Record<string, unknown>>`
  select step, option_name, decider_name, role, notes, rejected, created_at
  from decisions where country_id = ${c.id} order by step`;
write("decisions.csv", csv(["step", "option_name", "decider_name", "role", "notes", "rejected", "created_at"], de.map((r) => Object.values(r))));

const levelled = ev.filter(
  (r) => ["machine-imported", "machine-researched", "proxy"].includes(String(r.provenance)) || r.assessor_level !== null,
).length;

write(
  "README.md",
  [
    `# ${c.name} (${c.iso3}) — DAR Studio workspace export`,
    "",
    `Workspace \`${c.id}\`${c.deleted_at ? " (soft-deleted; retained for inspection)" : ""}.`,
    `Exported ${new Date().toISOString()}.`,
    "",
    "## What is here",
    "",
    "| File | What it is |",
    "| --- | --- |",
    "| `draft.html` | The assembled roadmap: model explainer, evidence-health page, 17 chapters, 11 annexes. |",
    "| `deck.pptx` | The consulting-style deck, built from the same payload as the draft. |",
    "| `evidence.csv` | All 97 DAMM indicators with source, observation year, credibility, provenance and level. |",
    "| `findings.csv` | Public-domain sweep findings and practice comparators, each with the verbatim quote that was checked against the retrieved page. |",
    "| `red-team.csv` | QC findings over the final draft, each with the verbatim excerpt it challenges. |",
    "| `decisions.csv` | The recorded ladder decisions, Steps 2–8. |",
    "| `audit.csv` | The full audit trail: every pass, every summary, every rejection reason. |",
    "| `uploads/` | Extracted text of the strategic-foresight material provided to the run. |",
    "",
    "## Counts",
    "",
    `- Indicators: ${ev.length} (${levelled} carry a machine or validated level)`,
    `- Sweep findings: ${fi.length}`,
    `- Red-team findings: ${rt.length}`,
    `- Foresight uploads: ${ups.length}`,
    `- Ladder decisions recorded: ${de.length} of 7`,
    "",
    "## How to read it",
    "",
    "Nothing here is an official assessment. Machine-researched levels are",
    "PROPOSALS pending human validation; no maturity stage is claimable until",
    "an assessor validates the evidence (the engagement-package rule). Every",
    "figure in the draft carries its source and credibility grade inline, and",
    "every finding carries the quote that was verified against its page.",
    "",
  ].join("\n"),
);

console.log(`${outDir}\n  ${written.join("\n  ")}\n  uploads/ (${ups.length} file(s))`);
process.exit(0);
