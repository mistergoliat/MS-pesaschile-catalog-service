import type { DiscoverConstraint, QuantityScope, SpecKeyV0, SpecQuantity } from './contracts.js';
import type { DocumentSpec, ProductRetrievalDocument } from './retrievalDocument.js';
import { discoverTokens, normalizedText } from './text.js';

/*
 * QUANTITY_SCOPE_V0.2 — experimental DERIVED adapter over published Specs records.
 *
 * Specs snapshots are never modified. Each parsed value is read together with its
 * raw text and the product's own name/family to decide WHAT the number measures:
 * the physical magnitude, the object it applies to, its scope (per unit, per
 * pair, pack total, user capacity, per side, configuration, subcomponent), the
 * component count, approximation and inclusion of the user. A value whose scope
 * cannot be typed stays AMBIGUOUS / UNSUPPORTED; a value contradicted by the
 * product's own name is CONFLICTING. Only INTERPRETED values may certify, and
 * only when their scope is comparable with the scope the query asks about.
 *
 * Rules are listed in QUANTITY_RULES and are product-agnostic (no productId).
 */

export const QUANTITY_SCOPE_VERSION = 'quantity-scope-v0.2';
const POUND_KG = 0.45359237;

/** Component nouns used in qualifiers ("cada disco") and the family they denote. */
const COMPONENT_FAMILIES: Record<string, string[]> = {
  disco: ['WEIGHT_PLATE'], discos: ['WEIGHT_PLATE'],
  mancuerna: ['DUMBBELL'], mancuernas: ['DUMBBELL'],
  kettlebell: ['KETTLEBELL'], pesa: ['KETTLEBELL', 'DUMBBELL'],
  palmeta: ['FLOORING'], palmetas: ['FLOORING'],
  bicicleta: ['CARDIO_MACHINE'],
  banco: ['BENCH'],
  agarre: ['CABLE_MACHINE', 'MACHINE_ATTACHMENT'], manilla: ['CABLE_MACHINE', 'MACHINE_ATTACHMENT'],
  soporte: ['MACHINE_ATTACHMENT', 'WEIGHT_PLATE'],
  barra: ['BARBELL'],
  rack: ['RACK_CAGE'],
  tobillera: [],
};
/** Subcomponent wording in capacity qualifiers → the exercise that subcomponent serves. */
const SUBCOMPONENT_EXERCISES: { pattern: RegExp; exercises: string[]; label: string }[] = [
  { pattern: /barra (?:pull up|de dominadas|dominadas)|pull up/u, exercises: ['PULL_UP'], label: 'barra pull up' },
  { pattern: /soporte (?:de|para) fondos|fondos/u, exercises: ['DIP'], label: 'soporte de fondos' },
  { pattern: /leg\s*\/?\s*curl/u, exercises: ['LEG_CURL', 'LEG_EXTENSION'], label: 'leg curl' },
  { pattern: /polea/u, exercises: [], label: 'polea' },
  { pattern: /maquina abductora|abductor/u, exercises: [], label: 'maquina abductora' },
  { pattern: /barra smith/u, exercises: [], label: 'barra smith' },
];
const CONFIGURATION_WORDS = /\b(posicion|plegado|plegada|acostado|vertical|nivel|regulacion|anclado)\b/u;

export const QUANTITY_RULES: Record<string, string> = {
  SINGLE_UNIT_UNQUALIFIED: 'Unqualified value on a single-unit product: the product itself (per unit = product total).',
  PACK_NAME_TOTAL: 'Unqualified value on a pack/set whose name states the same total: pack total.',
  MULTI_UNIT_UNQUALIFIED: 'Unqualified value on a pair/pack/set product: per-unit vs total cannot be told apart (AMBIGUOUS).',
  EXPLICIT_EACH: '"cada <componente>" / "cada uno": per unit of that component.',
  EXPLICIT_PAIR: '"el par": total of the pair; a per-unit value is derivable as value/2 for identical units.',
  EXPLICIT_TOTAL: '"peso total" / "incluido discos y barras": total of the pack/set.',
  APPROXIMATE: '"aprox." / "≈" / "no calibrada": approximate value; never satisfies an exact (EQ) constraint.',
  INCLUDES_USER: '"incluido (el) peso (del) usuario": total load including the user (product capacity, not user capacity).',
  PER_SIDE: '"por lado": per side; not a product total.',
  SUBCOMPONENT: 'Qualifier names a part of the product ("barra pull up: 150 kg"): applies only when the query asks about that part.',
  QUALIFIER_NAMES_PRODUCT: 'Qualifier names the product family itself ("150 kg. rack"): the product.',
  CONFIGURATION: 'Dimension stated for one configuration (plano/plegado/posición): configuration dependent.',
  DIMENSION_LABELS: 'Dimension labels only (Largo/Ancho/Alto): the assembled product.',
  UNTYPED_QUALIFIER: 'Qualifier without a typed rule: UNSUPPORTED.',
  NAME_MEASURE_DISAGREES: 'The product name states a different weight than the value for the same scope: CONFLICTING.',
  COMPONENT_FAMILY_MISMATCH: 'The qualifier component is not the product family (component of a mixed set).',
};

