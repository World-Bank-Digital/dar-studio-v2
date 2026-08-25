/**
 * Running the research pipeline from the workspace.
 *
 * The screen's job is to make a run's state legible without softening it. Three things
 * it will not do:
 *
 *  - **It never shows a percentage it does not have.** Until the pipeline reports its row
 *    count, there is no denominator, and a bar at 0% would read as a run that has done
 *    nothing rather than one that has not said yet.
 *  - **Exhausted is not an error.** A pass that reaches its allocation and stops has
 *    produced real findings for the rows it reached. It is shown as an unfinished job with
 *    a decision attached, and it says plainly that the rows it did not reach are absent
 *    rather than recorded as gaps — which is the difference between "we did not look" and
 *    "we looked and found nothing".
 *  - **Money is shown against its allocation**, not as a bare number, because $200 means
 *    nothing without the $200 it is out of.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CEILING_USD,
  RUNNABLE_PASSES,
  defaultVendorFor,
  callsAVendor,
  passCap,
  producesEvidence,
  projectToFinish,
  RATE_ALLOWANCE,
  VENDOR_CHOICES,
  type RunPass,
  type RunStatus,
} from "@/lib/damm-v17/runs";
import { useSessionRole } from "@/lib/session";
import { artifactsFor } from "@/lib/damm-v17/worker-artifacts";
import {
  getRunDetail,
  importPassOutput,
  listCountryRuns,
  resumeRun,
  startRun,
  stopRun,
  type RunView,
} from "@/lib/damm-v17/run-actions";
import { AlertTriangle, Download, FileText, Loader2, Play, Square, Pause, RotateCw } from "lucide-react";

const PASS_LABEL: Record<string, string> = {
  research: "Research — the 57-row first pass",
  g2: "Second review — gaps, holds and prerequisites",
  diagnostic: "Diagnostic report — renders the assessment",
  scans: "Scans — evidence outside the instrument, and precedent",
  foresight: "Foresight — scenarios, a preferred future, milestones",
  generation: "Draft roadmap — eleven chapters",
};

const STATUS_STYLE: Record<RunStatus, string> = {
  queued: "bg-moss text-muted border-ink/20",
  running: "bg-sage/15 text-sage border-sage/40",
  paused: "bg-moss text-muted border-ink/20",
  // Amber, never red: a run that stopped on budget did real work and is waiting on a
  // decision. Colouring it as a failure would teach an operator to treat it as one.
  exhausted: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  failed: "bg-red-500/10 text-red-700 border-red-500/30",
  done: "bg-forest/10 text-forest border-forest/30",
  cancelled: "bg-moss text-subtle border-ink/20",
};

function StatusChip({ s }: { s: RunStatus }) {
  return (
    <span className={cn("inline-block rounded-sm border px-1.5 py-0.5 text-xs font-medium", STATUS_STYLE[s])}>
      {s}
    </span>
  );
}

const money = (n: number) => `$${n.toFixed(2)}`;
const ACTIVE: RunStatus[] = ["queued", "running"];

/* ---------- starting a pass ---------- */

