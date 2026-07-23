import type {
  CandidateConstraintEvaluation,
  CandidateConstraintMatch,
  ExplicitProductConstraints,
  MeasurementConstraint,
  NormalizedProductQuery,
  ProductConstraintEvaluator,
  ProductExplicitConstraintExtractor,
  ProductIntentCatalogProduct,
  ProductTypeConstraint,
} from './contracts.js';
import { normalizeCatalogText } from './normalizer.js';

const PRODUCT_TYPE_PATTERNS: ReadonlyArray<{
  readonly type: ProductTypeConstraint;
  readonly patterns: readonly RegExp[];
}> = Object.freeze([
  { type: 'curl_bar', patterns: [/\bbarra z\b/u, /\bcurl bar\b/u] },
  { type: 'hex_bar', patterns: [/\bbarra hexagonal\b/u, /\bhex bar\b/u] },
  { type: 'kettlebell', patterns: [/\bkettlebell\b/u, /\bpesa rusa\b/u, /\bpesas rusas\b/u] },
  { type: 'bumper_plate', patterns: [/\bdiscos? bumper\b/u, /\bdiscos? de goma\b/u, /\bdiscos? rubber\b/u] },
  { type: 'iron_plate', patterns: [/\bdiscos? de hierro\b/u, /\bdiscos? fierro\b/u] },
  { type: 'barbell_collar', patterns: [/\bcollarines\b/u, /\bcollarin\b/u, /\bcierres? barra\b/u, /\bseguros? barra\b/u] },
  { type: 'leg_extension_machine', patterns: [/\bextension(?:es)? de piernas\b/u, /\bmaquina de cuadriceps\b/u] },
  { type: 'leg_curl_machine', patterns: [/\bcurl femoral\b/u, /\bmaquina femoral\b/u] },
  { type: 'olympic_bar', patterns: [/\bbarra olimpica\b/u, /\bbarra olimpico\b/u] },
  { type: 'straight_bar', patterns: [/\bbarra recta\b/u] },
]);

function measurement(value: number, unit: MeasurementConstraint['normalizedUnit']): MeasurementConstraint {
  const normalizedValue = unit === 'm' ? value * 100 : value;
  return {
    value,
    unit,
    normalizedValue: Number(normalizedValue.toFixed(6)),
    normalizedUnit: unit === 'm' ? 'cm' : unit,
  };
}

function numberFrom(value: string): number {
  return Number(value.replace(',', '.'));
}

function firstMeasurement(text: string, patterns: ReadonlyArray<{ regex: RegExp; unit: MeasurementConstraint['normalizedUnit'] }>): MeasurementConstraint | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match?.[1]) continue;
    return measurement(numberFrom(match[1]), pattern.unit);
  }
  return undefined;
}

function extractWeight(text: string): MeasurementConstraint | undefined {
  return firstMeasurement(text, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:kg|kilo|kilos|kilogramo|kilogramos)\b/u, unit: 'kg' },
  ]);
}

function extractDiameter(text: string): MeasurementConstraint | undefined {
  return firstMeasurement(text, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:mm|milimetro|milimetros)\b/u, unit: 'mm' },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:pulgada|pulgadas)\b/u, unit: 'in' },
  ]);
}

function extractLength(text: string): MeasurementConstraint | undefined {
  return firstMeasurement(text, [
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:cm|centimetro|centimetros)\b/u, unit: 'cm' },
    { regex: /\b(\d+(?:[.,]\d+)?)\s*(?:m|metro|metros)\b/u, unit: 'm' },
  ]);
}

function extractProductType(text: string): ProductTypeConstraint | undefined {
  for (const entry of PRODUCT_TYPE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.type;
  }
  return undefined;
}

function constraintCount(constraints: ExplicitProductConstraints): number {
  return [
    constraints.productType,
    constraints.weight,
    constraints.diameter,
    constraints.length,
    constraints.brand,
    constraints.reference,
    constraints.variant,
  ].filter((value) => value !== undefined).length;
}

function productTexts(product: ProductIntentCatalogProduct): {
  readonly attributes: string;
  readonly identity: string;
  readonly all: string;
} {
  const attributes = normalizeCatalogText((product.attributes ?? [])
    .map((attribute) => `${attribute.group} ${attribute.value}`)
    .join(' '));
  const identity = normalizeCatalogText([product.reference, product.name].filter(Boolean).join(' '));
  const all = normalizeCatalogText([
    attributes,
    product.reference,
    product.name,
    product.category,
    product.description,
  ].filter(Boolean).join(' '));
  return { attributes, identity, all };
}

