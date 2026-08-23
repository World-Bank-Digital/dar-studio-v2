# DAR Studio Field Guide

*A plain-language guide for World Bank task teams. Every definition here comes
from the DAMM v1.7 model file the app runs on, not paraphrased from memory.*

## What this app is

DAR Studio carries the **Digital Agriculture Maturity Model (DAMM) v1.7** — the
diagnostic instrument that underpins a Digital Agriculture Roadmap. It records
what the evidence can establish about a country's digital-agriculture
readiness, shows plainly what it cannot establish, and keeps every derived
figure honest about what it rests on.

It is **not** an official World Bank system, not a country ranking, and not a
scoring service. Four prohibitions travel with the model itself:

1. No cross-country ranking.
2. No band used as a project development objective, disbursement-linked
   indicator or disbursement condition.
3. No automatic financing decisions.
4. No public claim before human review.

The operating principle: **assessors record, the instrument derives**. You
enter what a source actually says — a value, the source, its tier, the year.
The evidence class, the level, the pillar bands, the prerequisite statuses and
the use-case readiness matrix are all computed from those entries, never
chosen.

## The instrument

**57 indicators, seven pillars.** A1 (agriculture & need) is scored as *need* —
a low reading is a large opportunity, not low digital maturity. C1–C4 and E1
are capability pillars; O1 reads outcomes. Every indicator also sits on one of
four layers: Foundation, Enablers, Transformation, Outcomes.

**Evidence classes are derived from what you record.**

- A **number** in the value field → **Measured**. Threshold rows score
  themselves from the model's cut-points.
- **Prose plus a source** at an admissible tier (T1–T4) → **Documented**. You
  set the level (1–5) against the qualitative ladder.
- Prose **without a source**, or with only T5 backing → **Judged**. Allowed,
  visible, and counted against the pillar's evidence quality.
- A value beginning **“DATA GAP”** with the search trail → **Gap**. A gap is a
  recorded fact about the evidence landscape, never a zero.

**Source tiers are reported, never weighted.** T1 official statistics and
international databases · T2 peer-reviewed and flagship reports · T3 government
legal and policy artifacts · T4 reputable grey literature · T5 news and vendor
material, admitted for existence facts only — a T5-only citation can never make
a row Documented.

**A withheld level is not an absence.** When the evidence measures a different
construct from what the indicator names, tick the **ratification hold**: the
row keeps its evidence and its class, produces no level, sits outside every
mean, and is disclosed wherever the pillar is summarized. A prerequisite so
recorded reads **Unverified**, never Absent.

**Means travel with their denominators.** A pillar mean averages only the rows
that produced a level; the workspace always shows *Rated* beside *n*, and a
band in (parentheses) rests more on judgment, gaps and withheld levels than on
levelled evidence.

## Prerequisites and the readiness matrix

Prerequisites bind on **presence only** — a fact, never an opinion. Universal
prerequisites (rural broadband, rural electricity, data protection) gate every
use-case column; per-use-case prerequisites gate their named columns;
delivery-risk flags sit on the cover and block nothing.

Each of the six use-case columns (advisory, smart farming, market linkage,
supply chain, financial services, agricultural intelligence) reads **Ready,
Partial, Blocked or Unverified**. A known blocker outranks an unknown one; an
unverified universal prerequisite leaves every column Unverified — the honest
reading when the gating fact could not be evidenced either way.

The matrix shows **two means per column**: the mean of every bearing indicator,
and the mean over enabling indicators only. They differ because need and
outcome rows currently sit in the bearing set — an open design decision
(13.12), shown rather than settled.

## The open decisions

The model ships **unratified**, and says so. Twelve design decisions are open —
band edges, A1 thresholds, the prerequisite mapping, and 44 indicator
definitions each carrying its question on its own row. The **Open questions**
tab lists all of them. Where a value on screen is governed by an open decision,
treat it as provisional; the model file records exactly which fields each
ruling can change, and a ruling arrives as a model revision, not as an edit to
this app.

## Working in the app

- **Portfolio** — open a country (the ISO3 code derives from the World Bank
  economy list) or load a **worked example**: the Egypt and Nigeria assessments
  produced by the model's own test runs, loaded row for row with their values,
  sources, tiers, holds and gaps.
- **Overview** — pillar profile with rated/held counts, layers, and the
  leapfrog gap.
- **Readiness** — prerequisite statuses and the six-column matrix.
- **Evidence** — the 57 rows, grouped by pillar. Edit a row to enter the value,
  source, URL, tier, year, level and notes. Rows carrying an open definition
  question show it right in the editor.
- **Audit** — every consequential action, with actor and role. Set your acting
  role and name from the header; they are written into every change you make.
- **Settings** — personal or team API keys (BYOK, encrypted at rest) for the
  model-assisted features as they arrive.

## What the app does not do

It does not rank countries, does not produce a single country score, does not
decide financing, and does not publish. The diagnostic it holds is an input to
a task team's judgment — the roadmap conversation starts from the evidence
table, not from a number.
