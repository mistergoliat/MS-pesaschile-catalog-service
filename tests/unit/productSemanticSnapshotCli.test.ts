import { mkdtemp, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { acceptedProductSemanticBaseline } from '../../scripts/product-semantic-classification/lib/accepted-baseline.js';

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

type SnapshotBuildSummary = {
  readonly status: 'ok';
  readonly snapshotId: string;
  readonly schemaVersion: string;
  readonly builtAt: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
  readonly semanticChecksum: string;
  readonly sourceProductCount: number;
  readonly recordCount: number;
  readonly classificationCounts: Record<string, number>;
  readonly saveStatus: 'created' | 'already_exists';
  readonly snapshotPath: string;
  readonly activePointerPath: string;
  readonly fixtureInputs: {
    readonly inputDir: string;
    readonly catalogCsvPath: string;
    readonly categoryTrustMapCsvPath: string;
    readonly featureTrustMapCsvPath: string;
  };
};

async function runBuild(snapshotDir: string): Promise<SnapshotBuildSummary> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [TSX_CLI, 'scripts/product-semantic-classification/build-semantic-snapshot.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PRODUCT_SEMANTIC_SNAPSHOT_DIR: snapshotDir,
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as SnapshotBuildSummary;
}

async function runInspect(snapshotDir: string, productId: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [TSX_CLI, 'scripts/product-semantic-classification/inspect-semantic-snapshot.ts', `--product-id=${productId}`],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PRODUCT_SEMANTIC_SNAPSHOT_DIR: snapshotDir,
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as {
    readonly status: 'ok';
    readonly snapshot: {
      readonly snapshotId: string;
      readonly recordCount: number;
    };
    readonly fact: {
      readonly productId: string;
      readonly classificationStatus: string;
    };
  };
}

describe.sequential('Product semantic snapshot CLI', () => {
  it('zero-arg build resolves local fixtures, publishes the full universe, and stays inside catalog-service', async () => {
    const snapshotDir = await mkdtemp(path.join(tmpdir(), 'product-semantic-snapshot-cli-'));
    const summary = await runBuild(snapshotDir);

    expect(summary.status).toBe('ok');
    expect(summary.schemaVersion).toBe('1');
    expect(summary.classifierVersion).toBe('product-semantic-classifier-v1');
    expect(summary.ontologyVersion).toBe(acceptedProductSemanticBaseline.ontologyVersion);
    expect(summary.ontologyHash).toBe(acceptedProductSemanticBaseline.ontologyHash);
    expect(summary.semanticChecksum).toBe(acceptedProductSemanticBaseline.semanticChecksum);
    expect(summary.sourceProductCount).toBe(acceptedProductSemanticBaseline.sourceProducts);
    expect(summary.recordCount).toBe(acceptedProductSemanticBaseline.sourceProducts);
    expect(summary.classificationCounts).toEqual(acceptedProductSemanticBaseline.classificationCounts);
    expect(summary.saveStatus).toBe('created');

    for (const value of Object.values(summary.fixtureInputs)) {
      expect(value).toContain('MS-pesaschile-catalog-service');
      expect(value.toLowerCase()).not.toContain('customer-profile');
    }

    const activePointer = JSON.parse(await readFile(summary.activePointerPath, 'utf8')) as {
      snapshotId: string;
      schemaVersion: string;
    };
    expect(activePointer).toEqual({
      snapshotId: summary.snapshotId,
      schemaVersion: '1',
    });
  }, 30_000);

  it('rebuilding the same accepted semantic truth is idempotent and keeps the same snapshotId', async () => {
    const snapshotDir = await mkdtemp(path.join(tmpdir(), 'product-semantic-snapshot-cli-'));
    const first = await runBuild(snapshotDir);
    const second = await runBuild(snapshotDir);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.semanticChecksum).toBe(first.semanticChecksum);
    expect(second.saveStatus).toBe('already_exists');
  }, 45_000);

  it('inspect reads the active snapshot instead of rerunning classification', async () => {
    const snapshotDir = await mkdtemp(path.join(tmpdir(), 'product-semantic-snapshot-cli-'));
    const build = await runBuild(snapshotDir);
    for (const productId of ['29', '1023', '1619', '2134']) {
      const inspection = await runInspect(snapshotDir, productId);
      expect(inspection.status).toBe('ok');
      expect(inspection.snapshot.snapshotId).toBe(build.snapshotId);
      expect(inspection.snapshot.recordCount).toBe(acceptedProductSemanticBaseline.sourceProducts);
      expect(inspection.fact.productId).toBe(productId);
    }
  }, 45_000);
});
