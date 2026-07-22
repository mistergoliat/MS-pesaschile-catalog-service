# Product Relationship Validator

## Purpose

T05 protects publication against invalid or incoherent product relationships.

It receives `CalculatedProductRelationship` values after T04 and separates them into:

- valid relationships that may continue to snapshot publication;
- rejected relationships with a deterministic rejection code.

T05 no calcula nuevas relaciones.

T05 no modifica la evidencia ni la reliability.

Una relacion rechazada no llega al snapshot publicado.

## Architecture

```text
ProductRelationshipCandidate
        ->
T04 Relationship Reliability Evaluator
        ->
CalculatedProductRelationship
        ->
T05 Relationship Validator
        ->
ValidatedProductRelationship
        ->
T06 Snapshot Publisher
```

T05 is a synchronous, pure domain component. It performs no I/O, reads no runtime state, and does not use the clock.

## Validated Wrapper

The accepted output is:

```ts
type ValidatedProductRelationship = {
  relationship: CalculatedProductRelationship;
  validatedAtModelVersion: string;
};
```

`validatedAtModelVersion` copies `relationship.modelVersion`. It is not a timestamp.

The wrapper does not add publication IDs, ranks, product hydration, or runtime lookup data.

## Parameters

```ts
type RelationshipValidationParameters = {
  minimumReliability: number;
  rejectNegativeAssociation: boolean;
};
```

The V1 default is:

```ts
{
  minimumReliability: 0.30,
  rejectNegativeAssociation: true
}
```

`minimumReliability` must be between 0 and 1. `rejectNegativeAssociation` must be boolean.

These parameters are publication quality policies. T05 does not reuse T03 filters such as `minimumConfidence`, `minimumLift`, or `minimumJointCount`.

## Structural Validation

T05 rejects relationships with invalid source product, invalid target product, self relationship, unsupported relationship type, incompatible evidence kind, invalid evidence window, or empty `modelVersion`.

Product identity uses the composed identity:

```text
productId + combinationId
```

So product `A`, product `A` combination `10`, and product `A` combination `11` are distinct identities.

## Metric Validation

T05 checks numeric ranges without modifying values:

- `support`: `0 <= support <= 1`
- `confidence`: `0 <= confidence <= 1`
- `lift`: `lift >= 0`
- `reliability`: `0 <= reliability <= 1`
- `jointCount`: integer and non-negative
- `same_order.jointCount`: greater than zero

When present, `sourceCount`, `targetCount`, and `totalTransactions` must be positive integers.

T05 does not correct invalid values. For example, `reliability = 1.4` is rejected, not clamped to `1`.

## Coherence

For complete `co_occurrence` evidence, T05 checks obvious mathematical inconsistencies:

```text
jointCount <= sourceCount
jointCount <= targetCount
sourceCount <= totalTransactions
targetCount <= totalTransactions
support ~= jointCount / totalTransactions
confidence ~= jointCount / sourceCount
lift ~= confidence / (targetCount / totalTransactions)
```

The internal tolerance is:

```ts
RELATIONSHIP_METRIC_TOLERANCE = 1e-12
```

These are consistency checks only. T05 does not recalculate, round, or replace `support`, `confidence`, `lift`, or `reliability`.

## Positive Association Policy

When `rejectNegativeAssociation` is enabled, `co_occurrence` relationships with `lift <= 1` are rejected.

This is a publication policy: lift at or below 1 does not show association stronger than expected by chance.

When disabled, those relationships can continue if all other validations pass.

## Reliability Minimum

After structural, numeric, and coherence checks, T05 applies:

```text
reliability >= minimumReliability
```

A corrupt relationship is rejected by its structural or numeric defect before it can be classified as merely low reliability.

## Duplicates

Duplicates are detected by:

```text
source identity
target identity
relationshipType
modelVersion
evidenceWindow
```

The first occurrence is preserved. Later duplicates are rejected.

The inverse directed relationship is not a duplicate:

```text
A -> B
B -> A
```

## Serialization

Accepted relationships must be JSON serializable.

The validator rejects values such as BigInt, functions, symbols, circular references, undefined properties, and non-finite numbers. This is implemented with explicit recursive validation instead of relying only on `JSON.stringify`.

## Rejections

Each relationship is rejected at most once. The first defect determines the rejection code.

The validation order is:

1. serialization
2. source product
3. target product
4. self relationship
5. relationship type
6. evidence compatibility
7. evidence window
8. modelVersion
9. numeric ranges
10. counts
11. mathematical consistency
12. positive association
13. minimum reliability
14. duplicates

Rejections include the input index and may include JSON-serializable details.

## Warnings

T05 emits:

- `EMPTY_INPUT`
- `NO_VALID_RELATIONSHIPS`
- `PARTIAL_VALIDATION_SUCCESS`

Warnings summarize validation outcomes. They do not change accepted or rejected relationships.

## Statistics

The result includes:

- relationships read;
- relationships accepted;
- relationships rejected;
- rejected counts by code;
- distinct accepted source products;
- distinct accepted target products.

The statistics must satisfy:

```text
relationshipsRead = relationshipsAccepted + relationshipsRejected
relationshipsAccepted = validRelationships.length
relationshipsRejected = rejections.length
sum(rejectedByCode) = relationshipsRejected
```

## Excluded Scope

T05 does not implement SQL, migrations, publication, snapshots, endpoints, runtime readers, Redis, Neo4j, ML, personalization, commercial ranking, stock rules, margin rules, or new statistical formulas.

It is compatible with T01B contracts, T02 normalized datasets, T03 relationship candidates, and T04 calculated relationships, but it only validates `CalculatedProductRelationship` inputs.
