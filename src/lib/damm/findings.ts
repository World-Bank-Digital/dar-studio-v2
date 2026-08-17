/**
 * Findings: cited evidence collected OUTSIDE the DAMM indicator structure.
 *
 * The indicator register is a fixed frame; a country's digital-agriculture
 * reality is not. After the structured collection, two wider sweeps run:
 *
 *  - `opportunistic` — a wide net over the public domain for anything about
 *    THIS country that could inform the roadmap: systems, programmes,
 *    startups, pilots, partnerships, infrastructure facts. Flexible and open;
 *    not tied to any indicator.
 *  - `practice` — strategies and best practices from roughly the past year
 *    (digital agriculture, agriculture, digital transformation), from any
 *    country or institution, as comparator material for the prescriptive
 *    chapters.
 *
 * The verification discipline is identical to everything else in this app:
 * a finding exists only as a claim backed by a verbatim, checked quote from a
 * retrieved page, with source, year and credibility attached. Findings inform
 * chapters and annexes; they NEVER populate indicators or move a score.
 */

import { credibilityFor } from "./credibility.ts";
import { isHttpUrl } from "./citation.ts";
import { model } from "./model.ts";
import { searchCountryName, collectDocuments, chatPreferringNoReasoning } from "./retrieval.ts";
import { verifyQuote, type SearchHit, type SearchProviderDef } from "./search.ts";
import { providerDef, type ProviderDef } from "./providers.ts";
import { isBlockedHost, isForeignGovernmentHost, parseJsonArray } from "./websearch.ts";
import { iso2For } from "./countries.ts";

export type FindingKind = "opportunistic" | "practice";

export interface Finding {
  kind: FindingKind;
  claim: string;
  quote: string;
  sourceName: string;
  sourceUrl: string;
  publishedYear: number | null;
  credibility: string | null;
  pillarHint: string | null;
}

export interface FindingsOutcome {
  findings: Finding[];
  rejected: Array<{ topic: string; reason: string }>;
  documentsRead: number;
  error?: string;
}

export interface SweepTopic {
  /** Slug used to key retrieved documents; never shown to the user. */
  id: string;
  label: string;
  query: string;
}

/**
 * The wide net for one country. Base topics cover the landscape every roadmap
 * cares about; gap topics loosen unfilled indicator names into plain phrases
 * ("anything public about X in this country"), because an indicator the
 * structured pass could not fill may still have public traces that a steward
 * or a chapter can use.
 */
export function opportunisticTopics(countryName: string, gapNames: string[] = []): SweepTopic[] {
  const c = searchCountryName(countryName);
  const base: Array<[string, string]> = [
    ["landscape", `${c} digital agriculture initiatives`],
    ["agritech", `${c} agritech startups`],
    ["extension", `${c} digital extension services farmers`],
    ["finance", `${c} mobile money agricultural payments`],
    ["platforms", `${c} agricultural platforms apps`],
    ["ministry", `${c} ministry agriculture digital projects`],
    ["donor", `${c} agriculture digitalization projects World Bank FAO`],
    ["irrigation", `${c} smart irrigation precision agriculture`],
  ];
  const gaps: Array<[string, string]> = gapNames
    .slice(0, 8)
    .map((name, i) => [`gap-${i + 1}`, `${c} ${name.replace(/\([^)]*\)/g, " ").replace(/[/|]/g, " ").replace(/\s+/g, " ").trim()}`]);
  return [...base, ...gaps].map(([id, query]) => ({ id, label: query, query }));
}

/** Recent strategies and comparators; recency is asked for in the query and enforced at validation. */
export function practiceTopics(assessmentYear: number): SweepTopic[] {
  const y = assessmentYear;
  const items: Array<[string, string]> = [
    ["strategies", `national digital agriculture strategy ${y}`],
    ["e-agriculture", `e-agriculture strategy launched ${y - 1} ${y}`],
    ["transformation", `agriculture digital transformation programme ${y}`],
    ["best-practice", `digital agriculture best practices lessons ${y}`],
    ["govtech", `government digital transformation strategy agriculture ${y}`],
    ["ai", `artificial intelligence agriculture policy ${y}`],
  ];
  return items.map(([id, query]) => ({ id, label: query, query }));
}

const MAX_DOC_CHARS = 4500;
const MAX_DOCS_PER_TOPIC = 3;

