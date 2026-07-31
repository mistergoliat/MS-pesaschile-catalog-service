# Personalized Recommendation Service

## Purpose

T10 personalizes existing commercial candidates.

T10 does not discover products.

It receives T08 commercial recommendations and optional T09 customer affinity, combines both layers deterministically, and returns a personalized ranked list with auditable score components, structured reasons, warnings, exclusions, and statistics.

## Architectural Boundary

T08 remains the authority for commercial eligibility.

T09 remains the authority for customer affinity.

T10 is a pure composition layer:

```text
T08 commercial recommendations
+ T09 customer affinities
+ explicit personalization context
+ explicit parameters
    -> T10 Personalized Recommendation Service
    -> personalized ranked recommendations
```

T10 does not execute T08, execute T09, call T07, call providers, consult customer history, consult catalog data, consult stock, consult prices, or access infrastructure.

## Contracts

The module defines:

- `PersonalizedRecommendationRequest`
- `PersonalizedRecommendationContext`
- `PersonalizedRecommendationParameters`
- `PersonalizedRecommendationScorer`
- `PersonalizedRecommendationService`
- `PersonalizedRecommendationResult`
- `PersonalizedRecommendation`
- `PersonalizedRecommendationScoreComponents`
- `PersonalizedRecommendationReason`
- `PersonalizedRecommendationExclusion`
- `PersonalizedRecommendationWarning`
- `PersonalizedRecommendationStatistics`
- `PersonalizedRecommendationError`

Public schemas validate request shape, context, parameters, score components, reasons, warnings, exclusions, statistics, and result invariants.

CP-R1-T10B3C additions, all optional/additive: `PersonalizedRecommendationContext.explicitRepurchaseProductIds`,
`PersonalizedRecommendationParameters.explicitRepurchaseBoost`,
`PersonalizedRecommendationScoreComponents.explicitRepurchaseContribution`, `PersonalizedRecommendation.ownership`
(`ProductOwnershipEvidence`, re-exported from the T09 `customer-affinity` module — T10 does not redefine it).

## Scoring V2

T08 exposes commercial score in `0..100`; T10 normalizes it to `0..1` and does not recalculate it.

```text
commercialContribution =
  commercialScore * commercialWeight

effectiveAffinity =
  affinityScore * confidenceMultiplier

affinityContribution =
  effectiveAffinity * affinityWeight

preferenceBoost =
  explicit preference match (preferredProductIds) ? explicitPreferenceBoost : 0

repurchaseContribution =
  explicit repurchase match (explicitRepurchaseProductIds, exact runtime identity) ? explicitRepurchaseBoost : 0

rejectionPenalty =
  productRejection + categoryRejection

rawScore =
  commercialContribution
+ affinityContribution
+ preferenceBoost
+ repurchaseContribution
- rejectionPenalty

finalScore = clamp(rawScore, 0, 1)
```

`PERSONALIZED_RECOMMENDATION_SCORING_VERSION` is `personalized-recommendation-v2` (CP-R1-T10B3C, additive: a new
term was added, none of the existing commercial/affinity/preference terms changed). The personalized score is
not a probability and is only comparable within the same scoring version.

`explicitRepurchaseBoost` (default `0.15`) is a separate parameter from `explicitPreferenceBoost` (default
`0.1`) — see "Explicit Repurchase" below for why they must never be reused for each other.

## Confidence Multipliers

Default multipliers:

- `none`: `0.00`
- `low`: `0.35`
- `medium`: `0.70`
- `high`: `1.00`

Confidence controls how much affinity contributes. T10 does not recalculate T09 confidence.

## Rejections

`PRODUCT_REJECTION` from T09 excludes the product from the final ranking using `EXPLICIT_PRODUCT_REJECTION`.

`CATEGORY_REJECTION` applies a penalty and does not exclude by itself in V1.

Explicit context exclusions have precedence over affinity and score.

## Exclusions

Each commercial candidate reaches exactly one terminal state: returned recommendation or one exclusion. Exclusion precedence is:

1. `EXPLICIT_CONTEXT_EXCLUSION`
2. `EXPLICIT_PRODUCT_REJECTION`
3. `BELOW_MINIMUM_PERSONALIZED_SCORE`
4. `RESULT_LIMIT_TRUNCATION`

