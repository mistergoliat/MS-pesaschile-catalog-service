import { evaluateAdmissionSnapshot, semanticObligationContractV2, type AdmissionTrustInput, type ProductAdmissionContext } from '../../../domain/catalog-admission/index.js';
import type { CanonicalExtraction, CanonicalProduct } from '../../../domain/catalog/projection-input/canonical.js';
import type { SpecsArtifact } from '../../../domain/catalog/projection-bundle.js';
import { isDiscoveryExcludedProductId } from '../../../domain/catalog/discoveryExclusionPolicy.js';
import { commercialProductOntologyRegistryVersionV3, isResidualOntologyTag } from '../../../domain/commercial-product-ontology/index.js';
import type { ProductSemanticSnapshotFact } from '../../../domain/product-semantic-snapshot/index.js';
import type { TrainingSemanticSnapshotV2Record } from '../../../domain/training-semantic-snapshot/v2-contracts.js';
import { deriveExerciseSemantics } from '../../../domain/training-semantics-v2/index.js';
import { DISCOVER_V0_RETRIEVAL_VERSION, type SpecKeyV0 } from './contracts.js';
import { DISCOVER_V0_LEXICON_VERSION } from './lexicon.js';
import { discoverTokens, normalizedText, sha256, stemToken } from './text.js';

/*
 * ProductRetrievalDocument V0 and the in-memory index built from the frozen
 * source extraction plus ONE projection bundle. Both bundles are indexed by the
 * same code from the same source, so an index difference can only come from the
 * bundle's projections.
 *
 * Rules (DISCOVER_V0_DOCUMENT_RULES):
 *  - identity is productKey "P{productId}"; one document per canonical product;
 *  - only fields present in the frozen extraction or the bundle are used: no
 *    commercial description (not extracted), no SKU/reference (not extracted),
 *    no price/stock (never in a retrieval document);
 *  - lexical fields are name, brand (feature 62) and SOURCE category/feature
 *    text gated by the verified trust maps; classifications are NOT lexical text;
 *  - Admission is evaluated per dimension with the authoritative evaluator and
 *    semantic-obligations-v2; it is stored, never applied as a global filter;
 *  - the discover universe equals catalog.search's: current, active, not in the
 *    discovery exclusion policy.
 */

export const DISCOVER_V0_DOCUMENT_RULES_VERSION = 'retrieval-document-v0.1';
const BRAND_FEATURE_ID = 62;

export type ProjectionStatus = 'PRESENT' | 'UNAVAILABLE' | 'INVALID';

export type DiscoverSourceInput = {
  sourceExtractionId: string;
  extraction: CanonicalExtraction;
  categoryTrust: ReadonlyMap<number, string>;
  featureTrust: ReadonlyMap<number, string>;
  sourceHashesVerified: boolean;
};

export type DiscoverBundleInput = {
  label: string;
  bundleId: string;
  manifestSourceExtractionId: string;
  lineageVerified: boolean;
  productSemantics: { status: ProjectionStatus; snapshotId: string | null; records: readonly ProductSemanticSnapshotFact[] | null; reason?: string };
  trainingV2: { status: ProjectionStatus; snapshotId: string | null; projectionId: string | null; records: readonly TrainingSemanticSnapshotV2Record[] | null; reason?: string };
  specs: { status: ProjectionStatus; snapshotId: string | null; records: SpecsArtifact['records'] | null; reason?: string };
  relationships: { status: ProjectionStatus; reason?: string };
};

type Tag = { code: string; confidence: string; ruleId: string };

export type DocumentSpec = {
  key: SpecKeyV0;
  value: number | null;
  unit: 'kg' | 'cm';
  status: 'parsed' | 'ambiguous' | 'unsupported';
  rawValue: string;
  featureId: number;
  featureValueId: number;
  derivationRule: string;
  qualifier: string | null;
};

export type DocumentAdmission = {
  productDiscovery: string;
  exerciseDiscovery: string;
  functionDiscovery: string;
  specFilteringByKey: Record<string, string>;
  unified: string;
  lexicalSearch: string;
  exerciseNegativeEvidence: string | null;
  functionNegativeEvidence: string | null;
  consolidation: string;
  /** Training dimensions the family's own obligation contract REQUIRES but the projection does not assert. */
  unmetFamilyObligations: string[];
};

