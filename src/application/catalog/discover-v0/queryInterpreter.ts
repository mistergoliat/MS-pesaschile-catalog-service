import type { ConceptAxis, DiscoverConstraint, InterpretationEntry, QueryInterpretation, SpecKeyV0 } from './contracts.js';
import {
  DISCOVER_V0_LEXICON,
  DISCOVER_V0_LEXICON_VERSION,
  LOAD_FAMILIES_FOR_WEIGHT_SPEC,
  type ConceptLexiconEntry,
  type LexiconEntry,
  type MarkerLexiconEntry,
  type SynonymLexiconEntry,
} from './lexicon.js';
import { discoverTokens, MEASURE_TOKEN, stemToken } from './text.js';

/*
 * DiscoverQueryInterpreter — deterministic, bounded interpretation.
 *
 * 1. Typed constraint patterns (price, user weight, load, dimensions) over the
 *    folded token string; their tokens are consumed.
 * 2. Longest-match lexicon pass over the remaining tokens: concepts, unmodeled
 *    terms, compatibility / soft / commercial markers and fillers.
 * 3. A bare weight measure becomes weight_kg only when a load family was named.
 * 4. Governed lexical synonyms are a separate, non-consuming pass.
 *
 * Anything else stays UNKNOWN and is kept as retrieval text.
 */

type TokenState = 'free' | 'filler' | 'constraint' | 'concept' | 'unmodeled' | 'marker' | 'target' | 'id' | 'measure';
type Compiled = { entry: LexiconEntry; termStems: string[][] };
type ConceptHit = { entry: ConceptLexiconEntry; text: string; soft: boolean; target: boolean; component: boolean; position: number };

const DIMENSION_KEYS: Record<string, SpecKeyV0> = {
  largo: 'assembled_length_cm', longitud: 'assembled_length_cm', ancho: 'assembled_width_cm', alto: 'assembled_height_cm', altura: 'assembled_height_cm',
};
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const LTE_WORDS = String.raw`(?:menos de|menor a|menor que|hasta|no mas de|maximo|max|como maximo)`;
const GTE_WORDS = String.raw`(?:mas de|mayor a|mayor que|al menos|minimo|sobre)`;

type PatternRule = {
  id: string;
  regex: RegExp;
  build: (match: RegExpExecArray, raw: string) => Omit<DiscoverConstraint, 'id' | 'matchedText'> | null;
};

function toCentimeters(value: number, unit: string): number {
  return unit === 'm' ? value * 100 : unit === 'mm' ? value / 10 : value;
}

function parseClp(amount: string, multiplier: string | undefined): number | null {
  const plain = /^\d{1,3}(?:\.\d{3})+$/u.test(amount) ? amount.replace(/\./gu, '') : amount;
  const value = Number(plain);
  if (!Number.isFinite(value)) return null;
  return multiplier === 'mil' || multiplier === 'lucas' ? value * 1000 : value;
}

