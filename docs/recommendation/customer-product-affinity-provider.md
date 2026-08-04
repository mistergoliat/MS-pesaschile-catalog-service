# Customer Product Affinity Provider

## Purpose

T09 transforms explicit customer-product evidence into structured affinity signals for a fixed batch of candidate products.

Customer affinity is not the final recommendation.

T09 does not decide what product should be recommended.

Its output is consumed by T10, where customer affinity is combined with commercial recommendations in a separate personalized recommendation layer.

## Ownership Versus Affinity

CP-R1-T10B3A audited how T09 represented "the customer already bought this product." The finding was that
`DIRECT_PRODUCT_PURCHASE` behaved as a weighted positive signal: a previous purchase raised `affinityScore`,
which raised `personalizedScore` in T10, which could raise the ranking of the very product the customer already
owns. That violates the approved policy:

```text
previously purchased product
    != automatic positive affinity
    != repurchase intent
    != automatic exclusion
```

CP-R1-T10B3B (this task) fixes the scoring semantics and introduces `ProductOwnershipEvidence`: a structural,
neutral fact, separate from `signals`/`score`/`confidence`. Ownership is visible to consumers, but it never moves
the ranking by itself. Explicit repurchase intent (a customer asking to buy the same product again) is a
different concept, deliberately **not** addressed here; see "Next Task".

## Product Ownership Contract

```text
ProductOwnershipEvidence
  previouslyPurchased: boolean
  exactVariantPreviouslyPurchased: boolean
  totalOrderCount?: non-negative integer
  firstPurchasedAt?: ISO-8601 timestamp
  lastPurchasedAt?: ISO-8601 timestamp
```

Rules enforced by `productOwnershipEvidenceSchema`:

- `exactVariantPreviouslyPurchased: true` requires `previouslyPurchased: true`.
- `firstPurchasedAt` must not be after `lastPurchasedAt` when both are present.
- No additional fields are accepted (`.strict()`), no amounts, no names, no commercial references, no PII.

`ownership` is optional on both `CustomerProductEvidence` (input, provider-supplied) and `CustomerProductAffinity`
(output, per candidate). It is absent when there is no ownership evidence; T09 never invents ownership.

## Architectural Boundary

The relationship engine publishes product-product knowledge through T01B-T07. T08 turns that published knowledge into commercial recommendation candidates. T09 is different: it does not discover products, does not read snapshots, and does not rank final recommendations.

The boundary is:

```text
candidate products + optional customer + neutral evidence provider
    -> Customer Product Affinity Provider
    -> per-product affinity signals
    -> T10 Personalized Recommendation Service
```

T09 depends only on a batch evidence port. It does not know whether evidence comes from CRM, Customer 360, PrestaShop, browsing history, campaign systems, files, fixtures, or another service.

## Contracts

The module defines neutral contracts for:

- `CustomerProductAffinityRequest`
- `CustomerAffinityCustomerReference`
- `CustomerAffinityContext`
- `CustomerAffinityParameters`
- `CustomerAffinityEvidenceProvider`
- `CustomerAffinityEvidenceResult`
- `CustomerProductEvidence`
- `ProductOwnershipEvidence`
- `CustomerCommercialProfileEvidence`
- `CustomerProductAffinityResult`
- `CustomerProductAffinity`
- `CustomerAffinitySignal`
- `CustomerAffinityEvidenceSummary`
- `CustomerAffinityWarning`
- `CustomerAffinityStatistics`

All public data contracts have Zod schemas. Details and warnings are restricted to JSON-serializable values.

## Batch Evidence Port

`CustomerAffinityEvidenceProvider.getEvidence(customer, products, context)` is called at most once per request, only when a customer is present and the deduplicated product list is not empty.

The provider receives candidate products deduplicated by the same runtime product identity used by T07/T08, preserving first occurrence order. Product base and product combinations remain distinct identities.

Provider responses are validated at the boundary: customer mismatch, products outside the requested batch, duplicated product identities, invalid timestamps, invalid counts, invalid money values, empty currencies, invalid enums, or non-serializable details produce `INVALID_PROVIDER_RESPONSE`. Invalid isolated evidence handed directly to the evaluator can be ignored with `INVALID_EVIDENCE_IGNORED` when the surrounding provider response has already been accepted.

## Signals V1

T09 supports these structured signals:

