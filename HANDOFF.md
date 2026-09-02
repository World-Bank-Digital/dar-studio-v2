# HANDOFF — DAR Studio v2

_Updated 2026-09-03. Read this document and [LEARNINGS.md](LEARNINGS.md) before
changing retrieval, scoring, drafting, or export behavior._

## Stage 4 technical-failure recovery release — 2026-09-03

This checkpoint supersedes the deployed-identity statements in the older
closeout below. It records the evidence and guarded release candidate before
the database and service cutover; a later closeout must record the actual
deployed DAR commit and provider deploy identities.

### Paid-canary diagnosis and immutable histories

- The user-launched Nigeria canary workspace
  `a586f2d6-deb2-4161-9991-2b1128a09afb`, run
  `7e301235-692d-4fe2-b406-7426ea1bebcb`, is terminal `failed`: 3/8 stages,
  exact spend `$28.1829`, no final artifact set, and no active claim. Stage 4
  rejected empty `source_inventory` and `strategies`.
- Its preserved checkpoint showed zero-output structured refusals for all eight
  international scans and all eight earlier country scans. Those technical
  exceptions had been persisted as evidence abstentions, so the coordinator
  retry skipped them and returned in under a second. A successful register lane
  also masked the empty country lane. The exact provider-side safety trigger is
  not recoverable because the old worker did not journal raw prompts or request
  identifiers.
- The older Nigeria workspace `43fda6cd-c62c-46f2-bcbb-f746af3516bc` and run
  `e96a93fd-d4a9-4c83-96d9-3488483729a9` remain terminal and untouched at 5/8
  stages and `$29.64701`. No retry, resume, reuse, cancellation, top-up, new
  country workspace, or additional paid workflow launch was performed by the
  release process.

### Canonical DAMM repair and local proof

- DAMM PR #10 merged to `github/main` as
  `ff5aecbfec5c2694a61f282c27db74ea8b99b28c`. It separates technical failures
  from genuine evidence abstentions, reopens legacy misclassified failures,
  prevents unresolved upstream failures from satisfying Stage 4 completion,
  and filters obvious assessed-country search hits before the bounded page cap.
- Paid structured results are durably claimed from the append-only ledger using
  request and whole-call hashes, vendor/model identity, ledger position, and
  pass name. Extraction is bounded from its first attempt to no more than three
  deterministic two-page batches, advances after refusal/truncation/malformed
  output, and permits only one changed-input empty-lane recovery.
- The upstream proof includes 45 focused scan-stage tests, 236 research-pipeline
  tests, the complete model/workbook/workflow/machine/survey parity suites, and
  three complete zero-spend simulations. DAR additionally mirrors all 13 files
  that define the upstream production identity. Its final release gate passed
  514/514 tests, typecheck, lint with zero errors, development and Netlify
  verification builds, plus replay, typical, and dense zero-spend simulations
  with zero external I/O.

### Guarded DAR cutover state

- Branch `release/damm-ff5aecb` advances the source pin only. Migration
  `0022_damm_source_pin_cutover.sql` preserves terminal histories, refuses a
  stale or missing pin on active work, and retains the same model, workflow,
  engine, renderer, and unratified status. Its SHA-256 is
  `8bde638974122ffc00d0b0d651c7e993bf26dc48288b6b14ac107d833908a5e8`.
- Immediately before this release commit, a read-only repeatable-read Neon
  transaction found zero active workflows and exactly 21 migrations through
  `0021`; the live guard still pinned `f7dfbbb...`, as expected. The production
  Render worker was visibly **Suspended by you** before external mutation.
  Netlify's `stop_builds` gate was also enabled through its authenticated API
  so merging cannot start a build-time migration ahead of this cutover.
- Neon snapshot
  `pre-0022-stage4-recovery-20260902-224352-ff5aecb` was captured successfully
  from root branch `production` before migration and is set never to expire.
  Do not restore or delete it during the cutover.