const quantityCache = new WeakMap<DocumentSpec, SpecQuantity>();

/** Number of physical units the product name declares (null when a pack/set does not say). */
export function componentCountFromName(name: string): number | null {
  const text = normalizedText(name);
  // "N pares" counts units only when it leads the name or follows pack/set/kit; elsewhere it is a
  // capacity ("Rack de Almacenamiento Mancuernas 6 pares" is one rack).
  const pairs = /^(?:(?:pack|set|kit)\s+(?:de\s+)?)?(\d+)\s*pares\b/u.exec(text);
  if (pairs) return Number(pairs[1]) * 2;
  const pack = /\b(?:pack|set|kit)\s+(?:de\s+)?(\d+)\b(?!\s*(?:kg|lb|lbs|cm|mm))/u.exec(text);
  if (pack) return Number(pack[1]);
  const times = /\bx\s?(\d+)\b/u.exec(text);
  if (times) return Number(times[1]);
  if (/\(unidad\)|\bunidad\b/u.test(text)) return 1;
  if (/^par\b|\bpar de\b|\(par\)/u.test(text)) return 2;
  if (/^(?:pack|set|kit)\b/u.test(text)) return null;
  return 1;
}

/** Weights stated in the product name, in kg (pounds converted), when there is exactly one. */
export function nameWeightKg(name: string): number | null {
  const measures = discoverTokens(name).map((token) => /^(\d+(?:\.\d+)?)(kg|lb)$/u.exec(token)).filter((match): match is RegExpExecArray => match !== null);
  const range = /\(\s*[\d.,]+\s*a\s*[\d.,]+\s*kg\s*\)/iu.test(name);
  if (measures.length !== 1 || range) return null;
  const value = Number(measures[0]![1]);
  return measures[0]![2] === 'lb' ? value * POUND_KG : value;
}

const close = (left: number, right: number) => Math.abs(left - right) <= Math.max(0.02 * Math.max(left, right), 0.05);

function magnitudeOf(key: SpecKeyV0): SpecQuantity['magnitude'] {
  return key === 'weight_kg' ? 'MASS' : key === 'max_load_kg' ? 'LOAD_CAPACITY' : key === 'max_user_weight_kg' ? 'USER_CAPACITY' : 'LENGTH';
}

export function interpretSpecQuantity(document: ProductRetrievalDocument, spec: DocumentSpec): SpecQuantity {
  const cached = quantityCache.get(spec);
  if (cached) return cached;
  const typed = interpret(document, spec);
  const result: SpecQuantity = { ...typed, certification: certificationOf(typed, document.productSemantics?.primaryFamily?.code ?? null) };
  quantityCache.set(spec, result);
  return result;
}

/** Whether a typed value may certify on its own (see SpecQuantity.certification). */
function certificationOf(quantity: TypedQuantity, family: string | null): SpecQuantity['certification'] {
  if (quantity.status !== 'INTERPRETED') return 'NOT_CERTIFIABLE';
  if (quantity.scope === 'PER_SIDE' || quantity.scope === 'UNKNOWN') return 'NOT_CERTIFIABLE';
  if (quantity.scope === 'SUBCOMPONENT') return quantity.subcomponentExercises.length > 0 ? 'CONDITIONAL' : 'NOT_CERTIFIABLE';
  if (quantity.scope === 'CONFIGURATION_DEPENDENT' || quantity.approximate || quantity.rule === 'COMPONENT_FAMILY_MISMATCH') return 'CONDITIONAL';
  if (quantity.scope === 'PER_UNIT' && quantity.appliesTo !== 'unit' && ((COMPONENT_FAMILIES[quantity.appliesTo] ?? []).length === 0 || family === null)) return 'CONDITIONAL';
  return 'CERTIFIABLE';
}