export type ProductRetrievalDocument = {
  productKey: string;
  productId: number;
  name: string;
  references: string[];
  brand: { value: string; featureValueId: number } | null;
  catalogPresence: CanonicalProduct['catalogPresence'];
  current: boolean;
  active: boolean | null;
  inUniverse: boolean;
  universeExclusion: string | null;
  categories: { categoryId: number; name: string | null; trustClass: string }[];
  features: { featureId: number; featureValueId: number; name: string; value: string | null; trustClass: string }[];
  productSemantics: null | {
    classificationStatus: string;
    primaryFamily: Tag | null;
    secondaryFamilies: Tag[];
    disciplines: Tag[];
    useContexts: Tag[];
  };
  training: null | {
    resolutionState: string;
    coverageStatus: string;
    exercises: { code: string; relationType: string; confidence: string; ruleIds: string[]; muscleGroups: string[]; bodyRegions: string[] }[];
    functions: { code: string; relationType: string; confidence: string; ruleIds: string[] }[];
  };
  specs: DocumentSpec[] | null;
  admission: DocumentAdmission | null;
};

export type LexicalField = 'NAME' | 'BRAND' | 'CATEGORY' | 'FEATURE';
export const LEXICAL_FIELD_WEIGHTS: Record<LexicalField, number> = { NAME: 3, BRAND: 1, CATEGORY: 1, FEATURE: 0.5 };
const CATEGORY_TRUST_WEIGHT: Record<string, number> = { SEMANTIC_STRONG: 1, SEMANTIC_WEAK: 0.5 };
const FEATURE_TRUST_WEIGHT: Record<string, number> = { SEMANTIC: 1 };

export type LexicalPosting = { weightedTf: number; fields: LexicalField[] };

export type DiscoverIndex = {
  label: string;
  bundleId: string;
  sourceExtractionId: string;
  documents: ReadonlyMap<string, ProductRetrievalDocument>;
  universe: readonly string[];
  lexical: {
    postings: ReadonlyMap<string, ReadonlyMap<string, LexicalPosting>>;
    documentLength: ReadonlyMap<string, number>;
    averageLength: number;
    vocabulary: readonly string[];
  };
  structured: ReadonlyMap<string, ReadonlySet<string>>;
  degraded: string[];
  lineage: {
    productSemanticsSnapshotId: string | null;
    trainingV2SnapshotId: string | null;
    trainingV2ProjectionId: string | null;
    specsSnapshotId: string | null;
    relationships: ProjectionStatus;
    admissionContractHash: string;
    lineageVerified: boolean;
    sourceHashesVerified: boolean;
    documentRulesVersion: string;
    retrievalVersion: string;
    lexiconVersion: string;
  };
  fingerprint: string;
  /** Hash of the lexical postings only: equal across bundles because lexical text comes from the source. */
  lexicalFingerprint: string;
  buildMs: number;
};

