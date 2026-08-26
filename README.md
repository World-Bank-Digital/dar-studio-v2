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

| # | Stage | Required product |
| ---: | --- | --- |
| 1 | **DAMM diagnostic** | DAMM v1.7 observations, independent automated challenge, scored assessment, and diagnostic report |
| 2 | **Country research and source inventory** | Country-specific evidence beyond DAMM, a consolidated inventory of credible sources, and any pre-launch TTL documents with provenance |
| 3 | **AI in digital agriculture assessment** | A separate assessment of the country's as-is AI position, peer-country experience, and a recommended national AI agenda |
| 4 | **International strategies and lessons** | Recent, relevant country strategies and transferable lessons, with selection rationale and limitations |
| 5 | **Strategic foresight** | Country-specific scenarios, preferred future, and backcast milestones; uploaded material is synthesized when present and autonomous research is used when absent |
| 6 | **Investment options and cost-benefit analysis** | Prioritized options with baseline, counterfactual, cost and benefit ranges, assumptions, sensitivity, risks, distributional effects, and evidence gaps |
| 7 | **Integrated Draft DAR** | One comprehensive Draft DAR synthesizing Stages 1–6, with claim-level provenance and explicit epistemic status |
| 8 | **Export package** | Downloadable stage products, structured data, source inventories, manifest, and complete ZIP bundle |

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

Human review begins only after Stage 8 has created the Draft package. Review may
correct evidence, validate recommendations, and create a revised Draft or Final
version. It is required before Final/publication, not before Draft generation.

### Download contract

Stage 8 exports narrative products as Markdown, DOCX, PDF, and HTML, and
meaningful structured products and source inventories as XLSX, CSV, and JSON.
It also produces a ZIP bundle and SHA-256 manifest. When files were uploaded
before launch, the bundle includes each frozen original file, its verified text
extraction, and its provenance envelope.

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

On upgrade, migration `0011` stops before changing the schema if an older
workflow is still active. Allow that workflow to finish under the prior release,
then retry the deployment; no in-flight run is failed or relaunched. A deferred
database invariant prevents a still-running old app process from committing an
unattributed workflow during a rolling deployment.

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

They govern use and publication after generation; they do not insert a human
approval step into Stages 1–8.

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
