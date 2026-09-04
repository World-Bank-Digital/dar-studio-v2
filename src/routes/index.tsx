import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  createCountry,
  deleteCountry,
  listCountries,
  listEconomies,
  loadDemoPack,
  type CountrySummary,
  type Economy,
} from "@/lib/damm-v17/actions";
import { model, disclaimer, pillarIds, useCaseIds } from "@/lib/damm-v17/model";
import { useSessionRole } from "@/lib/session-context";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sameDisplayedTime(a: string, b: string) {
  return formatWhen(a) === formatWhen(b);
}

function Home() {
  const { user } = useCurrentUserState();
  return <AppShell>{user ? <PortfolioInner /> : <Landing />}</AppShell>;
}

function Landing() {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-medium uppercase tracking-widest text-sage">
        DAMM v{model.version} · independent prototype · {model.status}
      </p>
      <h1 className="mt-2 font-display text-4xl font-semibold">
        Prepare a Digital Agriculture Roadmap
      </h1>
      <p className="mt-4 text-lg text-muted">
        DAR Studio carries the Digital Agriculture Maturity Model as its instrument:{" "}
        {model.indicators.length} indicators across {pillarIds.length} pillars, scored from recorded
        evidence. Add optional source documents before launch, then one autonomous workflow
        researches, analyses, and packages a complete Draft DAR. Human review begins only after all
        eight stages finish.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/login">Sign in to open a country</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/methodology">Read the methodology</Link>
        </Button>
      </div>
      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-widest text-sage">Research</p>
          <p className="mt-1 text-sm">
            The workflow records sources, tiers, years, and research gaps automatically. Human
            corrections belong to post-completion review.
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-widest text-sage">Derive</p>
          <p className="mt-1 text-sm">
            Evidence class, levels, pillar bands, prerequisites and the use-case readiness matrix
            are computed from what was recorded, never chosen.
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-widest text-sage">Disclose</p>
          <p className="mt-1 text-sm">
            Means travel with their own denominators, withheld levels stay visible, and unratified
            rules say so.
          </p>
        </Card>
      </div>
      <p className="mt-8 text-xs text-subtle">{disclaimer()}</p>
    </div>
  );
}

function MatrixLine({ c }: { c: CountrySummary }) {
  const a = c.assessment;
  if (!a) return <p className="mt-2 text-sm text-muted">Not yet scored.</p>;
  const vb = a.counts.Measured + a.counts.Documented;
  return (
    <>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
        {pillarIds.map((p) => {
          const d = a.pillars[p];
          return (
            <span key={p} className="tabular-nums" title={model.pillars[p].name}>
              {p} {d.mean === null ? "—" : d.mean.toFixed(2)}
              {d.weak ? ` (${d.band})` : d.mean === null ? "" : ` ${d.band}`}
            </span>
          );
        })}
      </p>
      <p className="mt-1 text-xs text-subtle">
        {useCaseIds.map((uc) => `${uc} ${a.matrix[uc].status}`).join(" · ")}
      </p>
      <p className="mt-1 text-xs text-subtle">
        {vb}/{model.indicators.length} value-backed · {a.rated} levelled · {a.counts.Gap} gaps ·{" "}
        {a.held} held
      </p>
    </>
  );
}