const DIMENSION_LABELS = new Set(['largo', 'ancho', 'alto', 'altura', 'profundidad']);
const VALUE_NOISE = new Set(['kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'cm', 'mm', 'm', 'mts', 'lb', 'lbs']);

/**
 * SPEC_QUALIFIER_POLICY_V0: a parsed value whose raw text carries words other
 * than the value, its unit or (dimensions only) the axis labels is QUALIFIED
 * ("cada disco", "el par", "aprox.", "incluido el peso de usuario", "barra pull
 * up: ..."). A qualified value can retrieve, never certify a hard constraint.
 */
export function specQualifier(key: SpecKeyV0, rawValue: string): string | null {
  const words = normalizedText(rawValue)
    .replace(/\d+(?:[.,]\d+)?[a-z]*/gu, ' ')
    .split(/[^a-z]+/u)
    .filter((word) => word.length > 0 && !VALUE_NOISE.has(word));
  const allowed = key.endsWith('_cm') ? DIMENSION_LABELS : new Set<string>();
  const residual = words.filter((word) => !allowed.has(word));
  return residual.length === 0 ? null : residual.join(' ');
}

function tagOf(tag: { code: string; confidence: string; ruleId: string }): Tag {
  return { code: tag.code, confidence: tag.confidence, ruleId: tag.ruleId };
}

function nonResidual(axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT', tags: readonly Tag[]): Tag[] {
  return tags.filter((tag) => !isResidualOntologyTag(axis, tag.code, commercialProductOntologyRegistryVersionV3));
}

function admissionOf(context: ProductAdmissionContext): DocumentAdmission {
  const evaluated = evaluateAdmissionSnapshot(context, semanticObligationContractV2);
  const dimensions = new Map(evaluated.consolidation.evaluatedDimensions.map((dimension) => [dimension.dimension, dimension]));
  return {
    productDiscovery: evaluated.admission.PRODUCT_SEMANTIC_DISCOVERY.decision,
    exerciseDiscovery: evaluated.admission.TRAINING_DISCOVERY.decision,
    functionDiscovery: evaluated.functionDiscovery.decision,
    specFilteringByKey: Object.fromEntries(Object.entries(evaluated.specFilteringByKey ?? {}).map(([key, value]) => [key, value.decision])),
    unified: evaluated.admission.UNIFIED_RETRIEVAL.decision,
    lexicalSearch: evaluated.admission.LEXICAL_SEARCH.decision,
    exerciseNegativeEvidence: dimensions.get('TRAINING_EXERCISE')?.resolution.negativeEvidenceState ?? null,
    functionNegativeEvidence: dimensions.get('TRAINING_FUNCTION')?.resolution.negativeEvidenceState ?? null,
    consolidation: evaluated.consolidation.state,
    unmetFamilyObligations: evaluated.consolidation.evaluatedDimensions
      .filter((dimension) => (dimension.dimension === 'TRAINING_EXERCISE' || dimension.dimension === 'TRAINING_FUNCTION')
        && dimension.effectiveRequirement === 'REQUIRED' && dimension.reasons.some((reason) => reason.code === 'REQUIRED_ASSIGNMENT_MISSING'))
      .map((dimension) => dimension.dimension),
  };
}

function addTerms(target: Map<string, LexicalPosting>, text: string | null, field: LexicalField, weight: number): number {
  if (!text || weight <= 0) return 0;
  const tokens = discoverTokens(text).map(stemToken);
  for (const token of tokens) {
    const posting = target.get(token) ?? { weightedTf: 0, fields: [] };
    posting.weightedTf += LEXICAL_FIELD_WEIGHTS[field] * weight;
    if (!posting.fields.includes(field)) posting.fields.push(field);
    target.set(token, posting);
  }
  return tokens.length * LEXICAL_FIELD_WEIGHTS[field] * weight;
}

function addBucket(buckets: Map<string, Set<string>>, key: string, productKey: string): void {
  const bucket = buckets.get(key) ?? new Set<string>();
  bucket.add(productKey);
  buckets.set(key, bucket);
}

export class ProductRetrievalDocumentBuilder {
  build(source: DiscoverSourceInput, bundle: DiscoverBundleInput): DiscoverIndex {
    const started = performance.now();
    const degraded: string[] = [];
    if (bundle.productSemantics.status !== 'PRESENT') degraded.push(`PRODUCT_SEMANTICS_${bundle.productSemantics.status}`);
    if (bundle.trainingV2.status !== 'PRESENT') degraded.push(`TRAINING_V2_${bundle.trainingV2.status}`);
    if (bundle.specs.status !== 'PRESENT') degraded.push(`SPECS_${bundle.specs.status}`);
    if (bundle.relationships.status !== 'PRESENT') degraded.push('RELATIONSHIPS_UNAVAILABLE');
    if (bundle.manifestSourceExtractionId !== source.sourceExtractionId) degraded.push('SOURCE_LINEAGE_MISMATCH');

    const productById = new Map((bundle.productSemantics.records ?? []).map((record) => [Number(record.productId), record]));
    const trainingById = new Map((bundle.trainingV2.records ?? []).map((record) => [record.productId, record]));
    const specsByKey = new Map<string, SpecsArtifact['records']>();
    for (const record of bundle.specs.records ?? []) specsByKey.set(record.productKey, [...(specsByKey.get(record.productKey) ?? []), record]);
    const trust: AdmissionTrustInput = {
      categories: [...source.categoryTrust].map(([categoryId, trustClass]) => ({ categoryId, trustClass: trustClass as AdmissionTrustInput['categories'][number]['trustClass'] })),
      features: [...source.featureTrust].map(([featureId, trustClass]) => ({ featureId, trustClass: trustClass as AdmissionTrustInput['features'][number]['trustClass'] })),
      sourceHashesVerified: source.sourceHashesVerified,
      consumedByCategorySelection: false,
    };

    const documents: ProductRetrievalDocument[] = [];
    for (const product of [...source.extraction.products].sort((left, right) => left.productId - right.productId)) {
      const productKey = `P${product.productId}`;
      const current = product.catalogPresence === 'current_catalog';
      const universeExclusion = !current ? 'HISTORICAL' : product.active !== true ? 'INACTIVE' : isDiscoveryExcludedProductId(product.productId) ? 'DISCOVERY_EXCLUSION_POLICY' : null;
      const brandFeature = (product.features ?? []).find((feature) => feature.featureId === BRAND_FEATURE_ID && feature.value);
      const semantic = productById.get(product.productId) ?? null;
      const training = trainingById.get(product.productId) ?? null;
      const specRecords = bundle.specs.records ? (specsByKey.get(productKey) ?? []) : null;
      const document: ProductRetrievalDocument = {
        productKey,
        productId: product.productId,
        name: product.name,
        references: [],
        brand: brandFeature ? { value: brandFeature.value!, featureValueId: brandFeature.featureValueId } : null,
        catalogPresence: product.catalogPresence,
        current,
        active: product.active,
        inUniverse: universeExclusion === null,
        universeExclusion,
        categories: (product.categoryIds ?? []).map((category) => ({ ...category, trustClass: source.categoryTrust.get(category.categoryId) ?? 'UNKNOWN' })),
        features: (product.features ?? []).map((feature) => ({ ...feature, trustClass: source.featureTrust.get(feature.featureId) ?? 'UNKNOWN' })),
        productSemantics: semantic ? {
          classificationStatus: semantic.classificationStatus,
          primaryFamily: semantic.primaryProductFamily && !isResidualOntologyTag('PRODUCT_FAMILY', semantic.primaryProductFamily.code, commercialProductOntologyRegistryVersionV3)
            ? tagOf(semantic.primaryProductFamily) : null,
          secondaryFamilies: nonResidual('PRODUCT_FAMILY', semantic.secondaryProductFamilies.map(tagOf)),
          disciplines: nonResidual('DISCIPLINE', semantic.disciplines.map(tagOf)),
          useContexts: nonResidual('USE_CONTEXT', semantic.useContexts.map(tagOf)),
        } : null,
        training: training ? {
          resolutionState: training.resolutionState ?? 'UNKNOWN',
          coverageStatus: training.coverageStatus,
          exercises: training.exerciseCapabilities.map((assignment) => {
            const derived = deriveExerciseSemantics(assignment.capabilityCode);
            return { code: assignment.capabilityCode, relationType: assignment.relationType, confidence: assignment.classificationConfidence,
              ruleIds: assignment.evidence.map((evidence) => evidence.ruleId ?? evidence.kind),
              muscleGroups: [...new Set([...derived.primaryMuscleGroups, ...derived.secondaryMuscleGroups])], bodyRegions: [...derived.bodyRegions] };
          }),
          functions: training.trainingFunctions.map((assignment) => ({ code: assignment.functionCode, relationType: assignment.relationType,
            confidence: assignment.classificationConfidence, ruleIds: assignment.evidence.map((evidence) => evidence.ruleId ?? evidence.kind) })),
        } : null,
        specs: specRecords ? specRecords.map((record) => ({
          key: record.key, value: record.value, unit: record.unit, status: record.status, rawValue: record.rawValue,
          featureId: record.sourceFeature.featureId, featureValueId: record.sourceFeature.featureValueId, derivationRule: record.derivationRule,
          qualifier: record.status === 'parsed' ? specQualifier(record.key, record.rawValue) : null,
        })) : null,
        admission: null,
      };
      if (document.inUniverse) {
        document.admission = admissionOf({
          canonical: product,
          productSemantics: semantic,
          training,
          specs: specRecords,
          trust,
          lineage: { productVerified: bundle.lineageVerified && semantic !== null, trainingVerified: bundle.lineageVerified && training !== null,
            specsVerified: bundle.lineageVerified && specRecords !== null },
        });
      }
      documents.push(document);
    }
    return assembleDiscoverIndex({
      label: bundle.label,
      bundleId: bundle.bundleId,
      sourceExtractionId: source.sourceExtractionId,
      documents,
      degraded,
      lineage: {
        productSemanticsSnapshotId: bundle.productSemantics.snapshotId,
        trainingV2SnapshotId: bundle.trainingV2.snapshotId,
        trainingV2ProjectionId: bundle.trainingV2.projectionId,
        specsSnapshotId: bundle.specs.snapshotId,
        relationships: bundle.relationships.status,
        admissionContractHash: semanticObligationContractV2.contentHash,
        lineageVerified: bundle.lineageVerified,
        sourceHashesVerified: source.sourceHashesVerified,
        documentRulesVersion: DISCOVER_V0_DOCUMENT_RULES_VERSION,
        retrievalVersion: DISCOVER_V0_RETRIEVAL_VERSION,
        lexiconVersion: DISCOVER_V0_LEXICON_VERSION,
      },
      started,
    });
  }
}

/** Builds the lexical postings, structured buckets and fingerprints from finished documents (used by the builder and by synthetic test fixtures). */
export function assembleDiscoverIndex(input: {
  label: string;
  bundleId: string;
  sourceExtractionId: string;
  documents: readonly ProductRetrievalDocument[];
  degraded: string[];
  lineage: DiscoverIndex['lineage'];
  started?: number;
}): DiscoverIndex {
  const started = input.started ?? performance.now();
  const documents = new Map<string, ProductRetrievalDocument>();
  const universe: string[] = [];
  const postings = new Map<string, Map<string, LexicalPosting>>();
  const documentLength = new Map<string, number>();
  const structured = new Map<string, Set<string>>();
  for (const document of [...input.documents].sort((left, right) => left.productId - right.productId)) {
    documents.set(document.productKey, document);
    if (!document.inUniverse) continue;
    universe.push(document.productKey);
    const terms = new Map<string, LexicalPosting>();
    let length = addTerms(terms, document.name, 'NAME', 1);
    length += addTerms(terms, document.brand?.value ?? null, 'BRAND', 1);
    for (const category of document.categories) length += addTerms(terms, category.name, 'CATEGORY', CATEGORY_TRUST_WEIGHT[category.trustClass] ?? 0);
    for (const feature of document.features) {
      if (feature.featureId !== BRAND_FEATURE_ID) length += addTerms(terms, feature.value, 'FEATURE', FEATURE_TRUST_WEIGHT[feature.trustClass] ?? 0);
    }
    for (const [term, posting] of terms) {
      const list = postings.get(term) ?? new Map<string, LexicalPosting>();
      list.set(document.productKey, posting);
      postings.set(term, list);
    }
    documentLength.set(document.productKey, length);
    addStructured(structured, document);
  }
  const lengths = [...documentLength.values()];
  const averageLength = lengths.length === 0 ? 0 : lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const fingerprint = sha256(JSON.stringify({ lineage: input.lineage, bundleId: input.bundleId, source: input.sourceExtractionId,
    documents: universe.map((key) => documents.get(key)) }));
  const lexicalFingerprint = sha256(JSON.stringify([...postings.keys()].sort().map((term) => [term, [...postings.get(term)!].sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, posting]) => [key, posting.weightedTf, [...posting.fields].sort()])])));
  return {
    label: input.label,
    bundleId: input.bundleId,
    sourceExtractionId: input.sourceExtractionId,
    documents,
    universe,
    lexical: { postings, documentLength, averageLength, vocabulary: [...postings.keys()].sort() },
    structured,
    degraded: input.degraded,
    lineage: input.lineage,
    fingerprint,
    lexicalFingerprint,
    buildMs: performance.now() - started,
  };
}

