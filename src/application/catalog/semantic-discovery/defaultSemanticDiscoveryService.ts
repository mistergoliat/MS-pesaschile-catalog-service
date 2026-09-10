import {
  commercialProductOntologyRegistryVersionV3,
  getOntologyTagsForAxis,
  isResidualOntologyTag,
  type OntologyAxis,
} from '../../../domain/commercial-product-ontology/index.js';
import type {
  ActiveProductSemanticSnapshotReader,
  ProductSemanticActiveSnapshotMetadata,
} from '../../../domain/product-semantic-snapshot/runtime/index.js';
import type { ProductSemanticSnapshotFact } from '../../../domain/product-semantic-snapshot/index.js';
import {
  getTrainingSemanticRegistryV2,
} from '../../../domain/training-semantics-v2/index.js';
import type {
  ActiveTrainingSemanticSnapshotV2Reader,
  TrainingSemanticRuntimeV2Fact,
  TrainingSemanticSnapshotV2Metadata,
} from '../../../domain/training-semantic-snapshot/index.js';
import {
  InvalidSemanticDiscoveryRequestError,
  ProductSemanticSnapshotMismatchError,
  ProductSemanticsUnavailableError,
  TrainingSemanticSnapshotMismatchError,
  TrainingSemanticsUnavailableError,
} from '../../../shared/errors.js';
import { semanticDiscoveryDurationSeconds, semanticDiscoveryRequestsTotal } from '../../../shared/metrics.js';
import {
  semanticDiscoveryProductAxes,
  semanticDiscoveryRequestSchema,
  semanticDiscoveryRelations,
  semanticDiscoveryTrainingAxes,
  type PublicSemanticDiscoveryMatchedRequirement,
  type PublicSemanticDiscoveryProductFact,
  type PublicSemanticDiscoveryResponse,
  type PublicSemanticDiscoveryResult,
  type SemanticDiscoveryAxis,
  type SemanticDiscoveryRequirement,
  type SemanticDiscoveryService,
} from './contracts.js';

type ProductReader = Pick<ActiveProductSemanticSnapshotReader, 'getActiveSnapshotMetadata' | 'getAllProductSemanticFacts'>;
type TrainingReader = Pick<ActiveTrainingSemanticSnapshotV2Reader, 'getMetadata' | 'getAllProductTrainingSemanticFacts'>;
type ProductFact = ProductSemanticSnapshotFact;
type TrainingFact = TrainingSemanticRuntimeV2Fact;
type Relation = 'DIRECT' | 'SUPPORTED' | 'FAMILY_DERIVED';

type Match = {
  readonly matchedCodes: readonly string[];
  readonly relationTypes: readonly Relation[];
  readonly confidenceLevels: readonly string[];
};

type CombinedIndex = {
  readonly productSnapshotId: string | null;
  readonly productSemanticChecksum: string | null;
  readonly productOntologyHash: string | null;
  readonly trainingSnapshotId: string | null;
  readonly trainingSemanticChecksum: string | null;
  readonly trainingRegistryHash: string | null;
  readonly productFactsById: ReadonlyMap<number, ProductFact>;
  readonly trainingFactsById: ReadonlyMap<number, TrainingFact>;
  readonly buckets: ReadonlyMap<string, ReadonlySet<number>>;
};

const productAxisSet = new Set<string>(semanticDiscoveryProductAxes);
const trainingAxisSet = new Set<string>(semanticDiscoveryTrainingAxes);
const trainingRegistry = getTrainingSemanticRegistryV2();
const productRelations: readonly Relation[] = [];
const exerciseRelations: readonly Relation[] = ['DIRECT', 'SUPPORTED'];
const functionRelations: readonly Relation[] = ['DIRECT', 'FAMILY_DERIVED'];
const relationOrder: readonly Relation[] = ['DIRECT', 'SUPPORTED', 'FAMILY_DERIVED'];

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(lexical);
}

function isProductAxis(axis: SemanticDiscoveryAxis): boolean {
  return productAxisSet.has(axis);
}

function isTrainingAxis(axis: SemanticDiscoveryAxis): boolean {
  return trainingAxisSet.has(axis);
}

function sourceFor(axis: SemanticDiscoveryAxis): 'PRODUCT_SEMANTICS' | 'TRAINING_SEMANTICS' {
  return isProductAxis(axis) ? 'PRODUCT_SEMANTICS' : 'TRAINING_SEMANTICS';
}

