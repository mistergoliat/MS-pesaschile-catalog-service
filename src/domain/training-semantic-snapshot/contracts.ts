import { z } from 'zod';
import {
  trainingCapabilityCodes,
  trainingClassificationConfidenceLevels,
  trainingCoverageStatuses,
  trainingRelationTypes,
  trainingReviewStates,
  trainingSemanticEvidenceKinds,
  type DerivedTrainingSemantics,
} from '../training-semantics/index.js';
import type { TrainingSemanticClassificationResult } from '../training-semantic-classification/contracts.js';

export const trainingSemanticSnapshotSchemaVersion = '1' as const;
export type TrainingSemanticSnapshotSchemaVersion = typeof trainingSemanticSnapshotSchemaVersion;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const capabilitySchema = z.enum(trainingCapabilityCodes);
const relationSchema = z.enum(trainingRelationTypes);
const confidenceSchema = z.enum(trainingClassificationConfidenceLevels);
const reviewStateSchema = z.enum(trainingReviewStates);
const coverageSchema = z.enum(trainingCoverageStatuses);

export const trainingSemanticSnapshotEvidenceSchema = z.object({
  kind: z.enum(trainingSemanticEvidenceKinds),
  sourceId: z.string().trim().min(1).optional(),
  matchedText: z.string().optional(),
  ruleId: z.string().trim().min(1).optional(),
  note: z.string().optional(),
}).strict();

export const trainingSemanticSnapshotAssignmentSchema = z.object({
  capabilityCode: capabilitySchema,
  relationType: relationSchema,
  classificationConfidence: confidenceSchema,
  evidence: z.array(trainingSemanticSnapshotEvidenceSchema).min(1),
  reviewState: reviewStateSchema,
  moduleId: z.string().trim().min(1).optional(),
  modifierCodes: z.array(z.string().trim().min(1)).optional(),
}).strict();

export const trainingSemanticSnapshotRecordSchema = z.object({
  productId: z.number().int().positive(),
  assignments: z.array(trainingSemanticSnapshotAssignmentSchema),
  coverageStatus: coverageSchema,
  warnings: z.array(z.string().trim().min(1)),
}).strict();

const allCountSchema = z.record(z.string(), z.number().int().nonnegative());

export const trainingSemanticSnapshotCountsSchema = z.object({
  sourceProducts: z.number().int().nonnegative(),
  productsWithAssignments: z.number().int().nonnegative(),
  productsWithoutAssignments: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
  directAssignments: z.number().int().nonnegative(),
  supportedAssignments: z.number().int().nonnegative(),
  multiAssignmentProducts: z.number().int().nonnegative(),
  coverageCounts: z.object({
    NO_CAPABILITY_APPLICABLE: z.number().int().nonnegative(),
    UNMODELED: z.number().int().nonnegative(),
    INSUFFICIENT_EVIDENCE: z.number().int().nonnegative(),
    NEEDS_REVIEW: z.number().int().nonnegative(),
  }).strict(),
  assignmentCountsByCapability: allCountSchema,
}).strict();

export const trainingSemanticSnapshotSchema = z.object({
  schemaVersion: z.literal(trainingSemanticSnapshotSchemaVersion),
  snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  registryVersion: z.string().trim().min(1),
  registryHash: hashSchema,
  classifierVersion: z.string().trim().min(1),
  rulesHash: hashSchema,
  semanticChecksum: hashSchema,
  sourceProductSemanticSnapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  generatedAt: z.string().datetime({ offset: true }),
  counts: trainingSemanticSnapshotCountsSchema,
  records: z.array(trainingSemanticSnapshotRecordSchema),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.counts.sourceProducts !== snapshot.records.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['counts', 'sourceProducts'], message: 'sourceProducts must equal records.length' });
});

export const trainingSemanticSnapshotBuildParametersSchema = z.object({
  sourceProductCount: z.number().int().nonnegative(),
  generatedAt: z.string().datetime({ offset: true }).optional(),
  sourceProductSemanticSnapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
}).strict();

