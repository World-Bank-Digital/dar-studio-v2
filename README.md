# DAR Studio

An independent prototype for preparing a Digital Agriculture Roadmap. It collects
public evidence, computes the DAMM v1.3 maturity diagnostic exactly as specified,
and assembles a first draft.

**Machines compute. Humans gate.** No figure enters the evidence base without a
public source URL, and no maturity stage is claimable until a human has validated
the readings behind it. Not an official World Bank system, not a country ranking,
not a scoring service.

## Running locally

```bash
npm install
npm run dev
```

The app serves on `http://localhost:8080`. With no `DATABASE_URL` it uses an
embedded PGLite database, which is **ephemeral** — data is lost when the server
restarts. Set `DATABASE_URL` for anything you want to keep.

Copy `.env.example` to `.env` and fill in what you need.

```bash
npm run typecheck
npm run lint
npm test
npm run build      # what Vercel runs; must pass before deploying
```

## Bring your own key

Keys are entered on the **Settings** page, stored server-side, and shown only as
a fingerprint and last four characters.

**Drafting models** — Anthropic (Claude), OpenAI (GPT), Google (Gemini), xAI
(Grok), OpenRouter. The model id is editable and **Test** checks both the key and
the model id against the provider's own catalogue, so a newly released model can
be used the day it ships.

**Web search** — Exa or Jina, chosen independently of the drafting model. A
search key is what lets the studio fetch the actual page behind a statistic.

### Encryption at rest

Set `DAR_KEY_SECRET` to encrypt stored keys with AES-256-GCM:

```bash
openssl rand -base64 48
```

Without it the app still works but stores keys in the clear and says so plainly
on the Settings page. Keys written before the secret was set stay readable and
are re-encrypted the next time they are saved.

## Signing in

Three methods, honestly scoped:

- **Email/password** — works everywhere, instantly. Sign-up sends a
  verification email (see below); verification is not required to sign in.
- **Passkeys** — register one in **Settings → Passkeys**, then use "Sign in
  with a passkey" on the login page. Works on `localhost` (use `localhost`,
  not `127.0.0.1` — WebAuthn scopes keys to the exact host). A passkey
  registered locally will not follow the app to a deployed domain.
- **Google / X** — federate through the Grok auth broker and **cannot work on
  localhost**: the broker's preview client only accepts `*.grok-sandbox.com`
  callbacks and answers "Invalid redirect URI" otherwise. The login page says
  so instead of showing dead buttons. Deployed apps receive their own broker
  client and the buttons return.

Auth emails (signup verification, sign-in notifications) deliver via Resend
when `RESEND_API_KEY` is set in `.env`. Without it the app logs the full
message to the server console prefixed `[mailer:dev]` — the flow is testable,
and nothing pretends to have been sent. `npm run qa:auth` proves the passkey
round-trip end to end with a virtual authenticator.

## How evidence is collected

1. **Official statistical cascade.** World Bank WDI, Data360 and OWID series are
   fetched directly. This needs no key and covers the indicators those systems
   publish.
2. **Verified web search.** For the remaining quantitative gaps, the search
   provider retrieves the page *text*, and the drafting model extracts figures
   from that text only. Every extracted figure must quote its document, and the
   quotation is checked against the retrieved page before the reading is stored.
   Figures that cannot be located are dropped and logged — never downgraded.
3. **Human validation.** The documentary gates (farmer registry, data-governance
   framework, coordination mechanism, and the rest) have no international
   substitute by design. A human attaches a primary document or marks an explicit
   data gap. Nine of the thirteen core gates need this; the machine cannot and
   should not fill them.

Without a search key, steps 1 and 3 still run and the remaining gaps stay named.

## The readiness gate

Thirteen core gates must clear before the prescriptive chapters — the executive
summary and investment case, the opportunity portfolio, architecture, policy
actions, governance, financing, sequencing and results (chapters 1 and 10–16) —
will assemble: at least 11 of 13 populated, 60% of those graded A or
B, no silent gaps and no weak readings. Evidence is graded on authority,
definition fit, recency and disaggregation — and **any reading with no source URL
is capped at 39/100**, which is grade E.

The Bhutan demonstration pack ships fully cited and clears the gate, so the
unlocked chapters can be seen without running a full country collection.

## Draft fidelity

The deterministic assembler writes every chapter from engine facts. When a model
is configured it rewrites the connective prose — and that prose is then re-read
and **rejected if it contains a figure, year or maturity-stage claim the evidence
base does not hold**. Rejected prose is discarded, the deterministic text stands,
and the rejection is recorded in the audit log. The guarantee is enforced in
code, not requested in a prompt.

## QA

Playwright scripts under `scripts/` drive the app end to end. Screenshots go to
`<repo>/screenshots/` (override with `SCREENSHOT_DIR`).

```bash
npx playwright install chromium     # once
node scripts/browser-smoke.mjs http://127.0.0.1:8080/
npm run qa:delivery                 # the delivery gauntlet
```

`qa:delivery` is the end-to-end proof that the studio *delivers*: it signs in,
creates a country, runs the Step 1 diagnostic with the stored search and model
keys, clears the failing core gates through the evidence editor the way a human
assessor would, records ladder steps 2–8, and asserts that all 17 chapters and
11 annexes assemble with the prescriptive chapters unlocked. Each run writes a
comparable JSON report to `qa-reports/`.

## Learning ledger

Every defect found in a live run is folded back into the process as a code
fix, a regression test that pins it, and an entry in
[LEARNINGS.md](LEARNINGS.md) recording the root cause. A fix without a pinning
test is not considered landed. Read the ledger before changing the retrieval,
scoring or drafting layers — most of its entries are about silent failure
modes that type checks cannot catch.
