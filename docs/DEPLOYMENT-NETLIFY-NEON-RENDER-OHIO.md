# Netlify + Neon + Render (Ohio) deployment runbook

This runbook provisions a **staging** DAR Studio deployment with:

- the TanStack Start web application on Netlify Functions in `cmh` (US East, Ohio);
- PostgreSQL on Neon AWS `aws-us-east-2` (Ohio); and
- one persistent Render background worker and one stateless artifact gateway in `ohio`.

For a new environment, run the companion provisioning wizard from a clean
checkout of the merged `main` branch:

```bash
ENV_FILE=.env.staging ./scripts/deploy/netlify-neon-render-ohio.sh
```

The wizard opens the right dashboards, captures values without echoing secrets, and stops at every mutation, cost, or safety boundary. It does not create cloud resources, purchase plans, register OAuth clients, publish a Blueprint, restore a database, or make a human approval decision for you. **Do not run this provisioning wizard end to end for an existing deployment:** its Neon, Netlify, and Blueprint stages intentionally create new resources. For an existing source-pin upgrade, use the dedicated checklist below against the recorded existing resource IDs.

## Readiness verdict and non-negotiable blockers

This topology is not ready merely because the web build and worker start. Do not call it production-ready until every stop condition in this guide is clear.

1. **Large Stage 8 downloads use the Ohio Render gateway, not a Netlify response.** DAR Studio permits a 250 MB complete bundle, 50 MB individual artifacts, and 400 MB total artifact set. Netlify Functions allow 6 MB buffered responses and 20 MB streamed responses. Netlify therefore authorizes the signed-in owner or exact active package reviewer and returns a no-store JSON grant containing a 60-second capability bound to run/artifact-set/key/SHA-256, authenticated subject, and—when applicable—the exact active reviewer assignment. The browser sends that capability only in the `Authorization` header to the fixed `dar-studio-artifacts` endpoint; it never appears in a URL. The gateway revalidates live access in Neon, retrieves the exact currently published row, checks the stored size and SHA-256 against the actual immutable bytes, and streams bounded chunks with `private, no-store`. The repository suite deterministically streams and hashes a synthetic artifact larger than 20 MiB without committing a large fixture; the live smoke separately proves the deployed JSON-grant, CORS, authorization, and byte path with a real immutable artifact. Health, exact-origin CORS, non-disclosing invalid-token behavior, live assignment revocation, and both proofs are hard acceptance gates. A Render worker disk alone is not a download gateway.
2. **Hosted database configuration must fail closed.** On Netlify, a missing or blank `DATABASE_URL` must never select the ephemeral PGLite fallback. A production or preview deployment without its intended database must fail before serving a usable application.
3. **Deploy Previews must not share staging secrets, and production must build only the reviewed commit.** `DATABASE_URL`, authentication secrets, encryption keys, email credentials, and platform AI keys belong only to the production deploy context of this staging project. Disable Deploy Previews and branch deploys. The committed build preflight requires Netlify `CONTEXT=production`, `BRANCH=main`, and a full `COMMIT_REF` exactly equal to `EXPECTED_DEPLOY_GIT_SHA`, so a preview, branch build, or different commit fails even if secrets were scoped incorrectly. A preview that can read or write the staging database is a hard stop.
4. **Deployed social sign-in must be honest.** The baked Grok preview OAuth client accepts only `*.grok-sandbox.com` callbacks. It is not a Netlify credential. Either register a per-app broker client with the two exact callbacks in this guide, or use a committed deployment mode that keeps email/password auth enabled while hiding Google and X. `VITE_AUTH_ENABLED=false` is not an email-only mode: with a hosted database it intentionally fails closed, and without that guard it would collapse users into the shared development identity.
5. **Public self-sign-up exposes platform spend.** A registered user can create a country and launch the country-only autonomous workflow, which consumes the worker's platform vendor keys. Keep the staging Netlify project Private unless an application-level invitation/launch authorization and abuse controls have been implemented. Use one authorized Netlify member session to switch among the three application test identities, or invite each intended reviewer through Netlify on a plan that supports it.
6. **Migration 0027 follows 0019 through 0026 before the repinned Render worker deploys.** Take a Neon recovery snapshot, prove there are no active workflows, run migrations with the direct Neon connection, and verify exactly one ledger row for each current migration. `0019_progressive_stage_artifacts.sql` installs transactionally sealed, owner-only Stage 1–7 publications without historical backfill; `0020`–`0024` retain the previously documented source-pin hardening. `0027_damm_source_pin_cutover.sql` advances only the current source pin to DAMM PR #16 merge `7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb`, adding bounded extractive Exa text reuse, strict malformed-response settlement, corrupt-checkpoint replay protection and safe workflow diagnostics. The model, schema, workflow, engine, renderer, tariff artifact, and ratification fields remain unchanged. Its 38-file production dependency closure is `f6080999dbc11a821125dd2dce32fe00fcdb5d218ba72b2fc4d73d86a1a42061`. Only after all seven gates pass may the Render worker and artifact gateway deploy; neither service runs migrations.
7. **An automated success is still a Draft.** The completed eight-stage package must say `Draft · pre-review`. Automated derivation, vendor challenge, and machine QC must not create G1 or G2 decisions. A release remains an `Approved Draft release` while DAMM is unratified.

### Current 0027 source-pin release invariant

The detailed `0024` descriptions below remain the immutable record of that
earlier cutover. For the current reviewed release candidate, `0027` is the
operative source-pin cutover and supersedes any prior current-pin/count wording
in this runbook. It advances the canonical source to DAMM PR #16 merge
`7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb` and preserves the model, schema,
workflow, engine, renderer, tariff artifact, and ratification identity. The
reviewed repair adds bounded extractive Exa text reuse, strict malformed-response
settlement, corrupt-checkpoint replay protection, and safe workflow diagnostics. The 38-file production dependency
closure is
`f6080999dbc11a821125dd2dce32fe00fcdb5d218ba72b2fc4d73d86a1a42061`.

Before that migration, require zero active workflows, an immutable
root-production snapshot named `pre-0027-...`, and a clean merged DAR commit.
After it, require exactly 27 migration-ledger rows through
`0027_damm_source_pin_cutover.sql`, the exact `7d623f0...` database guard, and
all four protected Nigeria failures unchanged, including b481ddea (0/8, $13.35446735) and fcc17f6c (0/8, $14.8487319). Preserve `d708dbd...` with its
unchanged renderer as historical-only package identity; it must remain
audit-readable but must not be usable for a new or active workflow.

The source attestation is to the exact immutable manifest pin, not to a moving
branch head. In an empty credential-disabled Git environment, anonymously
shallow-fetch and verify `7d623f0...` itself (one reachable commit, no tags,
clean tracked/untracked tree, and object integrity). A read of DAMM `main` is
diagnostic information only: it may have advanced and must not be required to
equal the manifest pin. Failure to fetch or verify the exact pin is a hard stop.

### Existing-production source-pin upgrade order

A reviewed Git merge is inert only while all provider automation remains frozen:
Netlify builds and Deploy Previews are disabled, both Render services have
automatic deploys disabled, and the provisioning Blueprint is disconnected.
Under that exact freeze, merge the reviewed release first so the deployment can
bind one immutable DAR commit. Then, before any migration or provider build:

1. fetch `main` and require the local commit, tracking ref, and direct GitHub
   branch lookup to equal the recorded deployment commit;
2. re-read every automation freeze, disable any remaining Netlify Deploy Preview,
   and keep Netlify builds stopped;
3. suspend the live preceding-pin worker and require the dashboard to show
   `Suspended`;
4. repeat the zero-active-workflow, migration-ledger, current-pin, and preserved-
   terminal-run queries; and
5. create the non-expiring root-production snapshot before applying `0027`.

After `0027` verifies, keep the already-disconnected Blueprint disconnected; do
not reconnect it or create a replacement. Open the two existing Render services
directly and deploy the artifact gateway first, then the still-suspended worker
from the canonical public DAMM source anonymously and without a GitHub
credential, and Netlify last. The anonymous exact-commit fetch is part of the
worker build contract.
The Blueprint creation procedure in Section 11 is for a new environment only.
A source merge must never be treated as permission to migrate, deploy, or launch
a paid workflow.

For an existing environment, remove the legacy `damm_git_netrc` Secret File
with **Save only** while the worker is suspended, and verify that no deploy
starts. Reconfirm zero active workflows. Refresh DAR origin/main again
immediately before resume, refresh the anonymous public DAMM identity, and
require Render's displayed latest commit to build to equal `DEPLOY_GIT_SHA`.
Resume the suspended worker without an overlapping manual deploy. Wait for that
deploy to reach a terminal state—**Live**, **Failed**, or **Canceled**—and
continue only if it is Live on the exact commit without a source credential.

Relevant platform documentation:

