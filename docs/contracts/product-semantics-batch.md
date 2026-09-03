# Product Semantics Batch Contract

Status: **stable, schema version `1`**  
Owner: **Catalog Service** (product semantic truth)  
Consumer: **Customer Profile** (customer truth and downstream affinity policy)

This is the canonical cross-service contract for reading product semantic
facts. Customer Profile must not classify products, interpret ontology rules,
read Catalog's filesystem, or depend on Catalog classifier internals.

## Endpoint and authentication

`POST /v1/products/semantics/batch`

The endpoint is authenticated with the existing Catalog Service `x-api-key`
header. The key is service configuration only and must never be exposed to a
browser or frontend. The endpoint does not call PrestaShop or classify on
demand; it reads only the active semantic runtime reader.

## Request

```json
{
  "productIds": [29, 31, 332, 2134],
  "expectedSnapshotId": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

`productIds` is required, non-empty, and contains only positive safe
integers. The maximum request size is **500 IDs**. IDs are deduplicated while
preserving their first appearance. `expectedSnapshotId` is optional and must
be a full `sha256:<64 lowercase hex>` snapshot ID when provided.

Invalid input returns `400 INVALID_INPUT`. The existing Catalog API-key
policy returns `401 UNAUTHORIZED` for a missing or invalid key.

## Response

A successful response is `200` and always contains one batch-level lineage:

```json
{
  "schemaVersion": "1",
  "snapshotId": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ontologyVersion": "commercial-product-ontology-v3",
  "ontologyHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "classifierVersion": "product-semantic-classifier-v1",
  "semanticChecksum": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "products": [
    {
      "productId": 29,
      "classificationStatus": "CLASSIFIED",
      "primaryProductFamily": { "code": "BARBELL", "confidence": "EXPLICIT" },
      "secondaryProductFamilies": [],
      "disciplines": [],
      "useContexts": []
    }
  ],
  "missingProductIds": []
}
```

Each product fact contains only the public semantic projection. `ruleId`,
evidence, exclusion provenance, and `needsReviewCandidates` are deliberately
not part of this batch contract. The single-product inspection endpoint may
expose provenance separately.

`classificationStatus` is one of `CLASSIFIED`, `PARTIALLY_CLASSIFIED`,
`OTHER`, `EXCLUDED_NON_PRODUCT`, or `NEEDS_REVIEW`. `OTHER` and
`EXCLUDED_NON_PRODUCT` are valid returned facts, not missing products.

`missingProductIds` means only that a requested ID is absent from the active
semantic snapshot universe. Both `products` and `missingProductIds` follow the
normalized request order; each contains no duplicate IDs.

## Snapshot availability and pinning

If no active semantic snapshot is loaded, the endpoint returns:

```json
{
  "error": {
    "code": "PRODUCT_SEMANTICS_UNAVAILABLE",
    "message": "Active product semantic snapshot is not loaded",
    "correlationId": "..."
  }
}
```

with HTTP `503`. Catalog does not silently serve a stale snapshot or turn an
unavailable snapshot into an empty `200` response.

When `expectedSnapshotId` is absent, the response is read from the active
snapshot and reports that snapshot's lineage. When it is present, it must
match the active `snapshotId`. A mismatch returns HTTP `409` with code
`PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH` and no facts. This pinning is the
consistency mechanism for population runs that require multiple calls:

1. The first call omits `expectedSnapshotId` and records `snapshotId` S1.
2. Subsequent calls send `expectedSnapshotId: S1`.
3. If Catalog activates S2, the consumer aborts and publishes no mixed-lineage
   result.

The batch lineage fields are coherent metadata from one active snapshot;
`snapshotId` is the identity, while `semanticChecksum` is the content
checksum. `builtAt` is intentionally not an identity field.

## Limits, ordering, idempotency, and retries

The maximum is 500 submitted IDs, before deduplication. The request is
read-only and idempotent for a stable active snapshot: repeating the same
request against the same snapshot produces the same normalized order and
lineage. There is no server-side retry loop or asynchronous job.

Consumers may retry connection errors, timeouts, and `503` responses, subject
to their timeout budget. They must not retry `400`, `401`, `403`, `409`, or a
response rejected by schema validation. A retry after a timeout must start a
new pinned run or use the already-known `expectedSnapshotId`; a consumer must
never merge facts from different snapshot IDs.

The expected server-side processing is an in-memory runtime lookup. Consumers
should use a bounded HTTP timeout appropriate for an internal service call
(the initial Customer Profile expectation is 2.5 seconds) and propagate a
correlation ID for diagnosis.

## Compatibility and consumer requirements

`schemaVersion` is a hard compatibility gate. Customer Profile must reject an
unknown version and must not guess field meanings. `ontologyVersion`,
`ontologyHash`, and `classifierVersion` are lineage evidence; Customer Profile
must preserve them and record them with any derived customer snapshot, but
must not hardcode acceptance to one ontology version unless a separately
approved policy says so.

Customer Profile must validate that:

- the response has the expected schema version;
- lineage fields are present and well-formed;
- product IDs are positive and unique within the response;
- `products` and `missingProductIds` do not overlap or duplicate IDs;
- statuses are preserved, including `OTHER` and `EXCLUDED_NON_PRODUCT`;
- one population run uses one `snapshotId` across all batches.

The consumer owns eligibility, semantic trust weighting, affinity
interpretation, and publication policy. Catalog owns classification, ontology
meaning, semantic status, and snapshot lineage.

## Identity

`productId` is the semantic identity and maps to `ps_product.id_product`.
`productAttributeId` is not part of this contract or semantic identity.

