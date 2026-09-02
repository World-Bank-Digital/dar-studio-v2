# DAR Studio

DAR Studio generates a comprehensive Draft Digital Agriculture Report (DAR) by
executing the normative DAMM workflow end to end. DAMM v1.7 owns the workflow
contract; this app consumes the exported, machine-readable copy at
[`src/data/dar_workflow_v1.json`](src/data/dar_workflow_v1.json). Product code
must not maintain a second stage list or insert a human gate into that contract.

This is an independent prototype, not an official World Bank system, a country
ranking, a scoring service, a financing decision, or a publication authority.

## Canonical workflow

The only required launch input is the **country under review**. Before launch, a
TTL may optionally upload relevant country-context, AI, international-strategy,
strategic-foresight, and investment-appraisal material. Launch freezes every
input, its provenance, and its SHA-256 digest into an immutable snapshot.

The eight stages then run in this strict order:

|   # | Stage                                            | Required product                                                                                                                                                 |
| --: | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | **DAMM diagnostic**                              | DAMM v1.7 observations, independent automated challenge, scored assessment, and diagnostic report                                                                |
|   2 | **Country research and source inventory**        | Country-specific evidence beyond DAMM, a consolidated inventory of credible sources, and any pre-launch TTL documents with provenance                            |
|   3 | **AI in digital agriculture assessment**         | A separate assessment of the country's as-is AI position, peer-country experience, and a recommended national AI agenda                                          |
|   4 | **International strategies and lessons**         | Recent, relevant country strategies and transferable lessons, with selection rationale and limitations                                                           |
|   5 | **Strategic foresight**                          | Country-specific scenarios, preferred future, and backcast milestones; uploaded material is synthesized when present and autonomous research is used when absent |
|   6 | **Investment options and cost-benefit analysis** | Prioritized options with baseline, counterfactual, cost and benefit ranges, assumptions, sensitivity, risks, distributional effects, and evidence gaps           |
|   7 | **Integrated Draft DAR**                         | One comprehensive Draft DAR synthesizing Stages 1–6, with claim-level provenance and explicit epistemic status                                                   |
|   8 | **Export package**                               | Downloadable stage products, structured data, source inventories, manifest, and complete ZIP bundle                                                              |

### Zero-human active execution

After the single launch, no person is required to confirm evidence, approve a
stage, import a result, add a document, select a provider, choose a retry,
continue a run, or increase its budget. Missing optional material triggers
autonomous research, not a prompt to the TTL. Transient failures receive bounded
automatic retries and declared fallbacks. If the system still cannot produce a
required artifact, the workflow ends in an honest terminal failure; it never
waits for human input while appearing to be in progress.

The normal active states are `queued`, `running`, and `retrying`. The terminal
states are `complete`, `failed`, and `cancelled`; cancellation is an optional
operator safety control, not a normal workflow step. A document added after
launch belongs to a new workflow version and cannot mutate an active or
completed run.

Human review begins only after Stage 8 has created the Draft package. A
successful run means **Draft execution complete**, not reviewed, approved,
Final, publication-ready, or safe for external circulation. The original Stage
8 files remain immutable and downloadable throughout post-completion review.

### Post-completion human controls

G1, G2, and G3 are package-bound human controls outside the eight-stage
workflow:

- **G1 — named assessor:** an assigned, authenticated person confirms or marks
  for revision every row from the exact stored DAMM engine input that was
  used for the Draft package, including unscored carried candidate rows. Raw
  pre-challenge research observations cannot substitute for that assessment
  input. Database-derived row hashes and lossless numeric display prevent JSON
  scale, exponent, or unsafe-integer values from being changed by JavaScript.
- **G2 — independent peer reviewer:** a different assigned, authenticated
  person rechecks all prerequisite rows, all `Judged` rows, and a deterministic
  15% sample of the remainder. The G1 assessor cannot perform G2. Its immutable,
  versioned affirmation attests that each scoped source resolves, its evidence
  class is correctly derived, its ladder level is justified by evidence quality
  and scale, and disagreements were resolved by evidence.
