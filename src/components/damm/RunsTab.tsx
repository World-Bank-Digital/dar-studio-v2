/** One product launch for the complete, autonomous canonical DAR workflow. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Circle,
  Download,
  FileUp,
  Loader2,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";

import { ArtifactDownloadButton } from "@/components/damm/ArtifactDownloadButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  deleteWorkflowUpload,
  getRunDetail,
  listCountryRuns,
  listWorkflowUploads,
  startDarWorkflow,
  stopRun,
  uploadWorkflowDocument,
  type RunView,
  type WorkflowUploadView,
} from "@/lib/damm-v17/run-actions";
import type { RunStatus } from "@/lib/damm-v17/runs";
import { artifactsFor } from "@/lib/damm-v17/worker-artifacts";
import { DAR_WORKFLOW } from "@/lib/damm-v17/workflow";
import { cn } from "@/lib/utils";

const ACTIVE: RunStatus[] = ["queued", "running"];
const SOURCE_LIMIT_BYTES = 2 * 1024 * 1024;

const STATUS_STYLE: Record<RunStatus, string> = {
  queued: "bg-moss text-muted border-ink/20",
  running: "bg-sage/15 text-sage border-sage/40",
  paused: "bg-moss text-muted border-ink/20",
  exhausted: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  failed: "bg-red-500/10 text-red-700 border-red-500/30",
  done: "bg-forest/10 text-forest border-forest/30",
  cancelled: "bg-moss text-subtle border-ink/20",
};

function StatusChip({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn("rounded-sm border px-1.5 py-0.5 text-xs font-medium", STATUS_STYLE[status])}
    >
      {status === "done" ? "execution complete" : status}
    </span>
  );
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The browser could not read this document."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("The browser produced an invalid document payload."));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

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
    let stopped = false;
    async function poll() {
      const result = await getRunDetail({ data: { runId, sinceEventId: since } });
      if (stopped || !result.ok || !result.events.length) return;
      setLines((current) => [...current, ...result.events]);
      setSince(result.events[result.events.length - 1].id);
    }
    void poll().catch(() => undefined);
    if (!live) return () => void (stopped = true);
    const timer = setInterval(() => void poll().catch(() => undefined), 3_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [live, runId, since]);

  return lines.length ? (
    <div className="mt-3 max-h-64 overflow-y-auto rounded-sm border border-ink/10 bg-moss/40 p-2">
      {lines.map((line) => (
        <div key={line.id} className="flex gap-2 py-0.5 text-xs">
          <span className="shrink-0 text-subtle">{new Date(line.at).toLocaleTimeString()}</span>
          {line.indicatorId ? (
            <span className="shrink-0 font-medium">{line.indicatorId}</span>
          ) : null}
          <span className="text-muted">{line.message}</span>
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs text-subtle">No workflow events recorded yet.</p>
  );
}

function UploadCategory({
  countryId,
  category,
  uploads,
  disabled,
  onChange,
  onBusyChange,
}: {
  countryId: string;
  category: (typeof DAR_WORKFLOW.optional_launch_inputs)[number];
  uploads: WorkflowUploadView[];
  disabled: boolean;
  onChange: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(file: File) {
    if (file.size > SOURCE_LIMIT_BYTES) {
      setError("This file exceeds the 2 MB direct-upload limit.");
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await uploadWorkflowDocument({
        data: {
          countryId,
          kind: category.id,
          filename: file.name,
          mime: file.type,
          sourceBase64: await fileBase64(file),
        },
      });
      if (!result.ok) setError(result.error);
      else await onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be uploaded.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function remove(uploadId: string) {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await deleteWorkflowUpload({ data: { countryId, uploadId } });
      if (!result.ok) setError(result.error);
      else await onChange();
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="rounded-sm border border-ink/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{category.title}</h3>
          <p className="mt-1 text-xs text-subtle">
            Optional ·{" "}
            {category.accepted_extensions.map((extension) => extension.toUpperCase()).join(", ")}
          </p>
        </div>
        <label
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-sm border border-border-strong px-3 text-xs font-medium",
            disabled || busy ? "pointer-events-none opacity-50" : "hover:bg-moss",
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
          Add document
          <input
            type="file"
            className="sr-only"
            disabled={disabled || busy}
            accept={category.accepted_extensions.map((extension) => `.${extension}`).join(",")}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void add(file);
            }}
          />
        </label>
      </div>
      {uploads.length ? (
        <ul className="mt-2 space-y-1">
          {uploads.map((upload) => (
            <li
              key={upload.id}
              className="flex items-center justify-between gap-2 text-xs text-muted"
            >
              <span className="min-w-0 truncate">
                {upload.filename} · {(upload.sourceBytes / 1024).toFixed(1)} KB
                {upload.extractionStatus === "legacy" ? " · re-upload required" : " · extracted"}
              </span>
              <button
                type="button"
                className="shrink-0 text-subtle hover:text-red-700 disabled:opacity-40"
                disabled={disabled || busy}
                onClick={() => void remove(upload.id)}
                aria-label={`Remove ${upload.filename}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">
          No document supplied. The workflow will research this stage autonomously.
        </p>
      )}
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function WorkflowRun({ run, onChange }: { run: RunView; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = ACTIVE.includes(run.status);
  const completed = run.status === "done" ? DAR_WORKFLOW.stages.length : run.progress.rowsDone;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const result = await stopRun({ data: { runId: run.id, to: "cancelled" } });
      if (!result.ok) setError(result.error);
      else await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Canonical Draft DAR workflow</h2>
          <p className="mt-1 text-xs text-subtle">
            {run.outBasename} · launched{" "}
            {run.startedAt ? new Date(run.startedAt).toLocaleString() : "and queued"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.status === "done" ? (
            <span className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Draft · pre-review
            </span>
          ) : null}
          <StatusChip status={run.status} />
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {DAR_WORKFLOW.stages.map((stage) => {
          const done = completed >= stage.ordinal;
          const current = active && completed + 1 === stage.ordinal;
          return (
            <li key={stage.id} className="flex gap-2 rounded-sm border border-ink/10 p-2">
              {done ? (
                <Check className="mt-0.5 size-4 shrink-0 text-forest" />
              ) : current ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-sage" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-subtle" />
              )}
              <div>
                <p className="text-xs font-semibold">
                  {stage.ordinal}. {stage.title}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {done ? "Complete" : current ? "Running autonomously" : "Pending"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex justify-between text-xs text-muted">
        <span>{Math.min(completed, 8)} of 8 stages complete</span>
        <span>
          ${run.spentUsd.toFixed(2)} of ${run.ceilingUsd.toFixed(2)} preauthorized
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-moss">
        <div
          className="h-1.5 rounded-full bg-forest"
          style={{ width: `${Math.min(100, (Math.max(0, completed) / 8) * 100)}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-3 rounded-sm p-2 text-xs",
          run.status === "failed" ? "bg-red-500/5 text-red-700" : "text-muted",
        )}
      >
        {run.status === "done"
          ? "The autonomous workflow is complete. Its immutable Draft DAR package is verified and downloadable; execution success is not G1, G2, G3, approval, Final status, or publication readiness. Post-completion human controls are now available."
          : run.summary}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {active ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>
            <Square className="size-3.5" /> Cancel workflow
          </Button>
        ) : null}
        {run.status === "done" ? (
          <details className="w-full">
            <summary className="cursor-pointer text-xs font-medium text-forest">
              Download verified reports, data, inventories, provenance, and complete ZIP
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {artifactsFor("workflow").map((artifact) => (
                <ArtifactDownloadButton
                  key={artifact.key}
                  href={`/api/runs/${run.id}/artifact?key=${encodeURIComponent(artifact.key)}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-border-strong px-3 text-xs font-medium hover:bg-moss"
                >
                  <Download className="size-3.5" /> {artifact.label}
                </ArtifactDownloadButton>
              ))}
            </div>
          </details>
        ) : null}
        <button
          type="button"
          onClick={() => setShowLog((value) => !value)}
          className="ml-auto text-xs text-muted underline hover:text-ink"
        >
          {showLog ? "Hide event log" : "Show event log"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      {showLog ? <EventLog runId={run.id} live={active} /> : null}
    </Card>
  );
}

export function RunsTab({ countryId }: { countryId: string }) {
  const [runs, setRuns] = useState<RunView[] | null>(null);
  const [uploads, setUploads] = useState<WorkflowUploadView[]>([]);
  const [launching, setLaunching] = useState(false);
  const [busyCategories, setBusyCategories] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [runResult, uploadResult] = await Promise.all([
      listCountryRuns({ data: { countryId } }),
      listWorkflowUploads({ data: { countryId } }),
    ]);
    setRuns(runResult.runs.filter((run) => run.pass === "workflow"));
    setUploads(uploadResult.uploads as WorkflowUploadView[]);
    setError(null);
  }, [countryId]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Could not read the DAR workflow."),
    );
  }, [refresh]);

  const active = useMemo(() => (runs ?? []).find((run) => ACTIVE.includes(run.status)), [runs]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 3_000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const grouped = useMemo(() => {
    const canonicalKinds = new Set(
      DAR_WORKFLOW.optional_launch_inputs.map((category) => category.id),
    );
    return Object.fromEntries(
      DAR_WORKFLOW.optional_launch_inputs.map((category) => [
        category.id,
        uploads.filter(
          (upload) =>
            upload.kind === category.id ||
            (category.id === "country_context_documents" && !canonicalKinds.has(upload.kind)),
        ),
      ]),
    ) as Record<string, WorkflowUploadView[]>;
  }, [uploads]);
  const hasLegacy = uploads.some((upload) => upload.extractionStatus !== "extracted");
  const setCategoryBusy = useCallback((categoryId: string, busy: boolean) => {
    setBusyCategories((current) => {
      const next = new Set(current);
      if (busy) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  }, []);

  async function launch() {
    setLaunching(true);
    setError(null);
    try {
      const result = await startDarWorkflow({ data: { countryId } });
      if (!result.ok) setError(result.error);
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workflow could not be launched.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold">Generate a complete Draft DAR</h2>
            <p className="mt-2 text-xs text-muted">
              One launch runs all eight canonical stages end to end. Documents below are optional
              and freeze at launch. When a category is empty, the workflow performs its own
              research. It never pauses for an approval, upload, budget top-up, or other human input
              while active.
            </p>
          </div>
          <Button
            disabled={Boolean(active) || launching || hasLegacy || busyCategories.size > 0}
            onClick={() => void launch()}
          >
            {launching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : active ? (
              <RotateCw className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {active ? "Workflow active" : "Launch Draft DAR workflow"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-subtle">
          Country is the only required launch input. The default preauthorized ceiling applies
          across the full workflow; protected stage allocations and bounded retries are automatic.
          Exhaustion is terminal, never a request for a top-up.
        </p>
        {hasLegacy ? (
          <p className="mt-2 flex gap-2 rounded-sm bg-amber-500/10 p-2 text-xs text-amber-800">
            <AlertTriangle className="size-4 shrink-0" /> A document predates provenance-safe
            extraction. Remove and re-upload it before launch.
          </p>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Optional pre-launch source documents</h2>
        <p className="mt-1 text-xs text-muted">
          Originals and extracted text are hash-recorded with uploader and timestamp provenance.
          Maximum 2 MB per direct upload, 10 MB combined, and 50 documents. After a workflow has
          launched, later uploads apply only to a new Draft workflow run; they cannot change its
          frozen input snapshot or completed package.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {DAR_WORKFLOW.optional_launch_inputs.map((category) => (
            <UploadCategory
              key={category.id}
              countryId={countryId}
              category={category}
              uploads={grouped[category.id] ?? []}
              disabled={Boolean(active) || launching}
              onChange={refresh}
              onBusyChange={(busy) => setCategoryBusy(category.id, busy)}
            />
          ))}
        </div>
      </Card>

      {error ? <p className="rounded-sm bg-red-500/5 p-3 text-sm text-red-700">{error}</p> : null}
      {runs === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Reading the workflow…
        </p>
      ) : runs.length ? (
        runs.map((run) => <WorkflowRun key={run.id} run={run} onChange={refresh} />)
      ) : (
        <Card className="p-4 text-sm text-muted">
          No Draft DAR workflow has been launched for this country. Optional documents may be
          supplied above, or leave every category empty and launch autonomous research.
        </Card>
      )}
    </div>
  );
}
