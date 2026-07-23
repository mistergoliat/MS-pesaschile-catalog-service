import type { NormalizedProductQuery, ProductQueryNormalizer } from './contracts.js';

const STOP_WORDS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'el',
  'en',
  'hacer',
  'la',
  'las',
  'los',
  'para',
  'por',
  'que',
  'quiero',
  'un',
  'una',
  'unas',
  'unos',
  'busco',
  'necesito',
]);

function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeUnits(value: string): string {
  return value
    .replace(/\b(\d+(?:[.,]\d+)?)\s*(kilogramos|kilogramo|kilos|kilo|kgs|kg)\b/giu, '$1 kg')
    .replace(/\b(\d+(?:[.,]\d+)?)\s*(milimetros|milimetro|mms|mm)\b/giu, '$1 mm')
    .replace(/\b(\d+(?:[.,]\d+)?)\s*(centimetros|centimetro|cms|cm)\b/giu, '$1 cm')
    .replace(/\b(\d+(?:[.,]\d+)?)\s*(metros|metro|mts|mt|m)\b/giu, '$1 m');
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-z0-9.,]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

function extractUnitTokens(value: string): string[] {
  return [...value.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:kg|mm|cm|m)\b/gu)].map((match) => match[0].replace(/\s+/gu, ' '));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export class DefaultProductQueryNormalizer implements ProductQueryNormalizer {
  normalize(query: string): NormalizedProductQuery {
    const original = query;
    const compact = query.trim().replace(/\s+/gu, ' ');
    const normalized = normalizeUnits(removeDiacritics(compact).toLowerCase()).replace(/\s+/gu, ' ').trim();
    const tokens = tokenize(normalized);
    const unitTokens = extractUnitTokens(normalized);
    return {
      original,
      normalized,
      tokens,
      searchableTerms: unique([normalized, ...tokens, ...unitTokens]),
      unitTokens,
      synonymTerms: [],
    };
  }
}

export function normalizeCatalogText(value: string | undefined): string {
  return normalizeUnits(removeDiacritics(value ?? '').toLowerCase()).replace(/\s+/gu, ' ').trim();
}

export function tokenizeCatalogText(value: string | undefined): string[] {
  return tokenize(normalizeCatalogText(value));
}
