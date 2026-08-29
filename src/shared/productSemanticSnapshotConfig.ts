import path from 'node:path';
import { z } from 'zod';

export const DEFAULT_PRODUCT_SEMANTIC_SNAPSHOT_DIR = 'data/product-semantic-snapshots';

const productSemanticSnapshotEnvSchema = z.object({
  PRODUCT_SEMANTIC_SNAPSHOT_DIR: z.string().trim().min(1).default(DEFAULT_PRODUCT_SEMANTIC_SNAPSHOT_DIR),
});

export function resolveProductSemanticSnapshotDir(input: {
  readonly cwd?: string;
  readonly directory?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): string {
  const cwd = input.cwd ?? process.cwd();
  if (input.directory) {
    return path.resolve(cwd, input.directory);
  }
  const parsed = productSemanticSnapshotEnvSchema.parse(input.env ?? process.env);
  return path.resolve(cwd, parsed.PRODUCT_SEMANTIC_SNAPSHOT_DIR);
}
