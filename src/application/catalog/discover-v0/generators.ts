import { matchNominal, type NominalMatchTier } from '../../../domain/catalog/v2/nominalSearch.js';
import type { DiscoverConstraint, GeneratedCandidate, QueryInterpretation, RetrievalSignal } from './contracts.js';
import type { DiscoverIndex, ProductRetrievalDocument } from './retrievalDocument.js';
import { discoverTokens, isMeasureToken, stemToken } from './text.js';

/*
 * Candidate generators. Each one returns productKeys plus retrieval signals; none
 * reads or produces commercial data, and none decides constraint satisfaction.
 */

export const LEXICAL_POOL_LIMIT = 200;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const SYNONYM_WEIGHT = 0.8;
const PREFIX_WEIGHT = 0.5;
const PREFIX_EXPANSION_LIMIT = 20;
export const NOMINAL_TIER_SCORE: Record<Exclude<NominalMatchTier, 'description' | 'exact_reference'>, number> = { exact_name: 4, phrase: 3, all_tokens: 2 };

const exactNameCache = new WeakMap<DiscoverIndex, Map<string, string[]>>();

function exactNames(index: DiscoverIndex): Map<string, string[]> {
  let names = exactNameCache.get(index);
  if (!names) {
    names = new Map();
    for (const key of index.universe) {
      const normalized = discoverTokens(index.documents.get(key)!.name).join(' ');
      names.set(normalized, [...(names.get(normalized) ?? []), key]);
    }
    exactNameCache.set(index, names);
  }
  return names;
}

export class ExactCandidateGenerator {
  generate(index: DiscoverIndex, interpretation: QueryInterpretation): GeneratedCandidate[] {
    const out = new Map<string, RetrievalSignal[]>();
    const add = (key: string, signal: RetrievalSignal) => out.set(key, [...(out.get(key) ?? []), signal]);
    for (const key of interpretation.productKeyLookups) {
      if (index.documents.get(key)?.inUniverse) add(key, { generator: 'EXACT', kind: 'EXACT_PRODUCT_KEY', score: 1, source: 'PRODUCT_KEY', evidence: key });
    }
    const normalized = interpretation.normalizedQuery;
    if (normalized.length > 0) {
      for (const key of index.universe) {
        const document = index.documents.get(key)!;
        if (document.references.some((reference) => discoverTokens(reference).join(' ') === normalized)) {
          add(key, { generator: 'EXACT', kind: 'EXACT_REFERENCE', score: 1, source: 'SOURCE_REFERENCE', evidence: normalized });
        }
      }
      for (const key of exactNames(index).get(normalized) ?? []) add(key, { generator: 'EXACT', kind: 'EXACT_NAME', score: 1, source: 'SOURCE_NAME', evidence: normalized });
    }
    return [...out].map(([productKey, signals]) => ({ productKey, signals }));
  }
}

type QueryTerm = { term: string; weight: number; covers: number[]; via: 'TOKEN' | 'SYNONYM' | 'PREFIX'; origin: string };

function queryTerms(index: DiscoverIndex, interpretation: QueryInterpretation): QueryTerm[] {
  const tokens = interpretation.lexicalTokens;
  const terms: QueryTerm[] = [];
  tokens.forEach((token, position) => {
    const stem = stemToken(token);
    if (index.lexical.postings.has(stem) || isMeasureToken(token) || token.length < 4) {
      terms.push({ term: stem, weight: 1, covers: [position], via: 'TOKEN', origin: token });
      return;
    }
    const expansions = index.lexical.vocabulary.filter((candidate) => candidate.startsWith(stem) && !isMeasureToken(candidate)).slice(0, PREFIX_EXPANSION_LIMIT);
    if (expansions.length === 0) terms.push({ term: stem, weight: 1, covers: [position], via: 'TOKEN', origin: token });
    for (const expansion of expansions) terms.push({ term: expansion, weight: PREFIX_WEIGHT, covers: [position], via: 'PREFIX', origin: token });
  });
  for (const expansion of interpretation.synonymExpansions) {
    const covers = expansion.phrase.map((token) => tokens.indexOf(token)).filter((position) => position >= 0);
    for (const replacement of expansion.replacement) {
      terms.push({ term: stemToken(replacement), weight: SYNONYM_WEIGHT, covers, via: 'SYNONYM', origin: `${expansion.phrase.join(' ')}→${replacement}` });
    }
  }
  return terms;
}