T10 never replaces excluded candidates with products outside T08.

## Degradation

When T09 is omitted, T10 emits `CUSTOMER_AFFINITY_UNAVAILABLE`, uses affinity score `0`, confidence `none`, and preserves commercial ranking.

When customer affinity indicates `CUSTOMER_NOT_IDENTIFIED`, T10 preserves the warning and degrades to commercial ranking when all affinities are neutral.

When there is no customer history, affinity contribution is `0`; candidates are not excluded.

When affinity is partial, candidates with affinity are personalized and missing candidates receive `AFFINITY_MISSING_FOR_PRODUCT`.

## Ranking

Ranking uses an explicit comparator:

```text
1. finalScore descending
2. commercialScore descending
3. originalCommercialRank ascending
4. product runtime identity ascending
```

When affinity is neutral and no context applies, ranking is identical to T08 commercial order.

## Structured Reasons

Reasons are enum-based and deduplicated by code:

- `STRONG_COMMERCIAL_RELEVANCE`
- `CUSTOMER_PRODUCT_AFFINITY`
- `CUSTOMER_CATEGORY_AFFINITY`
- `CUSTOMER_BRAND_AFFINITY`
- `RECENT_PRODUCT_INTEREST`
- `RECENT_CATEGORY_INTEREST`
- `OWNED_COMPATIBLE_PRODUCT`
- `REPEAT_PURCHASE_PATTERN`
- `OBSERVED_SPEND_COMPATIBILITY`
- `EXPLICIT_REPURCHASE_INTENT`
- `EXPLICIT_CONTEXT_PREFERENCE`
- `GENERAL_COMMERCIAL_FALLBACK`

`EXPLICIT_REPURCHASE_INTENT` is added only when `components.explicitRepurchaseContribution > 0` for that exact
candidate. It never appears because of ownership, legacy `directPurchases`, `REPEAT_PURCHASE_PATTERN`, or
`preferredProductIds` alone — those keep producing their own existing reason codes (or none, for ownership).
`EXPLICIT_CONTEXT_PREFERENCE`'s meaning is unchanged; a candidate can carry both reasons simultaneously
(deduplicated by code, not merged) when the caller sends the same identity in both `preferredProductIds` and
`explicitRepurchaseProductIds` — they represent distinct signals (general taste vs. current repurchase intent).

T10 does not generate commercial copy or natural-language sales arguments.

## Ownership Propagation

`PersonalizedRecommendation.ownership?: ProductOwnershipEvidence` is a pass-through of
`CustomerProductAffinity.ownership` for the exact matched candidate, added in CP-R1-T10B3C. T10:

- clones it (`cloneJsonValue`) and deep-freezes it exactly like every other result field;
- never recalculates, reinterprets, or validates its business meaning — T09 already did that;
- never turns it into a `signal`, a `reason`, a scoring input, or an exclusion;
- never invents `previouslyPurchased: false` when T09 did not provide ownership — **absence of ownership means
  "no data", not "never purchased"**. A candidate with no matching T09 affinity entry, or a matching entry
  without `ownership`, simply has `ownership: undefined` on the result.

This is the T10 half of CP-R1-T10B3B's neutrality guarantee: ownership was already guaranteed not to affect
`score`/`confidence`/`signals` inside T09; T10 now guarantees it does not affect `personalizedScore`, `reasons`,
`personalizedRank`, or `statistics` either, all the way to the response T11 exposes.

## Explicit Repurchase

`PersonalizedRecommendationContext.explicitRepurchaseProductIds?: readonly ProductRuntimeReference[]` represents
current, caller-declared intent: "the customer wants to buy this exact product or variant again, right now." It
is structurally identical in shape to `preferredProductIds`/`excludedProductIds` (an array of product
references matched by exact runtime identity) but semantically distinct and contractually separate:

```text
source                    | preferredProductIds        | explicitRepurchaseProductIds
---------------------------------------------------------------------------------------
meaning                   | general taste/preference    | current repurchase intent
boost parameter           | explicitPreferenceBoost      | explicitRepurchaseBoost
default value              | 0.10                        | 0.15
reason code                | EXPLICIT_CONTEXT_PREFERENCE | EXPLICIT_REPURCHASE_INTENT
derived from history?      | never                        | never
```

