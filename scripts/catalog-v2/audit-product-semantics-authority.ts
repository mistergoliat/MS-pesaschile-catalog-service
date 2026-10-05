import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ActivationService } from '../../src/domain/catalog/projection-activation.js';
import { FileProjectionActivationStore } from '../../src/infra/catalog/file-projection-activation-store.js';
import { DefaultProductSemanticSnapshotBuilder, canonicalizeJson, productSemanticClassifierVersion } from '../../src/domain/product-semantic-snapshot/index.js';
import { contentHash } from '../../src/domain/catalog/projection-input/canonical.js';
import { runProductSemanticClassification } from '../product-semantic-classification/lib/classification-run.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { acceptedProductSemanticBaseline } from '../product-semantic-classification/lib/accepted-baseline.js';
import { compareProductSemantics, readableSnapshot } from './product-semantics-parity.js';

const acceptedSnapshotId = 'sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12';

async function main() {
  const options: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--(projection-root|bundle-id|legacy-snapshot|replay-accepted-baseline|output)=(.+)$/u.exec(arg);
    if (!match || options[match[1]!] !== undefined) throw new Error(`INVALID_ARGUMENT: ${arg}`);
    options[match[1]!] = match[2]!;
  }
  if (Boolean(options['legacy-snapshot']) === Boolean(options['replay-accepted-baseline']))
    throw new Error('Provide exactly one of --legacy-snapshot=<file> or --replay-accepted-baseline=true');
  if (options['replay-accepted-baseline'] && options['replay-accepted-baseline'] !== 'true') throw new Error('INVALID_REPLAY_OPTION');
  const store = new FileProjectionActivationStore(path.resolve(options['projection-root'] ?? 'artifacts/catalog-v2'));
  const pointer = options['bundle-id'] ? null : await store.readActivePointer();
  const bundleId = options['bundle-id'] ?? pointer?.activeProjectionBundleId;
  if (!bundleId) throw new Error('NO_ACTIVE_BUNDLE: supply --bundle-id for an explicitly selected reproducible candidate');
  const bundle = await new ActivationService(store).candidate(bundleId);
  const entry = bundle.manifest.projections.productSemantics;
  if (entry.status !== 'present') throw new Error('PRODUCT_SEMANTICS_UNAVAILABLE');
  const catV2 = readableSnapshot(JSON.parse(bundle.files[entry.artifact]!).snapshot);

  let legacy;
  let legacyInput;
  if (options['legacy-snapshot']) {
    const raw = await readFile(path.resolve(options['legacy-snapshot']), 'utf8');
    legacy = readableSnapshot(JSON.parse(raw));
    if (legacy.snapshotId !== acceptedSnapshotId) throw new Error('ACCEPTED_LEGACY_SNAPSHOT_MISMATCH');
    legacyInput = { basis: 'ACCEPTED_SNAPSHOT', fileHash: contentHash(raw), acceptedSnapshotId, presenceVerified: true };
  } else {
    const paths = await resolveProductSemanticInputPaths();
    const run = await runProductSemanticClassification(paths);
    if (run.loaderWarnings.length) throw new Error(`BASELINE_REPLAY_WARNINGS: ${run.loaderWarnings.join('; ')}`);
    legacy = new DefaultProductSemanticSnapshotBuilder().build({ results: run.results, parameters: {
      sourceProductCount: run.inputs.length, classifierVersion: productSemanticClassifierVersion, builtAt: '1970-01-01T00:00:00.000Z',
    } }).snapshot;
    const baseline = acceptedProductSemanticBaseline;
    if (legacy.recordCount !== baseline.sourceProducts || legacy.semanticChecksum !== baseline.semanticChecksum
      || legacy.ontologyVersion !== baseline.ontologyVersion || legacy.ontologyHash !== baseline.ontologyHash
      || canonicalizeJson(legacy.classificationCounts) !== canonicalizeJson(baseline.classificationCounts))
      throw new Error('ACCEPTED_BASELINE_REPLAY_MISMATCH');
    const hashes = await Promise.all([paths.catalogCsvPath, paths.categoryTrustMapCsvPath, paths.featureTrustMapCsvPath]
      .map(async (file) => contentHash(await readFile(file, 'utf8'))));
    legacyInput = { basis: 'ACCEPTED_CLASSIFICATION_REPLAY', acceptedSnapshotId, replaySnapshotId: legacy.snapshotId,
      inputHashes: { catalog: hashes[0], categories: hashes[1], features: hashes[2] }, presenceVerified: legacy.snapshotId === acceptedSnapshotId };
  }
  const comparison = compareProductSemantics(legacy, catV2);
  const blockers = [];
  if (!legacyInput.presenceVerified) blockers.push('ACCEPTED_LEGACY_SNAPSHOT_ABSENT: replay matches accepted classification checksum but not reconciled snapshot identity/presence');
  if (comparison.coverage.legacyOnly.recordCount) blockers.push('LEGACY_ONLY_PRODUCTS_REQUIRE_REVIEW');
  if (comparison.differences.some((difference) => difference.classification !== 'REPRESENTATIONAL_ONLY'))
    blockers.push('CONTRACT_OR_EVIDENCE_DIFFERENCES_REQUIRE_ADJUDICATION');
  const report = {
    schemaVersion: '1', status: blockers.length ? 'RETIREMENT_BLOCKED' : 'PARITY_PASS_REVIEW_REQUIRED', blockers,
    inputs: { legacy: legacyInput, catV2: { selection: pointer ? 'ACTIVE_POINTER' : 'EXPLICIT_CANDIDATE',
      projectionBundleId: bundleId, manifestHash: bundle.manifestHash, sourceExtractionId: bundle.manifest.source.sourceExtractionId,
      activationId: pointer?.activationId ?? null, build: bundle.manifest.build } },
    ...comparison,
  };
  const output = path.resolve(options.output ?? 'docs/catalog-v2/evidence/product-semantics-parity.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${canonicalizeJson(report)}\n`);
  console.log(JSON.stringify({ status: report.status, blockers, coverage: {
    legacy: legacy.recordCount, catV2: catV2.recordCount, both: comparison.coverage.both.legacy.recordCount,
    legacyOnly: comparison.coverage.legacyOnly.recordCount, catV2Only: comparison.coverage.catV2Only.recordCount,
  }, metrics: comparison.metrics, output }, null, 2));
  // A data diff cannot approve consumer migration or operational failure semantics on its own.
  if (blockers.length) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'RETIREMENT_BLOCKED', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