- At this checkpoint `0022` is not yet applied and the candidate is not yet
  deployed. Merge the validated DAR branch first, recheck the remote identity
  and zero-active gate, then migrate and deploy only that exact merge. A paid
  end-to-end acceptance run remains a separate, user-initiated action.

## Production hardening closeout — 2026-09-03

This was the previous entry point. It remains immutable investigation and
cutover history; its deployment-state language is superseded by the Stage 4
recovery checkpoint above.

### Canonical source and deployed identities

- DAR PR #17 merged as canonical `origin/main`
  `ce0036f1a49d79b40b9e822fe220d19bd96988f6`. Local `main`, its tracking ref,
  and a direct remote lookup all matched that identity immediately before the
  worker resume. The canonical DAMM source remains PR #9 merge
  `f7dfbbb647e0a45d996e94f62d49f2218d518c94`, pinned by migration `0021`.
- Netlify deploy `6a981d37e9b3a1000715b91c`, Render artifact-gateway
  deploy `dep-dac1rkqfngtc73flvub0`, and Render worker deploy
  `dep-dac7c9ijnfac739hdoig` all use exact DAR commit `ce0036f1...`.
- Netlify Basic protection remains enabled for **All deploys**. Fresh anonymous
  root and `/methodology` probes receive HTTP 401, while an authorized browser
  session reaches DAR Studio. The password remains only in the operator's
  macOS Keychain under `DAR Studio Netlify Basic Protection`.
- Gateway health and access-control probes remain green: exact
  `200 {"status":"ok"}` with `Cache-Control: no-store`, expected-origin CORS,
  and non-disclosing denial for missing or attacker origins.

### Worker credential, build, and runtime evidence

- Before credential creation and again immediately before resume, the worker
  was visibly **Suspended by you**, the canonical source identities matched,
  and a read-only repeatable-read Neon transaction showed zero active
  workflows. The one-day fine-grained token was scoped only to
  `World-Bank-Digital/DAMM` with `Contents: Read-only` plus required metadata.
  Render's saved `damm_git_netrc` was reopened and compared byte-for-byte with
  the intended three-line value before the worker was resumed.
- Worker deploy `dep-dac7c9ijnfac739hdoig` was triggered only by **Resume** and
  reached `Deploy succeeded | Live` in 50.6 seconds. Its source link resolves to
  exact DAR commit `ce0036f1a49d79b40b9e822fe220d19bd96988f6`.
- This deploy reused the content-addressed worker test layer; it did not emit a
  fresh 207-test summary. Every input upstream of that layer was byte-identical
  to cache-producing deploy `dep-dabkrf15efls73d3pkdg`, whose logs recorded
  `Ran 7 tests`, `Ran 6 tests`, and `Ran 207 tests`, each followed by `OK`.
  Current logs explicitly mark the test instruction layer `CACHED`.
- Fresh runtime checks still revalidated the installed source: DAMM
  `f7dfbbb...`, Node `22.22.3`, Python `3.12.13`, 21 migrations, pipeline
  `/var/data/checkouts/f7dfbbb...`, interpreter `/opt/damm-venv/bin/python`, and
  `watching the run queue`. Render logged `Your service is live`.
- As soon as the deploy reached a terminal success, the one-use GitHub token
  was permanently revoked. GitHub no longer lists its token card or name. No
  live credential is stored in local files; only the revoked inert value
  remains in Render. Any future worker rebuild requires a new shortest-expiry,
  DAMM-only Contents-read token and the same immediate-revocation sequence.

### Final safety boundary

- A final post-deploy audit at `2026-09-02T19:39:42.206Z` UTC used an explicit
  read-only, repeatable-read transaction and rolled it back. It found zero
  active workflows. The failed Nigeria workspace
  `43fda6cd-c62c-46f2-bcbb-f746af3516bc` and run
  `e96a93fd-d4a9-4c83-96d9-3488483729a9` remain immutable: terminal `failed`,
  5/8 stages, exact spend `$29.64701`, null artifact-set identity, unclaimed,
  and zero final artifacts, stage artifacts, stage publications, or reviews.
