# Customer Product Affinity Provider

## Purpose

T09 transforms explicit customer-product evidence into structured affinity signals for a fixed batch of candidate products.

Customer affinity is not the final recommendation.

T09 does not decide what product should be recommended.

Its output is intended for T10, where customer affinity can be combined with commercial recommendations in a separate personalized recommendation layer.

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

- `DIRECT_PRODUCT_PURCHASE`
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

## Scoring

V1 scoring uses explicit parameters:

```text
positive =
  directProductPurchase * directProductPurchaseWeight
+ categoryPurchase * categoryPurchaseWeight
+ brandPurchase * brandPurchaseWeight
+ recentProductInterest * recentProductInterestWeight
+ recentCategoryInterest * recentCategoryInterestWeight
+ ownedCompatibleProduct * ownedCompatibleProductWeight
+ repeatPurchasePattern * repeatPurchasePatternWeight
+ observedSpendFit * observedSpendFitWeight

negative =
  productRejection * productRejectionPenalty
+ categoryRejection * categoryRejectionPenalty

score = clamp((positive - negative) / maximumPositiveWeight, 0, 1)
```

The score is normalized to `0..1`. It is not a probability, not relationship reliability, not commercial score, and not final personalization.

## Confidence

Confidence is calculated separately from score:

- `none`: no valid evidence.
- `low`: one signal type or insufficient evidence.
- `medium`: at least two signal types and the configured medium evidence threshold.
- `high`: at least three signal types and the configured high evidence threshold.

Negative evidence contributes to confidence because confidence describes evidence sufficiency, not positive affinity.

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

Warnings are not commercial text and must not contain raw operational payloads, stack traces, secrets, or unnecessary PII.

## Missing Customer

When `customer` is omitted, T09 does not call the evidence provider. It returns one neutral affinity per deduplicated product with score `0`, confidence `none`, empty signals, empty evidence, and a global `CUSTOMER_NOT_IDENTIFIED` warning.

This lets T10 degrade to general commercial recommendations.

## Missing History

When a customer exists but no product evidence exists, T09 returns neutral affinities, per-product `NO_CUSTOMER_HISTORY` warnings, and a global `NO_CUSTOMER_HISTORY` warning. This is not an error and does not exclude candidates.

When evidence exists for only part of the batch, available products are evaluated and missing products degrade neutrally with `PARTIAL_CUSTOMER_HISTORY`.

## Determinism

T09 does not use implicit clock access, random values, UUIDs, SQL, runtime lookup, or hidden weights. Recency calculations require an explicit `context.referenceTime`. The same request, provider response, parameters, and scoring version produce the same result.

## Immutability

Results are cloned and deeply frozen before being returned. Provider objects and request objects are not exposed by mutable reference.

## Privacy

T09 consumes already-resolved, already-permitted, structured evidence. It does not resolve customer identity, create customer identifiers, decrypt data, or expose raw history. Evidence summaries are compact, structured, and JSON serializable.

## T10 Integration

T10 will consume T08 commercial candidates and T09 customer affinity signals to build final personalized recommendations. T09 intentionally does not perform reranking, 1:1 personalization, commercial selection, campaign logic, cart mutation, order creation, or copy generation.

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