function defaultRelations(axis: SemanticDiscoveryAxis): readonly Relation[] {
  if (axis === 'TRAINING_FUNCTION') return functionRelations;
  if (axis === 'EXERCISE_CAPABILITY' || isTrainingAxis(axis)) return exerciseRelations;
  return productRelations;
}

function allowedCodes(axis: SemanticDiscoveryAxis): readonly string[] {
  if (isProductAxis(axis)) return getOntologyTagsForAxis(axis as OntologyAxis, commercialProductOntologyRegistryVersionV3).map((tag) => tag.code);
  if (axis === 'EXERCISE_CAPABILITY') return trainingRegistry.exerciseCapabilities.map((definition) => definition.code);
  if (axis === 'TRAINING_FUNCTION') return trainingRegistry.trainingFunctions.map((definition) => definition.code);
  if (axis === 'BODY_REGION') return trainingRegistry.bodyRegions;
  if (axis === 'MUSCLE_GROUP') return trainingRegistry.muscleGroups;
  return trainingRegistry.trainingPatterns;
}

function bucketKey(axis: SemanticDiscoveryAxis, code: string, relation?: Relation): string {
  return `${axis}\u0000${code}\u0000${relation ?? ''}`;
}

function addBucket(buckets: Map<string, Set<number>>, axis: SemanticDiscoveryAxis, code: string, productId: number, relation?: Relation): void {
  const key = bucketKey(axis, code, relation);
  const bucket = buckets.get(key) ?? new Set<number>();
  bucket.add(productId);
  buckets.set(key, bucket);
}

