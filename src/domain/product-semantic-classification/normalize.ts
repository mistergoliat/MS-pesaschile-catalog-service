// Deterministic evidence normalization (Section 4). Raw evidence is never mutated — every
// normalizer here is a pure function returning a new string; callers keep the raw value alongside
// the normalized one (see rule evaluators, which always record both on `ClassificationEvidenceRecord`).

/**
 * Unicode-normalize, strip diacritics, lowercase, and collapse whitespace/punctuation to single
 * spaces — except `+`, which is preserved because it is the literal signal for an explicit
 * multi-component bundle (Section 7: `"Mancuernas Hexagonales + Rack Vertical"`).
 */
export function normalizeProductName(raw: string | null | undefined): string {
  return stripAccents(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Same normalization, without preserving `+` — used for category/feature values, which never carry bundle semantics. */
export function normalizeEvidenceValue(raw: string | null | undefined): string {
  return stripAccents(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Splits a normalized product name on the first literal `+` into (leftSubstring, rightSubstring).
 * Returns `null` when there is no `+`, i.e. no explicit multi-component bundle signal.
 */
export function splitExplicitBundleName(normalizedName: string): { readonly left: string; readonly right: string } | null {
  const index = normalizedName.indexOf('+');
  if (index < 0) return null;
  const left = normalizedName.slice(0, index).trim();
  const right = normalizedName.slice(index + 1).trim();
  if (left.length === 0 || right.length === 0) return null;
  return { left, right };
}