export function buildFindingsPrompt(input: {
  kind: FindingKind;
  countryName: string;
  assessmentYear: number;
  topics: SweepTopic[];
  docsByTopic: Map<string, SearchHit[]>;
}): string {
  const c = searchCountryName(input.countryName);
  const scope =
    input.kind === "opportunistic"
      ? [
          `Harvest findings about ${c} SPECIFICALLY. A finding from a document about another country, or a global report that never names ${c}, must be omitted.`,
          "A finding is any concrete, roadmap-relevant fact: a system that exists, a programme and its scale, a startup and what it does, a partnership, a law, an investment, an infrastructure fact.",
        ]
      : [
          "Harvest recent strategies, programmes and documented best practices in digital agriculture, agriculture, or digital transformation — from ANY country or institution. Name the country or institution in the claim itself.",
          `Recency matters: prefer material from ${input.assessmentYear - 1}–${input.assessmentYear}. Omit material that is clearly older.`,
        ];
  const lines = [
    `Extract cited findings from the documents below. Assessment year: ${input.assessmentYear}.`,
    "",
    "You are not searching. You may use ONLY the document text provided here.",
    ...scope,
    "Rules:",
    "- `claim` is one self-contained sentence stating the finding in plain language.",
    "- `quote` must be a verbatim span (10–25 consecutive words) copied character-for-character from the document, in the document's own language. It is checked; a paraphrased or translated quote sinks the finding.",
    "- `sourceUrl` must be copied exactly from the document you used.",
    "- `year` is the year the document states for the fact (or its publication year); null if unstated.",
    `- Optional \`pillarHint\`: one of ${Object.keys(model.pillars).join(", ")} when the finding clearly belongs to a pillar; null otherwise.`,
    "- If a topic's documents contain a usable finding, you MUST return it. Omit a topic only when its documents contain nothing usable.",
    "",
    "Return ONLY a JSON array of objects with keys: topic, claim, quote, sourceName, sourceUrl, year, pillarHint.",
  ];
  for (const topic of input.topics) {
    lines.push("", `### Topic ${topic.id} — ${topic.label}`);
    const docs = (input.docsByTopic.get(topic.id) ?? []).slice(0, MAX_DOCS_PER_TOPIC);
    if (!docs.length) {
      lines.push("No documents were retrieved for this topic. Omit it.");
      continue;
    }
    for (const [i, doc] of docs.entries()) {
      lines.push("", `Document ${i + 1} for topic ${topic.id} — ${doc.title || "(untitled)"}`, `URL: ${doc.url}`, doc.text.slice(0, MAX_DOC_CHARS));
    }
  }
  return lines.join("\n");
}

const PILLAR_IDS = new Set(Object.keys(model.pillars));

export function validateFinding(
  raw: unknown,
  input: {
    kind: FindingKind;
    assessmentYear: number;
    countryIso2: string;
    documents: SearchHit[];
  },
): { finding: Finding } | { rejected: { topic: string; reason: string } } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const topic = String(r.topic ?? "(unknown)").slice(0, 60);
  const reject = (reason: string) => ({ rejected: { topic, reason } });

  const claim = String(r.claim ?? "").trim();
  if (claim.length < 30) return reject("Claim missing or too thin to use.");

  const sourceUrl = String(r.sourceUrl ?? r.source_url ?? "").trim();
  if (!isHttpUrl(sourceUrl)) return reject("Source URL was not a public http(s) URL.");
  if (isBlockedHost(sourceUrl)) return reject("Source host is on the excluded list.");
  // Opportunistic findings describe THIS country; another government's own
  // site is describing its own country (the AgriStack lesson). Practice
  // findings are comparators — foreign government strategies are the point.
  if (input.kind === "opportunistic" && isForeignGovernmentHost(sourceUrl, input.countryIso2)) {
    return reject(`A foreign government host cannot evidence this country: ${sourceUrl.slice(0, 80)}`);
  }

  const doc = input.documents.find((d) => d.url === sourceUrl);
  if (!doc) return reject(`Source URL was not among the retrieved documents: ${sourceUrl.slice(0, 80)}`);

  const quote = String(r.quote ?? "").trim();
  const check = verifyQuote(doc.text, quote);
  if (!check.ok) {
    return reject(`Quote verification failed (${check.reason}) — offending quote: “${quote.slice(0, 90)}”`);
  }

  const rawYear = r.year == null ? null : Number(r.year);
  const year = Number.isInteger(rawYear) && (rawYear as number) >= 1990 && (rawYear as number) <= input.assessmentYear
    ? (rawYear as number)
    : doc.publishedYear;
  if (input.kind === "practice" && year != null && year < input.assessmentYear - 1) {
    return reject(`Practice material from ${year} is outside the past-year window.`);
  }

  const sourceName = String(r.sourceName ?? r.source_name ?? "").trim() || doc.title || "(untitled source)";
  const cred = credibilityFor({ sourceName, sourceUrl, isProxy: false });
  const pillarHintRaw = String(r.pillarHint ?? r.pillar_hint ?? "").trim();

  return {
    finding: {
      kind: input.kind,
      claim: claim.slice(0, 400),
      quote: quote.slice(0, 400),
      sourceName: sourceName.slice(0, 200),
      sourceUrl,
      publishedYear: year ?? null,
      credibility: cred.tier,
      pillarHint: PILLAR_IDS.has(pillarHintRaw) ? pillarHintRaw : null,
    },
  };
}

