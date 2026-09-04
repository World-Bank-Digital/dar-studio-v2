# HANDOFF — DAR Studio v2

_Updated 2026-09-05. Read this document and [LEARNINGS.md](LEARNINGS.md) before
changing retrieval, scoring, drafting, or export behavior._

## 0025 DAMM source-pin release candidate — 2026-09-05

This is the authoritative current development record. It preserves the earlier
release and incident evidence below without representing this unreviewed
candidate as deployed.

- DAR GitHub `main` is `dcb803aadc831a6944e35b477bb7276d51621245`, the merge
  of PR #23 (stored-key model-catalogue management). DAMM GitHub `main` is
  `d81d267133eed52b5fdcc599bfecf8d72496f292`, the merge of PR #14. This
  candidate starts from that merged DAR tree and adds the append-only
  `0025_damm_source_pin_cutover.sql` release boundary.
- Migration `0025` advances only the canonical source pin from
  `76ca33d97f0809a6be7477447786953317aa41b5` to `d81d...`. It preserves the
  model, schema, workflow, engine, renderer, tariff artifact, and ratification
  inputs, and changes the 38-file production closure to
  `118908785e9d061c387dde163507f39288b00176c6897ee6f7d8943311860f34` because
  an unknown pricing or reasoning vendor now fails before price/ledger setup,
  credential access, model discovery, or transport.
- The predecessor source/renderer pair (`76ca33d...` and
  `95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`) must
  remain recognized as historical-only package identity. Completed packages
  remain audit-readable, while new or active work must use the current pin.
- The exact source attestation must anonymously shallow-fetch and verify the
  immutable manifest pin `d81d...` in a credential-disabled, isolated Git
  environment. DAMM `main` is a moving diagnostic ref; it may advance and must
  not be required to equal the immutable pin.
- No deployment, migration, provider operation, country workspace, paid
  workflow, credential creation, or Nigeria-run mutation is part of this
  candidate. Production remains on its separately recorded DAR
  `992114b932354a11c7595ce44b40f276503c1a7b` deployment with the `76ca33d...`
  application/database pin and 24 applied migrations until the reviewed 0025
  release sequence is explicitly executed.
- Before any future deployment, require the full local suite, all seven
  zero-spend simulations against a clean `d81d...` DAMM checkout, a fresh
  read-only zero-active-workflow/terminal-failure audit, a non-expiring
  `pre-0025-...` snapshot, exactly 25 migration rows after cutover, and
  independent deployed identity/access/automation re-reads. These gates do
  not authorize a paid canary.
- Candidate validation is green: DAR `npm test` 625/625, typecheck, ESLint,
  the Netlify adapter/output verification, the 21-case deployment-wizard
  suite, and the migration/package regressions all pass. A clean detached DAMM
  `d81d...` checkout passed all seven credential-empty zero-spend simulations:
  three happy 8/8 packages, one Nigeria 8/8 through-package result, and three
  bounded Nigeria Stage 6 repair fixtures. All used the `118908...` closure
  with zero network, database, capability, or subprocess operations. Its local
  Python was 3.14.6, so the
  documented Render Python 3.12.13 preflight remains a deployment gate.

## Stored-key model-catalogue release record — 2026-09-05

This preserved pre-merge validation record is superseded for current release
identity by the 0025 candidate above. It supplements, without changing, the
deployed actual-country readiness state below.

- At that pre-merge validation point, candidate branch
  `feat/stored-key-model-catalogue` started from DAR
  `992114b932354a11c7595ce44b40f276503c1a7b`, which then remained exact on
  local `main`, `origin/main`, direct GitHub `main`, Netlify, and both Render
  services. Canonical DAMM GitHub `main` then remained
  `76ca33d97f0809a6be7477447786953317aa41b5`. No deployment, migration,
  workspace, paid provider operation, or Nigeria-run mutation is part of this
  candidate.
- Personal model-key owners and team-key administrators can explicitly refresh
  the stored key's provider catalogue and select an exact returned drafting
  candidate without re-entering the key. The secret is decrypted only on the
  server and never returned to the browser.
- Refresh uses fixed first-party endpoints, rejects redirects, has one
  20-second attempt, bounds an untrusted response at 1,000,000 bytes and 500
  valid model IDs, filters Gemini entries that do not advertise
  `generateContent`, and reports provider pagination or local truncation rather
  than claiming an incomplete list is exhaustive. A catalogue request sends no
  prompt and invokes no inference, but it is credentialed metadata activity;
  listing does not prove inference entitlement, quota, funds, or provider
  health.
- Selection independently re-reads the provider catalogue and requires exact
  positive membership. Browser inputs are reduced to a validated user fence,
  credential scope/ID, and model ID. Personal keys remain owner-scoped; team
  keys require administrator authority before provider access and again in the
  commit transaction. The update rejects concurrent key or model changes, and
  a team selection plus its non-secret audit event commits atomically.
