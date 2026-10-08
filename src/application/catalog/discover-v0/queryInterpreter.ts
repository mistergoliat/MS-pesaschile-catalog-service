import type {
  AmbiguityGroup,
  ConceptAxis,
  DiscoverConstraint,
  InterpretationEntry,
  InterpretationSpan,
  QuantityScope,
  QueryInterpretation,
  RelevanceRequirement,
  SemanticRole,
  SpanReading,
  SpecKeyV0,
} from './contracts.js';
import {
  DISCOVER_V0_LEXICON,
  DISCOVER_V0_LEXICON_VERSION,
  DISCOVER_V0_TERM_READINGS,
  LOAD_FAMILIES_FOR_WEIGHT_SPEC,
  PURPOSE_HEAD_FAMILIES,
  type AmbiguousLexiconEntry,
  type ConceptLexiconEntry,
  type LexiconEntry,
  type MarkerLexiconEntry,
  type SynonymLexiconEntry,
} from './lexicon.js';
import { discoverTokens, MEASURE_TOKEN, stemToken } from './text.js';

/*
 * DiscoverQueryInterpreter V0.2 — deterministic, bounded interpretation.
 *
 * 1. Typed constraint patterns (price, user weight, load, dimensions) over the
 *    folded token string; their tokens are consumed.
 * 2. Longest-match lexicon pass over the remaining tokens: concepts, materially
 *    AMBIGUOUS phrases, unmodeled terms, compatibility / soft / commercial markers
 *    and fillers.
 * 3. A bare weight measure becomes weight_kg only when a load family was named;
 *    its physical scope (per unit / pack total) is derived from the query wording.
 * 4. Governed lexical synonyms are a separate, non-consuming pass.
 * 5. Every meaningful span is recorded with its readings (role, concepts,
 *    evidence, derived constraints, unresolved reasons). A materially ambiguous
 *    span yields an AmbiguityGroup whose readings are ALTERNATIVES, never
 *    simultaneous hard constraints.
 * 6. "<family> para <family>" is a use purpose when the head serves objects
 *    (PURPOSE_HEAD_FAMILIES, e.g. storage for plates) and a physical
 *    compatibility otherwise. "para <modeled exercise>" is an exercise capability;
 *    "para <unmodeled exercise>" is a non-gating purpose preference.
 *
 * Anything else stays UNKNOWN and is kept as retrieval text.
 */

