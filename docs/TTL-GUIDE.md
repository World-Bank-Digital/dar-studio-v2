# DAR Studio Field Guide

*A plain-language guide for World Bank task teams. Every definition here is
taken from the DAMM v1.3 configuration the app runs on, not paraphrased from
memory.*

## What this app is

DAR Studio is a working prototype of the **DAMM v1.3** methodology — the
diagnostic that underpins a Digital Agriculture Roadmap. It assembles what
public evidence can tell us about a country's digital-agriculture readiness,
shows plainly what it cannot tell us, and carries a task team through the
decisions that turn a diagnostic into a roadmap.

It is **not** an official World Bank system, not a country ranking, and not a
scoring service. Four prohibitions are wired into the software itself:

1. No cross-country ranking.
2. No maturity stage before human validation (the engagement-package rule).
3. No DAMM score or stage movement as a PDO indicator, DLI or disbursement condition.
4. No automatic financing, procurement, vendor or technology decisions.

The operating principle is **machines compute, humans gate**. Everything
mechanical — fetching public indicators, applying threshold rules, drafting
narrative — is automated. Everything consequential — whether to engage, what
the evidence means, whether to adopt — is a human decision, recorded with the
role that made it.

## The step-by-step path to a DAR

This is the whole journey. Two actors: the **machine** and **you** (the TTL,
or whoever you delegate a step to). Nothing else is required — and the app's
**Guide tab**, the landing view of every workspace, walks these exact steps as
a live checklist with a single "Do this next" button.

**1. Open a country — you, 1 minute.**
Sign in → *New country* → type the name, pick the official economy. You land
in the country workspace.

**2. Launch the Step 1 diagnostic — machine, 30–45 minutes.**
One button. The machine then: (a) pulls every indicator the World Bank / ITU /
FAO statistical systems publish, with source URLs; (b) runs verified web
search for remaining quantitative gaps — a search provider fetches the actual
page, a model extracts figures *from that page only*, and every figure is
checked against the page text before it is stored; (c) anything it cannot
verify becomes a **named gap** routed to a steward — never a guess. It then
researches every **documentary rubric** on the web — farmer registry,
data-governance framework, coordination mechanism — and proposes a provisional
level for each, argued clause-by-clause against the rubric's anchor text with
quote-verified citations and an explicit note on why the next level up was not
proposed. It also builds the **dossier** (see glossary).

**3. Assemble the draft — machine, ~10 minutes. No gates, no waiting.**
*Outputs ▸ Draft & exports* → *Assemble draft*. The full DAR drafts from
whatever the evidence base holds: an **evidence-health page** first (how much
is validated vs machine-provisional, credibility grades, and a ranked
"strengthen first" list), then all 17 chapters and 11 annexes. Prescriptive
chapters carry an explicit **conditional banner** until the evidence readiness
gate clears — recommendations are stated as hypothesis → evidence → decision
gate, never as settled advice. And no maturity stage is claimable until you
validate: that rule is untouched.

**4. Review and correct — you, as much or as little as you choose.**
Read the draft. The health page ranks what to strengthen. For each
machine-researched rubric proposal: confirm it, correct it, or reject it in
*Evidence ▸ Indicators* — each proposal shows its rationale, its citations and
why a higher level was not proposed, so this is review, not authoring. Attach
better documents where the grade is weak. Every correction sharpens the next
draft.

**5. Walk the decision ladder, Steps 2–8 — you, ~15 minutes, when ready.**
*Decisions ▸ Steps 2–8* records seven decisions, one per rung, in order: engagement
mode and budget (2); targeting hypotheses — which value chains (3); the
evidence plan (4); government gates — the mandate (5); validated read-outs
(6); the portfolio scenario (7); adopt and disclose (8). Each is a short form:
choose an option, write a note, record. The ladder cannot skip or move
backwards. Recording it is what makes a maturity stage claimable — the draft
never waits for it.

**6. Re-assemble and export — 1 minute.**
Regenerate after corrections; the health page and the conditional banners
update to match the strengthened evidence base.

**7. Export — you, 1 minute.**
Download the draft as HTML and the evidence base as CSV. The result is a
first-draft DAR: fully cited, honest about its gaps, ready for human
rewriting and consultation.

Total: a complete draft DAR after one unattended machine run, with your time
spent reviewing and correcting an argued, cited document — not authoring one
from a blank page.

## The three read-outs: CMS, EMS, OES

The model never produces one number. It produces three, on a 1–5 scale, and
refuses to average them together:

- **CMS — Capability Maturity Score.** Government capability: the weighted
  blend of four pillars — connectivity (25%), data & DPI (30%), policy &
  governance (25%), human & institutional capacity (20%). Reported only when
  every one of those pillars has at least 60% of its indicators levelled;
  otherwise it reads *Not rated* rather than being computed from a partial
  picture.