- No retry, resume, reuse, cancellation, top-up, new country workspace, or paid
  workflow launch occurred. The production worker is Live and idle; another
  paid smoke remains separately unauthorized.
- The only tracked working-tree changes after deployment are this closeout and
  learning L41. They are intentionally uncommitted so `origin/main` remains the
  exact identity deployed across Netlify and Render instead of creating a
  self-referential documentation-only redeployment cycle.
- The only observed non-blocking runtime warning concerns the future change in
  `pg`/`pg-connection-string` semantics for `sslmode=require`. Adopt explicit
  `sslmode=verify-full` before upgrading to those major versions.

## Production cutover checkpoint — 2026-09-02

This older checkpoint remains immutable cutover history. Its deployment-state
statements are superseded by the 2026-09-03 closeout above.

### Landed identities and validation

- DAMM deterministic-export fix commit
  `5b4a1feaf94756619f6327f5dcf45afc0563be2e` merged through PR #9 as canonical
  `github/main` `f7dfbbb647e0a45d996e94f62d49f2218d518c94`.
- DAR PR #16 merged as canonical `origin/main`
  `5513f3ef9c7c910336b5aae6f7d388565873a3db`. Migration
  `0021_damm_source_pin_cutover.sql` advances only the source pin to that DAMM
  merge; the renderer remains
  `95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`.
- The bound production code identity is
  `a2e12fca1116b2c78b3c43de755d27ad40c1a816b940f07df7350b318867fb8f`.
  The fix pins the host-date fixture and canonicalizes every nested XLSX member
  after the final writer, including both core-property timestamps.
- DAMM passed 207 pipeline tests, 470/470 model-parity checks, 7 workflow-contract
  checks, 11 focused workflow checks, 17 machine checks, 16 survey checks, and
  6 workbook checks. DAR passed 511 tests, typecheck, lint with zero errors and
  the same five warnings, `build:dev`, and Netlify verification.

### Database and deployed artifacts

- Neon recovery snapshot
  `pre-0021-20260901-2057-ffc74e46` is a non-expiring 34.52 MB snapshot of the
  root production branch. Migration `0021` was applied at
  `2026-09-01 21:02:22.222963+00`; ledger order `0019` -> `0020` -> `0021`,
  progressive tables/triggers, and the active-pin function were verified.
- Netlify deploy `6a973d42ae7db00008602c4d` and Render artifact-gateway deploy
  `dep-dabk5dp5efls73d1pbe0` both use exact DAR commit `5513f3ef...`.
  Before Visitor access was enabled, root and `/methodology` smoke probes
  returned 200; the current protected-access evidence is recorded below.
  Gateway health returns
  `200 {"status":"ok"}` with `Cache-Control: no-store`; exact-origin CORS and
  non-disclosing denial probes pass.
- Render worker deploy `dep-dabkrf15efls73d3pkdg` built and reached Live on
  exact DAR commit `5513f3ef...`. Build logs show all 207 pipeline tests passing;
  runtime logs show DAMM `f7dfbbb...` installed, preflight ready with 21
  migrations, `/opt/damm-venv/bin/python`, the pinned disk checkout, and
  `watching the run queue`. Its one-use GitHub credential was immediately
  revoked; only the revoked inert value remains in Render, and the live value
  was cleared from operator memory.

### Current guarded deployment state

