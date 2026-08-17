import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  generateDraft,
  generateMemo,
  getWorkspace,
  ingestTick,
  launchDiagnostic,
  listAudit,
  recordDecision,
  refreshPublicEvidence,
  runDossierSearch,
  updateEvidence,
  type Workspace,
} from "@/lib/damm/actions";
import { model } from "@/lib/damm/model";
import { modelExplainer } from "@/lib/damm/explainer";
import { FindingsTab, ForesightTab } from "./SweepTabs";
import { finalLevel, formatObserved, formatPct, formatScore, isStale, suggestedLevel } from "@/lib/damm/scoring";
import { nextAction } from "@/lib/damm/ladder";
import { chainSuggestions } from "@/lib/damm/chains";
import { importedCredibilitySummary, rowCredibility, type Credibility } from "@/lib/damm/credibility";
import { useSessionRole } from "@/lib/session";
import type { Confidence } from "@/lib/damm/types";
import type { DraftDocument as DraftDoc } from "@/lib/damm/draft";
import { escapeHtml } from "@/lib/utils";

const TAB_IDS = [
  "guide",
  "evidence",
  "gauntlet",
  "gates",
  "dossier",
  "findings",
  "uploads",
  "visuals",
  "steps",
  "memo",
  "exports",
  "outline",
  "audit",
] as const;

type Tab = (typeof TAB_IDS)[number];

/**
 * Eleven flat tabs overwhelmed first-time TTLs, so the workspace now has four
 * groups. Internal tab ids are unchanged — only the navigation and the visible
 * labels moved. "Readiness" is the gate formerly labelled "Gauntlet".
 */
const NAV_GROUPS: Array<{ name: string; tabs: Array<{ id: Tab; label: string }> }> = [
  { name: "Guide", tabs: [{ id: "guide", label: "Guide" }] },
  {
    name: "Evidence",
    tabs: [
      { id: "evidence", label: "Indicators" },
      { id: "gauntlet", label: "Readiness" },
      { id: "gates", label: "Core gates" },
      { id: "dossier", label: "Documents" },
      { id: "findings", label: "Findings" },
      { id: "uploads", label: "Foresight" },
      { id: "visuals", label: "Charts" },
    ],
  },
  {
    name: "Decisions",
    tabs: [
      { id: "steps", label: "Steps 2–8" },
      { id: "memo", label: "Memo" },
    ],
  },
  {
    name: "Outputs",
    tabs: [
      { id: "exports", label: "Draft & exports" },
      { id: "outline", label: "Outline" },
      { id: "audit", label: "Audit" },
    ],
  },
];

function groupOf(tab: Tab) {
  return NAV_GROUPS.find((g) => g.tabs.some((t) => t.id === tab)) ?? NAV_GROUPS[0];
}

