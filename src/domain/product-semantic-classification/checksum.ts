// Deterministic classification checksum (Section 27). Reuses `sha256Stable`/`stableStringify` from
// `shared/checksum.ts` (ported unchanged from MS-pesaschile-customer-profile's `customer-rfm/checksum.ts`
// during the CUSTOMER-INTELLIGENCE-R2-A00.3.2 ownership migration) — the same utility the
// commercial-product-ontology registry's own hash uses — rather than redefining hashing here.

import { sha256Stable, stableStringify } from '../../shared/checksum.js';
import type { ProductSemanticClassificationResult } from './contracts.js';

/**
 * Canonical, deterministic checksum over a full classification run. Results are sorted by
 * `productId` before hashing so caller iteration order never affects the checksum.
 */
export function computeClassificationChecksum(results: readonly ProductSemanticClassificationResult[]): string {
  const sorted = [...results].sort((a, b) => a.productId.localeCompare(b.productId, undefined, { numeric: true }));
  return sha256Stable(sorted);
}

export { stableStringify };
