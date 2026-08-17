# HANDOFF — DAR Studio v2

*Session handoff, updated 2026-08-18 (early morning). Read this top to bottom
before changing anything; read [LEARNINGS.md](LEARNINGS.md) before touching
the retrieval, scoring or drafting layers.*

## What this is

A working prototype of the DAMM v1.3 methodology that produces a Digital
Agriculture Roadmap: 97 indicators, three read-outs (CMS/EMS/OES), 13 core
gates, an 8-step decision ladder, a 17-chapter + 11-annex draft. Originally
generated in Grok's App Builder sandbox, substantially rebuilt since.
`docs/TTL-GUIDE.md` is the user-facing field guide; `LEARNINGS.md` is the
defect ledger (L1–L18 + design shifts D1/D2); the methodology deck regenerates
via `node scripts/build-methodology-deck.mjs`.

**Repo state:** branch `rebuild/byok-delivery-2026-08`, pushed to
`github.com/rsudan/dar-studio-v2`. `main` still holds only the original
import commit `84a0c9d` — merging is the user's call and has not been asked
for. 275 unit tests, clean typecheck/lint/production build at HEAD. The
ledger now runs L1–L21 (L19 round-3 funnel levers, L20 the catalogue crash,
L21 the memory-quote diagnosis + foreign-government guard).

## Environment

- **Clone:** `~/Projects/dar-studio-v2`. Dev server: `npm run dev` (port 8080);
  prefer the `.claude/launch.json` entry `dar-studio-v2` via preview tools.
- **Database:** local Postgres 17 (brew service `postgresql@17`), DB
  `dar_studio`. Config in gitignored `.env`: `DATABASE_URL` +
  `DAR_KEY_SECRET` (AES-GCM master key for stored API keys).
- **Accounts/keys (keys are PER-USER):** everything lives on
  `dbcheck@example.com` / `TestPass123!` — the user's OpenRouter key (model
  `deepseek/deepseek-v4-pro`) and Jina search key, both encrypted at rest.
  QA signs in as this account.
- **QA loops:** `npm run qa:delivery` (end-to-end delivery proof; writes
  `qa-reports/*.json`), `npm run qa:auth` (passkey round-trip via CDP virtual
  authenticator — run against `localhost`, never `127.0.0.1`).
- **Auth:** email/password + passkeys work locally. Google/X buttons are
  structurally dead on localhost (broker rejects the redirect URI) and the
  login page says so. Auth emails are dev-logged (`[mailer:dev]` in server
  console) until `RESEND_API_KEY` is set in `.env`.

## Architecture decisions (user-made; do not relitigate)

1. **Draft-first (D1).** The ladder and readiness gauntlet do NOT gate
   drafting. One automated run → full DAR: evidence-health page, 17 chapters,
   11 annexes. Unrecorded decisions/unverified gates are stated conditions in
   the text; prescriptive chapters (1, 10–16) carry a CONDITIONS banner until
   the gauntlet clears (the banner is re-attached after model prose — L18).
   The engagement-package rule is untouched: no maturity stage claimable
   before Step 5 mandate + Step 6 validation.
2. **Rubric research (D2).** All 42 anchored rubrics are researched on the
   web. Proposals must be clause-mapped against anchor text, carry the
   negative finding (why not the next level up), cite quote-verified retrieved
   documents, and are stored as provisional `machine-researched` suggested
   levels (grade-capped at C in both graders until a human validates). L1 is
   unproposable — absence of evidence stays a named gap. The user's Egypt
   farmer-registry L4 assessment is the reference fixture (`rubric.test.ts`).
3. **Quantitative gaps are searched** (the 29 "local survey item" notes are
   routing hints, not stop signs); evidence quality is handled by grading,
   not refusal. Full strategy mode: prescriptive chapters recommend, in
   hypothesis → evidence → decision-gate form when evidence is thin.
4. **17 chapters + 11 annexes** per the user's master prompt §19
   (`src/lib/damm/outline.ts`, deliberately separate from `model_v1_3.json`).

## The open problem: machine fill rate

The trajectory across live Egypt runs: baseline 23/97 → run 3: 28 → run 4:
25 (funnel instrumented) → **run 5: 33** (round-2 query fixes) → run 6:
aborted (L20 catalogue crash at rubric 41/42; quantitative 4 accepted before
abort) → **run 7: 35** (round-3 levers: reasoning-off extraction, query
variants, citation repair — repair recovered 0 at the 4.5k window) →
**run 8: 43/97, DELIVERY PASS** (report
`qa-reports/delivery-2026-08-17T19-23-03-249Z.json`): 17 rubric proposals
(3 recovered by citation repair at the 9k window), 6 quantitative acceptances,
22 rubrics left named (was 31), 15/17 chapters with model prose, fidelity
gate active, stage withheld throughout. +87% over baseline.