function numericProductId(productId: string): number | null {
  if (!/^\d+$/u.test(productId)) return null;
  const value = Number(productId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function productTags(fact: ProductFact, axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT') {
  if (axis === 'PRODUCT_FAMILY') return [ ...(fact.primaryProductFamily ? [fact.primaryProductFamily] : []), ...fact.secondaryProductFamilies ];
  return axis === 'DISCIPLINE' ? fact.disciplines : fact.useContexts;
}

function addProductFacts(buckets: Map<string, Set<number>>, factsById: Map<number, ProductFact>, facts: readonly ProductFact[]): void {
  for (const fact of facts) {
    const productId = numericProductId(fact.productId);
    if (
      productId === null ||
      fact.classificationStatus === 'EXCLUDED_NON_PRODUCT' ||
      fact.catalogPresence !== 'current_catalog'
    ) continue;
    factsById.set(productId, fact);
    for (const axis of semanticDiscoveryProductAxes) {
      for (const tag of productTags(fact, axis)) {
        if (!isResidualOntologyTag(axis, tag.code, fact.ontologyVersion as never)) addBucket(buckets, axis, tag.code, productId);
      }
    }
  }
}

function addTrainingFacts(buckets: Map<string, Set<number>>, factsById: Map<number, TrainingFact>, facts: readonly TrainingFact[]): void {
  for (const fact of facts) {
    if (fact.resolutionState !== 'SEMANTIC_COMPLETE') continue;
    factsById.set(fact.productId, fact);
    for (const assignment of fact.exerciseCapabilities) {
      addBucket(buckets, 'EXERCISE_CAPABILITY', assignment.capabilityCode, fact.productId, assignment.relationType);
      for (const code of assignment.derivedExerciseSemantics.bodyRegions) addBucket(buckets, 'BODY_REGION', code, fact.productId, assignment.relationType);
      for (const code of assignment.derivedExerciseSemantics.primaryMuscleGroups) addBucket(buckets, 'MUSCLE_GROUP', code, fact.productId, assignment.relationType);
      for (const code of assignment.derivedExerciseSemantics.secondaryMuscleGroups) addBucket(buckets, 'MUSCLE_GROUP', code, fact.productId, assignment.relationType);
      for (const code of assignment.derivedExerciseSemantics.trainingPatterns) addBucket(buckets, 'TRAINING_PATTERN', code, fact.productId, assignment.relationType);
    }
    for (const assignment of fact.trainingFunctions) addBucket(buckets, 'TRAINING_FUNCTION', assignment.functionCode, fact.productId, assignment.relationType);
  }
}

function buildIndex(
  productMetadata: ProductSemanticActiveSnapshotMetadata | null,
  productFacts: readonly ProductFact[],
  trainingMetadata: TrainingSemanticSnapshotV2Metadata | null,
  trainingFacts: readonly TrainingFact[],
): CombinedIndex {
  const buckets = new Map<string, Set<number>>();
  const productFactsById = new Map<number, ProductFact>();
  const trainingFactsById = new Map<number, TrainingFact>();
  if (productMetadata) addProductFacts(buckets, productFactsById, productFacts);
  if (trainingMetadata) addTrainingFacts(buckets, trainingFactsById, trainingFacts);
  return {
    productSnapshotId: productMetadata?.snapshotId ?? null,
    productSemanticChecksum: productMetadata?.semanticChecksum ?? null,
    productOntologyHash: productMetadata?.ontologyHash ?? null,
    trainingSnapshotId: trainingMetadata?.snapshotId ?? null,
    trainingSemanticChecksum: trainingMetadata?.semanticChecksum ?? null,
    trainingRegistryHash: trainingMetadata?.registryHash ?? null,
    productFactsById,
    trainingFactsById,
    buckets,
  };
}

function setIntersection(sets: readonly ReadonlySet<number>[]): Set<number> {
  if (sets.length === 0) return new Set();
  const result = new Set([...sets].sort((left, right) => left.size - right.size)[0]);
  for (const value of result) if (sets.some((set) => !set.has(value))) result.delete(value);
  return result;
}

function setUnion(sets: readonly ReadonlySet<number>[]): Set<number> {
  const result = new Set<number>();
  for (const set of sets) for (const value of set) result.add(value);
  return result;
}

function matchingRelations(requirement: SemanticDiscoveryRequirement): readonly Relation[] {
  return requirement.relations ?? defaultRelations(requirement.axis);
}

function matchingProductIds(index: CombinedIndex, requirement: SemanticDiscoveryRequirement): Set<number> {
  if (isProductAxis(requirement.axis)) {
    const codeSets = requirement.codes.map((code) => index.buckets.get(bucketKey(requirement.axis, code)) ?? new Set<number>());
    return requirement.match === 'all' ? setIntersection(codeSets) : setUnion(codeSets);
  }
  const relations = matchingRelations(requirement);
  const codeSets = requirement.codes.map((code) => setUnion(relations.map((relation) => index.buckets.get(bucketKey(requirement.axis, code, relation)) ?? index.buckets.get(bucketKey(requirement.axis, code)) ?? new Set<number>())));
  return requirement.match === 'all' ? setIntersection(codeSets) : setUnion(codeSets);
}

function matchingFact(fact: ProductFact | TrainingFact, requirement: SemanticDiscoveryRequirement): Match | null {
  if (isProductAxis(requirement.axis)) {
    const tags = productTags(fact as ProductFact, requirement.axis as 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT');
    const matchedCodes = requirement.codes.filter((code) => tags.some((tag) => tag.code === code && !isResidualOntologyTag(tag.axis, tag.code, (fact as ProductFact).ontologyVersion as never)));
    if (requirement.match === 'all' ? matchedCodes.length !== requirement.codes.length : matchedCodes.length === 0) return null;
    const confidenceLevels = uniqueSorted(tags.filter((tag) => matchedCodes.includes(tag.code)).map((tag) => tag.confidence));
    return { matchedCodes, relationTypes: [], confidenceLevels };
  }

  const trainingFact = fact as TrainingFact;
  const relations = new Set(matchingRelations(requirement));
  const matchedCodes = requirement.codes.filter((code) => trainingFact.exerciseCapabilities.some((assignment) => {
    if (!relations.has(assignment.relationType)) return false;
    if (requirement.axis === 'EXERCISE_CAPABILITY') return assignment.capabilityCode === code;
    if (requirement.axis === 'BODY_REGION') return assignment.derivedExerciseSemantics.bodyRegions.includes(code as never);
    if (requirement.axis === 'MUSCLE_GROUP') return assignment.derivedExerciseSemantics.primaryMuscleGroups.includes(code as never) || assignment.derivedExerciseSemantics.secondaryMuscleGroups.includes(code as never);
    if (requirement.axis === 'TRAINING_PATTERN') return assignment.derivedExerciseSemantics.trainingPatterns.includes(code as never);
    return trainingFact.trainingFunctions.some((functionAssignment) => functionAssignment.functionCode === code && relations.has(functionAssignment.relationType));
  }));
  if (requirement.axis === 'TRAINING_FUNCTION') {
    const functionMatchedCodes = requirement.codes.filter((code) => trainingFact.trainingFunctions.some((assignment) => assignment.functionCode === code && relations.has(assignment.relationType)));
    if (requirement.match === 'all' ? functionMatchedCodes.length !== requirement.codes.length : functionMatchedCodes.length === 0) return null;
    const relationTypes = new Set<Relation>();
    for (const assignment of trainingFact.trainingFunctions) if (functionMatchedCodes.includes(assignment.functionCode) && relations.has(assignment.relationType)) relationTypes.add(assignment.relationType);
    return { matchedCodes: functionMatchedCodes, relationTypes: relationOrder.filter((relation) => relationTypes.has(relation)), confidenceLevels: [] };
  }
  if (requirement.match === 'all' ? matchedCodes.length !== requirement.codes.length : matchedCodes.length === 0) return null;
  const relationTypes = new Set<Relation>();
  for (const assignment of trainingFact.exerciseCapabilities) {
    if (!relations.has(assignment.relationType)) continue;
    const matches = matchedCodes.some((code) => requirement.axis === 'EXERCISE_CAPABILITY'
      ? assignment.capabilityCode === code
      : requirement.axis === 'BODY_REGION'
        ? assignment.derivedExerciseSemantics.bodyRegions.includes(code as never)
        : requirement.axis === 'MUSCLE_GROUP'
          ? assignment.derivedExerciseSemantics.primaryMuscleGroups.includes(code as never) || assignment.derivedExerciseSemantics.secondaryMuscleGroups.includes(code as never)
          : assignment.derivedExerciseSemantics.trainingPatterns.includes(code as never));
    if (matches) relationTypes.add(assignment.relationType);
  }
  return { matchedCodes, relationTypes: relationOrder.filter((relation) => relationTypes.has(relation)), confidenceLevels: [] };
}

function projectProductFact(fact: ProductFact, metadata: ProductSemanticActiveSnapshotMetadata): PublicSemanticDiscoveryProductFact {
  return {
    productId: Number(fact.productId),
    classificationStatus: fact.classificationStatus,
    primaryProductFamily: fact.primaryProductFamily,
    secondaryProductFamilies: fact.secondaryProductFamilies,
    disciplines: fact.disciplines,
    useContexts: fact.useContexts,
    ontologyVersion: fact.ontologyVersion,
    ontologyHash: fact.ontologyHash,
    classifierVersion: metadata.classifierVersion,
  };
}

function projectTrainingFact(fact: TrainingFact) {
  return {
    productId: fact.productId,
    resolutionState: fact.resolutionState ?? 'SEMANTIC_COMPLETE',
    coverageStatus: fact.coverageStatus,
    exerciseCapabilities: fact.exerciseCapabilities.map((assignment) => ({
      code: assignment.capabilityCode,
      relationType: assignment.relationType,
      classificationConfidence: assignment.classificationConfidence,
      evidence: assignment.evidence,
    })),
    trainingFunctions: fact.trainingFunctions.map((assignment) => ({ code: assignment.functionCode, relationType: assignment.relationType, evidence: assignment.evidence })),
    derived: {
      bodyRegions: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.bodyRegions)),
      primaryMuscleGroups: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.primaryMuscleGroups)),
      secondaryMuscleGroups: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.secondaryMuscleGroups)),
      trainingPatterns: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.trainingPatterns)),
    },
  };
}

