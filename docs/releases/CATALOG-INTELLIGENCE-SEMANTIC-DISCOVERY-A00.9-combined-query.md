# CATALOG-INTELLIGENCE SEMANTIC-DISCOVERY-A00.9 — Combined Product + Training Semantic Discovery

Status: `COMBINED_SEMANTIC_DISCOVERY_READY_WITH_DEBT`

## Audit result

`PRODUCT_SEMANTIC_QUERY_EXISTING: PARTIAL`.

Catalog already had the Product Semantic V3 registry, immutable snapshot store,
active runtime reader/index, single-product read surface, batch read surface,
registry surface, and snapshot pinning. It did not have a structured query by
Product Semantic axis. A00.9 reuses that reader and ontology rather than
duplicating Product Semantic classification or snapshot logic.

## Endpoint and architecture

`POST /v1/products/semantic-discovery/query`

The endpoint accepts canonical structured constraints only. The application
service resolves them against loaded immutable Product and Training snapshots:

```text
HTTP → SemanticDiscoveryService → Product Semantic reader/index
                              → Training Semantic V2 reader/index
                              → deterministic set intersections/ranking
```

There is no natural-language interpretation, synonym mapping, classifier call,
database semantic reconstruction, commercial score, or Customer Profile input.

## Request

```json
{
  "schemaVersion": 1,
  "requirements": [
    { "axis": "USE_CONTEXT", "codes": ["HOME_GYM"], "mode": "required", "match": "any" },
    { "axis": "BODY_REGION", "codes": ["LOWER_BODY"], "mode": "required", "match": "any" },
    { "axis": "EXERCISE_CAPABILITY", "codes": ["LEG_PRESS"], "mode": "preferred", "match": "any" }
  ],
  "options": { "limit": 20 },
  "expectedSnapshots": {
    "productSemanticSnapshotId": "sha256:...",
    "trainingSemanticSnapshotId": "sha256:..."
  }
}
```

`schemaVersion` defaults to `1`; `requirements` is limited to 10 entries;
`limit` defaults to 20 and is bounded to 100. The request uses the existing
`x-api-key` gate.

## Axes and ownership

| Axes | Authority | Registry validation |
| --- | --- | --- |
| `PRODUCT_FAMILY`, `DISCIPLINE`, `USE_CONTEXT` | Product Semantic Snapshot V3 | `commercial-product-ontology-v3` |
| `EXERCISE_CAPABILITY`, `TRAINING_FUNCTION`, `BODY_REGION`, `MUSCLE_GROUP`, `TRAINING_PATTERN` | Training Semantic Snapshot V2 | `training-semantic-registry-v2` / `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8` |

`TRAINING_GOAL`, customer segments, RFM, price, stock, and commercial scores
are not accepted. Unknown axes/codes, duplicate codes or requirements,
invalid relation filters and malformed requests return
`400 INVALID_SEMANTIC_DISCOVERY_REQUEST`.

`PRODUCT_FAMILY=OTHER` is a residual classification state and is never added as
a positive family index entry. It therefore cannot claim a family match.
Product `EXCLUDED_NON_PRODUCT` facts are never eligible. Other product states
may satisfy only the axis-specific tags actually present; `EXPLICIT` and
`STRONGLY_INFERRED` confidence are preserved and affect only a deterministic
tie-break, not eligibility equivalence.

## Matching policy

Required requirements across both sources are ANDed in one candidate set. A
single requirement uses OR for `match=any` and AND for `match=all`. Preferred
requirements rank candidates but do not create eligibility when required
requirements exist. With no required requirements, the candidate universe is
the union of preferred matches, never the entire catalog.

Training relation defaults preserve A00.8:

- Exercise capabilities and derived anatomy/pattern axes: `DIRECT`, `SUPPORTED`.
- Training functions: `DIRECT`, `FAMILY_DERIVED`.

Product axes do not accept relation filters. Anatomy and patterns are derived
only from ExerciseCapabilities; TrainingFunctions never create anatomy or
movement matches.

Only Training records with `SEMANTIC_COMPLETE` participate. `DATA_GAP`,
`AMBIGUOUS`, `NEEDS_REVIEW`, `SEMANTIC_PARTIAL`, `ONTOLOGY_GAP`, and `RULE_GAP`
cannot enter through Product Semantic facts or lexical fallback.

## Lineage and pinning

The response exposes both source lineages. An unused source is represented as
`null`; this makes source degradation explicit. Independent pins are checked
only for sources referenced by the query:

- mismatch in Product Snapshot → `409 PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH`;
- mismatch in Training Snapshot → `409 TRAINING_SEMANTIC_SNAPSHOT_MISMATCH`.

The combined index identity includes Product `snapshotId`, semantic checksum and
ontology hash, plus Training `snapshotId`, semantic checksum and registry hash.
Any identity change rebuilds the relevant projection; product IDs are the only
join key.

## Dependency degradation

- Product-only query requires Product Semantics and returns
  `503 PRODUCT_SEMANTICS_UNAVAILABLE` when absent.
- Training-only query requires Training Semantics and returns
  `503 TRAINING_SEMANTICS_UNAVAILABLE` when absent.
- Cross-domain query requires both sources.
- An unavailable unused source does not block a query.

Valid zero-match intersections return `200` with `results: []` and
`totalMatches: 0`; constraints are never relaxed.

## Ranking and response

Results are ordered by preferred requirement count descending, direct Training
ExerciseCapability match count descending, Product Semantic confidence strength
descending, and `productId` ascending. Every result contains matched axis,
requested/matched codes, source, relation types when applicable, confidence
levels when applicable, and required/preferred reason.

The response includes `productSemantics` and `trainingSemantics` facts without
hydrating price, stock, or other commercial data. Product identity is the
canonical numeric `productId`; there is no fuzzy SKU/name join and no N+1 read.

## Examples and consistency

- `BODY_REGION=LOWER_BODY` uses Training Snapshot only.
- `USE_CONTEXT=HOME_GYM + BODY_REGION=LOWER_BODY` returns the actual set intersection.
- `USE_CONTEXT=HOME_GYM + EXERCISE_CAPABILITY=LEG_PRESS` does not relax either constraint.
- `PRODUCT_FAMILY=RACK_CAGE + TRAINING_FUNCTION=BARBELL_SUPPORT` crosses authorities without collapsing them.
- A Training-only request through this endpoint is required to produce the same ordered product IDs as the equivalent A00.8 query.

## Known debt

- Product Semantic runtime artifacts are deployment inputs and remain separately
  published from Training Snapshot V2; this release does not create a combined
  snapshot artifact.
- Basic product name/reference hydration is deferred because the current
  semantic resolver intentionally avoids database/N+1 coupling.
- R3 capability/tool contract and natural-language-to-constraint translation
  remain deferred to A00.10.
