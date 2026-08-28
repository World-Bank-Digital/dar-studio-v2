# Netlify + Neon + Render (Ohio) deployment runbook

This runbook provisions a **staging** DAR Studio deployment with:

- the TanStack Start web application on Netlify Functions in `cmh` (US East, Ohio);
- PostgreSQL on Neon AWS `aws-us-east-2` (Ohio); and
- one persistent Render background worker and one stateless artifact gateway in `ohio`.

Run the companion wizard from a clean checkout of the merged `main` branch:

```bash
ENV_FILE=.env.staging ./scripts/deploy/netlify-neon-render-ohio.sh
```

The wizard opens the right dashboards, captures values without echoing secrets, and stops at every mutation, cost, or safety boundary. It does not create cloud resources, purchase plans, register OAuth clients, publish a Blueprint, restore a database, or make a human approval decision for you.

## Readiness verdict and non-negotiable blockers

This topology is not ready merely because the web build and worker start. Do not call it production-ready until every stop condition in this guide is clear.

1. **Large Stage 8 downloads use the Ohio Render gateway, not a Netlify response.** DAR Studio permits a 250 MB complete bundle, 50 MB individual artifacts, and 400 MB total artifact set. Netlify Functions allow 6 MB buffered responses and 20 MB streamed responses. Netlify therefore authorizes the signed-in owner or exact active package reviewer and returns a no-store JSON grant containing a 60-second capability bound to run/artifact-set/key/SHA-256, authenticated subject, and—when applicable—the exact active reviewer assignment. The browser sends that capability only in the `Authorization` header to the fixed `dar-studio-artifacts` endpoint; it never appears in a URL. The gateway revalidates live access in Neon, retrieves the exact currently published row, checks the stored size and SHA-256 against the actual immutable bytes, and streams bounded chunks with `private, no-store`. The repository suite deterministically streams and hashes a synthetic artifact larger than 20 MiB without committing a large fixture; the live smoke separately proves the deployed JSON-grant, CORS, authorization, and byte path with a real immutable artifact. Health, exact-origin CORS, non-disclosing invalid-token behavior, live assignment revocation, and both proofs are hard acceptance gates. A Render worker disk alone is not a download gateway.
2. **Hosted database configuration must fail closed.** On Netlify, a missing or blank `DATABASE_URL` must never select the ephemeral PGLite fallback. A production or preview deployment without its intended database must fail before serving a usable application.
3. **Deploy Previews must not share staging secrets.** `DATABASE_URL`, authentication secrets, encryption keys, email credentials, and platform AI keys belong only to the production deploy context of this staging project. Disable Deploy Previews and branch deploys. The committed build preflight additionally requires Netlify `CONTEXT=production` and `BRANCH=main`, so a preview or branch build fails even if secrets were scoped incorrectly. A preview that can read or write the staging database is a hard stop.
4. **Deployed social sign-in must be honest.** The baked Grok preview OAuth client accepts only `*.grok-sandbox.com` callbacks. It is not a Netlify credential. Either register a per-app broker client with the two exact callbacks in this guide, or use a committed deployment mode that keeps email/password auth enabled while hiding Google and X. `VITE_AUTH_ENABLED=false` is not an email-only mode: with a hosted database it intentionally fails closed, and without that guard it would collapse users into the shared development identity.
5. **Public self-sign-up exposes platform spend.** A registered user can create a country and launch the country-only autonomous workflow, which consumes the worker's platform vendor keys. Keep the staging Netlify project Private unless an application-level invitation/launch authorization and abuse controls have been implemented. Use one authorized Netlify member session to switch among the three application test identities, or invite each intended reviewer through Netlify on a plan that supports it.
6. **Migration 0013 precedes Render.** Take a Neon recovery snapshot, prove there are no active workflows, run migrations with the direct Neon connection, verify exactly one migration ledger row for `0013_damm_methodology_pin_cutover.sql`, and only then deploy the Render worker and artifact gateway. Neither Render service runs migrations.
7. **An automated success is still a Draft.** The completed eight-stage package must say `Draft · pre-review`. Automated derivation, vendor challenge, and machine QC must not create G1 or G2 decisions. A release remains an `Approved Draft release` while DAMM is unratified.

Relevant platform documentation:

