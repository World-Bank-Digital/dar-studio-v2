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
