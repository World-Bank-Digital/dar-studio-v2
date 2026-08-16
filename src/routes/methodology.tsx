import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { model, disclaimer } from "@/lib/damm/model";

export const Route = createFileRoute("/methodology")({ component: Methodology });

function Methodology() {
  const m = model.methodology;
  return (
    <AppShell>
      <p className="text-xs font-medium uppercase tracking-widest text-sage">{model.model} {model.version}</p>
      <h1 className="mt-1 font-display text-3xl font-semibold">Methodology</h1>
      <p className="mt-3 max-w-3xl text-muted">{m.purpose}</p>
      <p className="mt-3 max-w-3xl text-sm text-muted">{m.not}</p>
      <p className="mt-3 max-w-3xl text-xs text-subtle">{disclaimer()}</p>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        {m.rules.map((r) => (
          <Card key={r.title}>
            <h2 className="font-display text-xl">{r.title}</h2>
            <p className="mt-2 text-sm text-muted">{r.text}</p>
          </Card>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">How a score is built</h2>
        <ol className="mt-4 grid gap-3">
          {m.chain.map((c) => (
            <li key={c.step} className="rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
              <p className="text-xs font-medium uppercase tracking-widest text-sage">{c.step}</p>
              <p className="mt-1 text-sm">{c.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Weights and gates</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {Object.entries(model.pillars).map(([id, p]) => (
            <Card key={id} className="p-4">
              <p className="font-mono text-xs text-subtle">{id}</p>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-muted">
                {p.aggregated === false ? "Context — never aggregated" : `Weight ${p.weight ?? "—"} · ${p.role}`}
              </p>
            </Card>
          ))}
        </div>
        <Card className="mt-4">
          <p className="text-sm">
            Coverage gates from configuration: pillar minimum {model.coverage_gates.pillar_min}, CMS minimum {model.coverage_gates.cms_min}, EMS minimum {model.coverage_gates.ems_min}.
          </p>
          <p className="mt-2 text-sm">
            Stage thresholds: Stage 2 CMS {model.stage_thresholds.stage2_cms}; Stage 3 CMS {model.stage_thresholds.stage3_cms} / EMS {model.stage_thresholds.stage3_ems}; Stage 4 CMS {model.stage_thresholds.stage4_cms} / EMS {model.stage_thresholds.stage4_ems} / OES {model.stage_thresholds.stage4_oes}.
          </p>
          <p className="mt-2 text-sm">
            Assessment year {model.assessment_year}. {model.indicators.length} indicators. {model.core_gates.length} core gates: {model.core_gates.join(", ")}.
          </p>
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Prohibitions</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {model.prohibitions.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Eight steps</h2>
        <ol className="mt-4 grid gap-3">
          {model.ladder.map((r) => (
            <li key={r.rung} className="rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
              <p className="text-xs text-subtle">
                Step {r.step} · {r.rung} · {r.decider}
              </p>
              <p className="font-medium">{r.name}</p>
              <p className="mt-1 text-sm text-muted">{r.guidance}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 mb-8">
        <h2 className="font-display text-2xl">Provenance</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">{m.provenance}</p>
        <p className="mt-2 text-xs text-subtle">Status: {model.status}. Extracted from {model.extracted_from}.</p>
      </section>
    </AppShell>
  );
}
