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
4. If the failure was a _silent_ success (the run "passed" while doing the
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
storing and _activating_ were separate, and the second step was easy to miss.
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
_every_ indicator query to the NSO domain — the exact bug fixed in the dossier
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

### L17 — Document starvation: 100 documents retrieved, 2 readings accepted

**Incident:** the verified search pass retrieved 100 documents across 8 batches
and produced 2 readings, with zero rejections — the verification gate was never
even consulted.
**Root cause:** one flat document list per six-indicator batch, truncated to
six entries in the prompt. The first two indicators' documents crowded out the
rest, so two-thirds of every batch reached the extraction model with no
evidence attached — asked to extract from documents it was never shown.
**Fix:** the extraction prompt is sectioned per indicator, each carrying its
own retrieved documents; an indicator with none is told to omit itself.
Starvation is now structurally impossible rather than statistically unlikely.
**Pinned by:** `retrieval.test.ts` — "gives every indicator its own section".
**Meta-lesson: zero rejections from a verification gate is not reassurance —
it means the gate's input dried up upstream. Instrument the whole funnel.**

### L22 — The night the provider gave out: a lost race and a dry pass (runs 10–11)

**Incident:** run 10 failed on the harness's 30-minute draft deadline — while
the server-side re-draft completed at minute 30, seconds after the timeout
fired, on a night the model provider was degraded (one chapter call timed out
outright; ten chapters kept deterministic). Run 11 then failed the NEW
zero-findings assertion: both sweeps read zero documents ("fetch failed") —
after five delivery runs in one night, Jina had escalated from slow answers
to refused connections, and the sweep passes have no second chance at a
failed request.
**Root cause:** two environmental realities the code treated as exceptional.
(1) Harness deadlines tuned on good-provider nights lose races on bad ones —
the third deadline lesson this ledger has recorded ("a monitor's timeout is
not the run's"). (2) A single unretried transient network failure silently
costs a whole topic; five back-to-back runs turn "transient" into "systemic".
**Fix:** draft deadline 30 → 45 minutes. All four search fetch sites route
through `fetchWithRetry`: two retries with backoff on network errors and 429
ONLY — auth failures and contract errors return immediately, because
retrying a bad key is noise. And the failure itself validated round-3's
alarm design: the dry pass was caught by the zero-findings assertion built
for exactly this class (L17), not discovered in a review three runs later.
**Meta-lesson: rate limits are a property of the fleet, not the run — a
harness that passes five times in a night is itself the load test. Give
retries to transient failures, margins to deadlines, and alarms to
everything that can run dry silently.**
**Pinned by:** `search.test.ts` — "search retry on transient failure" (second
attempt succeeds; persistent 429 surfaces after retries; 401 never retries;
exhausted retries surface the network error); the deadline comment in
`qa-delivery.mjs`.

### L23 — The red team's first act was to flag its own safety machinery

**Incident:** inspecting run 13's 56 red-team findings, 5 (9%) were the same
false positive: the deterministic stage-assertion check firing on the FIDELITY
GATE'S rejection notice. When model prose fails the fidelity check the chapter
carries a bracketed note that quotes the offending phrases in order to report
them — "Model prose rejected — stage assertions the evidence does not license:
is Advanced, are Established." The red team read that report of a refused claim
as a claim. The adversarial pass did it too, filing an "ambiguity" finding
about a chapter whose prose had been discarded.
**Root cause:** the reviewer was handed the chapter body verbatim, including
annotations written BY the guards for the audit trail. Machinery notes and
document assertions look identical to a regex, and nearly identical to a model.
**Fix:** `stripMachineryNotes` removes the fidelity annotation before both the
deterministic scan and the adversarial prompt — the reviewer sees the document,
not the audit trail — and model exhibits are verified against the same stripped
text, so an exhibit can never quote a note the reviewer was not shown.
**Meta-lesson: a new guard must be told which text is the product and which
text is other guards talking. Layered guards inspect each other's output by
default, and the reviewer with the widest remit will always be the one that
mistakes a colleague's report for the thing being reported.** L15's lesson
holds a second time: each false positive names a category the guard
misunderstood.
**Pinned by:** `redteam.test.ts` — "the fidelity gate's own notes are not
findings" (annotation stripped; no findings from a machinery note; a real
stage assertion in the same chapter still caught; the adversarial reviewer
never sees the note and its exhibits still verify).
**Also observed (not defects):** the surviving 51 findings read as genuine
editorial work — a pillar labelled Advanced in a chapter that also says no
stage is asserted; a suppression reason that never names the failing pillar;
STALE flagged on a 2022 reading while older 2020/2021 figures are not; and a
targeting record showing "rice expansion" rejected in one place and "none"
in another. That last one looks like a real data-rendering inconsistency and
is now an open thread.

### L24 — The document answered the same question two ways

**Incident:** the assembled Egypt draft said, of the same Step 3 decision,
both "Rejected alternatives: (none recorded)" (chapter 10, from the targeting
table) and "Rejected: Rice expansion" (chapters 2, 9 and 17, from the decision
row). The red team caught it three times on its first live outing; every
delivery run since the harness was written had shipped it.
**Root cause:** Step 3 asks for the same fact twice. The form carried a
structured "Rejected chains" input feeding `targeting.rejected`, and beneath
it the ladder-wide free-text "Explicitly rejected options" feeding
`decisions.rejected` — two inputs, indistinguishable in intent, written to two
stores, rendered in different chapters, with nothing keeping them in sync.
Whoever filled one and not the other published a self-contradicting document.
**Fix:** `reconcileRejections` merges the two before either is written, so an
empty side takes the populated side's value and both-populated merges without
duplicates — the stores cannot diverge whatever the caller does (form, script,
future API client). Step 3 now asks once: the structured field is the single
input, labelled with where it lands, and the generic field renders only on the
rungs that need it. The harness gained an assertion that fails when a draft
contains a "none recorded" targeting summary alongside a named rejection.
**Meta-lessons: two inputs for one fact is a defect the moment they can
disagree — the second field is not redundancy, it is a fork in the record.
And this is the class of bug only a whole-document reader finds: every chapter
builder was individually correct, every unit test passed, and the contradiction
existed only in the reading. That is precisely the remit the red team was
given, and it earned itself on the first pass.**
**Pinned by:** `decisions.test.ts` (text-only fills the list; list-only fills
the text; both merge without duplicates; nothing rejected records null, not an
empty string; both separators); `draft.test.ts` (chapter 10 renders the stored
rejection and says "none recorded" only when nothing was rejected anywhere);
the self-contradiction assertion in `qa-delivery.mjs`.
**Verified live** through the real Step 3 form on a demo-pack workspace: one
rejection typed once now lands in all three places that hold it —
`decisions.rejected`, `decisions.payload.rejected` and `targeting.rejected`.
**A note on verifying this one:** the first attempt reset only ladder steps
3–8 on an existing workspace, which shifted the harness's fixed step sequence
by one — the chains and rejection landed on step 4 and the test proved
nothing. The demo pack (Step 1 pre-completed) turned a two-hour re-run into a
two-minute check. **When a harness walks a fixed sequence, resetting into the
middle of it is not a smaller version of the test — it is a different one.**

### L25 — The stage cascade read every threshold as a ceiling instead of a floor

**Incident:** migrating to DAMM v1.5 surfaced that the engine scored the
regression fixture Stage 3 where the methodology scores it Stage 2, and would
have scored Egypt (CMS 3.07) Stage 3 against the workbook's Stage 2. Every
stage the app has ever reported was one too high.
**Root cause:** `stageN_cms` is the FLOOR a read-out must reach to be AT stage
N. The cascade treated it as the CEILING of stage N — "if CMS < stage3_cms
return Stage 3" — so a country sitting between two floors was labelled with
the stage above it. v1.3's config carried the numbers without their meaning,
and the test that pinned the behaviour encoded the same misreading in its own
comment ("cms >= 2.6, and cms < 3.4 → Stage 3"), so the pin defended the bug.
Nothing detected it because the arithmetic was internally consistent; only an
external statement of the same model — v1.5's Config sheet, which spells out
"CMS needed for Stage 2" — could contradict it.
**Fix:** the cascade now computes the highest stage whose floors are all met,
using v1.5's explicit Stage-5 floors (CMS 4.5 / EMS 4.2 / OES 3.4) rather than
reusing the Stage-4 numbers. Verified by scoring the workbook's own 102 Egypt
readings through the engine: CMS 3.07, EMS 2.90, OES 2.41, Stage 2, 0 gates at
L1, 0 unmeasured — identical to the workbook.
**Meta-lessons: a maturity model that overstates is worse than one that
understates, so the DIRECTION of an off-by-one matters as much as its
existence. And a regression pin written from the same misunderstanding as the
code does not pin the behaviour, it protects the bug — the only cure is an
independent statement of the same rule, which is exactly what a methodology
document is for.**
**Pinned by:** `scoring.test.ts` — the fixture now asserts Stage 2 with the
floors read from `model.stage_thresholds`, and the pillar weights are read
from `model.pillars` so v1.5's E1/E2 rebalance (55/45 → 70/30) could not pass
while the engine computed something else.

## Design shifts

### D1 — Draft-first: gates moved from in front of the work to inside the document

**What changed (2026-08-17, user decision):** the ladder and the readiness
gauntlet no longer block drafting. The automated run goes straight to a full
17-chapter DAR; unrecorded decisions and unverified gates become stated
conditions inside the text; the draft opens with an evidence-health page that
ranks what to strengthen first. The engagement-package rule is untouched — no
maturity stage is claimable before mandate and validation.
**Why:** the gated flow showed a TTL 2 of 17 chapters after the automated run
and demanded seven recorded decisions plus nine hand-validated gates before
revealing the rest. Review-and-correct beats author-from-blank-page; an
unusable rigorous tool produces zero rigour in practice.
**What guards the claims now:** the claim policy (`claimableStage`), the
conditional banner on prescriptive chapters, inline grades/PROXY/STALE flags,
and the health page — provenance made impossible to miss, instead of work
made impossible to reach.

### D5 — DAMM v1.5: the model moves, and the process gets a diagnostic package (user decision, 2026-08-20)

**What changed:** the app now reads DAMM **v1.5** (102 indicators, 14 core
gates, E1/E2 at 70/30, explicit Stage-5 floors, a leapfrog-fragility gap of
1.5, and "Data Gap" as an explicit confidence tag weighted 0). v1.5 is a clean
superset of v1.3 — all 97 indicators retained, five added, none removed.
Vocabulary follows: "anchored rubric" becomes "qualitative indicator".
**Why:** v1.5 is where the methodology has actually converged, and its worked
Egypt example is materially better than anything the app had produced — 92 of
102 readings against the app's best of 42. Comparing the two explained the
app's fill-rate struggle: the workbook also carries only ~42 numeric values,
and its entire advantage is ~50 QUALITATIVE indicators scored by an assessor
reading anchors. The app had been trying to automate the one thing v1.5 says
must not be automated ("the machine does not have enough context to score
qualitative indicators reliably"). Three sessions of retrieval engineering
(L19–L21) were chasing a target the methodology had already ruled out.
**The four process decisions (user-directed, on the principle "smooth
progression, no unnecessary complexity"):** the provisional stage is shown,
watermarked, with public claiming still blocked; the 8-rung decision ladder is
retired in favour of v1.5's 4-step process ladder, keeping only the targeting
record that chapter 10 consumes; an unattended run still produces a Diagnostic
Package, with unvalidated qualitative rows flagged and coverage reported twice
(validated, and provisional); and the Egypt assessment is imported as the
baseline for Egypt only.
**Country isolation, restated as a rule:** an import is bound to its ISO3 — a
workbook whose country is Egypt can only load into an Egypt workspace. Egypt's
assessment is an example of FORM for other countries and never a source of
data. The single deliberate exception is practice research, which collects
other countries' strategies as labelled comparators that can never populate an
indicator.
**Migration tooling:** `scripts/extract-damm.py` turns a scoring workbook into
the app's config, so a version bump is a re-run rather than hand-editing 102
indicators. Model counts in tests are now derived from the config for the same
reason — eight test literals encoding "97" and "13" all failed on the bump,
which is the L20 lesson (a catalogue's own contents are the test fixture)
applied to versioning.

### D4 — Team keys, a red team, and the roadmap as a deck (user decision, 2026-08-18)

**What changed:** three additions around the pipeline. (1) **Team BYOK keys**
(`team_keys`, migration 0007): an administrator — defined by the operator
through `DAR_ADMIN_EMAILS`, never through the interface — stores keys the
whole team inherits. Resolution is personal key first, team key as fallback,
in both the model and search paths; the Settings card shows identity only
(provider, …last4) to non-admins. Same encryption and save-time verification
as personal keys (the L6 rule). (2) **Red team** (`review_findings`,
Outputs ▸ Red team): deterministic policy checks — prohibited comparison
language, stage assertions while no stage is claimable, ownerless
prescriptive recommendations — plus an adversarial model pass per chapter
(contradiction, unsupported claim, overreach, ambiguity). A finding must
exhibit a verbatim excerpt from the chapter it challenges, checked with the
same quote discipline as evidence citations; an unlocatable exhibit kills the
finding. Runs as a DETACHED job with polled status; per-chapter crash
containment from the start (L20). Findings inform the editor; nothing edits
the draft. (3) **Roadmap deck** (pptxgenjs, Draft & exports; also
`scripts/export-deck.ts <countryId>`): action-title slides at half-page
density — model explainer, evidence health, read-outs, pillar and gate
tables, one slide per chapter with its own takeaway and evidence anchors,
sweep findings, comparator practices, foresight uploads, decision record,
and a closing slide restating the prohibitions. Shaped from the same payload
as the document, so the deck cannot say what the draft does not. Text and
shapes only — no images, which also keeps pptxgenjs's image parser
(image-size, two open DoS advisories) away from any input.
**Run-12 sequel to L9:** the first red-team implementation ran seventeen
adversarial model calls inside one HTTP request; a degraded-provider night
pushed the pass beyond every request-scoped wait and the run died at the
harness deadline with no findings written. The review now runs detached with
a polled job (the dossier-job pattern) — the lesson L9 recorded for prose
generation, relearned in a new seam.
**Validated (delivery run 13, DELIVERY PASS, zero console errors):** red team
reviewed 17 chapters and produced 56 findings (11 high; 16 deterministic, 40
adversarial — each with a verbatim exhibit), surviving a slow provider that
killed one chapter's review with the L14 diagnosis naming itself; the deck
exported at 29 slides / 577 KB and passed the harness's file checks; 75 sweep
findings the same run. Team-key resolution is pinned at unit level and the
admin card verified live; the fallback path awaits a second live account to
exercise it end to end.
**Pinned by:** `teamkeys.test.ts` (admins are configured, not
self-appointed), `redteam.test.ts` (scope excludes model/health/annexes;
comparison, stage and ownerless checks with verbatim exhibits; fabricated
exhibits dropped; junk categories rejected; crash containment),
`deck.test.ts` (action titles, band-definition vs claim, conditional
flagging, annexes excluded, prohibitions on the closing slide), and the two
`qa-delivery.mjs` phases (red team must review 17 chapters with the
adversarial pass on; the deck download must be a plausible .pptx).

### D3 — The pipeline explains itself, then casts three nets (user decision, 2026-08-18)

**What changed:** the run sequence is now: (1) explain the DAMM — a
deterministic explainer computed from the model configuration opens the run,
the Guide tab and the draft; (2) collect all 97 indicators, each carrying
source, year, credibility and level; (3) an **opportunistic sweep** — a wide
net over the public domain for citable country evidence outside the indicator
structure, stored as quote-verified findings (never score inputs; they feed
chapters and Annex B); (4) **practice research** — strategies and best
practices from roughly the past year, any country, as cited comparators for
prescriptive chapters; (5) **strategic-foresight uploads** — user-provided
documents (PDF/DOCX/TXT/MD, text-extracted) cited by the draft as user
material. App copy was swept of references to previous behaviour — the app
describes itself as it is (`copy.test.ts` pins the banned phrases).
**Why:** the fixed indicator frame under-uses what the public domain knows
(the user's direction), and a diagnostic that opens by silently collecting
reads as a black box. The verification discipline is unchanged everywhere:
findings carry verbatim checked quotes; foreign-government hosts are excluded
from country evidence but welcome as practice comparators; uploads are
labelled user-provided.
**Pinned by:** `explainer.test.ts`, `findings.test.ts`, `copy.test.ts`,
`draft.test.ts` (model page first, Annex B inventory, comparator blocks,
facts-block feeds), and the four new `qa-delivery.mjs` assertions (sweep
findings visible, foresight upload cited, model page in the draft).
**Validated (delivery run 9, DELIVERY PASS):** the full revised pipeline ran
end to end against Egypt — explainer audit entry first, 42/97
machine-levelled (19 rubric proposals, 5 repair-recovered — a new high),
then 59 opportunistic + 11 practice findings stored (70 visible in the tab;
the practice pass rejected 20 of 31 candidates on the past-year window,
which is the window working), foresight fixture uploaded through the real UI
and cited by the draft, model page opening the document, 17+11 intact, stage
withheld throughout, zero console errors. Ingest 34.9 min including both
sweeps — reasoning-off extraction keeps paying for the added work.

### D2 — Rubrics are researched, not skipped (user decision, same date)

Anchored rubrics (42 indicators) and locally-sourced quantitative gaps (29) are
now researched on the open web. Rubric proposals must argue clause-by-clause
against the anchor text, state why the next level up was NOT proposed, and
cite quote-verified retrieved documents — the shape demonstrated by the user's
own Egypt farmer-registry assessment, which is the reference test fixture.
Proposals are provisional suggested levels (provenance `machine-researched`);
validation converts or corrects them. `rubric.test.ts` pins the contract.

### L18 — The adversarial review harvest: 27 confirmed findings in one diff

**Incident:** a four-lens adversarial review (31 agents, every finding re-verified
by a skeptic against the code) of the draft-first + rubric-research change
confirmed 27 defects I would have shipped, plus one more surfaced by the live
run (#28).
**The heaviest:** (a) a human edit to any researched rubric row silently erased
the machine's proposal — `suggested_level` recomputed from a null value;
(b) the rubric persist could overwrite evidence a human entered mid-run;
(c) `generateMemo` was the one prose path with no fidelity gate, newly armed by
rubric research computing a rated stage at Step 1; (d) the CONDITIONS banner
did not survive prose replacement — the central draft-first safeguard existed
only pre-prose; (e) the two graders contradicted each other: a researched row
graded E ("no value") in the Evidence tab and A ("official series") in the
draft; (f) the sibling starvation and statistics-biased queries that kept the
farmer registry — the user's own worked example — out of the proposals;
(g) "Transformative", the model's own top band, missing from the fidelity
gate's band list; (h) #28 from the live run: L1 proposed from absence of
evidence — retrieved documents failing to show a capability was treated as
evidence it does not exist. All fixed; researched proposals now grade ≤C in
BOTH graders (populated, cited, but pending validation), L1 is unproposable
from web research, and the banner is re-attached after prose.
**Meta-lessons:** a graceful path added in one place (L14's budget fix) must be
grepped for in every sibling call site — the 3k-token extraction budget
reproduced L14 exactly and was found by its own diagnostic message in the
audit; and independent adversarial review pays for itself at design-shift
boundaries — most of these lived in the seams between components written
hours apart.
**Pinned by:** `rubric.test.ts` (L1 refusal, strict citations, documentYear),
`evidenceScore.test.ts` (researched-proposal grading), `draft.test.ts` (banner
extraction), `fidelity.test.ts` (band list), `retrieval.test.ts` (per-indicator
dedupe), and the tightened persist/update paths in `actions.ts`.
**Round-2 follow-up (delivery run 5, DELIVERY PASS):** short country names,
unstuffed 2–5-word rubric queries, unambiguous document labels and the
anti-defensive prompt lifted machine-levelled indicators 23 → 33 (+43% over
baseline), rubric proposals to 10 including three documentary CORE GATES (4.1
data-protection law, 4.5 ag data governance, 5.7 ministry digital unit — all
L3 with citations), and model-prose coverage to 15 of 17 chapters with the
fidelity gate still rejecting 2. Two Playwright traps entered the record: a
wrapping <label> inherits its textarea's content into the accessible name
(target the textarea directly), and a monitor's timeout is not the run's.
Still open: 3.3 farmer registry — three runs of "documents did not establish"
point at retrieval (Jina ranking for this phrase), not validation; the levers
are an Exa key (user's call) or a non-reasoning extraction model.

### L19 — Round 3: the funnel's three leaks, each fixed at its own stage

**Incident (delivery run 5, instrumented funnel):** machine fill plateaued at
33/97 with three distinct leaks. (1) Quantitative extraction: 119 documents
retrieved across 9 batches produced 3 candidate readings — retrieval
delivered; the reasoning model read defensively and spent its budget thinking.
(2) Rubric research: 6 of the 32 rejections were argued, cited proposals
thrown away because one quote failed verbatim verification — recoverable
losses (10 accepted; 16 were in reach) — and the audit could not say WHY
quotes failed. (3) The acid-test registry (3.3) resisted a third run behind
ONE fixed query phrasing: the indicator name's slash glued two capabilities
into "Egypt National farmer registry database official", while the winning
human query had been two words.
**Root cause:** one prompt/one call/one phrasing per stage, tuned once and
never given a second angle — plus a defensive-prompt sibling of the L11 class:
the extraction prompt still said "returning nothing is correct and expected"
after round 2 had de-defensived the rubric prompt.
**Fix:** (a) extraction runs with chain-of-thought asked off (OpenRouter
unified `reasoning: {enabled: false}`), one VISIBLE fallback to default
reasoning if the hint is refused; the defensive invitation replaced by a
positive obligation ("MUST return a supported figure"); a model reply that
parses to zero items now alarms instead of impersonating an honest empty
result (the L14 class). (b) Quote-failure rejections carry the offending
quote, and a proposal that failed ONLY on quote verification gets exactly one
repair call naming the failed quote — the verification bar itself is unmoved;
the prompt now forbids translating quotes. (c) Rubric search tries up to three
phrasings (slashed name alternatives split into separate queries, leading
scope words dropped), advancing while the harvest lacks the rubric's
discriminating vocabulary; per-variant results interleave by rank under the
document cap. Vocabulary matching is ONLY a keep-searching trigger, never an
evidence rank or filter — the reference decree establishes the registry
without ever saying "registry".
**Result (delivery run 7, DELIVERY PASS):** 35/97 machine-levelled (+2 over
run 5; +52% over baseline), 11 proposals, quantitative 3 accepted / 0
uncheckable (run 5: 2/1), 208 rubric documents read (variants firing), ingest
wall-clock FLAT at 38.6 min (reasoning-off paid for the extra searches). The
new diagnostics earned their keep immediately: all six quote failures survived
repair unchanged and read as fluent spans, not paraphrase — pointing at
cross-document misattribution and quoting-from-memory, not transformation
(→ round 3b: cross-document re-attribution, 9k quotable window, reading-trail
audits). 3.3's failure mode moved from "did not establish" (retrieval) to an
L1 judgment correctly refused by the guard — the documents now arrive; the
judgment is the next target.
**Meta-lesson: instrument a funnel before pulling levers — run 5's
stage-by-stage counts turned "the machine fills too little" into three
specific, separately fixable leaks. A repair loop that recovers nothing is
still a diagnostic: it eliminates the failure mode it was built for.**
**Pinned by:** `providers.test.ts` (reasoning parameter mapping),
`retrieval.test.ts` (no-reasoning-first with visible fallback, unparseable
alarm, prompt obligation), `rubric.test.ts` (name alternatives, query
variants, topic-trigger semantics, rank interleave, offending-quote reasons,
one-repair-only, no repair for non-quote rejections, re-attribution rules,
9k window, reading trail).

### L20 — One catalogue name killed the whole rubric pass (delivery run 6)

**Incident:** run 6 died at "Researching documentary rubrics — 41 of 42" with
no pass summary, a 22-minute audit silence, one `ingest_error` ("Cannot read
properties of undefined (reading 'replace')"), and a QA harness death by
deadline. The 41 finished rubrics' work survived only because persistence is
per-rubric.
**Root cause:** two stacked problems. (1) Indicator 3.5 — "National
agricultural data portal / open data" — writes its alternatives with a
FREESTANDING slash. The new `nameAlternatives` parser understood only slashed
tokens ("registry/database"); a bare "/" token has empty sides, the function
returned no alternatives, and `alts[0].replace` threw. The unit tests covered
three handpicked names, not the catalogue — L11's lesson (a class of mistake
rarely has one instance) applied to data instead of code. (2) A thrown worker
rejects the whole `mapLimit` pool, so one rubric's crash abandoned the 42nd
rubric AND the pass summary, leaving the run to die of deadline rather than of
a named error.
**Fix:** a spaced slash now splits whole phrasings; every degenerate parse
falls back to the cleaned full name, so an empty alternatives list is
unconstructible. The rubric worker contains crashes per indicator ("{id}
crashed: …" surfaces in the pass summary's error list) — one rubric can never
again cost the other forty-one. Audit rejection reasons widened 160 → 300
chars so the repair-attempt suffix survives into the trail.
**Meta-lesson: when a function's input domain is a catalogue, the test sweeps
the catalogue — handpicked fixtures test the parser you wrote; the catalogue
tests the parser you needed. And a worker pool one item can kill turns a data
bug into an availability bug; containment belongs at the worker.**
**Pinned by:** `rubric.test.ts` — "reads a spaced slash as whole-phrase
alternatives" and "builds non-empty queries for EVERY researchable rubric in
the catalogue"; the containment comment at the `mapLimit` worker in
`actions.ts`.

### L21 — Round 3b: the memory-quote diagnosis, and what the reading trail caught (delivery run 8)

**Incident:** run 7's six failed quotes all survived a repair pass unchanged
and read as fluent, specific spans — not paraphrase. Working hypothesis was
cross-document misattribution; the alternative was quoting from model memory.
Separately, 3.3's rejection trail showed the rubric pass reading ONLY
`censusinfo.capmas.gov.eg` — the NSO scope, inherited from the quantitative
path, had confined the registry search to the census bureau for four runs,
and census pages say "database" everywhere, so even the round-3 vocabulary
trigger was satisfied by the wrong capability.
**Fix + result (run 8, DELIVERY PASS, 43/97 machine-levelled — +8 over run 7,
+87% over baseline):** the rubric prompt's shown window went 4500 → 9000 chars
(the shown text is the model's whole quotable surface), cross-document
re-attribution was added for quotes found verbatim on exactly one other
retrieved page, and rejects carry a reading-trail of hosts. Outcome settled
the diagnosis: re-attribution fired ZERO times, while citation repair — which
had recovered nothing at 4500 — recovered 3 proposals at 9000. The failed
quotes were model memory, not misattribution: give the model enough real page
to quote and the repair loop starts working. Quote failures fell 6 → 3 (the
residue is one recurring memory-quote about a known case study). Rubric
proposals 11 → 17, quantitative acceptances 3 → 6, rubrics left named 31 → 22.
One model call died upstream ("finish reason: error"); the L20 containment
kept it to one rubric and named it in the pass summary.
**The 3.3 probe (scripts/probe-rubric.ts):** a two-minute single-rubric live
probe replaced the fourth 70-minute delivery run. Descoped to the open web,
the registry query stopped reading the census bureau — and returned India's
AgriStack portal (`mhfr.agristack.gov.in`) plus generic FAO/OECD pages:
topical, official-looking, wrong country. That surfaced a new integrity
class — one government's documents must never inform another government's
capability assessment — now closed by `isForeignGovernmentHost` (ccTLD
government patterns, foreign-gov docs discarded before the topic trigger or
the prompt). Re-probed: the pool is clean and domestic-or-intergovernmental,
and 3.3 still honestly rejects — Jina's ranking simply does not surface
Egypt's own Farmer's Card pages for English registry phrasings. The residual
levers are an Exa key (real `includeDomains`, neural ranking — user's call)
or query variants in the country's official language (the Farmer's Card is an
Arabic-first programme).
**Meta-lessons: when two hypotheses explain a failure, build the cheap
discriminating experiment into the pipeline and let one production run settle
it — the re-attribution counter existing at all is what proved misattribution
wrong. A reading trail on every rejection converts "still fails" into "fails
for this named reason". And a single-item live probe belongs next to any
70-minute loop — three delivery runs were spent learning what one probe shows
in two minutes.**
**Pinned by:** `rubric.test.ts` (re-attribution rules, 9k window, reading
trail, foreign-doc exclusion from the prompt, open-web scope for rubrics);
`websearch.test.ts` (foreign-government host patterns, intergovernmental
hosts untouched, unknown-country no-op).

### L26 — One version label concealed several different methodologies

**Incident:** the final-DAR review found DAMM v1.7 documents carrying different
band edges, readiness rules, prerequisite mappings, and indicator metadata from
the executable model while every surface still used the same version label.
**Root cause:** model JSON, census, captions, UI counts, and runtime files could
be copied or restated independently; workflow completion authenticated the
eight-stage contract but not the methodology revision that gave Stage 1 its
meaning.
**Fix:** DAR Studio now pins the model/schema/source commit/engine/renderer by
digest, generates its indicator census and scorer/UI metadata from the model,
fails app builds on model-derived drift, freezes methodology identity at launch,
verifies the exact clean pipeline commit plus explicit meaning-bearing bytes
before execution and publication, binds every artifact set to the model plus
assessment-input hash, and publishes a per-run methodology manifest. The model
stays explicitly draft and unratified.
**Pinned by:** `model.test.ts`, `scorer.test.ts`, `run-store.test.ts`, and
`worker.test.ts` methodology-provenance regressions.

### L27 — Machine completion and machine challenge are not human approval

**Incident:** the final-DAR review found that a successful autonomous workflow
could be read as an approved deliverable, while a generic owner review and an
automated vendor pass carried language resembling the DAMM G1/G2 human
controls. No durable mechanism proved that a named assessor reviewed every
machine-filled row, that an independent person performed G2, or that a named
and dated country owner completed G3 before circulation.
**Root cause:** workflow execution state and downstream governance shared one
surface and one loose review record. The record was not bound to the complete
methodology/package identity, had no row scope, did not enforce reviewer
independence or sequencing, and could not create an immutable versioned release
without relabelling the generated files.
**Fix:** Stage 8 remains an immutable, downloadable `Draft · pre-review`.
Package-scoped assignments and append-only human decisions now bind G1, G2,
and G3 to the exact run, artifact set, bundle, workflow contract, methodology,
assessment input, and reviewed row hashes. G1 covers every machine-filled row;
G2 uses a different authenticated user and the QC-protocol scope; G3 is the
country owner's server-dated seven-point sign-off. Revisions terminate that
package's chain. Accepted G3 creates a separate versioned release manifest and
never mutates the Stage 8 bytes; an unratified methodology can produce only an
approved Draft release. Pending reviewer mistakes are repaired through an
atomic, append-only supersession with an owner identity/reason/time audit; the
old assignment immediately loses access, while completed decisions and their
identity snapshots cannot be replaced. Package materialization independently
re-verifies every stored byte and the exhaustive ZIP/manifests before any human
gate can start, and reviewer downloads carry preview bearer credentials only in
authorization headers. The reviewed rows come from the persisted Stage 1
engine input actually used for scoring—not the earlier raw observations or a
manifest-declared hash without corresponding stored bytes. That set includes
model-authorized carried candidates. PostgreSQL is the single authority for
persisted row hashes so decimal scale, exponent notation, and unsafe integers
never cross a lossy JavaScript hashing boundary; reviewer payloads retain the
database-canonical numeric spelling. G2 also persists the exact version, text,
and SHA-256 of its substantive source/class/ladder QC affirmation, rather than
a generic checked boolean.
When a later deployment changes only the canonical source pin, already completed
approval records stay exact and audit-readable, while unfinished prior-pin chains
become historical read-only; authority never crosses the pin boundary implicitly.
Audit readability also needs an explicit package-addressing path: selecting only
the newest country package makes an older chain operationally invisible as soon as
a replacement Draft completes, even if every underlying row remains immutable.
**Meta-lesson: completion proves that automation finished; approval proves who
reviewed exactly which immutable bytes under which methodology. Those are
different state machines and must have different identities, records, and
terminology.**
**Pinned by:** `approvals.test.ts`, `approval-store.test.ts`, exact-package
document-set regressions, and the white-background contract.

### L28 — A reported validation error still fell through into `math.isfinite(None)`

**Incident:** the Nigeria workflow completed five stages, then Stage 6
(`investment_options`) failed with `TypeError: must be real number, not
NoneType`. The generated product contained a quantified benefit with one numeric
range bound and one `null` bound. The controlled validation error never reached
the workflow surface because the validator itself crashed.
**Root cause:** the paired-bound checks for costs and quantified benefits
recorded an error when exactly one bound was missing, but a second independent
`if` still evaluated the range. That fallthrough called `math.isfinite` with
`None`. Validation detected the bad value but did not short-circuit the unsafe
numeric operation.
**Fix:** the numeric/order check is now an `elif` after the paired-bound check,
so half-null cost and benefit ranges return explicit validation errors without
crashing. DAR Studio pins canonical DAMM merge
`2efb26607acc29a687a82a56edc85f53c4a6da69` through append-only migration
`0015`; migration `0014` remains immutable evidence of the preceding source
cutover.
**Pinned by:** upstream DAMM
`gauntlet/loop-1/research_pipeline/test_investment_options.py` covers both
half-null directions for costs and benefits, plus both-null, valid finite, and
reversed ranges. DAR Studio's methodology-integrity, source-pin migration, and
`scripts/deployment-wizard.test.mjs` regressions require the merged commit and
the `0015` cutover before the worker is accepted.

### L29 — Variable country evidence needs bounded adaptive work, not unbounded output

**Incident:** after five successful stages, Nigeria Stage 6 failed because
`claude-opus-5` returned an unterminated JSON string. The provider had consumed
the configured output allowance without producing a complete parseable object,
so the entire investment appraisal was discarded.
**Root cause:** one monolithic structured response coupled country-dependent
evidence volume to a fixed output allowance. Simply removing token limits would
not remove provider context limits or truncation risk, and it would surrender a
critical spend bound. The paid-call boundary was also not durable enough to
prove that a crash between provider completion and the next checkpoint could
resume without replaying spend.
**Fix:** Stage 6 now scales by the number of bounded work units: evidence is
mapped in character-bounded batches, candidates are reduced in bounded groups,
options are appraised separately, and a final comparison assembles the result.
Each structured call validates its schema locally and distinguishes completion,
provider rejection, invalid output, and truncation. Truncation receives only
bounded adaptive retries; exhaustion becomes an explicit terminal failure.
Provider outcomes and spend are journaled at the paid-call boundary, while
durable step checkpoints and reservation accounting make crash recovery resume
completed work without silently paying twice. DAR Studio pins canonical DAMM
merge `1b1734c8a8017cda488b77cf0594b0ca82dae6ee` through append-only migration
`0016`; migrations `0014` and `0015` remain immutable evidence of their earlier
source cutovers.
**Pinned by:** upstream DAMM investment-option, vendor, and workflow regressions
cover batching, schema validation, truncation retries, provider rejection,
checkpoint recovery, and spend accounting. DAR Studio's migration, methodology
integrity, approval-history, and deployment-wizard tests require migration
`0016` and the exact merged commit before a new worker is accepted.
**Meta-lesson:** when input volume varies, scale the number of bounded,
checkpointed calls—not the maximum size of one opaque response.