type TypedQuantity = Omit<SpecQuantity, 'certification'>;

function interpret(document: ProductRetrievalDocument, spec: DocumentSpec): TypedQuantity {
  const count = componentCountFromName(document.name);
  const family = document.productSemantics?.primaryFamily?.code ?? null;
  const qualifier = spec.qualifier;
  const raw = normalizedText(spec.rawValue);
  const base = {
    key: spec.key, magnitude: magnitudeOf(spec.key), componentCount: count, value: spec.value, unit: spec.unit, qualifier,
    approximate: /aprox|≈|no calibrad/u.test(raw) || spec.rawValue.includes('≈'), includesUser: /incluid[oa]s? (?:el )?peso (?:de|del) usuario/u.test(raw),
    subcomponentExercises: [] as string[], evidence: `${spec.rawValue} [feature ${spec.featureId}/${spec.featureValueId}]`,
  };
  const build = (scope: QuantityScope, appliesTo: string, status: SpecQuantity['status'], rule: string, extra: Partial<TypedQuantity> = {}): TypedQuantity =>
    ({ ...base, scope, appliesTo, status, rule, ...extra });
  if (spec.status !== 'parsed' || spec.value === null) return build('UNKNOWN', 'UNKNOWN', 'UNSUPPORTED', `SPEC_STATUS_${spec.status.toUpperCase()}`);

  if (spec.key.endsWith('_cm')) {
    if (!qualifier) return build('PRODUCT_TOTAL', 'PRODUCT', 'INTERPRETED', 'DIMENSION_LABELS');
    const subcomponent = SUBCOMPONENT_EXERCISES.find((item) => item.pattern.test(qualifier));
    if (subcomponent && !/dimensiones totales/u.test(qualifier)) return build('SUBCOMPONENT', subcomponent.label, 'INTERPRETED', 'SUBCOMPONENT', { subcomponentExercises: subcomponent.exercises });
    if (CONFIGURATION_WORDS.test(qualifier) || /^a$|\ba\b/u.test(qualifier)) return build('CONFIGURATION_DEPENDENT', 'PRODUCT', 'INTERPRETED', 'CONFIGURATION');
    return build('UNKNOWN', 'UNKNOWN', 'UNSUPPORTED', 'UNTYPED_QUALIFIER');
  }

  if (spec.key === 'max_user_weight_kg') {
    if (!qualifier) return build('USER_CAPACITY', 'PRODUCT', 'INTERPRETED', 'SINGLE_UNIT_UNQUALIFIED');
    const parts = SUBCOMPONENT_EXERCISES.filter((item) => item.pattern.test(qualifier));
    if (parts.length > 0) {
      return build('SUBCOMPONENT', parts.map((item) => item.label).join(' + '), 'INTERPRETED', 'SUBCOMPONENT', { subcomponentExercises: [...new Set(parts.flatMap((item) => item.exercises))] });
    }
    return build('UNKNOWN', 'UNKNOWN', 'UNSUPPORTED', 'UNTYPED_QUALIFIER');
  }

  if (spec.key === 'max_load_kg') {
    if (!qualifier) return build('PRODUCT_TOTAL', 'PRODUCT', 'INTERPRETED', 'SINGLE_UNIT_UNQUALIFIED');
    if (base.includesUser) return build('PRODUCT_TOTAL', 'PRODUCT (incl. user)', 'INTERPRETED', 'INCLUDES_USER');
    if (/por lado/u.test(qualifier)) return build('PER_SIDE', 'one side', 'INTERPRETED', 'PER_SIDE');
    const each = eachComponent(qualifier);
    if (each) {
      const families = COMPONENT_FAMILIES[each] ?? [];
      return build('PER_UNIT', each, 'INTERPRETED', families.length > 0 && family !== null && !families.includes(family) ? 'COMPONENT_FAMILY_MISMATCH' : 'EXPLICIT_EACH');
    }
    const parts = SUBCOMPONENT_EXERCISES.filter((item) => item.pattern.test(qualifier));
    if (parts.length > 0) {
      return build('SUBCOMPONENT', parts.map((item) => item.label).join(' + '), 'INTERPRETED', 'SUBCOMPONENT', { subcomponentExercises: [...new Set(parts.flatMap((item) => item.exercises))] });
    }
    const named = qualifier.split(' ').find((word) => (COMPONENT_FAMILIES[word] ?? []).includes(family ?? ''));
    if (named && qualifier.split(' ').length === 1) return build('PRODUCT_TOTAL', 'PRODUCT', 'INTERPRETED', 'QUALIFIER_NAMES_PRODUCT');
    return build('UNKNOWN', 'UNKNOWN', 'UNSUPPORTED', 'UNTYPED_QUALIFIER');
  }

  // weight_kg
  const fromName = nameWeightKg(document.name);
  if (!qualifier || /^(?:lbs?|libras?)$/u.test(qualifier)) {
    if (count === 1) {
      if (fromName !== null && !close(fromName, spec.value) && !base.approximate) return build('PRODUCT_TOTAL', 'PRODUCT', 'CONFLICTING', 'NAME_MEASURE_DISAGREES');
      return build('PRODUCT_TOTAL', 'PRODUCT', 'INTERPRETED', 'SINGLE_UNIT_UNQUALIFIED');
    }
    if (/^(?:pack|set|kit)\b/u.test(normalizedText(document.name)) && fromName !== null && close(fromName, spec.value)) return build('PACK_TOTAL', 'PACK', 'INTERPRETED', 'PACK_NAME_TOTAL');
    return build('UNKNOWN', count === 2 ? 'PAIR' : 'PACK', 'AMBIGUOUS', 'MULTI_UNIT_UNQUALIFIED');
  }
  if (/\btotal\b|incluid[oa]s? (?:los )?(?:discos|barras|mancuernas)/u.test(qualifier)) return build('PACK_TOTAL', 'PACK', 'INTERPRETED', 'EXPLICIT_TOTAL');
  if (/\bel par\b|\bpar\b/u.test(qualifier) && !/\bcada\b/u.test(qualifier)) {
    if (count !== null && count !== 2 && count !== 1) return build('PER_PAIR', 'PAIR', 'AMBIGUOUS', 'EXPLICIT_PAIR');
    return build('PER_PAIR', 'PAIR', 'INTERPRETED', 'EXPLICIT_PAIR', { componentCount: 2 });
  }
  const each = eachComponent(qualifier);
  if (each) {
    const families = COMPONENT_FAMILIES[each];
    const nameIsPackTotal = fromName !== null && count !== null && count > 1 && close(fromName, spec.value * count);
    if (fromName !== null && !nameIsPackTotal && !close(fromName, spec.value) && !base.approximate) return build('PER_UNIT', each, 'CONFLICTING', 'NAME_MEASURE_DISAGREES');
    if (families && families.length > 0 && family && !families.includes(family)) return build('PER_UNIT', each, 'INTERPRETED', 'COMPONENT_FAMILY_MISMATCH');
    return build('PER_UNIT', each, 'INTERPRETED', base.approximate ? 'APPROXIMATE' : 'EXPLICIT_EACH');
  }
  if (base.approximate && qualifier.replace(/\baprox\b|\bno\b|\bcalibrada\b/gu, '').trim() === '') {
    return count === 1 ? build('PRODUCT_TOTAL', 'PRODUCT', 'INTERPRETED', 'APPROXIMATE') : build('UNKNOWN', 'PACK', 'AMBIGUOUS', 'MULTI_UNIT_UNQUALIFIED');
  }
  return build('UNKNOWN', 'UNKNOWN', 'UNSUPPORTED', 'UNTYPED_QUALIFIER');
}

