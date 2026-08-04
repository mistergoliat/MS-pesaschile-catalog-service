import { describe, expect, it } from 'vitest';
import {
  catalogSearchQueryVariants,
  normalizeCatalogSearchText,
  tokenizeCatalogSearchText,
} from '../../src/domain/catalog/searchTextNormalization.js';

describe('catalog search text normalization', () => {
  it.each([
    ['barra ol\u00edmpica 20 kg', 'barra olimpica 20kg'],
    ['barra olimpica 20kg', 'barra olimpica 20kg'],
    ['barra 20 KG', 'barra 20kg'],
    ['barra 20-kgs', 'barra 20kg'],
    ['disco 2,5 kg', 'disco 2.5kg'],
    ['disco 2.50kg', 'disco 2.5kg'],
    ['barra 220 cm', 'barra 220cm'],
    ['mancuerna 50 mm', 'mancuerna 50mm'],
    ['mancuerna 50-mm', 'mancuerna 50mm'],
    ['disco 10 lbs', 'disco 10lb'],
    ['barra   ol\u00edmpica', 'barra olimpica'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCatalogSearchText(input)).toBe(expected);
  });

  it.each([
    ['programa', 'programa'],
    ['gimnasio', 'gimnasio'],
    ['premium', 'premium'],
    ['modelo m20', 'modelo m20'],
    ['mega', 'mega'],
  ])('does not treat unit letters inside words as units for %s', (input, expected) => {
    expect(normalizeCatalogSearchText(input)).toBe(expected);
  });

  it('builds one variant when the original query is already canonical', () => {
    expect(catalogSearchQueryVariants('barra olimpica 20kg')).toEqual(['barra olimpica 20kg']);
  });

  it('builds at most original and canonical variants in deterministic order', () => {
    expect(catalogSearchQueryVariants('barra ol\u00edmpica 20 kg')).toEqual([
      'barra ol\u00edmpica 20 kg',
      'barra olimpica 20kg',
    ]);
  });

  it('removes empty variants and exact duplicates', () => {
    expect(catalogSearchQueryVariants('   ')).toEqual([]);
    expect(catalogSearchQueryVariants(' barra olimpica 20kg ')).toEqual(['barra olimpica 20kg']);
  });

  it('tokenizes canonical catalog search text', () => {
    expect(tokenizeCatalogSearchText('barra ol\u00edmpica 20 kg')).toEqual(['barra', 'olimpica', '20kg']);
  });
});
