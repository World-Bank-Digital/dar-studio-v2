# Learning Ledger

Every defect found in a live run becomes part of the process, permanently, as
three things: a **code fix**, a **regression test that pins it**, and an entry
here explaining the root cause so the same class of mistake is recognisable
next time. A fix without a pinning test is not considered landed.

The suite grew from 104 tests at import to 214 under this protocol.

## The protocol

When a run (manual, `qa:delivery`, or production) surfaces a failure:

1. Reproduce it, then fix the **cause**, not the symptom.
2. Add a test that fails on the old behaviour. Name the incident in a comment.
3. Record it below: incident → root cause → fix → pinning test.
4. If the failure was a *silent* success (the run "passed" while doing the
   wrong thing), also add an assertion to `scripts/qa-delivery.mjs` so the
   end-to-end loop would catch a recurrence.

## Ledger

### L1 — The demo pack failed its own readiness gate
**Incident:** the Bhutan showcase scored E·39 on all 13 core gates; the
flagship demo demonstrated failure.
**Root cause:** fixture rows shipped `sourceUrl: null`, and the evidence scorer
caps uncited readings at 39/100. The demo bypassed the citation validation the
UI enforces on humans.
**Fix:** `demoPackRows()` cites every populated row with the real publisher
(`fixture.ts`); values stay pinned to the scoring regression.
**Pinned by:** `fixture.test.ts` — "clears its own readiness gate".

### L2 — QA scripts hardcoded the build sandbox's paths
**Incident:** all eight Playwright scripts crashed outside Grok's sandbox
(`/workspace/screenshots/`).
**Root cause:** generated code assumed its birthplace was the world.
**Fix:** `scripts/qa-paths.mjs` derives paths from the repo root.
**Pinned by:** the scripts run in CI/dev at all; `browser-smoke` exits 0 locally.

### L3 — Search silently required one specific vendor
**Incident:** with a Claude key stored, web search did nothing, with no error.
**Root cause:** `resolveSearchKey` looked only for `provider = 'xai'`; absence
was treated as "feature off" rather than "misconfigured".
**Fix:** separate search-provider selection (Exa/Jina), plus audit entries and
ingest messages whenever a pass is skipped and why.
**Pinned by:** `search.test.ts` catalogue tests; skip-reasons asserted in audit.

### L4 — Jina's single-site scope was applied to every query
**Incident:** first live dossier sweep returned 22 of 27 items from CAPMAS;
"data protection law" was searched against the census bureau.
**Root cause:** Jina's `X-Site` header scopes to ONE host, and the NSO domain
was attached to all topics indiscriminately.
**Fix:** per-topic `preferNationalStats` flag — only statistical questions are
confined to the statistics office (`dossier.ts`).
**Pinned by:** `dossier.test.ts` — "dossier site scoping". Live re-run: 27
items/4 hosts → 61 items/44 hosts.

### L5 — Professional-network posts surfaced as citable sources
**Incident:** LinkedIn posts appeared alongside FAO and World Bank documents.
**Root cause:** the blocked-host list predated real search and never met one.
**Fix:** `linkedin.com` added to `BLOCKED_HOSTS`.
**Pinned by:** `search.test.ts` — "excluded hosts".

### L6 — A mistyped model id was accepted silently
**Incident:** `deepseek/v4-pro` stored and "tested" OK; the real id is
`deepseek/deepseek-v4-pro`. Every drafting call would have 404'd.
**Root cause:** the key test verified the key, not the model id, and no check
ran at save time.
**Fix:** `saveApiKey` now verifies the model id against the provider's own
catalogue on save and returns the warning immediately.
**Pinned by:** `providers.test.ts` catalogue-normalisation tests; save-time
verification path in `actions.ts`.

### L7 — A stored key did not make the feature work
**Incident:** keys entered and encrypted, yet the drafter ran as "none" —
storing and *activating* were separate, and the second step was easy to miss.
**Root cause:** UI design: a select defaulting to "Deterministic assembler
only" after a successful key save.
**Fix:** `saveApiKey` auto-activates the provider when nothing is active yet.
**Pinned by:** end-to-end — `qa:delivery` exercises drafting immediately after
key-based ingest; a stored-but-inactive key now cannot occur silently.