function addStructured(buckets: Map<string, Set<string>>, document: ProductRetrievalDocument): void {
  const semantic = document.productSemantics;
  if (semantic && semantic.classificationStatus !== 'EXCLUDED_NON_PRODUCT') {
    for (const tag of [...(semantic.primaryFamily ? [semantic.primaryFamily] : []), ...semantic.secondaryFamilies]) addBucket(buckets, `PRODUCT_FAMILY:${tag.code}`, document.productKey);
    for (const tag of semantic.disciplines) addBucket(buckets, `DISCIPLINE:${tag.code}`, document.productKey);
    for (const tag of semantic.useContexts) addBucket(buckets, `USE_CONTEXT:${tag.code}`, document.productKey);
  }
  for (const exercise of document.training?.exercises ?? []) {
    if (exercise.relationType !== 'DIRECT' && exercise.relationType !== 'SUPPORTED') continue;
    addBucket(buckets, `EXERCISE_CAPABILITY:${exercise.code}`, document.productKey);
    for (const code of exercise.muscleGroups) addBucket(buckets, `MUSCLE_GROUP:${code}`, document.productKey);
    for (const code of exercise.bodyRegions) addBucket(buckets, `BODY_REGION:${code}`, document.productKey);
  }
  for (const fn of document.training?.functions ?? []) {
    if (fn.relationType === 'DIRECT' || fn.relationType === 'FAMILY_DERIVED') addBucket(buckets, `TRAINING_FUNCTION:${fn.code}`, document.productKey);
  }
  for (const spec of document.specs ?? []) {
    if (spec.status === 'parsed') addBucket(buckets, `SPEC:${spec.key}`, document.productKey);
  }
}
