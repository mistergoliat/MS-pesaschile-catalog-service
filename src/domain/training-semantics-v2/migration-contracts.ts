import { z } from 'zod';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const snapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

/** Lineage required by a future V2 snapshot builder; this release does not run it. */
export const trainingSemanticV2MigrationLineageSchema = z.object({
  sourceV1SnapshotId: snapshotIdSchema,
  registryV2Hash: hashSchema,
  classifierV2RulesHash: hashSchema,
}).strict();

export type TrainingSemanticV2MigrationLineage = z.infer<typeof trainingSemanticV2MigrationLineageSchema>;

export const trainingSemanticV2MigrationContractSchema = z.object({
  schemaVersion: z.literal('2'),
  preserveV1ExerciseAssignments: z.literal(true),
  lineage: trainingSemanticV2MigrationLineageSchema,
  addsExerciseCapabilityAssignments: z.literal(true),
  addsTrainingFunctionAssignments: z.literal(true),
  sourceV1RegistryOverwritten: z.literal(false),
}).strict();

export type TrainingSemanticV2MigrationContract = z.infer<typeof trainingSemanticV2MigrationContractSchema>;

export const trainingSemanticV2MigrationContract: TrainingSemanticV2MigrationContract = {
  schemaVersion: '2',
  preserveV1ExerciseAssignments: true,
  lineage: {
    sourceV1SnapshotId: 'sha256:63fd41033347c4bd4bcc6382ce432a8a5d0876c8de0a5bec2dd54ac9297ab90d',
    registryV2Hash: '0'.repeat(64),
    classifierV2RulesHash: '0'.repeat(64),
  },
  addsExerciseCapabilityAssignments: true,
  addsTrainingFunctionAssignments: true,
  sourceV1RegistryOverwritten: false,
};