### L8 — The quote checker could be gamed by appending a clause
**Incident (caught in test, pre-live):** a genuine sentence with an invented
clause bolted on passed the sliding-window quote match.
**Root cause:** "some window matches" tolerates additions; the tolerance was
aimed at footnote markers but opened a fabrication path.
**Fix:** require ~85% of the quote as one unbroken run; strip `[n]` reference
markers in normalisation instead of loosening the threshold.
**Pinned by:** `search.test.ts` — "rejects a genuine sentence with an invented
clause bolted on" / "still tolerates a footnote marker".

### L9 — Serial prose generation could not survive the 17-chapter outline
**Incident (caught by inspection before the first full run):** up to 28
sequential model calls at ≤60 s each inside one HTTP request.
**Root cause:** the prose loop was written for a 10-part outline and scaled
linearly with document size.
**Fix:** bounded worker pool (`mapLimit`, concurrency 4) and **annexes are
never sent to the model** — they are the evidence record and stay verbatim.
**Pinned by:** `maplimit.test.ts` (order + concurrency bound) and
`outline.test.ts` — "allows model prose only on numbered chapters".

### L10 — The E2E suite certified failure as success
**Incident:** `qa-gauntlet.mjs`'s pass condition required `gauntletLocked` —
it could only ever prove the roadmap stayed locked.
**Root cause:** the test was written to validate the safety rails, and nobody
ever wrote the test for the product's actual purpose.
**Fix:** `scripts/qa-delivery.mjs` (`npm run qa:delivery`) asserts the full
delivery path: gates cleared, ladder recorded, 17 chapters + 11 annexes
drafted, prescriptive chapters unlocked, exports and persistence working. Each
run writes a comparable JSON report to `qa-reports/`.
**Pinned by:** itself — it is the pin.

### L11 — The retrieval pass repeated the dossier's over-scoping bug (first live delivery run)
**Incident:** the verified web-search pass accepted **0 readings** — 2 documents
across 8 batches, most Jina queries answered 422 "no results".
**Root cause:** three stacked problems. (1) `retrieveVerifiedReadings` scoped
*every* indicator query to the NSO domain — the exact bug fixed in the dossier
path as L4, recurring in the sibling path nobody re-checked. (2) Jina reports
an empty result set as HTTP 422, which the adapter recorded as a provider
error. (3) Queries carried registry notation verbatim — "(%)", "(Mbps)",
"climate-smart/sustainable" — which a literal search provider matches against.
**Fix:** `collectDocuments()` tries the NSO scope first and falls back to the
open web per indicator; 422 maps to an empty result; `cleanQueryTerm()` strips
unit notation. **Meta-lesson: when fixing a bug, grep for its siblings — a
class of mistake rarely has one instance.**
**Pinned by:** `retrieval.test.ts` — "scoped-then-open document collection" and
"query hygiene"; `search.test.ts` — "jina no-results handling".

### L12 — The E2E harness clicked links instead of rows, and masked its own exit code
**Incident:** run 1 died at gate 4.1 — the evidence editor never opened — and
the harness reported exit 0 anyway.
**Root cause:** Playwright clicks an element's centre; on evidence rows that
already carry a source hyperlink, the centre lands on the anchor, whose
`stopPropagation` swallows the click. Separately, `node … | tee` reports tee's
exit status, so the FAIL was invisible to the process supervisor.
**Fix:** click the id cell, never the row centre; invoke the script with its
own redirection instead of a pipeline (or `set -o pipefail`).
**Pinned by:** the comment at the click site in `qa-delivery.mjs`; the run-2
invocation pattern. The JSON report in `qa-reports/` is the source of truth
for pass/fail, not the shell exit code.

### L13 — Every prose call timed out, and the run still looked green (delivery run 2)
**Incident:** run 2 passed formally, but 16 of 17 chapter-prose calls timed out
at the adapter's 60s default; the draft shipped fully deterministic while the
report counted "1 chapter with prose" — which was the document header.
**Root cause:** (1) a timeout tuned for short verification calls applied to
4,000-token completions over a large facts block; (2) the harness metric
matched the model name anywhere, so the doc-level attribution masked a total
prose failure; (3) honest degradation without a floor turns "fallback" into
"norm" invisibly.
**Fix:** prose calls run with a 240s timeout; the metric counts per-chapter
attributions minus the header; the loop fails unless prose + fidelity
rejections reach a majority of chapters. **Meta-lesson: a graceful fallback
needs an alarm, or grace becomes the steady state.**
**Pinned by:** the threshold assertion in `qa-delivery.mjs`; timeout comment at
the `llmProse` call site.

