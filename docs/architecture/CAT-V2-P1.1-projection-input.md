# CAT-V2 P1.1 — Projection input extractor

`npm run catalog:projection:extract` reads PrestaShop in one consistent, read-only transaction and writes a content-addressed extraction under `artifacts/catalog-projection-input/<hash>/`. The production validation and current extraction contract are documented in [CAT-V2-P1.2-production-extraction.md](CAT-V2-P1.2-production-extraction.md).

The extraction contains:

- `canonical_input.json`: normalized source content and the basis of `sourceExtractionId`;
- `product_catalog_exploration.csv`: the columns consumed by the existing product and training semantic loaders (`productId`, `catalogPresence`, `name`, `active`, `allCategoryIds`, `features_json`, `totalRevenueTaxIncl`);
- canonicalized copies of the current category and feature trust maps;
- `projection_input_manifest.json`: source scope, file hashes and product counts.

The comparison report with added/removed products, changed fields, semantic assignments and loader warnings is written separately under `artifacts/catalog-projection-input/reports/`.

Current products come from `ps_product`; historical-only IDs and their latest order-line names come from `ps_order_detail`. Revenue is the sum of `order_detail.total_price_tax_incl` for orders with `valid = 1`. It is offline classification context, not a current price. `sourceExtractionId` hashes the canonical JSON. The aggregate content hash includes the canonical JSON, compatibility CSV, both trust maps and extractor version; it excludes runtime metadata and the comparison baseline.

The curated trust maps are sorted canonically. New category or feature IDs appear as loader warnings and need review before snapshot publication. Historical order-line names may include a variant label; the diff lists any resulting changes.

To use a different comparison export or curated maps:

```text
npm run catalog:projection:extract -- --baseline=path/to/export.csv --category-trust-map=path/to/categories.csv --feature-trust-map=path/to/features.csv
```

The extractor does not activate a snapshot. The CSV is a transitional compatibility adapter. Review the diff and warnings before passing it and the trust maps to the existing classifier or snapshot builder:

```text
npm run product:semantic:classify -- --input-dir=artifacts/catalog-projection-input/<hash>
npm run product:semantic:snapshot:build -- --input-dir=artifacts/catalog-projection-input/<hash>
```

The archived export is a dated baseline, so additions, deletions and changes are expected. Its row count is not a fixed acceptance target. A later phase will decide how to publish and reload a validated projection bundle.
