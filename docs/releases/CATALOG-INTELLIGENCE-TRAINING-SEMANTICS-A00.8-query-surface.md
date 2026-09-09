# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.8 — Training Semantic Query Surface V2

Status: `TRAINING_SEMANTIC_QUERY_SURFACE_READY_WITH_DEBT`

The Catalog service now exposes a structured-only query over the active Training
Semantic Snapshot V2:

`POST /v1/products/training-semantics/query`

The endpoint uses the existing `x-api-key` authentication gate. It never
interprets free text, performs lexical fallback, runs the classifier, queries
the database, or merges commercial data.

## Request

```json
{
  "schemaVersion": 1,
  "requirements": [
    {
      "axis": "EXERCISE_CAPABILITY",
      "codes": ["ROW"],
      "mode": "required",
      "match": "any"
    },
    {
      "axis": "TRAINING_FUNCTION",
      "codes": ["CABLE_RESISTANCE"],
      "mode": "preferred",
      "match": "any"
    }
  ],
  "options": { "limit": 20 },
  "expectedSnapshotId": "sha256:..."
}
```

`schemaVersion` defaults to `1` for compatibility with the initial examples.
`requirements` accepts at most 10 entries. `limit` defaults to 20 and is
bounded to 100. `expectedSnapshotId` is optional; when supplied, a mismatch
returns `409 TRAINING_SEMANTIC_SNAPSHOT_MISMATCH`.

## Axes and validation

V1 supports only:

- `EXERCISE_CAPABILITY`
- `TRAINING_FUNCTION`
- `BODY_REGION`
- `MUSCLE_GROUP`
- `TRAINING_PATTERN`

Codes are checked against Registry V2. `TRAINING_GOAL`, Product Semantic axes,
unknown axes, unknown codes, empty requirements/codes, invalid modes or matches,
duplicate requirements, and invalid relation filters return
`400 INVALID_TRAINING_SEMANTIC_REQUEST`.

## Matching policy

`required` requirements are hard filters. Requirements are combined with AND.
Within one requirement, `match: any` is OR and `match: all` is AND.

`preferred` requirements never create eligibility by themselves when required
requirements exist. If there are no required requirements, the union of
preferred matches is the candidate set; this prevents a preferred-only query
from returning the entire catalog.

The default relations are:

- Exercise capabilities: `DIRECT` and `SUPPORTED`.
- Training functions: `DIRECT` and `FAMILY_DERIVED`.
- Derived anatomy and patterns: `DIRECT` and `SUPPORTED`, resolved only from
  ExerciseCapabilities.

An explicit `relations` array can narrow those defaults. Training Functions do
not derive body regions, muscle groups, or training patterns.

Only records with `resolutionState: SEMANTIC_COMPLETE` are eligible. This keeps
`DATA_GAP`, `AMBIGUOUS`, `NEEDS_REVIEW`, `SEMANTIC_PARTIAL`, `ONTOLOGY_GAP`, and
`RULE_GAP` out of semantic matches by default. The accepted unresolved IDs
`1122`, `2025`, `1945`, `1946`, `1947`, and `1948` therefore cannot enter by
name or category inference.

## Ranking and response

Results are ordered deterministically by:

1. number of matched preferred requirements, descending;
2. number of matched requirements with a `DIRECT` relation, descending;
3. `productId`, ascending.

The response contains `totalMatches` before limiting, `truncated`, snapshot and
registry lineage, semantic facts, derived semantics, and a
`matchedRequirements` explanation for every result. Each explanation includes
the axis, requested and matched codes, relation types, and whether the match
was required or preferred.

An empty valid query result is `200` with `results: []` and `totalMatches: 0`.
An unavailable active snapshot returns `503 TRAINING_SEMANTICS_UNAVAILABLE`.

## Runtime/index behavior

The application service builds an in-memory index from the active immutable
snapshot. The index is identified by both `snapshotId` and `registryHash`; it
is rebuilt when either changes. No per-result filesystem reads or N+1 calls are
performed.

## Known debt

- Product + Training Semantic combined querying remains deferred to A00.9.
- Explicit registry pinning (`expectedRegistryHash`) is not part of V1.
- Commercial hydration and personalized ranking remain out of scope.