const FINDINGS_SYSTEM =
  "You extract findings from supplied documents. You never search, recall, estimate or invent. " +
  "Every claim you return must rest on a verbatim quote from the document text you were given, and the " +
  "quote is checked against that text. Report every finding the documents support; invent none they do not.";

const TOPIC_BATCH = 4;

/** Run one sweep end to end: search per topic → extract per batch → validate. */
export async function researchFindings(
  input: {
    kind: FindingKind;
    search: { providerId: string; key: string };
    model: { providerId: string; key: string; modelName: string };
    countryName: string;
    iso3: string;
    assessmentYear: number;
    topics: SweepTopic[];
    onProgress?: (done: number, total: number) => Promise<void> | void;
  },
  deps?: {
    searcher?: Pick<SearchProviderDef, "search" | "domainFilterLimit">;
    extractor?: Pick<ProviderDef, "chat">;
  },
): Promise<FindingsOutcome> {
  const searcher = deps?.searcher ?? (await import("./search.ts")).searchProviderDef(input.search.providerId);
  const extractor = deps?.extractor ?? providerDef(input.model.providerId);
  if (!searcher || !extractor) {
    return { findings: [], rejected: [], documentsRead: 0, error: "Search or model provider is not configured." };
  }

  const iso2 = iso2For(input.iso3) ?? "";
  const findings: Finding[] = [];
  const rejected: Array<{ topic: string; reason: string }> = [];
  const seen = new Set<string>();
  let documentsRead = 0;
  let error: string | undefined;

  for (let i = 0; i < input.topics.length; i += TOPIC_BATCH) {
    const batch = input.topics.slice(i, i + TOPIC_BATCH);
    // Open web on purpose: the whole point of the sweep is what the
    // structured, scoped passes cannot see.
    const { docsByIndicator, searchError } = await collectDocuments({
      searcher,
      key: input.search.key,
      indicators: batch.map((t) => ({ id: t.id, name: t.label, anchors: { L5: "" } as never, queryOverride: t.query })),
      countryName: input.countryName,
      assessmentYear: input.assessmentYear,
      nsoDomains: [],
      resultsPerIndicator: 4,
    });
    if (searchError) error = searchError;

    const batchDocs: SearchHit[] = [];
    const docsByTopic = new Map<string, SearchHit[]>();
    for (const t of batch) {
      const docs = (docsByIndicator.get(t.id) ?? []).filter(
        (d) => input.kind === "practice" || !isForeignGovernmentHost(d.url, iso2),
      );
      docsByTopic.set(t.id, docs);
      for (const d of docs) if (!batchDocs.some((x) => x.url === d.url)) batchDocs.push(d);
    }
    documentsRead += batchDocs.length;
    if (!batchDocs.length) continue;

    const chat = await chatPreferringNoReasoning(extractor, {
      key: input.model.key,
      model: input.model.modelName,
      system: FINDINGS_SYSTEM,
      user: buildFindingsPrompt({
        kind: input.kind,
        countryName: input.countryName,
        assessmentYear: input.assessmentYear,
        topics: batch,
        docsByTopic,
      }),
      maxTokens: 24_000,
      temperature: 0,
      timeoutMs: 360_000,
    });
    if (chat.error || !chat.text) {
      error = chat.error ?? "The findings model returned no output.";
      continue;
    }
    for (const item of parseJsonArray(chat.text)) {
      const outcome = validateFinding(item, {
        kind: input.kind,
        assessmentYear: input.assessmentYear,
        countryIso2: iso2,
        documents: batchDocs,
      });
      if ("rejected" in outcome) {
        rejected.push(outcome.rejected);
        continue;
      }
      const key = `${outcome.finding.sourceUrl}::${outcome.finding.claim.toLowerCase().replace(/\s+/g, " ")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(outcome.finding);
    }
    await input.onProgress?.(Math.min(i + TOPIC_BATCH, input.topics.length), input.topics.length);
  }

  return { findings, rejected, documentsRead, error };
}