function equivalentMeasurement(left: MeasurementConstraint, right: MeasurementConstraint): boolean | null {
  if (left.normalizedUnit !== right.normalizedUnit) return null;
  return Math.abs(left.normalizedValue - right.normalizedValue) < 0.001;
}

function evaluateMeasurement(
  type: 'weight' | 'diameter' | 'length',
  queryValue: MeasurementConstraint | undefined,
  candidateValue: MeasurementConstraint | undefined,
): CandidateConstraintMatch | null {
  if (!queryValue) return null;
  if (!candidateValue) {
    return {
      type,
      status: 'not_available',
      queryValue: `${queryValue.normalizedValue} ${queryValue.normalizedUnit}`,
    };
  }
  const equivalent = equivalentMeasurement(queryValue, candidateValue);
  return {
    type,
    status: equivalent === true ? 'matched' : equivalent === false ? 'contradicted' : 'not_available',
    queryValue: `${queryValue.normalizedValue} ${queryValue.normalizedUnit}`,
    candidateValue: `${candidateValue.normalizedValue} ${candidateValue.normalizedUnit}`,
  };
}

function evaluateString(
  type: 'brand' | 'reference' | 'variant',
  queryValue: string | undefined,
  candidateText: string,
): CandidateConstraintMatch | null {
  if (!queryValue) return null;
  if (candidateText.length === 0) {
    return { type, status: 'not_available', queryValue };
  }
  return {
    type,
    status: candidateText.includes(normalizeCatalogText(queryValue)) ? 'matched' : 'contradicted',
    queryValue,
  };
}

function measurementFromCandidate(
  product: ProductIntentCatalogProduct,
  extractor: (text: string) => MeasurementConstraint | undefined,
): MeasurementConstraint | undefined {
  const texts = productTexts(product);
  return extractor(texts.attributes) ?? extractor(texts.identity) ?? extractor(texts.all);
}

export class DefaultProductExplicitConstraintExtractor implements ProductExplicitConstraintExtractor {
  extract(query: NormalizedProductQuery): ExplicitProductConstraints {
    const text = query.synonymTerms.length === 1
      ? [query.normalized, ...query.synonymTerms].join(' ')
      : query.normalized;
    const productType = extractProductType(text);
    const reference = query.tokens.length === 1 && /[a-z]+[-_]*\d+|\d+[-_]*[a-z]+/u.test(query.tokens[0] ?? '')
      ? query.tokens[0]
      : undefined;
    return {
      ...(productType === undefined ? {} : { productType }),
      ...(extractWeight(text) === undefined ? {} : { weight: extractWeight(text) }),
      ...(extractDiameter(text) === undefined ? {} : { diameter: extractDiameter(text) }),
      ...(extractLength(text) === undefined ? {} : { length: extractLength(text) }),
      ...(reference === undefined ? {} : { reference }),
    };
  }
}

export class DefaultProductConstraintEvaluator implements ProductConstraintEvaluator {
  evaluate(
    constraints: ExplicitProductConstraints,
    product: ProductIntentCatalogProduct,
  ): CandidateConstraintEvaluation {
    const texts = productTexts(product);
    const candidateType = extractProductType(texts.all);
    const matches: CandidateConstraintMatch[] = [];

    if (constraints.productType !== undefined) {
      matches.push({
        type: 'product_type',
        status: candidateType === undefined
          ? 'not_available'
          : candidateType === constraints.productType
            ? 'matched'
            : 'contradicted',
        queryValue: constraints.productType,
        ...(candidateType === undefined ? {} : { candidateValue: candidateType }),
      });
    }

    const weight = evaluateMeasurement('weight', constraints.weight, measurementFromCandidate(product, extractWeight));
    const diameter = evaluateMeasurement('diameter', constraints.diameter, measurementFromCandidate(product, extractDiameter));
    const length = evaluateMeasurement('length', constraints.length, measurementFromCandidate(product, extractLength));
    const brand = evaluateString('brand', constraints.brand, texts.all);
    const reference = evaluateString('reference', constraints.reference, texts.identity);
    const variant = evaluateString('variant', constraints.variant, texts.all);
    for (const item of [weight, diameter, length, brand, reference, variant]) {
      if (item) matches.push(item);
    }

    const explicitConstraintCount = constraintCount(constraints);
    const matchedConstraintCount = matches.filter((match) => match.status === 'matched').length;
    return {
      explicitConstraintCount,
      matchedConstraintCount,
      satisfiesAllExplicitConstraints: explicitConstraintCount > 0 && matchedConstraintCount === explicitConstraintCount,
      hasContradiction: matches.some((match) => match.status === 'contradicted'),
      constraints: matches,
    };
  }
}
