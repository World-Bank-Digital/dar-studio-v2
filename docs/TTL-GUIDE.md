# DAR Studio Field Guide

*A plain-language guide for World Bank task teams. The workflow is defined by
the normative DAMM contract, and the diagnostic definitions come from the DAMM
v1.7 model that the app runs.*

## What this app is

DAR Studio uses the **Digital Agriculture Maturity Model (DAMM) v1.7** and
country-specific research to generate a comprehensive Draft Digital Agriculture
Report (DAR). It records what the evidence can establish, shows what remains
uncertain, and keeps every derived figure and recommendation tied to its
sources.

It is **not** an official World Bank system, not a country ranking, not a
scoring service, and not authority to finance or publish. Four prohibitions
travel with the model:

1. No cross-country ranking.
2. No DAMM band used as a project development objective,
   disbursement-linked indicator, or disbursement condition.
3. No automatic financing decision.
4. No public claim before human review.

These controls govern how the completed Draft is reviewed and used. They do not
insert a human approval gate into Draft generation.

## Generating a Draft DAR

### Before launch

The **country under review is the only required input**. A TTL may optionally
upload relevant documents in five categories:

- country context;
- AI and digital agriculture;
- international strategies and peer-country experience;
- strategic foresight; and
- investment costs, benefits, financing, and appraisal.

The app accepts PDF, DOC, DOCX, XLS, XLSX, CSV, TXT, Markdown, and HTML files as
declared by the workflow contract. Uploads must be added before launch. Launch
freezes the original files, verified text extractions, provenance, and hashes
into an immutable snapshot. A file added later belongs to a new workflow
version and cannot change an active or completed run.

Optional really means optional. If no document is supplied for a stage, the app
conducts its own research. If documents are supplied, it synthesizes them,
checks their provenance, and supplements them where necessary; a document does
not replace the stage.

### The eight stages

| # | Stage | What it produces |
| ---: | --- | --- |
| 1 | **DAMM diagnostic** | DAMM v1.7 observations, an independent automated challenge, scored assessment, and diagnostic report |
| 2 | **Country research and source inventory** | Evidence specific to the country beyond DAMM, plus a consolidated inventory of credible sources and pre-launch TTL material |
| 3 | **AI in digital agriculture assessment** | A separate assessment of the country's as-is AI position, what peer countries are doing, and what the country should do through a national AI agenda |
| 4 | **International strategies and lessons** | Recent, relevant country strategies and transferable lessons, with rationale and limitations |
| 5 | **Strategic foresight** | Country scenarios, a preferred future, and backcast milestones, using uploaded foresight material where available and autonomous research otherwise |
| 6 | **Investment options and cost-benefit analysis** | Prioritized investment options with baseline, counterfactual, cost/benefit ranges, assumptions, sensitivity, risks, distributional effects, and evidence gaps |
| 7 | **Integrated Draft DAR** | One comprehensive Draft that integrates every recorded output from Stages 1–6, with claim-level provenance and clear treatment of uncertainty |
| 8 | **Export package** | All stage products, structured data, source inventories, a manifest, and a complete ZIP bundle |

### After launch

No human input is required while the workflow is active. The TTL does not need
to confirm evidence, approve a stage, import results, upload another file,
choose a model or search provider, select a retry, press Continue, or increase a
budget. The system uses bounded automatic retries and declared fallbacks. It
either completes all eight stages or reports an honest terminal failure; it
does not pause in an `awaiting human` state.

You may monitor progress or use cancellation as a safety control, but neither
is required for normal completion. The active states are `queued`, `running`,
and `retrying`. The terminal states are `complete`, `failed`, and `cancelled`.

### After completion

Human review begins only after Stage 8 creates the Draft package. The task team
may then correct evidence, validate recommendations, create a revised Draft,
and—after the applicable TTL and stakeholder controls—promote a version to
Final. Human review is required for Final/publication, not for generation of
the Draft package.

The package provides narrative products in Markdown, DOCX, PDF, and HTML, and
meaningful structured products/source inventories in XLSX, CSV, and JSON. It
also contains a ZIP bundle and SHA-256 manifest. Any pre-launch documents are
included as frozen originals together with their verified extracted text and
provenance.

## How the DAMM diagnostic reads evidence

Within Stage 1, the instrument derives results from recorded evidence rather
than letting an assessor choose the result. A source contributes what it
actually says—a value, source, tier, year, and text—and the evidence class,
levels, pillar bands, prerequisite statuses, and readiness matrix follow the
model rules.

**57 indicators, seven pillars.** A1 (agriculture and need) is scored as
*need*: a low reading is a large opportunity, not low digital maturity. C1–C4
and E1 are capability pillars; O1 reads outcomes. Every indicator also sits on
one of four layers: Foundation, Enablers, Transformation, or Outcomes.

**Evidence classes are derived from the record.**

- A **number** in the value field is **Measured**; threshold rows score from
  the model's cut-points.
- **Prose plus an admissible source** at T1–T4 is **Documented**.
- Prose **without a source**, or with only T5 backing, is **Judged** and remains
  visibly weaker evidence.
- A recorded **data gap** is a fact about the evidence landscape, never a zero.

**Source tiers are reported, never weighted.** T1 covers official statistics
and international databases; T2 peer-reviewed and flagship reports; T3
government legal and policy artifacts; T4 reputable grey literature; and T5
news/vendor material admitted for existence facts only. T5 alone cannot make a
row Documented.

**A withheld level is not an absence.** When evidence measures a different
construct from the indicator, the row retains its evidence but produces no
level and is disclosed wherever the pillar is summarized. A prerequisite in
that condition reads **Unverified**, never Absent.

**Means travel with their denominators.** A pillar mean uses only rows that
produced a level; the workspace reports rated, held, and gap counts so readers
can see how much evidence supports the summary.

## Prerequisites and the readiness matrix

Prerequisites bind on presence only. Universal prerequisites—rural broadband,
rural electricity, and data protection—gate every use-case column;
per-use-case prerequisites gate their named columns; delivery-risk flags sit on
the cover and block nothing.

Each of the six use-case columns (advisory, smart farming, market linkage,
supply chain, financial services, and agricultural intelligence) reads
**Ready, Partial, Blocked, or Unverified**. A known blocker outranks an unknown
one. An unverified universal prerequisite leaves every column Unverified—the
honest result when the gating fact could not be established.

## Working in the app

- **Portfolio** — open or create the country under review.
- **DAR workflow** — optionally add pre-launch documents, then launch once.
  The country is already the sole required input.
- **Run progress** — monitor the eight stages if useful; no action is required
  between them.
- **Downloads** — after Stage 8, download individual verified artifacts or the
  complete package.
- **Evidence, readiness, audit, and other legacy diagnostic views** — use for
  post-completion examination or authorized administration. They are not
  inter-stage forms and must not be completed to generate the Draft.
- **Settings/provider controls** — deployment administration only for the
  canonical workflow. A TTL does not choose providers or supply a key during an
  active run.

Older ladder, manual import, gate-clearing, dossier, and delivery-gauntlet
instructions are **superseded for normal DAR generation**. They may remain for
historical comparison or explicitly authorized administration, but they do not
form part of the canonical eight-stage workflow.

## What the app does not do

It does not rank countries, produce a single country score, decide financing,
or publish. It generates a versioned Draft package whose evidence,
recommendations, assumptions, limitations, and provenance are available for
human review after completion.
