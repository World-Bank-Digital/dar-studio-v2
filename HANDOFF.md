# HANDOFF — DAR Studio v2

*Session handoff, updated 2026-08-17 (late). Read this top to bottom before
changing anything; read [LEARNINGS.md](LEARNINGS.md) before touching the
retrieval, scoring or drafting layers.*

## What this is

A working prototype of the DAMM v1.3 methodology that produces a Digital
Agriculture Roadmap: 97 indicators, three read-outs (CMS/EMS/OES), 13 core
gates, an 8-step decision ladder, a 17-chapter + 11-annex draft. Originally
generated in Grok's App Builder sandbox, substantially rebuilt since.
`docs/TTL-GUIDE.md` is the user-facing field guide; `LEARNINGS.md` is the
defect ledger (L1–L18 + design shifts D1/D2); the methodology deck regenerates
via `node scripts/build-methodology-deck.mjs`.

**Repo state:** branch `rebuild/byok-delivery-2026-08`, HEAD `c4e6d9c`, pushed
to `github.com/rsudan/dar-studio-v2`. `main` still holds only the original
import commit `84a0c9d` — merging is the user's call and has not been asked
for. 240 unit tests, clean typecheck/lint/production build at HEAD.

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

Everything works end to end, but the machine still fills too little. Live
Egypt runs: baseline 23/97 levelled → run 3: 28 (11 rubric proposals, 0
quantitative) → run 4 (post-L18, stricter validation): 25 (7 proposals, 1
quantitative accepted, 3 rejected — funnel finally instrumented). Diagnosed
causes each round are in LEARNINGS L17/L18. Round-2 fixes are at HEAD:
short country names in queries ("Egypt", not "Egypt, Arab Rep."), unstuffed
2–5-word rubric queries, document labels that can't bleed into indicator ids,
6 docs/rubric, anti-defensive prompt wording ("MUST propose if any document
evidences L2+").

**Run 5 verdict: DELIVERY PASS** (report
`qa-reports/delivery-2026-08-17T14-44-56-883Z.json`): 33/97 machine-levelled
(+43% over baseline), 10 rubric proposals incl. three documentary core gates
(4.1, 4.5, 5.7 at L3), 15/17 chapters with model prose, fidelity gate active,
full 17+11 draft pre-human, stage withheld throughout. Quantitative extraction
remains the weakest link (2 accepted / 9 batches) and 3.3 farmer registry
still resists retrieval after three runs. The untested levers are:
(a) **Exa instead of Jina** for retrieval (real `includeDomains` list, better
content extraction — the user has no Exa key yet; ask before assuming);
(b) a **non-reasoning extraction model** (DeepSeek burns budget on
chain-of-thought and returns defensively; the audit's "reasoning tokens"
diagnosis message identifies this); (c) two-pass rubric research (find docs →
separate assess call per level clause).

## Other open threads, in rough priority order

1. **Fill rate** — pick a lever from the section above (Exa needs the
   user's go-ahead first); 3.3 farmer registry is the acid test.
2. **Chapters 11 (Target Architecture) and 13 (Governance/Delivery)** still
   use the generic decision-restating builder — they need bespoke builders.
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
