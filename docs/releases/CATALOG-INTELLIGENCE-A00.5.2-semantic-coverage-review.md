# CATALOG-INTELLIGENCE-A00.5.2 — Semantic Coverage Review

Status: **BLOCKED**
Date: **2026-09-02**
Decision: **PRODUCT_SEMANTIC_COVERAGE_BLOCKED**
Readiness: **BLOCKED**

## 1. Scope

This is a Product Semantics-only review of coherence, expressiveness, population quality,
commercial interpretability, boundedness, and explainability. It does not introduce customerId,
affinity, segmentation, RFM, clustering, CLV, personalization, Relationship Engine scoring, or
Sales Agent logic. No production semantic change was made.

## 2. Snapshot reviewed

The authoritative input was required to be the active snapshot or this pinned identity:

| Field | Expected value |
|---|---|
| snapshotId | `sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12` |
| ontology | `commercial-product-ontology-v3` |
| ontologyHash | `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955` |
| classifierVersion | `product-semantic-classifier-v1` |
| semanticChecksum | `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e` |

The expected snapshot directory `data/product-semantic-snapshots` is absent from this workspace;
no matching `active.json` or snapshot file exists elsewhere in the project checkout. Therefore this
document makes no fabricated coverage or quality claim. Classification was not rerun.

## 3. Methodology

Added `npm run product:semantic:coverage-audit`. The command reads the active/pinned snapshot,
validates its schema and identity, verifies the local ontology hash, and writes deterministic CSVs
under `docs/audits/product-semantic-coverage`. The catalog export is joined only for name, status,
catalog presence, examples, and existing order/unit/revenue aggregates; it never supplies semantic
assignments. Missing snapshot input causes a clear non-zero `BLOCKED` result.

## 4. Overall axis coverage

**BLOCKED — not evaluated.** The tool reports `ANY_FACT`, `PRODUCT_FAMILY`, `DISCIPLINE`, and
`USE_CONTEXT` independently over `sourceProductCount - EXCLUDED_NON_PRODUCT`. Missing optional axes
are not automatically defects.

## 5. Coverage by product family

**BLOCKED — not evaluated.** `semantic_coverage_by_family.csv` reports family count, active count,
discipline/context presence and absence, secondary-family count, and safely joined commercial weight.

## 6. Discipline utilization

**BLOCKED — not evaluated.** Every current discipline tag, including zero-use and near-zero-use tags,
will be reported with active count, family distribution, and representative examples. No assignment
is created automatically.

## 7. Use-context utilization

**BLOCKED — not evaluated.** The exact registry vocabulary is used, including `HOME_GYM`,
`COMMERCIAL_GYM`, `SMALL_SPACE`, `SEMI_COMMERCIAL_STUDIO`, `CLINICAL_RECOVERY`, and
`OUTDOOR_HIGH_TRAFFIC`. Empty cells are diagnostic only.

## 8. Representative human-review sample

**BLOCKED — not generated.** The deterministic sample includes high-commercial-volume products,
every family, multi-family products including `2134`, multi-axis and family-only products,
`OTHER`, `PARTIALLY_CLASSIFIED`, `EXCLUDED_NON_PRODUCT`, active/inactive/historical products,
recently fixed cable-machine products, and controls `29`, `31`, `1023`, `1619`, `2134`, `332`, `444`.
Its human columns accept only `CORRECT`, `CORRECT_BUT_SPARSE`, `SUSPICIOUS_MISSING_SIGNAL`,
`SUSPICIOUS_EMITTED_SIGNAL`, `DATA_QUALITY`, or `NOT_APPLICABLE`.

## 9. Sparsity audit

**BLOCKED — not evaluated.** The review distinguishes `SAFE_SPARSITY` (no trusted evidence for an
optional axis) from `SEMANTIC_GAP` (trusted structured evidence exists but an existing tag is absent).

## 10. Existing ontology utilization

**BLOCKED — not evaluated.** The registry has 35 non-residual semantic tags. The residual
`PRODUCT_FAMILY:OTHER` is reviewed separately and is not counted as one of those 35. The tag CSV
includes assignments, evidence records, population counts, source counts, and examples.

