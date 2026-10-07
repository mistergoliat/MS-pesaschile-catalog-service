# P2.3C-FIX: Training rule precision

The source CSV, category/feature trust maps and frozen Product Semantics establish assignments. Training V2 classifies all source records again, then reconciles surviving facts. The rejected P2.3C artifacts are immutable comparators; no snapshot, bundle or pointer is activated by this workflow.

The V2 evidence domains reject cable material, passive pulley parts, host rack/smith/cage references, storage racks and exercise names on support components. Actual cable attachment modules need mechanism evidence. Mixed pull-up/push-up categories need a discriminating name or specific category. Product family provenance must independently describe an actual cable product before a family-derived function is emitted. Suppression does not alter Product Truth; `product-family-backlog.json` records the debt.

Rack bundles without a specified role generate a review candidate rather than certified barbell support. The generic Body Pump rack case remains AMBIGUOUS. Suppressed rule evidence with no surviving fact or reproducible negative yields DATA_GAP rather than inventing an ontology deficit. ACTIVE and explicitly forbidden deferred codes cannot themselves establish ONTOLOGY_GAP; generic SQUAT is filtered using the existing registry boundary.

Publication validates evidence domains against source when available, alongside schema, identity, registry references and resolution invariants. This is a structural guard, not a language-understanding adjudicator. Every new strict Discovery admission must have a surviving fact, terminal resolution and the unchanged `semantic-obligations-v2` contract. Source-driven conditional applicability can change after a faulty rule is corrected; declared obligations and contract hash remain fixed.

The historical accepted snapshot comparator reads frozen evidence and validates its V1 lineage and canonical identity. It no longer claims current rules reproduce superseded semantics. Corrected snapshot determinism is checked through reordered inputs and the ordinary native builder.

Run the complete suite directly, avoiding npm's snapshot-writing pretest:

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --maxWorkers=1 --reporter=json --outputFile=cross-projection-audit/p2-3c-fix/test-results.json
node --import tsx cross-projection-audit/training-rule-precision-audit.mjs
```

The audit runs typecheck and lint itself and records their actual outputs in generated evidence; a failing check stops the audit. Missing or stale full-suite results leave the final test gate pending. Outputs include focused prior-review regression results, the full rule sweep, negative evidence, source-required gaps, Discovery/consolidation deltas, Product family debt, remaining review and protected-file fingerprints. It accepts `--source-dir` and `--bundle-dir` for the same frozen input formats as P2.3C.

Only source, tests, this document, the audit script and [REPORT-P2.3C-FIX](../../cross-projection-audit/p2-3c-fix/REPORT-P2.3C-FIX.md) are eligible for Git. Generated evidence stays ignored. Final disposition is readiness for content review, not production approval.