export const trainingSemanticSnapshotSaveResultSchema = z.object({
  status: z.enum(['created', 'already_exists']),
  snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

export const trainingSemanticSnapshotPublicationResultSchema = z.object({
  snapshot: trainingSemanticSnapshotSchema,
  saveStatus: z.enum(['created', 'already_exists']),
  activated: z.literal(true),
}).strict();

export type TrainingSemanticSnapshotEvidence = z.infer<typeof trainingSemanticSnapshotEvidenceSchema>;
export type TrainingSemanticSnapshotAssignment = z.infer<typeof trainingSemanticSnapshotAssignmentSchema>;
export type TrainingSemanticSnapshotRecord = z.infer<typeof trainingSemanticSnapshotRecordSchema>;
export type TrainingSemanticSnapshotCounts = z.infer<typeof trainingSemanticSnapshotCountsSchema>;
export type TrainingSemanticSnapshot = Omit<z.infer<typeof trainingSemanticSnapshotSchema>, 'records'> & { readonly records: readonly TrainingSemanticSnapshotRecord[] };
export type TrainingSemanticSnapshotBuildParameters = z.infer<typeof trainingSemanticSnapshotBuildParametersSchema>;
export type TrainingSemanticSnapshotSaveResult = z.infer<typeof trainingSemanticSnapshotSaveResultSchema>;
export type TrainingSemanticSnapshotPublicationResult = Omit<z.infer<typeof trainingSemanticSnapshotPublicationResultSchema>, 'snapshot'> & { readonly snapshot: TrainingSemanticSnapshot };

export type TrainingSemanticRuntimeAssignment = TrainingSemanticSnapshotAssignment & { readonly derivedSemantics: DerivedTrainingSemantics };
export type TrainingSemanticRuntimeFact = Omit<TrainingSemanticSnapshotRecord, 'assignments'> & { readonly assignments: readonly TrainingSemanticRuntimeAssignment[] };

export interface TrainingSemanticSnapshotBuilder {
  build(input: { readonly results: readonly TrainingSemanticClassificationResult[]; readonly parameters: TrainingSemanticSnapshotBuildParameters }): TrainingSemanticSnapshot;
}

export interface TrainingSemanticSnapshotStore {
  save(snapshot: TrainingSemanticSnapshot): Promise<TrainingSemanticSnapshotSaveResult>;
  activate(snapshotId: string): Promise<void>;
  getById(snapshotId: string): Promise<TrainingSemanticSnapshot | null>;
  getActive(): Promise<TrainingSemanticSnapshot | null>;
}

export interface TrainingSemanticSnapshotPublisher {
  publish(input: { readonly results: readonly TrainingSemanticClassificationResult[]; readonly parameters: TrainingSemanticSnapshotBuildParameters }): Promise<TrainingSemanticSnapshotPublicationResult>;
}

export type TrainingSemanticSnapshotMetadata = Omit<TrainingSemanticSnapshot, 'records'>;
export type TrainingSemanticRuntimeStatus = { readonly state: 'not_loaded' } | ({ readonly state: 'ready' } & TrainingSemanticSnapshotMetadata);

export interface ActiveTrainingSemanticSnapshotReader {
  refresh(): Promise<{ readonly status: 'loaded' | 'unchanged' | 'cleared'; readonly previousSnapshotId: string | null; readonly activeSnapshotId: string | null }>;
  getStatus(): TrainingSemanticRuntimeStatus;
  getMetadata(): TrainingSemanticSnapshotMetadata | null;
  getActiveSnapshotMetadata(): TrainingSemanticSnapshotMetadata | null;
  hasProduct(productId: number): boolean;
  getProductTrainingSemanticFact(productId: number): TrainingSemanticRuntimeFact | null;
  getAllProductTrainingSemanticFacts(): readonly TrainingSemanticRuntimeFact[];
}
