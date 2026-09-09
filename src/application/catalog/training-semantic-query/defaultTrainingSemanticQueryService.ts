import { getTrainingSemanticRegistryV2, type TrainingSemanticRegistryV2 } from '../../../domain/training-semantics-v2/index.js';
import type {
  ActiveTrainingSemanticSnapshotV2Reader,
  TrainingSemanticRuntimeV2Fact,
  TrainingSemanticSnapshotV2Metadata,
} from '../../../domain/training-semantic-snapshot/index.js';
import { InvalidTrainingSemanticRequestError, TrainingSemanticSnapshotMismatchError, TrainingSemanticsUnavailableError } from '../../../shared/errors.js';
import { trainingSemanticQueryDurationSeconds, trainingSemanticQueryRequestsTotal } from '../../../shared/metrics.js';
import {
  trainingSemanticQueryRequestSchema,
  type PublicTrainingSemanticQueryDerived,
  type PublicTrainingSemanticQueryEvidence,
  type PublicTrainingSemanticQueryExerciseCapability,
  type PublicTrainingSemanticQueryFunction,
  type PublicTrainingSemanticQueryLineage,
  type PublicTrainingSemanticQueryMatchedRequirement,
  type PublicTrainingSemanticQueryResponse,
  type PublicTrainingSemanticQueryResult,
  type TrainingSemanticQueryRequirement,
  type TrainingSemanticQueryService,
} from './contracts.js';

type QueryReader = Pick<ActiveTrainingSemanticSnapshotV2Reader, 'getMetadata' | 'getAllProductTrainingSemanticFacts'>;
type Fact = TrainingSemanticRuntimeV2Fact;
type Axis = TrainingSemanticQueryRequirement['axis'];
type Relation = 'DIRECT' | 'SUPPORTED' | 'FAMILY_DERIVED';

type QueryIndex = {
  readonly snapshotId: string;
  readonly registryHash: string;
  readonly factsByProductId: ReadonlyMap<number, Fact>;
  readonly buckets: ReadonlyMap<string, ReadonlySet<number>>;
};

const relationOrder: readonly Relation[] = ['DIRECT', 'SUPPORTED', 'FAMILY_DERIVED'];
const supportedExerciseRelations: readonly Relation[] = ['DIRECT', 'SUPPORTED'];
const supportedFunctionRelations: readonly Relation[] = ['DIRECT', 'FAMILY_DERIVED'];
const supportedDerivedRelations: readonly Relation[] = ['DIRECT', 'SUPPORTED'];

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(lexical);
}

function lineage(metadata: TrainingSemanticSnapshotV2Metadata): PublicTrainingSemanticQueryLineage {
  return {
    snapshotId: metadata.snapshotId,
    semanticChecksum: metadata.semanticChecksum,
    registryVersion: metadata.registryVersion,
    registryHash: metadata.registryHash,
    classifierVersion: metadata.classifierVersion,
    rulesHash: metadata.rulesHash ?? metadata.classifierV2RulesHash,
  };
}