type TokenState = 'free' | 'filler' | 'constraint' | 'concept' | 'unmodeled' | 'marker' | 'target' | 'id' | 'measure';
type Compiled = { entry: LexiconEntry; termStems: string[][]; terms: string[] };
type ConceptHit = { entry: ConceptLexiconEntry; text: string; term: string; soft: boolean; target: boolean; component: boolean; position: number; length: number };
type AmbiguousHit = { entry: AmbiguousLexiconEntry; text: string; position: number; length: number; soft: boolean };

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
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: 'max_user_weight_kg', operator: 'GTE', value: Number(match[1]), unit: 'kg', quantityScope: 'USER_CAPACITY', quantityScopeRule: 'USER_WEIGHT_PATTERN' }),
  },
  {
    id: 'user-weight-suffix',
    regex: new RegExp(String.raw`\b${NUMBER}kg\s+de\s+(?:peso\s+de\s+)?(?:usuario|persona)\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: 'max_user_weight_kg', operator: 'GTE', value: Number(match[1]), unit: 'kg', quantityScope: 'USER_CAPACITY', quantityScopeRule: 'USER_WEIGHT_PATTERN' }),
  },
  {
    id: 'load',
    regex: new RegExp(String.raw`\b(?:soporta|soportar|soporte|aguante|aguanta|resista|resiste|carga maxima|capacidad de carga|capacidad|carga)\s+(?:de\s+|hasta\s+|maxima de\s+|al menos\s+|minima de\s+)*${NUMBER}kg\b`, 'gu'),
    build: (match) => ({ kind: 'SPEC', domain: 'TECHNICAL', specKey: 'max_load_kg', operator: 'GTE', value: Number(match[1]), unit: 'kg', quantityScope: 'PRODUCT_TOTAL', quantityScopeRule: 'LOAD_PATTERN_PRODUCT_CAPACITY' }),
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
  terms: entry.terms,
  termStems: entry.terms.map((term) => discoverTokens(term).map(stemToken)),
}));

function longestMatchAt(stems: readonly string[], states: readonly TokenState[], start: number, entries: readonly Compiled[], requireFree: boolean) {
  let best: { compiled: Compiled; length: number; term: string } | null = null;
  for (const compiled of entries) {
    compiled.termStems.forEach((term, termIndex) => {
      if (term.length === 0 || start + term.length > stems.length) return;
      if (best && term.length <= best.length) return;
      for (let offset = 0; offset < term.length; offset += 1) {
        if (stems[start + offset] !== term[offset] || (requireFree && states[start + offset] !== 'free')) return;
      }
      best = { compiled, length: term.length, term: compiled.terms[termIndex]! };
    });
  }
  return best as { compiled: Compiled; length: number; term: string } | null;
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

const SUBTYPE_STOPWORDS = new Set(['para', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'o', 'un', 'una']);
const contentStems = (text: string) => discoverTokens(text).filter((token) => !SUBTYPE_STOPWORDS.has(token)).map(stemToken);

function conceptRole(entry: ConceptLexiconEntry, subtype: boolean): SemanticRole {
  if (entry.axis === 'PRODUCT_FAMILY') return subtype ? 'PRODUCT_IDENTITY' : 'PRODUCT_ROLE';
  if (entry.axis === 'EXERCISE_CAPABILITY') return 'EXERCISE_CAPABILITY';
  if (entry.axis === 'TRAINING_FUNCTION') return 'TRAINING_FUNCTION';
  return 'USE_PURPOSE';
}

function familyTermAlternatives(code: string): string[][] {
  const out: string[][] = [];
  for (const entry of DISCOVER_V0_LEXICON) {
    if (entry.type !== 'CONCEPT' || entry.axis !== 'PRODUCT_FAMILY' || entry.code !== code) continue;
    for (const term of entry.terms) {
      const stems = contentStems(term);
      if (stems.length > 0 && !out.some((existing) => existing.join(' ') === stems.join(' '))) out.push(stems);
    }
  }
  return out;
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
    const requirements: RelevanceRequirement[] = [];
    const spans: (InterpretationSpan & { position: number })[] = [];
    const groups: AmbiguityGroup[] = [];
    const productKeyLookups: string[] = [];
    const joined = tokens.join(' ');
    const offsets = tokenOffsets(tokens);
    const push = (target: DiscoverConstraint[], constraint: Omit<DiscoverConstraint, 'id'>): DiscoverConstraint => {
      const built = { ...constraint, id: `${constraint.kind}#${hard.length + soft.length + 1}` } as DiscoverConstraint;
      target.push(built);
      return built;
    };
    const addRequirement = (requirement: Omit<RelevanceRequirement, 'id'>): RelevanceRequirement => {
      const built = { ...requirement, id: `REQ#${requirements.length + 1}` };
      requirements.push(built);
      return built;
    };
    const span = (position: number, length: number, readings: SpanReading[], extra: Partial<InterpretationSpan> = {}): InterpretationSpan & { position: number } => {
      const plausible = readings.filter((reading) => reading.status === 'PLAUSIBLE_UNRESOLVED');
      const built = {
        spanId: `S${spans.length + 1}`, text: tokens.slice(position, position + length).join(' '), tokenStart: position, tokenEnd: position + length,
        readings, ambiguity: plausible.length > 1 ? 'MATERIAL' as const : 'NONE' as const, resolution: plausible.length > 1 ? 'UNRESOLVED' as const : 'RESOLVED' as const,
        unresolvedReasons: plausible.length > 1 ? [`${plausible.map((reading) => reading.role).join('_VS_')}`] : [], position, ...extra,
      };
      spans.push(built);
      return built;
    };
    const reading = (readingId: string, role: SemanticRole, status: SpanReading['status'], concepts: string[], evidence: string[], extra: Partial<SpanReading> = {}): SpanReading => ({
      readingId, role, status, concepts, evidence, derivedConstraintIds: [], derivedRequirementIds: [], ...extra,
    });

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
        const constraint = push(hard, { ...built, matchedText: match[0], role: built.kind === 'SPEC' ? 'SPECIFICATION' : 'COMMERCIAL_CONSTRAINT' });
        entries.push({ position: covered[0]!, entry: { text: match[0], state: 'CONSTRAINT', axis: built.kind === 'SPEC' ? 'SPEC' : 'COMMERCIAL', code: built.specKey ?? built.kind, note: `pattern:${rule.id}` } });
        span(covered[0]!, covered.length, [reading('A', constraint.role!, 'SELECTED', [built.specKey ? `SPEC:${built.specKey}` : built.kind], [`PATTERN:${rule.id}`],
          { derivedConstraintIds: [constraint.id] })]);
      }
    }

    // 2. Exact product keys.
    tokens.forEach((token, index) => {
      if (states[index] === 'free' && /^p[1-9]\d{0,6}$/u.test(token)) {
        states[index] = 'id';
        productKeyLookups.push(`P${token.slice(1)}`);
        entries.push({ position: index, entry: { text: token, state: 'RECOGNIZED', axis: 'EXACT_ID', code: `P${token.slice(1)}` } });
        span(index, 1, [reading('A', 'PRODUCT_IDENTITY', 'SELECTED', [`PRODUCT_KEY:P${token.slice(1)}`], ['PATTERN:product-key'])]);
      }
    });

    // 3. Longest-match lexicon pass.
    const concepts: ConceptHit[] = [];
    const ambiguous: AmbiguousHit[] = [];
    const purposeTargets: { hit: ConceptHit; head: ConceptHit }[] = [];
    const unmodeledPurposes: { text: string; position: number; length: number; entry: MarkerLexiconEntry }[] = [];
    let softMode = false;
    let compatibility: { position: number; text: string } | null = null;
    for (let index = 0; index < tokens.length;) {
      if (states[index] !== 'free') { index += 1; continue; }
      const best = longestMatchAt(stems, states, index, this.conceptAndMarkers, true);
      if (!best) { index += 1; continue; }
      const text = tokens.slice(index, index + best.length).join(' ');
      const entry = best.compiled.entry;
      const mark = (state: TokenState) => { for (let offset = 0; offset < best.length; offset += 1) states[index + offset] = state; };
      const previous = index > 0 ? tokens[index - 1] : undefined;
      if (entry.type === 'CONCEPT') {
        const head = entry.axis === 'PRODUCT_FAMILY' && previous === 'para'
          ? concepts.find((hit) => hit.entry.axis === 'PRODUCT_FAMILY' && !hit.target) : undefined;
        const purposeTarget = head !== undefined;
        const usePurpose = purposeTarget && PURPOSE_HEAD_FAMILIES.has(head!.entry.code) && compatibility === null;
        // "<family> con <family>": the second family is a bundle component (pack composition is not modeled).
        const component = entry.axis === 'PRODUCT_FAMILY' && previous === 'con' && !purposeTarget && compatibility === null
          && concepts.some((hit) => hit.entry.axis === 'PRODUCT_FAMILY' && !hit.target && !hit.component);
        const target = compatibility !== null || purposeTarget;
        mark(target ? 'target' : 'concept');
        const hit: ConceptHit = { entry, text, term: best.term, soft: softMode, target, component, position: index, length: best.length };
        concepts.push(hit);
        if (component) {
          const constraint = push(hard, { kind: 'BUNDLE_COMPONENT', domain: 'TECHNICAL', matchedText: `con ${text}`, target: entry.code, role: 'RELATIONSHIP',
            subtypeText: [contentStems(text)] });
          const gate = addRequirement({ role: 'RELATIONSHIP', text: `con ${text}`, alternatives: [contentStems(text)], gating: true, constraintId: constraint.id,
            note: 'pack composition is not modeled: the product text must name the component (relevance gate, never certified)' });
          span(index, best.length, [reading('A', 'RELATIONSHIP', 'SELECTED', [`BUNDLE_COMPONENT:${entry.code}`], ['RULE:<family> con <family>'],
            { derivedConstraintIds: [constraint.id], derivedRequirementIds: [gate.id] })]);
        }
        entries.push({ position: index, entry: { text, state: 'RECOGNIZED', axis: usePurpose ? 'USE_PURPOSE' : entry.axis, code: entry.code, lexiconEntryId: entry.id,
          ...(target ? { note: compatibility ? 'COMPATIBILITY_TARGET' : usePurpose ? 'PURPOSE_TARGET_TEXT_REQUIREMENT' : 'PURPOSE_TARGET_COMPATIBILITY_NOT_VERIFIABLE' } : {}) } });
        if (usePurpose) {
          purposeTargets.push({ hit, head: head! });
        } else if (purposeTarget && compatibility === null) {
          const constraint = push(hard, { kind: 'COMPATIBILITY', domain: 'TECHNICAL', matchedText: `para ${text}`, target: entry.code, role: 'RELATIONSHIP' });
          span(index - 1, best.length + 1, [
            reading('A', 'RELATIONSHIP', 'SELECTED', [`COMPATIBILITY:${head!.entry.code}->${entry.code}`], ['RULE:<family> para <family> (physical fit)'], { derivedConstraintIds: [constraint.id] }),
            reading('B', 'USE_PURPOSE', 'CONSIDERED_REJECTED', [`USE_PURPOSE:${entry.code}`], [], { reason: `${head!.entry.code} is not a purpose-head family (PURPOSE_HEAD_FAMILIES)` }),
          ]);
        }
      } else if (entry.type === 'AMBIGUOUS') {
        mark('concept');
        ambiguous.push({ entry, text, position: index, length: best.length, soft: softMode });
        entries.push({ position: index, entry: { text, state: 'RECOGNIZED', axis: 'AMBIGUOUS', code: entry.readings.map((item) => `${item.axis}:${item.code}`).join(' | '), lexiconEntryId: entry.id, note: 'MATERIAL_AMBIGUITY' } });
      } else if (entry.type === 'UNMODELED') {
        mark('unmodeled');
        entries.push({ position: index, entry: { text, state: 'UNKNOWN', axis: 'UNMODELED', lexiconEntryId: entry.id, note: entry.note } });
        const blocking = (entry as MarkerLexiconEntry).blocking;
        if (blocking) push(hard, { kind: blocking, domain: 'TECHNICAL', matchedText: text, target: entry.id });
        else if (previous === 'para' && entry.id === 'unm.squat') unmodeledPurposes.push({ text, position: index, length: best.length, entry: entry as MarkerLexiconEntry });
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
        const constraint = push(soft, { kind: 'COMMERCIAL_LOW_PRICE', domain: 'COMMERCIAL', matchedText: text, role: 'COMMERCIAL_CONSTRAINT' });
        entries.push({ position: index, entry: { text, state: 'CONSTRAINT', axis: 'COMMERCIAL', code: 'COMMERCIAL_LOW_PRICE', lexiconEntryId: entry.id } });
        span(index, best.length, [reading('A', 'COMMERCIAL_CONSTRAINT', 'SELECTED', ['COMMERCIAL_LOW_PRICE'], [`LEXICON:${entry.id}`], { derivedConstraintIds: [constraint.id] })]);
      } else if (entry.type === 'COMMERCIAL_AVAILABILITY') {
        mark('marker');
        const constraint = push(hard, { kind: 'COMMERCIAL_AVAILABILITY', domain: 'COMMERCIAL', matchedText: text, role: 'COMMERCIAL_CONSTRAINT' });
        entries.push({ position: index, entry: { text, state: 'CONSTRAINT', axis: 'COMMERCIAL', code: 'COMMERCIAL_AVAILABILITY', lexiconEntryId: entry.id } });
        span(index, best.length, [reading('A', 'COMMERCIAL_CONSTRAINT', 'SELECTED', ['COMMERCIAL_AVAILABILITY'], [`LEXICON:${entry.id}`], { derivedConstraintIds: [constraint.id] })]);
      } else if (entry.type === 'FILLER') {
        mark('filler');
      }
      index += best.length;
    }
    if (compatibility) {
      const targetText = tokens.slice(compatibility.position).filter((_token, offset) => states[compatibility!.position + offset] !== 'marker'
        && states[compatibility!.position + offset] !== 'filler').join(' ');
      for (let index = compatibility.position; index < tokens.length; index += 1) if (states[index] === 'free') states[index] = 'target';
      const constraint = push(hard, { kind: 'COMPATIBILITY', domain: 'TECHNICAL', matchedText: compatibility.text, target: targetText || '(unspecified)', role: 'RELATIONSHIP' });
      span(compatibility.position, tokens.length - compatibility.position, [reading('A', 'RELATIONSHIP', 'SELECTED', [`COMPATIBILITY:${targetText || '(unspecified)'}`],
        ['LEXICON:compat'], { derivedConstraintIds: [constraint.id] })]);
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
        const scope = queryWeightScope(tokens, concepts);
        const constraint = push(hard, { kind: 'SPEC', domain: 'TECHNICAL', specKey: 'weight_kg', operator, value: Number(MEASURE_TOKEN.exec(token)![1]), unit: 'kg', matchedText: token,
          quantityScope: scope.scope, quantityScopeRule: scope.rule, role: 'SPECIFICATION' });
        entries.push({ position: index, entry: { text: token, state: 'CONSTRAINT', axis: 'SPEC', code: 'weight_kg', note: `bare measure + load family; scope ${scope.scope} (${scope.rule})` } });
        span(index, 1, [
          reading('A', 'SPECIFICATION', 'SELECTED', [`SPEC:weight_kg:${scope.scope}`], [`RULE:${scope.rule}`], { derivedConstraintIds: [constraint.id] }),
          ...scope.alternatives.map((alternative, offset) => reading(String.fromCharCode(66 + offset), 'SPECIFICATION', 'CONSIDERED_REJECTED', [`SPEC:weight_kg:${alternative.scope}`], [], { reason: alternative.reason })),
        ]);
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
      const kind = axisKind(axis);
      const subtypeText = axis === 'PRODUCT_FAMILY' ? subtypeAlternatives(group.hits, tokens, synonymExpansions) : null;
      const role = conceptRole(group.hits[0]!.entry, subtypeText !== null);
      const constraint = push(group.soft ? soft : hard, { kind, domain: 'TECHNICAL', axis, codes: group.codes, matchedText: group.texts.join(' / '), role, ...(subtypeText ? { subtypeText } : {}) });
      const gate = subtypeText && !group.soft
        ? addRequirement({ role: 'PRODUCT_IDENTITY', text: group.texts.join(' / '), alternatives: subtypeText, gating: true, constraintId: constraint.id,
          note: 'named subtype the ontology does not model: the product text must mention it (relevance gate, never certified)' })
        : null;
      for (const hit of group.hits) {
        const notes = DISCOVER_V0_TERM_READINGS[hit.term] ?? [];
        const derivedRequirementIds: string[] = gate ? [gate.id] : [];
        const readings = [reading('A', role, 'SELECTED', [`${axis}:${hit.entry.code}`], [`LEXICON:${hit.entry.id}`, ...provenanceEvidence(hit.entry)],
          { derivedConstraintIds: [constraint.id], derivedRequirementIds })];
        notes.forEach((note, offset) => {
          const id = String.fromCharCode(66 + offset);
          if (note.status === 'RELEVANCE_ONLY' && !group.soft) {
            const preference = addRequirement({ role: note.role, text: hit.text, alternatives: [contentStems(hit.term)], gating: false, note: note.reason });
            readings.push(reading(id, note.role, 'RELEVANCE_ONLY', [`TEXT:${hit.term}`], [`TERM_NOTE:${hit.term}`], { derivedRequirementIds: [preference.id], reason: note.reason }));
          } else {
            readings.push(reading(id, note.role, 'CONSIDERED_REJECTED', note.concept ? [note.concept] : [], [`TERM_NOTE:${hit.term}`], { reason: note.reason }));
          }
        });
        span(hit.position, hit.length, readings, { lexiconEntryId: hit.entry.id });
      }
    }

    // 7. Materially ambiguous spans → alternative readings (an AmbiguityGroup), never a conjunction.
    for (const hit of ambiguous) {
      const groupId = `G${groups.length + 1}`;
      const group: AmbiguityGroup = { groupId, spanId: '', text: hit.text, readings: [] };
      const readings: SpanReading[] = [];
      for (const spec of hit.entry.readings) {
        const constraint = push(hit.soft ? soft : hard, { kind: axisKind(spec.axis), domain: 'TECHNICAL', axis: spec.axis, codes: [spec.code], matchedText: hit.text,
          role: spec.role, groupId, readingId: spec.readingId, ...(spec.gateTerms ? { subtypeText: spec.gateTerms.map(contentStems) } : {}) });
        const gate = spec.gateTerms && !hit.soft
          ? addRequirement({ role: spec.role, text: hit.text, alternatives: spec.gateTerms.map(contentStems), gating: true, constraintId: constraint.id, groupId, readingId: spec.readingId,
            note: `reading ${spec.readingId} applies only to products whose own text names it (relevance gate)` })
          : null;
        group.readings.push({ readingId: spec.readingId, role: spec.role, label: spec.label, constraintIds: [constraint.id], requirementIds: gate ? [gate.id] : [] });
        readings.push(reading(spec.readingId, spec.role, 'PLAUSIBLE_UNRESOLVED', [`${spec.axis}:${spec.code}`], [`LEXICON:${hit.entry.id}`, `${spec.provenance.source}`],
          { derivedConstraintIds: [constraint.id], derivedRequirementIds: gate ? [gate.id] : [] }));
      }
      const built = span(hit.position, hit.length, readings, { lexiconEntryId: hit.entry.id });
      built.unresolvedReasons = [`${hit.entry.readings.map((item) => item.role).join('_VS_')}: no governed signal in the query selects one reading`];
      group.spanId = built.spanId;
      if (!hit.soft) groups.push(group);
    }

    // 8. Use-purpose targets of purpose-head families ("almacenamiento para discos").
    for (const { hit, head } of purposeTargets) {
      const requirement = addRequirement({ role: 'USE_PURPOSE', text: `para ${hit.text}`, alternatives: familyTermAlternatives(hit.entry.code), field: 'NAME', gating: true,
        note: `${head.entry.code} serves ${hit.entry.code}: the product NAME must name the served object; the purpose is never certified` });
      span(hit.position - 1, hit.length + 1, [
        reading('A', 'USE_PURPOSE', 'SELECTED', [`USE_PURPOSE:${head.entry.code}->${hit.entry.code}`], ['RULE:PURPOSE_HEAD_FAMILIES', `LEXICON:${hit.entry.id}`], { derivedRequirementIds: [requirement.id] }),
        reading('B', 'RELATIONSHIP', 'CONSIDERED_REJECTED', [`COMPATIBILITY:${head.entry.code}->${hit.entry.code}`], [], { reason: 'a storage product serves the target; it does not physically fit it' }),
      ]);
    }
    for (const purpose of unmodeledPurposes) {
      const alternatives = [contentStems(purpose.text), ...synonymExpansions.filter((expansion) => expansion.phrase.includes(tokens[purpose.position]!))
        .flatMap((expansion) => expansion.replacement.map((replacement) => [stemToken(replacement)]))];
      const requirement = addRequirement({ role: 'USE_PURPOSE', text: `para ${purpose.text}`, alternatives, gating: false, note: `${purpose.entry.note} Purpose kept as a non-gating text preference.` });
      span(purpose.position - 1, purpose.length + 1, [reading('A', 'USE_PURPOSE', 'RELEVANCE_ONLY', [`EXERCISE:${purpose.text}(unmodeled)`], [`LEXICON:${purpose.entry.id}`],
        { derivedRequirementIds: [requirement.id], reason: 'exercise not modeled in Training V2: cannot be certified' })]);
    }

    for (const [index, state] of states.entries()) {
      if (state === 'free') entries.push({ position: index, entry: { text: tokens[index]!, state: 'UNKNOWN', note: 'UNRECOGNIZED_TERM_KEPT_AS_TEXT' } });
    }
    const lexicalTokens = [...new Set(tokens.filter((_token, index) => ['free', 'concept', 'unmodeled', 'measure'].includes(states[index]!)
      || (states[index] === 'target' && purposeTargets.some(({ hit }) => index >= hit.position && index < hit.position + hit.length))))];
    const unrecognizedTerms = [...new Set(tokens.filter((_token, index) => states[index] === 'free' || states[index] === 'unmodeled'))];
    const recognizedConcepts = [...new Set([...concepts.filter((hit) => !hit.target).map((hit) => `${hit.entry.axis}:${hit.entry.code}`),
      ...ambiguous.flatMap((hit) => hit.entry.readings.map((item) => `${item.axis}:${item.code}`))])];
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
      relevanceRequirements: requirements,
      spans: spans.sort((left, right) => left.position - right.position || left.spanId.localeCompare(right.spanId)).map(({ position: _position, ...item }) => item),
      ambiguityGroups: groups,
      entries: entries.sort((left, right) => left.position - right.position).map((item) => item.entry),
      lexicalTokens,
      synonymExpansions,
      productKeyLookups,
      lexiconVersion: DISCOVER_V0_LEXICON_VERSION,
    };
  }
}

