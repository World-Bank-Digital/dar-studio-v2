/**
 * The two pipeline surfaces added by the 2026-08-18 revision:
 *
 *  - FindingsTab — cited findings from the wide sweeps that follow the
 *    structured DAMM collection: public-domain country evidence (opportunistic)
 *    and recent strategies / best practices (practice). Read-only: findings
 *    inform chapters and Annex B; they never populate indicators.
 *  - ForesightTab — user-provided strategic-foresight material. Uploaded
 *    documents are stored as extracted text and cited by the draft as
 *    user-provided sources.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { deleteUpload, listFindings, listRedTeamFindings, listUploads, runRedTeam, uploadForesight } from "@/lib/damm/actions";
import { useSessionRole } from "@/lib/session";

type FindingRow = {
  id: string;
  kind: string;
  claim: string;
  quote: string;
  source_name: string | null;
  source_url: string;
  published_year: number | null;
  credibility: string | null;
  pillar_hint: string | null;
};

export function FindingsTab({ id }: { id: string }) {
  const [rows, setRows] = useState<FindingRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    listFindings({ data: { countryId: id } })
      .then((r) => setRows(r as FindingRow[]))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, [id]);

  const opportunistic = rows.filter((r) => r.kind === "opportunistic");
  const practices = rows.filter((r) => r.kind === "practice");

  const list = (items: FindingRow[]) => (
    <ul className="mt-3 space-y-3">
      {items.map((f) => (
        <li key={f.id} className="rounded-lg border border-border/70 px-4 py-3">
          <p className="text-sm">{f.claim}</p>
          <p className="mt-1 text-xs text-subtle">Verified quote: “{f.quote}”</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <a className="underline decoration-border underline-offset-2 hover:text-ink" href={f.source_url} target="_blank" rel="noreferrer">
              {f.source_name || f.source_url}
            </a>
            <span>{f.published_year ?? "n.d."}</span>
            {f.credibility ? <Badge tone="neutral">credibility {f.credibility}</Badge> : null}
            {f.pillar_hint ? <Badge tone="neutral">pillar {f.pillar_hint}</Badge> : null}
          </p>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-display text-xl">Public-domain findings</h2>
        <p className="mt-1 text-sm text-muted">
          The wide-net sweep that runs after the structured indicator collection: anything citable about this country
          that a roadmap can use, wherever it sits relative to the 97 indicators. Every entry carries a quote checked
          verbatim against the retrieved page. Findings inform chapters and the ecosystem inventory (Annex B); they
          never populate an indicator or move a score.
        </p>
        {opportunistic.length ? (
          list(opportunistic)
        ) : (
          <p className="mt-3 text-sm text-subtle">
            {loaded ? "No findings stored yet. The sweep runs inside the Step 1 diagnostic once a search key and a model are active." : "Loading…"}
          </p>
        )}
      </Card>
      <Card>
        <h2 className="font-display text-xl">Recent strategies and practices</h2>
        <p className="mt-1 text-sm text-muted">
          Strategies and documented practices from roughly the past year — digital agriculture, agriculture, digital
          transformation — from any country or institution. Comparator material for the prescriptive chapters, cited
          as such.
        </p>
        {practices.length ? (
          list(practices)
        ) : (
          <p className="mt-3 text-sm text-subtle">
            {loaded ? "No practice findings stored yet. This research runs inside the Step 1 diagnostic." : "Loading…"}
          </p>
        )}
      </Card>
    </div>
  );
}

type UploadRow = { id: string; filename: string; kind: string; mime: string | null; chars: number; uploaded_at: string };

const ACCEPT = ".pdf,.docx,.txt,.md";

export function ForesightTab({ id }: { id: string }) {
  const { role, actorName } = useSessionRole();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listUploads({ data: { countryId: id } })
      .then((r) => setRows(r as UploadRow[]))
      .catch(() => setRows([]));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onPick(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const res = await uploadForesight({
        data: {
          countryId: id,
          filename: file.name,
          mime: file.type || "application/octet-stream",
          base64: btoa(binary),
          role,
          actorName,
        },
      });
      if (!res.ok) {
        setMessage(res.error);
      } else {
        setMessage(`${file.name}: ${res.chars.toLocaleString()} readable characters stored.`);
        await refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-display text-xl">Strategic-foresight material</h2>
        <p className="mt-1 text-sm text-muted">
          Upload scenario studies, foresight reports, trend analyses or any strategic material the roadmap should draw
          on. Text is extracted and stored; the draft cites it explicitly as user-provided material, kept separate
          from machine-collected public evidence. PDF, DOCX, TXT or Markdown, up to 10 MB.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="text-sm"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
          />
          {busy ? <span className="text-sm text-subtle">Reading…</span> : null}
        </div>
        {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
      </Card>
      <Card>
        <h3 className="font-display text-lg">Uploaded</h3>
        {rows.length ? (
          <ul className="mt-3 space-y-2">
            {rows.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-4 py-2">
                <div>
                  <p className="text-sm">{u.filename}</p>
                  <p className="text-xs text-subtle">
                    {u.chars.toLocaleString()} readable characters · {new Date(u.uploaded_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await deleteUpload({ data: { countryId: id, uploadId: u.id, role, actorName } });
                    await refresh();
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-subtle">Nothing uploaded yet.</p>
        )}
      </Card>
    </div>
  );
}

type RedTeamRow = { id: string; chapter: string; category: string; severity: string; excerpt: string; note: string; source: string; created_at: string };

const SEVERITY_TONE: Record<string, "danger" | "warn" | "neutral"> = { high: "danger", medium: "warn", low: "neutral" };

/**
 * Red-team QC over the latest assembled draft. Deterministic policy checks
 * always run; the adversarial model pass joins when a drafting key is active.
 * Findings inform the human editor — nothing here edits the draft.
 */
export function RedTeamTab({ id }: { id: string }) {
  const { role, actorName } = useSessionRole();
  const [rows, setRows] = useState<RedTeamRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const refresh = () =>
    listRedTeamFindings({ data: { countryId: id } })
      .then((r) => setRows(r as RedTeamRow[]))
      .catch(() => setRows([]));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-display text-xl">Red team</h2>
        <p className="mt-1 text-sm text-muted">
          A hostile quality review of the latest assembled draft: prohibited comparison language, stage assertions the
          engagement-package rule forbids, ownerless recommendations, contradictions and unsupported claims. Every
          finding exhibits a verbatim excerpt from the chapter it challenges — an exhibit that cannot be located is
          discarded. Findings guide your edit; they never change the draft.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setSummary(null);
              try {
                const res = await runRedTeam({ data: { countryId: id, role, actorName } });
                setSummary(res.ok ? res.summary : res.error);
                if (res.ok) await refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Reviewing…" : "Run red team"}
          </Button>
          {summary ? <span className="text-sm text-muted">{summary}</span> : null}
        </div>
      </Card>
      <Card>
        <h3 className="font-display text-lg">Findings</h3>
        {rows.length ? (
          <ul className="mt-3 space-y-3">
            {rows.map((f) => (
              <li key={f.id} className="rounded-lg border border-border/70 px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone={SEVERITY_TONE[f.severity] ?? "neutral"}>{f.severity}</Badge>
                  <span>Chapter {f.chapter}</span>
                  <span>· {f.category}</span>
                  <span>· {f.source === "model" ? "adversarial review" : "policy check"}</span>
                </p>
                <p className="mt-2 text-sm">“{f.excerpt}”</p>
                <p className="mt-1 text-sm text-muted">{f.note}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-subtle">No findings stored. Run the red team after assembling a draft.</p>
        )}
      </Card>
    </div>
  );
}