- Netlify Basic protection was explicitly authorized and enabled for **All
  deploys** on 2026-09-02. A post-save dashboard read shows **Protected by:
  Basic protection** and **Access restricted to: All deploys**. A fresh
  anonymous request returns HTTP 401, while the same challenge accepts the
  generated password and reaches DAR Studio. The password is stored only in
  the operator's macOS Keychain as `DAR Studio Netlify Basic Protection`; it is
  absent from source, `.env.staging`, logs, and this handoff.
  It is not distributed; rotate it if operator/reviewer access changes, on any
  suspected disclosure, or when this staging deployment closes, and delete the
  Keychain item when Basic protection is removed.
- The successfully verified Render worker remains intentionally suspended while
  these hardened cutover controls are released. Do not resume it until the new
  DAR main identity is fixed, Netlify and the artifact gateway use that exact
  identity, and a fresh zero-active-workflow query passes. Render resume rebuilds
  the image, so it also requires a new one-attempt DAMM-only Contents-read token,
  verified persistence, and immediate revocation after the attempt settles.
- Final read-only Neon verification still shows zero active workflows. Nigeria
  run `e96a93fd-d4a9-4c83-96d9-3488483729a9` remains terminal `failed`, 5/8,
  exact spend `$29.64701`, null artifact-set identity, no claim, zero final
  artifacts, zero stage artifacts, and zero stage publications.
- No retry, resume, cancellation, or top-up of the failed Nigeria workflow was
  attempted; no new country workspace or paid workflow was launched. A paid
  smoke remains separately unauthorized.

## Continuation checkpoint — 2026-09-02

This section records the completed investigation, implementation, and DAMM
upstream merge. It does not supersede the immutable 2026-09-01 evidence below.

### Evidence-backed diagnosis

- A fresh read-only Neon transaction reconfirmed run
  `e96a93fd-d4a9-4c83-96d9-3488483729a9` as terminal `failed`, with
  `rows_done=5`, `rows_total=8`, exact spend `$29.64701`, null
  `workflow_artifact_set_id`, and zero artifact rows. There are zero active
  workflows. Only migration `0018_damm_source_pin_cutover.sql` is applied.
- The preserved Stage 6 checkpoint proves that four overlength fields shared
  one atomic repair request. Both bounded attempts spent their entire 4,000 and
  8,000 output allowances on reasoning and emitted no patch text. This is a
  paid-failure-domain problem, not a local schema rejection or a simple
  request-size problem.

### Completed implementation and upstream landing

- DAMM fix commit `16d869a` on `fix/stage6-repair-chunking` partitions the
  Stage 6 repair into independently checkpointed, bounded chunks while
  retaining hard output limits and terminal exhaustion. GitHub PR #8 merged it
  into canonical `github/main` as
  `e866e7a1fffd5edb14f53da5e038f69b2ec29af2`. Stage 6 remains before Stage 7
  because the integrated DAR consumes its appraisal; moving it after Stage 7
  would make the main report incomplete rather than make the failure safe.
- The production-shaped Nigeria simulation now exercises Stage 6 recovery,
  Stage 7 gates, and Stage 8 packaging after deterministic synthetic
  predecessors. It completes 8/8 stages in 18 fixture calls with exact
  `$0` spend and zero network calls, database writes, subprocesses, or
  capability minting. It is visibly ineligible as acceptance evidence.
  Identical runs produce identical reports and complete-bundle ZIP bytes. The
  bound code identity is
  `ed3d9ce0788cad5cc04a0ef8779cb5d8b78db61bd888b2aeae4242b162c63db6`.
- DAMM now emits standalone offline consulting reports for Stages 1–7,
  including accessible visualizations, explicit evidence/proposal boundaries,
  print-safe pagination, a styled Stage 6 workbook, and a reader-oriented
  Stage 7 annex. Real Pandoc plus LibreOffice 26.2 and LibreOfficeDev 26.8
  rendering verifies a balanced three-page A4 integrated report with visible
  forest table headers, embedded visualizations, no duplicate title, no noisy
  accessibility captions, and no trailing blank page.
