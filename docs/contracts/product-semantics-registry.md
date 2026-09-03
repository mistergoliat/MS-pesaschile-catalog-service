# Product Semantics Registry Contract

## Ownership

Catalog Service is the authoritative owner of the commercial product semantic vocabulary. This
endpoint is a read-only projection of Catalog's existing immutable
`commercial-product-ontology-v3` registry. Consumers must not maintain a second list of axes or
codes.

## Endpoint and authentication

`GET /v1/products/semantics/registry`

The endpoint uses the same Catalog API-key boundary as the other product semantic endpoints. Send
the key in the `x-api-key` header. Requests without an authorized key receive `401`.

The response is complete and bounded. Filtering, searching, pagination, aliases, synonyms, and
locale selection are intentionally not part of schema version `1`.

## Response schema

```json
{
  "schemaVersion": "1",
  "ontologyVersion": "commercial-product-ontology-v3",
  "ontologyHash": "<64 lowercase hexadecimal characters>",
  "status": "PUBLISHED",
  "axes": [
    {
      "axis": "PRODUCT_FAMILY",
      "values": [
        {
          "code": "BARBELL",
          "labelEs": "Barras",
          "definition": "Straight, Olympic, or specialty training bars.",
          "status": "ACTIVE",
          "residual": false
        }
      ]
    },
    { "axis": "DISCIPLINE", "values": [] },
    { "axis": "USE_CONTEXT", "values": [] }
  ]
}
```

The public projection exposes only `code`, `labelEs`, `definition`, `status`, and `residual` for
each value. Classifier regexes, evidence rules, heuristics, confidence internals, and historical
implementation details are not public registry fields.

The axes and values preserve the deterministic canonical order of the authoritative registry. The
three axes are `PRODUCT_FAMILY`, `DISCIPLINE`, and `USE_CONTEXT`. `PRODUCT_FAMILY` includes the
`OTHER` residual bucket because it is represented by the published v3 registry; `OTHER` is a
bounded residual concept, not a newly invented customer segment. Rejected concepts such as
`WEIGHTLIFTING` are not exposed.

## Ontology identity and snapshot identity

`ontologyHash` is the SHA-256 identity of the canonical vocabulary registry. It changes when the
ontology registry changes and is calculated with Catalog's existing
`computeCommercialProductOntologyRegistryHash(...)` function.

These identities are distinct:

| Identity | Meaning |
| --- | --- |
| `ontologyHash` | Vocabulary identity: the axes and ontology definitions used for semantic discovery. |
| `snapshotId` | Classified product-assignment snapshot identity: the published product semantic snapshot containing assignments. |
| `semanticChecksum` | Classified snapshot content checksum: the checksum of the snapshot's semantic records. |

`snapshotId` and `semanticChecksum` belong to product semantic snapshot contracts and are not
returned by this registry endpoint. A consumer may use the registry to discover valid axis/code
pairs and display metadata, but must not treat `ontologyHash` as a product-assignment snapshot
identifier.

The endpoint explicitly resolves `commercial-product-ontology-v3`; it does not use the registry
accessor's implicit version default.

## Compatibility expectations

Within schema version `1`, consumers should treat the response as a complete vocabulary and use
`ontologyVersion` plus `ontologyHash` for lineage. Consumers should tolerate new ontology versions
by re-reading the registry rather than copying codes. Catalog may add a new schema version when
the public shape or semantics require a breaking change.

CRM and R3 can use this release to discover valid affinity axis/code pairs, Spanish labels,
definitions, and ontology identity. Audience membership remains Customer Profile-owned and must
not depend on Catalog being available at evaluation time.