function StartPass({ countryId, onStarted }: { countryId: string; onStarted: () => void }) {
  const [pass, setPass] = useState<RunPass>("research");
  const [ceiling, setCeiling] = useState(String(DEFAULT_CEILING_USD));
  const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ceilingNum = Number(ceiling);
  const capValid = Number.isFinite(ceilingNum) && ceilingNum > 0;
  const effective = vendor || defaultVendorFor(pass) || "the pipeline default";

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await startRun({
        data: { countryId, pass, ceilingUsd: ceilingNum, vendor: vendor || null },
      });
      if (!res.ok) setError(res.error);
      else onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Start a pass</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
        <label className="text-xs text-muted">
          Pass
          <select
            value={pass}
            onChange={(e) => setPass(e.target.value as RunPass)}
            className="mt-1 flex h-11 w-full rounded-sm border border-border bg-surface px-3 text-sm text-ink"
          >
            {RUNNABLE_PASSES.map((p) => (
              <option key={p} value={p}>
                {PASS_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-muted">
          Country ceiling
          <Input
            className="mt-1"
            value={ceiling}
            inputMode="decimal"
            onChange={(e) => setCeiling(e.target.value)}
            aria-invalid={!capValid}
          />
        </label>

        <label className={cn("text-xs text-muted", !callsAVendor(pass) && "opacity-40")}>
          Vendor
          <select
            disabled={!callsAVendor(pass)}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="mt-1 flex h-11 w-full rounded-sm border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">Pipeline default — {defaultVendorFor(pass) ?? "unset"}</option>
            {VENDOR_CHOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <Button onClick={go} disabled={busy || !capValid} className="w-full sm:w-auto">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Start
          </Button>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        {!capValid ? (
          <>Enter a country ceiling above zero.</>
        ) : !callsAVendor(pass) ? (
          <>
            This pass makes no vendor call. It renders an assessment the research pass has
            already paid for, so it spends nothing.
          </>
        ) : (
          <>
            This pass may spend <strong>{money(passCap(pass, ceilingNum))}</strong> of the{" "}
            {money(ceilingNum)} country ceiling, on {effective}. It stops itself at that
            allocation rather than continuing.
          </>
        )}
      </p>

      {pass === "g2" && (
        <p className="mt-2 text-xs text-muted">
          The reviewer must come from a different vendor than the research pass, so that a
          model is not reviewing its own work.
        </p>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-sm border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </Card>
  );
}

/* ---------- one run ---------- */

function Progress({ run }: { run: RunView }) {
  const p = run.progress;
  return (
    <div className="mt-2 space-y-2">
      <div>
        <div className="flex justify-between text-xs text-muted">
          <span>
            {p.rowsTotal != null ? (
              <>
                {p.rowsDone} of {p.rowsTotal} rows
              </>
            ) : (
              <>{p.rowsDone} rows — the pipeline has not reported its row count yet</>
            )}
          </span>
          {p.fraction != null && <span>{Math.round(p.fraction * 100)}%</span>}
        </div>
        {/* No denominator, no bar. A bar at 0% would read as a run that has done nothing. */}
        {p.fraction != null && (
          <div className="mt-1 h-1.5 w-full rounded-full bg-moss">
            <div className="h-1.5 rounded-full bg-sage" style={{ width: `${p.fraction * 100}%` }} />
          </div>
        )}
      </div>
      {/* A pass with a zero allocation would render as "at its allocation" the instant it
          started. A pass that costs nothing must not look like one that has run out. */}
      {callsAVendor(run.pass) ? (
        <div>
          <div className="flex justify-between text-xs text-muted">
            <span>
              {money(p.spentUsd)} of {money(p.capUsd)} allocated
            </span>
            {p.atCap && <span className="text-amber-700">at its allocation</span>}
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-moss">
            <div
              className={cn("h-1.5 rounded-full", p.atCap ? "bg-amber-500" : "bg-forest")}
              style={{ width: `${p.spentFraction * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Makes no vendor call — the assessment is already paid for.</p>
      )}
    </div>
  );
}

interface Held {
  indicatorId: string;
  yours: string;
  found: string;
  assessorName: string | null;
}

function RunCard({ run, onChange }: { run: RunView; onChange: () => void }) {
  const { role, actorName } = useSessionRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ summary: string; held: Held[] } | null>(null);
  // Defaulted to what the run's own rate says finishing needs. An operator asked to add
  // budget with no basis is guessing, and guessing low means exhausting again a few rows
  // from the end.
  //
  // Held as "what the operator typed, or nothing yet" rather than seeded once. A seeded
  // default is captured on the first render — while the run is still starting and has no
  // rate to read — so the field would keep offering a fallback long after the projection
  // became available, and the number shown at the moment of the decision would not be the
  // one the decision needs.
  const projection = useMemo(() => projectToFinish(run), [run]);
  const [typed, setTyped] = useState<string | null>(null);
  const topUp = typed ?? String(projection?.suggestedCeilingUsd ?? Math.round(run.ceilingUsd * 2));
  const setTopUp = setTyped;
  const [open, setOpen] = useState(false);

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? "That did not work.");
        else onChange();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not work.");
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const canStop = run.status === "queued" || run.status === "running";
  const canContinue = run.status === "paused" || run.status === "exhausted";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold">{PASS_LABEL[run.pass] ?? run.pass}</span>
          <span className="ml-2 text-xs text-subtle">{run.outBasename}</span>
        </div>
        <StatusChip s={run.status} />
      </div>

      <p className="mt-1 text-xs text-muted">
        {run.vendor ?? "pipeline default"}
        {run.startedAt && <> · started {new Date(run.startedAt).toLocaleString()}</>}
      </p>

      <Progress run={run} />

      <p
        className={cn(
          "mt-3 rounded-sm p-2 text-xs",
          run.status === "exhausted" && "border border-amber-500/30 bg-amber-500/5 text-amber-800",
          run.status === "failed" && "border border-red-500/30 bg-red-500/5 text-red-700",
          !["exhausted", "failed"].includes(run.status) && "text-muted",
        )}
      >
        {run.summary}
      </p>

      {run.status === "exhausted" && (
        <p className="mt-2 text-xs text-muted">
          {projection ? (
            <>
              It has cost {money(projection.costPerRow)} a row so far, so the{" "}
              {projection.rowsRemaining} rows left look like about{" "}
              {money(projection.projectedPassCost)} for the whole pass. The suggested
              ceiling of {money(projection.suggestedCeilingUsd)} adds{" "}
              {Math.round(RATE_ALLOWANCE * 100)}% to that, because the rows that finish
              first are the cheap ones and a rate read off them is a lower bound.
            </>
          ) : (
            <>
              There is no basis yet for how much finishing would cost — no rows have been
              completed against a known total.
            </>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {canStop && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act(() => stopRun({ data: { runId: run.id, to: "paused" } }))}
            >
              <Pause className="size-3.5" /> Pause
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => act(() => stopRun({ data: { runId: run.id, to: "cancelled" } }))}
            >
              <Square className="size-3.5" /> Cancel
            </Button>
          </>
        )}

        {canContinue && (
          <>
            {run.status === "exhausted" && (
              <label className="text-xs text-muted">
                New ceiling
                <Input
                  className="mt-1 h-9 w-28"
                  value={topUp}
                  inputMode="decimal"
                  onChange={(e) => setTopUp(e.target.value)}
                />
              </label>
            )}
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                act(() =>
                  resumeRun({
                    data: {
                      runId: run.id,
                      ceilingUsd: run.status === "exhausted" ? Number(topUp) : undefined,
                    },
                  }),
                )
              }
            >
              <RotateCw className="size-3.5" /> Continue
            </Button>
          </>
        )}

        {producesEvidence(run.pass) && (run.status === "done" || run.status === "exhausted") && (
          <Button
            size="sm"
            variant={run.status === "done" ? "default" : "outline"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await importPassOutput({
                  data: { runId: run.id, role, actorName },
                });
                if (!res.ok) setError(res.error);
                else {
                  setImported({ summary: res.summary, held: res.held });
                  onChange();
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "The import did not run.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download className="size-3.5" />
            {run.status === "exhausted" ? "Import what it reached" : "Import into the workspace"}
          </Button>
        )}

        {(run.status === "done" || run.status === "exhausted") &&
          artifactsFor(run.pass).map((art) => (
            <a
              key={art.key}
              href={`/api/runs/${run.id}/artifact?key=${art.key}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-xs font-medium text-ink hover:bg-moss"
            >
              <FileText className="size-3.5" />
              {art.label}
            </a>
          ))}

        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-xs text-muted underline hover:text-ink"
        >
          {open ? "Hide the log" : "Show the log"}
        </button>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-2 rounded-sm border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {imported && (
        <div className="mt-3 rounded-sm border border-forest/30 bg-forest/5 p-2">
          <p className="text-xs text-ink">{imported.summary}</p>
          {imported.held.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-subtle">
                  <th className="pr-2 font-normal">Row</th>
                  <th className="pr-2 font-normal">Yours</th>
                  <th className="font-normal">This pass found</th>
                </tr>
              </thead>
              <tbody>
                {imported.held.map((h) => (
                  <tr key={h.indicatorId} className="border-t border-ink/10 align-top">
                    <td className="py-1 pr-2 font-medium">{h.indicatorId}</td>
                    <td className="py-1 pr-2">
                      {h.yours}
                      {h.assessorName && <span className="text-subtle"> — {h.assessorName}</span>}
                    </td>
                    <td className="py-1 text-muted">{h.found}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {open && <EventLog runId={run.id} live={ACTIVE.includes(run.status)} />}
    </Card>
  );
}

/* ---------- the log ---------- */

interface LogLine {
  id: number;
  at: string | Date;
  kind: string;
  indicatorId: string | null;
  message: string | null;
}

function EventLog({ runId, live }: { runId: string; live: boolean }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [since, setSince] = useState(0);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await getRunDetail({ data: { runId, sinceEventId: since } });
      if (stop || !res.ok) return;
      if (res.events.length) {
        // Appended, never replaced: the caller holds what it has already drawn, so a long
        // run does not re-send its whole history every few seconds.
        setLines((prev) => [...prev, ...res.events]);
        setSince(res.events[res.events.length - 1].id);
      }
    }
    poll().catch(() => {});
    if (!live) return () => { stop = true; };
    const t = setInterval(() => void poll().catch(() => {}), 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [runId, since, live]);

  if (!lines.length) return <p className="mt-3 text-xs text-subtle">Nothing recorded yet.</p>;
  return (
    <div className="mt-3 max-h-64 overflow-y-auto rounded-sm border border-ink/10 bg-moss/40 p-2">
      {lines.map((l) => (
        <div key={l.id} className="flex gap-2 py-0.5 text-xs">
          <span className="shrink-0 text-subtle">{new Date(l.at).toLocaleTimeString()}</span>
          {l.indicatorId && <span className="shrink-0 font-medium">{l.indicatorId}</span>}
          <span className="text-muted">{l.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- the tab ---------- */

export function RunsTab({ countryId }: { countryId: string }) {
  const [runs, setRuns] = useState<RunView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listCountryRuns({ data: { countryId } });
      setRuns(res.runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the runs.");
    }
  }, [countryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyActive = useMemo(() => (runs ?? []).some((r) => ACTIVE.includes(r.status)), [runs]);

  useEffect(() => {
    // Polled only while something is moving. A finished list does not change on its own,
    // and polling it forever is a query a second for nothing.
    if (!anyActive) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [anyActive, refresh]);

  return (
    <div className="space-y-4">
      <StartPass countryId={countryId} onStarted={refresh} />

      {error && <p className="text-sm text-red-700">{error}</p>}

      {runs === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Reading the runs…
        </p>
      ) : runs.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted">
            No pass has been run for this country yet. A research pass reads all 57
            indicator rows and writes an engine input; the second review then reopens its
            gaps, holds and prerequisites.
          </p>
        </Card>
      ) : (
        runs.map((r) => <RunCard key={r.id} run={r} onChange={refresh} />)
      )}
    </div>
  );
}
