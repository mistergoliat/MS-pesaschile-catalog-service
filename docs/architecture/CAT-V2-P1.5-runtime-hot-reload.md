# CAT-V2 P1.5 — Runtime projection hot reload

## Architecture

```text
CONTROL PLANE active.json
    → bounded polling observer
    → candidate loader and P1.4 compatibility validator
    → immutable RuntimeProjectionState
    → one reference swap in RuntimeProjectionManager
    → request-captured product semantic consumer
```

The manager is process-local and owns the loaded CAT-V2 projection bundle. `current()` returns a complete state, not independently mutable projections. The state contains bundle and activation IDs, load time, manifest, indexed Product Semantics, Training Semantics V1, Specs, and trust-map hashes. Relationships and Capabilities retain explicit `unavailable` entries. Price, stock, promotions and sellability are outside the state and remain live commercial truth.

`catalog:bundle:build` continues to validate source bytes and source-to-product membership at publication. The activation/runtime gate validates immutable published artifacts without requiring historical `canonical_input.json`. It verifies the PASS report, content-addressed bundle ID, artifact hashes, schemas, snapshot identities, embedded extraction lineage, cross-projection links, and P1.4 runtime compatibility. The published bundle must remain available to the API process.

## Startup, reload and request consistency

On startup, the manager reads the pointer and loads its candidate completely before publishing a state. No pointer produces `NO_ACTIVE_BUNDLE`; a corrupt pointer produces `CONTROL_PLANE_INVALID`; an unloadable desired bundle produces `FAILED` with no loaded state. The process and commercial endpoints can remain alive in each case. Polling defaults to 1 second and rejects intervals below 100 ms. Every attempt rereads the pointer before swap and compares `activationId`; a stale candidate is discarded and the latest desired activation is reconciled. Only one load runs at a time. Failures retain the old state and retry with bounded exponential backoff (1 to 30 seconds by default). A new activation bypasses that delay.

The swap assigns one immutable `RuntimeProjectionState` reference. Existing requests retain their captured reference through `AsyncLocalStorage`; new requests capture the new state in the HTTP `onRequest` hook. Old states are left for GC after in-flight requests complete. Rollback uses the same observation and load path as promotion. The runtime never changes the active pointer.

## Status and readiness

`/health/projections` reports desired bundle and activation, loaded bundle and activation, load time, reload state, last attempt/error, per-capability readiness, and last load measurements. The CLI `catalog:projection:status` remains a control-plane view and does not claim to inspect a remote API process. `/health/ready` continues to gate HTTP 503 only on commercial dependencies; projection failure reports degraded HTTP 200 when commercial truth remains available. `projectionRuntime` is `DEGRADED` when a valid old bundle is loaded but desired differs. Required loaded projections remain `READY`; unavailable optional projections remain `UNAVAILABLE`. Liveness is unchanged.

Product Semantics HTTP routes now read the manager's request-captured Product Semantics index when CAT-V2 is desired. With no CAT-V2 pointer, the previous legacy Product Semantics reader remains a temporary fallback. Training Semantics V2 HTTP routes and semantic discovery's Training V2 side still use their legacy V2 loader: the current CAT-V2 bundle contains Training V1, which cannot safely substitute for that public V2 contract. Relationship runtime remains independent. This compatibility bridge should be removed only when a CAT-V2 projection supports the V2 contract and consumers migrate without changing public responses.

## Operational bounds

The candidate and current bundle coexist during validation. Each successful attempt records artifact bytes, validation/construction/swap time, and heap/RSS before, during and after construction. Bundle IDs are structured log fields, not metric labels. The manager stores only the current state, not an in-memory history. Local filesystem semantics remain the control-plane assumption. Phase 2 search/discover/compose work is outside this phase.