function nominalTier(document: ProductRetrievalDocument, queries: readonly { text: string; viaSynonym: boolean }[]): { tier: NominalMatchTier; score: number; viaSynonym: boolean } | null {
  let best: { tier: NominalMatchTier; score: number; viaSynonym: boolean } | null = null;
  for (const query of queries) {
    if (!query.text) continue;
    const match = matchNominal({ query: query.text, name: document.name, shortDescription: null, references: document.references });
    if (!match || match.tier === 'description' || match.tier === 'exact_reference') continue;
    const score = NOMINAL_TIER_SCORE[match.tier] - (query.viaSynonym ? 0.5 : 0);
    if (!best || score > best.score) best = { tier: match.tier, score, viaSynonym: query.viaSynonym };
  }
  return best;
}

/** Query variants for the nominal tier: the lexical query and each governed-synonym substitution. */
function nominalQueries(interpretation: QueryInterpretation): { text: string; viaSynonym: boolean }[] {
  const base = interpretation.lexicalTokens;
  const variants = [{ text: base.join(' '), viaSynonym: false }];
  for (const expansion of interpretation.synonymExpansions) {
    const replaced = base.filter((token) => !expansion.phrase.includes(token));
    variants.push({ text: [...expansion.replacement, ...replaced].join(' '), viaSynonym: true });
  }
  return variants;
}

export class LexicalCandidateGenerator {
  generate(index: DiscoverIndex, interpretation: QueryInterpretation): GeneratedCandidate[] {
    const terms = queryTerms(index, interpretation);
    if (terms.length === 0) return [];
    const total = index.universe.length;
    const scores = new Map<string, { bm25: number; covered: Set<number>; contentCovered: boolean; matched: Set<string>; fields: Set<string>; synonym: boolean; prefix: boolean }>();
    for (const term of terms) {
      const postings = index.lexical.postings.get(term.term);
      if (!postings) continue;
      const idf = Math.log(1 + (total - postings.size + 0.5) / (postings.size + 0.5));
      for (const [productKey, posting] of postings) {
        const length = index.lexical.documentLength.get(productKey) ?? 0;
        const tf = posting.weightedTf;
        const contribution = term.weight * idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (length / (index.lexical.averageLength || 1))));
        const entry = scores.get(productKey) ?? { bm25: 0, covered: new Set<number>(), contentCovered: false, matched: new Set<string>(), fields: new Set<string>(), synonym: false, prefix: false };
        entry.bm25 += contribution;
        for (const position of term.covers) entry.covered.add(position);
        if (!isMeasureToken(term.term)) entry.contentCovered = true;
        entry.matched.add(term.via === 'TOKEN' ? term.term : term.origin);
        for (const field of posting.fields) entry.fields.add(field);
        if (term.via === 'SYNONYM') entry.synonym = true;
        if (term.via === 'PREFIX') entry.prefix = true;
        scores.set(productKey, entry);
      }
    }
    const tokenCount = Math.max(interpretation.lexicalTokens.length, 1);
    const queries = nominalQueries(interpretation);
    const candidates: (GeneratedCandidate & { order: [number, number, number, number] })[] = [];
    for (const [productKey, entry] of scores) {
      // Weak-match penalty: a measure alone never generates, and partial coverage is damped.
      if (!entry.contentCovered) continue;
      const coverage = entry.covered.size / tokenCount;
      if (coverage < 1 / 3 && tokenCount > 2) continue;
      const document = index.documents.get(productKey)!;
      const tier = nominalTier(document, queries);
      const lexical = entry.bm25 * (0.25 + 0.75 * coverage);
      const signals: RetrievalSignal[] = [{ generator: 'LEXICAL', kind: 'BM25', score: lexical, source: entry.fields.has('NAME') ? 'SOURCE_NAME' : entry.fields.has('BRAND') ? 'SOURCE_BRAND' : entry.fields.has('CATEGORY') ? 'SOURCE_CATEGORY' : 'SOURCE_FEATURE',
        evidence: `terms=${[...entry.matched].sort().join(',')}; fields=${[...entry.fields].sort().join(',')}; coverage=${coverage.toFixed(2)}` }];
      if (tier) signals.push({ generator: 'LEXICAL', kind: `NOMINAL_${tier.tier.toUpperCase()}`, score: tier.score, source: 'SOURCE_NAME', ...(tier.viaSynonym ? { evidence: 'via governed synonym' } : {}) });
      if (entry.synonym) signals.push({ generator: 'LEXICAL', kind: 'GOVERNED_SYNONYM', score: 0, source: 'SOURCE_NAME' });
      if (entry.prefix) signals.push({ generator: 'LEXICAL', kind: 'PREFIX_EXPANSION', score: 0, source: 'SOURCE_NAME' });
      candidates.push({ productKey, signals, order: [-(tier?.score ?? 0), -lexical, discoverTokens(document.name).length, document.productId] });
    }
    candidates.sort((left, right) => left.order[0] - right.order[0] || left.order[1] - right.order[1] || left.order[2] - right.order[2] || left.order[3] - right.order[3]);
    return candidates.slice(0, LEXICAL_POOL_LIMIT).map(({ productKey, signals }) => ({ productKey, signals }));
  }
}