- **G3 — TTL/country-owner sign-off:** after accepted G1 and G2, the
  authenticated owner of the country workspace (the product's designated
  TTL/country owner) records the seven QC affirmations and a
  server-dated external-circulation decision.

Machine derivation, the Stage 1 automated evidence challenge, vendor review,
and other machine QC never populate or satisfy G1 or G2. Every assignment and
decision is append-only and bound to the run, artifact set, complete-bundle
digest, workflow contract identity, DAMM methodology identity, source commit,
and assessment-input digest. Revisions or another package require a new chain;
approvals never transfer.

A country owner may replace a still-pending G1 or G2 assignment only by naming
its exact active assignment and recording a required reason. Replacement is one
atomic, append-only supersession: the old assignment remains in the audit trail
but immediately loses review and artifact access, while the successor receives
the unchanged package scope. An assignment with a completed decision can never
be replaced or have its recorded identity altered.

When a deployment advances the canonical DAMM source pin, packages already
materialized under the preceding pin remain integrity-verified, downloadable,
and audit-readable with their exact assignments, decisions, and releases. They
are historical records, however: an unfinished chain cannot receive a new
assignment, supersession, G1/G2/G3 decision, or release after the cutover. A new
current-pin Draft package must begin its own approval chain. The owner controls
list every materialized package and allow an owner to select an older exact
package for read-only audit even after a newer Draft package exists.

Accepted G3 creates a separate, versioned release manifest referring to the
reviewed Draft and its exact G1/G2/G3 records. It never relabels or overwrites
the Stage 8 files. While the pinned DAMM model is `draft for review` with
`ratified: false`, that release is an **approved Draft release**, not a
canonical Final release or a claim of methodological ratification.

### Download contract

Each completed canonical Stage 1–7 prefix is independently published as an
immutable, hash-verified, owner-only download set. Those reports remain
available if a later stage fails; they are stored in PostgreSQL rather than
served from a worker filesystem. Reviewer package access does not imply access
to these progressive owner publications.

Stage 8 exports narrative products as Markdown, DOCX, PDF, and HTML, and
meaningful structured products and source inventories as XLSX, CSV, and JSON.
It also produces a ZIP bundle and SHA-256 manifest. When files were uploaded
before launch, the bundle includes each frozen original file, its verified text
extraction, and its provenance envelope.

The bundle must also contain exactly one structured Stage 1 `engine_input`,
byte-identical to the input bound by the root workflow manifest. DAR Studio keeps
the same bytes as an `assessment-input` download/approval alias, but that
standalone artifact can never substitute for a missing or different packaged
input.

### Methodology identity

DAR Studio executes one content-addressed DAMM v1.7 methodology revision. The
[model export manifest](src/data/damm_model_manifest.json) pins the draft model,
schema, upstream source commit, engine, and renderer by version and SHA-256. The
indicator census is generated from that model rather than maintained as a
second editable inventory.

Launch stores this identity atomically beside the immutable uploads. Before the
worker starts—and again before it publishes—it requires the configured DAMM
repository to be at the exact clean pinned commit and verifies its model, schema,
engine, and renderer bytes. App builds separately fail if the shipped model,
generated census, mappings, or version labels drift from the export manifest.
Every published artifact row is stamped with the model revision and
assessment-input hash. Published rows are immutable; current-run bytes are
verified before publication, while historical packages are SHA-256 checked once
before they can appear in Documents or review. The completed download set
includes the model, schema, generated census, export manifest, and a per-run
methodology manifest. The model remains honestly labelled `draft for review`
and `ratified: false`; provenance does not imply ratification.