function PortfolioInner() {
  const nav = useNavigate();
  const { role, actorName } = useSessionRole();
  const [rows, setRows] = useState<CountrySummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CountrySummary | null>(null);
  const [removing, setRemoving] = useState(false);

  async function refresh() {
    const list = await listCountries({ data: {} });
    setRows(list);
  }

  useEffect(() => {
    refresh().catch(() => setRows([]));
  }, []);

  async function onDemo(which: "EGY" | "NGA") {
    setBusy(true);
    setError(null);
    try {
      const res = await loadDemoPack({ data: { which, role, actorName } });
      if (res.ok) nav({ to: "/c/$id", params: { id: res.id } });
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the worked example");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!pending) return;
    setRemoving(true);
    setError(null);
    const id = pending.id;
    try {
      const res = await deleteCountry({ data: { id, role, actorName } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      setPending(null);
      refresh().catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the country");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-sage">Portfolio</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Countries under preparation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Open a country to inspect the {model.indicators.length}-indicator diagnostic, optionally
            add pre-launch source documents, and generate a complete Draft DAR in one autonomous run
            — or load a worked example.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onDemo("EGY")} disabled={busy}>
            Egypt worked example
          </Button>
          <Button variant="outline" onClick={() => onDemo("NGA")} disabled={busy}>
            Nigeria worked example
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New country
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-6 grid gap-3">
        {rows === null ? (
          <div className="h-32 animate-pulse rounded-xl bg-moss/40" />
        ) : rows.length === 0 ? (
          <Card>
            <h2 className="font-display text-xl">No countries yet</h2>
            <p className="mt-2 text-sm text-muted">
              Open a country to prepare and launch its autonomous Draft DAR workflow, or load the
              Egypt or Nigeria worked example to see the instrument fully populated — holds, gaps,
              tiers and all.
            </p>
          </Card>
        ) : (
          rows.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/c/$id" params={{ id: c.id }} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl">{c.name}</h2>
                  <span className="font-mono text-xs text-subtle">{c.iso3}</span>
                  {c.modelVersion && (
                    <span className="text-xs text-subtle">DAMM {c.modelVersion}</span>
                  )}
                </div>
                <MatrixLine c={c} />
                <p className="mt-2 text-xs tabular-nums text-muted" title={c.createdAt}>
                  Opened {formatWhen(c.createdAt)}
                  {c.updatedAt && !sameDisplayedTime(c.createdAt, c.updatedAt)
                    ? ` · Last change ${formatWhen(c.updatedAt)}`
                    : ""}
                </p>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 self-end sm:self-center"
                aria-label={`Remove ${c.name}, opened ${formatWhen(c.createdAt)}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setError(null);
                  setPending(c);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </Card>
          ))
        )}
      </div>
      {open ? (
        <NewCountry
          onClose={() => setOpen(false)}
          onCreated={(id) => nav({ to: "/c/$id", params: { id } })}
        />
      ) : null}
      {pending ? (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-white/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-title"
        >
          <Card className="w-full max-w-md rounded-2xl border border-subtle p-6">
            <h2 id="remove-title" className="font-display text-2xl">
              Remove {pending.name}?
            </h2>
            <p className="mt-1 text-sm tabular-nums text-muted">
              Opened {formatWhen(pending.createdAt)}
            </p>
            <p className="mt-2 text-sm text-muted">
              The country leaves the portfolio. The action is written to the audit trail. You can
              open it again later as a new engagement.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setPending(null)}
                disabled={removing}
              >
                Keep
              </Button>
              <Button variant="danger" type="button" onClick={confirmRemove} disabled={removing}>
                {removing ? "Removing…" : "Remove"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function NewCountry({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { role, actorName } = useSessionRole();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Economy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listEconomies()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return list.slice(0, 12);
    return list
      .filter((e) => e.name.toLowerCase().includes(n) || e.iso3.toLowerCase().includes(n))
      .slice(0, 12);
  }, [q, list]);

  async function choose(name: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await createCountry({ data: { name, role, actorName } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-white/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-lg rounded-2xl border border-subtle p-6">
        <h2 className="font-display text-2xl">Open a country</h2>
        <p className="mt-1 text-sm text-muted">
          Search by name. The ISO3 code is derived from the World Bank economy list — you never type
          a code.
        </p>
        <Input
          className="mt-4"
          placeholder="Country name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <ul className="mt-3 max-h-64 overflow-auto">
          {filtered.map((e) => (
            <li key={e.iso3}>
              <button
                type="button"
                disabled={busy}
                onClick={() => choose(e.name)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-sm hover:bg-moss"
              >
                <span>{e.name}</span>
                <span className="font-mono text-xs text-subtle">{e.iso3}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
