# HANDOFF — DAR Studio v2

_Updated 2026-08-27. Read this document and [LEARNINGS.md](LEARNINGS.md) before
changing retrieval, scoring, drafting, or export behavior._

## Normative product contract

DAR Studio now implements `damm.dar-workflow/v1`, workflow
`dar-canonical-v1`. DAMM owns the normative contract. The app consumes its
exported JSON and schema from `src/data/`; do not reproduce or reorder the
stages in UI or worker code. A contract change must land in DAMM first, pass its
contract tests, and then be exported into this repository with its recorded
SHA-256 digests.

The conformance rule is: a user can provide the country and any optional
pre-launch material, launch once, take no further action, and receive either a
complete Draft DAR package or an honest terminal failure.

### The eight stages

1. **DAMM diagnostic** — DAMM v1.7 observations, independent automated
   challenge, scored assessment, and diagnostic report.
2. **Country research and source inventory** — country-specific evidence
   beyond DAMM, a consolidated credible-source inventory, and any pre-launch
   TTL documents with provenance.
3. **AI in digital agriculture assessment** — a separate country as-is AI
   assessment, peer-country experience, and recommended national AI agenda.
4. **International strategies and lessons** — recent, relevant strategies and
   transferable lessons, including selection rationale and limitations.
5. **Strategic foresight** — country scenarios, preferred future, and backcast
   milestones; uploaded material is synthesized when present and autonomous
   research is used when absent.
6. **Investment options and cost-benefit analysis** — prioritized options with
   baseline, counterfactual, cost/benefit ranges, assumptions, sensitivity,
   risks, distributional effects, and evidence gaps.
7. **Integrated Draft DAR** — synthesis of the recorded outputs of Stages 1–6
   from the same workflow version, with claim-level provenance and epistemic
   status.
8. **Export package** — downloadable stage products, structured data, source
   inventories, manifest, and complete ZIP bundle.

The order and dependencies are strict. Stage 1 automatically imports its
machine-produced evidence; there is no separate human import action. Stage 7
cannot consume unversioned or out-of-run artifacts. Stage 8 must export only
artifacts bound to the immutable run snapshot.

## Launch and execution invariants

- **Country is the sole required launch input.** The public canonical launch
  interface must not ask for a provider, pass count, budget, approval, or
  workflow mode.
- The five optional pre-launch upload categories are country context, AI and
  digital agriculture, international strategies/peer experience, strategic
  foresight, and investment cost/benefit/financing/appraisal.
- Launch freezes extracted content, original bytes, filename, media type,
  size, uploader, upload time, category, extraction status, and hashes. A later
  upload starts a new workflow version; it never mutates an active or completed
  run.
- Missing optional inputs select autonomous research. They are never a reason
  to pause or ask the TTL for a file.
- Active execution requires **zero human actions**: no evidence confirmation,
  stage approval, import, late upload, provider selection, retry choice,
  continue action, or budget top-up.
- Transient failures receive bounded automatic retries and declared fallbacks.
  Failure after those measures is terminal, not `awaiting human`.
- The only active states are `queued`, `running`, and `retrying`; terminal
  states are `complete`, `failed`, and `cancelled`. Cancellation is an optional
  safety control.
- Budget is authorized before launch and divided into fixed, protected stage
  allocations. A stage cannot borrow another stage's allocation, and no one
  can increase the ceiling during execution.
- Human review is post-completion only. Stage 8 always produces an immutable,
  downloadable `Draft · pre-review`; workflow completion never means approved,
  Final, publication-ready, or externally circulable. G1/G2/G3 govern later
  promotion and circulation and are not prerequisites for Stage 8.

## Post-completion human-control invariant

G1, G2, and G3 are not workflow stages and must never appear in an active-run
state machine, budget decision, vendor pass, or retry path:

