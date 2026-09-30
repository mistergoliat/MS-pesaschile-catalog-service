# Catalog commercial contract v2

`src/domain/catalog/v2/contracts.ts` is the executable Zod contract. The v2 routes validate every
answer against it before sending (an answer that violates it becomes a typed
`500 contract_output_invalid`). `schemas/catalog-v2.schema.json` is the interchange reference.

## Fixtures (owner truth)

Every file in `fixtures/` except `pricing-golden.json` is the exact wire output of the real
`CatalogContractService` or HTTP app for a scenario declared in
`tests/support/catalogV2FixtureScenarios.ts`. `tests/contract/catalogV2Fixtures.contract.test.ts`
fails when a fixture drifts from the service, and regenerates all of them with:

```sh
CATALOG_V2_WRITE_FIXTURES=1 npx vitest run tests/contract/catalogV2Fixtures.contract.test.ts
```

`fixtures/MANIFEST.json` lists each fixture with its endpoint, HTTP status and
`sha256(JSON.stringify(JSON.parse(file)))` (line-ending independent). Consumers copy the files
unchanged, verify the hashes and record the owner commit they came from. `pricing-golden.json` is
engine input/expectation for the price parity test, not a wire answer.

Fixtures are synthetic. They do not claim production evidence; tax, backorder and freshness
assumptions remain `UNKNOWN` until the authorized read-only production audit runs.

## Identity (frozen for schemaVersion 1)

- `productKey` (`P{id}`) is PRODUCT identity: search results, product context, FBT items.
- `itemKey` is SELLABLE ITEM identity, emitted only by `facts.sellableItem`, `facts.variantOptions[]`
  and the item context. `P{id}` is an itemKey only for a product without variants.
- The item context answers `variant_required` (with the `productKey`) for `P{id}` of a product with
  variants; it never picks a variant.
- SKU is display/lookup data, never identity. Both keys are opaque to consumers.

The public price context is fixed (`customerId=0`, configured public currency/group) and never
accepts customer pricing headers.
