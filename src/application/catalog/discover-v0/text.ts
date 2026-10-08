import { createHash } from 'node:crypto';
import { nominalTokens } from '../../../domain/catalog/v2/nominalSearch.js';
import { normalizeCatalogSearchText } from '../../../domain/catalog/searchTextNormalization.js';

/*
 * Text primitives shared by the interpreter and the lexical generator. Tokens
 * are the nominal-search tokens (J1D-CAT-01: accent/case folded, measures folded
 * into one token such as "20kg"), so discover and catalog.search tokenize alike.
 */

export const MEASURE_TOKEN = /^(\d+(?:\.\d+)?)(kg|g|lb|mm|cm|m)$/u;

export function discoverTokens(text: string): string[] {
  return nominalTokens(text);
}

export function normalizedText(text: string): string {
  return normalizeCatalogSearchText(text);
}

/** Plural folding only (same rule as nominal search): never a fuzzy stem. */
export function stemToken(token: string): string {
  return token.length >= 4 && !/\d/u.test(token) && token.endsWith('s') ? token.slice(0, -1) : token;
}

export function isMeasureToken(token: string): boolean {
  return MEASURE_TOKEN.test(token);
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