1. **G1** is performed by a named, authenticated assessor assigned to the exact
   Stage 8 package. The decision must cover every row from the exact stored
   Stage 1 engine input used by the diagnostic, including unscored carried
   candidates; raw research observations cannot stand in for it. Persisted row
   hashes are derived inside PostgreSQL, and the reviewer surface preserves
   exact numeric spellings rather than rounding through JavaScript.
2. **G2** is performed after accepted G1 by a different authenticated user. It
   covers every prerequisite and `Judged` row plus a deterministic 15% sample
   of the remainder. Its immutable versioned affirmation records the protocol's
   source-resolution, evidence-class, and quality/scale ladder checks. An
   automated challenge or vendor model is not G2.
3. **G3** is recorded only after accepted G1 and G2 by the authenticated owner
   of the country workspace, which is the product's designated TTL/country-owner
   identity. The sign-off records the four prohibitions, treatment of
   parenthesized bands, source-tier/illustrative handling of register rows, and
   QC-footer accuracy.

The approval package snapshots the workflow run ID, artifact-set ID,
complete-bundle SHA-256, workflow contract version/hash, full DAMM model
identity and source commit, assessment-input SHA-256, and row-set hashes.
Assignments, decisions, identity snapshots, timestamps, and releases are
append-only. A revision finding terminates that package's chain; corrections
belong to a new autonomous Draft run, with a new approval chain.

A still-pending G1 or G2 assignment may be replaced atomically by the country
owner with an exact-assignment optimistic guard and a required reason. The old
record remains immutable but loses review and artifact access at the same
commit that creates its successor. Decided assignments cannot be superseded,
and reviewers receive only their own decision record rather than the package's
complete human audit.

G3 creates a separately versioned release record and manifest tied to the exact
Draft and its three decision records. It never mutates Stage 8 bytes. A model
whose recorded status is not ratified or whose `ratified` flag is false can
produce only an `approved_draft` release, never `canonical_final`. Issue 4 does
not ratify DAMM v1.7.

Approval-package materialization re-verifies the complete stored artifact set,
all byte counts and digests, the canonical eight-stage/root/package manifests,
the exhaustive ZIP census, upload and input-snapshot bindings, the workflow
contract, and the pinned methodology/assessment input. Reviewer downloads use
the exact assignment-bound package authorization and revoke with a superseded
assignment; live-preview bearer credentials remain in request headers, never
download URLs.

The package/release digest dependency chain is explicitly versioned in SQL
(`*_v1` row, prerequisite, canonical-JSON, and timestamp helpers). Unversioned
aliases are compatibility entry points only and are never called by historical
v1 identity verification; later canonicalization rules must use new versioned
names rather than replacing v1 behavior.

The pinned upstream exporter currently omits its supplemental `engine_input`
from the Stage 8 ZIP even though the root workflow and methodology manifests
bind it. The app worker therefore persists the already-verified input as the
canonical `assessment-input` artifact in the same immutable artifact set. G1
rows and the approval/release identity are derived from those bytes. Upstream
should still add that supplemental input to the package itself; doing so later
will not require weakening this app-side binding.

## Artifact and trust boundary

Each stage writes a version-bound manifest containing input/output hashes,
source inventory, quality checks, spend, execution mode, and completion status.
The app treats uploaded documents as evidence, never as executable
instructions. Worker completion is accepted only when the workflow identity,
contract hash, immutable input snapshot, stage set, artifact hashes, and ZIP
contents all match the database run.

The methodology has the same fail-closed boundary. A workflow run freezes the
model id/version/revision/status, app and upstream model/schema digests, upstream
commit, generated census revision/digest, engine version/digest, and renderer
version/digest. App builds verify the model-derived assets. The worker checks an
exact clean source commit plus the pipeline-owned model, schema, engine, and
renderer bytes before execution and before publication. Ignored or untracked
Python source, bytecode, and native modules in the executable tree are rejected;
worker launches disable bytecode generation. Artifact sets must carry one model
identity and one Stage 1 assessment-input digest. The app-generated
census, scorer band order, pillar count, and downloadable provenance files all
derive from the pinned model; do not reintroduce separate threshold, mapping,
census, or version-label constants.

