/**
 * The country workspace, on the DAMM v1.7 instrument.
 *
 * The screen works the way the scoring workbook works. An assessor edits the
 * entry columns — value, source, source URL, tier, year, assessor level — plus
 * the ratification hold and notes. Everything else on the page is derived:
 * the evidence class from the value, the level from the cut-points, pillar
 * bands from the levels actually recorded, prerequisite statuses from
 * presence, and the readiness matrix from the prerequisites and the bearing
 * indicators. A mean never appears without its own denominator, and a value
 * awaiting ratification says so wherever it is shown.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { RunsTab } from "@/components/damm/RunsTab";
import { DocumentsTab } from "@/components/damm/DocumentsTab";
import { DarReviewTab } from "@/components/damm/DarReviewTab";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useSessionRole } from "@/lib/session";
import { model, indicatorById, pillarIds, useCaseIds } from "@/lib/damm-v17/model";
import {
  getWorkspace,
  listAudit,
  updateEvidence,
  type Workspace,
  type WorkspaceRow,
} from "@/lib/damm-v17/actions";
import type { Assessment, IndicatorDef, PillarId } from "@/lib/damm-v17/types";
import { AlertTriangle, CircleHelp, Loader2 } from "lucide-react";

type Tab =
  | "overview"
  | "readiness"
  | "evidence"
  | "research"
  | "documents"
  | "review"
  | "questions"
  | "audit";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "readiness", label: "Readiness" },
  { id: "evidence", label: "Editable evidence workspace" },
  { id: "research", label: "DAR workflow" },
  { id: "documents", label: "Draft downloads" },
  { id: "review", label: "Human controls" },
  { id: "questions", label: "Manual open questions" },
  { id: "audit", label: "Audit" },
];

/* ---------- small vocabulary widgets ---------- */

const CLS_STYLE: Record<string, string> = {
  Measured: "bg-ink text-paper",
  Documented: "bg-sage/80 text-paper",
  Judged: "bg-moss text-ink",
  Gap: "bg-transparent border border-ink/30 text-muted",
};

function ClsChip({ cls }: { cls: string }) {
  if (!cls) return <span className="text-xs text-subtle">—</span>;
  return (
    <span
      title={cls}
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-sm text-[10px] font-bold",
        CLS_STYLE[cls] ?? "bg-moss",
      )}
    >
      {cls[0]}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  Ready: "bg-forest/10 text-forest border-forest/30",
  Partial: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  Blocked: "bg-red-500/10 text-red-700 border-red-500/30",
  Unverified: "bg-moss text-muted border-ink/20",
  Present: "bg-forest/10 text-forest border-forest/30",
  "Present (narrow)": "bg-amber-500/10 text-amber-700 border-amber-500/30",
  Absent: "bg-red-500/10 text-red-700 border-red-500/30",
};

function StatusChip({ s }: { s: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[s] ?? "bg-moss",
      )}
    >
      {s}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return (
    <span
      title={model.source_tiers[tier as keyof typeof model.source_tiers] ?? ""}
      className="inline-block rounded-sm border border-ink/20 px-1 text-[10px] font-semibold text-muted"
    >
      {tier}
    </span>
  );
}

function StaleTag() {
  return (
    <span className="inline-block rounded-sm bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-700">
      stale
    </span>
  );
}

function HoldTag() {
  return (
    <span
      title="Level withheld pending ratification: the evidence measures a different construct from what the indicator names. The row is outside every mean."
      className="inline-block rounded-sm bg-moss px-1 text-[10px] font-semibold text-muted"
    >
      hold
    </span>
  );
}

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(2));

/* ---------- the view ---------- */