- [Netlify: import an existing Git repository](https://docs.netlify.com/welcome/add-new-site/)
- [Netlify: Functions configuration, regions, and limits](https://docs.netlify.com/build/functions/configuration/)
- [Netlify: environment variables](https://docs.netlify.com/build/environment-variables/get-started/)
- [Netlify: Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)
- [Netlify: project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
- [Neon: create and manage projects](https://neon.com/docs/manage/projects)
- [Neon: pooled connection strings](https://neon.com/docs/connect/connection-pooling)
- [Neon: snapshots are created from root branches](https://neon.com/docs/changelog/2025-10-17)
- [Render: create a Blueprint](https://render.com/docs/infrastructure-as-code)
- [Render: Blueprint fields and `sync: false` secrets](https://render.com/docs/blueprint-spec)
- [Render: environment variables](https://render.com/docs/configure-environment-variables)
- [Render: regions](https://render.com/docs/regions)
- [Render: graceful shutdown](https://render.com/docs/deploys#graceful-shutdown)
- [Render: persistent-disk limitations](https://render.com/docs/disks#disk-limitations-and-considerations)

## Data flow and ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| Netlify web | browser UI, same-origin Better Auth endpoints, authenticated server functions, exact-package artifact authorization and no-store 60-second grant issuance | long-running workflow execution, preview access to staging secrets, large artifact proxying beyond Function limits |
| Neon `production` branch | users/sessions, countries, run queue, immutable artifact bytes and hashes, approval/audit/release rows | vendor API keys, build credentials |
| Render worker | queue polling, pinned DAMM checkout, Python environment, in-progress workflow workspace on its disk | G1/G2/G3 decisions, Final/publication claims, public web traffic |
| Render artifact gateway | `/healthz` and fixed `/v1/artifacts`; exact-origin CORS, header-only capability verification, live owner/assignment authorization, immutable Neon byte verification, and chunked HTTPS delivery | user sessions, workflow launch, human decisions, a persistent disk, bearer values in URLs, unsigned or long-lived download URLs |
| Render persistent disk | pinned runtime checkout and resumable in-progress worker files | the only copy of completed Stage 8 artifacts; published artifacts must be hash-verified in Neon |
| Human reviewers | authenticated G1/G2/G3 decisions after Stage 8 | automated execution, vendor review, or machine QC represented as a human gate |

The Neon project is named for staging, but its **root `production` branch** is the staging database for this separate project. Neon creates `production` and `development` by default. Use `production` because manual snapshots are supported only for a root branch; do not point this staging deployment at a different Neon production project.

## Captured values and destinations

The wizard writes an ignored, mode-`0600` operator file. Never commit it. In the classification column, **secret** means credential material; **confidential/non-secret** means PII or operational metadata that should still be restricted; and **public/non-secret** includes configuration, identifiers, status, and integrity hashes that are not credentials. “Public” does not mean an operational identifier should be advertised.

| Value | Source | Destination | Classification |
| --- | --- | --- | --- |
| `DEPLOY_GIT_SHA` | merged `origin/main` | local deployment record; compare with Netlify and Render deploys | integrity evidence |
| `NEON_PROJECT_NAME` | operator, recommended `dar-studio-staging` | Neon project name; local record | public configuration |
| `NEON_PROJECT_ID` | Neon Project settings | local record | public identifier |
| `NEON_REGION` | fixed `aws-us-east-2` | Neon project; local record | public configuration |
| `NEON_BRANCH` | fixed `production` | Neon Connect/SQL Editor; local record | public configuration |
| `NEON_BRANCH_ID` | Neon Branches | local record | public identifier |
| `NEON_DATABASE_NAME`, `NEON_ROLE_NAME` | Neon Connect panel | both connection-string selections and local record | public configuration identifiers |
| `DATABASE_URL` | Neon **pooled** Connect string (`-pooler`) | Netlify Production/Builds and Functions; both Render services; local operator file | secret |
| `MIGRATION_DATABASE_URL` / local `DATABASE_URL_DIRECT` | Neon direct Connect string (no `-pooler`) | Netlify Production/Builds only and local migration | secret |
| `NEON_SNAPSHOT_NAME` | Neon Backup & Restore | local recovery record | confidential operational metadata |
| `MIGRATION_0013_VERIFIED` | exact Neon ledger/function checks | local deployment record | integrity evidence; fixed `true` only after verification |
| `DAR_KEY_SECRET` | generated locally, 48 random bytes encoded as base64 | Netlify Production/Builds and Functions | secret; keep stable or stored BYOK values become unreadable |
| `BETTER_AUTH_SECRET` | generated locally, 48 random bytes encoded as base64 | Netlify Production/Builds and Functions | secret; keep stable or sessions are invalidated |
| `BETTER_AUTH_URL` | fixed Netlify production URL | Netlify Production/Builds and Functions | public configuration; full `https://` URL, no trailing slash |
| `VITE_PUBLIC_HOSTNAME` | Netlify production domain | Netlify Production/Builds | public configuration; bare hostname only |
| `VITE_AUTH_ENABLED` | fixed `true` | Netlify Production/Builds and Functions | public configuration |
| `VITE_GROK_AUTH_ENABLED` | `true` only with per-app broker credentials; otherwise `false` for email/password-only staging | Netlify Production/Builds and Functions | public configuration |
| `AUTH_MODE` | operator chooses `email` or `broker` | local deployment record; drives Netlify values | public configuration |
| `GROK_AUTH_ISSUER` | broker operator, normally `https://auth.grok.me` | Netlify Production/Builds and Functions | public configuration |
| `GROK_AUTH_CLIENT_ID` | broker operator | Netlify Production/Builds and Functions; local operator file | confidential identifier |
| `GROK_AUTH_CLIENT_SECRET` | broker operator | Netlify Production/Builds and Functions; local operator file | secret |
| `GROK_GOOGLE_CALLBACK_URL` | derived from Netlify URL | broker client's redirect allowlist; local record | public configuration |
| `GROK_X_CALLBACK_URL` | derived from Netlify URL | broker client's redirect allowlist; local record | public configuration |
| `DAR_ADMIN_EMAILS` | operator | optional Netlify Production/Functions value | confidential operational/PII configuration, not an authentication secret |
| `RESEND_API_KEY` | Resend dashboard | optional Netlify Production/Functions value | secret |
| `EMAIL_FROM` | verified Resend sender | optional Netlify Production/Functions value | public configuration |
| `XAI_API_KEY` | xAI console | optional Netlify Production/Functions platform key | secret |
| `ARTIFACT_DELIVERY_SECRET` | generated locally, 48 random bytes encoded as base64 | Netlify Production/Builds and Functions; Render artifact gateway | secret; the exact same stable value is required on both services |
| `ARTIFACT_GATEWAY_URL` | public Render `dar-studio-artifacts` origin | Netlify Production/Builds and Functions; local smoke record | public configuration; full HTTPS origin with no trailing path |
| `APP_ORIGIN` | exact Netlify production origin | Render artifact gateway | public configuration; full HTTPS origin with no trailing path; must equal `BETTER_AUTH_URL` |
| `EXA_API_KEY` | [Exa API keys](https://dashboard.exa.ai/api-keys) | Render worker; local operator file | secret |
| `JINA_API_KEY` | [Jina key manager](https://jina.ai/api-dashboard/key-manager) | Render worker; local operator file | secret |
| `PERPLEXITY_API_KEY` | [Perplexity API](https://docs.perplexity.ai/docs/getting-started/quickstart) | Render worker; local operator file | secret |
| `ANTHROPIC_API_KEY` | Anthropic Console, Settings > API keys | Render worker; local operator file | secret |
| `OPENAI_API_KEY` | [OpenAI API keys](https://platform.openai.com/api-keys) | Render worker; local operator file | secret |
| `GEMINI_API_KEY` | [Google AI Studio API keys](https://aistudio.google.com/app/apikey) | Render worker vendor preflight; local operator file | secret |
| `NETLIFY_PROJECT_SLUG` | Netlify project creation | production hostname and local record | public identifier |
| `NETLIFY_SITE_ID` | Project configuration > General > Project information | local record | public identifier |
| `NETLIFY_URL` | Domain management > Production domains | auth base URL, smoke tests, local record | public configuration |
| `NETLIFY_FUNCTION_REGION`, `NETLIFY_DEPLOY_PREVIEWS`, `NETLIFY_PROJECT_VISIBILITY` | verified Netlify settings | local deployment record | public configuration; fixed `cmh`, `disabled`, `private` |
| `NETLIFY_ENVIRONMENT_VERIFIED` | exact Production context/scope review | local deployment record | integrity evidence; fixed `true` only after review |
| `NETLIFY_DEPLOY_ID`, `NETLIFY_DEPLOY_SHA` | successful production deploy details | local deployment record and commit comparison | confidential operational ID and integrity evidence |
| `RENDER_BLUEPRINT_ID` | Render Blueprint Settings/URL | local record | public identifier |
| `RENDER_BLUEPRINT_AUTO_SYNC` | verified Blueprint Settings | local deployment record | public configuration; fixed `disabled` |
| `RENDER_WORKER_SERVICE_ID` | Render worker Settings/URL | local record | public identifier |
| `RENDER_ARTIFACT_SERVICE_ID` | Render gateway Settings/URL | local record | public identifier |
| `RENDER_WORKER_DEPLOY_ID`, `RENDER_WORKER_DEPLOY_SHA` | successful worker deploy details | local deployment record and commit comparison | confidential operational ID and integrity evidence |
| `RENDER_ARTIFACT_DEPLOY_ID`, `RENDER_ARTIFACT_DEPLOY_SHA` | successful gateway deploy details | local deployment record and commit comparison | confidential operational ID and integrity evidence |
| `DAMM_PIPELINE_DIR` | worker entrypoint, `/var/data/checkouts/<pinned-commit>` | Render worker runtime | public configuration |
| `DAMM_PIPELINE_PYTHON` | fixed `/opt/damm-venv/bin/python` | Render worker runtime | public configuration |
| Render disk | `dar-studio-worker-data`, mount `/var/data`, 10 GB | Render worker only | billed infrastructure configuration |
| `SMOKE_OWNER_NAME`, `SMOKE_OWNER_EMAIL`, `SMOKE_G1_NAME`, `SMOKE_G1_EMAIL`, `SMOKE_G2_NAME`, `SMOKE_G2_EMAIL` | three operator-controlled test accounts | Better Auth/Neon and local record | confidential PII |
| smoke identity passwords | generated by operator | Better Auth and the operator's password manager; the wizard does not capture them | secret |
| `SMOKE_COUNTRY_ID`, `SMOKE_RUN_ID`, `SMOKE_ARTIFACT_SET_ID` | completed workflow/UI or Neon | local verification record | confidential operational identifiers |
| `SMOKE_BUNDLE_SHA256`, `SMOKE_WORKFLOW_CONTRACT_SHA256`, `SMOKE_DAMM_MODEL_SHA256`, `SMOKE_ASSESSMENT_INPUT_SHA256` | completed workflow/package or Neon | local verification record | integrity evidence |
| `SMOKE_BUNDLE_BYTES`, `SMOKE_GATEWAY_ARTIFACT_BYTES`, `SMOKE_LIVE_OVER_20_MIB` | verified downloads | local verification record; largest real gateway artifact plus whether it naturally exceeded 20 MiB | integrity evidence |
| `SMOKE_PACKAGE_ID`, `SMOKE_TARGET_IDENTITY_SHA256` | Human controls UI or Neon | local verification record | confidential operational ID and integrity evidence |
| `SMOKE_G1_DECISION_ID`, `SMOKE_G2_DECISION_ID`, `SMOKE_G3_DECISION_ID`, `SMOKE_RELEASE_ID` | Human controls UI or Neon | local verification record | confidential audit identifiers |
| `DEPLOYMENT_ENVIRONMENT`, `DEPLOYMENT_READINESS_STATUS`, `DEPLOYMENT_ACCEPTED_AT_UTC` | fixed staging mode and final operator confirmation/time | local deployment record | public status and integrity evidence |

Do not put any of these values in GitHub Actions secrets unless a later, reviewed CI workflow explicitly consumes them. This deployment has no need to copy cloud runtime secrets into GitHub.

## Stage-by-stage procedure

### 1. Merge and local preflight

1. Merge the deployment-readiness pull request to `main`.
2. In the repository run `git fetch origin main`, check out `main`, and fast-forward it.
3. Require a clean worktree and `HEAD == origin/main`.
4. Confirm the merged tree contains `netlify.toml`, `render.yaml`, both `Dockerfile.worker` and `Dockerfile.artifact-gateway`, the worker entrypoint/preflight files, `deploy/artifact-gateway/package.json` and its lockfile, `scripts/artifact-gateway.ts`, migration `0013_damm_methodology_pin_cutover.sql`, and this runbook.
5. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:dev`, and `npm run verify:netlify`. The last command exercises the committed Netlify adapter wrapper and PWA route/output contract without using the production build command.
6. Inspect the production build command. It must not silently run migrations against a preview database. This runbook applies migrations explicitly with `DATABASE_URL_DIRECT`.

Stop if any validation fails, if a generated manifest changes, if the canonical eight-stage manifest changes unexpectedly, or if the white-background regression contract changes.

### 2. Confirm accounts, billing, and spend authority

Before creating anything, verify access to Netlify, Neon, Render, GitHub, Exa, Jina, Perplexity, Anthropic, OpenAI, and Google AI Studio. Both Render `1c-2g` services and the worker's persistent disk are billed. Vendor smoke checks and a full eight-stage workflow consume paid API calls. Record explicit authorization for those staging costs.

Stop if the operator cannot view billing/usage, cannot rotate a key, or does not have authority to incur the costs.

### 3. Capture worker vendor secrets

Create or retrieve all six worker keys. The canonical workflow currently uses Exa, Jina, Perplexity, Anthropic, and OpenAI; Gemini is also required by the full live-vendor preflight and preserves the configured fallback surface. These are operator-provisioned platform credentials so the product can honor “country is the only required launch input.”

The Render Blueprint declares the keys with `sync: false`. Render prompts for such values only on initial Blueprint creation. If one is missed, add it later at **Service > Environment > Environment Variables > + Add Environment Variable**, then select **Save, rebuild, and deploy**.

Never bake a key into the Docker image, `render.yaml`, an image build argument, or `/opt/damm/.env`. The entrypoint creates a blank mode-`0600` upstream `.env` only because the pinned DAMM loader requires the file to exist; the actual values remain process environment variables.

The worker installs production dependencies only. `pptxgenjs` remains available to repository development tooling but is classified as dev-only because the application has no production import of it; excluding its unused transitive graph from the worker image is deliberate deployment hardening, not a product-feature change.

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

Then go to **Backup & Restore**, enable **Enhanced view** if shown, make sure the root `production` branch is selected, and click **Create snapshot**. Name it with UTC date/time and the pre-migration commit, for example `pre-0013-2026-08-28-833ef447`. Capture the snapshot name. Snapshots are only offered on root branches and plan limits apply.

Stop if there is an active workflow, snapshot creation fails, the snapshot limit is exhausted, or the snapshot is for another branch.

### 7. Apply and verify migrations, including 0013

Only after the snapshot, run from the clean merged checkout:

```bash
DATABASE_URL="$DATABASE_URL" MIGRATION_DATABASE_URL="$DATABASE_URL_DIRECT" npm run db:migrate
```

The migrator applies sorted SQL files one at a time, each in its own transaction, and records the filename in `_migrations`. A failure rolls back that file. If migration 0013 reports:

> Cannot install the current DAMM methodology pin while stale or missing-pin workflows are active; allow them to finish and retry the deployment.

do exactly that. Do not edit the ledger, terminate a run, or weaken the guard to force the deployment.

Verify in Neon SQL Editor:

```sql
select name, applied_at
from _migrations
where name = '0013_damm_methodology_pin_cutover.sql';
```

Require exactly one row. Also verify that the installed function retains the unratified identity and pinned DAMM commit:

```sql
select pg_get_functiondef('require_active_workflow_methodology()'::regprocedure)
  like '%92c6ffe8b331347bc05f345785fe409753401a24%' as pinned_commit,
       pg_get_functiondef('require_active_workflow_methodology()'::regprocedure)
  like '%methodology.model_ratified = false%' as remains_unratified;
```

Require both values to be `true`. Keep the pre-migration snapshot through the entire smoke test.

### 8. Create the Netlify project

Dashboard path: **Netlify team > Projects > Add new project > Import an existing project > GitHub**.

1. Select the exact `dar-studio-v2` repository.
2. Set the production branch to `main`.
3. Use the build command and publish directory committed in `netlify.toml`; do not replace them with remembered Vercel settings.
4. Choose an unambiguous slug such as `dar-studio-staging` and capture the resulting `https://<slug>.netlify.app` URL.
5. Capture the site ID from **Project configuration > General > Project information**.

If Netlify attempts a deploy before environment variables exist, the hosted application must fail closed. That failed first deploy is not a smoke pass. Never accept a live PGLite-backed staging site.

### 9. Pin Netlify region, contexts, and visibility

1. Go to **Project configuration > Build & deploy > Continuous deployment > Functions region**. Confirm `cmh` / **US East (Ohio)**. New projects default to `cmh`; changing it is a Pro/Enterprise feature. Redeploy after any change.
2. Go to **Project configuration > Build & deploy > Continuous Deployment > Branches and deploy contexts > Configure**. Keep production branch `main`, set **Branch deploys: None**, and disable **Deploy Previews**.
3. Go to **Project configuration > General > Visitor access > Project visibility** and keep staging **Private**. Confirm the operator can still exercise all three application identities. Do not make it public merely to simplify a review link.

Stop if Functions are not in Ohio, a preview receives production environment variables, a non-main branch can publish, or intended reviewers cannot reach the private project.

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

### 11. Create both Render Ohio services from the Blueprint

Do this only after migration verification.

Dashboard path: **Render Dashboard > New > Blueprint > Connect** the exact repository.

1. Name the Blueprint clearly, select branch `main`, and keep Blueprint path `render.yaml`.
2. Review `dar-studio-worker`: `type: worker`, `runtime: docker`, `region: ohio`, plan `1c-2g`, `dockerfilePath: ./Dockerfile.worker`, one instance, `autoDeployTrigger: off`, and no `maxShutdownDelaySeconds` field.
3. Confirm its persistent disk is `dar-studio-worker-data`, mounted at `/var/data`, with 10 GB. Render's live semantic validator rejects a custom maximum shutdown delay on a service with a disk, so the worker uses Render's documented default 30-second shutdown window. Its graceful SIGTERM path, five-minute claim lease, and durable coordinator/workflow checkpoints let a replacement worker reclaim and resume a forced-off run. Keep Blueprint Auto Sync and service auto-deploy disabled, and never trigger a manual worker deploy while a workflow is active.
4. Review `dar-studio-artifacts`: `type: web`, `runtime: docker`, `region: ohio`, plan `1c-2g`, `dockerfilePath: ./Dockerfile.artifact-gateway`, one instance, `autoDeployTrigger: off`, `healthCheckPath: /healthz`, `maxShutdownDelaySeconds: 300`, and **no disk**.
5. At the initial `sync: false` prompts, give the worker `DATABASE_URL` (pooled) plus all six vendor keys. Give the gateway the same pooled `DATABASE_URL`, the generated `ARTIFACT_DELIVERY_SECRET`, and `APP_ORIGIN` set to the exact `NETLIFY_URL`/`BETTER_AUTH_URL`. Render supplies `PORT`.
6. Review both `1c-2g` service charges and the worker disk charge. Only then click **Deploy Blueprint**.
7. Capture the Blueprint ID, worker service ID, gateway service ID, and the gateway's public `https://<name>.onrender.com` origin.
8. In the created Blueprint open **Settings** and set **Auto Sync: No**. Both services also have `autoDeployTrigger: off` in `render.yaml`. Later Blueprint syncs and service deploys must be explicit, use the merged `main` commit, and occur only after the active-workflow query returns zero rows.

Render prompts for `sync: false` values only on initial creation. If a value is missed, use **Service > Environment > Environment Variables > + Add Environment Variable**, then **Save, rebuild, and deploy**. Stop before clicking Deploy Blueprint if either service's branch, region, type, plan, disk, instance count, commit, or secret list differs. Render cannot change a service's region in place.

### 12. Verify the worker and artifact gateway

For `dar-studio-worker`, open **Logs**. Require `[worker-checkout] installed DAMM <commit>` (or `reusing`) followed by `[worker-preflight] ready ...` and the existing `[worker] ...`, `[worker] pipeline ...`, `[worker] interpreter ...`, and `[worker] watching the run queue` lines. It must prove:

- the DAMM checkout is exactly commit `92c6ffe8b331347bc05f345785fe409753401a24`;
- its tracked tree is clean and prohibited untracked/ignored executable source is absent;
- the checkout lives under `/var/data/checkouts/<pinned-commit>`;
- Python is `/opt/damm-venv/bin/python`;
- Pandoc and LibreOffice/`soffice` are present for DOCX/PDF generation;
- all six required vendor variable names are nonempty and the pinned SDKs import without printing values (the full workflow smoke later proves live vendor authorization);
- the upstream root `.env` exists as a blank mode-`0600` compatibility file; and
- the worker is watching the Neon queue.

For `dar-studio-artifacts`, open `https://<gateway>.onrender.com/healthz`. Require status `200`, body `{"status":"ok"}`, and `Cache-Control: no-store`. Request fixed `/v1/artifacts` without the exact allowed Origin and header capability; require a non-disclosing `404` and `Not found.`. Its logs must show `[artifact-gateway] listening on 0.0.0.0:<PORT>` without a secret or database URL.

Capture each service's deploy ID and deployed commit. Both commits must equal `DEPLOY_GIT_SHA`. Any `[worker-checkout] failed:`, `[worker-preflight] failed:`, `[worker-entrypoint] failed:`, gateway startup/database failure, checkout drift, wrong commit, absent renderer, invalid health response, or repeated crash/restart is a hard stop. Do not launch a workflow to diagnose a failed preflight.

### 13. Set Netlify production-only environment variables

Dashboard path: **Project configuration > Environment variables > Add a variable**.

Apply every value only to the **Production** deploy context. Use the narrowest scope:

| Key | Scope | Required |
| --- | --- | --- |
| `DATABASE_URL` (pooled) | Builds and Functions | yes |
| `MIGRATION_DATABASE_URL` (direct) | Builds only | yes |
| `DAR_KEY_SECRET` | Builds and Functions | yes |
| `BETTER_AUTH_SECRET` | Builds and Functions | yes |
| `BETTER_AUTH_URL` | Builds and Functions | yes |
| `VITE_AUTH_ENABLED=true` | Builds and Functions | yes |
| `VITE_PUBLIC_HOSTNAME` | Builds | yes |
| `VITE_GROK_AUTH_ENABLED` | Builds and Functions | yes |
| `GROK_AUTH_ISSUER`, client ID, client secret | Builds and Functions | only for broker mode |
| `ARTIFACT_GATEWAY_URL`, `ARTIFACT_DELIVERY_SECRET` | Builds and Functions | yes |
| `DAR_ADMIN_EMAILS` | Functions | optional |
| `RESEND_API_KEY`, `EMAIL_FROM` | Functions | optional but required for real password-reset delivery |
| `XAI_API_KEY` | Functions | optional platform key |

Mark database URLs, encryption/auth secrets, OAuth client secrets, mail keys, and AI keys as **Contains secret values**. The direct URL is stored under `MIGRATION_DATABASE_URL`, never under the local-only name `DATABASE_URL_DIRECT`. Do not set either database URL for Deploy Preview, branch deploy, Preview Server, or local contexts. Netlify environment changes require a new deploy. The migrator must prefer `MIGRATION_DATABASE_URL`, take its deployment advisory lock, and leave the pooled URL for application runtime.

### 14. Deploy and verify the Netlify web application

Trigger a production deploy of the captured `DEPLOY_GIT_SHA`. Require:

- the deploy reports the exact merged `main` commit;
- build preflight accepts only `CONTEXT=production` and `BRANCH=main`; a deploy-preview, branch-deploy, dev, missing context, or missing/wrong branch must fail closed;
- build output comes from the committed Netlify adapter, not `.vercel` output;
- no migration is attempted during a preview build;
- `/` and `/methodology` load over HTTPS;
- `/login` offers email/password, and social buttons match the chosen auth mode;
- the committed preflight/database-fallback regression test (or the initial secretless failed build) proves a missing/invalid `DATABASE_URL` fails closed rather than opening a usable empty portfolio;
- all app-owned pages and loading/error/empty/dialog/review states keep the explicit white background; and
- the deployed Functions environment contains both artifact-gateway values. The first authenticated JSON-grant and header-only byte-delivery proof occurs in Stage 16 after a real artifact exists.

Do not re-enable previews on this staging project merely to prove isolation. Use the committed secretless preview preflight test, or a separately isolated disposable Netlify project with its own database if a live preview is later required. A preview that receives the staging Neon URLs or any staging secret is a hard stop.

### 15. Create three real staging identities

At `https://<slug>.netlify.app/login`, use **Need an account? Create one** to register three distinct names/emails/passwords:

1. the country owner / future G3 signer;
2. the named G1 assessor; and
3. the independent G2 reviewer.

Email verification is not required to sign in. Without `RESEND_API_KEY`, verification/reset messages are only logged, so do not claim password recovery works until Resend is configured and tested. Sign out and sign in as each identity. Do not reuse one account with different display names; G2 independence is bound to the authenticated user ID.

### 16. Run the autonomous eight-stage Draft smoke

Confirm the operator has authorized a full vendor-cost smoke. Sign in as the owner:

1. Select **New country** and choose one economy. Do not load a demo pack.
2. In **DAR workflow**, leave all optional upload categories empty for the country-only launch smoke. Separately test a small optional upload before launch if upload coverage is required.
3. Click **Launch Draft DAR workflow** once.
4. Verify all eight stages run end to end with no human input, pause, review gate, approval, or budget top-up.
5. Verify the terminal UI says `Draft · pre-review`, explicitly says automation is not G1/G2/G3, and keeps the package downloadable.
6. Download the complete bundle, Draft Markdown, DOCX, and PDF, cost-benefit XLSX, consolidated source inventory XLSX, workflow manifests, and representative artifacts from every stage. Verify filenames, nonzero length, content type, and SHA-256 where exposed.
7. Exercise the implemented gateway path with the largest real artifact from this run. In browser network tools, the authorized same-origin Netlify request must return `200`, `Cache-Control: no-store`, and media type `application/vnd.dar-studio.artifact-delivery+json`; its JSON endpoint must be the fixed HTTPS `/v1/artifacts` URL with no query/hash and must not contain the capability. The browser's cross-origin request must carry the capability only as `Authorization: Bearer`, send no cookies, and be accepted only from `APP_ORIGIN`. The gateway must return `200`, `private, no-store`, the attachment filename, `Content-Length`, `X-Content-SHA256`, and an exact body hash. Confirm no capability appears in browser URLs, copied download links, gateway access paths, or referrers. Require anonymous and unassigned callers to be denied at Netlify. Using an ephemeral request client that does not retain history, change one capability character and, separately, wait more than its 60-second lifetime before replaying an untouched capability in the header; both gateway requests must receive the same non-disclosing `404`. The mandatory repository regression already proves an exact >20 MiB 21-chunk stream plus wrong-package and changed-hash rejection. If this real run naturally produces an artifact larger than 20 MiB, record its successful live size/hash proof too; otherwise record the largest real artifact tested. Do not mutate immutable staging rows or distort the canonical country-only workflow to manufacture a larger file. A separate upload-backed live run may be authorized later if provider-level >20 MiB evidence is required.

Capture the run ID, artifact-set ID, bundle SHA-256, bundle byte count, workflow contract version/hash, DAMM version/revision/status/ratification flag/hash/source commit, and assessment-input hash.

Stop on any interactive workflow gate, failed stage, missing format, truncated/failed download, hash mismatch, worker restart that loses the run, `Final`/publication-ready wording, or a ratification claim.

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

| Wizard automates | Wizard only instructs/records |
| --- | --- |
| clean-main and required-file checks | merging the pull request |
| local validation command sequence | approving cloud/vendor charges |
| secure generation of `DAR_KEY_SECRET`, `BETTER_AUTH_SECRET`, and `ARTIFACT_DELIVERY_SECRET` | creating provider accounts/projects and API keys |
| hidden secret input and mode-`0600` ignored operator file | OAuth client registration |
| URL/hostname/Ohio/pooler/commit format validation | Neon snapshot creation or restore |
| exact dashboard links, SQL, callbacks, scopes, and stop conditions | clicking Deploy Blueprint or publishing Netlify |
| an explicitly confirmed local migration using the direct URL | setting secrets in Netlify/Render dashboards |
| captured deployment and smoke identity metadata | spending vendor budget and launching the workflow |
| ordered smoke and immutable-audit checklist | performing G1/G2/G3 human judgments |

The wizard deliberately does not call GitHub secret APIs. It also never runs end to end unattended: cloud state, cost, identity, and human review boundaries require the named operator to inspect and confirm them.
