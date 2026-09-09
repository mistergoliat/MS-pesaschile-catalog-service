export function normalizeTrainingText(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function containsAnyTrainingToken(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