/** Component named by "cada <x>" / "en cada <x>" / "cada uno|una", normalized to its singular noun. */
function eachComponent(qualifier: string): string | null {
  const match = /\bcada\s+([a-z]+)/u.exec(qualifier);
  if (!match) return null;
  const word = match[1]!;
  if (word === 'uno' || word === 'una') return 'unit';
  return word.endsWith('s') && COMPONENT_FAMILIES[word.slice(0, -1)] ? word.slice(0, -1) : word;
}

export type QuantityAssessment = {
  state: 'SATISFIED' | 'VIOLATED' | 'UNKNOWN';
  reason: string;
  conflict?: 'CONFLICTING_EVIDENCE';
  quantity: SpecQuantity;
  comparedValue: number | null;
  derived: boolean;
};

export type QuantityContext = { requestedFamilies: readonly string[]; requestedExercises: readonly string[] };

const APPROXIMATE_MARGIN = 0.1;

function compare(operator: DiscoverConstraint['operator'], actual: number, expected: number, approximate: boolean): 'SATISFIED' | 'VIOLATED' | 'UNKNOWN' {
  if (approximate) {
    if (operator === 'EQ' || operator === undefined) return 'UNKNOWN';
    const low = actual * (1 - APPROXIMATE_MARGIN);
    const high = actual * (1 + APPROXIMATE_MARGIN);
    if (operator === 'GTE') return low >= expected ? 'SATISFIED' : high < expected ? 'VIOLATED' : 'UNKNOWN';
    return high <= expected ? 'SATISFIED' : low > expected ? 'VIOLATED' : 'UNKNOWN';
  }
  if (operator === 'GTE') return actual >= expected ? 'SATISFIED' : 'VIOLATED';
  if (operator === 'LTE') return actual <= expected ? 'SATISFIED' : 'VIOLATED';
  return Math.abs(actual - expected) <= Math.max(0.01 * expected, 0.05) ? 'SATISFIED' : 'VIOLATED';
}

