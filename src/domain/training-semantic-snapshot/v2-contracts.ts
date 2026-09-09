import { z } from 'zod';
import {
  exerciseCapabilityCodesV2,
  trainingFunctionCodesV2,
  trainingFunctionEvidenceKinds,
  trainingFunctionRelationTypes,
  trainingSemanticRegistryV2Version,
  type TrainingFunctionCode,
  type DerivedExerciseSemanticsV2,
} from '../training-semantics-v2/index.js';
import { trainingClassificationConfidenceLevels, trainingReviewStates, trainingSemanticEvidenceKinds, trainingRelationTypes } from '../training-semantics/contracts.js';
import type { TrainingSemanticSnapshot } from './contracts.js';

export const trainingSemanticSnapshotV2SchemaVersion = '2' as const;
export type TrainingSemanticSnapshotV2SchemaVersion = typeof trainingSemanticSnapshotV2SchemaVersion;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const snapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const trainingSemanticResolutionStates = [
  'SEMANTIC_COMPLETE', 'VERIFIED_NO_APPLICABLE_CAPABILITY', 'DATA_GAP', 'AMBIGUOUS',
  'NEEDS_REVIEW', 'SEMANTIC_PARTIAL', 'ONTOLOGY_GAP', 'RULE_GAP',
] as const;
export type TrainingSemanticResolutionState = (typeof trainingSemanticResolutionStates)[number];

export const trainingSemanticSnapshotV2ExerciseCapabilityAssignmentSchema = z.object({
  capabilityCode: z.enum(exerciseCapabilityCodesV2),
  relationType: z.enum(trainingRelationTypes),
  classificationConfidence: z.enum(trainingClassificationConfidenceLevels),
  evidence: z.array(z.object({
    kind: z.enum(trainingSemanticEvidenceKinds),
    sourceId: z.string().trim().min(1).optional(),
    matchedText: z.string().optional(),
    ruleId: z.string().trim().min(1).optional(),
    note: z.string().optional(),
  }).strict()).min(1),
  reviewState: z.enum(trainingReviewStates),
  moduleId: z.string().trim().min(1).optional(),
  modifierCodes: z.array(z.string().trim().min(1)).optional(),
  provenance: z.object({
    classifierVersion: z.string().trim().min(1).optional(),
    sourceCatalogExport: z.string().trim().min(1).optional(),
    sourceProductSemanticSnapshotId: snapshotIdSchema.optional(),
    overrideId: z.string().trim().min(1).optional(),
  }).strict().optional(),
}).strict();

export const trainingSemanticSnapshotV2TrainingFunctionAssignmentSchema = z.object({
  functionCode: z.enum(trainingFunctionCodesV2),
  relationType: z.enum(trainingFunctionRelationTypes),
  productFamily: z.string().trim().min(1).optional(),
  classificationConfidence: z.enum(trainingClassificationConfidenceLevels),
  evidence: z.array(z.object({
    kind: z.enum(trainingFunctionEvidenceKinds),
    sourceId: z.string().trim().min(1).optional(),
    matchedText: z.string().optional(),
    ruleId: z.string().trim().min(1).optional(),
    note: z.string().optional(),
  }).strict()).min(1),
  reviewState: z.enum(trainingReviewStates),
  provenance: z.object({
    classifierVersion: z.string().trim().min(1).optional(),
    sourceCatalogExport: z.string().trim().min(1).optional(),
    sourceProductSemanticSnapshotId: snapshotIdSchema.optional(),
    overrideId: z.string().trim().min(1).optional(),
  }).strict().optional(),
}).strict();

export const trainingSemanticSnapshotV2RecordSchema = z.object({
  productId: z.number().int().positive(),
  exerciseCapabilities: z.array(trainingSemanticSnapshotV2ExerciseCapabilityAssignmentSchema),
  trainingFunctions: z.array(trainingSemanticSnapshotV2TrainingFunctionAssignmentSchema),
  coverageStatus: z.enum(['NO_CAPABILITY_APPLICABLE', 'UNMODELED', 'INSUFFICIENT_EVIDENCE', 'NEEDS_REVIEW']),
  resolutionState: z.enum(trainingSemanticResolutionStates).optional(),
  resolutionEvidence: z.array(z.object({ kind: z.string().trim().min(1), sourceId: z.string().trim().min(1).optional(), note: z.string().trim().min(1).optional() }).strict()).optional(),
  resolved: z.boolean().optional(),
  activeTrainingRelevant: z.boolean().optional(),
  warnings: z.array(z.string().trim().min(1)),
}).strict();

