/**
 * DAMM v1.7 — validated model loader.
 *
 * The model file is generated from the assessment pipeline's engine (the source of
 * truth, `generated_from` names it) and validated here against the same contract as
 * `src/data/model_v1_7.schema.json`. Validation runs once at module load: a model
 * file that fails the contract is a build error, not a runtime surprise.
 *
 * Twelve design decisions are open in the model's `open_decisions`. Every value they
 * can change is data in the file — band edges, thresholds, prerequisite mappings,
 * indicator definitions. A ruling edits the model and bumps `revision`; nothing in
 * this app hardcodes a ratifiable value. UI that shows such a value should surface
 * its provisional standing (see `openDecisionsFor` and the per-indicator
 * `ratification` field) rather than presenting it as settled.
 */
import { z } from "zod";
import raw from "../../data/model_v1_7.json" with { type: "json" };
import type {
  DammModelV17,
  DarChapter,
  IndicatorDef,
  OpenDecision,
  PillarId,
  UseCaseId,
} from "./types.ts";

const LAYERS = ["Foundation", "Enablers", "Transformation", "Outcomes"] as const;

const indicatorSchema = z.object({
  id: z.string().regex(/^\d+\.\d+$/),
  name: z.string().min(1),
  pillar: z.string(),
  layer: z.enum(LAYERS),
  use_cases: z.array(z.string()),
  tags: z.array(z.string()),
  prerequisite: z.string().nullable(),
  method: z.enum(["threshold", "ladder"]),
  direction: z.enum(["higher-is-better", "lower-is-better"]).nullable(),
  thresholds: z.array(z.number()).length(4).nullable(),
  absorbs: z.array(z.string()),
  thresholds_ratified: z.boolean().optional(),
  ratification: z
    .object({
      open_question: z.string().min(1),
      severity: z.enum(["asserts-falsehood", "construct-drift", "unit-ambiguity"]).optional(),
      decision: z.string(),
    })
    .optional(),
});

const modelSchema = z
  .object({
    model: z.literal("DAMM"),
    title: z.string(),
    version: z.string().regex(/^\d+\.\d+$/),
    revision: z.number().int().min(1),
    status: z.string(),
    ratified: z.boolean(),
    ratification_note: z.string(),
    generated_from: z.string(),
    generated_on: z.string(),
    prohibitions: z.array(z.string()).min(4),
    config: z.object({
      assessment_year: z.number().int(),
      staleness_years: z.number().int().min(1),
      readiness_threshold: z.number(),
      leapfrog_threshold: z.number(),
      rounding: z.literal("half-up"),
      rounding_note: z.string().optional(),
    }),
    pillars: z.record(
      z.string(),
      z.object({
        name: z.string(),
        reading: z.enum(["need", "capability", "outcome"]),
        note: z.string().optional(),
      }),
    ),
    layers: z.array(z.enum(LAYERS)),
    use_cases: z.record(z.string(), z.string()),
    non_use_case_tags: z.record(z.string(), z.string()),
    evidence_classes: z
      .array(
        z.object({
          id: z.enum(["Measured", "Documented", "Judged", "Gap"]),
          derived_from: z.string(),
          levels: z.string(),
        }),
      )
      .length(4),
    source_tiers: z.record(z.string(), z.string()),
    tier_note: z.string(),
    bands: z.array(z.object({ name: z.string(), lo: z.number(), hi: z.number() })).min(1),
    prerequisite_kinds: z.record(z.string(), z.string()),
    prerequisite_status: z.record(z.string(), z.string()),
    binding_rules: z.array(
      z.object({
        id: z.string(),
        rule: z.string(),
        ratified: z.boolean(),
        decision: z.string().optional(),
        note: z.string().optional(),
      }),
    ),
    invariants: z.array(z.string()),
    indicators: z.array(indicatorSchema).min(1),
    derived_sources: z.record(z.string(), z.string()),
    dar_outline: z
      .array(
        z.object({
          n: z.string(),
          title: z.string().min(1),
          kind: z.enum(["diagnostic", "prescriptive"]),
          content: z.string().min(1),
          note: z.string().min(1),
          binding: z.object({
            pillars: z.array(z.string()),
            indicators: z.array(z.string()),
            use_cases: z.array(z.string()),
            prerequisites: z.array(z.string()),
            derived: z.array(z.string()),
          }),
        }),
      )
      .min(1),
    foresight: z.object({
      method: z.string().min(1),
      ratified: z.boolean(),
      settled_by: z.string().optional(),
      steps: z.array(z.object({ id: z.string(), name: z.string(), purpose: z.string() })).min(1),
      milestone_binding: z.object({
        rule: z.string(),
        fields: z.array(z.string()),
        fallback: z.string(),
        provisionality: z.string().optional(),
      }),
      note: z.string().optional(),
    }),
    candidate_indicators: z.object({
      purpose: z.string(),
      id_pattern: z.string(),
      required_fields: z.array(z.string()),
      may_be_proposed_by: z.array(z.string()).optional(),
      never: z.array(z.string()).min(1),
      disposition: z.string(),
    }),
    open_decisions: z.array(
      z.object({
        id: z.string().regex(/^13\.\d+$/),
        title: z.string(),
        governs: z.array(z.string()),
        scope: z.string().optional(),
      }),
    ),
  })
  .loose()
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });

    const ids = m.indicators.map((i) => i.id);
    if (new Set(ids).size !== ids.length) fail("indicator ids are not unique");

    const pillars = new Set(Object.keys(m.pillars));
    for (const i of m.indicators) {
      if (!pillars.has(i.pillar)) fail(`${i.id}: pillar ${i.pillar} is not declared`);
      for (const u of i.use_cases) {
        if (!(u in m.use_cases)) fail(`${i.id}: use case ${u} is not declared`);
      }
      if (i.method === "threshold" && (!i.thresholds || !i.direction)) {
        fail(`${i.id}: a threshold row needs 4 cut-points and a direction`);
      }
      if (i.method === "ladder" && i.thresholds) {
        fail(`${i.id}: a ladder row carries no cut-points`);
      }
      const p = i.prerequisite;
      if (p !== null && p !== "UNIVERSAL" && p !== "DELIVERY" && !p.startsWith("UC:")) {
        fail(`${i.id}: unknown prerequisite kind ${p}`);
      }
    }

    for (let k = 0; k + 1 < m.bands.length; k++) {
      if (m.bands[k].hi !== m.bands[k + 1].lo) {
        fail(`bands are not contiguous at ${m.bands[k].name} → ${m.bands[k + 1].name}`);
      }
    }

    // A DAR chapter may cite only what the model declares. An unresolvable
    // binding would let the fidelity check pass prose citing evidence that does
    // not exist, which is the failure the bindings exist to prevent.
    const indIds = new Set(m.indicators.map((i) => i.id));
    const preIds = new Set(m.indicators.filter((i) => i.prerequisite).map((i) => i.id));
    const derived = new Set(Object.keys(m.derived_sources));
    for (const c of m.dar_outline) {
      const b = c.binding;
      for (const p of b.pillars) {
        if (!(p in m.pillars)) fail(`chapter ${c.n}: pillar ${p} is not declared`);
      }
      for (const u of b.use_cases) {
        if (!(u in m.use_cases)) fail(`chapter ${c.n}: use case ${u} is not declared`);
      }
      for (const i of b.indicators) {
        if (i !== "*" && !indIds.has(i)) fail(`chapter ${c.n}: no such indicator ${i}`);
      }
      for (const q of b.prerequisites) {
        if (q !== "*" && !preIds.has(q)) fail(`chapter ${c.n}: ${q} is not a prerequisite`);
      }
      for (const d of b.derived) {
        if (!derived.has(d)) fail(`chapter ${c.n}: undeclared derived source ${d}`);
      }
    }

    // The honesty contract: while decisions are open the model says so, and no
    // binding rule may claim ratification ahead of its ruling.
    if (m.open_decisions.length > 0 && m.ratified) {
      fail("model claims ratified while decisions are open");
    }
    for (const r of m.binding_rules) {
      if (r.ratified && m.open_decisions.some((d) => d.id === r.decision)) {
        fail(`binding rule ${r.id} claims ratification while ${r.decision} is open`);
      }
    }
  });