const CONCEPT_KINDS = new Set(['PRODUCT_TYPE', 'EXERCISE', 'TRAINING_FUNCTION', 'ANATOMY', 'DISCIPLINE', 'USE_CONTEXT']);

export function admissionFor(document: ProductRetrievalDocument, axis: string, specKey?: string): string {
  const admission = document.admission;
  if (!admission) return 'NOT_EVALUATED';
  if (axis === 'SPEC') return admission.specFilteringByKey[specKey ?? ''] ?? 'UNKNOWN';
  if (axis === 'TRAINING_FUNCTION') return admission.functionDiscovery;
  if (axis === 'EXERCISE_CAPABILITY' || axis === 'MUSCLE_GROUP' || axis === 'BODY_REGION') return admission.exerciseDiscovery;
  return admission.productDiscovery;
}

function conceptSignal(document: ProductRetrievalDocument, axis: string, code: string, soft: boolean): RetrievalSignal {
  const kind = soft ? 'CONCEPT_MATCH_SOFT' : 'CONCEPT_MATCH';
  const admission = admissionFor(document, axis);
  if (axis === 'PRODUCT_FAMILY' || axis === 'DISCIPLINE' || axis === 'USE_CONTEXT') {
    const semantic = document.productSemantics!;
    const tags = axis === 'PRODUCT_FAMILY' ? [...(semantic.primaryFamily ? [semantic.primaryFamily] : []), ...semantic.secondaryFamilies]
      : axis === 'DISCIPLINE' ? semantic.disciplines : semantic.useContexts;
    const tag = tags.find((item) => item.code === code);
    return { generator: 'STRUCTURED', kind, score: 1, source: 'PRODUCT_SEMANTICS', matchedConcept: `${axis}:${code}`, confidence: tag?.confidence, evidence: tag?.ruleId, admission };
  }
  if (axis === 'TRAINING_FUNCTION') {
    const fn = document.training?.functions.find((item) => item.code === code);
    return { generator: 'STRUCTURED', kind, score: 1, source: 'TRAINING_V2', matchedConcept: `${axis}:${code}`, confidence: fn?.relationType, evidence: fn?.ruleIds.join(','), admission };
  }
  const exercise = document.training?.exercises.find((item) => axis === 'EXERCISE_CAPABILITY' ? item.code === code
    : axis === 'MUSCLE_GROUP' ? item.muscleGroups.includes(code) : item.bodyRegions.includes(code));
  return { generator: 'STRUCTURED', kind, score: 1, source: 'TRAINING_V2', matchedConcept: `${axis}:${code}`, confidence: exercise?.relationType,
    evidence: exercise ? `${exercise.code}:${exercise.ruleIds.join(',')}` : undefined, admission };
}