export const trainingSemanticSnapshotV2CountsSchema = z.object({
  sourceProducts: z.number().int().nonnegative(),
  productsWithExerciseCapabilities: z.number().int().nonnegative(),
  productsWithTrainingFunctions: z.number().int().nonnegative(),
  exerciseCapabilityAssignmentCount: z.number().int().nonnegative(),
  trainingFunctionAssignmentCount: z.number().int().nonnegative(),
  exerciseAssignmentCount: z.number().int().nonnegative().optional(),
  v1AssignmentsPreserved: z.number().int().nonnegative().optional(),
  activeTrainingRelevant: z.number().int().nonnegative().optional(),
  resolvedActiveTrainingRelevant: z.number().int().nonnegative().optional(),
  resolutionRate: z.number().min(0).max(100).optional(),
  resolvedCount: z.number().int().nonnegative().optional(),
  unresolvedCount: z.number().int().nonnegative().optional(),
  resolutionStateCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  coverageStateCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  assignmentCountsByExerciseCapability: z.record(z.string(), z.number().int().nonnegative()).optional(),
  assignmentCountsByTrainingFunction: z.record(z.string(), z.number().int().nonnegative()).optional(),
  v1ExerciseCapabilityAssignmentsPreserved: z.number().int().nonnegative().optional(),
  v2NewExerciseCapabilityAssignments: z.number().int().nonnegative().optional(),
  existingRuleClosureAssignments: z.number().int().nonnegative().optional(),
  totalExerciseCapabilityAssignments: z.number().int().nonnegative().optional(),
  totalTrainingFunctionAssignments: z.number().int().nonnegative().optional(),
  multiCapabilityProducts: z.number().int().nonnegative().optional(),
  multiFunctionProducts: z.number().int().nonnegative().optional(),
}).strict();

export const trainingSemanticSnapshotV2Schema = z.object({
  schemaVersion: z.literal(trainingSemanticSnapshotV2SchemaVersion),
  snapshotId: snapshotIdSchema,
  registryVersion: z.literal(trainingSemanticRegistryV2Version),
  registryHash: hashSchema,
  classifierVersion: z.string().trim().min(1),
  classifierV2RulesHash: hashSchema,
  rulesHash: hashSchema.optional(),
  semanticChecksum: hashSchema,
  sourceV1SnapshotId: snapshotIdSchema,
  generatedAt: z.string().datetime({ offset: true }),
  activatedAt: z.string().datetime({ offset: true }).optional(),
  counts: trainingSemanticSnapshotV2CountsSchema,
  records: z.array(trainingSemanticSnapshotV2RecordSchema),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.counts.sourceProducts !== snapshot.records.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['counts', 'sourceProducts'], message: 'sourceProducts must equal records.length' });
  }
});

export type TrainingSemanticSnapshotV2ExerciseCapabilityAssignment = z.infer<typeof trainingSemanticSnapshotV2ExerciseCapabilityAssignmentSchema>;
export type TrainingSemanticSnapshotV2TrainingFunctionAssignment = z.infer<typeof trainingSemanticSnapshotV2TrainingFunctionAssignmentSchema> & { readonly functionCode: TrainingFunctionCode };
export type TrainingSemanticSnapshotV2Record = z.infer<typeof trainingSemanticSnapshotV2RecordSchema>;
export type TrainingSemanticSnapshotV2Counts = z.infer<typeof trainingSemanticSnapshotV2CountsSchema>;
export type TrainingSemanticSnapshotV2 = z.infer<typeof trainingSemanticSnapshotV2Schema>;

export type TrainingSemanticSnapshotV2BuildParameters = {
  readonly sourceProductCount: number;
  readonly sourceV1SnapshotId: string;
  readonly sourceV1Snapshot: TrainingSemanticSnapshot;
  readonly resolutionStates?: ReadonlyMap<number, TrainingSemanticResolutionState> | Readonly<Record<number, TrainingSemanticResolutionState>>;
  readonly resolutionEvidence?: ReadonlyMap<number, readonly { readonly kind: string; readonly sourceId?: string; readonly note?: string }[]>;
  readonly activeTrainingRelevant?: number;
  readonly activeTrainingRelevantProductIds?: readonly number[];
  readonly acceptedResolvedCount?: number;
  readonly acceptedResolutionStates?: Readonly<Record<string, number>>;
  readonly generatedAt?: string;
};

export type TrainingSemanticSnapshotV2Metadata = Omit<TrainingSemanticSnapshotV2, 'records'>;
export type TrainingSemanticRuntimeV2Fact = Omit<TrainingSemanticSnapshotV2Record, 'exerciseCapabilities'> & {
  readonly exerciseCapabilities: readonly (TrainingSemanticSnapshotV2ExerciseCapabilityAssignment & { readonly derivedExerciseSemantics: DerivedExerciseSemanticsV2 })[];
};
export type TrainingSemanticSnapshotV2SaveResult = { readonly status: 'created' | 'already_exists'; readonly snapshotId: string };
export interface TrainingSemanticSnapshotV2Store { save(snapshot: TrainingSemanticSnapshotV2): Promise<TrainingSemanticSnapshotV2SaveResult>; activate(snapshotId: string): Promise<void>; getById(snapshotId: string): Promise<TrainingSemanticSnapshotV2 | null>; getActive(): Promise<TrainingSemanticSnapshotV2 | null>; }
export interface ActiveTrainingSemanticSnapshotV2Reader { refresh(): Promise<{ readonly status: 'loaded' | 'unchanged' | 'cleared'; readonly previousSnapshotId: string | null; readonly activeSnapshotId: string | null }>; getMetadata(): TrainingSemanticSnapshotV2Metadata | null; hasProduct(productId: number): boolean; getProductTrainingSemanticFact(productId: number): TrainingSemanticRuntimeV2Fact | null; getAllProductTrainingSemanticFacts(): readonly TrainingSemanticRuntimeV2Fact[]; }

// Explicit aliases make the future contract discoverable without changing the V1 schema exports.
export const trainingSemanticSnapshotSchemaV2 = trainingSemanticSnapshotV2Schema;
export const trainingSemanticSnapshotRecordSchemaV2 = trainingSemanticSnapshotV2RecordSchema;