- `DIRECT_PRODUCT_PURCHASE` (deprecated since scoring v2, see "Legacy Direct Purchase Evidence")
- `CATEGORY_PURCHASE`
- `BRAND_PURCHASE`
- `RECENT_PRODUCT_INTEREST`
- `RECENT_CATEGORY_INTEREST`
- `PRODUCT_REJECTION`
- `CATEGORY_REJECTION`
- `OWNED_COMPATIBLE_PRODUCT`
- `REPEAT_PURCHASE_PATTERN`
- `OBSERVED_SPEND_FIT`

Rejection signals are negative. All other V1 signals are positive. Missing evidence is neutral and is not interpreted as rejection.

## Legacy Direct Purchase Evidence

`CustomerProductEvidence.directPurchases` is deprecated since `customer-affinity-v2`. It remains part of the
contract for backward compatibility with existing evidence sources, but `DefaultCustomerAffinityEvaluator` no
longer turns it into a `DIRECT_PRODUCT_PURCHASE` signal or evidence summary, and `DefaultCustomerAffinityScorer`
no longer gives that signal code a weighted contribution to `score` or `confidence` (defensively, even if some
other `CustomerAffinityEvaluator` implementation still emitted it).

The companion parameter `CustomerAffinityParameters.directProductPurchaseWeight` is also deprecated, not
removed: `customerAffinityParametersSchema` still accepts it (`.optional()`) so that a caller supplying a
v1-shaped parameters object does not fail validation. It is validated (rejects negative values, like every other
weight) but never read by `DefaultCustomerAffinityScorer` — its value has no effect on `score`, on the
denominator, or on `confidence`, whether it is `0`, `1`, or omitted entirely. `DEFAULT_CUSTOMER_AFFINITY_PARAMETERS`
does not materialize it, so v2 callers relying on defaults never see it.

Instead, when no explicit `ownership` is supplied, `directPurchases` is used only to *derive* `ownership`:

```text
if evidence.ownership is present
    -> use it as-is (provider is authoritative)
else if evidence.directPurchases has at least one entry
    -> ownership.previouslyPurchased = true
    -> ownership.exactVariantPreviouslyPurchased = candidate.combinationId !== undefined
    -> ownership.totalOrderCount = sum of directPurchases counts
    -> ownership.firstPurchasedAt / lastPurchasedAt = earliest / latest occurredAt
else
    -> ownership is absent (never invented)
```

`exactVariantPreviouslyPurchased` is derived from the **candidate's own reference**, not from the evidence
payload, because `DefaultCustomerProductAffinityProvider` already matches evidence to candidates by exact
runtime identity before the evaluator runs (see "Product And Variant Semantics"). A base-product candidate
(no `combinationId`) can never claim exact-variant ownership, because it does not represent a variant.

### Contradiction Between Explicit Ownership And Legacy Evidence

A provider response can, in principle, disagree with itself: `ownership.previouslyPurchased: false` alongside a
non-empty `directPurchases`. `DefaultCustomerAffinityEvaluator` does not merge these silently. Precedence is
fixed — explicit `ownership` always wins over anything derived from `directPurchases` — and the contradiction is
made visible with a structured warning:

```text
if ownership.previouslyPurchased === false and sum(directPurchases counts) > 0
    -> ownership stays exactly as the provider declared it (previouslyPurchased: false)
    -> a structured INVALID_EVIDENCE_IGNORED warning is added:
       { code: 'INVALID_EVIDENCE_IGNORED',
         productIdentity,
         details: { field: 'directPurchases', reason: 'contradicts_explicit_ownership' } }
```

`details` carries only a field name and a reason code — no counts, timestamps, or payload content — so the
warning stays safe to log and to surface without re-exposing raw evidence. `ownership.previouslyPurchased: true`
combined with `directPurchases` (empty or present) is **not** a contradiction and produces no warning, since
legacy evidence supporting a purchase that ownership also confirms is consistent, not conflicting.

## Scoring V2

`CUSTOMER_AFFINITY_SCORING_VERSION` is `customer-affinity-v2`. It introduces, relative to v1:

- `ProductOwnershipEvidence` as a neutral, non-scored fact.
- Retirement of `DIRECT_PRODUCT_PURCHASE` as a weighted score/confidence component.
- A temporal gate on `REPEAT_PURCHASE_PATTERN` (see "Repeat Purchase Temporal Gate").
- A fixed, documented reserve that keeps v1's overall score scale intact instead of silently inflating every
  remaining signal (see "Preserving The V1 Score Scale" below — this is a corrective decision from the
  CP-R1-T10B3B contract audit, not part of the original v2 change).