- Stage 8 preserves exact HTML, derives DOCX/PDF/Markdown with the consulting
  style, and neutralizes spreadsheet formulas in both consolidated CSV and
  XLSX source inventories while retaining genuine numeric negatives.
- DAR Studio migration `0019_progressive_stage_artifacts.sql` and the worker,
  gateway, route, and UI changes publish each canonical completed Stage 1–7
  prefix as an immutable, hash-verified, owner-only download set. Later failure
  no longer hides already completed reports. Publication is claim- and
  methodology-bound, transactionally sealed, symlink/FIFO safe, per-file and
  aggregate bounded, and reauthorized on every gateway chunk. Reviewer access
  is not inherited by these progressive owner downloads.

### Validation and release boundary

- DAMM passes 204 discovered tests, 470 model-parity checks, 11 workflow tests,
  all 17 machine-pass checks, all 16 survey-pass checks, six workbook-parity
  tests, and independent correctness/security review.
- DAR Studio passes 507 tests, typecheck, lint with the same five pre-existing
  warnings and zero errors, `build:dev`, Netlify adapter/output verification, and independent
  correctness/security review.
- This pre-deployment checkpoint records DAMM PR #8 as merged. DAR
  progressive-stage implementation commits `e4bf1f6` and `ad6a217` were still
  local on top of deployed `d5e1ee4`; the app manifest and append-only migration
  `0020_damm_source_pin_cutover.sql` target the canonical merge and renderer SHA-256
  `95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`.
  Migrations `0019` and `0020` are not yet applied, and Netlify/Render still
  serve the older release recorded below.
- On 2026-09-02 the user explicitly authorized pushing and merging both
  repositories, preparing and pushing the DAR source-pin migration, applying
  the Neon migrations, deploying Netlify and Render, and creating/using then
  immediately revoking the shortest-expiry DAMM-only Contents-read GitHub
  credential needed for the worker rebuild. This authorization does **not**
  authorize another paid workflow.
- Finish the reviewed DAR changes and full validation, land the DAR merge, then
  confirm zero active workflows and take a Neon snapshot. Apply sorted migration
  `0019` first to install sealed progressive publications and `0020` second to
  cut the worker pin to DAMM PR #8. Deploy both Render services and Netlify on
  the same DAR `main` commit. Revoke the one-attempt DAMM build credential as
  soon as its worker build reaches Live, Failed, or Canceled. Do not launch a
  paid workflow without new, separate authorization.

## Current continuation checkpoint — 2026-09-01

Treat this section as the entry point for the next task. It preserves the
failed-run evidence and records the uncommitted local fix; do not treat either
as authorization to mutate production or launch another workflow.

### Deployed identity

- DAR Studio `HEAD` and `origin/main` were both
  `d5e1ee444d4c07f7b88354f0e3b9ed952c5903c6` before this handoff-only edit.
- The pinned DAMM source is
  `386ccb90904de4109b64b7c62d4ed7beed8daede`; migration `0018` is applied and
  verified.
- Netlify production deploy `6a95fef78aba370008ccc9ae` serves the same DAR
  commit.
- Render worker deploy `dep-dabas5p42hec73admcsg` and artifact-gateway deploy
  `dep-dabauo4s728c73a5eo90` are Live on the same DAR commit.
- Worker logs verify the exact DAMM pin, migrations `18`, the pipeline at
  `/var/data/checkouts/386ccb90904de4109b64b7c62d4ed7beed8daede`, the
  `/opt/damm-venv/bin/python` interpreter, and queue watching.
- Gateway probes verified exact `200 {"status":"ok"}` health with `no-store`,
  anonymous and wrong-origin non-disclosing `404` responses, and the exact
  Netlify-origin `204` CORS preflight.
- The one-attempt GitHub build PAT was revoked immediately after the worker
  build. The Render `damm_git_netrc` file therefore contains a revoked
  credential; another worker image build requires a new shortest-expiry,
  DAMM-only Contents-read token and immediate post-build revocation.