export const model: DammModelV17 = modelSchema.parse(raw) as DammModelV17;

const byId = new Map(model.indicators.map((i) => [i.id, i]));

export function indicatorById(id: string): IndicatorDef | undefined {
  return byId.get(id);
}

export function indicatorsFor(pillar: PillarId): IndicatorDef[] {
  return model.indicators.filter((i) => i.pillar === pillar);
}

export const pillarIds = Object.keys(model.pillars) as PillarId[];
export const useCaseIds = Object.keys(model.use_cases) as UseCaseId[];

export const prerequisites: IndicatorDef[] = model.indicators.filter(
  (i) => i.prerequisite !== null,
);

/** Rows whose definition awaits a section-13.5 ruling — surfaced, never hidden. */
export const openDefinitionRows: IndicatorDef[] = model.indicators.filter(
  (i) => i.ratification !== undefined,
);

/**
 * The open decisions governing a model field (matched on prefix, so
 * `openDecisionsFor("bands")` finds 13.1 and `openDecisionsFor("indicators[].thresholds")`
 * finds 13.6). This is how UI knows to render a value as provisional.
 */
export function openDecisionsFor(field: string): OpenDecision[] {
  return model.open_decisions.filter((d) => d.governs.some((g) => g.startsWith(field)));
}

/** The DAR chapter carrying this number, if the outline declares one. */
export function darChapter(n: string): DarChapter | undefined {
  return model.dar_outline.find((c) => c.n === n);
}

/**
 * Whether a chapter may cite a given piece of evidence. `"*"` in a binding
 * means all of that kind — the annex uses it.
 */
export function chapterMayCite(
  n: string,
  kind: "pillars" | "indicators" | "use_cases" | "prerequisites" | "derived",
  id: string,
): boolean {
  const c = darChapter(n);
  if (!c) return false;
  // The five binding arrays have different element types, so indexing by a
  // union collapses them to `never`; widen before membership testing.
  const allowed = c.binding[kind] as readonly string[];
  return allowed.includes("*") || allowed.includes(id);
}

export function disclaimer(): string {
  return model.prohibitions.join(" ");
}