export function WorkspaceView({ id }: { id: string }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("research");

  const refresh = useCallback(async () => {
    const res = await getWorkspace({ data: { countryId: id } });
    if (res.ok) {
      setWs(res.workspace);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [id]);

  useEffect(() => {
    refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "Could not load the workspace"),
    );
  }, [refresh]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!ws)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Opening the workspace…
      </p>
    );

  const questionCount =
    model.open_decisions.length + model.indicators.filter((i) => i.ratification).length;

  return (
    <div>
      <Banner ws={ws} />
      <nav
        className="mt-6 flex flex-wrap gap-1 border-b border-ink/10"
        aria-label="Workspace sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-t-sm px-3 py-2 text-sm",
              tab === t.id
                ? "border-b-2 border-sage font-semibold text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.id === "questions" && (
              <span className="ml-1 text-xs text-subtle">{questionCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="mt-6">
        {tab === "overview" && <OverviewTab a={ws.assessment} />}
        {tab === "readiness" && <ReadinessTab a={ws.assessment} />}
        {tab === "evidence" && <EvidenceTab ws={ws} onChange={refresh} />}
        {tab === "research" && <RunsTab countryId={ws.id} />}
        {tab === "documents" && <DocumentsTab countryId={ws.id} />}
        {tab === "review" && <DarReviewTab countryId={ws.id} />}
        {tab === "questions" && <QuestionsTab ws={ws} />}
        {tab === "audit" && <AuditTab id={ws.id} />}
      </div>
    </div>
  );
}

function Banner({ ws }: { ws: Workspace }) {
  const a = ws.assessment;
  const vb = a.counts.Measured + a.counts.Documented;
  return (
    <header>
      <p className="text-xs font-medium uppercase tracking-widest text-sage">
        DAMM {ws.modelVersion} · {model.ratified ? "ratified" : "draft for review — decisions open"}
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold">{ws.name}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <span>
          {vb}/{model.indicators.length} value-backed (M+D)
        </span>
        <span>{a.rated} levelled</span>
        <span>{a.counts.Gap} recorded gaps</span>
        <span>{a.held} levels withheld</span>
        <span>{pillarIds.reduce((n, p) => n + a.pillars[p].stale, 0)} stale</span>
        <span className="flex items-center gap-1">
          {useCaseIds.map((uc) => (
            <span key={uc} title={`${model.use_cases[uc]}: ${a.matrix[uc].status}`}>
              <StatusChip s={a.matrix[uc].status} />
            </span>
          ))}
        </span>
      </div>
    </header>
  );
}

/* ---------- overview ---------- */