const PATTERNS: PatternRule[] = [
  {
    id: 'price-max',
    regex: new RegExp(String.raw`\b(?:menos de|hasta|maximo|max|no mas de|por menos de|bajo|inferior a|presupuesto de|presupuesto)\s+(\d+(?:\.\d{3})*|\d+)(?:\s+(mil|lucas))?(?:\s+(?:pesos|clp))?\b`, 'gu'),
    build: (match, raw) => {
      const isMoney = match[2] !== undefined || /\$\s*\d/u.test(raw) || /\b(pesos|clp|lucas)\b/iu.test(raw) || Number(match[1]!.replace(/\./gu, '')) >= 1000;
      if (!isMoney) return null;
      const value = parseClp(match[1]!, match[2]);
      return value === null ? null : { kind: 'COMMERCIAL_MAX_PRICE', domain: 'COMMERCIAL', operator: 'LTE', value, unit: 'CLP' };
    },
  },
  {
    id: 'user-weight',
    regex: new RegExp(String.raw`\b(?:(?:persona|personas|usuario|usuarios)\s+(?:de\s+)?(?:hasta\s+)?(?:mas de\s+)?|peso (?:maximo )?(?:de|del) usuario\s+(?:de\s+)?(?:hasta\s+)?)${NUMBER}kg\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: 'max_user_weight_kg', operator: 'GTE', value: Number(match[1]), unit: 'kg' }),
  },
  {
    id: 'user-weight-suffix',
    regex: new RegExp(String.raw`\b${NUMBER}kg\s+de\s+(?:peso\s+de\s+)?(?:usuario|persona)\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: 'max_user_weight_kg', operator: 'GTE', value: Number(match[1]), unit: 'kg' }),
  },
  {
    id: 'load',
    regex: new RegExp(String.raw`\b(?:soporta|soportar|soporte|aguante|aguanta|resista|resiste|carga maxima|capacidad de carga|capacidad|carga)\s+(?:de\s+|hasta\s+|maxima de\s+|al menos\s+|minima de\s+)*${NUMBER}kg\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: 'max_load_kg', operator: 'GTE', value: Number(match[1]), unit: 'kg' }),
  },
  {
    id: 'dimension-lte-prefix',
    regex: new RegExp(String.raw`\b${LTE_WORDS}\s+${NUMBER}(cm|mm|m)\s+(?:de\s+)?(largo|longitud|ancho|alto|altura)\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: DIMENSION_KEYS[match[3]!]!, operator: 'LTE', value: toCentimeters(Number(match[1]), match[2]!), unit: 'cm' }),
  },
  {
    id: 'dimension-gte-prefix',
    regex: new RegExp(String.raw`\b${GTE_WORDS}\s+${NUMBER}(cm|mm|m)\s+(?:de\s+)?(largo|longitud|ancho|alto|altura)\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: DIMENSION_KEYS[match[3]!]!, operator: 'GTE', value: toCentimeters(Number(match[1]), match[2]!), unit: 'cm' }),
  },
  {
    id: 'dimension-lte-suffix',
    regex: new RegExp(String.raw`\b(largo|longitud|ancho|alto|altura)\s+(?:maximo\s+|max\s+)?(?:de\s+)?${LTE_WORDS}?\s*${NUMBER}(cm|mm|m)\b`, 'gu'),
    build: (match) => /maximo|max|menos|menor|hasta|no mas/u.test(match[0])
      ? { kind: 'SPEC', domain: 'TECHNICAL', specKey: DIMENSION_KEYS[match[1]!]!, operator: 'LTE', value: toCentimeters(Number(match[2]), match[3]!), unit: 'cm' }
      : null,
  },
];

const compiledLexicon: Compiled[] = DISCOVER_V0_LEXICON.map((entry) => ({
  entry,
  termStems: entry.terms.map((term) => discoverTokens(term).map(stemToken)),
}));

function longestMatchAt(stems: readonly string[], states: readonly TokenState[], start: number, entries: readonly Compiled[], requireFree: boolean) {
  let best: { compiled: Compiled; length: number } | null = null;
  for (const compiled of entries) {
    for (const term of compiled.termStems) {
      if (term.length === 0 || start + term.length > stems.length) continue;
      if (best && term.length <= best.length) continue;
      let ok = true;
      for (let offset = 0; offset < term.length; offset += 1) {
        if (stems[start + offset] !== term[offset] || (requireFree && states[start + offset] !== 'free')) { ok = false; break; }
      }
      if (ok) best = { compiled, length: term.length };
    }
  }
  return best;
}

function tokenOffsets(tokens: readonly string[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const token of tokens) {
    offsets.push(cursor);
    cursor += token.length + 1;
  }
  return offsets;
}

export class DiscoverQueryInterpreter {
  private readonly conceptAndMarkers: Compiled[];
  private readonly synonyms: Compiled[];

  constructor(lexicon: readonly Compiled[] = compiledLexicon) {
    this.conceptAndMarkers = lexicon.filter((item) => item.entry.type !== 'LEXICAL_SYNONYM');
    this.synonyms = lexicon.filter((item) => item.entry.type === 'LEXICAL_SYNONYM');
  }

  interpret(query: string): QueryInterpretation {
    const tokens = discoverTokens(query);
    const stems = tokens.map(stemToken);
    const states: TokenState[] = tokens.map(() => 'free');
    const entries: { position: number; entry: InterpretationEntry }[] = [];
    const hard: DiscoverConstraint[] = [];
    const soft: DiscoverConstraint[] = [];
    const productKeyLookups: string[] = [];
    const joined = tokens.join(' ');
    const offsets = tokenOffsets(tokens);
    const push = (target: DiscoverConstraint[], constraint: Omit<DiscoverConstraint, 'id'>) => {
      target.push({ ...constraint, id: `${constraint.kind}#${hard.length + soft.length + 1}` } as DiscoverConstraint);
    };

    // 1. Typed constraint patterns.
    for (const rule of PATTERNS) {
      rule.regex.lastIndex = 0;
      for (let match = rule.regex.exec(joined); match; match = rule.regex.exec(joined)) {
        const first = offsets.findIndex((offset) => offset >= match!.index);
        const end = match.index + match[0].length;
        const covered: number[] = [];
        for (let index = Math.max(first, 0); index < tokens.length && offsets[index]! < end; index += 1) covered.push(index);
        if (covered.length === 0 || covered.some((index) => states[index] !== 'free')) continue;
        const built = rule.build(match, query);
        if (!built) continue;
        for (const index of covered) states[index] = 'constraint';
        push(hard, { ...built, matchedText: match[0] });
        entries.push({ position: covered[0]!, entry: { text: match[0], state: 'CONSTRAINT', axis: built.kind === 'SPEC' ? 'SPEC' : 'COMMERCIAL', code: built.specKey ?? built.kind, note: `pattern:${rule.id}` } });
      }
    }

    // 2. Exact product keys.
    tokens.forEach((token, index) => {
      if (states[index] === 'free' && /^p[1-9]\d{0,6}$/u.test(token)) {
        states[index] = 'id';
        productKeyLookups.push(`P${token.slice(1)}`);
        entries.push({ position: index, entry: { text: token, state: 'RECOGNIZED', axis: 'EXACT_ID', code: `P${token.slice(1)}` } });
      }
    });

    // 3. Longest-match lexicon pass.
    const concepts: ConceptHit[] = [];
    let softMode = false;
    let compatibility: { position: number; text: string } | null = null;
    for (let index = 0; index < tokens.length;) {
      if (states[index] !== 'free') { index += 1; continue; }
      const best = longestMatchAt(stems, states, index, this.conceptAndMarkers, true);
      if (!best) { index += 1; continue; }
      const text = tokens.slice(index, index + best.length).join(' ');
      const entry = best.compiled.entry;
      const mark = (state: TokenState) => { for (let offset = 0; offset < best.length; offset += 1) states[index + offset] = state; };
      if (entry.type === 'CONCEPT') {
        const previous = index > 0 ? tokens[index - 1] : undefined;
        const purposeTarget = entry.axis === 'PRODUCT_FAMILY' && previous === 'para'
          && concepts.some((hit) => hit.entry.axis === 'PRODUCT_FAMILY' && !hit.target);
        // "<family> con <family>": the second family is a bundle component (pack composition is not modeled).
        const component = entry.axis === 'PRODUCT_FAMILY' && previous === 'con' && !purposeTarget && compatibility === null
          && concepts.some((hit) => hit.entry.axis === 'PRODUCT_FAMILY' && !hit.target && !hit.component);
        const target = compatibility !== null || purposeTarget;
        mark(target ? 'target' : 'concept');
        concepts.push({ entry, text, soft: softMode, target, component, position: index });
        if (component) {
          push(hard, { kind: 'BUNDLE_COMPONENT', domain: 'TECHNICAL', matchedText: `con ${text}`, target: entry.code,
            subtypeText: [discoverTokens(text).filter((token) => !SUBTYPE_STOPWORDS.has(token)).map(stemToken)] });
        }
        entries.push({ position: index, entry: { text, state: 'RECOGNIZED', axis: entry.axis, code: entry.code, lexiconEntryId: entry.id,
          ...(target ? { note: compatibility ? 'COMPATIBILITY_TARGET' : 'PURPOSE_TARGET_COMPATIBILITY_NOT_VERIFIABLE' } : {}) } });
        if (purposeTarget && compatibility === null) {
          push(hard, { kind: 'COMPATIBILITY', domain: 'TECHNICAL', matchedText: `para ${text}`, target: entry.code });
        }
      } else if (entry.type === 'UNMODELED') {
        mark('unmodeled');
        entries.push({ position: index, entry: { text, state: 'UNKNOWN', axis: 'UNMODELED', lexiconEntryId: entry.id, note: entry.note } });
        const blocking = (entry as MarkerLexiconEntry).blocking;
        if (blocking) push(hard, { kind: blocking, domain: 'TECHNICAL', matchedText: text, target: entry.id });
      } else if (entry.type === 'COMPATIBILITY') {
        mark('marker');
        compatibility = { position: index, text };
        entries.push({ position: index, entry: { text, state: 'CONSTRAINT', axis: 'COMPATIBILITY', lexiconEntryId: entry.id, note: entry.note } });
      } else if (entry.type === 'SOFT_MARKER') {
        mark('marker');
        softMode = true;
        entries.push({ position: index, entry: { text, state: 'RECOGNIZED', lexiconEntryId: entry.id, note: entry.note } });
      } else if (entry.type === 'COMMERCIAL_LOW_PRICE') {
        mark('marker');
        push(soft, { kind: 'COMMERCIAL_LOW_PRICE', domain: 'COMMERCIAL', matchedText: text });
        entries.push({ position: index, entry: { text, state: 'CONSTRAINT', axis: 'COMMERCIAL', code: 'COMMERCIAL_LOW_PRICE', lexiconEntryId: entry.id } });
      } else if (entry.type === 'COMMERCIAL_AVAILABILITY') {
        mark('marker');
        push(hard, { kind: 'COMMERCIAL_AVAILABILITY', domain: 'COMMERCIAL', matchedText: text });
        entries.push({ position: index, entry: { text, state: 'CONSTRAINT', axis: 'COMMERCIAL', code: 'COMMERCIAL_AVAILABILITY', lexiconEntryId: entry.id } });
      } else if (entry.type === 'FILLER') {
        mark('filler');
      }
      index += best.length;
    }
    if (compatibility) {
      const targetText = tokens.slice(compatibility.position).filter((_token, offset) => states[compatibility!.position + offset] !== 'marker'
        && states[compatibility!.position + offset] !== 'filler').join(' ');
      for (let index = compatibility.position; index < tokens.length; index += 1) if (states[index] === 'free') states[index] = 'target';
      push(hard, { kind: 'COMPATIBILITY', domain: 'TECHNICAL', matchedText: compatibility.text, target: targetText || '(unspecified)' });
    }

    // 4. Bare measures.
    const headFamilies = concepts.filter((hit) => hit.entry.axis === 'PRODUCT_FAMILY' && !hit.target && !hit.soft).map((hit) => hit.entry.code);
    const loadFamily = headFamilies.some((code) => LOAD_FAMILIES_FOR_WEIGHT_SPEC.has(code));
    const kgMeasures = tokens.map((token, index) => ({ token, index })).filter(({ token, index }) => states[index] === 'free' && /^\d+(?:\.\d+)?kg$/u.test(token));
    for (const { token, index } of tokens.map((token, index) => ({ token, index }))) {
      if (states[index] !== 'free' || !MEASURE_TOKEN.test(token)) continue;
      states[index] = 'measure';
      const unit = MEASURE_TOKEN.exec(token)![2];
      if (unit === 'kg' && loadFamily && kgMeasures.length === 1) {
        const before = tokens.slice(Math.max(0, index - 2), index).join(' ');
        const operator = /hasta|maximo|max|menos de/u.test(before) ? 'LTE' : /mas de|minimo|al menos/u.test(before) ? 'GTE' : 'EQ';
        push(hard, { kind: 'SPEC', domain: 'TECHNICAL', specKey: 'weight_kg', operator, value: Number(MEASURE_TOKEN.exec(token)![1]), unit: 'kg', matchedText: token });
        entries.push({ position: index, entry: { text: token, state: 'CONSTRAINT', axis: 'SPEC', code: 'weight_kg', note: 'bare measure + load family' } });
      } else {
        const note = unit === 'lb' ? 'LB_MEASURE_NOT_CONVERTED_V0'
          : unit === 'kg' ? (kgMeasures.length > 1 ? 'MULTIPLE_WEIGHT_MEASURES' : 'WEIGHT_WITHOUT_LOAD_FAMILY')
            : 'DIMENSION_WITHOUT_AXIS_OR_OPERATOR';
        entries.push({ position: index, entry: { text: token, state: 'UNKNOWN', axis: 'SPEC', note } });
      }
    }

    // 5. Governed lexical synonyms (non-consuming).
    const synonymExpansions: QueryInterpretation['synonymExpansions'] = [];
    for (let index = 0; index < tokens.length;) {
      if (states[index] === 'target' || states[index] === 'constraint' || states[index] === 'id') { index += 1; continue; }
      const best = longestMatchAt(stems, states, index, this.synonyms, false);
      if (!best) { index += 1; continue; }
      const entry = best.compiled.entry as SynonymLexiconEntry;
      synonymExpansions.push({ phrase: tokens.slice(index, index + best.length), replacement: [...new Set(entry.replacements.flatMap((term) => discoverTokens(term)))], lexiconEntryId: entry.id });
      entries.push({ position: index, entry: { text: tokens.slice(index, index + best.length).join(' '), state: 'RECOGNIZED', axis: 'LEXICAL_SYNONYM', code: entry.replacements.join(' | '), lexiconEntryId: entry.id } });
      index += best.length;
    }

    // 6. Concepts → constraints. Disciplines and use contexts are contractual tags: preferences only.
    const byAxis = new Map<string, { codes: string[]; texts: string[]; soft: boolean; hits: ConceptHit[] }>();
    for (const hit of concepts.filter((item) => !item.target && !item.component)) {
      const isSoftAxis = hit.entry.axis === 'DISCIPLINE' || hit.entry.axis === 'USE_CONTEXT';
      const groupSoft = hit.soft || isSoftAxis;
      if (hit.entry.axis === 'PRODUCT_FAMILY') {
        const key = `PRODUCT_FAMILY|${groupSoft}`;
        const group = byAxis.get(key) ?? { codes: [], texts: [], soft: groupSoft, hits: [] };
        if (!group.codes.includes(hit.entry.code)) group.codes.push(hit.entry.code);
        group.texts.push(hit.text);
        group.hits.push(hit);
        byAxis.set(key, group);
      } else {
        byAxis.set(`${hit.entry.axis}|${hit.entry.code}|${groupSoft}`, { codes: [hit.entry.code], texts: [hit.text], soft: groupSoft, hits: [hit] });
      }
    }
    for (const [key, group] of byAxis) {
      const axis = key.split('|')[0] as ConceptAxis;
      const kind = axis === 'PRODUCT_FAMILY' ? 'PRODUCT_TYPE' : axis === 'EXERCISE_CAPABILITY' ? 'EXERCISE' : axis === 'TRAINING_FUNCTION' ? 'TRAINING_FUNCTION'
        : axis === 'DISCIPLINE' ? 'DISCIPLINE' : axis === 'USE_CONTEXT' ? 'USE_CONTEXT' : 'ANATOMY';
      const subtypeText = axis === 'PRODUCT_FAMILY' ? subtypeAlternatives(group.hits, tokens, synonymExpansions) : null;
      push(group.soft ? soft : hard, { kind, domain: 'TECHNICAL', axis, codes: group.codes, matchedText: group.texts.join(' / '), ...(subtypeText ? { subtypeText } : {}) });
    }

    for (const [index, state] of states.entries()) {
      if (state === 'free') entries.push({ position: index, entry: { text: tokens[index]!, state: 'UNKNOWN', note: 'UNRECOGNIZED_TERM_KEPT_AS_TEXT' } });
    }
    const lexicalTokens = [...new Set(tokens.filter((_token, index) => ['free', 'concept', 'unmodeled', 'measure'].includes(states[index]!)))];
    const unrecognizedTerms = [...new Set(tokens.filter((_token, index) => states[index] === 'free' || states[index] === 'unmodeled'))];
    const recognizedConcepts = [...new Set(concepts.filter((hit) => !hit.target).map((hit) => `${hit.entry.axis}:${hit.entry.code}`))];
    // Free text with no recognized structure: eligibility needs every term in the name (nominal strictness);
    // partial text matches stay retrievable but unverified (weak-match penalty).
    if (hard.length === 0 && soft.length === 0 && recognizedConcepts.length === 0 && productKeyLookups.length === 0 && lexicalTokens.length > 0) {
      push(hard, { kind: 'NOMINAL_TEXT', domain: 'TECHNICAL', matchedText: query.trim() });
    }
    return {
      normalizedQuery: joined,
      recognizedConcepts,
      unrecognizedTerms,
      hardConstraints: hard,
      softPreferences: soft,
      entries: entries.sort((left, right) => left.position - right.position).map((item) => item.entry),
      lexicalTokens,
      synonymExpansions,
      productKeyLookups,
      lexiconVersion: DISCOVER_V0_LEXICON_VERSION,
    };
  }
}

