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

## Scoring V1

T08 exposes commercial score in `0..100`; T10 normalizes it to `0..1` and does not recalculate it.

```text
commercialContribution =
  commercialScore * commercialWeight

effectiveAffinity =
  affinityScore * confidenceMultiplier

affinityContribution =
  effectiveAffinity * affinityWeight

preferenceBoost =
  explicit preference match ? explicitPreferenceBoost : 0

rejectionPenalty =
  productRejection + categoryRejection

rawScore =
  commercialContribution
+ affinityContribution
+ preferenceBoost
- rejectionPenalty

finalScore = clamp(rawScore, 0, 1)
```

The personalized score is not a probability and is only comparable within `personalized-recommendation-v1`.

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
- `EXPLICIT_CONTEXT_PREFERENCE`
- `GENERAL_COMMERCIAL_FALLBACK`

T10 does not generate commercial copy or natural-language sales arguments.

## Statistics

Statistics track commercial candidates received, affinity entries received, candidates with/without affinity, ignored affinities, each exclusion category, returned recommendations, effective personalization, commercial fallback, and warnings.

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