### L14 — A reasoning model produced a full draft with zero prose and zero errors
**Incident:** with timeouts fixed, the re-draft "succeeded" in 5.5 minutes —
0 prose chapters, 0 rejections, 0 errors. A live probe reproduced it exactly:
`finish_reason: "length"`, `reasoning_tokens: 4000`, `contentChars: 0`.
**Root cause:** DeepSeek v4-pro is a reasoning model; the 4,000-token budget was
consumed entirely by chain-of-thought, the API returned HTTP 200 with empty
visible content, and `openAiText` treated the empty string as valid text, which
the caller skipped silently.
**Fix:** prose budget raised to 12,000 tokens; empty completions are now
returned as errors with the diagnosis in the message
(`describeEmptyCompletion`), so the audit trail names the cause. **Meta-lesson:
an HTTP 200 is not a success — define success by the artefact, and make every
non-artefact outcome speak.**
**Pinned by:** `providers.test.ts` — "empty completions".
**Follow-up (retest 3):** 12k still exhausted on the heaviest prescriptive
chapters; raised to 24k. The diagnosis message named the cause in the audit on
its first outing, which is what made the follow-up a one-line fix.

### L15 — The fidelity gate's first live firing was half right (prose retest)
**Incident:** 5 of 17 chapters rejected. One rejection was the gate working
("is established" asserted with no claimable stage). Four were false
positives: numbered subsection headings ("10.1 No-regret actions") read as
decimal figures, and phantom numbers ("1 55") created by a regex that glued
digits across non-breaking spaces. Three further chapters failed with reasons
the audit truncated at three entries.
**Root cause:** structure recognised by value instead of position; a character
class that joined what typography separates; an audit summary that discarded
detail exactly when there was most of it.
**Fix:** headings stripped by line position (a "10.5 million" in running text
is still checked); NBSP separates numbers; the audit keeps every rejection
reason. **Meta-lesson: a guard's false positives are as instructive as its
catches — each one is a category the guard misunderstood.**
**Pinned by:** `fidelity.test.ts` — "section numbering vs figures".
**Follow-up (retest 3):** "9.5:" — a heading with trailing punctuation —
slipped past the stripper; now tolerated. One true catch the same run: a year
(2016) asserted in a diagnostic chapter with no evidence behind it.
**Follow-up (retest 4):** "Phases 1-3" was read as the number −3; a lookbehind
now keeps ranges out of the figure scan. The 2016 catch recurred — the gate is
consistent about it, which is what a guard should be.

### L16 — "Clerk-shaped" sign-in expectations met reality (passkeys + auth email)
**Incident:** the user reported passkeys "not activated" and sign-in emails
"not triggered". Neither was failing — neither existed: the build shipped only
broker OAuth and bare email/password. Separately, Google sign-in on localhost
died at the broker with "Invalid redirect URI" (user's screenshot): the
`grok_preview` client only accepts `*.grok-sandbox.com` callbacks.
**Root cause:** absent features presenting as broken ones, plus sign-in
buttons rendered in an environment where they structurally cannot complete.
**Fix:** `@better-auth/passkey` wired (migration `0005_passkey.sql`, register
in Settings, sign in from the login page); auth mail via Resend when
`RESEND_API_KEY` is set, honest `[mailer:dev]` console delivery when not —
verification on signup, notification on every session. Broker buttons are
replaced by an explanation on loopback hosts. Traps met on the way, each now
encoded: WebAuthn rejects rpID `localhost` from a `127.0.0.1` origin (QA runs
on localhost); the passkey client does not refresh the session store (login
does a full navigation); a mail failure must never fail the sign-in
(fire-and-forget with logged errors).
**Pinned by:** `npm run qa:auth` (live passkey round-trip via CDP virtual
authenticator); `mailer.test.ts`. **Meta-lesson: a feature a user assumes
exists is a product decision pending — either build it or make its absence
visible in the interface.**
