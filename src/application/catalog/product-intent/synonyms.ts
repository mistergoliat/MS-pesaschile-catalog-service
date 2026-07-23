import type { NormalizedProductQuery, ProductSearchSynonymProvider } from './contracts.js';

export type ProductSearchSynonymRule = {
  readonly phrases: readonly string[];
  readonly terms: readonly string[];
};

export const DEFAULT_PRODUCT_SEARCH_SYNONYMS: readonly ProductSearchSynonymRule[] = Object.freeze([
  { phrases: ['barra'], terms: ['barra olimpica', 'barra z', 'barra hexagonal'] },
  { phrases: ['pesas rusas', 'pesa rusa'], terms: ['kettlebell'] },
  { phrases: ['discos bumper', 'disco bumper'], terms: ['disco bumper', 'discos bumper'] },
  { phrases: ['discos de goma', 'disco de goma'], terms: ['discos bumper', 'disco bumper', 'discos rubber'] },
  {
    phrases: ['barra para sentadilla', 'barra para sentadillas', 'barra para hacer sentadilla', 'barra para hacer sentadillas', 'barra sentadilla'],
    terms: ['barra olimpica'],
  },
  { phrases: ['collarines', 'collarin'], terms: ['cierres barra', 'seguros barra', 'seguro olimpico'] },
  { phrases: ['maquina de cuadriceps', 'maquina cuadriceps'], terms: ['extension de piernas', 'extensiones de piernas'] },
  { phrases: ['maquina femoral'], terms: ['curl femoral'] },
]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export class StaticProductSearchSynonymProvider implements ProductSearchSynonymProvider {
  constructor(private readonly rules: readonly ProductSearchSynonymRule[] = DEFAULT_PRODUCT_SEARCH_SYNONYMS) {}

  expand(query: NormalizedProductQuery): NormalizedProductQuery {
    const synonymTerms = this.rules.flatMap((rule) => (
      rule.phrases.some((phrase) => (phrase === 'barra' ? query.normalized === phrase : query.normalized.includes(phrase))) ? rule.terms : []
    ));
    return {
      ...query,
      synonymTerms: unique(synonymTerms),
      searchableTerms: unique([...query.searchableTerms, ...synonymTerms]),
    };
  }
}
