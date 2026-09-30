import { CATEGORY_TRUST_BY_ID, type MeaningfulCategoryTrust } from './categoryTrustMap.js';

export type CategoryCandidate = {
  id: number;
  name: string;
  levelDepth: number | null;
};

const TRUST_RANK: Record<MeaningfulCategoryTrust, number> = { SEMANTIC_STRONG: 0, SEMANTIC_WEAK: 1 };

/**
 * J1D-CAT-02: the product's meaningful category. PrestaShop's
 * `id_category_default` is the navigation root (`CATEGORÍAS`) for the whole
 * current catalog, so it is never used. Among the categories the product is
 * assigned to, only audited SEMANTIC_STRONG / SEMANTIC_WEAK ones qualify:
 * strongest trust, then deepest, then lowest id (deterministic). No qualifying
 * category → null, never a navigation/campaign/legacy/test category.
 */
export function selectMeaningfulCategory(
  candidates: readonly CategoryCandidate[],
  trustById: ReadonlyMap<number, MeaningfulCategoryTrust> = CATEGORY_TRUST_BY_ID,
): { id: string; name: string } | null {
  const ranked = candidates
    .filter((candidate) => trustById.has(candidate.id) && candidate.name.trim().length > 0)
    .sort((left, right) => (
      TRUST_RANK[trustById.get(left.id)!] - TRUST_RANK[trustById.get(right.id)!]
      || (right.levelDepth ?? 0) - (left.levelDepth ?? 0)
      || left.id - right.id
    ));
  const selected = ranked[0];
  return selected ? { id: String(selected.id), name: selected.name.trim() } : null;
}