- This is intentionally an administrative/legacy drafting capability. It does
  not feed `startDarWorkflow`, the worker environment, a queued or resumable
  run, DAMM checkpoints, spend reservations, stage publications, or final
  package identity. The actual-country workflow remains release-pinned to the
  reviewed Opus 5 primary and Terra challenger configuration.
- Red-first regressions cover stored-secret isolation, personal and team
  authorization, hostile browser fields, oversized/malformed/partial
  catalogues, redirect refusal, exact-membership revalidation, concurrent
  changes, and rollback on audit failure. Exact-tree validation is green:
  stored-key/provider focused tests 33/33, complete DAR tests 621/621 across
  108 suites, TypeScript, warning-free lint, formatting/diff checks, and the
  development/Netlify adapter build and output verification.
- The audit also found a separate DAMM fail-closed ordering defect: an unknown
  vendor could acquire an empty zero-dollar tariff and fail only when dispatch
  was attempted. Branch `fix/reject-unknown-vendor`, based on DAMM GitHub
  `76ca33d...`, now rejects unknown pricing and reasoning vendors during
  construction, before ledger mutation, credential access, or transport. Its
  updated 38-file production-code identity is
  `118908785e9d061c387dde163507f39288b00176c6897ee6f7d8943311860f34`.
  Exact-tree validation is green: vendor tests 45/45, complete research tests
  309/309, model parity 470/470, workflow contract 7/7, Loop 1 machine 17/17,
  survey 16/16, and workbook parity 6/6. All seven secret-free simulations also
  pass: the three happy profiles and through-package profile produce valid
  package ZIPs, the three Stage 6 overlength profiles prove bounded recovery,
  and every profile records `$0.00` spend plus zero network, database,
  subprocess, and capability activity. At that point the branch was not yet
  merged, application-pinned, migrated, or deployed; the current fixed
  canonical vendor was never exposed to the defect.

The 2026-09-05 official-document recheck found no provider tariff or exact-ID
drift for the fixed canary profile. Jina's `$0.05`/million returned-token value
remains an authenticated account observation rather than a universal public
tariff, and GPT-5.6 Sol's documented promotional period still requires a
recheck after 2026-11-21. The next paid evidence gap remains exactly one
separately authorized controlled country canary; catalogue refresh or selection
is not that authorization.

## Final actual-country readiness and credential-free cutover candidate — 2026-09-04

This is the authoritative current readiness record. The methodology candidate
was merged as DAR `591179373c62ee67893ecc72c9c3e67105de5f4b`, migration `0024`
was applied, and the artifact gateway was deployed from that commit. This
unreleased successor removes the now-obsolete private-repository credential
ceremony before the worker and Netlify complete the cutover.

- At the time this successor was prepared, Neon snapshot
  `pre-0024-20260904-1149-59117937` existed, exactly 24 unique migrations through
  `0024_damm_source_pin_cutover.sql` were present, and a repeatable-read audit
  found zero active workflows. Render gateway deploy
  `dep-dadb3rm7bikc73adubkg` was Live on DAR `5911793...`; the worker remained
  intentionally suspended on `62780d4...`; and Netlify remained frozen on
  deploy `6a9a81f1164fafc97fa6a49b` from `62780d4...`. No paid workflow was
  launched and neither preserved Nigeria failure was mutated.