export function WorkspaceView({ id }: { id: string }) {
  const { role, actorName } = useSessionRole();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("guide");
  const [launching, setLaunching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    const res = await getWorkspace({ data: { id } });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setWs(res.workspace);
    setError(null);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  useEffect(() => {
    if (!ws || ws.ingestStatus !== "running") return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      await ingestTick({ data: { countryId: id, role, actorName } });
      if (stop) return;
      await refresh();
    };
    const t = setInterval(tick, 1600);
    tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, ws?.ingestStatus]);

  async function onLaunch() {
    setLaunching(true);
    setError(null);
    try {
      const res = await launchDiagnostic({ data: { countryId: id, role, actorName } });
      if (!res.ok) setError(res.error);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not launch diagnostic");
    } finally {
      setLaunching(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshPublicEvidence({ data: { countryId: id, role, actorName } });
      if (!res.ok) setError(res.error);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh public series");
    } finally {
      setRefreshing(false);
    }
  }

  if (error && !ws) {
    return (
      <Card>
        <p className="text-danger">{error}</p>
        <Link to="/" className="mt-3 inline-block text-sm text-sage">
          Back to portfolio
        </Link>
      </Card>
    );
  }
  if (!ws) return <div className="h-48 animate-pulse rounded-xl bg-moss/40" />;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-sage">
            {ws.iso3} · Step {ws.openStep} of 8
          </p>
          <h1 className="font-display text-3xl font-semibold">{ws.name}</h1>
          <p className="mt-1 text-sm text-muted">{ws.claim.display}</p>
        </div>
        {ws.ingestStatus === "running" ? (
          <Badge tone="warn">
            Collecting {ws.ingestProgress}/{ws.ingestTotal}
          </Badge>
        ) : ws.ingestStatus === "idle" ? (
          <Button onClick={onLaunch} disabled={launching}>
            {launching ? "Launching…" : "Launch Step 1 diagnostic"}
          </Button>
        ) : ws.ingestStatus === "error" ? (
          <Button onClick={onLaunch} disabled={launching} variant="outline">
            Retry diagnostic
          </Button>
        ) : (
          <Button onClick={onRefresh} disabled={refreshing} variant="outline">
            {refreshing ? "Refreshing…" : "Refresh public evidence"}
          </Button>
        )}
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {ws.ingestMessage ? <p className="mt-2 text-xs text-subtle">{ws.ingestMessage}</p> : null}

      <div className="mt-4 flex gap-1 overflow-x-auto pb-1">
        {NAV_GROUPS.map((g) => (
          <button
            key={g.name}
            type="button"
            onClick={() => setTab(g.tabs[0].id)}
            className={`min-h-11 shrink-0 rounded-sm px-4 text-sm font-medium ${groupOf(tab).name === g.name ? "bg-forest text-forest-fg" : "text-muted hover:bg-moss"}`}
          >
            {g.name}
          </button>
        ))}
      </div>
      {groupOf(tab).tabs.length > 1 ? (
        <div className="mt-1 flex gap-1 overflow-x-auto border-b border-border pb-1">
          {groupOf(tab).tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-9 shrink-0 rounded-sm px-3 text-sm ${tab === t.id ? "bg-moss font-medium" : "text-muted hover:bg-moss/50"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5">
        {tab === "guide" ? <GuideTab ws={ws} setTab={setTab} onLaunch={onLaunch} launching={launching} /> : null}
        {tab === "gauntlet" ? <GauntletTab ws={ws} /> : null}
        {tab === "dossier" ? <DossierTab ws={ws} onChange={refresh} /> : null}
        {tab === "findings" ? <FindingsTab id={ws.id} /> : null}
        {tab === "uploads" ? <ForesightTab id={ws.id} /> : null}
        {tab === "steps" ? <Steps ws={ws} onChange={refresh} /> : null}
        {tab === "outline" ? <Outline ws={ws} /> : null}
        {tab === "evidence" ? <EvidenceTab ws={ws} onChange={refresh} /> : null}
        {tab === "visuals" ? <Visuals ws={ws} /> : null}
        {tab === "gates" ? <Gates ws={ws} /> : null}
        {tab === "memo" ? <MemoTab ws={ws} /> : null}
        {tab === "audit" ? <AuditTab id={ws.id} /> : null}
        {tab === "exports" ? <Exports ws={ws} /> : null}
      </div>
    </div>
  );
}

/**
 * The Guide: the seven-step path to a roadmap as a live checklist.
 *
 * Each item derives its state from the workspace, so the checklist is never
 * out of step with reality, and exactly one item carries the primary
 * "Do this next" action at any time. The scorecard overview renders beneath —
 * the Guide is the landing view, not an extra tab to discover.
 */
function GuideTab({
  ws,
  setTab,
  onLaunch,
  launching,
}: {
  ws: Workspace;
  setTab: (t: Tab) => void;
  onLaunch: () => void | Promise<void>;
  launching: boolean;
}) {
  const failing = ws.gauntlet.lines.filter((l) => l.failReason).length;
  const recorded = new Set(ws.decisions.map((d) => Number(d.step)));
  const laddered = [2, 3, 4, 5, 6, 7, 8].filter((n) => recorded.has(n)).length;

  type Item = {
    title: string;
    detail: string;
    done: boolean;
    optional?: boolean;
    actionLabel: string;
    action: () => void | Promise<void>;
    busy?: boolean;
  };

  const items: Item[] = [
    {
      title: "Run the Step 1 diagnostic",
      detail:
        ws.ingestStatus === "running"
          ? `The machine is collecting and researching — ${ws.ingestProgress}/${ws.ingestTotal} series done. 45–60 minutes; you can leave.`
          : "In sequence: all 97 model indicators from official statistics and verified web research (each with source, year, credibility and level), then a wider public-domain sweep beyond the indicator structure, then research into recent strategies and best practices. 45–60 minutes, unattended.",
      done: ws.step1Done,
      actionLabel: ws.ingestStatus === "running" ? "Collecting…" : "Launch the diagnostic",
      action: onLaunch,
      busy: launching || ws.ingestStatus === "running",
    },
    {
      title: "Add strategic-foresight material",
      detail:
        ws.uploadsCount > 0
          ? `${ws.uploadsCount} document${ws.uploadsCount === 1 ? "" : "s"} uploaded — the draft cites them as user-provided material alongside the collected evidence.`
          : "Upload scenario studies or foresight reports at any point — the draft cites them as user-provided material alongside the collected evidence.",
      done: ws.uploadsCount > 0,
      optional: true,
      actionLabel: "Open Foresight",
      action: () => setTab("uploads"),
    },
    {
      title: "Assemble and read the draft",
      detail:
        ws.draftCount > 0
          ? `${ws.draftCount} draft${ws.draftCount === 1 ? "" : "s"} assembled — evidence health page, 17 chapters, 11 annexes, every figure cited.`
          : "The full 17-chapter roadmap drafts from whatever the evidence base holds, opening with an evidence-health page that ranks what to strengthen.",
      done: ws.draftCount > 0,
      actionLabel: "Open Draft & exports",
      action: () => setTab("exports"),
    },
    {
      title: "Strengthen the evidence the draft flags",
      detail: ws.gauntlet.passed
        ? `Readiness gate cleared — ${ws.gauntlet.populated} of ${ws.gauntlet.mandatory} core gates carry adequate evidence.`
        : `${failing} core gates rest on machine research or nothing. The draft's health page ranks them; confirm the machine's proposals or attach documents in Evidence ▸ Indicators.`,
      done: ws.gauntlet.passed,
      optional: true,
      actionLabel: "Open Readiness",
      action: () => setTab("gauntlet"),
    },
    {
      title: "Record the decisions, Steps 2\u20138",
      detail:
        laddered >= 7
          ? "All seven decisions recorded. The record is adopted."
          : `${laddered} of 7 recorded. Optional for drafting — required before any maturity stage can be claimed. One short form per rung.`,
      done: laddered >= 7,
      optional: true,
      actionLabel: "Open Steps",
      action: () => setTab("steps"),
    },
  ];

  const nextIdx = items.findIndex((i) => !i.done && !i.optional);

  return (
    <div>
      <Card className="mb-4">
        <details open={!ws.step1Done}>
          <summary className="cursor-pointer font-display text-xl">
            The model this workspace runs
          </summary>
          <pre className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted">
            {modelExplainer(model)}
          </pre>
        </details>
      </Card>
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl">The path to a roadmap</h2>
          <span className="text-xs text-subtle">
            {items.filter((i) => i.done).length} of {items.length} done
          </span>
        </div>
        <ol className="mt-4 space-y-3">
          {items.map((item, idx) => {
            const isNext = idx === nextIdx;
            return (
              <li
                key={item.title}
                className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${
                  isNext ? "border-forest bg-moss/40" : "border-border/70"
                } ${item.done ? "opacity-80" : ""}`}
              >
                <span
                  aria-hidden
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    item.done ? "bg-forest text-forest-fg" : isNext ? "bg-surface shadow-[var(--shadow-border)]" : "bg-moss/60 text-muted"
                  }`}
                >
                  {item.done ? "\u2713" : idx + 1}
                </span>
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium">
                    {item.title}
                    {item.optional ? <span className="ml-2 text-xs font-normal text-subtle">optional</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{item.detail}</p>
                </div>
                <Button
                  size="sm"
                  variant={isNext ? "default" : "outline"}
                  disabled={Boolean(item.busy) || (item.done && idx === 0)}
                  onClick={item.action}
                >
                  {isNext && !item.busy ? `Do this next: ${item.actionLabel}` : item.actionLabel}
                </Button>
              </li>
            );
          })}
        </ol>
        {nextIdx === -1 ? (
          <p className="mt-4 text-sm text-muted">
            Every step is done. Export the draft and the evidence workbook from Draft &amp; exports — the result is a
            first-draft DAR, fully cited and ready for human rewriting and consultation.
          </p>
        ) : null}
      </Card>
      <div className="mt-5">
        <Overview ws={ws} onLaunch={async () => { await onLaunch(); }} launching={launching} />
      </div>
    </div>
  );
}

function Overview({
  ws,
  onLaunch,
  launching,
}: {
  ws: Workspace;
  onLaunch: () => Promise<void>;
  launching: boolean;
}) {
  const s = ws.scorecard;
  const next = nextAction(model, ws.decisions, ws.step1Done);
  return (
    <div>
      {ws.ingestStatus === "idle" || ws.ingestStatus === "error" ? (
        <Card className="mb-4">
          <p className="text-xs font-medium uppercase tracking-widest text-sage">Step 1 · TTL action</p>
          <h2 className="mt-1 font-display text-xl">Launch the automated diagnostic</h2>
          <p className="mt-2 text-sm text-muted">
            Official statistical APIs run first (World Bank WDI, ITU, UN EGDI, Findex, UNESCO via Data360). Remaining
            quantitative gaps are then searched on national statistics offices and official publications. A figure
            enters the table only with a public source URL. Rubric items stay named gaps for the panel. Credibility
            is shown beside every source and never weights a DAMM score.
          </p>
          {ws.ingestStatus === "error" ? <p className="mt-2 text-sm text-danger">{ws.ingestMessage}</p> : null}
          <Button className="mt-4" onClick={onLaunch} disabled={launching}>
            {launching ? "Launching…" : "Launch Step 1 diagnostic"}
          </Button>
        </Card>
      ) : null}
      {ws.ingestStatus === "running" ? (
        <Card className="mb-4">
          <p className="text-xs font-medium uppercase tracking-widest text-sage">Step 1 · collecting verified series</p>
          <h2 className="mt-1 font-display text-xl">
            {ws.ingestProgress} of {ws.ingestTotal} public series
          </h2>
          <p className="mt-2 text-sm text-muted">{ws.ingestMessage ?? "Fetching official public observations…"}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-moss">
            <div
              className="h-full bg-forest transition-all"
              style={{ width: `${ws.ingestTotal ? Math.min(100, (ws.ingestProgress / ws.ingestTotal) * 100) : 0}%` }}
            />
          </div>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <ScoreTile title="CMS" name="Capability" score={s.cms.score} coverage={s.cms.coverage} band={s.cms.band} reason={s.cms.suppressedReason} />
        <ScoreTile title="EMS" name="Ecosystem" score={s.ems.score} coverage={s.ems.coverage} band={s.ems.band} reason={s.ems.suppressedReason} />
        <ScoreTile title="OES" name="Outcomes" score={s.oes.score} coverage={s.oes.coverage} band={s.oes.band} reason={s.oes.suppressedReason} />
      </div>
      <Card className="mt-4">
        <p className="text-xs font-medium uppercase tracking-widest text-sage">Stage</p>
        <p className="mt-1 font-display text-2xl">{ws.claim.display}</p>
        <p className="mt-2 text-sm text-muted">{ws.claim.explanation}</p>
        <p className="mt-2 text-xs text-subtle">Engine cascade (not claimable on its own): {s.stage.label}</p>
      </Card>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Levelled" value={s.levelledCount} />
        <Stat label="Named gaps" value={s.namedGapCount} />
        <Stat label="Validated" value={s.validatedCount} />
        <Stat label="Stale" value={s.staleCount} />
      </div>
      <CredibilityOverview evidence={ws.evidence} />
      <GauntletStrip gauntlet={ws.gauntlet} />
      <DossierStrip dossier={ws.dossier} />
      <Card className="mt-4">
        <p className="text-xs font-medium uppercase tracking-widest text-sage">Suggested next action</p>
        <p className="mt-1 text-sm">{next.text}</p>
        <p className="mt-2 text-xs text-subtle">Advisory only — the ladder never auto-advances.</p>
      </Card>
    </div>
  );
}

function ScoreTile({
  title,
  name,
  score,
  coverage,
  band,
  reason,
}: {
  title: string;
  name: string;
  score: number | null;
  coverage: number;
  band: string | null;
  reason: string | null;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-widest text-sage">{title}</p>
      <p className="font-display text-3xl tabular-nums">{formatScore(score)}</p>
      <p className="text-sm text-muted">{name}</p>
      <p className="mt-2 text-xs text-subtle">
        {band ?? "Not rated"} · coverage {formatPct(coverage)}
      </p>
      {reason ? <p className="mt-1 text-xs text-warn">{reason}</p> : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-subtle">{label}</p>
      <p className="font-display text-2xl tabular-nums">{value}</p>
    </Card>
  );
}

function credibilityTone(tier: Credibility["tier"]): "ok" | "forest" | "warn" | "neutral" {
  if (tier === "A") return "ok";
  if (tier === "B" || tier === "C") return "forest";
  if (tier === "D") return "warn";
  return "neutral";
}

function CredibilityBadge({ cred, compact = false }: { cred: Credibility; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${cred.label}. ${cred.note}`}>
      <Badge tone={credibilityTone(cred.tier)}>
        {cred.tier} {cred.score}
      </Badge>
      {compact ? null : <span className="text-xs text-subtle">{cred.label.replace(/^[A-E] — /, "")}</span>}
    </span>
  );
}

function CredibilityOverview({ evidence }: { evidence: Workspace["evidence"] }) {
  const summary = importedCredibilitySummary(evidence);
  return (
    <Card className="mt-4">
      <p className="text-xs font-medium uppercase tracking-widest text-sage">Source credibility</p>
      <p className="mt-1 font-display text-2xl tabular-nums">
        {summary.mean === null ? "—" : summary.mean}
        <span className="ml-2 text-base font-sans font-normal text-muted">
          mean of {summary.count} imported reading{summary.count === 1 ? "" : "s"}
        </span>
      </p>
      <p className="mt-2 text-xs text-subtle">
        Official series first (A/B), then specialized official indices (C), then research (D). Credibility never
        weights CMS, EMS, OES or stage.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {(["A", "B", "C", "D", "E"] as const).map((tier) => (
          <span key={tier} className="rounded-full bg-moss/60 px-2.5 py-1">
            {tier} · {summary.byTier[tier]}
          </span>
        ))}
      </div>
    </Card>
  );
}

function GauntletStrip({ gauntlet }: { gauntlet: Workspace["gauntlet"] }) {
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-sage">Evidence gauntlet · 13 core gates</p>
          <p className="mt-1 font-display text-2xl">{gauntlet.passed ? "Cleared" : "Locked"}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{gauntlet.summary}</p>
        </div>
        <Badge tone={gauntlet.passed ? "ok" : "warn"}>{gauntlet.passed ? "Policy chapters open" : "Engagement pack only"}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Populated" value={gauntlet.populated} />
        <Stat label="Need (80%)" value={gauntlet.populatedNeeded} />
        <Stat label="A/B readings" value={gauntlet.gradeAB} />
      </div>
    </Card>
  );
}

function GauntletTab({ ws }: { ws: Workspace }) {
  const g = ws.gauntlet;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-medium uppercase tracking-widest text-sage">Readiness gate</p>
        <h2 className="mt-1 font-display text-2xl">{g.passed ? "Cleared — policy chapters may assemble" : "Not cleared — prescriptive chapters conditional"}</h2>
        <p className="mt-2 text-sm text-muted">{g.summary}</p>
        <p className="mt-2 text-xs text-subtle">
          Mandatory set is the 13 core gates, not the 97-indicator census. National exact series beat international
          official when definition, year and disaggregation match. Rubrics need a human level or an explicit data gap.
          Specialist desks challenge readings; they cannot write an assessor level.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Accounted" value={g.accounted} />
          <Stat label="Populated" value={g.populated} />
          <Stat label="A or B" value={g.gradeAB} />
          <Stat label="Research tasks" value={g.tasks.length} />
        </div>
      </Card>

      <div className="overflow-x-auto rounded-lg bg-surface shadow-[var(--shadow-border)]">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-subtle">
            <tr>
              <th className="px-3 py-2">Gate</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Reading</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Why it fails</th>
            </tr>
          </thead>
          <tbody>
            {g.lines.map((line) => (
              <tr key={line.indicatorId} className="border-b border-border/70 align-top">
                <td className="px-3 py-3">
                  <p className="font-mono text-xs text-subtle">{line.indicatorId}</p>
                  <p className="font-medium">{line.name}</p>
                  <p className="text-xs text-subtle">{line.specialist}</p>
                </td>
                <td className="px-3 py-3">
                  <Badge tone={line.kind === "rubric" ? "neutral" : "forest"}>
                    {line.kind === "rubric" ? "Documentary" : "Series"}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-sm">{line.reading}</td>
                <td className="px-3 py-3">
                  <Badge tone={line.status === "missing" ? "warn" : line.status === "human-gap" ? "neutral" : "ok"}>
                    {line.status.replace("-", " ")}
                  </Badge>
                </td>
                <td className="px-3 py-3">
                  {line.status === "missing" ? (
                    <span className="text-subtle">—</span>
                  ) : (
                    <span className="tabular-nums">
                      {line.grade}
                      {line.populated ? ` · ${line.score}` : ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums">{line.year ?? "—"}</td>
                <td className="px-3 py-3">
                  {line.sourceUrl ? (
                    <a className="text-sage underline" href={line.sourceUrl} target="_blank" rel="noreferrer">
                      {line.sourceName ?? line.sourceUrl}
                    </a>
                  ) : (
                    <span className="text-subtle">{line.sourceName ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-muted">{line.failReason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {g.challenges.length ? (
        <Card>
          <h3 className="font-display text-lg">Specialist challenge pass</h3>
          <p className="mt-1 text-xs text-subtle">Desks may downgrade or demand a human. They never set a level.</p>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {g.challenges.map((c) => (
              <li key={`${c.desk}-${c.indicatorId}`}>
                <span className="font-medium text-ink">{c.indicatorId} · {c.desk}.</span> {c.finding}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h3 className="font-display text-lg">Gap list and research tasks</h3>
        {g.tasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No outstanding core-gate research tasks.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {g.tasks.map((t) => (
              <li key={t.indicatorId} className="rounded-md bg-moss/40 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {t.indicatorId} {t.name}
                  </p>
                  <Badge tone={t.priority === "blocking" ? "warn" : "neutral"}>{t.priority}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{t.why}</p>
                <p className="mt-1 text-xs text-subtle">Steward: {t.steward} · {t.specialist} desk</p>
                <p className="mt-2 font-mono text-xs text-ink">{t.query}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function DossierStrip({ dossier }: { dossier: Workspace["dossier"] }) {
  if (!dossier.length) return null;
  return (
    <Card className="mt-4">
      <p className="text-xs font-medium uppercase tracking-widest text-sage">Country dossier · not scored</p>
      <p className="mt-1 font-display text-xl">{dossier.length} cited items</p>
      <p className="mt-2 text-sm text-muted">
        Context for Chapters 1–2 and research tasks. Dossier rows cannot write an indicator value or open the gauntlet.
      </p>
    </Card>
  );
}

function DossierTab({ ws, onChange }: { ws: Workspace; onChange: () => Promise<void> }) {
  const { role, actorName } = useSessionRole();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const job = ws.dossierJob ?? { status: "idle" as const, message: "", added: 0, total: 0 };
  const running = job.status === "running" || busy;

  useEffect(() => {
    if (job.status !== "running") return;
    const t = setInterval(() => {
      onChange().catch(() => undefined);
    }, 1600);
    return () => clearInterval(t);
  }, [job.status, onChange]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await runDossierSearch({ data: { countryId: ws.id, role, actorName } });
      if (!res.ok) setErr(res.error);
      await onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Dossier search failed");
    } finally {
      setBusy(false);
    }
  }

  const byUse = {
    "chapter-1": ws.dossier.filter((d) => d.informs === "chapter-1"),
    "chapter-2": ws.dossier.filter((d) => d.informs === "chapter-2"),
    "named-lead": ws.dossier.filter((d) => d.informs === "named-lead"),
    "research-task": ws.dossier.filter((d) => d.informs === "research-task"),
  };

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-medium uppercase tracking-widest text-sage">Opportunistic country file</p>
        <h2 className="mt-1 font-display text-2xl">Country dossier</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Search national, international and donor sources for material a TTL would actually read — strategies, laws,
          programmes, value-chain notes — including items that sit outside the 97 indicators. Hits are graded. They never
          write the evidence table and they cannot clear the 13-gate lock.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={run} disabled={running}>
            {running
              ? job.message || "Searching public sources…"
              : ws.dossier.length
                ? "Refresh dossier"
                : "Build country dossier"}
          </Button>
          <Badge tone="neutral">{ws.dossier.length} items</Badge>
        </div>
        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
        {job.message && !running ? <p className="mt-3 text-sm text-muted">{job.message}</p> : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Chapter 1" value={byUse["chapter-1"].length} />
        <Stat label="Chapter 2" value={byUse["chapter-2"].length} />
        <Stat label="Named leads" value={byUse["named-lead"].length} />
        <Stat label="Research tasks" value={byUse["research-task"].length} />
      </div>

      {ws.dossier.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No dossier yet. Run the search after Step 1. Official indicator series stay on the Evidence tab.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-subtle">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Use</th>
                <th className="px-3 py-2">Grade</th>
                <th className="px-3 py-2">Year</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {ws.dossier.map((d) => (
                <tr key={d.id} className="border-b border-border/70 align-top">
                  <td className="px-3 py-3">
                    <p className="font-medium">{d.title}</p>
                    <p className="mt-1 text-xs text-muted">{d.summary}</p>
                    {d.relatedIndicator ? (
                      <p className="mt-1 text-xs text-subtle">Lead only · {d.relatedIndicator} stays unmeasured until a matching series exists.</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone="neutral">{d.informs.replace("-", " ")}</Badge>
                    <p className="mt-1 text-xs capitalize text-subtle">{d.sourceClass}</p>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {d.score}/100 · {d.grade}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{d.year ?? "—"}</td>
                  <td className="px-3 py-3">
                    <a className="text-sage underline" href={d.sourceUrl} target="_blank" rel="noreferrer">
                      {d.sourceName}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Steps({ ws, onChange }: { ws: Workspace; onChange: () => Promise<void> }) {
  const { role, actorName } = useSessionRole();
  const open = ws.openStep;
  const rung = model.ladder.find((r) => r.step === open);
  const [option, setOption] = useState(
    rung?.options?.[0]?.name ?? rung?.decision ?? rung?.name ?? "Record",
  );
  const [decider, setDecider] = useState(actorName);
  const [notes, setNotes] = useState("");
  const [rejected, setRejected] = useState("");
  const [chains, setChains] = useState("");
  const [rejChains, setRejChains] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const suggestions = chainSuggestions(ws.iso3);

  useEffect(() => {
    setOption(rung?.options?.[0]?.name ?? rung?.decision ?? rung?.name ?? "Record");
    setDecider(actorName);
  }, [open, rung?.name, actorName]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-2">
        {model.ladder.map((r) => {
          const rec = ws.decisions.find((d) => d.step === r.step);
          const state = r.step === 1 && ws.step1Done ? "done" : rec ? "done" : r.step === open ? "open" : "locked";
          return (
            <div key={r.rung} className={`rounded-lg px-4 py-3 ${state === "open" ? "bg-moss" : "bg-surface"} shadow-[var(--shadow-border)]`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-subtle">
                  Step {r.step} · {r.rung} · {r.decider}
                </p>
                <Badge tone={state === "done" ? "ok" : state === "open" ? "forest" : "neutral"}>{state}</Badge>
              </div>
              <p className="font-medium">{r.name}</p>
              {rec ? (
                <p className="mt-1 text-xs text-muted">
                  {rec.optionName} — {rec.deciderName} ({rec.role})
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <Card>
        <h2 className="font-display text-xl">{rung?.name ?? "Closed"}</h2>
        <p className="mt-2 text-sm text-muted">{rung?.guidance}</p>
        {open === 1 && !ws.step1Done ? (
          <p className="mt-4 text-sm">The machine is still collecting public evidence. It will hand over when the first pass finishes.</p>
        ) : open === 1 ? (
          <p className="mt-4 text-sm">Step 1 is complete. Record Step 2 to continue.</p>
        ) : ws.decisions.some((d) => d.step === 8) ? (
          <p className="mt-4 text-sm">The record is adopted. Export the draft and archive the workbook.</p>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const payload =
                open === 3
                  ? {
                      chains: chains.split(",").map((s) => s.trim()).filter(Boolean),
                      rejected: rejChains.split(",").map((s) => s.trim()).filter(Boolean),
                    }
                  : undefined;
              const res = await recordDecision({
                data: {
                  countryId: ws.id,
                  step: open,
                  optionName: option,
                  deciderName: decider,
                  role,
                  actorName,
                  notes,
                  rejected,
                  payload,
                },
              });
              if (!res.ok) {
                setMsg(res.error);
                return;
              }
              setNotes("");
              setRejected("");
              setMsg("Decision recorded.");
              await onChange();
            }}
          >
            {rung?.options?.length ? (
              <label className="block text-sm">
                Option
                <select className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-3" value={option} onChange={(e) => setOption(e.target.value)}>
                  {rung.options.map((o) => (
                    <option key={o.name}>{o.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block text-sm">
                Decision
                <Input className="mt-1" value={option} onChange={(e) => setOption(e.target.value)} />
              </label>
            )}
            {rung?.options?.map((o) =>
              o.name === option ? (
                <p key={o.name} className="text-xs text-muted">
                  {o.means} {o.cost} {o.suits}
                </p>
              ) : null,
            )}
            <label className="block text-sm">
              Decider name
              <Input className="mt-1" value={decider} onChange={(e) => setDecider(e.target.value)} required />
            </label>
            {open === 3 ? (
              <>
                <label className="block text-sm">
                  Value-chain shortlist (comma-separated)
                  <Input className="mt-1" value={chains} onChange={(e) => setChains(e.target.value)} />
                </label>
                {suggestions.length ? (
                  <div>
                    <p className="text-xs text-subtle">
                      Suggested for {ws.name} from published crop notes. Click to add. These are targeting
                      hypotheses, not scored evidence.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {suggestions.map((s) => {
                        const selected = chains
                          .split(",")
                          .map((x) => x.trim())
                          .includes(s.name);
                        return (
                          <button
                            key={s.name}
                            type="button"
                            className={`min-h-11 rounded-sm px-3 text-left text-sm ${selected ? "bg-forest text-forest-fg" : "bg-moss text-ink"}`}
                            onClick={() => {
                              const cur = chains
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean);
                              setChains(
                                selected ? cur.filter((c) => c !== s.name).join(", ") : [...cur, s.name].join(", "),
                              );
                            }}
                            title={`${s.why} Source: ${s.sourceName}`}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {suggestions.map((s) => (
                        <li key={`${s.name}-src`}>
                          <span className="font-medium text-ink">{s.name}.</span> {s.why}{" "}
                          <a className="text-sage underline" href={s.sourceUrl} target="_blank" rel="noreferrer">
                            {s.sourceName}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <label className="block text-sm">
                  Rejected chains
                  <Input className="mt-1" value={rejChains} onChange={(e) => setRejChains(e.target.value)} />
                </label>
              </>
            ) : null}
            <label className="block text-sm">
              Notes, including rejected alternatives
              <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <label className="block text-sm">
              Explicitly rejected options
              <Input className="mt-1" value={rejected} onChange={(e) => setRejected(e.target.value)} />
            </label>
            <Button type="submit">Record decision</Button>
            {msg ? <p className="text-sm">{msg}</p> : null}
          </form>
        )}
      </Card>
    </div>
  );
}

function Outline({ ws }: { ws: Workspace }) {
  return (
    <div className="grid gap-3">
      {ws.chapters.map((ch) => (
        <Card key={ch.n}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg">
              {ch.n}. {ch.title}
            </h2>
            <Badge tone={ch.status === "inputs_ready" ? "ok" : ch.status === "inputs_forming" ? "warn" : "neutral"}>
              {ch.status.replace("_", " ")}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-subtle">
            Produced by {ch.producedBy} · ready at Step {ch.readyAt}
          </p>
          {ch.blockers.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {ch.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ok">Inputs ready for assembly.</p>
          )}
        </Card>
      ))}
    </div>
  );
}

function EvidenceTab({ ws, onChange }: { ws: Workspace; onChange: () => Promise<void> }) {
  const { role, actorName } = useSessionRole();
  const [q, setQ] = useState("");
  const [pillar, setPillar] = useState("all");
  const [onlyGates, setOnlyGates] = useState(false);
  const [onlyCited, setOnlyCited] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    return model.indicators.filter((i) => {
      if (pillar !== "all" && i.pillar !== pillar) return false;
      if (onlyGates && !i.gate) return false;
      if (onlyCited) {
        const e = ws.evidence.find((r) => r.indicatorId === i.id);
        if (!e || e.value === null || e.value === undefined) return false;
      }
      if (q && !`${i.id} ${i.name}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [q, pillar, onlyGates, onlyCited, ws.evidence]);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Official statistical systems first, then documented official proxies, then specialized official indices.
        Credibility sits beside the source and is never a score weight.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search indicators" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="h-11 rounded-sm border border-border bg-surface px-3 text-sm" value={pillar} onChange={(e) => setPillar(e.target.value)}>
          <option value="all">All pillars</option>
          {Object.keys(model.pillars).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyGates} onChange={(e) => setOnlyGates(e.target.checked)} />
          Core gates
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyCited} onChange={(e) => setOnlyCited(e.target.checked)} />
          Has a cited value
        </label>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg bg-surface shadow-[var(--shadow-border)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-3 py-2">Id</th>
              <th className="px-3 py-2">Indicator</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Credibility</th>
              <th className="px-3 py-2">Suggested</th>
              <th className="px-3 py-2">Assessor</th>
              <th className="px-3 py-2">Final</th>
              <th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ind) => {
              const e = ws.evidence.find((r) => r.indicatorId === ind.id);
              const suggested = e?.suggestedLevel ?? suggestedLevel(ind, e?.value ?? null);
              const final = e
                ? finalLevel({ dataGap: e.dataGap, assessorLevel: e.assessorLevel, suggestedLevel: suggested })
                : null;
              const stale = e ? isStale(ind, e, model.assessment_year, final) : false;
              return (
                <tr
                  key={ind.id}
                  className="cursor-pointer border-b border-border/70 hover:bg-moss/40"
                  onClick={() => setOpen(ind.id)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{ind.id}</td>
                  <td className="px-3 py-2">
                    {ind.name}
                    {ind.gate ? <Badge className="ml-2">Gate</Badge> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{e?.value == null ? "—" : formatObserved(e.value)}</td>
                  <td className="px-3 py-2 tabular-nums">{e?.observationYear ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {e?.sourceUrl ? (
                      <a
                        className="text-sage underline"
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.sourceName ?? "source"}
                      </a>
                    ) : (
                      (e?.sourceName ?? "—")
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e ? <CredibilityBadge cred={rowCredibility(e)} compact /> : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{suggested ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{e?.assessorLevel ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums font-medium">{final ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {e?.provenance === "named-gap" ? "gap " : ""}
                    {e?.provenance === "machine-researched" ? "researched " : ""}
                    {e?.isProxy ? "proxy " : ""}
                    {stale ? "stale " : ""}
                    {e?.dataGap ? "data-gap" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open ? (
        <EvidenceEditor
          ws={ws}
          indicatorId={open}
          onClose={() => setOpen(null)}
          onSave={async (patch) => {
            const res = await updateEvidence({
              data: { countryId: ws.id, indicatorId: open, role, actorName, ...patch },
            });
            if (!res.ok) throw new Error(res.error);
            await onChange();
          }}
        />
      ) : null}
    </div>
  );
}

function EvidenceEditor({
  ws,
  indicatorId,
  onClose,
  onSave,
}: {
  ws: Workspace;
  indicatorId: string;
  onClose: () => void;
  onSave: (patch: {
    assessorLevel?: number | null;
    dataGap?: boolean;
    value?: number | null;
    observationYear?: number | null;
    confidence?: Confidence | null;
    notes?: string | null;
    sourceName?: string | null;
    sourceUrl?: string | null;
  }) => Promise<void>;
}) {
  const ind = model.indicators.find((i) => i.id === indicatorId)!;
  const e = ws.evidence.find((r) => r.indicatorId === indicatorId);
  const [assessor, setAssessor] = useState(e?.assessorLevel?.toString() ?? "");
  const [value, setValue] = useState(e?.value == null ? "" : formatObserved(e.value));
  const [year, setYear] = useState(e?.observationYear?.toString() ?? "");
  const [gap, setGap] = useState(Boolean(e?.dataGap));
  const [conf, setConf] = useState<Confidence>(e?.confidence ?? "Medium");
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [sourceName, setSourceName] = useState(e?.sourceName ?? "");
  const [sourceUrl, setSourceUrl] = useState(e?.sourceUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-ink/40 p-0 sm:place-items-center sm:p-4">
      <Card className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl">
        <p className="font-mono text-xs text-sage">{ind.id} · {ind.pillar} · {ind.method}</p>
        <h2 className="font-display text-xl">{ind.name}</h2>
        <p className="mt-2 text-xs text-muted">{ind.calibration_note}</p>
        <div className="mt-3 space-y-1 text-xs text-muted">
          {(["L1", "L2", "L3", "L4", "L5"] as const).map((k) => (
            <p key={k}>
              <span className="font-medium text-ink">{k}.</span> {ind.anchors[k]}
            </p>
          ))}
        </div>
        {e?.provenance === "named-gap" ? (
          <p className="mt-3 text-sm">
            Named gap → {e.gapSteward}. {e.gapSource}
          </p>
        ) : null}
        {e?.isProxy ? <p className="mt-2 text-sm text-warn">Proxy: {e.proxyNote}</p> : null}
        {e?.sourceUrl ? (
          <p className="mt-2 text-xs">
            Stored source:{" "}
            <a className="text-sage underline" href={e.sourceUrl} target="_blank" rel="noreferrer">
              {e.sourceName ?? e.sourceUrl}
            </a>
          </p>
        ) : null}
        {e ? (
          <div className="mt-3 rounded-md bg-moss/50 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-widest text-sage">Source credibility</p>
            <div className="mt-1">
              <CredibilityBadge cred={rowCredibility({ ...e, sourceName, sourceUrl })} />
            </div>
            <p className="mt-1 text-xs text-muted">{rowCredibility({ ...e, sourceName, sourceUrl }).note}</p>
          </div>
        ) : null}
        <label className="mt-4 block text-sm">
          Observed value
          <Input className="mt-1" value={value} onChange={(ev) => setValue(ev.target.value)} />
        </label>
        <label className="mt-3 block text-sm">
          Observation year
          <Input className="mt-1" value={year} onChange={(ev) => setYear(ev.target.value)} />
        </label>
        <label className="mt-3 block text-sm">
          Source name (verified publisher)
          <Input className="mt-1" value={sourceName} onChange={(ev) => setSourceName(ev.target.value)} placeholder="World Bank WDI" />
        </label>
        <label className="mt-3 block text-sm">
          Source URL
          <Input className="mt-1" value={sourceUrl} onChange={(ev) => setSourceUrl(ev.target.value)} placeholder="https://" />
        </label>
        <p className="mt-1 text-xs text-subtle">
          A value or assessor level is stored only with a public http(s) source URL. Silence beats a guess.
        </p>
        <label className="mt-3 block text-sm">
          Assessor level (wins over the machine)
          <select className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-3" value={assessor} onChange={(ev) => setAssessor(ev.target.value)}>
            <option value="">No assessor level</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Confidence
          <select className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-3" value={conf} onChange={(ev) => setConf(ev.target.value as Confidence)}>
            <option>High</option>
            <option>Medium</option>
            <option>Low/Estimated</option>
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={gap} onChange={(ev) => setGap(ev.target.checked)} />
          Mark as explicit data gap (contributes nothing)
        </label>
        <label className="mt-3 block text-sm">
          Notes
          <Textarea className="mt-1" value={notes} onChange={(ev) => setNotes(ev.target.value)} />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onSave({
                  assessorLevel: assessor === "" ? null : Number(assessor),
                  dataGap: gap,
                  value: value === "" ? null : Number(value),
                  observationYear: year === "" ? null : Number(year),
                  confidence: conf,
                  notes,
                  sourceName: sourceName.trim() || null,
                  sourceUrl: sourceUrl.trim() || null,
                });
                onClose();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not save");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save and recompute
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
      </Card>
    </div>
  );
}

function Visuals({ ws }: { ws: Workspace }) {
  const data = ws.scorecard.pillars.map((p) => ({
    name: p.id,
    score: p.score,
    display: p.score === null ? null : p.score,
    coverage: Math.round(p.coverage * 100),
  }));
  return (
    <div className="grid gap-4">
      <Card>
        <h2 className="font-display text-xl">Pillar profile</h2>
        <p className="text-xs text-subtle">Suppressed pillars are omitted — they are not plotted as zero.</p>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.filter((d) => d.display !== null)}>
              <CartesianGrid stroke="#d8d2c4" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis domain={[1, 5]} ticks={[1, 1.8, 2.6, 3.4, 4.2, 5]} />
              <Tooltip />
              <Bar dataKey="display" fill="var(--color-forest)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-3 text-sm text-muted">
          {ws.scorecard.pillars
            .filter((p) => p.score === null)
            .map((p) => (
              <li key={p.id}>
                {p.id} {p.name}: not rated (coverage {formatPct(p.coverage)})
              </li>
            ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-display text-xl">Coverage by pillar</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="#d8d2c4" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="coverage" fill="var(--color-sage)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Gates({ ws }: { ws: Workspace }) {
  return (
    <div className="grid gap-3">
      {ws.scorecard.gates.map((g) => (
        <Card key={g.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              <span className="font-mono text-xs text-subtle">{g.id}</span> {g.name}
            </p>
            {g.unmeasured ? <Badge tone="warn">Unmeasured</Badge> : g.failed ? <Badge tone="danger">Level 1 — failing</Badge> : <Badge tone="ok">Level {g.finalLevel}</Badge>}
          </div>
          {g.stale ? <p className="mt-1 text-xs text-warn">Stale evidence</p> : null}
        </Card>
      ))}
    </div>
  );
}

function MemoTab({ ws }: { ws: Workspace }) {
  const [text, setText] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <h2 className="font-display text-xl">Decision memo — Step {ws.openStep}</h2>
      <p className="mt-1 text-sm text-muted">Assembled from engine facts. It does not recommend an option.</p>
      <Button
        className="mt-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const res = await generateMemo({ data: { countryId: ws.id, step: ws.openStep } });
          if (!res.ok && !res.text) setErr(res.error);
          setText(res.text);
          setBusy(false);
        }}
      >
        {busy ? "Assembling…" : "Assemble memo"}
      </Button>
      {err ? <p className="mt-2 text-sm text-danger">{err}</p> : null}
      {text ? <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed">{text}</pre> : null}
    </Card>
  );
}

function AuditTab({ id }: { id: string }) {
  const [rows, setRows] = useState<Array<{ id: string; at: string; role: string; actor_name: string; action: string; detail: string }>>([]);
  useEffect(() => {
    listAudit({ data: { countryId: id } }).then(setRows).catch(() => setRows([]));
  }, [id]);
  return (
    <div className="overflow-x-auto rounded-lg bg-surface shadow-[var(--shadow-border)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border text-xs uppercase text-subtle">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/70">
              <td className="px-3 py-2 text-xs tabular-nums">{new Date(r.at).toLocaleString()}</td>
              <td className="px-3 py-2">{r.role}</td>
              <td className="px-3 py-2">{r.actor_name}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
              <td className="px-3 py-2">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Exports({ ws }: { ws: Workspace }) {
  const { role, actorName } = useSessionRole();
  const [doc, setDoc] = useState<DraftDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function download(name: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function evidenceCsv() {
    const header = [
      "id",
      "name",
      "pillar",
      "value",
      "year",
      "source",
      "source_url",
      "credibility_tier",
      "credibility_score",
      "confidence",
      "provenance",
      "suggested",
      "assessor",
      "proxy",
      "gap",
    ];
    const lines = [header.join(",")];
    for (const ind of model.indicators) {
      const e = ws.evidence.find((r) => r.indicatorId === ind.id);
      const cred = e ? rowCredibility(e) : null;
      const cells = [
        ind.id,
        `"${ind.name.replaceAll('"', '""')}"`,
        ind.pillar,
        e?.value == null ? "" : formatObserved(e.value),
        e?.observationYear ?? "",
        `"${(e?.sourceName ?? "").replaceAll('"', '""')}"`,
        `"${(e?.sourceUrl ?? "").replaceAll('"', '""')}"`,
        cred?.tier ?? "",
        cred?.score ?? "",
        e?.confidence ?? "",
        e?.provenance ?? "",
        e?.suggestedLevel ?? "",
        e?.assessorLevel ?? "",
        e?.isProxy ? "yes" : "",
        e?.dataGap ? "yes" : "",
      ];
      lines.push(cells.join(","));
    }
    download(`${ws.iso3}-evidence.csv`, lines.join("\n"), "text/csv");
  }

  return (
    <div className="grid gap-4">
      <Card>
        <h2 className="font-display text-xl">Workbooks</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={evidenceCsv}>
            Evidence CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const header = [
                "title",
                "year",
                "source",
                "url",
                "class",
                "informs",
                "related_indicator",
                "grade",
                "score",
                "summary",
              ];
              const lines = [header.join(",")];
              for (const d of ws.dossier) {
                lines.push(
                  [
                    `"${d.title.replaceAll('"', '""')}"`,
                    d.year ?? "",
                    `"${d.sourceName.replaceAll('"', '""')}"`,
                    d.sourceUrl,
                    d.sourceClass,
                    d.informs,
                    d.relatedIndicator ?? "",
                    d.grade,
                    d.score,
                    `"${d.summary.replaceAll('"', '""')}"`,
                  ].join(","),
                );
              }
              download(`${ws.iso3}-dossier.csv`, lines.join("\n"), "text/csv");
            }}
          >
            Dossier CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => download(`${ws.iso3}-model.json`, JSON.stringify(model, null, 2), "application/json")}
          >
            Model configuration
          </Button>
        </div>
      </Card>
      <Card>
        <h2 className="font-display text-xl">DAR first draft</h2>
        <p className="mt-1 text-sm text-muted">
          Assembly, not free generation. Unready chapters become gap notes. Investment, cost and policy chapters stay
          locked until the evidence gauntlet on the 13 core gates clears.
        </p>
        {ws.gauntlet.passed ? null : (
          <p className="mt-3 rounded-md bg-moss/50 px-3 py-2 text-sm text-muted">{ws.gauntlet.summary}</p>
        )}
        <Button
          className="mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const res = await generateDraft({ data: { countryId: ws.id, role, actorName } });
            if (!res.ok) {
              setErr(res.error);
              setBusy(false);
              return;
            }
            setDoc(res.doc);
            setBusy(false);
          }}
        >
          {busy ? "Assembling…" : "Assemble draft"}
        </Button>
        {err ? <p className="mt-2 text-sm text-danger">{err}</p> : null}
        {doc ? (
          <div className="mt-6 space-y-6">
            <p className="text-xs text-subtle">
              Machine-drafted by {doc.modelName} on {doc.generatedAt}. For human rewriting. {doc.disclaimer}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
                  <style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#1c1f1a;line-height:1.5}
                  h1,h2{font-weight:600} .disc{font-size:12px;border:1px solid #ccc;padding:8px}</style></head>
                  <body><p class="disc">${escapeHtml(doc.disclaimer)}</p><h1>${escapeHtml(doc.title)}</h1>
                  ${doc.chapters.map((c) => `<h2>${c.n === "health" ? escapeHtml(c.title) : `${escapeHtml(c.n)}. ${escapeHtml(c.title)}`}</h2><p><em>Machine-drafted by ${escapeHtml(c.modelName)} on ${escapeHtml(c.draftedAt)}. Draft for human rewriting.</em></p><pre style="white-space:pre-wrap;font-family:Georgia">${escapeHtml(c.body)}</pre>`).join("")}
                  </body></html>`;
                download(`${ws.iso3}-dar-draft.html`, html, "text/html");
              }}
            >
              Download HTML
            </Button>
            {doc.chapters.map((c) => (
              <article key={c.n}>
                <h3 className="font-display text-lg">
                  {c.n === "health" ? c.title : `${c.n}. ${c.title}`}
                </h3>
                <p className="text-xs text-subtle">
                  Machine-drafted by {c.modelName} on {c.draftedAt}. Draft for human rewriting.
                  {c.ready ? "" : " Inputs not ready."}
                </p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{c.body}</pre>
              </article>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