function evidence(value: { readonly kind: string; readonly sourceId?: string; readonly matchedText?: string; readonly ruleId?: string; readonly note?: string }): PublicTrainingSemanticQueryEvidence {
  return {
    kind: value.kind,
    ...(value.sourceId !== undefined ? { sourceId: value.sourceId } : {}),
    ...(value.matchedText !== undefined ? { matchedText: value.matchedText } : {}),
    ...(value.ruleId !== undefined ? { ruleId: value.ruleId } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
  };
}

function addBucket(buckets: Map<string, Set<number>>, axis: Axis, code: string, relation: Relation, productId: number): void {
  const key = `${axis}\u0000${code}\u0000${relation}`;
  const bucket = buckets.get(key) ?? new Set<number>();
  bucket.add(productId);
  buckets.set(key, bucket);
}

function addAssignmentBuckets(buckets: Map<string, Set<number>>, fact: Fact, productId: number, registry: TrainingSemanticRegistryV2): void {
  for (const assignment of fact.exerciseCapabilities) {
    addBucket(buckets, 'EXERCISE_CAPABILITY', assignment.capabilityCode, assignment.relationType, productId);
    for (const code of assignment.derivedExerciseSemantics.bodyRegions) addBucket(buckets, 'BODY_REGION', code, assignment.relationType, productId);
    for (const code of assignment.derivedExerciseSemantics.primaryMuscleGroups) addBucket(buckets, 'MUSCLE_GROUP', code, assignment.relationType, productId);
    for (const code of assignment.derivedExerciseSemantics.secondaryMuscleGroups) addBucket(buckets, 'MUSCLE_GROUP', code, assignment.relationType, productId);
    for (const code of assignment.derivedExerciseSemantics.trainingPatterns) addBucket(buckets, 'TRAINING_PATTERN', code, assignment.relationType, productId);
  }
  for (const assignment of fact.trainingFunctions) {
    // Registry validation owns the function relation policy. This guard keeps
    // the query index from accepting a future assignment relation accidentally.
    const definition = registry.trainingFunctions.find((candidate) => candidate.code === assignment.functionCode);
    if (definition?.allowedRelationTypes.includes(assignment.relationType)) addBucket(buckets, 'TRAINING_FUNCTION', assignment.functionCode, assignment.relationType, productId);
  }
}

function buildIndex(metadata: TrainingSemanticSnapshotV2Metadata, facts: readonly Fact[], registry: TrainingSemanticRegistryV2): QueryIndex {
  const buckets = new Map<string, Set<number>>();
  const factsByProductId = new Map<number, Fact>();
  for (const fact of facts) {
    // Semantic completeness is the eligibility boundary. In particular,
    // unresolved records are never made eligible by lexical or fallback logic.
    if (fact.resolutionState !== 'SEMANTIC_COMPLETE') continue;
    factsByProductId.set(fact.productId, fact);
    addAssignmentBuckets(buckets, fact, fact.productId, registry);
  }
  return { snapshotId: metadata.snapshotId, registryHash: metadata.registryHash, factsByProductId, buckets };
}

function intersection(sets: readonly ReadonlySet<number>[]): Set<number> {
  if (sets.length === 0) return new Set();
  const sorted = [...sets].sort((left, right) => left.size - right.size);
  const result = new Set(sorted[0]);
  for (const value of result) if (sorted.some((set) => !set.has(value))) result.delete(value);
  return result;
}

function union(sets: readonly ReadonlySet<number>[]): Set<number> {
  const result = new Set<number>();
  for (const set of sets) for (const value of set) result.add(value);
  return result;
}

function matchingRelations(requirement: TrainingSemanticQueryRequirement): readonly Relation[] {
  if (requirement.relations) return requirement.relations;
  if (requirement.axis === 'TRAINING_FUNCTION') return supportedFunctionRelations;
  if (requirement.axis === 'EXERCISE_CAPABILITY' || requirement.axis === 'BODY_REGION' || requirement.axis === 'MUSCLE_GROUP' || requirement.axis === 'TRAINING_PATTERN') return requirement.axis === 'EXERCISE_CAPABILITY' ? supportedExerciseRelations : supportedDerivedRelations;
  return relationOrder;
}

function matchingProductIds(index: QueryIndex, requirement: TrainingSemanticQueryRequirement): Set<number> {
  const relations = matchingRelations(requirement);
  const codeSets = requirement.codes.map((code) => union(relations.map((relation) => index.buckets.get(`${requirement.axis}\u0000${code}\u0000${relation}`) ?? new Set<number>())));
  return requirement.match === 'all' ? intersection(codeSets) : union(codeSets);
}

function matchingAssignments(fact: Fact, requirement: TrainingSemanticQueryRequirement): {
  readonly matchedCodes: readonly string[];
  readonly relationTypes: readonly Relation[];
} | null {
  const relations = new Set(matchingRelations(requirement));
  const matchedCodes = requirement.codes.filter((code) => {
    if (requirement.axis === 'TRAINING_FUNCTION') return fact.trainingFunctions.some((assignment) => assignment.functionCode === code && relations.has(assignment.relationType));
    return fact.exerciseCapabilities.some((assignment) => {
      if (!relations.has(assignment.relationType)) return false;
      if (requirement.axis === 'EXERCISE_CAPABILITY') return assignment.capabilityCode === code;
      if (requirement.axis === 'BODY_REGION') return assignment.derivedExerciseSemantics.bodyRegions.includes(code as never);
      if (requirement.axis === 'MUSCLE_GROUP') return assignment.derivedExerciseSemantics.primaryMuscleGroups.includes(code as never) || assignment.derivedExerciseSemantics.secondaryMuscleGroups.includes(code as never);
      return assignment.derivedExerciseSemantics.trainingPatterns.includes(code as never);
    });
  });
  if (requirement.match === 'all' ? matchedCodes.length !== requirement.codes.length : matchedCodes.length === 0) return null;

  const relationTypes = new Set<Relation>();
  if (requirement.axis === 'TRAINING_FUNCTION') {
    for (const assignment of fact.trainingFunctions) {
      if (relations.has(assignment.relationType) && matchedCodes.includes(assignment.functionCode)) relationTypes.add(assignment.relationType);
    }
  } else {
    for (const assignment of fact.exerciseCapabilities) {
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
  }
  return { matchedCodes, relationTypes: relationOrder.filter((relation) => relationTypes.has(relation)) };
}

function projectFact(fact: Fact): Pick<PublicTrainingSemanticQueryResult, 'exerciseCapabilities' | 'trainingFunctions' | 'derived'> {
  const exerciseCapabilities: PublicTrainingSemanticQueryExerciseCapability[] = [...fact.exerciseCapabilities]
    .sort((left, right) => lexical(left.capabilityCode, right.capabilityCode) || lexical(left.relationType, right.relationType))
    .map((assignment) => ({ code: assignment.capabilityCode, relationType: assignment.relationType, classificationConfidence: assignment.classificationConfidence, evidence: assignment.evidence.map(evidence) }));
  const trainingFunctions: PublicTrainingSemanticQueryFunction[] = [...fact.trainingFunctions]
    .sort((left, right) => lexical(left.functionCode, right.functionCode) || lexical(left.relationType, right.relationType))
    .map((assignment) => ({ code: assignment.functionCode, relationType: assignment.relationType, evidence: assignment.evidence.map(evidence) }));
  const derived: PublicTrainingSemanticQueryDerived = {
    bodyRegions: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.bodyRegions)),
    primaryMuscleGroups: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.primaryMuscleGroups)),
    secondaryMuscleGroups: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.secondaryMuscleGroups)),
    trainingPatterns: uniqueSorted(fact.exerciseCapabilities.flatMap((assignment) => assignment.derivedExerciseSemantics.trainingPatterns)),
  };
  return { exerciseCapabilities, trainingFunctions, derived };
}