- `.env.staging` records the deployment IDs and the Neon connection. Read it
  without printing secrets.

### Terminal Stage 16 evidence

- Fresh country workspace:
  `43fda6cd-c62c-46f2-bcbb-f746af3516bc` (`Nigeria`, `NGA`).
- Single canonical run:
  `e96a93fd-d4a9-4c83-96d9-3488483729a9`.
- The run started at `2026-09-01T14:10:19.797Z`, failed at
  `2026-09-01T15:31:00.096Z`, completed 5 of 8 stages, and spent
  `$29.64701` of its `$500` ceiling.
- No artifact set was published, so Stage 17 human review is not available.
- Exact terminal reason:

  ```text
  Investment options and cost-benefit analysis: command for investment_options exited 78: !! investment appraisal failed terminally: investment candidate map batch 2/3 [local-length repair 1/1] exhausted 2 bounded output attempts; last stop_reason=max_tokens, output_tokens=8000
  ```

### Read-only diagnosis and local fix — 2026-09-01

- Read-only Neon queries through `.env.staging` reconfirmed the terminal run,
  exact `$29.64701` spend, five completed stages, null artifact-set identity,
  and zero workflow artifact rows. Stage 6 accounted for `$0.790575` across six
  provider calls. No run, workspace, budget, row, or artifact was mutated.
- The preserved worker checkpoint at the deployed DAMM pin records four repair
  targets in candidate-map batch 2/3. Its two repair attempts had 2,741 input
  tokens and 4,000 then 8,000 output tokens; thinking consumed the full output
  allowance both times and the provider emitted zero patch characters. The
  smaller input falsifies a simple request-size explanation: batch 1's
  four-target repair used 2,848 input tokens and succeeded on its second bounded
  attempt. With no output text, local schema and residual-length validation
  were never reached.
- DAMM owned the failed seam: all four fields shared one atomic repair request
  and one checkpoint identity. A provider failure on that request therefore
  discarded the opportunity to retain any independently completed repair.
- The DAMM checkout was confirmed clean at `fb52fc0`; its tree matched
  `github/main` at `386ccb90904de4109b64b7c62d4ed7beed8daede`. The uncommitted
  branch `fix/stage6-repair-chunking` was created from that exact `github/main`
  commit.
- The local fix partitions candidate repairs into stable chunks of at most two
  fields and 1,000 contractual replacement characters, projects only relevant
  candidate context, and checkpoints each chunk independently. Initial chunks
  retain two bounded 4,000→8,000 attempts; residual chunks retain one bounded
  derived-token attempt; exhaustion remains terminal. A completed chunk is
  resumed without replay, and complete-register semantic validation is journaled
  as part of the final chunk rather than performed outside the durable outcome.
  The local planner identity is `bounded-appraisal/v4`.
- The recorded Nigeria vector first failed deterministically against the old
  atomic behavior with the production terminal message, then passed through two
  bounded repair chunks. Regressions also prove continuation after a crash
  between chunks and durable non-replay of a semantically invalid combined
  repair. The zero-spend Nigeria simulation completes in 18 fixture calls with
  1,156-token residual chunks and no external I/O.
- Full offline DAMM validation passes: 180 discovered tests, 470 model-parity
  checks, seven workflow-contract tests, all 17 machine-pass checks, all 16
  survey-pass checks, and six workbook-parity tests. DAR Studio passes typecheck,
  lint (five existing warnings, zero errors), 497 tests, `build:dev`, and the
  replay/happy/dense zero-spend simulations against the local DAMM checkout.
- No DAMM commit, push, merge, DAR source-pin migration, deployment, credential,
  or paid workflow was created. DAR production remains at `d5e1ee4` and still
  pins DAMM `386ccb9`. The only DAR tracked edits are this preserved handoff and
  the appended L32 learning-ledger entry.

### Next task

