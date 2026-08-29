// Applies the registry's `nonProductExclusion` policy (Section 5) BEFORE any semantic rule runs.
// The registry only describes the policy (`knownExcludedProductIds`, `normalizedNameExclusionPatterns`)
// — this module is where A00.3 actually applies it, per the registry's own Section 7 note.

import type { NonProductExclusionPolicy } from '../commercial-product-ontology/index.js';
import { normalizeProductName } from './normalize.js';

export type NonProductExclusionResult =
  | { readonly excluded: false }
  | { readonly excluded: true; readonly exclusionReason: string; readonly matchedRule: string };

export function evaluateNonProductExclusion(
  productId: string,
  productName: string,
  policy: NonProductExclusionPolicy,
): NonProductExclusionResult {
  if (policy.knownExcludedProductIds.includes(productId)) {
    return {
      excluded: true,
      exclusionReason: `productId ${productId} is in the registry's knownExcludedProductIds list (confirmed service/installation/logistics line item).`,
      matchedRule: 'NON_PRODUCT_KNOWN_ID_V1',
    };
  }

  const normalizedName = normalizeProductName(productName);
  for (const patternSource of policy.normalizedNameExclusionPatterns) {
    const pattern = new RegExp(patternSource);
    if (pattern.test(normalizedName)) {
      return {
        excluded: true,
        exclusionReason: `normalized product name "${normalizedName}" matches non-product exclusion pattern /${patternSource}/.`,
        matchedRule: 'NON_PRODUCT_NAME_PATTERN_V1',
      };
    }
  }

  return { excluded: false };
}