/**
 * Value of one interpreted quantity in the scope the constraint asks about, or a
 * reason why it is not comparable. Derivations (pair split, unit × count) are
 * explicit rules and reported as derived.
 */
function comparable(quantity: SpecQuantity, constraint: DiscoverConstraint, document: ProductRetrievalDocument, context: QuantityContext): { value: number; derived: boolean } | { reason: string } {
  const value = quantity.value!;
  const requested = constraint.quantityScope ?? (constraint.specKey === 'weight_kg' ? 'PER_UNIT' : constraint.specKey === 'max_user_weight_kg' ? 'USER_CAPACITY' : 'PRODUCT_TOTAL');
  const productFamily = document.productSemantics?.primaryFamily?.code ?? null;
  switch (quantity.scope) {
    case 'SUBCOMPONENT':
      return quantity.subcomponentExercises.some((code) => context.requestedExercises.includes(code))
        ? { value, derived: false } : { reason: `SUBCOMPONENT_NOT_REQUESTED:${quantity.appliesTo}` };
    case 'PER_SIDE':
      return { reason: 'PER_SIDE_NOT_PRODUCT_TOTAL' };
    case 'CONFIGURATION_DEPENDENT':
      return { value, derived: false };
    case 'USER_CAPACITY':
      return requested === 'USER_CAPACITY' ? { value, derived: false } : { reason: 'SCOPE_MISMATCH:USER_CAPACITY' };
    default:
      break;
  }
  if (constraint.specKey === 'max_load_kg') {
    if (quantity.scope === 'PRODUCT_TOTAL') return { value, derived: false };
    if (quantity.scope === 'PER_UNIT') {
      const families = COMPONENT_FAMILIES[quantity.appliesTo] ?? [];
      return quantity.appliesTo === 'unit' || quantity.componentCount === 1 || (productFamily !== null && families.includes(productFamily))
        ? { value, derived: false } : { reason: `PER_UNIT_COMPONENT_NOT_PRODUCT:${quantity.appliesTo}` };
    }
    return { reason: `SCOPE_NOT_COMPARABLE:${quantity.scope}` };
  }
  if (constraint.specKey !== 'weight_kg') return quantity.scope === 'PRODUCT_TOTAL' ? { value, derived: false } : { reason: `SCOPE_NOT_COMPARABLE:${quantity.scope}` };
  // weight_kg
  const componentFamilies = COMPONENT_FAMILIES[quantity.appliesTo] ?? [];
  const componentMatches = quantity.appliesTo === 'unit' || componentFamilies.length === 0
    || context.requestedFamilies.length === 0 || componentFamilies.some((code) => context.requestedFamilies.includes(code));
  if (requested === 'PACK_TOTAL') {
    if (quantity.scope === 'PACK_TOTAL' || quantity.scope === 'PRODUCT_TOTAL') return { value, derived: false };
    if (quantity.scope === 'PER_PAIR' && quantity.componentCount === 2) return { value, derived: false };
    if (quantity.scope === 'PER_UNIT' && quantity.componentCount !== null && componentMatches) return { value: value * quantity.componentCount, derived: true };
    return { reason: `PACK_TOTAL_NOT_DERIVABLE:${quantity.scope}` };
  }
  if (quantity.scope === 'PRODUCT_TOTAL') return quantity.componentCount === 1 ? { value, derived: false } : { reason: 'PRODUCT_TOTAL_OF_MULTI_UNIT' };
  if (quantity.scope === 'PER_UNIT') return componentMatches ? { value, derived: false } : { reason: `COMPONENT_IS_NOT_REQUESTED_FAMILY:${quantity.appliesTo}` };
  if (quantity.scope === 'PER_PAIR') return { value: value / 2, derived: true };
  if (quantity.scope === 'PACK_TOTAL') return { reason: 'PACK_TOTAL_NOT_PER_UNIT' };
  return { reason: `SCOPE_NOT_COMPARABLE:${quantity.scope}` };
}