- [Netlify: import an existing Git repository](https://docs.netlify.com/welcome/add-new-site/)
- [Netlify: Functions configuration, regions, and limits](https://docs.netlify.com/build/functions/configuration/)
- [Netlify: environment variables](https://docs.netlify.com/build/environment-variables/get-started/)
- [Netlify: secret values outside Netlify builds](https://docs.netlify.com/build/environment-variables/secrets-controller/)
- [Netlify: stop and activate builds](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/)
- [Netlify: manual production deploys with the CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)
- [Netlify: Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)
- [Netlify: project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
- [Neon: create and manage projects](https://neon.com/docs/manage/projects)
- [Neon: pooled connection strings](https://neon.com/docs/connect/connection-pooling)
- [Neon: snapshots are created from root branches](https://neon.com/docs/changelog/2025-10-17)
- [Render: create a Blueprint](https://render.com/docs/infrastructure-as-code)
- [Render: disconnect a Blueprint without deleting managed resources](https://api-docs.render.com/reference/disconnect-blueprint)
- [Render: Blueprint fields and `sync: false` secrets](https://render.com/docs/blueprint-spec)
- [Render: environment variables](https://render.com/docs/configure-environment-variables)
- [Render: regions](https://render.com/docs/regions)
- [Render: graceful shutdown](https://render.com/docs/deploys#graceful-shutdown)
- [Render: persistent-disk limitations](https://render.com/docs/disks#disk-limitations-and-considerations)
- [Repository-transfer provider relink procedure](RENDER-BLUEPRINT-RELINK-RESEARCH.md)

## Data flow and ownership

| Component                | Owns                                                                                                                                                                                                                | Must not own                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Netlify web              | browser UI, same-origin Better Auth endpoints, authenticated server functions, exact-package artifact authorization and no-store 60-second grant issuance                                                           | long-running workflow execution, preview access to staging secrets, large artifact proxying beyond Function limits              |
| Neon `production` branch | users/sessions, countries, run queue, immutable Stage 1–7 publications, Stage 8 artifact bytes and hashes, approval/audit/release rows                                                                              | vendor API keys, build credentials                                                                                              |
| Render worker            | queue polling, pinned DAMM checkout, Python environment, in-progress workflow workspace on its disk                                                                                                                 | G1/G2/G3 decisions, Final/publication claims, public web traffic                                                                |
| Render artifact gateway  | `/healthz` and fixed `/v1/artifacts`; exact-origin CORS, header-only capability verification, live owner/assignment authorization, immutable progressive/Stage 8 Neon byte verification, and chunked HTTPS delivery | user sessions, workflow launch, human decisions, a persistent disk, bearer values in URLs, unsigned or long-lived download URLs |
| Render persistent disk   | pinned runtime checkout and resumable in-progress worker files                                                                                                                                                      | the only copy of completed Stage 8 artifacts; published artifacts must be hash-verified in Neon                                 |
| Human reviewers          | authenticated G1/G2/G3 decisions after Stage 8                                                                                                                                                                      | automated execution, vendor review, or machine QC represented as a human gate                                                   |

The Neon project is named for staging, but its **root `production` branch** is the staging database for this separate project. Neon creates `production` and `development` by default. Use `production` because manual snapshots are supported only for a root branch; do not point this staging deployment at a different Neon production project.

## Captured values and destinations

The wizard writes an ignored, mode-`0600` operator file. Never commit it. In the classification column, **secret** means credential material; **confidential/non-secret** means PII or operational metadata that should still be restricted; and **public/non-secret** includes configuration, identifiers, status, and integrity hashes that are not credentials. “Public” does not mean an operational identifier should be advertised.

| Value                                                                                                               | Source                                                                                         | Destination                                                                                        | Classification                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DEPLOY_GIT_SHA`                                                                                                    | merged `origin/main`                                                                           | local deployment record; compare with Netlify and Render deploys                                   | integrity evidence                                                                             |
| `EXPECTED_DEPLOY_GIT_SHA`                                                                                           | exact `DEPLOY_GIT_SHA`                                                                         | Netlify Production/Builds and the isolated local production build                                  | public integrity gate; must exactly equal full `COMMIT_REF`                                    |
| `NEON_PROJECT_NAME`                                                                                                 | operator, recommended `dar-studio-staging`                                                     | Neon project name; local record                                                                    | public configuration                                                                           |
| `NEON_PROJECT_ID`                                                                                                   | Neon Project settings                                                                          | local record                                                                                       | public identifier                                                                              |
| `NEON_REGION`                                                                                                       | fixed `aws-us-east-2`                                                                          | Neon project; local record                                                                         | public configuration                                                                           |
| `NEON_BRANCH`                                                                                                       | fixed `production`                                                                             | Neon Connect/SQL Editor; local record                                                              | public configuration                                                                           |
| `NEON_BRANCH_ID`                                                                                                    | Neon Branches                                                                                  | local record                                                                                       | public identifier                                                                              |
| `NEON_DATABASE_NAME`, `NEON_ROLE_NAME`                                                                              | Neon Connect panel                                                                             | both connection-string selections and local record                                                 | public configuration identifiers                                                               |
| `DATABASE_URL`                                                                                                      | Neon **pooled** Connect string (`-pooler`)                                                     | Netlify Production/Builds and Functions; both Render services; local operator file                 | secret                                                                                         |
| `MIGRATION_DATABASE_URL` / local `DATABASE_URL_DIRECT`                                                              | Neon direct Connect string (no `-pooler`)                                                      | Netlify Production/Builds only and local migration                                                 | secret                                                                                         |
| `NEON_SNAPSHOT_NAME`                                                                                                | Neon Backup & Restore                                                                          | local recovery record                                                                              | confidential operational metadata                                                              |
| `MIGRATION_0019_VERIFIED`                                                                                           | exact Neon ledger/table/trigger checks                                                         | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `MIGRATION_0020_VERIFIED`                                                                                           | exact Neon ledger/function/source-pin checks                                                   | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `MIGRATION_0021_VERIFIED`                                                                                           | exact Neon ledger/function/current source-pin checks                                           | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `MIGRATION_0022_VERIFIED`                                                                                           | exact Neon ledger/function/current source-pin checks                                           | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `MIGRATION_0023_VERIFIED`                                                                                           | exact Neon ledger/function/current source-pin checks                                           | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `MIGRATION_0024_VERIFIED`                                                                                           | exact Neon ledger/function/current source-pin checks                                           | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `MIGRATION_0027_VERIFIED`                                                                                           | exact Neon ledger/function/current source-pin checks                                           | local deployment record                                                                            | integrity evidence; fixed `true` only after verification                                       |
| `DAR_KEY_SECRET`                                                                                                    | generated locally, 48 random bytes encoded as base64                                           | Netlify Production/Builds and Functions                                                            | secret; keep stable or stored BYOK values become unreadable                                    |
| `BETTER_AUTH_SECRET`                                                                                                | generated locally, 48 random bytes encoded as base64                                           | Netlify Production/Builds and Functions                                                            | secret; keep stable or sessions are invalidated                                                |
| `BETTER_AUTH_URL`                                                                                                   | fixed Netlify production URL                                                                   | Netlify Production/Builds and Functions                                                            | public configuration; full `https://` URL, no trailing slash                                   |
| `VITE_PUBLIC_HOSTNAME`                                                                                              | Netlify production domain                                                                      | Netlify Production/Builds                                                                          | public configuration; bare hostname only                                                       |
| `VITE_AUTH_ENABLED`                                                                                                 | fixed `true`                                                                                   | Netlify Production/Builds and Functions                                                            | public configuration                                                                           |
| `VITE_GROK_AUTH_ENABLED`                                                                                            | `true` only with per-app broker credentials; otherwise `false` for email/password-only staging | Netlify Production/Builds and Functions                                                            | public configuration                                                                           |
| `AUTH_MODE`                                                                                                         | operator chooses `email` or `broker`                                                           | local deployment record; drives Netlify values                                                     | public configuration                                                                           |
| `GROK_AUTH_ISSUER`                                                                                                  | broker operator, normally `https://auth.grok.me`                                               | Netlify Production/Builds and Functions                                                            | public configuration                                                                           |
| `GROK_AUTH_CLIENT_ID`                                                                                               | broker operator                                                                                | Netlify Production/Builds and Functions; local operator file                                       | confidential identifier                                                                        |
| `GROK_AUTH_CLIENT_SECRET`                                                                                           | broker operator                                                                                | Netlify Production/Builds and Functions; local operator file                                       | secret                                                                                         |
| `GROK_GOOGLE_CALLBACK_URL`                                                                                          | derived from Netlify URL                                                                       | broker client's redirect allowlist; local record                                                   | public configuration                                                                           |
| `GROK_X_CALLBACK_URL`                                                                                               | derived from Netlify URL                                                                       | broker client's redirect allowlist; local record                                                   | public configuration                                                                           |
| `DAR_ADMIN_EMAILS`                                                                                                  | operator                                                                                       | optional Netlify Production/Functions value                                                        | confidential operational/PII configuration, not an authentication secret                       |
| `RESEND_API_KEY`                                                                                                    | Resend dashboard                                                                               | optional Netlify Production/Functions value                                                        | secret                                                                                         |
| `EMAIL_FROM`                                                                                                        | verified Resend sender                                                                         | optional Netlify Production/Functions value                                                        | public configuration                                                                           |
| `XAI_API_KEY`                                                                                                       | xAI console                                                                                    | optional Netlify Production/Functions platform key                                                 | secret                                                                                         |
| `ARTIFACT_DELIVERY_SECRET`                                                                                          | generated locally, 48 random bytes encoded as base64                                           | Netlify Production/Builds and Functions; Render artifact gateway                                   | secret; the exact same stable value is required on both services                               |
| `ARTIFACT_GATEWAY_URL`                                                                                              | public Render `dar-studio-artifacts` origin                                                    | Netlify Production/Builds and Functions; local smoke record                                        | public configuration; full HTTPS origin with no trailing path                                  |
| `APP_ORIGIN`                                                                                                        | exact Netlify production origin                                                                | Render artifact gateway                                                                            | public configuration; full HTTPS origin with no trailing path; must equal `BETTER_AUTH_URL`    |
| `EXA_API_KEY`                                                                                                       | [Exa API keys](https://dashboard.exa.ai/api-keys)                                              | Render worker; local operator file                                                                 | secret                                                                                         |
| `JINA_API_KEY`                                                                                                      | [Jina key manager](https://jina.ai/api-dashboard/key-manager)                                  | Render worker; local operator file                                                                 | secret                                                                                         |
| `PERPLEXITY_API_KEY`                                                                                                | [Perplexity API](https://docs.perplexity.ai/docs/getting-started/quickstart)                   | Render worker; local operator file                                                                 | secret                                                                                         |
| `ANTHROPIC_API_KEY`                                                                                                 | Anthropic Console, Settings > API keys                                                         | Render worker; local operator file                                                                 | secret                                                                                         |
| `OPENAI_API_KEY`                                                                                                    | [OpenAI API keys](https://platform.openai.com/api-keys)                                        | Render worker; local operator file                                                                 | secret                                                                                         |
| `GEMINI_API_KEY`                                                                                                    | [Google AI Studio API keys](https://aistudio.google.com/app/apikey)                            | Render worker vendor preflight; local operator file                                                | secret                                                                                         |
| `NETLIFY_PROJECT_SLUG`                                                                                              | Netlify project creation                                                                       | production hostname and local record                                                               | public identifier                                                                              |
| `NETLIFY_SITE_ID`                                                                                                   | Project configuration > General > Project information                                          | local record                                                                                       | public identifier                                                                              |
| `NETLIFY_URL`                                                                                                       | Domain management > Production domains                                                         | auth base URL, smoke tests, local record                                                           | public configuration                                                                           |
| Netlify Basic-protection password, when explicitly approved                                                         | generated once by the authorized operator                                                      | operator password manager or macOS Keychain only                                                   | persistent access credential; never source, `.env.staging`, logs, screenshots, or handoff text |
| `NETLIFY_FUNCTION_REGION`, `NETLIFY_DEPLOY_PREVIEWS`, `NETLIFY_PROJECT_VISIBILITY`                                  | verified Netlify settings                                                                      | local deployment record                                                                            | public configuration; fixed `cmh`, `disabled`, `private`                                       |
| `AWS_LAMBDA_JS_RUNTIME`                                                                                             | fixed `nodejs22.x`                                                                             | Netlify **all deploy contexts**, Functions scope only                                              | public runtime gate; sole deliberate cross-context environment exception                       |
| `NETLIFY_VISITOR_ACCESS_MODE`, `NETLIFY_VISITOR_ACCESS_SCOPE`                                                       | post-save, freshly reloaded Visitor access summary                                             | local deployment record                                                                            | non-secret evidence; `team` or explicitly authorized `basic`, plus fixed `all-deploys`         |
| `NETLIFY_ANONYMOUS_DENIAL_VERIFIED`, `NETLIFY_AUTHORIZED_ACCESS_VERIFIED`                                           | fresh anonymous and authorized live probes                                                     | local deployment record                                                                            | non-secret runtime evidence; fixed `true` only after both probes pass                          |
| `NETLIFY_ENVIRONMENT_VERIFIED`                                                                                      | exact Production context/scope review                                                          | local deployment record                                                                            | integrity evidence; fixed `true` only after review                                             |
| `NETLIFY_BASELINE_DEPLOY_ID`, `NETLIFY_BASELINE_DEPLOY_SHA`                                                         | final deploy-history row before the frozen manual release                                      | local deployment record                                                                            | confidential operational ID and integrity evidence                                             |
| `NETLIFY_DEPLOY_ID`, `NETLIFY_DEPLOY_SHA`                                                                           | successful production deploy details                                                           | local deployment record and commit comparison                                                      | confidential operational ID and integrity evidence                                             |
| `RENDER_BLUEPRINT_STATE`                                                                                            | post-verification Blueprint disconnect and independent service re-read                         | local deployment record                                                                            | public configuration; fixed `disconnected`                                                     |
| `RENDER_WORKER_SERVICE_ID`                                                                                          | Render worker Settings/URL                                                                     | local record                                                                                       | public identifier                                                                              |
| `RENDER_ARTIFACT_SERVICE_ID`                                                                                        | Render gateway Settings/URL                                                                    | local record                                                                                       | public identifier                                                                              |
| `RENDER_WORKER_DEPLOY_ID`, `RENDER_WORKER_DEPLOY_SHA`                                                               | successful worker deploy details                                                               | local deployment record and commit comparison                                                      | confidential operational ID and integrity evidence                                             |
| `RENDER_ARTIFACT_DEPLOY_ID`, `RENDER_ARTIFACT_DEPLOY_SHA`                                                           | successful gateway deploy details                                                              | local deployment record and commit comparison                                                      | confidential operational ID and integrity evidence                                             |
| `DAMM_PIPELINE_DIR`                                                                                                 | worker entrypoint, `/var/data/checkouts/<pinned-commit>`                                       | Render worker runtime                                                                              | public configuration                                                                           |
| `DAMM_PIPELINE_PYTHON`                                                                                              | fixed `/opt/damm-venv/bin/python`                                                              | Render worker runtime                                                                              | public configuration                                                                           |
| Render disk                                                                                                         | `dar-studio-worker-data`, mount `/var/data`, 10 GB                                             | Render worker only                                                                                 | billed infrastructure configuration                                                            |
| `SMOKE_OWNER_NAME`, `SMOKE_OWNER_EMAIL`, `SMOKE_G1_NAME`, `SMOKE_G1_EMAIL`, `SMOKE_G2_NAME`, `SMOKE_G2_EMAIL`       | three operator-controlled test accounts                                                        | Better Auth/Neon and local record                                                                  | confidential PII                                                                               |
| smoke identity passwords                                                                                            | generated by operator                                                                          | Better Auth and the operator's password manager; the wizard does not capture them                  | secret                                                                                         |
| `SMOKE_COUNTRY_NAME`, `SMOKE_COUNTRY_ID`, `SMOKE_RUN_ID`, `SMOKE_ARTIFACT_SET_ID`                                   | separately authorized canary scope and completed workflow/UI or Neon                           | local verification record                                                                          | confidential operational identifiers                                                           |
| `SMOKE_BUNDLE_SHA256`, `SMOKE_WORKFLOW_CONTRACT_SHA256`, `SMOKE_DAMM_MODEL_SHA256`, `SMOKE_ASSESSMENT_INPUT_SHA256` | completed workflow/package or Neon                                                             | local verification record                                                                          | integrity evidence                                                                             |
| `SMOKE_BUNDLE_BYTES`, `SMOKE_GATEWAY_ARTIFACT_BYTES`, `SMOKE_LIVE_OVER_20_MIB`                                      | verified downloads                                                                             | local verification record; largest real gateway artifact plus whether it naturally exceeded 20 MiB | integrity evidence                                                                             |
| `SMOKE_PACKAGE_ID`, `SMOKE_TARGET_IDENTITY_SHA256`                                                                  | Human controls UI or Neon                                                                      | local verification record                                                                          | confidential operational ID and integrity evidence                                             |
| `SMOKE_G1_DECISION_ID`, `SMOKE_G2_DECISION_ID`, `SMOKE_G3_DECISION_ID`, `SMOKE_RELEASE_ID`                          | Human controls UI or Neon                                                                      | local verification record                                                                          | confidential audit identifiers                                                                 |
| `DEPLOYMENT_ENVIRONMENT`, `DEPLOYMENT_READINESS_STATUS`, `DEPLOYMENT_ACCEPTED_AT_UTC`                               | fixed staging mode and final operator confirmation/time                                        | local deployment record                                                                            | public status and integrity evidence                                                           |

Do not put any of these values in GitHub Actions secrets unless a later, reviewed CI workflow explicitly consumes them. This deployment has no need to copy cloud runtime secrets into GitHub.

## Stage-by-stage procedure

### Existing auto-published source-pin upgrades: fallback pre-merge gate

Use this fallback only when automatic publication cannot first be frozen. Validate
the release branch, prove that no workflow is nonterminal, create the named
recovery snapshot on the root production branch, and suspend the preceding-pin
Render worker while the prior release is still authoritative. Only then merge the
release PR. Keep the old worker suspended until an image built from the exact
merged DAR commit and exact new DAMM pin is Live. Queued arrivals may wait
unclaimed during this interval; do not cancel, mutate, or manually fail them.

This order is mandatory because a preceding-pin worker can otherwise claim a run
created after the database cutover and reject that run against its older local
methodology manifest. Netlify auto-publishing makes the merge itself part of the
cutover, so the snapshot and worker suspension must precede it.

### 1. Merge and local preflight

1. For a new environment, merge the deployment-readiness pull request to `main`.
   For an existing deployment whose Netlify builds and Deploy Previews and Render
   service auto-deploys are disabled, with its Blueprint disconnected, follow the
   **Existing-production source-pin upgrade order** above and merge under that
   inert freeze. If any automatic publication cannot be disabled first, complete
   the fallback pre-merge gate above before merging.
2. In the repository run `git fetch origin main`, check out `main`, and fast-forward it.
3. Require a clean worktree and `HEAD == origin/main`.
4. Confirm the merged tree contains `netlify.toml`, `render.yaml`, both `Dockerfile.worker` and `Dockerfile.artifact-gateway`, the worker entrypoint/preflight files, `deploy/artifact-gateway/package.json` and its lockfile, `scripts/artifact-gateway.ts`, immutable historical migrations `0013_damm_methodology_pin_cutover.sql` and `0014`–`0018` DAMM source-pin cutovers, current migrations `0019_progressive_stage_artifacts.sql` and `0020`–`0027` DAMM source-pin cutovers, and this runbook.
5. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:dev`, and `npm run verify:netlify`. The last command exercises the committed Netlify adapter wrapper and PWA route/output contract without using the production build command.
6. Inspect the production build command. It must not silently run migrations against a preview database. This runbook applies migrations explicitly with `DATABASE_URL_DIRECT`.

Stop if any validation fails, if a generated manifest changes, if the canonical eight-stage manifest changes unexpectedly, or if the white-background regression contract changes.

### 2. Confirm infrastructure accounts and release authority

Before creating anything, verify access to Netlify, Neon, Render, and the DAR
repository. Verify separately that the canonical public DAMM repository is
readable anonymously at `https://github.com/World-Bank-Digital/DAMM.git`; the
worker image build must not receive a GitHub credential or token. Both Render
`1c-2g` services and the worker's persistent disk are billed. Record explicit
authority for infrastructure, credential administration, migration, and
deployment. This authority does not authorize a provider inference/search call
or the separately gated Stage 16 paid canary.

Stop if the operator cannot view billing/usage, cannot rotate a key, or does not have authority to incur the costs.

### 3. Capture worker vendor secrets

Create or retrieve all six worker keys. The canonical workflow currently uses Exa, Jina, Perplexity, Anthropic, and OpenAI; Gemini remains required by the full dependency/environment preflight and the retained administrative surface, but the canonical canary is frozen to `anthropic/claude-opus-5` and must not fall back to the Free-tier Gemini credential. These are operator-provisioned platform credentials so the product can honor “country is the only required launch input.”

The Render Blueprint declares the keys with `sync: false`. Render prompts for such values only on initial Blueprint creation. If one is missed, add it later at **Service > Environment > Environment Variables > + Add Environment Variable**, then select **Save, rebuild, and deploy**.

Never bake a key into the Docker image, `render.yaml`, an image build argument, or `/opt/damm/.env`. The entrypoint creates a blank mode-`0600` upstream `.env` only because the pinned DAMM loader requires the file to exist; the actual values remain process environment variables.

The worker installs production dependencies only. The retired `pptxgenjs`
development dependency is absent from both the application and release graph;
presentation export belongs to the pinned DAMM package. Keeping the unused
JavaScript presentation/image parser out of every install is deliberate
deployment hardening, not a product-feature change.

### 4. Create the Neon Ohio project

Dashboard path: **Neon Console > New Project**.

1. Name it `dar-studio-staging` (or another unambiguous staging-only name).
2. Choose **AWS** and **US East (Ohio)**, region ID `aws-us-east-2`. The current default may be N. Virginia; do not accept the default without checking.
3. Choose the intended Postgres version and plan, review storage/compute cost, then create the project.
4. In **Branches**, select the root `production` branch, not its `development` child.
5. Capture the project ID, `production` branch ID, and database name (normally `neondb`).

Stop if the project region is not `aws-us-east-2`, the branch has a parent, or the project is shared with another environment.

### 5. Capture pooled and direct connection strings

Dashboard path: **Neon project Dashboard > Connect**.

1. Select branch `production`, the intended database, and its owner role.
2. Turn **Connection pooling** on and copy the URL as `DATABASE_URL`. Its hostname must contain both `-pooler` and `.us-east-2.aws.neon.tech`. Neon may place a cluster segment such as `.c-5` between them; retain the hostname exactly as supplied.
3. Turn pooling off and copy the direct URL as `DATABASE_URL_DIRECT`. It must use `.us-east-2.aws.neon.tech` and must not contain `-pooler`.
4. Require `sslmode=require` exactly once in both URLs (and retain `channel_binding=require` when Neon supplies it). The pooled and direct strings must not be identical, but after removing the pooled host marker they must identify the same Neon endpoint, database, and role. The deployment preflight rejects cross-project, cross-database, or cross-role pairs so a build cannot migrate one database and serve another.

Use the pooled string for Netlify and Render runtime connections. Use the direct string for the explicit local migration and as Netlify's build-only `MIGRATION_DATABASE_URL`. Neon recommends a direct connection for migrations. Never place the direct value in Netlify Functions, Render, or GitHub.

### 6. Preflight and snapshot the database

Dashboard path: **Neon project > SQL Editor**. Confirm `production` and the intended database are selected.

First determine whether this is a fresh schema:

```sql
select to_regclass('public.runs') as runs_table;
```

If `runs_table` is not null, run:

```sql
select r.id, r.country_name, r.status, r.created_at
from runs r
where r.pass = 'workflow'
  and r.status not in ('done', 'failed', 'cancelled')
order by r.created_at;
```

Require zero rows. The migration itself refuses stale or missing-pin active workflows, but the staging cutover is deliberately stricter: do not change schema while any workflow is active.

Then go to **Backup & Restore**, enable **Enhanced view** if shown, make sure the root `production` branch is selected, and click **Create snapshot**. Name it with UTC date/time and the first eight characters of the merged deploy commit, for example `pre-0027-YYYYMMDD-HHMM-<DEPLOY_GIT_SHA[:8]>`. Capture the snapshot name. Snapshots are only offered on root branches and plan limits apply.

Stop if there is an active workflow, snapshot creation fails, the snapshot limit is exhausted, or the snapshot is for another branch.

### 7. Apply and verify migration 0027 after 0019 through 0026

Only after the snapshot, run from the clean merged checkout:

```bash
DATABASE_URL="$DATABASE_URL" MIGRATION_DATABASE_URL="$DATABASE_URL_DIRECT" npm run db:migrate
```

The migrator applies sorted SQL files one at a time, each in its own transaction, and records the filename in `_migrations`. A failure rolls back that file. Migrations `0013`–`0018` remain immutable historical evidence. Migration `0019` creates append-only Stage 1–7 publication and artifact tables, seals each declared artifact set at commit, and performs no historical backfill. Migration `0020` then cuts new/active workflow identity to DAMM PR #8 merge `e866e7a1fffd5edb14f53da5e038f69b2ec29af2` with renderer digest `95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`. Its Stage 6 length repair is divided into independently checkpointed bounded chunks; the model remains unratified. Migration `0021` advances only the source pin to DAMM PR #9 merge `f7dfbbb647e0a45d996e94f62d49f2218d518c94`, whose Stage 6 and Stage 8 workbooks carry frozen semantic metadata and normalized ZIP-member timestamps so identical simulations and packages stay byte-reproducible across host clocks. Migration `0022` advances only the source pin to DAMM PR #10 merge `ff5aecbfec5c2694a61f282c27db74ea8b99b28c`. It provides one bounded recovery pass for completed-but-empty Stage 4 scans, distinguishes technical failures from evidence abstentions, reuses durable paid results after a crash, and blocks completion while relevant upstream scan failures remain unresolved. Migration `0023` advances only the source pin to DAMM PR #12 merge `68e1994b5facfaaf0ddc49ba3bec108d9bde2c55`. It adds durable pre-transport spend reservations and result journals, terminal propagation for ambiguous and over-bound paid outcomes, strengthened semantic stage gates, bounded package handling, and source-bound deterministic simulations. Migration `0024` advances only the source pin to DAMM PR #13 merge `76ca33d97f0809a6be7477447786953317aa41b5`. It re-emits completion after verifying a reclaimed completed checkpoint, performs at most one distinct semantic repair for invalid Stage 3, Stage 5, and Stage 7 output, fails closed on corrupted repair state, and refreshes the verified provider-tariff metadata. Its 38-file production code identity is `b867d6960ac6e0f446e89f9c341b6283fdb3ddfe4326070049bf4a5c097e134c`. The renderer, model, workflow, engine, and ratification fields remain unchanged. If migration 0020, 0021, 0022, 0023, or 0024 reports:

> Cannot install the current DAMM source pin while stale or missing-pin workflows are active; allow them to finish and retry the deployment.

do exactly that. Do not edit the ledger, terminate a run, or weaken the guard to force the deployment.

Migration `0025` pins DAMM PR #14 merge `d81d267133eed52b5fdcc599bfecf8d72496f292`, which fails closed for unknown provider pricing. Migration `0026` pins DAMM PR #15 merge `d708dbd0129cfb7f37dcf003875c439367b7c97d`, adding bounded Reader source rejection handling and durable terminal outcomes. Both migrations remain immutable.

Migration `0027` advances only the source pin to DAMM PR #16 merge
`7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb`. It reuses bounded extractive Exa page text before Reader across research stages, preserves usable duplicate extracts, settles malformed provider responses conservatively, and prevents replay through corrupt checkpoint identities. It preserves the model, schema, workflow, engine, renderer, tariff artifact, and ratification identity. Its 38-file production closure is
`f6080999dbc11a821125dd2dce32fe00fcdb5d218ba72b2fc4d73d86a1a42061`.
If `0027` reports the quoted stale/missing-pin guard, allow the active workflow
to finish and retry the deployment; never alter the ledger or the workflow to
force the cutover.

Verify in Neon SQL Editor:

```sql
select name, applied_at
from _migrations
where name in (
  '0019_progressive_stage_artifacts.sql',
  '0020_damm_source_pin_cutover.sql',
  '0021_damm_source_pin_cutover.sql',
  '0022_damm_source_pin_cutover.sql',
  '0023_damm_source_pin_cutover.sql',
  '0024_damm_source_pin_cutover.sql',
  '0025_damm_source_pin_cutover.sql',
  '0026_damm_source_pin_cutover.sql',
  '0027_damm_source_pin_cutover.sql'
)
order by name;
```

Require exactly nine rows, one for each filename in that order. Verify that the
progressive schema and its insert/completeness guards exist:

```sql
select to_regclass('public.workflow_stage_publications') is not null
         as stage_publications,
       to_regclass('public.workflow_stage_artifacts') is not null
         as stage_artifacts,
       exists (
         select 1 from pg_trigger
         where tgname = 'completed_stage_artifact_count_guard'
           and not tgisinternal
       ) as artifact_count_guard,
       exists (
         select 1 from pg_trigger
         where tgname = 'completed_stage_publication_complete'
           and not tgisinternal
       ) as publication_complete_guard;
```

Require all four values to be `true`. Also verify that the installed function
retains the unratified identity, exact DAMM merge, and renderer digest:

```sql
select pg_get_functiondef('require_active_workflow_methodology()'::regprocedure)
  like '%7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb%' as pinned_commit,
       pg_get_functiondef('require_active_workflow_methodology()'::regprocedure)
  like '%95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be%'
    as renderer_digest,
       pg_get_functiondef('require_active_workflow_methodology()'::regprocedure)
  like '%methodology.model_ratified = false%' as remains_unratified;
```

Require all three values to be `true`. Keep the pre-migration snapshot through the entire smoke test.

Also require the whole migration ledger to contain exactly 27 rows through
`0027`, repeat the active-workflow query and require zero rows, and prove the four
preserved failures are byte-for-byte historical state rather than collateral
cutover victims:

```sql
select count(*) as migration_count, max(name) as latest_migration
from _migrations;

select r.id, r.status, r.rows_done,
       r.spent_usd,
       r.workflow_artifact_set_id is null as no_final_package,
       r.claimed_by is null as no_claimant, r.claim_token is null as no_claim,
       (select count(*) from workflow_stage_publications p
        where p.run_id = r.id) as stage_publications,
       (select count(*) from workflow_stage_artifacts a
        where a.run_id = r.id) as stage_artifacts,
       (select count(*) from workflow_run_artifacts a
        where a.run_id = r.id) as final_artifacts
from runs r
where r.id in (
  '7e301235-692d-4fe2-b406-7426ea1bebcb',
  'e96a93fd-d4a9-4c83-96d9-3488483729a9',
  'b481ddea-1ab3-4757-ba96-64e87c9c6bb2',
  'fcc17f6c-ce24-439b-83fc-a2f66523bf52'
)
order by r.id;
```

Require `27` and `0027_damm_source_pin_cutover.sql`. Require all four runs to remain
`failed`, unclaimed, and without a final artifact set or final artifacts:

- `7e301235`: 3/8 at `$28.1829`, with three stage publications and 18 stage artifacts.
- `e96a93fd`: 5/8 at `$29.64701`, with zero stage publications/artifacts.
- `b481ddea`: 0/8 at `$13.35446735`, with zero stage publications/artifacts.
- `fcc17f6c`: 0/8 at `$14.8487319`, with zero stage publications/artifacts.

Any difference is a hard stop before a provider build.

### 8. Import or verify the Netlify project, then freeze builds

Dashboard path: **Netlify team > Projects > Add new project > Import an existing project > GitHub**.

1. For a new site, import the exact `World-Bank-Digital/dar-studio-v2`
   repository. For an existing site, verify that link in place; do not create a
   duplicate project.
2. Set the production branch to `main`.
3. Use the build command and publish directory committed in `netlify.toml`; do not replace them with remembered Vercel settings.
4. Choose an unambiguous slug such as `dar-studio-staging` and capture the resulting `https://<slug>.netlify.app` URL.
5. Capture the site ID from **Project configuration > General > Project information**.
6. Wait until the expected initial deploy reaches a terminal state, canceling
   it first if needed. It is not acceptance evidence.
7. Immediately stop Netlify builds. Save, reload or use a fresh API read, and
   require `stop_builds=true`.
8. Record the latest deploy ID and displayed commit (or `none`) as the frozen
   deploy-history baseline. Account for any later deploy before proceeding.

If Netlify attempts a deploy before environment variables exist, the hosted application must fail closed. That failed first deploy is not a smoke pass. Never accept a live PGLite-backed staging site.

### 9. Pin Netlify region, contexts, and visibility

1. Go to **Project configuration > Build & deploy > Continuous deployment > Functions region**. Confirm `cmh` / **US East (Ohio)**. New projects default to `cmh`; changing it is a Pro/Enterprise feature. Redeploy after any change.
2. Go to **Project configuration > Build & deploy > Continuous Deployment > Branches and deploy contexts > Configure**. Keep production branch `main`, set **Branch deploys: None**, and disable **Deploy Previews**.
3. Go to **Project configuration > General > Visitor access > Password Protection** and require an actually enforced private mode. Prefer **Team protection** so authorized Netlify members use their team login. If Team protection is plan-gated, **Basic protection** is an acceptable fallback only with explicit credential authority and an approved storage, distribution, and rotation plan; otherwise stop. Never leave **No protection settings** selected. Store a Basic password only in the operator's password manager or Keychain, never in source or the local deployment record.
4. Save, reload the configuration, and require the rendered summary to say **Protected by: Team protection** or **Protected by: Basic protection** and **Access restricted to: All deploys**. A click or a locally recorded `private` value is not evidence that the setting persisted.
5. From a fresh anonymous client, require the protection boundary rather than application HTML; the current Basic-protection response is HTTP 401. Then complete the protection challenge in a fresh authorized session and require DAR Studio to load. Confirm the operator can still exercise all three application identities through the chosen protection. Record the exact non-secret mode, scope, anonymous-denial result, and authorized-access result—not the password. Do not make the project public merely to simplify a review link.

Stop if Functions are not in Ohio, a preview receives production environment variables, a non-main branch can publish, Visitor access is unprotected, or intended reviewers cannot reach the private project. Keep the paid worker suspended whenever the launch surface is public.

### 10. Provision authentication

Set:

```text
BETTER_AUTH_URL=https://<slug>.netlify.app
VITE_PUBLIC_HOSTNAME=<slug>.netlify.app
VITE_AUTH_ENABLED=true
VITE_GROK_AUTH_ENABLED=false
```

`BETTER_AUTH_URL` is a full HTTPS origin with no trailing slash. `VITE_PUBLIC_HOSTNAME` is a bare hostname with no scheme or path. These values establish the trusted deployed origin.

For broker-backed Google and X, register a dedicated app client with exactly:

```text
https://<slug>.netlify.app/api/auth/oauth2/callback/grok-google
https://<slug>.netlify.app/api/auth/oauth2/callback/grok-x
```

Then change `VITE_GROK_AUTH_ENABLED=true`, capture the app client ID and secret, and set `GROK_AUTH_ISSUER` (normally `https://auth.grok.me`). Do not enter Google or X provider secrets in DAR Studio; the broker owns them.

If no per-app broker client is available, keep `VITE_GROK_AUTH_ENABLED=false`. The merged application must remove the Google/X controls while retaining email/password sign-in. Seeing Google or X buttons in that mode, or setting the flag to `true` without all three `GROK_AUTH_*` values, is a hard stop.

### 11. Create both Render Ohio services from the Blueprint (new environments only)

Do this only for a new environment and only after migrations `0019` through
`0027` are verified. For an existing environment whose Blueprint is already
disconnected, do not use this section: keep it disconnected and open/deploy the
two existing services directly as specified in the source-pin upgrade order.

Dashboard path: **Render Dashboard > New > Blueprint > Connect** the exact
`World-Bank-Digital/dar-studio-v2` repository.

1. Name the Blueprint clearly, select branch `main`, and keep Blueprint path `render.yaml`.
2. Review `dar-studio-worker`: `type: worker`, `runtime: docker`, `region: ohio`, plan `1c-2g`, `dockerfilePath: ./Dockerfile.worker`, one instance, `autoDeployTrigger: off`, and no `maxShutdownDelaySeconds` field.
3. Confirm its persistent disk is `dar-studio-worker-data`, mounted at `/var/data`, with 10 GB. Render's live semantic validator rejects a custom maximum shutdown delay on a service with a disk, so the worker uses Render's documented default 30-second shutdown window. Its graceful SIGTERM path, five-minute claim lease, and durable coordinator/workflow checkpoints let a replacement worker reclaim and resume a forced-off run. Keep Blueprint Auto Sync and service auto-deploy disabled, and never trigger a manual worker deploy while a workflow is active.
4. Review `dar-studio-artifacts`: `type: web`, `runtime: docker`, `region: ohio`, plan `1c-2g`, `dockerfilePath: ./Dockerfile.artifact-gateway`, one instance, `autoDeployTrigger: off`, `healthCheckPath: /healthz`, `maxShutdownDelaySeconds: 300`, and **no disk**.
5. At the initial `sync: false` prompts, give the worker `DATABASE_URL` (pooled) plus all six vendor keys. Give the gateway the same pooled `DATABASE_URL`, the generated `ARTIFACT_DELIVERY_SECRET`, and `APP_ORIGIN` set to the exact `NETLIFY_URL`/`BETTER_AUTH_URL`. Render supplies `PORT`.
6. Reconfirm zero active workflows before clicking any deployment control. A new worker must not become available while a workflow is nonterminal.
7. Refresh both bound source identities immediately before clicking: require local DAR `HEAD`, `origin/main`, and the direct GitHub branch identity to equal the recorded `DEPLOY_GIT_SHA`. In an empty temporary home with inherited/global/system Git configuration and interactive credential paths disabled, anonymously shallow-fetch and verify exact DAMM commit `7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb`. Require a clean one-commit/no-tag checkout and strict object integrity. Record DAMM `refs/heads/main` only as diagnostic information; it may advance and must not be compared with the immutable manifest pin. If the exact pin cannot be fetched or verified, stop before deployment and restart from a reviewed source state.
8. Review both `1c-2g` service charges and the worker disk charge, then click **Deploy Blueprint** once. The worker initializes a credential-free seed and shallow-fetches only the pinned commit from the public DAMM repository, with no tags or older reachable history. Do not start an overlapping manual deploy.
9. Immediately open the created Blueprint's **Settings** and set **Auto Sync: No** while the initial builds settle. Both services already have `autoDeployTrigger: off` in `render.yaml`. Confirm all three automation controls are off before waiting for build completion.
10. Wait for both initial credential-free deploys to reach terminal states—**Live**, **Failed**, or **Canceled**—without starting a second build. Continue only if both are Live on the recorded commit, the worker has no GitHub source credential or Secret File configured, and the active-workflow query still returns zero rows. A failed, canceled, wrong-commit, credential-bearing, or active-workflow initial deployment is a hard stop.
11. Capture the worker service ID, gateway service ID, and the gateway's public `https://<name>.onrender.com` origin. Do not retain the temporary Blueprint ID or Sync Hook URL in the release ledger.

Render prompts for `sync: false` values only on initial creation. If a runtime value is missed, use **Service > Environment > Environment Variables > + Add Environment Variable**, then **Save, rebuild, and deploy**. No GitHub source credential belongs in Environment Variables, Secret Files, Docker arguments, or the image. Stop before clicking Deploy Blueprint if either service's branch, region, type, plan, disk, instance count, commit, or runtime-secret list differs. Render cannot change a service's region in place.

### 12. Verify the worker and artifact gateway

For `dar-studio-worker`, open **Logs**. Require `[worker-checkout] installed DAMM <commit>` (or `reusing`) followed by `[worker-preflight] ready ...` and the existing `[worker] ...`, `[worker] pipeline ...`, `[worker] interpreter ...`, and `[worker] watching the run queue` lines. It must prove:

- the DAMM checkout is exactly commit `7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb`;
- `gauntlet/loop-1/render_v17.py` has SHA-256 `95dcef014086f6c01f58678db426fb48d87546b8b6a4315c530801b1ff74c5be`;
- its tracked tree is clean and prohibited untracked/ignored executable source is absent;
- the checkout lives under `/var/data/checkouts/<pinned-commit>`;
- Node is exactly `22.22.3`, Python is exactly `3.12.13`, and the interpreter is
  `/opt/damm-venv/bin/python`;
- preflight reports exactly `migrations=27`, after the SQL verification above
  proved one ledger row through `0027` and no unexpected row;
- Pandoc and LibreOffice/`soffice` are present for DOCX/PDF generation;
- all six required vendor variable names are nonempty and the pinned SDKs import without printing values (the full workflow smoke later proves live vendor authorization);
- the upstream root `.env` exists as a blank mode-`0600` compatibility file; and
- the worker is watching the Neon queue.

Capture the worker deploy ID and commit, and require that commit to equal
`DEPLOY_GIT_SHA`. Before runtime verification begins, the credential-free deploy
must already have settled; any GitHub source credential configured on the worker
is a hard stop.

For `dar-studio-artifacts`, open `https://<gateway>.onrender.com/healthz`. Require status `200`, body `{"status":"ok"}`, and `Cache-Control: no-store`. Request fixed `/v1/artifacts` without the exact allowed Origin and header capability; require a non-disclosing `404` and `Not found.`. Its logs must show `[artifact-gateway] listening on 0.0.0.0:<PORT>` without a secret or database URL. Capture its deploy ID and require its commit to equal `DEPLOY_GIT_SHA`.

Only after both services are stable and their exact deploy IDs and commits are
recorded, inspect the Blueprint list. If the Blueprint is already absent, do
not reconnect it. If it remains connected, open its **Settings** page and
choose **Disconnect Blueprint**. The confirmation must state: “Resources will no longer sync
automatically from your Blueprint file. This will not delete the file itself.
This will not delete the managed resources. You can always connect your file
later from the Blueprint page.” Render's API documentation independently states
that disconnection stops automatic resource syncing and does not delete managed
services or other resources. Stop if the confirmation differs or presents any
deploy, deletion, or billing action.

After confirming, require the Blueprint to be absent and its Sync Hook to be
unavailable. Do not request the old Sync Hook URL with any HTTP method: a probe
could itself trigger a sync. Independently re-read both service pages and require
that the worker and gateway remain **Live** on the unchanged deploy IDs and
commits, Auto-Deploy and PR Previews remain Off, and the worker disk remains
attached at `/var/data` with its recorded size. Remove stale
`RENDER_BLUEPRINT_ID` and `RENDER_BLUEPRINT_AUTO_SYNC` rows from the local
ledger, then record only `RENDER_BLUEPRINT_STATE=disconnected`.

Any `[worker-checkout] failed:`, `[worker-preflight] failed:`, `[worker-entrypoint] failed:`, gateway startup/database failure, checkout drift, wrong commit, absent renderer, invalid health response, or repeated crash/restart is a hard stop. Do not launch a workflow to diagnose a failed preflight.

### 13. Set Netlify environment variables

Dashboard path: **Project configuration > Environment variables > Add a variable**.

Every application value and every secret belongs only to the **Production** deploy
context. There is one narrow, non-secret exception: set
`AWS_LAMBDA_JS_RUNTIME=nodejs22.x` for **all deploy contexts**, Functions scope
only. Pinned CLI 27.4.2 packages a `--no-build` Function using the `dev`
Functions environment, so a Production-only runtime setting is not visible to
that packaging path and silently defaults to a newer runtime. Deploy Previews
remain disabled; this exception contains no database, application, or credential
value.

Use the narrowest scope:

| Key                                                | Context    | Scope                | Required                                               |
| -------------------------------------------------- | ---------- | -------------------- | ------------------------------------------------------ |
| `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`                 | all        | Functions            | yes; non-secret runtime gate                           |
| `DATABASE_URL` (pooled)                            | Production | Builds and Functions | yes                                                    |
| `MIGRATION_DATABASE_URL` (direct)                  | Production | Builds only          | yes                                                    |
| `EXPECTED_DEPLOY_GIT_SHA`                          | Production | Builds only          | yes; exact reviewed 40-character commit SHA            |
| `DAR_KEY_SECRET`                                   | Production | Builds and Functions | yes                                                    |
| `BETTER_AUTH_SECRET`                               | Production | Builds and Functions | yes                                                    |
| `BETTER_AUTH_URL`                                  | Production | Builds and Functions | yes                                                    |
| `VITE_AUTH_ENABLED=true`                           | Production | Builds and Functions | yes                                                    |
| `VITE_PUBLIC_HOSTNAME`                             | Production | Builds               | yes                                                    |
| `VITE_GROK_AUTH_ENABLED`                           | Production | Builds and Functions | yes                                                    |
| `GROK_AUTH_ISSUER`, client ID, client secret       | Production | Builds and Functions | only for broker mode                                   |
| `ARTIFACT_GATEWAY_URL`, `ARTIFACT_DELIVERY_SECRET` | Production | Builds and Functions | yes                                                    |
| `DAR_ADMIN_EMAILS`                                 | Production | Functions            | optional                                               |
| `RESEND_API_KEY`, `EMAIL_FROM`                     | Production | Functions            | optional but required for real password-reset delivery |
| `XAI_API_KEY`                                      | Production | Functions            | optional platform key                                  |

Mark database URLs, encryption/auth secrets, OAuth client secrets, mail keys, and AI keys as **Contains secret values**. The direct URL is stored under `MIGRATION_DATABASE_URL`, never under the local-only name `DATABASE_URL_DIRECT`. Do not set either database URL for Deploy Preview, branch deploy, Preview Server, or local contexts. Netlify environment changes require a new deploy. The migrator must prefer `MIGRATION_DATABASE_URL`, take its deployment advisory lock, and leave the pooled URL for application runtime.

### 14. Deploy and verify the Netlify web application

Keep Deploy Previews disabled and `stop_builds=true` throughout this sequence.
Netlify documents that stopped builds still permit a local CLI build followed
by a manual deploy. Perform the complete install, build, Function audit, and
upload in the pinned Linux/amd64 release image
`node:22.22.3-bookworm@sha256:46e94f8cf91baab69a2deb3153e74eeffd73c20c7cc1d8432f5b96469eaa0322`.
This binds the native Function bundle to Netlify's Linux x64 glibc runtime and
avoids a branch-HEAD race or open build-gate interval.

1. With builds still frozen, refresh cached origin/main and direct GitHub main;
   they must both equal DEPLOY_GIT_SHA. Re-read Netlify and require
   `stop_builds=true`, previews disabled, and no deploy after the recorded
   deploy-history baseline.
2. Authenticate pinned `netlify-cli@27.4.2` interactively and verify the exact
   account and site ID. Do not create or save an automation token. Require a
   trusted local Docker engine. Only the final deploy container receives the
   interactive CLI configuration: it mounts one read-only source file, copies it
   mode `0600` into writable ephemeral tmpfs, and discards that copy with the
   container. CLI 27.4.2 rewrites its global configuration even for `env:get`,
   so mounting the live operator file directly at its write location is both
   unsafe and nonfunctional. Install, application build, secret scanning, and
   Function audit receive no CLI credential. No container receives
   `NETLIFY_AUTH_TOKEN`.
3. Create a temporary clean detached worktree at exact `DEPLOY_GIT_SHA`; require
   its `HEAD` and clean status, install an exit/signal cleanup trap, and create
   one Docker-generated, release-labeled ephemeral volume. Require its returned
   identifier and exact commit label, assert the new volume is empty before
   copying, and remove only a volume this process marked as created whose label
   still matches. Fail if it or the worktree survives cleanup. In the pinned
   image, copy the clean tree into that volume and run `npm ci` with no operator
   secret or provider credential present. Require Node `v22.22.3`,
   `netlify-cli@27.4.2`, and
   `@netlify/zip-it-and-ship-it@15.5.0` exactly.
4. Netlify masks secret values when a production-context build runs outside
   Netlify. Therefore, do not ask the CLI to build. In a second invocation of
   the same pinned image and volume, strip inherited host exports and allowlist
   only the Docker client-selection variables needed to reach the already
   verified engine. Send required build values as a fixed-order NUL-framed stdin
   stream and export them only inside the short-lived container; do not use
   Docker `--env` for a secret because Docker persists resolved `Config.Env`
   values until container removal. Map
   `DATABASE_URL_DIRECT` to `MIGRATION_DATABASE_URL`, bind `NETLIFY=true`,
   `CONTEXT=production`, `BRANCH=main`, and both commit variables to
   `DEPLOY_GIT_SHA`, then run `npm run build` directly. Do not place a secret in
   a CLI argument, generated file, or output.
5. Before upload, scan every regular, non-symbolic file under `dist` and
   `.netlify` for the exact
   database, auth, encryption, artifact, and selected broker secret in plaintext,
   Base64, and URI-encoded form. The scanner reports only variable names and file
   paths; any match, unreadable entry, symlink, or non-file output is a hard
   stop. Then clear every build secret from the container environment.
6. Still in the same pinned Linux/amd64 image, package a separate audit archive
   with the exact committed Function configuration. Require one streamed
   Functions-v2 `server` route on `/*`, runtime `nodejs22.x`, safe and unique ZIP
   names, and exactly one native binary:
   `@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node`. Require the canvas
   JavaScript bindings, `pdf-parse`, and the exact dynamic PDF.js worker
   `pdfjs-dist/legacy/build/pdf.worker.mjs`; then extract the audited archive and
   successfully parse a bounded generated PDF. A Darwin, arm64, musl, missing
   worker, malformed archive, or failed real PDF parse is a hard stop. Harmless
   optional-package metadata may be present, but no second `.node` binary may be.
7. Start a third invocation of the same pinned image only after the build and
   Function audit pass. Send only the non-secret site ID and commit SHA on its
   NUL-framed stdin; mount the operator config read-only at its separate source
   path and copy it into writable container tmpfs. Query Netlify's remote
   `dev`/Functions value and require
   `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` immediately before upload. Then use the
   exact local `./node_modules/.bin/netlify` binary and Linux volume to upload
   once with `netlify deploy --prod --no-build --skip-functions-cache`, explicit
   `--dir dist/client`, explicit `--functions .netlify/v1/functions`, and the
   verified `--site <site-id>`; title it
   `DAR Studio release <DEPLOY_GIT_SHA>`. `--skip-functions-cache`
   forces a fresh Function package rather than reusing a prior host/architecture
   cache. The explicit client and Function paths override any historical remote
   `functions_dir`; require `netlify/functions`, `.netlify/functions`,
   `.netlify/functions-internal`, `.netlify/edge-functions`,
   `.netlify/v1/edge-functions`, `.netlify/edge-functions-dist`, every Netlify
   blob directory, `.netlify/deploy-config`, and
   `.netlify/internal/db/migrations` to be absent so no unaudited Function, Edge
   Function, blob, or extension input exists. The deployed Function obtains
   application runtime values from the separately verified Production-scoped
   Netlify environment; no local secret is forwarded as a deploy argument.
8. `EXPECTED_DEPLOY_GIT_SHA=<DEPLOY_GIT_SHA>` must be supplied to the direct
   local build from the operator value already configured in Netlify. The
   committed first preflight rejects a missing, malformed, or unequal
   `COMMIT_REF` before Vite and before migration. Remove the temporary worktree
   and exact temporary Docker volume after every success, failure, interruption,
   or stop.
9. Require the manual deploy to settle successfully, and then verify all checks
   below, including deployed server metadata showing Node.js 22.x and streamed
   invocation. A failed manual attempt is a hard stop; builds remain stopped.
10. Finally re-read `stop_builds=true`, previews disabled, and exactly one new
    manual production deploy after the frozen baseline.

For the single intended deploy, require:

- the deploy is Manual / Production, its title contains the exact merged
  `main` commit, and local provenance records that same exact clean worktree;
- build preflight accepts only `CONTEXT=production`, `BRANCH=main`, and a full
  `COMMIT_REF` exactly equal to `EXPECTED_DEPLOY_GIT_SHA`; a different commit,
  deploy-preview, branch-deploy, dev, missing context, or missing/wrong branch
  must fail closed;
- build output comes from the committed Netlify adapter, not `.vercel` output;
- the install, build, Function audit, and deploy all used the exact pinned
  Linux/amd64 image, CLI, and packager; the fresh Function archive passed the
  native-module, PDF-worker, metadata, and real-PDF smoke checks;
- deployed `server` Function metadata reports Node.js 22.x and streamed
  Functions-v2 invocation;
- the migration output is `up to date` against the already verified exact
  27-row ledger through `0027`; it must not be the first process to apply `0027`;
- no migration is attempted during a preview build;
- `/` and `/methodology` load over HTTPS;
- `/login` offers email/password, and social buttons match the chosen auth mode;
- the committed preflight/database-fallback regression test (or the initial secretless failed build) proves a missing/invalid `DATABASE_URL` fails closed rather than opening a usable empty portfolio;
- all app-owned pages and loading/error/empty/dialog/review states keep the explicit white background; and
- the deployed Functions environment contains both artifact-gateway values. The first authenticated JSON-grant and header-only byte-delivery proof occurs in Stage 16 after a real artifact exists.

Do not re-enable previews on this staging project merely to prove isolation. Use the committed secretless preview preflight test, or a separately isolated disposable Netlify project with its own database if a live preview is later required. A preview that receives the staging Neon URLs or any staging secret is a hard stop.

### Deployment-only closeout and stop boundary

When a paid canary is not separately authorized, stop here. Record the exact DAR
commit on Netlify, the gateway, and the worker; exact DAMM `7d623f03...`; worker
`node=22.22.3 python=3.12.13 migrations=27`; Basic-protection anonymous denial
and fresh authorized reachability; stopped Netlify builds with Deploy Previews
disabled; disabled Render service auto-deploys; disconnected Blueprint with no
Sync Hook; unchanged Render service deploy IDs and worker disk;
zero active workflows; the `0027` guard; and the unchanged four failed-run rows.
Stages 15 and 16 are an optional, separately authorized acceptance extension.
Do not create identities or a country workspace merely to finish deployment.

### 15. Create three real staging identities

At `https://<slug>.netlify.app/login`, use **Need an account? Create one** to register three distinct names/emails/passwords:

1. the country owner / future G3 signer;
2. the named G1 assessor; and
3. the independent G2 reviewer.

Email verification is not required to sign in. Without `RESEND_API_KEY`, verification/reset messages are only logged, so do not claim password recovery works until Resend is configured and tested. Sign out and sign in as each identity. Do not reuse one account with different display names; G2 independence is bound to the authenticated user ID.

### 16. Run one separately authorized autonomous eight-stage Draft canary

This stage is outside deployment and consumes vendor budget. Stop after deployment unless a separate explicit paid-canary authorization names one new country and its spend boundary. Immediately before launch, require all of these preconditions again:

- same-day first-party verification of every selected provider model ID and
  tariff;
- the exact Render Jina key mapped to its package/rate, with its account funding
  control verified as acceptably bounded for the canary and provider-side spend
  limits recorded where available;
- exact reviewed DAR on Netlify, gateway, and worker; exact DAMM
  `7d623f035a645baa3a8b45200ff4ea3cd7dd0bdb`; 38-file identity
  `f6080999dbc11a821125dd2dce32fe00fcdb5d218ba72b2fc4d73d86a1a42061`;
  and the expected model/renderer hashes;
- one Live worker instance, one possible claimant, a confirmed lease margin,
  migration `0027`, zero active workflows, no unresolved spend reservation, and
  all four failed runs unchanged; and
- stopped Netlify builds after the exact deploy, Deploy Previews disabled,
  Render automatic deploys disabled, Blueprint disconnected with no Sync Hook,
  private anonymous
  denial, and authorized reachability.

Any failed or uncertain precondition is **NO-GO**. Sign in as the owner only
after all of them and the separate authorization are recorded:

1. Record the explicitly authorized country, select **New country**, and create exactly
   that one workspace. Do not load a demo pack, retry, resume, or otherwise reuse any
   historical failed run; this must create a new run ID and a new immutable artifact-set
   identity at the repinned commit.
2. In **DAR workflow**, leave all optional upload categories empty for the country-only launch smoke. Separately test a small optional upload before launch if upload coverage is required.
3. Click **Launch Draft DAR workflow** once.
4. At launch and after each stage, record the sole claimant and lease margin;
   immutable stage/publication and input/output identities; settled spend plus
   unresolved reservations by provider/model/pass; and cumulative spend against
   `$225`, `$262.50`, `$312.50`, `$350`, `$400`, `$425`, then strictly `<$500`.
   Stage 8 must add no provider cost. Verify all eight stages run end to end with
   no human input, pause, review gate, approval, or budget top-up.
5. Verify the terminal UI says `Draft · pre-review`, explicitly says automation is not G1/G2/G3, and keeps the package downloadable.
6. Download the complete bundle, Draft Markdown, DOCX, and PDF, cost-benefit XLSX, consolidated source inventory XLSX, workflow manifests, and representative artifacts from every stage. Verify filenames, nonzero length, content type, and SHA-256 where exposed.
7. Exercise the implemented gateway path with the largest real artifact from this run. In browser network tools, the authorized same-origin Netlify request must return `200`, `Cache-Control: no-store`, and media type `application/vnd.dar-studio.artifact-delivery+json`; its JSON endpoint must be the fixed HTTPS `/v1/artifacts` URL with no query/hash and must not contain the capability. The browser's cross-origin request must carry the capability only as `Authorization: Bearer`, send no cookies, and be accepted only from `APP_ORIGIN`. The gateway must return `200`, `private, no-store`, the attachment filename, `Content-Length`, `X-Content-SHA256`, and an exact body hash. Confirm no capability appears in browser URLs, copied download links, gateway access paths, or referrers. Require anonymous and unassigned callers to be denied at Netlify. Using an ephemeral request client that does not retain history, change one capability character and, separately, wait more than its 60-second lifetime before replaying an untouched capability in the header; both gateway requests must receive the same non-disclosing `404`. The mandatory repository regression already proves an exact >20 MiB 21-chunk stream plus wrong-package and changed-hash rejection. If this real run naturally produces an artifact larger than 20 MiB, record its successful live size/hash proof too; otherwise record the largest real artifact tested. Do not mutate immutable staging rows or distort the canonical country-only workflow to manufacture a larger file. A separate upload-backed live run may be authorized later if provider-level >20 MiB evidence is required.

Capture the run ID, artifact-set ID, bundle SHA-256, bundle byte count, workflow contract version/hash, DAMM version/revision/status/ratification flag/hash/source commit, and assessment-input hash.

Stop without automatic retry, top-up, provider/model switch, or state repair on
any identity/tariff/package/funding drift; second claimant or unconfirmed lease;
missing, malformed, ambiguous, unmetered, or over-reservation paid outcome;
transport retry; technical failure presented as an evidence gap; empty, stale,
duplicate, truncated, or semantically incomplete stage product; ledger or
checkpoint mismatch; failed stage/publication/terminal acknowledgement; missing
format; failed download or artifact hash; worker restart that loses the run;
`Final`/publication-ready wording; or a ratification claim. Preserve the run and
its evidence for reconciliation.

### 17. Exercise post-completion G1, G2, and G3

Use the owner account's **Human controls** tab:

1. Before assignments, verify no G1/G2/G3 decision exists and G3 is locked.
2. Temporarily assign pending G1 to the registered future G2 account. As that account, require the exact-package JSON grant and header-only gateway download to succeed, while the still-unassigned future G1 account gets the non-disclosing denial.
3. Retain one unexpired grant only for this revocation check. As owner, replace that still-pending G1 assignment with the registered assessor, supplying the required reason. Both a new Netlify artifact request and the previously minted gateway capability from the superseded account must now receive the non-disclosing denial even though the capability is younger than 60 seconds. This is the live revocation proof; the original assignment and supersession audit must remain visible and immutable.
4. Assign G2 to that now-independent future G2 account. It may access only the exact package again. Attempt to replace G2 with the active G1 account; require rejection and retain the valid independent assignment.
5. Sign in as G2 before G1 completes. The frozen scope may be visible, but submission must be locked.
6. Sign in as G1, review **every** displayed machine-filled row, explicitly approve each row, check the human/role affirmation, and record the immutable G1 decision.
7. Reopen the completed G1 link. It must be read-only. The owner must not be able to replace the completed identity.
8. Sign in as G2, independently review every row in its frozen protocol scope, affirm the human role, and record G2. It must be a different authenticated user from G1.
9. Sign in as the owner. G3 must now unlock. Check all seven QC affirmations and record the named/dated country-owner decision.
10. Verify a versioned release record appears and the original Stage 8 Draft downloads remain unchanged.
11. Because the methodology is unratified, require the label `Approved Draft release`, never `Canonical Final release`.

The live UI proves the intended journey. The repository regression suite remains the evidence for forged automated actors, cross-bundle replay, transaction races, and database-level immutable trigger cases that should not be manufactured manually in shared staging.

### 18. Audit, immutability probe, and closeout

In Neon SQL Editor, substitute the captured package ID:

```sql
select p.id as package_id,
       p.run_id,
       p.artifact_set_id,
       p.bundle_sha256,
       p.workflow_version,
       p.workflow_contract_sha256,
       p.damm_model_version,
       p.damm_model_revision,
       p.damm_model_status,
       p.damm_model_ratified,
       p.damm_model_sha256,
       p.damm_source_commit,
       p.assessment_input_sha256,
       d.gate,
       d.actor_kind,
       d.reviewer_user_id,
       d.reviewer_name,
       d.reviewer_email,
       d.declared_role,
       d.decision,
       d.decided_at,
       r.id as release_id,
       r.lifecycle,
       r.external_circulation_authorized,
       r.manifest_sha256
from workflow_approval_packages p
left join workflow_approval_decisions d on d.package_id = p.id
left join workflow_approval_releases r on r.package_id = p.id
where p.id = '<PACKAGE_ID>'
order by d.decided_at;
```

Require three `actor_kind = 'human'` decisions, distinct G1/G2 user IDs, G3 equal to the package owner, identical package/bundle identity across all rows, `damm_model_ratified = false`, and release lifecycle `approved_draft`.

Also verify the live access-revocation probe left an append-only assignment trail:

```sql
select a.id,
       a.package_id,
       a.target_identity_sha256,
       a.gate,
       a.reviewer_user_id,
       a.reviewer_name,
       a.declared_role,
       a.active,
       a.assigned_at,
       s.superseding_assignment_id,
       s.target_identity_sha256 as supersession_target_identity_sha256,
       s.revoked_by_user_id,
       s.reason,
       s.revoked_at
from workflow_approval_assignments a
left join workflow_approval_assignment_supersessions s
  on s.revoked_assignment_id = a.id
where a.package_id = '<PACKAGE_ID>'
order by a.assigned_at;
```

Require one inactive temporary G1 assignment with exactly one supersession row, one active completed G1 assignment for the intended assessor, and one active completed G2 assignment for the independent reviewer. The superseding identity and package target must match the same immutable package; no old assignment may remain active.

This zero-persistence probe proves a completed decision identity cannot be updated. The inner exception creates a subtransaction, and the immutable trigger rolls the attempted update back:

```sql
do $$
begin
  begin
    update workflow_approval_decisions
       set reviewer_name = reviewer_name || ' altered'
     where id = '<G1_DECISION_ID>';
    raise exception 'immutability probe unexpectedly succeeded';
  exception
    when others then
      if sqlerrm not like '%immutable%' then
        raise;
      end if;
  end;
end
$$;
```

Re-run the audit query and require the exact original name and row count. Do not run ad hoc insert/delete “tests” against shared staging.

Finally record the Netlify deploy ID/commit, separate Render worker and artifact-gateway deploy IDs/commits, Neon project/branch/snapshot, workflow/package identity, decision IDs, release ID, validation results, and UTC completion time. Retain the pre-migration snapshot until the staging acceptance record is approved.

## Rollback order

Rollback is a human incident procedure, not a wizard automation.

1. Prevent new launches: lock the current Netlify deploy or stop publishing/builds.
2. Let any active workflow finish if safe. If it is unsafe to continue, record the incident before canceling; never disguise a forced stop as completion.
3. Suspend `dar-studio-worker` and `dar-studio-artifacts` in Render and confirm no worker is connected or claiming runs and no download is active.
4. Publish the prior known-good Netlify deploy from **Deploys > successful deploy > Publish Deploy**, then lock it so a Git push does not immediately overwrite the rollback.
5. Only if the database must be restored, use Neon **Backup & Restore** with the recorded snapshot. A restore can discard all post-snapshot accounts, runs, artifacts, and approvals; obtain explicit authorization and export the incident evidence first.
6. Reapply the matching application/database version, verify migrations, then resume the worker and unlock Netlify in that order.

Never restore Neon while either web writes or the worker are active. Never delete the Render disk, Neon project/branch, snapshot, Netlify project, or approval records as an ordinary rollback step.

## What the wizard automates and what remains human

| Wizard automates                                                                            | Wizard only instructs/records                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| clean-main and required-file checks                                                         | merging the pull request                          |
| local validation command sequence                                                           | approving cloud/vendor charges                    |
| secure generation of `DAR_KEY_SECRET`, `BETTER_AUTH_SECRET`, and `ARTIFACT_DELIVERY_SECRET` | creating provider accounts/projects and API keys  |
| hidden secret input and mode-`0600` ignored operator file                                   | OAuth client registration                         |
| URL/hostname/Ohio/pooler/commit format validation                                           | Neon snapshot creation or restore                 |
| exact dashboard links, SQL, callbacks, scopes, and stop conditions                          | clicking Deploy Blueprint or publishing Netlify   |
| an explicitly confirmed local migration using the direct URL                                | setting secrets in Netlify/Render dashboards      |
| captured deployment and smoke identity metadata                                             | spending vendor budget and launching the workflow |
| ordered smoke and immutable-audit checklist                                                 | performing G1/G2/G3 human judgments               |

The wizard deliberately does not call GitHub secret APIs. It also never runs end to end unattended: cloud state, cost, identity, and human review boundaries require the named operator to inspect and confirm them.
