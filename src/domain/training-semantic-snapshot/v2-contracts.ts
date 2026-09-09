import { z } from 'zod';
import {
  exerciseCapabilityCodesV2,
  trainingFunctionCodesV2,
  trainingFunctionEvidenceKinds,
  trainingFunctionRelationTypes,
  trainingSemanticRegistryV2Version,
  type TrainingFunctionCode,
} from '../training-semantics-v2/index.js';
import { trainingClassificationConfidenceLevels, trainingReviewStates, trainingSemanticEvidenceKinds, trainingRelationTypes } from '../training-semantics/contracts.js';

export const trainingSemanticSnapshotV2SchemaVersion = '2' as const;
export type TrainingSemanticSnapshotV2SchemaVersion = typeof trainingSemanticSnapshotV2SchemaVersion;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const snapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

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
}).strict();

export const trainingSemanticSnapshotV2RecordSchema = z.object({
  productId: z.number().int().positive(),
  exerciseCapabilities: z.array(trainingSemanticSnapshotV2ExerciseCapabilityAssignmentSchema),
  trainingFunctions: z.array(trainingSemanticSnapshotV2TrainingFunctionAssignmentSchema),
  coverageStatus: z.enum(['NO_CAPABILITY_APPLICABLE', 'UNMODELED', 'INSUFFICIENT_EVIDENCE', 'NEEDS_REVIEW']),
  warnings: z.array(z.string().trim().min(1)),
}).strict();

export const trainingSemanticSnapshotV2CountsSchema = z.object({
  sourceProducts: z.number().int().nonnegative(),
  productsWithExerciseCapabilities: z.number().int().nonnegative(),
  productsWithTrainingFunctions: z.number().int().nonnegative(),
  exerciseCapabilityAssignmentCount: z.number().int().nonnegative(),
  trainingFunctionAssignmentCount: z.number().int().nonnegative(),
}).strict();

export const trainingSemanticSnapshotV2Schema = z.object({
  schemaVersion: z.literal(trainingSemanticSnapshotV2SchemaVersion),
  snapshotId: snapshotIdSchema,
  registryVersion: z.literal(trainingSemanticRegistryV2Version),
  registryHash: hashSchema,
  classifierVersion: z.string().trim().min(1),
  classifierV2RulesHash: hashSchema,
  semanticChecksum: hashSchema,
  sourceV1SnapshotId: snapshotIdSchema,
  generatedAt: z.string().datetime({ offset: true }),
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

// Explicit aliases make the future contract discoverable without changing the V1 schema exports.
export const trainingSemanticSnapshotSchemaV2 = trainingSemanticSnapshotV2Schema;
export const trainingSemanticSnapshotRecordSchemaV2 = trainingSemanticSnapshotV2RecordSchema;

