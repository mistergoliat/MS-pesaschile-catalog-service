# Offline Relationship Snapshot Build

T11.2 adds an explicit offline command that reads historical PrestaShop orders through the read-only catalog database, transforms them with T02, calculates `same_order` evidence with T03, evaluates reliability with T04, validates relationships with T05, and publishes the resulting active snapshot with T06.

The HTTP service does not run this pipeline at startup. SearchProducts V2 only consumes the active snapshot after it has been published.

## Command

```bash
npm run relationship:snapshot:build
```

The command prints a structured JSON summary with source counts, normalization counts, candidate counts, validation counts, snapshot id, hash, file paths, and duration.

## Configuration

Required for the build command:

- `RELATIONSHIP_SOURCE_FROM_DATE`: inclusive ISO-8601 lower bound.
- `RELATIONSHIP_SOURCE_ORDER_STATES`: comma-separated PrestaShop order state ids accepted as completed source orders.
- `RELATIONSHIP_SNAPSHOT_DIR`: directory used by `FileProductRelationshipSnapshotStore`.

Optional:

- `RELATIONSHIP_SOURCE_TO_DATE`: inclusive ISO-8601 upper bound. When absent, the snapshot evidence window ends at the latest accepted transaction timestamp.
- `RELATIONSHIP_SOURCE_EXCLUDED_PRODUCT_IDS`: comma-separated administrative product ids to exclude before normalization.
- `RELATIONSHIP_SOURCE_MAX_PRODUCTS_PER_ORDER`: maximum distinct products allowed by T02 per order.

The configured order states are applied as strings. The domain does not hardcode PrestaShop commercial status names.

## Source Query

The reader uses the configured PrestaShop table prefix and reads:

- `orders.id_order`
- `orders.date_add`
- `orders.current_state`
- `order_detail.id_order_detail`
- `order_detail.product_id`
- `order_detail.product_attribute_id`
- `order_detail.product_quantity`

Rows are ordered by order date, order id, and order detail id. The reader does not write to PrestaShop.

For the initial production snapshot, `product_attribute_id` is read but not emitted as `combinationId`. Relationships are calculated at base `productId` level.

## Exclusions

The reader excludes:

- orders whose state is not configured;
- invalid product ids;
- non-positive quantities;
- configured administrative products;
- technical duplicate rows by `orderId + lineId`.

T02 then applies its own contract checks, including timestamp validation, duplicate transaction rejection, duplicate product aggregation, partial transaction handling, and the maximum distinct product limit.

## Publication

Publication goes through `DefaultProductRelationshipSnapshotPublisher` and `FileProductRelationshipSnapshotStore`.

Snapshot and active pointer writes use a temporary file, file sync, and rename. The active pointer is not updated when reading, normalization, calculation, validation, save, or activation fails.

Empty snapshots are not allowed by default. If zero valid relationships are produced, the command fails and preserves the previous active snapshot.

## Verify

After a successful build:

```bash
npm run build
npm start
```

Then verify:

- `/health/live`
- `/health/ready`
- `/docs`
- `POST /api/v2/recommendations/search-products`

`/health/ready` reports the relationship snapshot as ready only when T07 has loaded the active snapshot.

## Rollback

To revert to a previous snapshot, update `active.json` atomically to point at an existing snapshot id:

```json
{
  "snapshotId": "sha256:<previous-hash>"
}
```

Use the same temporary-file-and-rename approach used by the store, then restart or refresh the runtime so T07 reloads the active pointer.

## Report Fields

- `sourceOrdersRead` and `sourceLinesRead`: rows observed from the source reader.
- `ordersAccepted` and `ordersExcluded`: accepted and rejected order counts after reader exclusions and T02 normalization.
- `distinctProducts`: product identities observed in the final neutral dataset.
- `pairCandidates`: candidates produced by T03 before reliability and validation acceptance.
- `reliableCandidates`: calculated relationships emitted by T04 with reliability.
- `validRelationships` and `rejectedRelationships`: T05 validation result.
- `snapshotId`, `snapshotHash`, `snapshotPath`, `activePointerPath`: publication outputs.
- `durationMs`: elapsed command time.

T11.2 does not calculate commercial ranking, does not personalize recommendations, does not integrate Sales Agent, and does not add LLM behavior.
