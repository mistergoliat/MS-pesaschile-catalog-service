import { z } from 'zod';
import { trainingSemanticSnapshotV2Schema } from '../training-semantic-snapshot/v2-contracts.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const trainingSemanticsV2ProjectionSchema = z.object({
  schemaVersion: z.literal('2'), sourceExtractionId: hash, codeRef: z.string().min(1),
  inputs: z.object({ catalog: hash, categoryTrustMap: hash, featureTrustMap: hash,
    resolutionPolicy: z.object({ file: z.string().min(1), hash, cohort: z.literal('accepted-a00.6.7') }).strict(),
  }).strict(),
  snapshot: trainingSemanticSnapshotV2Schema,
}).strict();
export type TrainingSemanticsV2Projection = z.infer<typeof trainingSemanticsV2ProjectionSchema>;