/**
 * Assesses a SPEC constraint over all published records of its key (all already
 * parsed; non-parsed and admission are handled by the caller).
 */
export function assessSpecQuantities(document: ProductRetrievalDocument, records: readonly DocumentSpec[], constraint: DiscoverConstraint, context: QuantityContext): QuantityAssessment {
  const quantities = records.map((record) => interpretSpecQuantity(document, record));
  const first = quantities[0]!;
  const conflicting = quantities.find((item) => item.status === 'CONFLICTING');
  if (conflicting) return { state: 'UNKNOWN', reason: `SPEC_CONFLICTS_WITH_NAME:${conflicting.rule}`, conflict: 'CONFLICTING_EVIDENCE', quantity: conflicting, comparedValue: null, derived: false };
  const untyped = quantities.find((item) => item.status !== 'INTERPRETED');
  if (untyped) return { state: 'UNKNOWN', reason: `QUANTITY_${untyped.status}:${untyped.rule}`, quantity: untyped, comparedValue: null, derived: false };
  const uncertifiable = quantities.find((item) => item.certification === 'NOT_CERTIFIABLE');
  if (uncertifiable) return { state: 'UNKNOWN', reason: `QUANTITY_NOT_CERTIFIABLE:${uncertifiable.scope}:${uncertifiable.appliesTo}`, quantity: uncertifiable, comparedValue: null, derived: false };
  const values: { value: number; derived: boolean; quantity: SpecQuantity }[] = [];
  for (const quantity of quantities) {
    const result = comparable(quantity, constraint, document, context);
    if ('reason' in result) return { state: 'UNKNOWN', reason: result.reason, quantity, comparedValue: null, derived: false };
    values.push({ ...result, quantity });
  }
  const configuration = values.some((item) => item.quantity.scope === 'CONFIGURATION_DEPENDENT');
  const distinct = [...new Set(values.map((item) => item.value))];
  if (distinct.length > 1 && !configuration) return { state: 'UNKNOWN', reason: `SPEC_MULTIPLE_VALUES:${distinct.join('|')}`, quantity: first, comparedValue: null, derived: false };
  const states = values.map((item) => compare(constraint.operator, item.value, constraint.value!, item.quantity.approximate));
  const derived = values.some((item) => item.derived);
  const chosen = values[0]!;
  const label = `${constraint.specKey}=${distinct.join('|')}${chosen.quantity.unit} [${chosen.quantity.scope}${derived ? ', derived' : ''}${chosen.quantity.approximate ? ', approx' : ''}] ${constraint.operator} ${constraint.value}`;
  if (states.every((state) => state === 'SATISFIED')) return { state: 'SATISFIED', reason: label, quantity: chosen.quantity, comparedValue: chosen.value, derived };
  if (states.every((state) => state === 'VIOLATED')) return { state: 'VIOLATED', reason: label, quantity: chosen.quantity, comparedValue: chosen.value, derived };
  const why = chosen.quantity.approximate ? 'APPROXIMATE_VALUE' : configuration ? 'CONFIGURATION_DEPENDENT' : 'UNDECIDED';
  return { state: 'UNKNOWN', reason: `${why}:${label}`, quantity: chosen.quantity, comparedValue: chosen.value, derived };
}
