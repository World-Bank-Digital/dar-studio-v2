import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  createCountry,
  deleteCountry,
  listCountries,
  listEconomies,
  loadDemoPack,
  type CountrySummary,
  type Economy,
} from "@/lib/damm/actions";
import { formatScore } from "@/lib/damm/scoring";
import { disclaimer } from "@/lib/damm/model";
import { useSessionRole } from "@/lib/session";
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
      <p className="text-xs font-medium uppercase tracking-widest text-sage">DAMM v1.3 · independent prototype</p>
      <h1 className="mt-2 font-display text-4xl font-semibold">Prepare a Digital Agriculture Roadmap</h1>
      <p className="mt-4 text-lg text-muted">
        DAR Studio collects public evidence, computes the maturity diagnostic exactly as specified, and assembles a first draft. Machines compute. Humans gate.
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
          <p className="text-xs uppercase tracking-widest text-sage">Collect</p>
          <p className="mt-1 text-sm">World Bank series are imported. Everything else is a named gap routed to a steward.</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-widest text-sage">Compute</p>
          <p className="mt-1 text-sm">CMS, EMS and OES stay separate. A core gate at Level 1 caps the stage. Thin evidence is silent.</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-widest text-sage">Assemble</p>
          <p className="mt-1 text-sm">The DAR draft is built from engine facts. Unready chapters become gap notes, not filler.</p>
        </Card>
      </div>
      <p className="mt-8 text-xs text-subtle">{disclaimer()}</p>
    </div>
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

  async function onDemo() {
    setBusy(true);
    setError(null);
    try {
      const res = await loadDemoPack({ data: { role, actorName } });
      if (res.ok) nav({ to: "/c/$id", params: { id: res.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load demonstration pack");
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
            As TTL, open a country and launch the Step 1 diagnostic. The machine collects only verified public
            series. Each row is an engagement package until government gates are recorded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onDemo} disabled={busy}>
            Load Bhutan pack
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
              Open a country as TTL and launch the Step 1 diagnostic. Try Egypt, Arab Rep. for a live World Bank
              collection, or load the Bhutan demonstration pack to explore a fully populated evidence set.
            </p>
          </Card>
        ) : (
          rows.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/c/$id" params={{ id: c.id }} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl">{c.name}</h2>
                  <span className="font-mono text-xs text-subtle">{c.iso3}</span>
                  <Badge>Step {c.currentStep}</Badge>
                  {c.ingestStatus === "running" ? <Badge tone="warn">Collecting evidence</Badge> : null}
                  {c.ingestStatus === "idle" ? <Badge tone="warn">Diagnostic not launched</Badge> : null}
                </div>
                <p className="mt-2 text-sm text-muted">
                  CMS {formatScore(c.cms)} · EMS {formatScore(c.ems)} · OES {formatScore(c.oes)}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {c.levelledCount} levelled · {c.namedGapCount} named gaps · {c.staleCount} stale · {c.coreUnmeasured} gates unmeasured
                </p>
                <p className="mt-1 text-xs text-subtle">Stage is not shown here — engagement-package rule.</p>
                <p className="mt-2 text-xs tabular-nums text-muted" title={c.createdAt}>
                  Opened {formatWhen(c.createdAt)}
                  {c.updatedAt && !sameDisplayedTime(c.createdAt, c.updatedAt) ? ` · Last change ${formatWhen(c.updatedAt)}` : ""}
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
      {open ? <NewCountry onClose={() => setOpen(false)} onCreated={(id) => nav({ to: "/c/$id", params: { id } })} /> : null}
      {pending ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="remove-title">
          <Card className="w-full max-w-md rounded-2xl p-6">
            <h2 id="remove-title" className="font-display text-2xl">
              Remove {pending.name}?
            </h2>
            <p className="mt-1 text-sm tabular-nums text-muted">Opened {formatWhen(pending.createdAt)}</p>
            <p className="mt-2 text-sm text-muted">
              The country leaves the portfolio. The action is written to the audit trail. You can open it again later
              as a new engagement.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setPending(null)} disabled={removing}>
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

function NewCountry({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { role, actorName } = useSessionRole();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Economy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listEconomies().then(setList).catch(() => setList([]));
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return list.slice(0, 12);
    return list.filter((e) => e.name.toLowerCase().includes(n) || e.iso3.toLowerCase().includes(n)).slice(0, 12);
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-lg rounded-2xl p-6">
        <h2 className="font-display text-2xl">Open a country</h2>
        <p className="mt-1 text-sm text-muted">Search by name. The ISO3 code is derived from the World Bank economy list — you never type a code.</p>
        <Input className="mt-4" placeholder="Country name" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
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