const SYNONYM_ENTRIES = new Map(DISCOVER_V0_LEXICON.filter((entry): entry is SynonymLexiconEntry => entry.type === 'LEXICAL_SYNONYM').map((entry) => [entry.id, entry]));
const SUBTYPE_STOPWORDS = new Set(['para', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'o', 'un', 'una']);

/** Subtype text alternatives, or null when any hit names the family as a whole. */
function subtypeAlternatives(hits: readonly ConceptHit[], tokens: readonly string[], expansions: QueryInterpretation['synonymExpansions']): string[][] | null {
  const alternatives: string[][] = [];
  for (const hit of hits) {
    const normalized = discoverTokens(hit.text).join(' ');
    if ((hit.entry.familyLevelTerms ?? []).some((term) => discoverTokens(term).join(' ') === normalized)) return null;
    alternatives.push(discoverTokens(hit.text).filter((token) => !SUBTYPE_STOPWORDS.has(token)).map(stemToken));
    const span = tokens.slice(hit.position, hit.position + discoverTokens(hit.text).length);
    for (const expansion of expansions) {
      if (!expansion.phrase.some((token) => span.includes(token))) continue;
      const entry = SYNONYM_ENTRIES.get(expansion.lexiconEntryId);
      for (const replacement of entry?.replacements ?? []) alternatives.push(discoverTokens(replacement).filter((token) => !SUBTYPE_STOPWORDS.has(token)).map(stemToken));
    }
  }
  return alternatives.filter((alternative) => alternative.length > 0);
}

/** Exact single-product lookups demote every hard constraint to a preference (exact matches dominate). */
export function demoteForNominalLookup(interpretation: QueryInterpretation): QueryInterpretation {
  if (interpretation.hardConstraints.length === 0) return interpretation;
  return {
    ...interpretation,
    hardConstraints: [],
    softPreferences: [...interpretation.softPreferences, ...interpretation.hardConstraints.map((constraint) => ({ ...constraint, demotedFrom: 'HARD' as const }))],
  };
}