Review the uncommitted DAMM branch and local validation evidence. Only after
explicit authorization, commit/push/merge the DAMM fix, then repin its resulting
merged commit through a new append-only DAR migration and repeat the deployment
gates. Verify no active workflow exists before any source-cutover migration.
Keep the failed run immutable: no retry, resume, reuse, cancellation, row
mutation, budget change, or artifact reconstruction. Even after merge and
deployment, a fresh paid run requires a new country workspace and separate
explicit user authorization.

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

A canonical source-pin cutover does not rewrite an older package. Completed
prior-pin decisions and releases remain integrity-verified and audit-readable;
an incomplete prior-pin chain becomes historical read-only and cannot acquire
another assignment, supersession, decision, or release. Generate a new Draft at
the current pin for any further approval activity. The owner package-history
selector addresses each immutable package by its own package ID, so a newer
Draft never hides the older package's exact audit record.

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

The pinned upstream exporter requires exactly one structured Stage 1
`engine_input` inside the Stage 8 ZIP and binds its source/content digest to the
root workflow manifest. The app worker must reject Draft publication when that
packaged payload is missing, duplicated, relabelled, or different. It also
persists the same verified bytes as the `assessment-input` artifact in the
immutable artifact set so G1 and approval/release identity have a stable
app-addressable key. That standalone alias is a byte-identical convenience,
never a fallback for an incomplete bundle.

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
active, and migration `0013` applies the same boundary when advancing the pinned
DAMM source/renderer. Append-only migration `0014` is the immutable source
cutover containing the foresight candidate-register repair; migration `0015`
advances only the source commit to the canonical DAMM merge
`2efb26607acc29a687a82a56edc85f53c4a6da69`, containing the Stage 6
partial-range validation fix. Append-only migration `0016` advances only the
source commit to canonical DAMM merge
`1b1734c8a8017cda488b77cf0594b0ca82dae6ee`, containing bounded adaptive
Stage 6 output plus durable spend/checkpoint recovery. Append-only migration
`0017` advances only the source commit to canonical DAMM merge
`4b97b2c9090204dfba3aa7c44f41d558005982ee`, containing a checkpointed,
length-only repair for otherwise-valid overlength Stage 6 candidate `title`,
`problem`, and `recommendation_rationale` fields without replaying the completed
candidate call. Append-only migration `0018` advances only the source commit to
canonical DAMM merge `386ccb90904de4109b64b7c62d4ed7beed8daede`, containing
one checkpointed, original-text-anchored residual-length recovery after the first
repair, with bounded per-field targets and no replay of accepted paid work.
Append-only migration `0019` adds transactionally sealed, owner-only progressive
Stage 1–7 publications without backfilling historical runs. Append-only
migration `0020` advances the source commit to canonical DAMM PR #8 merge
`e866e7a1fffd5edb14f53da5e038f69b2ec29af2` and renderer SHA-256
`95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`,
containing independently checkpointed bounded Stage 6 repair chunks, the
zero-spend production-shaped simulation, and consulting-report exports.
Append-only migration `0021` advances only the source commit to canonical DAMM
PR #9 merge `f7dfbbb647e0a45d996e94f62d49f2218d518c94`, preserving the renderer
digest while binding Stage 6 and Stage 8 XLSX core/archive timestamps to frozen
assessment/package timestamps. Apply `0019` before `0020` and `0020` before
`0021`. Require zero active workflows and suspend the preceding-pin worker
before an auto-published cutover. Keep it suspended until every pre-resume
identity, persisted-secret, and zero-active gate passes; then permit exactly one
credentialed build of the bound commit and revoke its credential as soon as the
attempt settles. A migration or deployment must never terminate, claim, or
relaunch an in-flight workflow.
The deferred database invariant also rejects stale launches, newly inserted
stale terminal rows, and transitions that would turn a failed/cancelled stale
run into a completed workflow.

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
