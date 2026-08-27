import { Download, Fingerprint } from "lucide-react";

import { ArtifactDownloadButton } from "@/components/damm/ArtifactDownloadButton";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ApprovalPackage, DraftDownload } from "@/lib/damm-v17/approval-actions";
import { lifecycleLabel, type ApprovalLifecycle } from "@/components/damm/approval-presentation";

function IdentityLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2 last:border-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="min-w-0 break-all text-sm text-ink">{value}</dd>
    </div>
  );
}

export function ApprovalPackageIdentity({
  approvalPackage,
  lifecycle,
}: {
  approvalPackage: ApprovalPackage;
  lifecycle: ApprovalLifecycle;
}) {
  const method = approvalPackage.methodology;
  const label = lifecycleLabel(lifecycle, method.modelRatified);
  return (
    <Card className="bg-white p-5" data-approval-package={approvalPackage.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Fingerprint className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold">Exact immutable Draft package</h2>
            <p className="mt-1 text-sm text-muted">
              Every assignment and decision below is permanently bound to this identity. A different
              run or artifact set requires a new approval chain.
            </p>
          </div>
        </div>
        <Badge tone={lifecycle === "revisions_required" ? "warn" : "forest"}>{label}</Badge>
      </div>

      <dl className="mt-4 border-y border-border">
        <IdentityLine label="Workflow run ID" value={approvalPackage.runId} />
        <IdentityLine label="Artifact-set ID" value={approvalPackage.artifactSetId} />
        <IdentityLine label="Complete-bundle SHA-256" value={approvalPackage.bundleSha256} />
        <IdentityLine
          label="Workflow contract"
          value={`${approvalPackage.workflowVersion} · ${approvalPackage.workflowContractSha256}`}
        />
        <IdentityLine
          label="DAMM model"
          value={`${method.modelId} ${method.modelVersion} · revision ${method.modelRevision}`}
        />
        <IdentityLine
          label="DAMM status"
          value={`${method.modelStatus} · ratified: ${method.modelRatified ? "true" : "false"}`}
        />
        <IdentityLine label="DAMM model SHA-256" value={method.appModelSha256} />
        <IdentityLine label="DAMM source commit" value={method.sourceCommit} />
        <IdentityLine
          label="Assessment-input artifact"
          value={`${approvalPackage.assessmentInputArtifactKey} · ${approvalPackage.assessmentInputSourcePath}`}
        />
        <IdentityLine
          label="Assessment-input SHA-256"
          value={approvalPackage.assessmentInputSha256}
        />
        <IdentityLine
          label="Package identity SHA-256"
          value={approvalPackage.targetIdentitySha256}
        />
        <IdentityLine
          label="Stage 8 completed"
          value={new Date(approvalPackage.completedAt).toLocaleString()}
        />
      </dl>

      {!method.modelRatified ? (
        <p className="mt-3 rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This methodology is not ratified. Even after valid G1, G2, and G3, the release is an
          approved Draft release—not a canonical Final or a claim of methodological ratification.
        </p>
      ) : null}
    </Card>
  );
}

export function OriginalDraftDownloads({ downloads }: { downloads: readonly DraftDownload[] }) {
  return (
    <Card className="bg-white p-5">
      <h2 className="text-lg font-semibold">Original Stage 8 Draft downloads</h2>
      <p className="mt-1 text-sm text-muted">
        The autonomous eight-stage workflow is already complete. These original artifacts remain
        downloadable before and after human review; approvals never mutate or overwrite them.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {downloads.map((download) => (
          <ArtifactDownloadButton
            key={download.key}
            href={download.href}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border-strong bg-white px-3 text-sm font-medium text-ink hover:bg-moss/50"
          >
            <Download className="size-4" aria-hidden="true" />
            {download.label}
          </ArtifactDownloadButton>
        ))}
      </div>
    </Card>
  );
}