```text
positive =
  categoryPurchase * categoryPurchaseWeight
+ brandPurchase * brandPurchaseWeight
+ recentProductInterest * recentProductInterestWeight
+ recentCategoryInterest * recentCategoryInterestWeight
+ ownedCompatibleProduct * ownedCompatibleProductWeight
+ repeatPurchasePattern * repeatPurchasePatternWeight
+ observedSpendFit * observedSpendFitWeight

negative =
  productRejection * productRejectionPenalty
+ categoryRejection * categoryRejectionPenalty

maximumPositiveWeight =
  categoryPurchaseWeight + brandPurchaseWeight + recentProductInterestWeight
+ recentCategoryInterestWeight + ownedCompatibleProductWeight + repeatPurchasePatternWeight
+ observedSpendFitWeight + CUSTOMER_AFFINITY_V2_RESERVED_DIRECT_PURCHASE_WEIGHT   // fixed 0.20, see below

score = clamp((positive - negative) / maximumPositiveWeight, 0, 1)
```

The score is normalized to `0..1`. It is not a probability, not relationship reliability, not commercial score, and not final personalization.

### Preserving The V1 Score Scale

An earlier version of this change removed `directProductPurchaseWeight` from `maximumPositiveWeight` entirely.
That dropped the denominator from `1.0` (v1's default weights summed to exactly `1.0` by design) to `0.8`,
which silently inflated **every other positive signal's score by 25% in relative terms** for identical evidence
— a category-purchase-only candidate went from `0.10` to `0.125`, a recent-interest-only candidate from `0.25`
to `0.3125`, and so on. This was flagged as a contract defect during the CP-R1-T10B3A/T10B3B audit: retiring
`DIRECT_PRODUCT_PURCHASE` was meant to neutralize ownership, not recalibrate every other signal's weight.

The fix: `DefaultCustomerAffinityScorer` adds a fixed constant,
`CUSTOMER_AFFINITY_V2_RESERVED_DIRECT_PURCHASE_WEIGHT = 0.2`, to `maximumPositiveWeight` unconditionally — it is
a literal, not read from `parameters` (the deprecated `directProductPurchaseWeight` parameter, see above, has no
effect on it, whatever value it is set to). With `DEFAULT_CUSTOMER_AFFINITY_PARAMETERS`, this restores the historical `1.0` denominator
(`0.8` from the 7 remaining weights + the `0.2` reserve), so every individual signal's score matches its v1
value exactly:

| Signal (strength 1) | Weight | v2 score |
|---|---:|---:|
| `CATEGORY_PURCHASE` | 0.10 | 0.10 |
| `BRAND_PURCHASE` | 0.05 | 0.05 |
| `RECENT_PRODUCT_INTEREST` | 0.25 | 0.25 |
| `RECENT_CATEGORY_INTEREST` | 0.10 | 0.10 |
| `OWNED_COMPATIBLE_PRODUCT` | 0.15 | 0.15 |
| `REPEAT_PURCHASE_PATTERN` | 0.10 | 0.10 |
| `OBSERVED_SPEND_FIT` | 0.05 | 0.05 |
| all seven combined | — | **0.80** |

The trade-off, made explicitly as a product decision: with default parameters, no combination of the remaining
seven signals can reach a score of `1.0` anymore — `0.80` is the new effective ceiling, because the `0.20` slot
that `DIRECT_PRODUCT_PURCHASE` used to fill stays reserved and unweighted. This is intentional: it protects
existing rankings that were calibrated against the `0..1` v1 scale from an unplanned across-the-board boost,
at the cost of no longer using the full range with the current signal set.

## Confidence

Confidence is calculated separately from score:

- `none`: no valid evidence.
- `low`: one signal type or insufficient evidence.
- `medium`: at least two signal types and the configured medium evidence threshold.
- `high`: at least three signal types and the configured high evidence threshold.

Negative evidence contributes to confidence because confidence describes evidence sufficiency, not positive affinity.

`ProductOwnershipEvidence` never contributes to confidence: it is not part of `signals` or `evidence`, so it
cannot change `distinctSignalTypes` or `validEvidenceCount`. The legacy `DIRECT_PRODUCT_PURCHASE` code is also
excluded from `distinctSignalTypes` in the scorer itself, so a customer whose only evidence is a past purchase
of the exact candidate keeps `confidence: 'none'` and `score: 0`.

## Repeat Purchase Temporal Gate

`REPEAT_PURCHASE_PATTERN` previously activated from `purchaseCount >= 2` alone, with no time bound: a durable
good bought twice a decade apart scored the same as a consumable bought twice last month. `customer-affinity-v2`
adds `repeatPurchaseWindowDays` (default `365`, documented, conservative) to `customerAffinityParametersSchema`.

The signal only activates when all of these hold:

```text
purchaseCount >= 2
lastPurchasedAt is present
context.referenceTime is present
lastPurchasedAt is within repeatPurchaseWindowDays of context.referenceTime (inclusive boundary)
```

If `context.referenceTime` is missing while a `repeatPurchasePattern` with `purchaseCount >= 2` exists, T09 emits
the existing `REFERENCE_TIME_UNAVAILABLE` warning (`details.signal = 'REPEAT_PURCHASE_PATTERN'`), mirroring how
`RECENT_PRODUCT_INTEREST`/`RECENT_CATEGORY_INTEREST` already report the same gap. If only `lastPurchasedAt` is
missing, or the timestamp falls outside the window (including in the future relative to `referenceTime`), T09
stays neutral: no signal, no warning, matching how a missing per-item `occurredAt` is already handled for
interests.

This window only reduces risk. It does **not** classify a product as durable or consumable, and it does not
implement a replenishment/reorder model — CP-R1-T10B3A already noted that gap and this task does not close it.
A durable good repurchased within the window (e.g. two accessory purchases 60 days apart) can still activate the
signal; that remains a known, documented limitation, not a bug this task fixes.

## Product And Variant Semantics

`DefaultCustomerProductAffinityProvider` deduplicates and matches evidence to candidates by
`createProductRuntimeIdentity` (`productId::combinationId`, or `productId::<base>` when there is no
combination) — the same identity function used across T07/T08/T10/T11. A provider response can only contain
evidence for products inside the requested batch, matched one-to-one by that identity; anything else is rejected
as `INVALID_PROVIDER_RESPONSE` before the evaluator ever runs. This is what makes it safe for
`deriveOwnership()` to read `exactVariantPreviouslyPurchased` off the candidate reference itself instead of
re-deriving it from the evidence payload.

### What T09 Verifies, And What It Cannot

T09 verifies, structurally, for every `CustomerProductEvidence` entry in a provider response:

- it matches exactly one product/combination identity requested in the current batch;
- no two entries in the same response share an identity (rejected as `INVALID_PROVIDER_RESPONSE`);
- an entry never leaks into a different candidate's evaluation — a candidate with no matching entry is
  evaluated with `evidence: undefined` (neutral, `NO_CUSTOMER_HISTORY` or `PARTIAL_CUSTOMER_HISTORY`), never
  with another candidate's data.

T09 **cannot** verify, and does not attempt to verify, whether the evidence *inside* an entry is actually true
of the identity declared in that entry's `.product` field. `directPurchases`, `ownership`,
`repeatPurchasePattern`, and every other nested field are trusted as-is once the entry's own identity has been
validated. This is a contractual obligation on the evidence provider, not something T09's code enforces:

- **every `CustomerProductEvidence` entry must represent the exact identity declared in its `.product` field** —
  the specific combination if `combinationId` is present, the base product if it is not;
- **`directPurchases` (and any other nested evidence) inside an entry must correspond to that same identity** —
  a provider must not label an entry `{ productId: 'B', combinationId: '10' }` while the underlying purchase
  data actually covers a different combination, or the base product in general;
- **a provider that only has purchase data aggregated at the base-product level (no combination breakdown)
  must report it under the base identity (`{ productId }`, no `combinationId`) — never attach it to a specific
  variant's entry as if it were variant-exact evidence**;
- **base-product evidence must not be propagated to variant candidates, and one variant's evidence must not be
  propagated to a different variant of the same base product.** T09's batch matching already enforces this on
  its side (see tests below); the provider must not defeat it by mislabeling entries.

`HttpCustomerAffinityEvidenceProvider` (CP-R1-T10B4B, see "HTTP Evidence Adapter" below) is the first real
provider that has to honor these obligations against a live contract. It reports ownership under
`{ productId: String(row.productId) }` when Customer Profile's `productAttributeId` is `0`, and under
`{ productId: String(row.productId), combinationId: String(row.productAttributeId) }` when it is greater than
zero — never mixing the two, and never attaching one variant's row to a different variant's identity.

## Neutrality

`ProductOwnershipEvidence` is guaranteed neutral by construction, not by convention:

- it is a separate field from `signals`/`evidence`/`score`/`confidence` on `CustomerProductAffinity`, so nothing
  that reads `ownership` can also silently read it as a scoring input;
- `DefaultCustomerAffinityScorer`'s formula has no term that references `ownership`;
- `distinctSignalTypes` and `validEvidenceCount` (the only confidence inputs) are derived exclusively from
  `signals`/`evidence`, which `deriveOwnership()` never writes to;
- the provider clones and deep-freezes `ownership` the same way it does every other result field (see
  "Immutability"), so a caller cannot mutate it back into relevance.

Closing property: an evidence payload that only proves "the customer bought this before" can never, by itself,
produce `affinityScore > 0`, `confidence > 'none'`, an explicit-preference boost, an exclusion, or a repurchase
intent. It produces exactly `ownership.previouslyPurchased = true` and nothing else.

## Warnings

Warnings are structured and may be global or per-product:

- `CUSTOMER_NOT_IDENTIFIED`
- `NO_CUSTOMER_HISTORY`
- `PARTIAL_CUSTOMER_HISTORY`
- `REFERENCE_TIME_UNAVAILABLE`
- `INVALID_EVIDENCE_IGNORED`
- `CURRENCY_MISMATCH`
- `SPEND_PROFILE_UNAVAILABLE`
- `AFFINITY_PROVIDER_WARNING`
- `CUSTOMER_HISTORY_NOT_LINKED` (CP-R1-T10B4A, global only — see "Customer History Availability")
- `CUSTOMER_REFERENCE_NOT_FOUND` (CP-R1-T10B4A, global only — see "Customer History Availability")

Warnings are not commercial text and must not contain raw operational payloads, stack traces, secrets, or unnecessary PII.

## Missing Customer

When `customer` is omitted, T09 does not call the evidence provider. It returns one neutral affinity per deduplicated product with score `0`, confidence `none`, empty signals, empty evidence, and a global `CUSTOMER_NOT_IDENTIFIED` warning.

This lets T10 degrade to general commercial recommendations.

## Missing History

When a customer exists, the evidence provider was actually consulted, and it confirmed there is no product
evidence, T09 returns neutral affinities, per-product `NO_CUSTOMER_HISTORY` warnings, and a global
`NO_CUSTOMER_HISTORY` warning. This is not an error and does not exclude candidates.

`NO_CUSTOMER_HISTORY` means exactly that and nothing more: a lookup completed and confirmed zero purchases. It
does **not** mean the customer's identity could not be resolved, or that the customer has no PrestaShop link —
see "Customer History Availability" below for those two distinct states, added in CP-R1-T10B4A.

When evidence exists for only part of the batch, available products are evaluated and missing products degrade neutrally with `PARTIAL_CUSTOMER_HISTORY`.

## Customer History Availability (CP-R1-T10B4A)

An audit ahead of the future Customer Profile HTTP adapter (T10B4) found that T09 had no way to represent two
functional facts a real evidence source can return, distinct from "queried and empty":

- the master customer exists but has no usable PrestaShop link — history could not be consulted at all;
- the customer reference itself does not exist — an identity T09 cannot vouch for.

Before this task, both would have had to be squeezed into `NO_CUSTOMER_HISTORY` (losing the distinction) or into
`AFFINITY_PROVIDER_WARNING` (losing the code entirely — see "Provider Warning Mapping" below). Neither is
correct: "history not linked" and "customer not found" are not "zero purchases confirmed."

### Confirmed Empty History

Unchanged. Provider responds:

```json
{ "customer": { "customerId": "..." }, "productEvidence": [], "warnings": [] }
```

Result: `NO_CUSTOMER_HISTORY` (global and per-product), `customerAffinity` stage `completed`,
`execution.degraded = false`, `ownership` absent, `score: 0`, `confidence: 'none'`.

### Customer History Not Linked

Provider declares the reserved warning code `customer_history_not_linked` (see "Provider Warning Mapping"):

```json
{ "customer": { "customerId": "..." }, "productEvidence": [], "warnings": [{ "code": "customer_history_not_linked" }] }
```

T09 maps this to a single **global** `CUSTOMER_HISTORY_NOT_LINKED` warning. Semantics:

- the master customer exists;
- there is no usable link to PrestaShop (or equivalent commerce system) to consult;
- history was never actually queried — this is not "zero purchases";
- not a technical failure — do not confuse with `EVIDENCE_PROVIDER_FAILED`/`CUSTOMER_AFFINITY_UNAVAILABLE`;
- not retryable by default (retrying does not create a link);
- creates no `ownership` (never a synthesized `previouslyPurchased: false`);
- does not affect `score`, `confidence`, `signals`, `evidence`, or ranking.

### Customer Reference Not Found

Provider declares the reserved warning code `customer_reference_not_found`:

```json
{ "customer": { "customerId": "..." }, "productEvidence": [], "warnings": [{ "code": "customer_reference_not_found" }] }
```

T09 maps this to a single **global** `CUSTOMER_REFERENCE_NOT_FOUND` warning. Semantics:

- the master customer identifier does not exist as far as the evidence source can tell;
- represents an unresolved/inconsistent identity, not zero purchases;
- not a technical failure, not retryable by default;
- creates no `ownership`, does not affect `score`, `confidence`, `signals`, `evidence`, or ranking.

### Functional State Versus Technical Degradation

`CUSTOMER_HISTORY_NOT_LINKED` and `CUSTOMER_REFERENCE_NOT_FOUND` are **not** degradation. Both are returned by a
`getEvidence()` call that completed normally (no thrown error): `customerAffinity` stage stays `completed`,
`execution.degraded` stays `false`, and `CUSTOMER_AFFINITY_UNAVAILABLE` never appears alongside them. A real
provider failure — timeout, connection error, malformed response — still goes through "Degradation" below,
unchanged: `EVIDENCE_PROVIDER_FAILED` / `INVALID_PROVIDER_RESPONSE`, `execution.degraded = true`, stage
`degraded`, warning `CUSTOMER_AFFINITY_UNAVAILABLE`. The two families must never be mixed: a provider that cannot
reach its backing store throws; a provider that successfully learns "not linked" or "not found" returns a
normal result carrying one of these two warnings.

### Provider Warning Mapping

`CUSTOMER_AFFINITY_RESERVED_PROVIDER_WARNING_CODES` (`contracts.ts`) is the exact-string whitelist a provider
warning's `code` is checked against:

```text
'customer_history_not_linked'   -> CUSTOMER_HISTORY_NOT_LINKED   (global)
'customer_reference_not_found'  -> CUSTOMER_REFERENCE_NOT_FOUND  (global)
anything else                   -> AFFINITY_PROVIDER_WARNING     (global, one entry per unrecognized warning, unchanged)
```

The match is exact-string, not a passthrough: a provider cannot inject an arbitrary T09-internal code by
spelling it (e.g. a provider warning literally coded `'NO_CUSTOMER_HISTORY'` still maps to
`AFFINITY_PROVIDER_WARNING`, never to a real T09 output code). `customerAffinityProviderWarningSchema.code`
remains an open, free-form string — the whitelist lives only in the mapping function, so unknown provider
warnings keep working exactly as before this task (see "Provider Warning Mapping" is additive, not a schema
restriction).

A duplicate reserved code (the same warning sent more than once) collapses into a single global entry — it does
not multiply `warningsGenerated`.

**Mutually exclusive, rejected rather than resolved by precedence.** `CUSTOMER_HISTORY_NOT_LINKED` and
`CUSTOMER_REFERENCE_NOT_FOUND` describe contradictory facts about the same customer (existing-but-unlinked vs.
not existing). A provider response declaring both is rejected as `INVALID_PROVIDER_RESPONSE` rather than
silently picking one — there is no documented precedence to fall back on, because there is no valid scenario
where both are simultaneously true. For the same reason, a reserved code alongside non-empty `productEvidence`
is also rejected as `INVALID_PROVIDER_RESPONSE`: a provider cannot assert "history could not be consulted" and
supply actual product evidence in the same response.

### Neutrality

For both new codes, every candidate in the batch receives the exact same neutral shape produced by "Missing
Customer" (`neutralAffinity`, no per-product warning): `score: 0`, `confidence: 'none'`, `signals: []`,
`evidence: []`, no `ownership`. The evaluator is never invoked for these two states — not even the evaluator's
own `NO_CUSTOMER_HISTORY`-for-undefined-evidence path — so no per-product warning of any kind is added. Neither
code is associated with a specific product; both are global-only.

### Statistics

`productsWithEvidence` is `0` and `productsWithoutEvidence` equals the deduplicated batch size, same as confirmed
empty history (the reserved-response guard above guarantees `productEvidence` is empty whenever a reserved code
is present). `warningsGenerated` counts exactly one global warning per reserved-state response (plus any
unrelated unrecognized provider warnings, mapped to `AFFINITY_PROVIDER_WARNING` as usual) — zero per-product
warnings, since no candidate receives one.

## Degradation

Three providers exist, selected by `CUSTOMER_AFFINITY_PROVIDER_MODE` (`'unavailable'`, `'empty'`, or `'http'`;
default `'unavailable'`):

- `EmptyCustomerAffinityEvidenceProvider` (`src/infrastructure/recommendation/customerAffinityEvidenceProviders.ts`)
  always returns `productEvidence: []`. It never invents `ownership`; the result is the same "no history" neutral
  affinity described in "Missing History".
- `UnavailableCustomerAffinityEvidenceProvider` (same file) always throws `EVIDENCE_PROVIDER_FAILED` with
  `retryable: true`. `DefaultCustomerProductAffinityProvider.getAffinities` also wraps *any* exception thrown by
  `evidenceProvider.getEvidence(...)` into a `retryable: true` `EVIDENCE_PROVIDER_FAILED` error — a network or
  timeout failure from a real provider degrades the same way.
- `HttpCustomerAffinityEvidenceProvider` (CP-R1-T10B4B,
  `src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.ts`) is the real provider backed by
  Customer Profile's HTTP API. See "HTTP Evidence Adapter" below and
  `docs/releases/CP-R1-T10B4B-customer-profile-http-evidence-adapter.md` for the full contract.
- A structurally invalid provider response (wrong customer, evidence outside the batch, duplicated product
  evidence) is rejected as `INVALID_PROVIDER_RESPONSE`, which is **not** retryable by default. This is an
  existing behavior this task does not change; T11 currently treats it as a hard failure rather than a
  degradable one (documented as a known gap, out of scope here — see "Explicitly Out Of Scope").

## HTTP Evidence Adapter (CP-R1-T10B4B)

`HttpCustomerAffinityEvidenceProvider` queries Customer Profile's
`GET /v1/customers/:masterCustomerId/purchased-products` and maps real historical purchases into positive-only
`ProductOwnershipEvidence`. Summary (full detail in the release doc):

- **Customer identity**: in `mode=http`, `customer.customerId` is interpreted specifically as Customer Profile's
  `masterCustomerId` — a numeric string, trimmed, not `'0'`, bounded to Customer Profile's own length limit.
  Validated before any HTTP request is built; an invalid reference throws (surfaces as `EVIDENCE_PROVIDER_FAILED`
  through the same wrapping as any other provider failure). Never a PrestaShop `id_customer`, email, phone, or
  DNI — that distinction is not enforced by T09's own `CustomerAffinityCustomerReference` schema, so it is this
  adapter's own responsibility.
- **Pagination**: `limit=100`, `offset` incremented until `pagination.hasMore === false`, one shared timeout
  across every page. Guards against a misbehaving upstream (page count, total row count, offset/limit/returned
  consistency, no duplicate product/variant identity across or within pages) all throw rather than silently
  truncating or double-counting.
- **Positive-only ownership**: only rows matching a requested candidate produce `CustomerProductEvidence`; an
  unmatched candidate is simply omitted (never `previouslyPurchased: false`) — Customer Profile only certifies
  history for one linked PrestaShop account, so absence never proves "never purchased."
- **Functional states**: `customer_not_linked` / `customer_not_found` return a normal result carrying
  `customer_history_not_linked` / `customer_reference_not_found` (T09's reserved provider-warning vocabulary, see
  "Provider Warning Mapping" above) — never a thrown error, never `ownership`.
- **Technical failures**: HTTP timeout, network error, `5xx`, `401`/`403`/`400`, a `degraded` response
  (`prestashop_unavailable`/`prestashop_timeout`), or any schema-invalid payload all throw — degrading exactly
  like `UnavailableCustomerAffinityEvidenceProvider` above.
- **Security**: never logs the raw response body, the full request URL, or `masterCustomerId`; Customer Profile
  has no authentication today, so `mode=http` must only be enabled against a private-network or
  gateway-protected instance.

## Determinism

T09 does not use implicit clock access, random values, UUIDs, SQL, runtime lookup, or hidden weights. Recency calculations require an explicit `context.referenceTime`. The same request, provider response, parameters, and scoring version produce the same result.

## Immutability

Results are cloned and deeply frozen before being returned. Provider objects and request objects are not exposed by mutable reference.

## Privacy

T09 consumes already-resolved, already-permitted, structured evidence. It does not resolve customer identity, create customer identifiers, decrypt data, or expose raw history. Evidence summaries are compact, structured, and JSON serializable.

## T10 Integration

T10 consumes T08 commercial candidates and T09 customer affinity signals to build final personalized recommendations. T09 intentionally does not perform reranking, 1:1 personalization, commercial selection, campaign logic, cart mutation, order creation, or copy generation.

## V1 Limits

T09 V1 does not implement:

- final personalization;
- reranking;
- candidate discovery;
- T07 snapshot lookup;
- T08 score modification;
- CRM adapters;
- Customer 360 integration;
- PrestaShop integration;
- SQL, migrations, Redis, endpoints, or E2E integration;
- ML, LLM, collaborative filtering, embeddings, campaigns, or promotions.

## Explicitly Out Of Scope (CP-R1-T10B3B)

This task fixes T09's ownership scoring semantics only. It deliberately does not implement:

- public propagation of `ownership` through T10's response schema beyond the type-level pass-through required
  for `CustomerProductAffinity` to keep compiling (T10's scorer and reason-mapping are untouched);
- public propagation of `ownership` through T11's HTTP response (`SearchProductsV2Recommendation` is unchanged);
- `context.explicitRepurchaseProducts` / `EXPLICIT_REPURCHASE_INTENT` or any repurchase boost;
- a Customer Profile HTTP evidence provider or `CUSTOMER_AFFINITY_PROVIDER_MODE=http`;
- CRM Customer 360 integration or Sales Agent integration;
- `masterCustomerId` resolution;
- durable-versus-consumable product classification (the temporal gate on `REPEAT_PURCHASE_PATTERN` reduces risk,
  it does not solve this);
- technical compatibility validation for `OWNED_COMPATIBLE_PRODUCT` (still fully trusts the evidence provider);
- any new ranking engine.

## Explicitly Out Of Scope (CP-R1-T10B4A)

This task closes the customer-history-availability warning vocabulary only. It deliberately does not implement:

- a Customer Profile HTTP evidence adapter, `fetch`, pagination, base URL, HTTP timeout, or
  `CUSTOMER_AFFINITY_PROVIDER_MODE=http` (see "Next Task");
- authentication against Customer Profile;
- any mapping from Customer Profile's `purchased-products` endpoint into `CustomerProductEvidence`;
- ever setting `ownership.previouslyPurchased` to `true` or `false` from either new state — both remain
  ownership-absent, exactly like confirmed empty history;
- `masterCustomerId` resolution, CRM, RFM, clustering, or segmentation;
- any scoring change (`customer-affinity-v2` is untouched) or new structured `signals`/`reasons`;
- changes to T10 (`personalized-recommendation`) — the two new codes are read directly from T09's result by T11,
  the same way `NO_CUSTOMER_HISTORY`/`PARTIAL_CUSTOMER_HISTORY` already were; T10's own contracts are unchanged.

## Explicitly Out Of Scope (CP-R1-T10B4B)

This task implements the HTTP evidence adapter only. It deliberately does not implement:

- authentication against Customer Profile, or an outbound API key/credential of any kind;
- retries, a circuit breaker, or a cache in front of Customer Profile;
- `masterCustomerId` resolution, `identityType`, CRM Customer 360 integration, or Sales Agent integration;
- RFM, clustering, lifecycle, category/brand affinity, repeat-purchase mapping, observed spend, interests,
  `preferredProducts`, `explicitRepurchaseProducts`, or durable/consumable classification;
- any change to T09's contracts, T10B4A's warning semantics, or scoring/ranking;
- a batch/filtered Customer Profile endpoint — this adapter always reads the customer's full purchased-products
  history and matches it locally against the requested candidate batch.

## Next Task

CP-R1-T10B5 — CRM SearchProducts V2 Client and Identity Wiring.