function OverviewTab({ a }: { a: Assessment }) {
  return (
    <div className="space-y-6">
      <Card className="overflow-x-auto p-4">
        <h2 className="text-sm font-semibold">Pillar profile</h2>
        <p className="mt-1 text-xs text-muted">
          A pillar mean averages only the rows that produced a level; Rated is that denominator, and
          Held counts levels withheld pending ratification. A band in (parentheses) rests more on
          judgment, gaps and withheld levels than on levelled evidence.
        </p>
        <table className="mt-3 w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-subtle">
              <th className="py-1 pr-2">Pillar</th>
              <th className="py-1 pr-2">n</th>
              <th className="py-1 pr-2">Rated</th>
              <th className="py-1 pr-2">Mean</th>
              <th className="py-1 pr-2">Band</th>
              <th className="py-1 pr-2">M / D / J / G</th>
              <th className="py-1 pr-2">Held</th>
              <th className="py-1">Stale</th>
            </tr>
          </thead>
          <tbody>
            {pillarIds.map((p) => {
              const d = a.pillars[p];
              const def = model.pillars[p];
              return (
                <tr key={p} className="border-t border-ink/10">
                  <td className="py-2 pr-2">
                    <span className="font-semibold">{p}</span>{" "}
                    <span className="text-muted">{def.name}</span>
                    {def.reading === "need" && (
                      <span className="ml-1 text-xs text-subtle" title={def.note}>
                        (need — a low reading is a large opportunity)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 tabular-nums">{d.n}</td>
                  <td
                    className={cn(
                      "py-2 pr-2 tabular-nums",
                      d.rated < d.n && "font-semibold text-amber-700",
                    )}
                  >
                    {d.rated}
                  </td>
                  <td className="py-2 pr-2 tabular-nums">{fmt(d.mean)}</td>
                  <td className="py-2 pr-2">{d.weak ? `(${d.band})` : d.band}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {d.comp.Measured} / {d.comp.Documented} / {d.comp.Judged} / {d.comp.Gap}
                  </td>
                  <td className="py-2 pr-2 tabular-nums">{d.held || "—"}</td>
                  <td className="py-2 tabular-nums">{d.stale || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Layers</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {model.layers.map((L) => (
            <div key={L}>
              <p className="text-xs uppercase tracking-wide text-subtle">{L}</p>
              <p className="mt-1 text-xl tabular-nums">{fmt(a.layers[L])}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          Leapfrog gap (Foundation − Transformation):{" "}
          <b className="tabular-nums">{fmt(a.leapfrog.gap)}</b>
          {a.leapfrog.gap !== null && Math.abs(a.leapfrog.gap) > model.config.leapfrog_threshold
            ? " — structural flag raised."
            : " — within the structural threshold."}
        </p>
      </Card>

      <p className="text-xs text-subtle">{model.prohibitions.join(" ")}</p>
    </div>
  );
}

/* ---------- readiness ---------- */

function ReadinessTab({ a }: { a: Assessment }) {
  const groups: Array<{ title: string; note: string; ids: string[] }> = [
    {
      title: "Universal",
      note: "Absence blocks every column; narrow presence caps every column at Partial; unverified leaves every column Unverified.",
      ids: Object.keys(a.prereq).filter((i) => a.prereq[i].kind === "UNIVERSAL"),
    },
    {
      title: "Per use case",
      note: "Absence blocks the named columns only.",
      ids: Object.keys(a.prereq).filter((i) => a.prereq[i].kind.startsWith("UC:")),
    },
    {
      title: "Delivery-risk flags",
      note: "Reported on the cover; they block nothing.",
      ids: Object.keys(a.prereq).filter((i) => a.prereq[i].kind === "DELIVERY"),
    },
  ];
  const meanDriven = useCaseIds.filter(
    (uc) => a.matrix[uc].status === "Partial" && a.matrix[uc].why === "thin enablers",
  );
  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h2 className="text-sm font-semibold">
          Prerequisites — presence only, a fact, never an opinion
        </h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-xs uppercase tracking-wide text-subtle">{g.title}</p>
              <p className="mt-0.5 text-xs text-muted">{g.note}</p>
              <ul className="mt-2 space-y-1.5">
                {g.ids.map((i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-mono text-xs text-subtle">{i}</span>{" "}
                      {indicatorById(i)?.name}
                      {a.prereq[i].kind.startsWith("UC:") && (
                        <span className="ml-1 text-xs text-subtle">
                          ({a.prereq[i].kind.slice(3)})
                        </span>
                      )}
                    </span>
                    <StatusChip s={a.prereq[i].status} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-x-auto p-4">
        <h2 className="text-sm font-semibold">Use-case readiness matrix</h2>
        <table className="mt-3 w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-subtle">
              <th className="py-1 pr-2" />
              {useCaseIds.map((uc) => (
                <th key={uc} className="py-1 pr-2">
                  <div className="font-semibold text-ink">{uc}</div>
                  <div className="font-normal normal-case">{model.use_cases[uc]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-ink/10">
              <td className="py-2 pr-2 font-medium">Status</td>
              {useCaseIds.map((uc) => (
                <td key={uc} className="py-2 pr-2">
                  <StatusChip s={a.matrix[uc].status} />
                </td>
              ))}
            </tr>
            <tr className="border-t border-ink/10">
              <td className="py-2 pr-2 font-medium">Named blocker / reason</td>
              {useCaseIds.map((uc) => (
                <td key={uc} className="py-2 pr-2 text-xs text-muted">
                  {a.matrix[uc].why || "—"}
                </td>
              ))}
            </tr>
            {/*
              Ruling 13.12: readiness is the enabling mean and is the only one that decides
              a column. Need and outcome are shown beside it, never averaged into it.
            */}
            <tr className="border-t border-ink/10">
              <td className="py-2 pr-2 font-medium">Readiness — enabling indicators</td>
              {useCaseIds.map((uc) => (
                <td key={uc} className="py-2 pr-2 tabular-nums">
                  {fmt(a.matrix[uc].mean_readiness)}{" "}
                  <span className="text-xs text-subtle">of {a.matrix[uc].n_bearing}</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-ink/10">
              <td className="py-2 pr-2 font-medium">Need — severity of the problem</td>
              {useCaseIds.map((uc) => (
                <td key={uc} className="py-2 pr-2 tabular-nums">
                  {fmt(a.matrix[uc].mean_need)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-ink/10">
              <td className="py-2 pr-2 font-medium">Outcomes already achieved</td>
              {useCaseIds.map((uc) => (
                <td key={uc} className="py-2 pr-2 tabular-nums">
                  {fmt(a.matrix[uc].mean_outcome)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          The bearing set for a column includes agricultural-need and outcome indicators as well as
          enabling ones, so both means are shown. Whether need and outcome rows belong in a
          readiness mean is an open design decision (13.12).
          {meanDriven.length > 0 && (
            <>
              {" "}
              {meanDriven.map((uc) => model.use_cases[uc]).join(", ")} currently turns on the mean
              rather than on a prerequisite — the case that decision will settle.
            </>
          )}
        </p>
      </Card>
    </div>
  );
}

/* ---------- evidence ---------- */

function EvidenceTab({ ws, onChange }: { ws: Workspace; onChange: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byPillar = useMemo(() => {
    const m = new Map<PillarId, WorkspaceRow[]>();
    for (const p of pillarIds) m.set(p, []);
    for (const r of ws.evidence) {
      const def = indicatorById(r.indicatorId);
      if (def) m.get(def.pillar)?.push(r);
    }
    return m;
  }, [ws.evidence]);

  return (
    <div className="space-y-6">
      <p className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900">
        <b>This editable workspace is not G1.</b> G1 reviews every machine-filled row in one
        immutable Stage 8 Draft package. Changes made here become inputs to a new workflow run and
        never alter or approve an existing Draft package.
      </p>
      <p className="text-sm text-muted">
        Enter what the instrument takes: a value (a number scores a threshold row; prose with a
        source reads Documented; a search trail beginning “DATA GAP” records a gap), the source and
        its tier, the year, and — where the row does not score itself — an assessor level. The class
        and level columns are derived, never chosen.
      </p>
      {pillarIds.map((p) => (
        <Card key={p} className="overflow-x-auto p-4">
          <h2 className="text-sm font-semibold">
            {p} · {model.pillars[p].name}
          </h2>
          <table className="mt-2 w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-subtle">
                <th className="py-1 pr-2">ID</th>
                <th className="py-1 pr-2">Indicator</th>
                <th className="py-1 pr-2">Class</th>
                <th className="py-1 pr-2">Level</th>
                <th className="py-1 pr-2">Value</th>
                <th className="py-1 pr-2">Year</th>
                <th className="py-1 pr-2">Source</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {(byPillar.get(p) ?? []).map((r) => {
                const def = indicatorById(r.indicatorId);
                if (!def) return null;
                return (
                  <RowAndEditor
                    key={r.indicatorId}
                    ws={ws}
                    row={r}
                    def={def}
                    open={openId === r.indicatorId}
                    onOpen={() => setOpenId(openId === r.indicatorId ? null : r.indicatorId)}
                    onChange={onChange}
                  />
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function RowAndEditor({
  ws,
  row,
  def,
  open,
  onOpen,
  onChange,
}: {
  ws: Workspace;
  row: WorkspaceRow;
  def: IndicatorDef;
  open: boolean;
  onOpen: () => void;
  onChange: () => Promise<void>;
}) {
  return (
    <>
      <tr className="border-t border-ink/10 align-top">
        <td className="py-2 pr-2 font-mono text-xs text-subtle">{row.indicatorId}</td>
        <td className="py-2 pr-2">
          {def.name}
          {def.prerequisite && (
            <span className="ml-1 text-sage" title={`Prerequisite (${def.prerequisite})`}>
              ✱
            </span>
          )}
          {def.ratification && (
            <span
              className="ml-1 inline-block align-middle text-amber-700"
              title={`Open definition question (13.5): ${def.ratification.open_question}`}
            >
              <CircleHelp className="inline size-3.5" />
            </span>
          )}
        </td>
        <td className="py-2 pr-2">
          <ClsChip cls={row.cls} /> {row.stale && <StaleTag />}{" "}
          {row.ratificationHold && <HoldTag />}
        </td>
        <td className="py-2 pr-2 tabular-nums">{row.level !== null ? `L${row.level}` : "—"}</td>
        <td className="max-w-[240px] py-2 pr-2 text-xs text-muted">
          <span className="line-clamp-2">{row.valueRaw ?? "—"}</span>
        </td>
        <td className="py-2 pr-2 tabular-nums">{row.observationYear ?? "—"}</td>
        <td className="max-w-[200px] py-2 pr-2 text-xs text-muted">
          <span className="line-clamp-1">
            {row.sourceUrl ? (
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {row.sourceName ?? row.sourceUrl}
              </a>
            ) : (
              (row.sourceName ?? "—")
            )}
          </span>{" "}
          <TierBadge tier={row.sourceTier} />
        </td>
        <td className="py-2 text-right">
          <Button size="sm" variant="outline" onClick={onOpen}>
            {open ? "Close" : "Edit"}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-ink/5 bg-moss/40">
          <td colSpan={8} className="p-3">
            <Editor ws={ws} row={row} def={def} onDone={onChange} />
          </td>
        </tr>
      )}
    </>
  );
}

function Editor({
  ws,
  row,
  def,
  onDone,
}: {
  ws: Workspace;
  row: WorkspaceRow;
  def: IndicatorDef;
  onDone: () => Promise<void>;
}) {
  const { role, actorName } = useSessionRole();
  const [valueRaw, setValueRaw] = useState(row.valueRaw ?? "");
  const [year, setYear] = useState(row.observationYear?.toString() ?? "");
  const [sourceName, setSourceName] = useState(row.sourceName ?? "");
  const [sourceUrl, setSourceUrl] = useState(row.sourceUrl ?? "");
  const [tier, setTier] = useState(row.sourceTier ?? "");
  const [level, setLevel] = useState(row.assessorLevel?.toString() ?? "");
  const [hold, setHold] = useState(row.ratificationHold);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const numeric = valueRaw.trim() !== "" && Number.isFinite(Number(valueRaw.trim()));
  const selfScoring = numeric && def.thresholds !== null;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await updateEvidence({
        data: {
          countryId: ws.id,
          indicatorId: row.indicatorId,
          role,
          actorName,
          valueRaw: valueRaw.trim() === "" ? null : valueRaw,
          observationYear: year.trim() === "" ? null : Number(year),
          sourceName: sourceName.trim() === "" ? null : sourceName,
          sourceUrl: sourceUrl.trim() === "" ? null : sourceUrl,
          sourceTier: tier === "" ? null : tier,
          assessorLevel: level === "" ? null : Number(level),
          ratificationHold: hold,
          notes: notes.trim() === "" ? null : notes,
        },
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {def.ratification && (
        <p className="flex items-start gap-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b>Open definition question (13.5):</b> {def.ratification.open_question}
          </span>
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="block text-xs">
          <span className="text-subtle">
            Value — number, citation prose, or “DATA GAP — searched …”
          </span>
          <Textarea
            value={valueRaw}
            onChange={(e) => setValueRaw(e.target.value)}
            rows={3}
            className="mt-1"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs">
            <span className="text-subtle">Year</span>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
              className="mt-1"
            />
          </label>
          <label className="block text-xs">
            <span className="text-subtle">Tier</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="mt-1 h-9 w-full rounded-sm border border-ink/20 bg-paper px-2 text-sm"
            >
              <option value="">—</option>
              {(["T1", "T2", "T3", "T4", "T5"] as const).map((t) => (
                <option key={t} value={t}>
                  {t} · {model.source_tiers[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block text-xs">
            <span className="text-subtle">Source</span>
            <Input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="col-span-2 block text-xs">
            <span className="text-subtle">Source URL</span>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-xs">
          <span className="text-subtle">
            Assessor level{selfScoring && " (a numeric threshold row scores itself)"}
          </span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            disabled={selfScoring}
            className="mt-1 h-9 w-28 rounded-sm border border-ink/20 bg-paper px-2 text-sm disabled:opacity-50"
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                L{l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />
          <span>
            Ratification hold — withhold the level; the evidence measures a different construct from
            what the indicator names
          </span>
        </label>
      </div>
      <label className="block text-xs">
        <span className="text-subtle">Notes</span>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1"
        />
      </label>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <div>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save row"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- open questions ---------- */

function QuestionsTab({ ws }: { ws: Workspace }) {
  const sevOrder = ["asserts-falsehood", "construct-drift", "unit-ambiguity"] as const;
  const sevLabel: Record<string, string> = {
    "asserts-falsehood": "The name asserts what the evidence does not measure",
    "construct-drift": "A defensible but measurably different proxy",
    "unit-ambiguity": "A unit or denominator left unfixed",
  };
  const rows = model.indicators.filter((i) => i.ratification);
  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Design decisions open for ratification</h2>
        <p className="mt-1 text-xs text-muted">
          This is a manual model-governance surface outside the active DAR workflow. These questions
          are not launch inputs and never pause Draft generation. Every value these rulings can
          change is data in the model file (version {ws.modelVersion}
          ); a ruling updates the model, and nothing here presents an unratified value as settled.
        </p>
        <ul className="mt-3 space-y-2">
          {model.open_decisions.map((d) => (
            <li key={d.id} className="text-sm">
              <span className="font-mono text-xs text-subtle">{d.id}</span> {d.title}
              {d.scope && <span className="ml-1 text-xs text-subtle">({d.scope})</span>}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="text-sm font-semibold">
          Indicator definitions with an open question{" "}
          <span className="text-subtle">
            ({rows.length} of {model.indicators.length})
          </span>
        </h2>
        {sevOrder.map((sev) => {
          const group = rows.filter((i) => i.ratification?.severity === sev);
          if (!group.length) return null;
          return (
            <div key={sev} className="mt-4">
              <p className="text-xs uppercase tracking-wide text-subtle">
                {sevLabel[sev]} · {group.length}
              </p>
              <ul className="mt-2 space-y-2">
                {group.map((i) => (
                  <li key={i.id} className="text-sm">
                    <span className="font-mono text-xs text-subtle">{i.id}</span> <b>{i.name}</b>
                    {i.prerequisite && <Badge className="ml-1">prerequisite</Badge>}
                    <p className="mt-0.5 text-xs text-muted">{i.ratification?.open_question}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ---------- audit ---------- */

function AuditTab({ id }: { id: string }) {
  const [rows, setRows] = useState<Array<{
    at: string;
    role: string;
    actorName: string;
    action: string;
    detail: string | null;
  }> | null>(null);
  useEffect(() => {
    listAudit({ data: { countryId: id } })
      .then(setRows)
      .catch(() => setRows([]));
  }, [id]);
  if (!rows) return <p className="text-sm text-muted">Loading the audit trail…</p>;
  return (
    <Card className="overflow-x-auto p-4">
      <h2 className="text-sm font-semibold">Audit trail</h2>
      <table className="mt-2 w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-subtle">
            <th className="py-1 pr-2">When</th>
            <th className="py-1 pr-2">Who</th>
            <th className="py-1 pr-2">Action</th>
            <th className="py-1">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-t border-ink/10 align-top">
              <td className="whitespace-nowrap py-2 pr-2 text-xs text-muted">
                {new Date(r.at).toLocaleString()}
              </td>
              <td className="py-2 pr-2 text-xs">
                {r.actorName} <span className="text-subtle">({r.role})</span>
              </td>
              <td className="py-2 pr-2 text-xs font-medium">{r.action}</td>
              <td className="py-2 text-xs text-muted">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
