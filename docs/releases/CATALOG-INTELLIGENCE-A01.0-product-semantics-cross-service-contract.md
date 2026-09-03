# CATALOG-INTELLIGENCE-A01.0 — Product Semantics Cross-Service Contract

## Decision

`PRODUCT_SEMANTICS_CROSS_SERVICE_CONTRACT_READY_WITH_DEBT`

The canonical contract is documented at
[`docs/contracts/product-semantics-batch.md`](../contracts/product-semantics-batch.md).
Catalog Service owns product semantic truth. Customer Profile owns customer
truth and any affinity interpretation.

## Delivered

- Added `POST /v1/products/semantics/batch` with API-key authentication.
- Added deterministic first-occurrence de-duplication and a 500-ID limit.
- Added batch lineage: schema version, snapshot ID, ontology version/hash,
  classifier version, and semantic checksum.
- Added explicit status handling for all five semantic statuses and distinct
  `missingProductIds` handling.
- Added snapshot pinning with `409 PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH`.
- Kept the endpoint read-only over the active runtime reader; no on-demand
  classification, external calls, ontology, or classifier changes.
- Extended the Catalog client with a dedicated semantic batch method and
  consumer-facing result types.

## Compatibility

Schema version `1` is a hard gate. Ontology and classifier fields are
preserved as lineage evidence and are not hardcoded to one version by the
transport contract. `ruleId` and full provenance are intentionally excluded
from the production batch projection.

## Scope exclusions

No affinity population, scoring, ontology, classifier, CRM, Sales Agent,
Quote Service, or Customer Profile logic was added to Catalog.

## Bounded debt

Customer Profile's existing population runner still requires the next slice
to switch its operational source from the compatibility filesystem reader to
the HTTP source and apply pinning across multiple batches. This does not
reopen the contract or block A01.1 Catalog batch implementation.
