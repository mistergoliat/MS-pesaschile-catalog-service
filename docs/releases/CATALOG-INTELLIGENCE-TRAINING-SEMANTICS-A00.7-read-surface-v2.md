# CATALOG-INTELLIGENCE-TRAINING-SEMANTICS-A00.7 — Training Semantics Read Surface V2

Decision: `TRAINING_SEMANTIC_READ_SURFACE_V2_READY_WITH_DEBT`

Catalog exposes frozen Training Semantic Product Truth V2 through authenticated,
read-only routes:

- `GET /v1/products/:productId/training-semantics`
- `POST /v1/products/training-semantics/batch`
- `GET /v1/products/training-semantics/registry`

All routes use the existing server-side `x-api-key` boundary. API keys are not
accepted from or exposed to a browser client.

## Snapshot and lineage

The runtime reads only the active V2 pointer and its immutable snapshot file
through `ActiveTrainingSemanticSnapshotV2Reader`. It does not call the
classifier, query PrestaShop, merge Product Semantics, or infer from product
names at request time.

The accepted fixture currently loaded is:

| Field | Value |
| --- | --- |
| `schemaVersion` | `2` |
| `snapshotId` | `sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1` |
| `semanticChecksum` | `e15673be136a730d3e90645446ba55f0734b491163f47b4a617b9c5c974f8941` |
| `registryVersion` | `training-semantic-registry-v2` |
| `registryHash` | `7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8` |
| `classifierVersion` | `training-semantic-classifier-v2.1` |
| `rulesHash` | `5e4e591b45e7704975552f305d59d73535c3889ed655754aa0113844c9c03b6d` |

Single and batch product responses include the same lineage object. The batch
endpoint accepts at most 500 IDs, removes duplicates deterministically while
preserving first occurrence order, and returns `missingProductIds` for products
absent from the active snapshot. `expectedSnapshotId` returns 409 with
`TRAINING_SEMANTIC_SNAPSHOT_MISMATCH` when it does not match the active pointer.

## Response semantics

`resolutionState` is preserved explicitly. In particular:

- `VERIFIED_NO_APPLICABLE_CAPABILITY` is a successful 200 response with empty
  capability/function arrays;
- `DATA_GAP`, `AMBIGUOUS`, `NEEDS_REVIEW`, `SEMANTIC_PARTIAL`, `ONTOLOGY_GAP`,
  and `RULE_GAP` are not converted to an empty semantic-complete result;
- a product absent from the snapshot returns 404
  `TRAINING_SEMANTIC_PRODUCT_NOT_FOUND`;
- an unloaded or unavailable active V2 snapshot returns 503
  `TRAINING_SEMANTICS_UNAVAILABLE`.

Derived body regions, muscle groups, and training patterns are calculated from
the runtime registry relations for exercise capabilities only. Training
functions never derive anatomy. The registry route publishes 24 exercise
capabilities, 5 training functions, derived relations, and the sole approved
family mapping `CABLE_MACHINE → CABLE_RESISTANCE`; it publishes no product
assignments or classifier rule implementation.

The six accepted unresolved active products remain known debt: `1122` and
`2025` are `DATA_GAP`; `1945`–`1948` are `AMBIGUOUS`.

## Errors, readiness, and observability

The stable read-surface errors are:

- 400 `INVALID_TRAINING_SEMANTIC_REQUEST`
- 404 `TRAINING_SEMANTIC_PRODUCT_NOT_FOUND`
- 409 `TRAINING_SEMANTIC_SNAPSHOT_MISMATCH`
- 503 `TRAINING_SEMANTICS_UNAVAILABLE`

Snapshot unavailability is degradable: Catalog general readiness does not
depend on Training Semantics V2, while these routes fail closed with 503. The
existing HTTP metrics record endpoint, status, and latency; no full evidence
payload is logged by the read surface.

Next release: A00.8 query surface, without LLM interpretation inside Catalog.