- Canonical DAMM `main` is
  `76ca33d97f0809a6be7477447786953317aa41b5` (PR #13). Its exact 38-file
  production dependency closure has aggregate SHA-256
  `b867d6960ac6e0f446e89f9c341b6283fdb3ddfe4326070049bf4a5c097e134c`.
  The application manifest, deployment checks, simulation adapter, and new
  `0024_damm_source_pin_cutover.sql` all bind that identity. Migration 0024 is
  byte-pinned at
  `a4abf1cf597fa36e722b0af1aa942d14c018507c006ab75fbc4e39d80f431769`.
- Completed-checkpoint reclaim now re-emits a verified completion event with
  authoritative finite spend. Stages 3, 5, and 7 each have one distinct,
  durable, bounded semantic-repair opportunity and stop before later spend when
  it is exhausted. Stage 7 rejects stale response-cache identities before any
  later chapter call. The coordinator, stage artifacts, and final package remain
  hash-bound and fail closed.
- Every normal or retained administrative workflow launch is forced to the
  canonical `anthropic/claude-opus-5` vendor/model pair. Persistence and the
  worker independently reject a stale noncanonical vendor before spawning the
  pipeline; historical null rows continue to resolve the same default.
- Migration 0024 blocks while an active workflow still has the preceding pin,
  preserves terminal rows byte-for-byte, rejects stale launches after cutover,
  and admits only the new source. The preceding deployed `68e1994...` source and
  unchanged renderer pair are explicitly recognized as historical so its
  completed packages remain audit-readable without reopening approval activity.
- The DAR adapter now hashes the shared `semantic_repair.py` module. All seven
  secret-free eight-stage simulations—happy minimal/typical/dense, Nigeria
  Stage 6 overlength minimal/typical/dense, and Nigeria through-package
  typical—complete with eight stages and `$0.00` external spend.
- The exact lockfile removes unused presentation tooling, pins `toml@4.2.0`,
  and uses `sharp@0.35.4`. An exact OSV scan found zero advisories across 1,592
  lockfile packages and 439 production packages; the npm audit endpoint timed
  out, so no npm-registry audit result is claimed. Native IPX image transformation
  remains proven.
- Acting role, actor name, provider choice, and search mode are now bound to the
  authenticated user ID. Settings writes are field-scoped atomic upserts,
  ordered per client surface, and rejected if the authenticated identity no
  longer matches the initiating user. Account changes remount the settings
  surface and expose only identity-specific defaults while hydration completes;
  late reads or writes cannot overwrite a newer account or local edit. Passkey
  refresh and Fast Refresh boundaries are warning-free.
- Local validation is green: DAMM research tests 308/308, model parity 470/470,
  workflow contract 7/7, Loop 1 machine 17/17 and survey 16/16; DAR 599/599 and
  focused credential-free worker/deployment contracts 34/34; TypeScript,
  warning-free lint, development and Netlify builds, shell syntax, formatting,
  the cold production worker image build, and all seven simulations.
- Provider identifiers and tariffs were revalidated on 2026-09-04 from official
  first-party documentation and recorded in
  `docs/PAID-CANARY-PROVIDER-AUDIT-2026-09-04.md`. No numeric tariff drift was
  found. The mutable Anthropic Haiku alias and credential-specific Gemini/Jina
  limitations remain explicit uncertainty, not silent fallback authority.
- The remaining zero-spend release sequence is: review and merge this exact DAR
  successor; keep Netlify builds/previews and Render service auto-deploys off;
  keep the Blueprint disconnected and worker suspended; re-prove zero active
  workflows, the 24-row migration ledger, and unchanged Nigeria failures;
  update the expected deploy identity; deploy the gateway from the exact merged
  commit; prove the public DAMM pin anonymously; remove or confirm absence of the
  legacy worker Secret File; resume the worker without an overlapping deploy;
  verify its settled identity/runtime/ledger and reservation state; deploy
  Netlify last from one clean hash-bound build; then repeat every identity,
  access, automation, and immutable-failure read. Do not launch a country
  workflow during that sequence.

The candidate materially reduces known systemic failure paths, but no software
review can guarantee a hiccup-free live provider run. The only remaining
end-to-end evidence gap is one separately authorized, named-country paid canary,
strictly below the application ceiling of `$500` and governed by the monitoring
and abort conditions in the provider audit and deployment guide.

## Production deployment closeout — 2026-09-04

This is the authoritative deployed state. It supersedes the older statements
below that production remains on DAR `4112a27...` and DAMM `ff5aecb...`. The
older validation, incident, tariff, and immutable-failure evidence remains part
of the audit history.

### Exact deployed identities and release evidence

- DAR local `main`, `origin/main`, and direct GitHub `main` are exact
  `62780d4bcc8d84f365d8e12f23c47efa9dc40d3b`. DAMM direct GitHub `main` and
  the active application/database pin are exact
  `68e1994b5facfaaf0ddc49ba3bec108d9bde2c55`; the deterministic 37-file
  production-code identity remains
  `9eb81998a65a15be6a92be2524cec82a8b5550756c5d910df3b5ca901001489c`.
- Before migration, the non-expiring root-production Neon snapshot
  `pre-0023-20260903-1926-62780d4b` was created. Migration
  `0023_damm_source_pin_cutover.sql` was then applied exactly once. The final
  repeatable-read, read-only audit at `2026-09-04T08:38Z` found exactly 23
  migrations through `0023`, the expected DAMM/renderer pair, and zero active
  workflows.
- Render artifact-gateway deploy `dep-dacskqv10e5c738t4mrg` is Live on exact
  DAR `62780d4...`. `/healthz` returns `200 {"status":"ok"}` with
  `Cache-Control: no-store`; missing and attacker-origin artifact probes return
  the same private, non-disclosing 404 without an allow-origin header.
- Render worker deploy `dep-dad7te67bikc73a2cr2g` was triggered once by
  **Resume** and is Live on exact DAR `62780d4...`. Startup installed the exact
  DAMM `68e1994...` disk checkout and reported
  `node=22.22.3 python=3.12.13 migrations=23` before watching the run queue.
  Successful preflight also proves the clean single-commit checkout, renderer
  identity, seven required nonempty runtime secrets, pinned Python imports,
  blank mode-0600 upstream `.env`, and working Pandoc/LibreOffice conversions.
- The worker build used a one-day, DAMM-only, Contents-read fine-grained token.
  It was loaded only while the worker was suspended, re-read byte-for-byte,
  then revoked immediately after the one deployment became terminal. Its local
  automation variables were cleared and the revoked `damm_git_netrc` secret
  file was removed from Render with **Save only**; no second deploy occurred.
- Netlify deploy `6a9a81f1164fafc97fa6a49b` is the sole deploy after the
  frozen baseline and is Published in Production with title
  `DAR Studio release 62780d4bcc8d84f365d8e12f23c47efa9dc40d3b`.
  Netlify records `deploy_source=cli`, `build_id=null`, and `commit_ref=null`, as
  expected for the reviewed manual `--no-build` upload. Exactness comes from
  the clean detached worktree, the two-source Git recheck, and the build-bound
  `COMMIT_REF`/`EXPECTED_DEPLOY_GIT_SHA` preflight.
- The one-shot Linux/amd64 release emitted all acceptance markers:
  `[deploy-preflight] Netlify deployment environment is complete.`,
  `[migrate] up to date.`, a 78-file configured-secret scan with no finding,
  and successful Node 22 streamed-Function/Linux-x64 PDF extraction. Netlify's
  deployed Function metadata independently reports `nodejs22.x`, streamed
  invocation, the `/*` route, and Ohio (`us-east-2`/`cmh`). The temporary
  worktree and commit-labelled Docker volume were both removed.
- That clean pinned install reported 14 high-severity findings in the full
  dependency tree. The lockfile is byte-identical to the validated source, and
  a fresh targeted registry query identified only the known `image-size` and
  `sharp` advisories propagated through `dev:true` PPTX/Netlify tooling. The
  latest successful production-only audit, on 2026-09-03, was zero. Repeated
  fresh complete `npm audit --omit=dev` requests timed out at npm's audit
  endpoint, so a current production-zero result is not reasserted here and the
  unexplained 14-versus-9 count delta must be reconciled when that endpoint is
  responsive. This is registry-corpus uncertainty, not source or bundle drift.
- The first local wrapper invocation exposed a macOS Bash 3.2 portability
  defect in the temporary wrapper only: `source <(…)` returned without running
  the hash-verified body. A direct deploy-history and local-resource read proved
  zero provider attempt and zero temporary state. The wrapper was corrected to
  evaluate only the immutable, hash-verified Git object in memory; that body
  then executed exactly once and created the single deploy above.

### Access, freeze, and preserved-state closeout

- Fresh anonymous requests to production `/`, `/methodology`, `/login`, and the
  unique deploy URL return 401. The approved Keychain-held Basic-protection
  credential establishes one form session; the same routes then return 200
  HTML. The login page exposes email/password only, with no Google/X control.
  A protected anonymous Better Auth session read returns `200 null`, JSON, and
  `Cache-Control: no-store`; no identity was created.
- Netlify still reports `stop_builds=true`, `skip_prs=true`, production branch
  `main`, allowed branches `[main]`, and no pull-request deploys. Production
  secrets remain absent from deploy-preview context. Both Render services have
  Auto-Deploy and PR Previews Off. After both exact deploys were verified, the
  provisioning Blueprint was deliberately disconnected. Render's confirmation
  said the file and managed resources would not be deleted and could be
  reconnected later. The Blueprint and Sync Hook are now unavailable; no sync
  or deploy ran. A fresh re-read found both services still Live on the unchanged
  deploy IDs and the 10 GB worker disk still attached at `/var/data`.
- The final read-only transaction found both Nigeria failures unchanged,
  terminal, unclaimed, and without a final artifact set. Run `7e301235...`
  remains 3/8 and `$28.18290`, with three immutable stage publications, 18
  stage artifacts, and zero final artifacts. Run `e96a93fd...` remains 5/8 and
  `$29.64701`, with zero publications, stage artifacts, or final artifacts.
  Neither run was retried, resumed, reused, cancelled, topped up, or mutated.

### Boundary for an actual-country test

- **Deployment readiness is GO; no paid canary has been launched.** The final
  build is ready for human acceptance testing behind the private access gate.
  No country workspace, test identity, credential, or paid workflow was created
  during this closeout.
- A paid actual-country run still requires three distinct registered human
  identities, a separately authorized named country, and same-day first-party
  tariff/model revalidation for the selected runtime. The exact masked Render
  Jina key is now mapped to the dashboard key ending `ApRXpp`, its standard
  1-billion-token/$50 package and `$0.05/MTok`rate, and its unchanged
824,787,632-token balance. Auto Recharge was disabled and independently
verified false after reload, with no top-up, purchase, or provider call. The
application still preauthorizes strictly less than`$500` for one workflow.
- At launch and after Stages 1–7, record sole claimant/lease margin, immutable
  checkpoint/publication identities, settled cost plus unresolved reservation,
  and cumulative ceilings `$225`, `$262.50`, `$312.50`, `$350`, `$400`, `$425`,
  then strictly below `$500`. Stage 8 must add no provider cost. Preserve and
  stop—without retry, top-up, or repair—on any identity, tariff, funding,
  claimant, lease, usage, checkpoint, semantic, artifact, publication, or final
  acknowledgement ambiguity.
- The uncommitted release-ledger patch corrects the operator wizard's progress
  total to 19 and makes a deliberately disconnected Blueprint—not a retained
  Blueprint ID with Auto Sync `No`—the terminal safe state. It removes stale
  Blueprint ID/auto-sync rows, records only
  `RENDER_BLUEPRINT_STATE=disconnected`, and requires post-disconnect service,
  deploy, automation, and disk re-verification. It has not been committed,
  pushed, or deployed; production remains the exact identity recorded above.

## Paid-canary hardening audit — 2026-09-03

This is the authoritative paid-canary readiness state. It supersedes only older
tariff/readiness verdicts below; their production history and failure evidence
remain authoritative.

### Verdict and identity boundary

- **Current production is NO-GO for another paid run.** It remains exact DAR
  `4112a27f30fc37b605919fae29d3004dc3063459` with DAMM
  `ff5aecbfec5c2694a61f282c27db74ea8b99b28c`; neither deployed revision contains
  the paid-request accounting, replay, semantic-gate, archive, or worker-liveness
  hardening below.
- DAMM PR #12 is canonical `github/main`
  `68e1994b5facfaaf0ddc49ba3bec108d9bde2c55`. Its reviewed feature commit and
  merge commit have the same tree. The DAR release candidate pins that exact
  merge and is being prepared on
  `release/damm-68e1994-paid-canary-hardening`; until it is reviewed, committed,
  merged, and deployed, production remains on the identities above.
- The candidate's deterministic 37-file DAMM production-code identity is
  `9eb81998a65a15be6a92be2524cec82a8b5550756c5d910df3b5ca901001489c`.
  Model, schemas, workflow, engine, and renderer bytes are unchanged from the
  production pin. This is not paid-canary authorization.
- Under the candidate code, documented provider behavior, and the required
  singleton-worker topology, the application preauthorizes strictly less than
  the configured `$500` ceiling. That is an authorization boundary, not a
  forecast or invoice guarantee. A cash-charge maximum is not yet defensible
  until the exact production Jina key-to-package binding and its account funding
  controls are verified immediately before a paid canary.
- The readiness audit made no provider inference/search calls or live/paid
  workflow launches. Local tests used ephemeral database state and synthetic
  workflows. Subsequent release, migration, credential, and deployment steps
  require their own recorded gates. The two preserved Nigeria failures must not
  be modified or retried by any of them.

### Root-cause hardening in the local candidate

- Paid calls now reserve their conservative worst-case cost in a durable,
  fsynced journal before transport. Unknown models fail closed; paid transport
  retries are disabled; missing or malformed usage consumes the full reservation;
  provider-reported over-reservation cost is charged and aborts terminally.
- Successful LLM and retrieval results can be replayed across stage-checkpoint
  gaps. A crash-ambiguous accepted request intentionally strands its full
  reservation and blocks exact replay pending operator reconciliation. Identical
  live retrievals coalesce within the singleton process.
- Stage 1 technical retrieval/provider failures can no longer become ordinary
  evidence gaps. Stage 5 now proves three substantive, distinct scenarios with
  drivers, preferred-future linkage, and milestones rather than accepting shape
  alone.
- Stage 8 parses STORE and DEFLATE entries from raw ZIP records, bounds output by
  the separately trusted manifest, and verifies exact compressed-byte
  consumption, length, CRC-32, and SHA-256. It rejects directories, duplicates,
  ZIP64, encryption, comments, extra fields, descriptor contradictions, hidden
  compressed tails, and any byte not covered contiguously before the central
  directory. The worker uses this same extractor rather than a second parser.
- Progress writes are serialized and bounded by a 30-second persistence timeout.
  A rejection (including a reasonless rejection), `false` claim-fence result, or
  timeout terminates the coordinator before verification or publication. The
  worker heartbeat covers prepare, reconciliation, publication, and final
  acknowledgement; coordinator termination reaches its POSIX process group and
  cannot fire a delayed escalation after process settlement; a failed final
  database acknowledgement is fatal and a lost terminal fence stops queue
  drain.
- Simulations bind all 37 production files and emit canonical ZIP metadata, so
  fresh repeated runs have identical report and package identities.
- The frozen Netlify release path now uses an exact clean Git worktree and a
  Docker-generated, commit-labeled ephemeral volume across three isolated
  containers in one digest-pinned Linux/amd64 Node image: credential-free
  install, NUL-framed build plus secret scan and Function audit, then
  credential-isolated upload. The upload uses exact pinned CLI/packager binaries,
  explicit audited client and Function paths, and fresh Function packaging; it
  fails closed on alternate deploy inputs or cleanup uncertainty.

### Validation and read-only production evidence

- DAR: full suite `564/564` across 101 suites; focused frozen-deployment set
  `35/35`; simulation adapter `7/7`; typecheck, Bash syntax, and
  `git diff --check` clean; lint has zero errors and five pre-existing warnings.
  Development and Netlify adapter build/output verification passed. A real
  credential-free package in the exact Linux/amd64 release image produced one
  streamed Node 22 Function archive containing exactly the Linux x64 GNU canvas
  binary and required PDF.js worker, then extracted a generated PDF successfully.
  The archive was 27,350,440 compressed bytes and 71,334,431 uncompressed bytes
  across 3,403 files, below Netlify's 250 MB uncompressed limit; its native
  binary requires no newer than GLIBC 2.16. The latest successful
  production-dependency audit was zero. At this validation point the full
  development tree had nine high-severity audit findings in the
  Netlify/image/PPTX toolchain with no nonbreaking production fix; all identified
  findings were outside the production dependency graph. The deployment
  closeout above records the later 14-count install summary and the bounded
  registry-audit uncertainty.
- DAMM: an isolated clean checkout of exact merge `68e1994...` passed
  research-pipeline discovery `287/287` with no skips; model parity `470/470`;
  workflow contract `7/7`; loop-1 unit suite `6/6`; and custom
  country/foresight/gate/DAR/scan/machine/survey checks
  `18/71/101/304/28/17/16`. Every validation command ran network-disabled and
  credential-empty under Linux x86_64 / CPython 3.12.13 from the exact pinned
  worker base image; the checkout was clean before and after.
- Seven fresh, environment-scrubbed, zero-spend source simulations reported zero
  network, database, capability, or subprocess I/O. Three happy-path profiles
  completed all eight stages; three overlength profiles exercised the real Stage
  6 bounded-repair path only; one through-package profile exercised real Stages
  6–8 using synthetic predecessors. Under the pinned Linux/CPython 3.12.13
  runtime, all seven reports reproduced byte-for-byte across two clean runs.
  Their report SHA-256 values are, in matrix order, `78673c828dc1c76c...`,
  `98a4c3f3e57306ba...`, `4234ea0e3959b87d...`, `f696c2787fa757a3...`,
  `452e76433b99042d...`, `bb90cffc12088fd2...`, and
  `f1e99768741d87e7...`; the complete hashes are recorded in the readiness audit.
  These are synthetic non-acceptance tests, not live-provider evidence.
- A fresh repeatable, read-only Neon transaction at
  `2026-09-03T18:39:44.116Z` found 22 migrations through `0022`, zero active
  workflows, and the expected `ff5aecb...` source plus model/engine/renderer
  guards. Both Nigeria runs remain terminal `failed`, unclaimed, without a final
  artifact set: `7e301...` is still 3/8 and `$28.18290` with its 18 immutable
  stage artifacts across three publications; `e96a9...` is still 5/8 and
  `$29.64701` with none. No row was written.
- The most recent provider reads found a healthy private gateway,
  Basic-protected Netlify routes, stopped Netlify builds, disabled Render
  automatic deploys, and Blueprint Auto Sync `No`. Netlify Deploy Previews are
  still enabled and must be disabled and re-read before release activity. The
  worker remains Live/idle on DAMM `ff5aecb...`, not suspended; suspension is
  mandatory before migration `0023` or any build-secret mutation.

### Preconditions for one controlled paid canary

1. Complete review and validation of the DAR release candidate, commit and merge
   it, disable and re-read Deploy Previews, suspend the worker, take the required
   pre-migration snapshot, advance the immutable DAMM source pin through
   migration `0023`, deploy only the exact reviewed identities through the frozen
   manual path, and repeat the read-only identity, migration, access,
   terminal-run, and zero-active-run gates. Keep Netlify builds stopped and
   Render automatic deploy/Blueprint sync disabled throughout.
2. Identify which masked Jina key Render uses, verify its package/rate, and
   verify that its account funding control is acceptably bounded for the canary.
   Reverify every provider model ID and tariff against primary documentation on
   canary day.
3. Retain and re-read the one-instance, disk-backed Render worker topology.
   Process-local spend locking is not sufficient for a multi-worker deployment.
4. Obtain explicit authorization for one new, named-country canary. Do not reuse
   either historical failed run. Check cumulative stage ceilings `$225`,
   `$262.50`, `$312.50`, `$350`, `$400`, `$425`, and `<$500` after Stages 1–7;
   Stage 8 must add no provider cost.
5. Abort without automatic retry or top-up on identity/tariff drift, an
   unconfirmed heartbeat or duplicate claimant, any ambiguous/unmetered/
   over-bound request, technical failure presented as evidence absence, ledger
   mismatch, semantic-gate failure, artifact/hash/converter failure, or final
   publication/acknowledgement failure. Preserve the run for reconciliation.

## World Bank repository transfer closeout — 2026-09-03

This is the authoritative repository and provider-ownership state. It
supersedes only the ownership, provider-link, and deploy-identity statements in
the release closeout below; the preserved failure diagnoses and methodology
history remain authoritative.

### GitHub ownership and governance

- The private DAR repository moved in place from `rsudan/dar-studio-v2` to
  `World-Bank-Digital/dar-studio-v2`. At transfer, its default branch remained
  `main` at exact commit `4112a27f30fc37b605919fae29d3004dc3063459`, and
  the local `origin` moved to the canonical organization URL. This
  documentation-and-governance closeout advances repository `main`, but must
  not run a provider build, Blueprint sync, database migration, or paid
  workflow. Production remains exact DAR `4112a27...` with DAMM `ff5aecb...`;
  Netlify builds and Render automatic deploy/Blueprint sync remain disabled.
- Organization team **DAR Studio Maintainers**
  (`@World-Bank-Digital/dar-studio-maintainers`) has `maintain` access;
  `rsudan` is an active team maintainer. `.github/CODEOWNERS` routes repository
  ownership to that team.
- The organization's current Free plan does not permit branch protection or
  repository rulesets on this private repository. CODEOWNERS therefore records
  review ownership but cannot by itself enforce an approving review. Treat
  that as an explicit governance limitation until the plan or repository
  visibility changes.

### Netlify relink

- Existing site `wbdar` (`159c2675-9ef9-42d3-980d-40b4baeb6e79`) was relinked
  in place to `https://github.com/World-Bank-Digital/dar-studio-v2`; production
  branch `main`, empty base, `npm run build`, `dist/client`, and
  `netlify/functions` were preserved. The Netlify GitHub App is installed on
  the organization for this repository only.
- Netlify's relink flow re-enabled builds and immediately started a production
  build despite the pre-existing freeze. It completed before cancellation and
  published deploy `6a994654e7528310841dbe29`, but from the same exact DAR
  commit `4112a27f30fc37b605919fae29d3004dc3063459`; no source or schema changed.
  `build_settings.stop_builds=true` was restored and independently re-read.

### Render relink and one-use credential

- The Render GitHub App is installed on `World-Bank-Digital` for
  `dar-studio-v2` only. The old Blueprint
  `exs-da8shk2jnfac73bue23g` was disconnected after Render confirmed that its
  managed resources would remain. New Blueprint
  `exs-dackesjm8hqs73b7rnm0` is linked to the organization repository at
  `main`/`render.yaml`, associated the existing worker and gateway rather than
  creating replacements, and has Auto Sync disabled.
- Service IDs were preserved: worker `srv-da8ta95g1s2s738gvhk0` and artifact
  gateway `srv-da8ta95g1s2s738gvhkg`. Both show the canonical organization
  repository and keep automatic deploys disabled. The gateway remains Live on
  deploy `dep-dacbg1eq1p3s73fi7dq0`, exact DAR `4112a27...`; `/healthz`
  returned `200 {"status":"ok"}` with `Cache-Control: no-store`, and an
  unauthenticated `/v1/artifacts` request returned the non-disclosing
  `404 Not found.` response.
- With zero active workflows, the worker was suspended before its build
  credential changed. A seven-day-expiry fine-grained token—the shortest
  standard GitHub option—was restricted to `World-Bank-Digital/DAMM`, Contents
  read-only plus required Metadata, saved in Render's encrypted
  `damm_git_netrc`, and never written to the repository or local files. Resume deploy
  `dep-dackii2jnfac73ct3jl0` reached `Deploy succeeded | Live` on exact DAR
  `4112a27...`. The cached private-source layer was reused; runtime preflight
  then reported DAMM `ff5aecbfec5c2694a61f282c27db74ea8b99b28c`, 22 migrations,
  and `watching the run queue`. The token was immediately deleted from GitHub,
  verified absent, and cleared from the browser automation session; only its
  revoked inert value remains in Render.

### Source-pin and acceptance boundary

- At the repository-transfer checkpoint, DAMM PR #11 had fixed legacy
  `--lane all --resume` empty-international recovery and was canonical
  `github/main`
  `92160286dcad8563c5b7d345467b2e2b4d9cfbc3`. Production does not use that
  legacy lane, so DAR intentionally remains pinned to the fully tested
  `ff5aecb...`; no source-pin migration or database mutation accompanied the
  ownership transfer.
- The final read-only Neon checks found zero active workflows. Neither terminal
  Nigeria failure was retried, resumed, reused, cancelled, topped up, or
  mutated, and no country workspace or paid workflow was launched.
- At that checkpoint, a future paid canary remained blocked on verifying the
  then-unconfirmed provider tariffs in DAMM's `prices.json`. The deterministic 8/8 simulations and live
  infrastructure checks are strong preflight evidence, not paid end-to-end
  acceptance.

## Stage 4 recovery production closeout — 2026-09-03

This is the authoritative production state. The guarded release checkpoint and
older closeouts below remain immutable investigation and cutover history.

### Canonical identities and database cutover

- DAMM PR #10 is canonical `github/main`
  `ff5aecbfec5c2694a61f282c27db74ea8b99b28c`. DAR PR #18 is canonical
  `origin/main` `4112a27f30fc37b605919fae29d3004dc3063459`. Immediately before
  deployment, local `main`, its tracking ref, and a direct remote lookup all
  matched the DAR identity and the worktree was clean.
- The pre-migration Neon snapshot is
  `pre-0022-stage4-recovery-20260902-224352-4112a27f`, captured from root branch
  `production` and configured never to expire. Migration
  `0022_damm_source_pin_cutover.sql` was applied exactly once through the direct
  connection. The final read-only audit found zero active workflows, 22
  migrations through `0022`, and the active-workflow guard pinned to exact DAMM
  `ff5aecb...`.

### Render and one-use credential evidence

- Artifact-gateway deploy `dep-dacbg1eq1p3s73fi7dq0` is live on exact DAR
  `4112a27...`. `/healthz` returns `200 {"status":"ok"}` with
  `Cache-Control: no-store`; the Netlify origin receives the exact GET and
  Authorization CORS grant, while missing and attacker origins receive the
  same non-disclosing 404.
- Worker deploy `dep-daci5rmq1p3s73897370` was triggered once by **Resume** and
  reached `Deploy succeeded | Live` on exact DAR `4112a27...`. Runtime logs
  freshly reported installed DAMM `ff5aecb...`, Node `22.22.3`, Python
  `3.12.13`, 22 migrations, pipeline
  `/var/data/checkouts/ff5aecbfec5c2694a61f282c27db74ea8b99b28c`, and
  `watching the run queue`.
- The worker build credential was a one-day fine-grained token restricted to
  `World-Bank-Digital/DAMM`, Contents read-only plus required metadata. It was
  kept out of logs and files outside Render's encrypted Secret File, revoked as
  soon as the worker reached Live, verified absent from GitHub's token list,
  and cleared from the browser automation session.

### Netlify and live access evidence

- Production deploy `6a9924b990749e7ca28360bb` is published from exact
  `main` commit `4112a27f30fc37b605919fae29d3004dc3063459`. It is a Git/API-triggered
  production deploy, not a local artifact upload. The 44-second build logged a
  complete production-environment preflight, `[migrate] up to date`, successful
  function packaging, no secrets in 271 scanned files, and successful build
  completion.
- Netlify Basic protection remains effective for all deploys: fresh anonymous
  requests to `/`, `/methodology`, and `/login` each return 401. An authorized
  Chrome session reaches the DAR Studio landing page, methodology page, and
  email/passkey login page.
- The ignored `.env.staging` deployment ledger records the exact DAR SHA and
  current Netlify, gateway, worker, snapshot, and migration identities without
  exposing credentials.

### Acceptance boundary

- No failed run was retried, resumed, reused, cancelled, topped up, or mutated,
  and no additional country workspace or paid workflow was launched during the
  repair or cutover. The two Nigeria failures below remain terminal evidence.
- Focused and full validation plus three complete zero-spend simulations prove
  the repaired code and deployment path. A successful paid end-to-end workflow
  is deliberately **not yet claimed**; that requires a future, separately
  user-launched canary to complete all eight stages and publish its package.

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
  `pre-0022-stage4-recovery-20260902-224352-4112a27f` was captured successfully
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
- At that checkpoint, the only tracked working-tree changes were this closeout
  and learning L41. They were intentionally uncommitted so `origin/main`
  remained the exact identity deployed across Netlify and Render. The
  2026-09-03 transfer closeout supersedes that working-tree statement: the
  accumulated documentation and governance changes are now merged while
  provider automation remains frozen, so the runtime stays on exact DAR
  `4112a27...` without a self-referential documentation-only redeploy.
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
assessment/package timestamps. Append-only migration `0022` advances only the
source commit to canonical DAMM PR #10 merge
`ff5aecbfec5c2694a61f282c27db74ea8b99b28c`, adding bounded Stage 4 recovery and
preventing technical failures from satisfying a completed evidence lane.
Append-only migration `0023` advances only the source commit to canonical DAMM
PR #12 merge `68e1994b5facfaaf0ddc49ba3bec108d9bde2c55`, adding durable paid-request
reservation/replay, terminal paid-failure propagation, stronger semantic gates,
bounded archive handling, and the 37-file simulation identity. Append-only
migration `0024` advances only the source commit to canonical DAMM PR #13 merge
`76ca33d97f0809a6be7477447786953317aa41b5`, adding completed-checkpoint
accounting validation, bounded semantic repair at Stages 3, 5, and 7, fail-closed
Stage 7 cache integrity, refreshed provider tariffs, and the 38-file simulation
identity. Append-only migration `0025` advances only the source commit to
canonical DAMM PR #14 merge `d81d267133eed52b5fdcc599bfecf8d72496f292`,
rejecting an unknown pricing or reasoning vendor before price/ledger setup,
credential access, model discovery, or transport. The model, schema, workflow,
engine, renderer, tariff artifact, and ratification identity remain unchanged;
the 38-file closure is
`118908785e9d061c387dde163507f39288b00176c6897ee6f7d8943311860f34`. Apply
`0019` through `0025` in filename order and require exactly 25
migration-ledger rows through `0025`. Require zero active workflows and suspend
the preceding-pin worker before the database cutover. Keep it suspended until
every pre-resume identity, anonymous-source, and zero-active gate passes; then
permit one credential-free build at a time of the bound commit, with no
overlapping manual or automated deploy. A terminal failure or cancellation must
be investigated while the worker remains suspended; repeat every source and
zero-active gate before authorizing a retry. The public DAMM fetch must run with
configured and interactive credential paths disabled and attest the exact
manifest pin rather than requiring a moving DAMM branch head to equal it. A
migration or deployment must never terminate, claim, or relaunch an in-flight
workflow.
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
