import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { model, disclaimer } from "@/lib/damm-v17/model";

export const Route = createFileRoute("/methodology")({ component: Methodology });

/**
 * The method page renders from the model file itself — evidence classes,
 * source tiers, bands, binding rules, invariants and the open decisions all
 * come from the same canonical document the scorer reads, so this page cannot
 * drift from what the instrument actually does.
 */
function Methodology() {
  return (
    <AppShell>
      <p className="text-xs font-medium uppercase tracking-widest text-sage">
        {model.model} v{model.version} rev{model.revision} · {model.status}
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold">{model.title}</h1>
      <p className="mt-3 max-w-3xl text-muted">
        {model.indicators.length} indicators across seven pillars, each scored from a recorded value with its source,
        tier and year. Evidence classes, levels, bands, prerequisites and the use-case readiness matrix are derived from
        what was recorded — never chosen, never weighted by opinion.
      </p>
      <p className="mt-3 max-w-3xl text-xs text-subtle">{disclaimer()}</p>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Evidence classes</h2>
        <p className="mt-1 text-sm text-muted">The class is derived from the recorded value, never chosen.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {model.evidence_classes.map((c) => (
            <Card key={c.id} className="p-4">
              <h3 className="font-display text-xl">{c.id}</h3>
              <p className="mt-2 text-sm text-muted">
                Derived when {c.derived_from}. Levels: {c.levels}.
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Source tiers</h2>
        <p className="mt-1 text-sm text-muted">{model.tier_note}</p>
        <ul className="mt-4 space-y-2">
          {Object.entries(model.source_tiers).map(([t, text]) => (
            <li key={t} className="text-sm">
              <span className="font-mono font-semibold">{t}</span> <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Levels and bands</h2>
        <p className="mt-1 text-sm text-muted">
          A pillar band is the mean of the levels actually recorded — rated rows only, with the denominator always
          disclosed. Bands are half-open, and their edges are an open calibration decision (13.1).
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {model.bands.map((b) => (
            <Card key={b.name} className="p-3 text-sm">
              <b>{b.name}</b> <span className="tabular-nums text-muted">{b.lo} – &lt;{b.hi > 5 ? 5.0 : b.hi}</span>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Binding rules</h2>
        <p className="mt-1 text-sm text-muted">
          Prerequisites bind on presence only. Each rule below is in force and marked with its ratification standing —
          none is presented as settled while its decision is open.
        </p>
        <div className="mt-4 grid gap-3">
          {model.binding_rules.map((r) => (
            <Card key={r.id} className="p-4">
              <p className="text-sm">{r.rule}</p>
              <p className="mt-1 text-xs text-subtle">
                {r.ratified ? "Ratified." : `Pending ratification${r.decision ? ` (decision ${r.decision})` : ""}.`}
                {r.note ? ` ${r.note}` : ""}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Invariants</h2>
        <ul className="mt-4 grid gap-2">
          {model.invariants.map((t) => (
            <li key={t} className="text-sm text-muted">
              — {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Open design decisions</h2>
        <p className="mt-1 text-sm text-muted">{model.ratification_note}</p>
        <ol className="mt-4 grid gap-2">
          {model.open_decisions.map((d) => (
            <li key={d.id} className="text-sm">
              <span className="font-mono text-xs text-subtle">{d.id}</span> {d.title}
              {d.scope ? <span className="ml-1 text-xs text-subtle">({d.scope})</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 mb-8">
        <h2 className="font-display text-2xl">The four prohibitions</h2>
        <ul className="mt-4 grid gap-2">
          {model.prohibitions.map((p) => (
            <li key={p} className="text-sm text-muted">
              — {p}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