On methodology upgrades, migrations `0011`, `0013`, `0014`, `0015`, `0016`,
`0017`, `0018`, `0020`, `0021`, and `0022` stop before changing the schema or active source pin
if an older workflow is still active. Migration `0014` is the immutable source cutover for
the foresight candidate-register repair. Migration `0015` advances only the
upstream source commit to the canonical DAMM merge
`2efb26607acc29a687a82a56edc85f53c4a6da69`, containing the Stage 6
partial-range validation fix. Migration `0016` advances only the upstream
source commit to canonical DAMM merge
`1b1734c8a8017cda488b77cf0594b0ca82dae6ee`, containing bounded adaptive
Stage 6 output and crash-safe spend/checkpoint recovery. Migration `0017`
advances only the upstream source commit to canonical DAMM merge
`4b97b2c9090204dfba3aa7c44f41d558005982ee`, containing a checkpointed,
length-only repair for otherwise-valid overlength Stage 6 candidate `title`,
`problem`, and `recommendation_rationale` fields without replaying the completed
candidate call; the model, workflow, engine, renderer, and ratification fields
remain unchanged. Migration `0018` advances only the upstream source commit to
canonical DAMM merge `386ccb90904de4109b64b7c62d4ed7beed8daede`, containing
one checkpointed, original-text-anchored residual-length recovery after the first
repair, with bounded per-field targets and no replay of accepted paid work; all
methodology and ratification fields remain unchanged. Migration `0019` then adds
the sealed progressive Stage 1–7 publication schema without backfilling or
rewriting any historical run. Migration `0020` advances the source pin to
canonical DAMM merge `e866e7a1fffd5edb14f53da5e038f69b2ec29af2` (PR #8) and
renderer SHA-256
`95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`.
That release deterministically chunks and checkpoints Stage 6 length repair,
adds the zero-spend production-shaped simulation, and ships bounded offline
consulting-report exports. Migration `0021` advances only the source pin to
canonical DAMM merge `f7dfbbb647e0a45d996e94f62d49f2218d518c94` (PR #9),
which binds Stage 6 and Stage 8 XLSX metadata and archive timestamps to their
frozen workflow/package timestamps so exports remain byte-identical across host
clocks. The renderer and other methodology identity fields remain unchanged.
Migration `0022` advances only the source pin to canonical DAMM merge
`ff5aecbfec5c2694a61f282c27db74ea8b99b28c` (PR #10), which adds one bounded
recovery pass for completed-but-empty Stage 4 scans, preserves technical
failures instead of misclassifying them as evidence abstentions, durably reuses
paid scan results after a crash, and blocks downstream completion while upstream
country or register failures remain unresolved. The renderer and all other
methodology identity fields remain unchanged. Deploy `0019` before `0020`, then
`0021`, then `0022`. Allow an in-flight
workflow to finish under the prior release, then retry the deployment; no run
is failed or relaunched. A deferred database invariant prevents a still-running
old app process from committing a missing or stale methodology snapshot,
manufacturing a terminal stale run, or promoting a failed/cancelled stale run
during a rolling deployment.

For an existing auto-published deployment, take the pre-cutover Neon snapshot
and suspend the preceding-pin Render worker before merging or applying the new
migration. Keep it suspended until the exact repinned worker image is live. This
closes the interval in which an older worker could claim a newly queued run whose
methodology identity it cannot execute; queued arrivals remain unspent meanwhile.

## Running locally

```bash
npm install
npm run dev
```

The app serves on `http://localhost:8080`. Without `DATABASE_URL`, local
development uses an embedded, ephemeral PGLite database. A durable deployment
and the standalone worker must share PostgreSQL through `DATABASE_URL`.

Copy `.env.example` to `.env` and configure the deployment services. The
canonical launch remains country-only: database, model, search, pipeline, and
vendor credentials are deployment/worker administration, not TTL actions in an
active DAR run.

The canonical worker is a separate long-running process:

```bash
DATABASE_URL=... DAMM_PIPELINE_DIR=/path/to/DAMM npm run worker
```

It must use the same database as the web app and a clean Git checkout of the
manifest-pinned DAMM commit containing the matching workflow contract. Git
metadata is required so the coordinator and complete tracked stage/export
dependency closure can be attested, not merely the four explicitly hashed
methodology files. The executable tree must also contain no ignored or
untracked Python source, bytecode, or native modules; the worker disables
bytecode generation for its own runs. The worker resumes from durable
checkpoints and persists verified artifacts in the database, so completion does
not depend on a particular worker's local filesystem.

### Zero-spend workflow simulation

Do not use repeated paid staging launches to diagnose deterministic workflow,
schema, checkpoint, or artifact defects. DAR Studio exposes three local commands
backed by the versioned simulation module in the adjacent DAMM source checkout:

```bash
npm run sim:replay
npm run sim:happy
npm run sim:dense
```

`sim:replay` drives the exact observed Stage 6 overlength vector through its
deterministically chunked, independently checkpointed bounded repairs, then
requires the real appraisal assembler to complete with six valid options.
`sim:happy` runs the real eight-stage coordinator and the real Stage 6 appraisal
logic with a typical synthetic country workload; `sim:dense` exercises the same
path with a larger synthetic evidence inventory. A different synthetic country
can be selected without changing the committed fixture:

```bash
node scripts/simulate-workflow.mjs \
  --scenario eight-stage-happy-v1 \
  --country Exampleland --iso EXP --profile dense
```

Set `DAMM_SIMULATION_SOURCE` only when the DAMM checkout is not the adjacent
`../DAMM-foresight-candidate-register` directory. The adapter passes an
allowlisted child environment rather than loading `.env` or `.env.staging`;
database URLs, vendor credentials, auth secrets, and artifact-delivery secrets
never reach the simulation. Reports are written under ignored `.simulation/`
directories and must prove zero external spend and zero external I/O.

Every report and generated artifact is labelled **SIMULATED — NOT ACCEPTANCE
EVIDENCE** and uses reserved `sim-`/`fixture/` identities. The production worker
rejects those identities before execution or publication. Simulation proves
deterministic code and contract behavior; it does not prove live provider
behavior or Render, Neon, Netlify, browser-auth, CORS, or gateway deployment
wiring. After both simulation gates and the repository suite pass, retain one
fresh authorized paid staging smoke as the final deployment canary.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build:dev
```

`npm run build` also runs database migrations and is intended for a configured
deployment, not a read-only local verification pass.

## Governance

The Draft bundle is not a public claim. These DAMM prohibitions remain in force:

1. no cross-country ranking;
2. no DAMM band as a PDO, DLI, or disbursement condition;
3. no automatic financing decision; and
4. no public claim before human review.

They govern promotion and circulation after generation; they do not insert a
human approval step into Stages 1–8. The complete pre-review Draft remains
downloadable before G1, G2, or G3.

Both cookie-authenticated deployments and bearer-authenticated live previews
download artifacts through the same authorized application route. The bearer
is sent only in the request header and is never placed in a download URL.

## Legacy and administrative surfaces

Older evidence-editor, ladder, dossier, red-team, manual import, provider
selection, and delivery-gauntlet flows remain only for maintenance, historical
comparison, or explicitly authorized administration. They are **superseded for
normal Draft DAR generation** by `dar-canonical-v1`. In particular:

- legacy run APIs are admin-only and must not be presented as the standard
  launch path;
- BYOK/provider settings are operational administration, not required launch
  inputs and not active-run choices;
- `qa:delivery`, old numbered ladder steps, and manual gate-clearing describe
  the superseded pipeline and are not proof of canonical workflow conformance;
  and
- any legacy validation or review occurs outside the autonomous run and cannot
  block creation of its Draft package.

The current conformance test is simple: provide a country and any optional
pre-launch documents, launch once, take no further action, and receive either a
complete Draft DAR package or an honest terminal failure.

## Learning ledger

Every defect found in a live run should still become a cause-level fix, a
regression test, and an entry in [LEARNINGS.md](LEARNINGS.md). Read that ledger
before changing retrieval, scoring, drafting, or export behavior.
