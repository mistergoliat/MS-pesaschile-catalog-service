# Catalog commercial contract v2

`src/domain/catalog/v2/contracts.ts` is the executable Zod contract. The JSON schema in
`schemas/catalog-v2.schema.json` is the published interchange reference and `fixtures/` contains
versioned contract outputs used by the HTTP and consumer contract tests.

All fixtures are read-only contract outputs generated from the v2 assembler. They do not claim
live production evidence; production-specific tax, backorder and freshness assumptions remain
`UNKNOWN` until the authorized read-only audit is run against PrestaShop.

The public context uses a fixed context (`customerId=0`, configured public currency/group) and
never accepts customer pricing headers. `itemKey` is opaque to consumers: `P{id}` is valid only
for a product without variants and `P{id}-V{variantId}` identifies a concrete variant.