function validateRequirementRelations(requirement: TrainingSemanticQueryRequirement): void {
  const allowed = new Set(matchingRelations({ ...requirement, relations: undefined }));
  for (const relation of requirement.relations ?? []) if (!allowed.has(relation)) throw new InvalidTrainingSemanticRequestError(`Relation "${relation}" is not valid for axis ${requirement.axis}`);
}

function validateRequirementCodes(requirement: TrainingSemanticQueryRequirement, registry: TrainingSemanticRegistryV2): void {
  const allowed = requirement.axis === 'EXERCISE_CAPABILITY'
    ? registry.exerciseCapabilities.map((definition) => definition.code)
    : requirement.axis === 'TRAINING_FUNCTION'
      ? registry.trainingFunctions.map((definition) => definition.code)
      : requirement.axis === 'BODY_REGION'
        ? registry.bodyRegions
        : requirement.axis === 'MUSCLE_GROUP'
          ? registry.muscleGroups
          : registry.trainingPatterns;
  const allowedCodes = new Set<string>(allowed);
  for (const code of requirement.codes) if (!allowedCodes.has(code)) throw new InvalidTrainingSemanticRequestError(`Unknown code "${code}" for axis ${requirement.axis}`);
}

export class DefaultTrainingSemanticQueryService implements TrainingSemanticQueryService {
  private index: QueryIndex | null = null;

  constructor(
    private readonly reader: QueryReader,
    private readonly registry: TrainingSemanticRegistryV2 = getTrainingSemanticRegistryV2(),
  ) {}