function axisKind(axis: ConceptAxis): DiscoverConstraint['kind'] {
  return axis === 'PRODUCT_FAMILY' ? 'PRODUCT_TYPE' : axis === 'EXERCISE_CAPABILITY' ? 'EXERCISE' : axis === 'TRAINING_FUNCTION' ? 'TRAINING_FUNCTION'
    : axis === 'DISCIPLINE' ? 'DISCIPLINE' : axis === 'USE_CONTEXT' ? 'USE_CONTEXT' : 'ANATOMY';
}

function provenanceEvidence(entry: ConceptLexiconEntry): string[] {
  const provenance = entry.provenance;
  return [provenance.source === 'CLASSIFIER_NAME_VOCABULARY' ? `CLASSIFIER_RULE:${provenance.ruleId}` : provenance.source];
}

/**
 * Physical scope of a weight the query asks for. Load equipment is asked per unit
 * unless the query says total/pack; "par de X de N kg" follows the catalog's own
 * naming convention ("Par Discos 10kg" = 10 kg each), recorded as such.
 */
function queryWeightScope(tokens: readonly string[], concepts: readonly ConceptHit[]): { scope: QuantityScope; rule: string; alternatives: { scope: QuantityScope; reason: string }[] } {
  if (tokens.includes('total')) return { scope: 'PACK_TOTAL', rule: 'QUERY_SAYS_TOTAL', alternatives: [] };
  const head = concepts.find((hit) => hit.entry.axis === 'PRODUCT_FAMILY' && !hit.target);
  const before = head ? tokens.slice(Math.max(0, head.position - 2), head.position) : [];
  if (before.some((token) => token === 'pack' || token === 'set' || token === 'kit')) {
    return { scope: 'PACK_TOTAL', rule: 'QUERY_NAMES_PACK', alternatives: [{ scope: 'PER_UNIT', reason: 'the weight follows a pack/set noun: read as the pack total' }] };
  }
  if (tokens.includes('cada') || tokens.includes('c/u')) return { scope: 'PER_UNIT', rule: 'QUERY_SAYS_EACH', alternatives: [] };
  if (before.includes('par')) {
    return { scope: 'PER_UNIT', rule: 'PAIR_NAMING_CONVENTION', alternatives: [{ scope: 'PER_PAIR', reason: 'the catalog names pairs by unit weight ("Par Discos 10kg" = 10 kg cada disco)' }] };
  }
  return { scope: 'PER_UNIT', rule: 'LOAD_ITEM_DEFAULT', alternatives: [] };
}

const SYNONYM_ENTRIES = new Map(DISCOVER_V0_LEXICON.filter((entry): entry is SynonymLexiconEntry => entry.type === 'LEXICAL_SYNONYM').map((entry) => [entry.id, entry]));

/** Subtype text alternatives, or null when any hit names the family as a whole. */
function subtypeAlternatives(hits: readonly ConceptHit[], tokens: readonly string[], expansions: QueryInterpretation['synonymExpansions']): string[][] | null {
  const alternatives: string[][] = [];
  for (const hit of hits) {
    const normalized = discoverTokens(hit.text).join(' ');
    if ((hit.entry.familyLevelTerms ?? []).some((term) => discoverTokens(term).join(' ') === normalized)) return null;
    alternatives.push(contentStems(hit.text));
    const span = tokens.slice(hit.position, hit.position + discoverTokens(hit.text).length);
    for (const expansion of expansions) {
      if (!expansion.phrase.some((token) => span.includes(token))) continue;
      const entry = SYNONYM_ENTRIES.get(expansion.lexiconEntryId);
      for (const replacement of entry?.replacements ?? []) alternatives.push(contentStems(replacement));
    }
  }
  return alternatives.filter((alternative) => alternative.length > 0);
}
