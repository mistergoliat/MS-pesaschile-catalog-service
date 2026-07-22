# Active Relationship Snapshot Runtime Reader

## Purpose

T07 carga el snapshot activo y lo convierte en un indice de lectura.

It consumes the active `ProductRelationshipSnapshot` published by T06 and prepares an in-memory index by source product.

T07 no calcula nuevas relaciones.

T07 no decide que producto debe recomendarse comercialmente.

T08 consumira T07 para construir recomendaciones comerciales.

## Snapshot vs Runtime Index

The T06 snapshot is the canonical publication unit.

The T07 index is derived runtime state:

```text
source product identity -> outgoing relationships
```

The index is not persisted in the snapshot, does not participate in `snapshotId`, and can be rebuilt from the active snapshot.

## Product Identity

Runtime identity uses:

```text
<productId>::<combination>
```

Base products use:

```text
<base>
```

Examples:

```text
123::<base>
123::456
barra-olimpica::<base>
```

Product ID and real combination ID components are encoded so a literal separator or `<base>` value cannot collide with another identity.

## Refresh

T07 does not consult the store on each recommendation query.

The caller explicitly runs:

```text
refresh()
```

Refresh reads `store.getActive()`, builds the full index, then replaces the active index reference.

Las consultas no acceden al store.

There is no polling, cron, worker, lock, or background refresh in T07 V1.

## Refresh States

Refresh returns:

- `loaded`: a different active snapshot was loaded and indexed.
- `unchanged`: the same `snapshotId` was already loaded.
- `cleared`: the store has no active snapshot.

If the reader is already empty and the store has no active snapshot, the status is still `cleared`, with `snapshotChanged = false`.

## Atomic Replacement

The reader builds the new index completely before replacing the current index.

Un refresh fallido no reemplaza el indice valido anterior.

If a new active snapshot is corrupt or index construction fails, the previous ready index remains available and the error is propagated.

## Reader Status

Initial status:

```text
not_loaded
```

After a successful load:

```text
ready
```

Ready metadata includes snapshot ID, schema version, model version, evidence window, relationship count, and source count.

Metadata comes from the loaded index. It does not trigger another store read.

## Queries

`findBySource()` requires a loaded index.

It:

1. validates the query;
2. builds the source runtime identity;
3. reads the source bucket from memory;
4. optionally filters by relationship type;
5. optionally applies `limit`;
6. preserves order.

If no snapshot is loaded, T07 throws `RUNTIME_SNAPSHOT_NOT_LOADED`.

This is intentionally different from a valid source with no relationships, which returns an empty result with `totalMatched = 0`.

## Filters and Limit

`relationshipTypes` is a technical filter:

- absent means all types;
- empty array means zero results;
- duplicates behave like a set;
- invalid types reject the query.

`limit` is optional. When present it must be a positive integer.

T07 does not define a default limit. T08 can decide commercial limits such as top 3, top 5, or top 10.

## Empty Snapshot

T06 can explicitly publish an empty snapshot.

T07 loads it as `ready`:

```text
relationshipCount = 0
sourceCount = 0
```

Queries return empty arrays without throwing, because the knowledge base is loaded but contains no relationships.

## Minimal Runtime Validation

T07 validates only read integrity:

- `relationshipCount === relationships.length`;
- relationship model version matches snapshot model version;
- relationship evidence window matches snapshot evidence window;
- source and target product identities are constructible;
- exact duplicate relationships are rejected.

T07 does not validate support, confidence, lift, reliability, association policy, or publication thresholds.

## Immutability

The runtime index clones relationship content from the snapshot and freezes indexed arrays and objects.

Queries return frozen arrays:

- the source bucket itself when no filtering or limiting is needed;
- a new frozen array when filters or limits are applied.

The reader does not mutate snapshots, relationships, evidence, products, arrays from the store, or query objects.

## Ordering

T07 preserves the canonical order delivered by T06.

It does not sort by reliability, support, confidence, lift, joint count, price, stock, margin, or commercial score.

Commercial ranking belongs to T08 or a later service.

## Excluded Scope

T07 does not implement SQL, migrations, Redis, endpoints, controllers, cron jobs, workers, Excel, panels, CRM integration, e-commerce integration, stock rules, margin rules, product hydration, personalization, fallback calculation, publication, or T08 Recommendation Service.