- **EMS — Ecosystem Maturity Score.** The same calculation over the two
  ecosystem pillars — innovation & private sector (55%), responsible AI &
  emerging tech (45%). Describes the market environment around government
  capability.
- **OES — Outcome & Equity Score.** The single outcomes pillar — inclusion,
  sustainability, realised results. Kept deliberately separate: a country can
  build systems without yet moving outcomes, and the model refuses to average
  that away.

Scores fall into five bands: **Nascent** (1.0–1.8), **Emerging** (1.8–2.6),
**Established** (2.6–3.4), **Advanced** (3.4–4.2), **Transformative**
(4.2–5.0).

From the three read-outs the engine derives a **Stage** (1 Foundation
constrained → 5 Transformative & inclusive). It is *non-compensatory*: one
core gate at Level 1 caps the stage at Stage 1; one unmeasured core gate
suppresses the stage entirely. Strength in one area cannot buy off a
foundational weakness in another. And by the engagement-package rule, no
stage is *claimable* until a human has validated the evidence — whatever the
engine's arithmetic says.

## Glossary

**DAMM** — Digital Agriculture Maturity Model, v1.3. The methodology: 97
indicators across 8 pillars, extracted from the DAMM workbook into one
versioned configuration file the app reads.

**Core gates** — Thirteen foundational indicators (rural connectivity,
farmer registry, data-protection law, cybersecurity, extension capacity,
farmer consent, and so on) treated as prerequisites, not trade-offs.

**Gauntlet / Evidence readiness** — The readiness gate over those
13 core gates. It clears when at least 11 of 13 are populated, the evidence
behind them is strong (graded A or B, or a human-validated level with a
citation), and none are silently missing. It no longer locks anything: it is
the evidence-health page's headline, and until it clears the prescriptive
chapters carry an explicit conditional banner. Think of it as QER for the
evidence base, reported rather than enforced.

**Dossier** — The country document library. Search queries sweep ten
assessment domains (agrifood structure, registries, DPI, institutions, legal,
financing…) and store citable *documents* — title, URL, year, excerpt.
A dossier item is context for chapters 1–3 and a lead for your gate
validation. It is structurally forbidden from writing indicator values: a
document is not a statistic.

**Engagement package** — Everything assembled before the government mandate
(Step 5) is preparatory material for a Bank decision, not an assessment of
the country. That is why the header says "Engagement package — no stage
claimable" even when the scores look complete.

**Coverage gate** — Below 60% of a pillar's indicators levelled, the pillar
score is suppressed rather than computed. A confident-looking number is never
produced from thin evidence.

**Provisional level** — A level the machine derived from a threshold rule,
not yet confirmed by an assessor. Provisional levels feed the scores you see
in a Step 1 pack — which is precisely why no stage is claimable until Step 6.

**Named gap vs explicit data gap** — A *named gap* is the machine admitting
it found nothing and routing the indicator to a steward. An *explicit data
gap* is a human confirming no data exists. The first blocks the gauntlet;
the second is an accepted, accounted answer.

**Proxy** — A documented near-match (e.g. national 3G coverage standing in
for a rural cut), always labelled, never promotable to grade A.

**Stale** — Evidence older than the model allows for that indicator (2–3
years). Needs a refresh or a recorded exception.

**Evidence grades A–E** — Every reading is scored 0–100 on authority,
definition fit, recency and disaggregation: A national/official exact and
current; B official with a documented proxy or minor gap; C specialized or
older official; D donor/research/industry; E unusable — and any reading
without a public source URL is capped at E. Silence beats a guess.

**Decision ladder** — The eight rungs described in the walkthrough. Step 1
belongs to the machine; Steps 2–8 move only when a human records them.

**Chapters and annexes** — 17 chapters + 11 annexes. Chapters 2–9 and 17 are
*diagnostic* (they report evidence and draft as soon as their inputs exist);
chapters 1 and 10–16 are *prescriptive* (they recommend, sequence and cost,
and stay locked behind the gauntlet). Annexes are the evidence record itself
and are never rewritten by a model.

## Why it feels complex — and what the complexity is doing

The honest answer: the app is a **process made executable**, and the process
is the Bank's own discipline. Every piece that feels like friction is a
prohibition doing its job — the gauntlet stops recommendations resting on
unreviewable evidence; the engagement-package rule stops a machine-scored
"Stage 2" leaking into a PAD; the citation requirement stops invented
statistics; the ladder stops a roadmap skipping the government mandate.
A simpler tool that skipped these steps would produce a document faster — and
that document would not survive quality review.

That said, the *interface* has been simplified without weakening the process:
the workspace opens on a **Guide** — the seven-step path as a live checklist
with one "Do this next" button; the eleven tabs are folded into four groups
(**Guide · Evidence · Decisions · Outputs**); and "Gauntlet" now appears in
the interface as **Readiness**.