**What settled where (details in L19–L21):** extraction runs with
chain-of-thought off (OpenRouter `reasoning: {enabled:false}`, visible
fallback); rubric search is multi-variant, open-web (NSO scope was the third
L4/L11 recurrence), foreign-government-filtered, with per-variant results
interleaved by rank; failed quotes were model memory, not misattribution —
the 9k quotable window plus one bounded repair call is what recovers them.

**The remaining levers, in order:**
1. **Exa key (user's call — ask, never assume).** Jina's ranking does not
   surface Egypt's own Farmer's Card pages for English registry phrasings;
   3.3 rejects honestly with a clean reading trail
   (`scripts/probe-rubric.ts 3.3` shows it in two minutes). Exa's real
   `includeDomains` (gov.eg, ministry hosts) plus neural ranking is the
   designed fix for exactly this shape.
2. **Official-language query variants.** The Farmer's Card is an Arabic-first
   programme; every query we send is English. A per-country translated
   variant (one cached model call to translate capability names) is generic
   and would likely crack 3.3 without any new key.
3. The residue: ~3 recurring memory-quotes (one case-study sentence the model
   keeps reciting), and one upstream "finish reason: error" per run —
   contained per-rubric, visible in pass summaries.

## Other open threads, in rough priority order

1. **Fill rate** — pick a lever from the section above (Exa needs the
   user's go-ahead first; the Arabic-variant lever needs no key); 3.3
   farmer registry remains the acid test, now with honest diagnostics.
2. **Chapters 11 (Target Architecture) and 13 (Governance/Delivery)** still
   use the generic decision-restating builder — they need bespoke builders.
   (13 is one of the two recurring fidelity rejections in every run.)
3. **Contradiction ledger (master prompt §3)** — Annex J is scaffolded,
   nothing populates it (detect conflicting claims across dossier/evidence).
4. **Merge to `main`** — user's call; suggest a PR when they're ready.
5. **Resend key** for real auth emails; **deck regen** after methodology-text
   changes (`node scripts/build-methodology-deck.mjs`, then QA slides).
6. The published TTL field-guide artifact
   (`https://claude.ai/code/artifact/79da53b7-7c75-49f9-bf5b-64161dd7df55`)
   tracks `docs/TTL-GUIDE.md` — republish with `url:` after guide changes.

## How to work here (the process IS the deliverable)

The user's standing directive: **all learning from the process becomes part
of the process.** Every live-run defect lands as (1) a fix to the cause,
(2) a regression test that pins it, (3) a LEARNINGS.md entry
(incident → root cause → fix → pin). A fix without a pinning test is not
landed. Silent successes get an assertion in `scripts/qa-delivery.mjs`.
Meta-lessons that recur: grep for a bug's siblings (L11, L14×2); zero
rejections from a gate means its input dried up (L17); a graceful fallback
needs an alarm (L13).

## Gotchas that will bite you

- **Never edit `src/` while a qa-delivery run is in flight** — Vite HMR
  split-brains the in-flight server closures (killed run 1's re-draft).
- **DeepSeek is a reasoning model:** any new chat call needs a large
  `maxTokens` (24k) and long timeout (360s), or you get HTTP 200 with empty
  content — and check `describeEmptyCompletion`'s audit message before
  guessing.
- `getByLabel(/^Notes$/)` breaks on rows with machine-researched notes (label
  wraps textarea content) — target `textarea` directly in Playwright.
- Background QA runs: launch with `run_in_background` + a Monitor tailing the
  log; **never** `node … | tee` (masks exit codes, L12).
- QA workspaces accumulate as duplicate "Egypt" cards — soft-delete after
  each run.
- `observation_year` on researched rows comes from cited documents'
  published year (may be null); do not stamp run dates (L18).
- The user prefers being asked before new external accounts/keys; keys are
  entered in the app's Settings UI, never pasted in chat.
- **Single-rubric live probe:** `node --env-file=.env scripts/probe-rubric.ts
  3.3` — two minutes, real keys, prints queries/hosts/proposal-or-rejection.
  Use it before spending a 70-minute delivery run on a retrieval question.
  It spends real Jina/OpenRouter quota; read-only against the DB.
- The QA harness ingest deadline is 90 min (`INGEST_DEADLINE_MS`); variants
  + repair lifted real ingest to ~47 min (run 8). If ingest architecture
  changes again, re-time before trusting a FAIL.
- QA workspaces are NOT auto-deleted by successor runs — soft-delete each
  run's Egypt card after reading its funnel (`update countries set
  deleted_at = now() where id = '…'`).
