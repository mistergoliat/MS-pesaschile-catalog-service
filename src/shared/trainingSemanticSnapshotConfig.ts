import path from 'node:path';
import { z } from 'zod';

export const DEFAULT_TRAINING_SEMANTIC_SNAPSHOT_DIR = 'data/training-semantic-snapshots';
const schema = z.object({ TRAINING_SEMANTIC_SNAPSHOT_DIR: z.string().trim().min(1).default(DEFAULT_TRAINING_SEMANTIC_SNAPSHOT_DIR) });

export function resolveTrainingSemanticSnapshotDir(input: { readonly cwd?: string; readonly directory?: string; readonly env?: NodeJS.ProcessEnv } = {}): string {
  const cwd = input.cwd ?? process.cwd();
  if (input.directory) return path.resolve(cwd, input.directory);
  return path.resolve(cwd, schema.parse(input.env ?? process.env).TRAINING_SEMANTIC_SNAPSHOT_DIR);
}
