# Paid-canary provider tariff and model audit — 2026-09-04

- **Status:** verified with explicit operating conditions
- **Verification date:** 2026-09-04 (Asia/Bangkok)
- **Audited artifact:** DAMM `gauntlet/loop-1/research_pipeline/prices.json` at canonical repository commit `76ca33d97f0809a6be7477447786953317aa41b5`
- **Artifact SHA-256:** `86651e181fd8795c2a65171ae298b22bbff76e9438b916102a2ae0c0547bf6bf`
- **Production code identity:** 38 tracked files; aggregate SHA-256 `b867d6960ac6e0f446e89f9c341b6283fdb3ddfe4326070049bf4a5c097e134c`

## 2026-09-05 official-document recheck

The same first-party tariff and identifier sources below were re-read on
2026-09-05. No numeric tariff or exact model-ID drift was found for the fixed
Opus 5 primary/Terra challenger canary profile or its pinned retrieval modes.
The prior qualifications remain material: the Haiku short alias is mutable,
GPT-5.6 Sol's short-context price is promotional through at least 2026-11-21,
Gemini 3.1 remains a preview unavailable to the inspected Free-tier credential,
and Jina's `$0.05`/million returned-token conversion remains specific to the
inspected account package rather than a universal public list price.

All five provider model-list endpoints used by the administrative stored-key
selector were checked against first-party references on 2026-09-05:
[Anthropic `GET /v1/models`](https://platform.claude.com/docs/en/api/models/list),
[OpenAI `GET /v1/models`](https://developers.openai.com/api/reference/resources/models/methods/list),
[Gemini `GET /v1beta/models`](https://ai.google.dev/api/models#method:-models.list),
[xAI `GET /v1/models`](https://docs.x.ai/developers/rest-api-reference/inference/models),
and
[OpenRouter `GET /api/v1/models`](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).
Each is a metadata request authenticated by the stored credential. A successful
listing sends no prompt and invokes no inference, but does not establish
inference entitlement, quota, funds, or service health. Accordingly, the
selector is explicit, single-attempt, fixed-endpoint, redirect-rejecting,
response-bounded, and isolated from canonical workflow inference identity.

## 0025 source-pin continuity

This audit remains an evidence record for the `prices.json` bytes reviewed at
`76ca33d97f0809a6be7477447786953317aa41b5`; it does not retroactively change
that audit date or its source observations. The current source-pin release
candidate advances only to DAMM PR #14 merge
`d81d267133eed52b5fdcc599bfecf8d72496f292`. Its `prices.json`, model, schema,
workflow, engine, renderer, and ratification inputs are byte-identical to the
audited predecessor. The only production-code change is fail-closed rejection
of an unknown pricing or reasoning vendor before price/ledger setup, credential
access, model discovery, or transport. Its reviewed 38-file closure is
`118908785e9d061c387dde163507f39288b00176c6897ee6f7d8943311860f34`.

Accordingly, this audit's tariff/model verdict remains applicable to the
candidate without claiming a new provider interaction. A paid canary still
requires same-day revalidation of the selected runtime, successful deployment
of the exact reviewed DAR/DAMM identities, and migration `0025`; none of those
requirements authorizes a workspace or paid workflow.

## Scope and method

Every numeric tariff and every model identifier in `prices.json` was compared with current, provider-owned documentation. Authenticated account observations are recorded separately from public tariff facts below. No provider inference, search, retrieval, or test request was made, and this audit incurred no provider spend.

The result is **no numeric tariff drift** as of the verification date, provided DAMM continues to use the request modes stated in this document. One identifier deserves hardening: `claude-haiku-4-5` is an accepted convenience alias, but the pinned Claude API snapshot is `claude-haiku-4-5-20251001`.

## Public tariff and model verification

### Anthropic

All amounts are USD per million tokens under standard, first-party, globally routed Claude API inference.

| `prices.json` identifier | Recorded input | Recorded output | Official result                                                                                                                                   | Identifier result                                                              |
| ------------------------ | -------------: | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `claude-opus-5`          |          $5.00 |          $25.00 | Exact match                                                                                                                                       | Current canonical, pinned dateless model ID                                    |
| `claude-opus-4-8`        |          $5.00 |          $25.00 | Exact match                                                                                                                                       | Current canonical, pinned dateless model ID                                    |
| `claude-sonnet-5`        |          $2.00 |          $10.00 | Exact match; Anthropic states that the introductory rate became the standard rate and the previously scheduled 2026-09-01 increase will not occur | Current canonical, pinned dateless model ID                                    |
| `claude-haiku-4-5`       |          $1.00 |           $5.00 | Exact tariff match                                                                                                                                | Accepted short alias; canonical pinned snapshot is `claude-haiku-4-5-20251001` |

Sources: [Anthropic model pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Anthropic model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions), and [Anthropic Haiku 4.5 migration guide](https://platform.claude.com/docs/en/models/haiku-4-5/migration-guide).

Conditions and uncertainty:

- DAMM's Anthropic request path does not set `speed: "fast"` or `inference_geo: "us"`. Fast mode on Opus 5 and Opus 4.8 is $10/$50 per million input/output tokens. US-only inference on Claude 4.6 and later applies a 1.1x multiplier. Either option would invalidate the base rows unless separately priced.
- DAMM does not request prompt caching. Anthropic prices five-minute cache writes at 1.25x, one-hour writes at 2x, and ordinary cache hits at 0.1x base input. These dimensions are intentionally absent from the current simple rows.
- The Haiku alias can move to the newest dated snapshot within its minor version. Its current tariff is verified, but the alias is not a model-behaviour pin.

### OpenAI

The public model pages confirm all three identifiers and standard prices. DAMM stores both the official uncached input price (`base_in_per_mtok`) and a deliberately conservative input rate (`in_per_mtok`) equal to OpenAI's 1.25x cache-write rate because DAMM does not yet split cache-write usage.

| Identifier      | Official standard rate at <=272K input | Official standard rate at >272K input | DAMM conservative rate at <=272K | DAMM conservative rate at >272K | Result                                                      |
| --------------- | -------------------------------------- | ------------------------------------- | -------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `gpt-5.6-terra` | $2.00 input / $12.00 output            | $4.00 input / $18.00 output           | $2.50 input / $12.00 output      | $5.00 input / $18.00 output     | Exact base/output match; conservative input math is correct |
| `gpt-5.6-luna`  | $0.20 input / $1.20 output             | $0.40 input / $1.80 output            | $0.25 input / $1.20 output       | $0.50 input / $1.80 output      | Exact base/output match; conservative input math is correct |
| `gpt-5.6-sol`   | $4.00 input / $20.00 output            | $8.00 input / $30.00 output           | $5.00 input / $20.00 output      | $10.00 input / $30.00 output    | Exact base/output match; conservative input math is correct |

Sources: [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), and [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

Conditions and uncertainty:

- The higher tier applies to the full request only when input is **greater than** 272,000 tokens. The stored threshold and rates match that boundary.
- The recorded `in_per_mtok` values are upper-bound reservation/ledger rates, not the ordinary uncached list price. They conservatively overstate ordinary uncached input by 25%.
- The rows assume standard processing through the direct OpenAI API. Regional processing carries a 10% uplift for eligible models, and Fast processing has separate rates. DAMM sets neither option.
- GPT-5.6 Sol's $4/$20 short-context pricing is promotional and is guaranteed only through at least 2026-11-21. It must be rechecked if a canary occurs after that date.

### Google Gemini Developer API

All amounts are standard paid-tier USD prices per million tokens. Gemini output prices include thinking tokens.

| Identifier               | Official and recorded rate at <=200K input | Official and recorded rate at >200K input | Lifecycle result                                               |
| ------------------------ | ------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| `gemini-3.1-pro-preview` | $2.00 input / $12.00 output                | $4.00 input / $18.00 output               | Exact current endpoint ID; preview; no shutdown date announced |
| `gemini-2.5-pro`         | $1.25 input / $10.00 output                | $2.50 input / $15.00 output               | Exact current endpoint ID; no shutdown date announced          |

Sources: [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models), and [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations).

Conditions and uncertainty:

- The higher rate applies when the prompt exceeds 200,000 tokens; the stored threshold matches that boundary.
- The rows are Standard paid-tier rates, not Batch, Flex, Priority, or free-tier economics. Grounding tools would introduce additional charges and are not represented by these rows.
- `gemini-3.1-pro-preview` is explicitly a preview endpoint. Although Google announces no shutdown date, preview availability remains a lifecycle risk and must be rechecked before any future selection.

### Perplexity Sonar

| Identifier  | Recorded tariff                                | Official result                                   |
| ----------- | ---------------------------------------------- | ------------------------------------------------- |
| `sonar-pro` | $3.00/M input, $15.00/M output, $0.006/request | Exact match for Sonar Pro with low search context |

Sources: [Perplexity API pricing](https://docs.perplexity.ai/docs/getting-started/pricing) and [Sonar Pro model page](https://docs.perplexity.ai/docs/sonar/models/sonar-pro).

Conditions and uncertainty:

- Perplexity charges $6/$10/$14 per 1,000 Sonar Pro requests for low/medium/high search context, in addition to tokens. DAMM explicitly pins `search_context_size: "low"`; relying on a provider default or selecting another context would invalidate the $0.006 request fee.
- Pro Search has higher request fees. DAMM does not request it.

### Exa Search and contents

| Recorded tariff                    | Official result                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `$0.007` per search                | Exact match to $7 per 1,000 Search requests with up to 10 results                         |
| `$0.000` per included content page | Correct only for text/highlight contents attached to Search for up to 10 returned results |

Sources: [Exa API pricing](https://exa.ai/pricing?tab=api) and [Exa Contents API guide](https://exa.ai/docs/reference/contents-api-guide).

Conditions and uncertainty:

- Exa separately prices direct Contents calls and content beyond the first 10 Search results at $1 per 1,000 pages per content type. AI summaries also cost $1 per 1,000 pages.
- DAMM constrains Search to 1–10 results, may attach text contents to that Search, and does not request summaries. The zero `per_content_page` entry is valid only inside that enforced request shape.

### Jina Reader

| Recorded tariff                            | Verification result                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$0.05` per million returned output tokens | Exact match to the authenticated production account's standard $50/1-billion-token package; public docs independently confirm that Reader accounts usage from output-response tokens |

Source for public service behaviour: [Jina Reader](https://jina.ai/reader/). The dollar conversion was verified in the first-party authenticated account dashboard; it is not exposed as a stable dollar table in the public Reader page.

Conditions and uncertainty:

- The public page states that Reader usage is counted from output-response tokens. ReaderLM-v2 costs 3x tokens; DAMM uses ordinary `r.jina.ai` Reader and does not request ReaderLM-v2.
- Jina package menus and taxes can vary by account and location. The $0.05/M value is therefore an account-specific current rate, not a universal public list-price claim.
- Any package change requires revalidation before the next paid run.

## Authenticated account and control observations

These are first-party, login-gated observations from 2026-09-04. They are deliberately separate from the public tariff evidence above. No key, token, private URL, credential fragment, or payment detail is recorded here.

### Jina

- The credential configured for the production worker was compared by exact value with the authenticated Jina dashboard and uniquely matched one key record. The credential itself is omitted.
- That exact key maps to the standard package used for the $0.05/M upper rate above.
- Automatic recharge is now confirmed **disabled** (`autoRecharge=false`) for that key. Its token balance was unchanged by the control change. No purchase or top-up occurred.

### Gemini

- The credential configured for production was compared by exact value with the authenticated Google AI Studio account and uniquely mapped to the expected DAR project. The credential and internal project identifier are omitted.
- The account shows **Billing Tier: Free** and offers setup of billing; no paid billing setup was performed.
- The account showed no model-usage rows in the preceding 28 days at inspection time.
- Google's public tariff page says `gemini-3.1-pro-preview` is unavailable on the Free tier, while `gemini-2.5-pro` has free-tier access. A Gemini 3.1 override would therefore be expected to fail under the current control state, not serve as a production fallback.

## Residual uncertainty and paid-canary controls

This documentation audit verifies published identifiers and tariffs; it does not prove live credential entitlement, provider health, rate-limit headroom, or successful inference. Proving those would require provider requests, which were intentionally prohibited for this zero-spend readiness pass.

For the controlled canary:

1. Keep the selected model fixed to `anthropic/claude-opus-5`, standard global inference.
2. Do not enable fast mode, regional/US-only processing, prompt caching, Gemini fallback, or unpriced grounding/tool options.
3. Keep Jina automatic recharge disabled and prohibit any automatic top-up.
4. Re-read these first-party pages within 24 hours of authorizing the paid canary, and recheck GPT-5.6 Sol after its promotional window if it is ever selected.
5. Treat any unknown provider/model identifier or request mode as fail-closed rather than estimating from a nearby tariff.

## Controlled-canary decision contract

The code and zero-spend evidence support a **conditional GO for one canary only
after** the exact reviewed DAR/DAMM identities and migration 0025 are deployed
and independently reverified. This is not authorization to create a workspace or
start a paid run.

- **Maximum authorized application spend:** strictly less than `$500` for the
  complete eight-stage workflow. This is a conservative reservation boundary,
  not an invoice guarantee or permission to top up any provider account.
- **Monitoring checkpoints:** after Stages 1–7, require cumulative settled spend
  plus unresolved reservations to remain at or below `$225`, `$262.50`,
  `$312.50`, `$350`, `$400`, `$425`, and then strictly below `$500`,
  respectively. Stage 8 must add no provider cost. At every checkpoint also
  record the sole worker claimant, lease margin, source identity, stage manifest,
  publication identity, and provider/model usage.
- **Acceptance:** exactly one newly authorized country/run reaches 8/8 without a
  pause, retry, resume, top-up, provider switch, or human intervention; each
  Stage 1–7 publication is owner-only and hash-valid while later stages run; the
  final immutable set contains the complete bundle, Draft MD/DOCX/PDF,
  cost-benefit workbook, source workbook, manifests, and declared stage
  artifacts; all package hashes verify; the run is `Draft · pre-review`; and no
  unresolved spend reservation remains.
- **Abort and preserve:** stop without retry or state repair on identity, tariff,
  entitlement, funding, claimant, or lease drift; any missing, malformed,
  ambiguous, unmetered, or over-reservation usage; a second paid transport;
  technical failure presented as evidence absence; exhausted semantic repair;
  empty, duplicate, truncated, stale, or out-of-contract content; any
  checkpoint/ledger/hash mismatch; missing stage publication or final artifact;
  or a rejected final database acknowledgement. Preserve the run for forensic
  reconciliation.

## Metadata disposition

No numeric change to `prices.json` was supported by this audit. Canonical DAMM
commit `76ca33d97f0809a6be7477447786953317aa41b5` incorporates the evidence-only
metadata follow-up: `_read_on` and provider verification dates are 2026-09-04,
the Jina production-key/package observation is recorded as verified, and
`claude-haiku-4-5` is explicitly identified as a valid mutable convenience alias
whose current canonical snapshot is `claude-haiku-4-5-20251001`.