## 11. Provenance distribution

**BLOCKED — not evaluated.** The report aggregates `NAME_TEXT`, `TRUSTED_CATEGORY`,
`STRUCTURED_FEATURE`, and `FAMILY_INFERENCE` separately by axis and checks that emitted facts have
evidence and no forbidden source appears.

## 12. Multi-label audit

**BLOCKED — not evaluated.** All non-empty `secondaryProductFamilies` combinations are reported,
with active counts, representatives, and an explicit `2134` record. No multi-label assignment is
altered.

## 13. `OTHER` residual review

**BLOCKED — not evaluated.** The expected population is the accepted A00.4 residual of 317 rows,
including bounded ontology-gap concepts, packs/bundles, and isolated data-quality rows. Reducing
`OTHER` is not an A00.5.2 KPI and the A00.4 problem is not reopened.

## 14. Active/inactive/historical coverage

**BLOCKED — not evaluated.** The audit reports `ACTIVE`, `INACTIVE`, and `HISTORICAL` independently;
active high-value gaps would receive higher severity, while historical sparsity remains lower priority.

## 15. Commercial-weighted coverage

**BLOCKED — not evaluated.** Existing `validOrderCount`, `unitsSold`, and `totalRevenueTaxIncl`
aggregates are prioritization evidence only. Overall and active-only revenue coverage is generated
for each axis and `ANY_FACT` after the snapshot is supplied.

## 16. Product family / context matrix

**BLOCKED — not generated.** `family_use_context_matrix.csv` uses exact context tags; empty cells
are not automatically findings.

## 17. Product family / discipline matrix

**BLOCKED — not generated.** `family_discipline_matrix.csv` uses exact discipline tags and is
diagnostic only.

## 18. Findings

| ID | Type | Severity | Finding |
|---|---|---|---|
| A00.5.2-F1 | `SOURCE_DATA_QUALITY` | `BLOCKING` | The authoritative published snapshot is not available to this audit workspace. |

No classifier gap, ontology gap, evidence gap, safe sparsity, false-positive risk, provenance debt,
or UI-only issue is asserted without the snapshot records.

## 19. Debt register

| ID | Debt | Severity | Follow-up |
|---|---|---|---|
| A00.5.2-D1 | Snapshot artifact/persistent path is unavailable. | `BLOCKING` | Supply the deployed directory or pinned snapshot, then rerun the audit. |
| A00.5.2-D2 | Human sample adjudication could not start. | `HIGH` | Complete the generated sample in Catalog Console. |

## 20. Readiness decision

**PRODUCT_SEMANTIC_COVERAGE_BLOCKED**

Readiness question: “Is Product Semantics sufficiently coherent and useful to be consumed as
product-level evidence by future Customer Profile work?”

**BLOCKED.** This is an input-availability block, not evidence that the ontology or classifier is
wrong. Customer Profile integration is not implemented or authorized here.

## 21. Next slice

Provide the following read-only files:

```text
<snapshot-dir>/active.json
<snapshot-dir>/snapshots/79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12.json
```

Then run:

```text
npm run product:semantic:snapshot:inspect -- --product-id=29 --snapshot-dir=<snapshot-dir>
npm run product:semantic:snapshot:inspect -- --product-id=31 --snapshot-dir=<snapshot-dir>
npm run product:semantic:snapshot:inspect -- --product-id=2134 --snapshot-dir=<snapshot-dir>
npm run product:semantic:coverage-audit -- --snapshot-dir=<snapshot-dir> --snapshot-id=sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12
```

Only evidence from that run should open a corrective follow-up slice.

## Validation

- `npm run typecheck`: **PASS**.
- Focused semantic snapshot tests: **11/12 PASS**. The one failure is a pre-existing fixture-path
  assertion expecting a checkout directory named `MS-pesaschile-catalog-service`; this checkout is
  named `MS-Stock`.
- `npm run product:semantic:coverage-audit`: **EXPECTED BLOCK**, with no fabricated output.
- The three inspect commands remain blocked until the authoritative snapshot is supplied.

Expected production changes: ontology **NO**, classifier **NO**, snapshot **NO**, checksum **NO**,
runtime **NO**.