function validateRequest(request: ReturnType<typeof semanticDiscoveryRequestSchema.parse>): void {
  const seen = new Set<string>();
  for (const requirement of request.requirements) {
    const allowed = new Set(allowedCodes(requirement.axis));
    for (const code of requirement.codes) if (!allowed.has(code)) throw new InvalidSemanticDiscoveryRequestError(`Unknown code "${code}" for axis ${requirement.axis}`);
    if (new Set(requirement.codes).size !== requirement.codes.length) throw new InvalidSemanticDiscoveryRequestError('Requirement codes must be unique');
    const relations = matchingRelations(requirement);
    if (isProductAxis(requirement.axis) && requirement.relations) throw new InvalidSemanticDiscoveryRequestError(`Relations are not supported for axis ${requirement.axis}`);
    for (const relation of requirement.relations ?? []) if (!semanticDiscoveryRelations.includes(relation) || !relations.includes(relation)) throw new InvalidSemanticDiscoveryRequestError(`Relation "${relation}" is not valid for axis ${requirement.axis}`);
    if (new Set(requirement.relations ?? []).size !== (requirement.relations ?? []).length) throw new InvalidSemanticDiscoveryRequestError('Requirement relations must be unique');
    const signature = JSON.stringify({ axis: requirement.axis, codes: [...requirement.codes].sort(lexical), mode: requirement.mode, match: requirement.match, relations: [...(requirement.relations ?? [])].sort(lexical) });
    if (seen.has(signature)) throw new InvalidSemanticDiscoveryRequestError('Duplicate semantic discovery requirement');
    seen.add(signature);
  }
}