T10 never derives `explicitRepurchaseProductIds` from anything — not `ownership`, not legacy `directPurchases`,
not `REPEAT_PURCHASE_PATTERN`, not `preferredProductIds`. It is populated exclusively by the caller (T11, from
`context.explicitRepurchaseProducts`, itself populated exclusively by whatever declared the customer's current
intent — a Sales Agent conversation, not an inference from Customer Profile history). The two boost parameters
are never substituted for each other, by design: reusing `explicitPreferenceBoost` for repurchase would erase
the audit trail this task exists to create.

The match is by exact runtime product identity (`createProductRuntimeIdentity`, the same function used
everywhere in this codebase for product/variant identity): repurchasing the base product does not boost any of
its variants, and repurchasing one variant does not boost a different variant of the same base product. See
"Product And Variant Semantics" in `docs/recommendation/search-products-v2.md` for the full identity model.

## Statistics

Statistics track commercial candidates received, affinity entries received, candidates with/without affinity, ignored affinities, each exclusion category, returned recommendations, effective personalization, commercial fallback, and warnings.

`recommendationsWithEffectivePersonalization` and `commercialFallbackRecommendations` (CP-R1-T10B3C) now also
account for `components.explicitRepurchaseContribution`: a candidate boosted by repurchase intent alone counts
as effectively personalized, not as a commercial fallback, keeping both counters an exact partition of
`personalizedRecommendationsReturned`. No new statistics field was added — the task only required correcting
this existing pair to stay consistent with the new score component (see the schema's own invariant below).
Ownership does not participate in this counter, by design (see "Ownership Propagation").

Core invariants:

```text
candidatesWithAffinity + candidatesWithoutAffinity
= commercialCandidatesReceived
```

```text
returned + contextExclusions + rejectionExclusions
+ minimumScoreExclusions + resultLimitTruncations
= commercialCandidatesReceived
```

## Determinism

T10 uses no implicit clock, random values, UUIDs, hidden weights, providers, T07 lookup, or infrastructure access. The same T08 result, T09 result, context, parameters, and scoring version produce the same output.

## Immutability

The result is cloned and deeply frozen before return. T10 does not mutate T08 result objects, T09 affinity objects, request objects, arrays, reasons, warnings, exclusions, score components, or statistics.

## Privacy

T10 only consumes structured affinity summaries from T09. It does not read raw customer history, resolve identity, query CRM, query Customer 360, call PrestaShop, or expose provider payloads.

## T11 Integration

T11 calls the commercial recommendation layer and customer affinity layer, then passes their outputs to T10. T10 intentionally does not implement `search-products-v2`, endpoints, controllers, routing, agent responses, cart operations, checkout, orders, or E2E integration.

## V1 Limits

T10 V1 does not implement:

- product discovery;
- endpoint implementation;
- T07 snapshot lookup;
- provider execution;
- SQL, migrations, Redis, cache, events, or infrastructure;
- CRM, Customer 360, PrestaShop, catalog, stock, or price lookups;
- LLM, ML, embeddings, campaigns, promotions, or generated copy;
- cart, checkout, order, quote, or E2E flows.

## Explicitly Out Of Scope (CP-R1-T10B3C)

This task propagates ownership neutrally and adds explicit repurchase scoring. It deliberately does not
implement:

- a Customer Profile HTTP evidence adapter or `CUSTOMER_AFFINITY_PROVIDER_MODE=http` (T09 still only has the
  `empty`/`unavailable` stub providers; T10 has no idea whether ownership ever contains real data);
- CRM Customer 360 integration, identity resolution, or `masterCustomerId`;
- durable-versus-consumable product classification for `REPEAT_PURCHASE_PATTERN`;
- RFM, clustering, or lifecycle segmentation — full customer history exists to inform those, in Customer
  Profile, not to become a Catalog Service recommendation strategy;
- any new ranking engine outside SearchProducts V2;
- resolving how a Sales Agent or CRM decides *when* to populate `explicitRepurchaseProductIds` — T10 only
  scores whatever intent it is given.

## Next Task

CP-R1-T10B4 — Customer Profile Evidence Adapter.
