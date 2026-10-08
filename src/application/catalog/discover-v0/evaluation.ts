/*
 * Ranking-comparison and relevance metrics for CAT-DISCOVER-V0.
 *
 * Relevance metrics (P@3, R@8, MRR, nDCG@8) are only meaningful against an
 * ADJUDICATED gold; callers must not apply them to unadjudicated queries.
 * Diagnostics (overlap, Jaccard, rank shifts) need no gold and claim no quality.
 */

export function precisionAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (k <= 0) return 0;
  return ranked.slice(0, k).filter((key) => relevant.has(key)).length / k;
}

export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number | null {
  if (relevant.size === 0) return null;
  return ranked.slice(0, k).filter((key) => relevant.has(key)).length / relevant.size;
}

export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  const position = ranked.findIndex((key) => relevant.has(key));
  return position === -1 ? 0 : 1 / (position + 1);
}

/** Binary-gain nDCG@k. */
export function ndcgAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number | null {
  if (relevant.size === 0) return null;
  const dcg = ranked.slice(0, k).reduce((sum, key, position) => sum + (relevant.has(key) ? 1 / Math.log2(position + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(k, relevant.size) }, (_value, position) => 1 / Math.log2(position + 2)).reduce((sum, value) => sum + value, 0);
  return ideal === 0 ? null : dcg / ideal;
}

export type ListComparison = {
  leftCount: number;
  rightCount: number;
  overlap: number;
  jaccard: number | null;
  added: string[];
  removed: string[];
  top1Changed: boolean;
  meanAbsRankShift: number | null;
};

export function compareLists(left: readonly string[], right: readonly string[]): ListComparison {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const common = left.filter((key) => rightSet.has(key));
  const union = new Set([...left, ...right]);
  const shifts = common.map((key) => Math.abs(left.indexOf(key) - right.indexOf(key)));
  return {
    leftCount: left.length,
    rightCount: right.length,
    overlap: common.length,
    jaccard: union.size === 0 ? null : common.length / union.size,
    added: right.filter((key) => !leftSet.has(key)),
    removed: left.filter((key) => !rightSet.has(key)),
    top1Changed: (left[0] ?? null) !== (right[0] ?? null),
    meanAbsRankShift: shifts.length === 0 ? null : shifts.reduce((sum, value) => sum + value, 0) / shifts.length,
  };
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}
