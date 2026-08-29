// Section 17/18: deterministic registry hash and canonical serialization.
//
// Reuses `sha256Stable`/`stableStringify` from `shared/checksum.ts` — a generic, dependency-free
// deterministic-JSON-hash utility (ported unchanged from MS-pesaschile-customer-profile's
// `customer-rfm/checksum.ts` during the CUSTOMER-INTELLIGENCE-R2-A00.3.2 ownership migration, since
// `customer-rfm` itself is out of scope here) rather than redefining hashing in this domain.
// `stableStringify` sorts object keys alphabetically at every level, so key-insertion order never
// affects the hash; array order is deterministic by construction (every registry array is a fixed
// literal defined in canonical source order, never derived from object/Map iteration). The registry
// contains no timestamps or runtime-dependent values, so the hash is stable across executions and
// across machines.

import { sha256Stable, stableStringify } from '../../shared/checksum.js';
import type { CommercialProductOntologyRegistry } from './contracts.js';

/** Canonical, deterministic JSON serialization of the registry — suitable for audits, semantic-snapshot embedding, and debugging. */
export function serializeCommercialProductOntologyRegistry(registry: CommercialProductOntologyRegistry): string {
  return stableStringify(registry);
}

/** Deterministic sha256 hex digest of the canonical serialization. Embed this in future semantic snapshots. */
export function computeCommercialProductOntologyRegistryHash(registry: CommercialProductOntologyRegistry): string {
  return sha256Stable(registry);
}