Worker staging verifies current-run bytes before publication, and publication
makes the selected artifact rows immutable. Pre-methodology historical rows are
explicitly legacy/unverified and receive a one-time SHA-256 byte check before
they can appear in Documents or become a review target; failed checks remain
hidden. Downloads always recheck the requested bytes before serving them.

Migration `0011` refuses to install while any pre-methodology workflow is still
active. Let the existing release finish those runs, then retry deployment; the
migration must never terminate or relaunch an in-flight workflow. Its deferred
database invariant also rejects old-version launches during a rolling deployment
unless the launch transaction contains the required methodology snapshot.

Stage 8 must provide:

- narrative artifacts in Markdown, DOCX, PDF, and HTML;
- meaningful structured artifacts and source inventories in XLSX, CSV, and
  JSON;
- a complete ZIP bundle and SHA-256 manifest; and
- every frozen original upload, verified extraction, and provenance envelope.

Required format conversion is fail-closed. Downloads are served from the
verified artifact manifest/database artifact store, not reconstructed from a
worker-local filename.

## Runtime topology

- **Web app:** `npm run dev` for local development; PostgreSQL through
  `DATABASE_URL` for durable use.
- **Worker:** `npm run worker` with the same `DATABASE_URL` and
  `DAMM_PIPELINE_DIR` pointing to the matching DAMM repository. Production
  requires this long-running worker; a serverless request cannot host the
  pipeline.
- **Local database fallback:** PGLite is ephemeral and suitable only for local
  development. A standalone worker refuses to use its own isolated PGLite
  instance.
- **Credentials:** model/search/vendor keys are deployment or worker
  administration. They do not become canonical launch inputs or choices during
  a run.
- **Persistence:** workflow runs, frozen uploads, claims, and artifacts are
  database-backed so different web and worker hosts see the same state.

## Verification before handoff

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build:dev
git diff --check
```

Use `npm run build` only for a configured deployment because it also invokes
database migration. Conformance checks must pin the exported contract digest,
the exact eight-stage order, the absence of human-required active states, the
immutable launch snapshot, worker claim fencing, user-scoped data access, and
the exhaustive Stage 8 package manifest.

## Superseded and admin-only material

The former D1–D4 pipeline (97-indicator ingest, opportunistic sweep, practice
research, foresight upload, manual readiness ladder, dossier/red-team jobs, and
17-chapter/11-annex assembler) is retained for historical comparison and
explicit administration only. It is **superseded for normal Draft DAR
generation** by the canonical eight-stage workflow.

Accordingly:

- the legacy `startRun` surface is admin-only;
- old QA commands such as `qa:delivery` and `qa:loop` exercise the superseded
  flow and are not the canonical end-to-end acceptance test;
- manual evidence editing, gate clearing, model/provider selection, imports,
  and ladder steps must not be exposed as prerequisites or inter-stage actions
  in a canonical run; and
- older live-run statistics, reference workspace IDs, local test accounts,
  and provider-specific tuning notes in Git history are diagnostics for that
  legacy implementation, not current product requirements.

Do not reintroduce a legacy human gate while trying to reuse those components.
The canonical runner may reuse implementation code only behind the normative
contract and its zero-human execution rules.

## Governance

The completed package has lifecycle state `draft_pre_review`. No cross-country
ranking, DAMM band used as a PDO/DLI/disbursement condition, automatic financing
decision, or public claim before human review is permitted. These restrictions
apply to promotion and circulation after generation; they do not block
autonomous Draft production or pre-review Draft downloads.

The standing engineering rule remains: every live-run defect lands as a fix to
the cause, a regression test that pins it, and a learning-ledger entry. A fix
without its test is not complete.