export class DefaultSemanticDiscoveryService implements SemanticDiscoveryService {
  private index: CombinedIndex | null = null;

  constructor(
    private readonly productReader?: ProductReader,
    private readonly trainingReader?: TrainingReader,
  ) {}

  query(rawRequest: unknown): PublicSemanticDiscoveryResponse {
    const startedAt = process.hrtime.bigint();
    const parsed = semanticDiscoveryRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw new InvalidSemanticDiscoveryRequestError('Invalid semantic discovery query', parsed.error.flatten());
    const request = parsed.data;
    validateRequest(request);
    const usesProduct = request.requirements.some((requirement) => isProductAxis(requirement.axis));
    const usesTraining = request.requirements.some((requirement) => isTrainingAxis(requirement.axis));

    let productMetadata: ProductSemanticActiveSnapshotMetadata | null = null;
    let trainingMetadata: TrainingSemanticSnapshotV2Metadata | null = null;
    if (usesProduct) {
      if (!this.productReader) throw new ProductSemanticsUnavailableError();
      try { productMetadata = this.productReader.getActiveSnapshotMetadata(); } catch { throw new ProductSemanticsUnavailableError(); }
      if (!productMetadata) throw new ProductSemanticsUnavailableError();
      if (request.expectedSnapshots.productSemanticSnapshotId !== undefined && request.expectedSnapshots.productSemanticSnapshotId !== productMetadata.snapshotId) throw new ProductSemanticSnapshotMismatchError();
    }
    if (usesTraining) {
      if (!this.trainingReader) throw new TrainingSemanticsUnavailableError();
      try { trainingMetadata = this.trainingReader.getMetadata(); } catch { throw new TrainingSemanticsUnavailableError(); }
      if (!trainingMetadata) throw new TrainingSemanticsUnavailableError();
      if (trainingMetadata.registryHash !== trainingRegistry.registryHash) throw new TrainingSemanticsUnavailableError('Active Training Semantic Snapshot V2 registry lineage is not supported');
      if (request.expectedSnapshots.trainingSemanticSnapshotId !== undefined && request.expectedSnapshots.trainingSemanticSnapshotId !== trainingMetadata.snapshotId) throw new TrainingSemanticSnapshotMismatchError();
    }

    const sameIdentity = this.index && this.index.productSnapshotId === (productMetadata?.snapshotId ?? null)
      && this.index.productSemanticChecksum === (productMetadata?.semanticChecksum ?? null)
      && this.index.productOntologyHash === (productMetadata?.ontologyHash ?? null)
      && this.index.trainingSnapshotId === (trainingMetadata?.snapshotId ?? null)
      && this.index.trainingSemanticChecksum === (trainingMetadata?.semanticChecksum ?? null)
      && this.index.trainingRegistryHash === (trainingMetadata?.registryHash ?? null);
    if (!sameIdentity) {
      try {
        this.index = buildIndex(productMetadata, usesProduct ? this.productReader!.getAllProductSemanticFacts() : [], trainingMetadata, usesTraining ? this.trainingReader!.getAllProductTrainingSemanticFacts() : []);
      } catch {
        if (usesProduct) throw new ProductSemanticsUnavailableError();
        throw new TrainingSemanticsUnavailableError();
      }
    }
    const index = this.index!;
    const required = request.requirements.filter((requirement) => requirement.mode === 'required');
    const preferred = request.requirements.filter((requirement) => requirement.mode === 'preferred');
    const requiredSets = required.map((requirement) => matchingProductIds(index, requirement));
    const preferredSets = preferred.map((requirement) => matchingProductIds(index, requirement));
    const candidates = required.length > 0 ? setIntersection(requiredSets) : setUnion(preferredSets);
    const ranked: { result: PublicSemanticDiscoveryResult; preferredCount: number; directCount: number; confidenceScore: number }[] = [];

    for (const productId of candidates) {
      const productFact = index.productFactsById.get(productId);
      const trainingFact = index.trainingFactsById.get(productId);
      const matchedRequirements: PublicSemanticDiscoveryMatchedRequirement[] = [];
      let valid = true;
      let preferredCount = 0;
      let directCount = 0;
      let confidenceScore = 0;
      for (const requirement of request.requirements) {
        const fact = isProductAxis(requirement.axis) ? productFact : trainingFact;
        const match = fact ? matchingFact(fact, requirement) : null;
        if (!match) {
          if (requirement.mode === 'required') valid = false;
          continue;
        }
        if (requirement.mode === 'preferred') preferredCount += 1;
        if (match.relationTypes.includes('DIRECT') && requirement.axis === 'EXERCISE_CAPABILITY') directCount += 1;
        confidenceScore += match.confidenceLevels.filter((level) => level === 'EXPLICIT').length * 2 + match.confidenceLevels.filter((level) => level === 'STRONGLY_INFERRED').length;
        matchedRequirements.push({
          axis: requirement.axis,
          requestedCodes: requirement.codes,
          matchedCodes: match.matchedCodes,
          source: sourceFor(requirement.axis),
          mode: requirement.mode,
          match: requirement.match,
          ...(match.relationTypes.length > 0 ? { relationTypes: match.relationTypes } : {}),
          ...(match.confidenceLevels.length > 0 ? { confidenceLevels: match.confidenceLevels } : {}),
          reason: requirement.mode === 'required' ? 'required_match' : 'preferred_match',
        });
      }
      if (!valid) continue;
      ranked.push({
        result: {
          productId,
          matchedRequirements,
          productSemantics: productFact && productMetadata ? projectProductFact(productFact, productMetadata) : null,
          trainingSemantics: trainingFact ? projectTrainingFact(trainingFact) : null,
        },
        preferredCount,
        directCount,
        confidenceScore,
      });
    }

    ranked.sort((left, right) => right.preferredCount - left.preferredCount || right.directCount - left.directCount || right.confidenceScore - left.confidenceScore || left.result.productId - right.result.productId);
    const totalMatches = ranked.length;
    const results = ranked.slice(0, request.options.limit).map((entry) => entry.result);
    const truncated = totalMatches > results.length;
    const response: PublicSemanticDiscoveryResponse = {
      schemaVersion: 1,
      lineage: {
        productSemantics: productMetadata ? { snapshotId: productMetadata.snapshotId, semanticChecksum: productMetadata.semanticChecksum, ontologyVersion: productMetadata.ontologyVersion, ontologyHash: productMetadata.ontologyHash, classifierVersion: productMetadata.classifierVersion } : null,
        trainingSemantics: trainingMetadata ? { snapshotId: trainingMetadata.snapshotId, semanticChecksum: trainingMetadata.semanticChecksum, registryVersion: trainingMetadata.registryVersion, registryHash: trainingMetadata.registryHash, classifierVersion: trainingMetadata.classifierVersion, rulesHash: trainingMetadata.rulesHash ?? trainingMetadata.classifierV2RulesHash } : null,
      },
      query: { requirements: request.requirements, options: request.options },
      results,
      totalMatches,
      truncated,
    };
    const axes = uniqueSorted(request.requirements.map((requirement) => requirement.axis)).join(',');
    const sources = uniqueSorted(request.requirements.map((requirement) => sourceFor(requirement.axis))).join(',');
    semanticDiscoveryRequestsTotal.inc({ axes, sources, productSnapshotId: productMetadata?.snapshotId ?? 'none', trainingSnapshotId: trainingMetadata?.snapshotId ?? 'none', requirementCount: String(request.requirements.length), candidateCount: String(candidates.size), resultCount: String(results.length), truncated: String(truncated) });
    semanticDiscoveryDurationSeconds.observe({ productSnapshotId: productMetadata?.snapshotId ?? 'none', trainingSnapshotId: trainingMetadata?.snapshotId ?? 'none' }, Number(process.hrtime.bigint() - startedAt) / 1e9);
    return response;
  }
}

export const defaultSemanticDiscoveryServiceFactory = (productReader?: ProductReader, trainingReader?: TrainingReader): SemanticDiscoveryService => new DefaultSemanticDiscoveryService(productReader, trainingReader);