  query(rawRequest: unknown): PublicTrainingSemanticQueryResponse {
    const startedAt = process.hrtime.bigint();
    const parsed = trainingSemanticQueryRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw new InvalidTrainingSemanticRequestError('Invalid training semantic query', parsed.error.flatten());
    const request = parsed.data;
    const signatures = new Set<string>();
    for (const requirement of request.requirements) {
      validateRequirementCodes(requirement, this.registry);
      validateRequirementRelations(requirement);
      const signature = JSON.stringify({ axis: requirement.axis, codes: [...requirement.codes].sort(lexical), mode: requirement.mode, match: requirement.match, relations: [...(requirement.relations ?? [])].sort(lexical) });
      if (signatures.has(signature)) throw new InvalidTrainingSemanticRequestError('Duplicate training semantic requirement');
      signatures.add(signature);
    }

    const metadata = this.reader.getMetadata();
    if (!metadata) throw new TrainingSemanticsUnavailableError();
    if (request.expectedSnapshotId !== undefined && request.expectedSnapshotId !== metadata.snapshotId) throw new TrainingSemanticSnapshotMismatchError();
    if (metadata.registryHash !== this.registry.registryHash) throw new TrainingSemanticsUnavailableError('Active Training Semantic Snapshot V2 registry lineage is not supported');
    if (!this.index || this.index.snapshotId !== metadata.snapshotId || this.index.registryHash !== metadata.registryHash) {
      try {
        this.index = buildIndex(metadata, this.reader.getAllProductTrainingSemanticFacts(), this.registry);
      } catch {
        throw new TrainingSemanticsUnavailableError();
      }
    }

    const index = this.index;
    const required = request.requirements.filter((requirement) => requirement.mode === 'required');
    const preferred = request.requirements.filter((requirement) => requirement.mode === 'preferred');
    const requiredSets = required.map((requirement) => matchingProductIds(index, requirement));
    const preferredSets = preferred.map((requirement) => matchingProductIds(index, requirement));
    const candidates = required.length > 0 ? intersection(requiredSets) : union(preferredSets);
    const ranked: { result: PublicTrainingSemanticQueryResult; preferredCount: number; directCount: number }[] = [];

    for (const productId of candidates) {
      const fact = index.factsByProductId.get(productId);
      if (!fact) continue;
      const matchedRequirements: PublicTrainingSemanticQueryMatchedRequirement[] = [];
      let preferredCount = 0;
      let directCount = 0;
      let valid = true;
      for (const requirement of request.requirements) {
        const match = matchingAssignments(fact, requirement);
        if (!match) {
          if (requirement.mode === 'required') valid = false;
          continue;
        }
        if (requirement.mode === 'preferred') preferredCount += 1;
        if (match.relationTypes.includes('DIRECT')) directCount += 1;
        matchedRequirements.push({ axis: requirement.axis, codes: requirement.codes, matchedCodes: match.matchedCodes, relationTypes: match.relationTypes, mode: requirement.mode, match: requirement.match, reason: requirement.mode === 'required' ? 'required_match' : 'preferred_match' });
      }
      if (!valid) continue;
      const projected = projectFact(fact);
      ranked.push({ result: { productId, resolutionState: fact.resolutionState ?? 'SEMANTIC_COMPLETE', coverageStatus: fact.coverageStatus, matchedRequirements, ...projected }, preferredCount, directCount });
    }

    ranked.sort((left, right) => right.preferredCount - left.preferredCount || right.directCount - left.directCount || left.result.productId - right.result.productId);
    const totalMatches = ranked.length;
    const results = ranked.slice(0, request.options.limit).map((entry) => entry.result);
    const truncated = totalMatches > results.length;
    const response: PublicTrainingSemanticQueryResponse = {
      schemaVersion: 1,
      lineage: lineage(metadata),
      query: { requirements: request.requirements, options: request.options },
      results,
      totalMatches,
      truncated,
    };
    const labels = { snapshotId: metadata.snapshotId, requirementCount: String(request.requirements.length), resultCount: String(results.length), truncated: String(truncated) };
    trainingSemanticQueryRequestsTotal.inc(labels);
    trainingSemanticQueryDurationSeconds.observe({ snapshotId: metadata.snapshotId }, Number(process.hrtime.bigint() - startedAt) / 1e9);
    return response;
  }
}

export const defaultTrainingSemanticQueryServiceFactory = (reader: QueryReader): TrainingSemanticQueryService => new DefaultTrainingSemanticQueryService(reader);