export function specSatisfies(operator: DiscoverConstraint['operator'], actual: number, expected: number): boolean {
  if (operator === 'GTE') return actual >= expected;
  if (operator === 'LTE') return actual <= expected;
  return Math.abs(actual - expected) <= Math.max(0.01 * expected, 0.05);
}

export class StructuredCandidateGenerator {
  generate(index: DiscoverIndex, interpretation: QueryInterpretation): GeneratedCandidate[] {
    const out = new Map<string, RetrievalSignal[]>();
    const add = (key: string, signal: RetrievalSignal) => out.set(key, [...(out.get(key) ?? []), signal]);
    const constraints = [...interpretation.hardConstraints.map((constraint) => ({ constraint, soft: false })),
      ...interpretation.softPreferences.map((constraint) => ({ constraint, soft: true }))];
    for (const { constraint, soft } of constraints) {
      if (!CONCEPT_KINDS.has(constraint.kind) || !constraint.axis) continue;
      for (const code of constraint.codes ?? []) {
        for (const key of [...(index.structured.get(`${constraint.axis}:${code}`) ?? [])].sort()) add(key, conceptSignal(index.documents.get(key)!, constraint.axis, code, soft));
      }
    }
    const conceptPool = new Set(out.keys());
    for (const { constraint, soft } of constraints) {
      if (constraint.kind !== 'SPEC' || !constraint.specKey || constraint.value === undefined) continue;
      const bucket = [...(index.structured.get(`SPEC:${constraint.specKey}`) ?? [])].sort();
      for (const key of bucket) {
        // Spec retrieval refines a concept pool when one exists; alone it retrieves directly.
        if (conceptPool.size > 0 && !conceptPool.has(key)) continue;
        const document = index.documents.get(key)!;
        const spec = (document.specs ?? []).find((item) => item.key === constraint.specKey && item.status === 'parsed' && item.value !== null
          && specSatisfies(constraint.operator, item.value, constraint.value!));
        if (!spec) continue;
        add(key, { generator: 'STRUCTURED', kind: spec.qualifier ? 'SPEC_MATCH_QUALIFIED' : soft ? 'SPEC_MATCH_SOFT' : 'SPEC_MATCH', score: 1, source: 'SPECS',
          matchedConcept: `SPEC:${constraint.specKey}${constraint.operator}${constraint.value}`, evidence: `${spec.rawValue} [feature ${spec.featureId}/${spec.featureValueId}]`,
          admission: admissionFor(document, 'SPEC', constraint.specKey) });
      }
    }
    return [...out].map(([productKey, signals]) => ({ productKey, signals }));
  }
}

/** True when every stem appears in the product's indexed source text (name, brand, trusted categories/features). */
export function hasIndexedText(index: DiscoverIndex, productKey: string, stems: readonly string[]): boolean {
  return stems.every((stem) => index.lexical.postings.get(stem)?.has(productKey) ?? false);
}

/** CandidateFusion: union by productKey (the only identity), signals concatenated in generator order. */
export class CandidateFusion {
  fuse(...lists: readonly GeneratedCandidate[][]): GeneratedCandidate[] {
    const merged = new Map<string, RetrievalSignal[]>();
    for (const list of lists) for (const candidate of list) merged.set(candidate.productKey, [...(merged.get(candidate.productKey) ?? []), ...candidate.signals]);
    return [...merged].map(([productKey, signals]) => ({ productKey, signals }));
  }
}
