// Generic, dependency-free deterministic-JSON-hash utility. Ported unchanged from
// MS-pesaschile-customer-profile's `src/domain/customer-rfm/checksum.ts` during the
// CUSTOMER-INTELLIGENCE-R2-A00.3.2 ownership migration — used by the commercial-product-ontology
// registry hash and the product-semantic-classification checksum, both migrated alongside it.

import { createHash } from 'node:crypto';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export function sha256Stable(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
