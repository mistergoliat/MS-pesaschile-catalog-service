import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTrainingSemanticProducts, type TrainingSemanticClassificationInput } from '../../src/domain/training-semantic-classification/index.js';
import { parseCsvRecords, writeCsv } from '../product-semantic-classification/lib/csv.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadTrainingSemanticClassificationInputs } from './lib/load-input.js';
import { buildTrainingSemanticClassificationSummary, sortCapabilityCounts } from './lib/summary.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.4');
const REVIEW_SAMPLE_PATH = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/training_semantics_review_sample.csv');

type CliArgs = {
  readonly inputDir?: string;
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
  readonly outputDir: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unsupported argument: ${arg}`);
    values[match[1]!] = match[2]!;
  }
  return {
    inputDir: values['input-dir'],
    catalogCsvPath: values.catalog,
    categoryTrustMapCsvPath: values['category-trust-map'],
    featureTrustMapCsvPath: values['feature-trust-map'],
    outputDir: path.resolve(values['output-dir'] ?? DEFAULT_OUTPUT_DIR),
  };
}

function stringifyEvidence(evidence: readonly { readonly kind: string; readonly sourceId?: string; readonly matchedText?: string; readonly ruleId?: string; readonly note?: string }[]): string {
  return evidence.map((item) => [item.kind, item.sourceId ?? '', item.matchedText ?? '', item.ruleId ?? '', item.note ?? ''].join(':')).join(' | ');
}

function isPriorityReview(input: TrainingSemanticClassificationInput, result: ReturnType<typeof classifyTrainingSemanticProducts>[number]): boolean {
  const name = input.name.toLowerCase();
  return result.reviewCandidates.length > 0 || result.assignments.length > 1 || /\b(?:pack|set|kit|duo|trio|accesorio|attachment|agarre|pad|cinturon|cajon|box|bench|rack|crossover|dual|multifuncional)\b/.test(name) || input.activeStatus === true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });
  const inputPaths = await resolveProductSemanticInputPaths(args);
  const { inputs, warnings: loaderWarnings } = await loadTrainingSemanticClassificationInputs(inputPaths);
  const results = classifyTrainingSemanticProducts(inputs, { sourceCatalogExport: path.basename(inputPaths.catalogCsvPath) });
  const summary = buildTrainingSemanticClassificationSummary(results);
  const generatedAt = new Date().toISOString();

  await writeFile(path.join(args.outputDir, 'training-semantic-classification-results.json'), `${JSON.stringify({ generatedAt, ...summary, results }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-coverage.json'), `${JSON.stringify({ generatedAt, ...summary, coverageCounts: summary.coverageCounts, loaderWarnings }, null, 2)}\n`, 'utf8');

  const resultById = new Map(results.map((result) => [result.productId, result]));
  const outputRows = results.map((result) => ({
    productId: result.productId,
    assignments: result.assignments.map((assignment) => `${assignment.capabilityCode}:${assignment.relationType}:${assignment.classificationConfidence}`).join(';'),
    coverageStatus: result.coverageStatus,
    reviewCandidates: result.reviewCandidates.map((candidate) => candidate.capabilityCode).join(';'),
    warnings: result.warnings.join(' | '),
    deferredFindings: result.deferredFindings.map((finding) => `${finding.candidateCode}:${finding.matchedText}`).join(';'),
  }));
  await writeFile(path.join(args.outputDir, 'training-semantic-classification-results.csv'), writeCsv(['productId', 'assignments', 'coverageStatus', 'reviewCandidates', 'warnings', 'deferredFindings'], outputRows), 'utf8');

  const reviewRows = results.flatMap((result) => result.reviewCandidates.map((candidate) => ({
    productId: result.productId,
    candidateCapabilities: candidate.capabilityCode,
    relationTypes: candidate.relationType,
    confidence: candidate.classificationConfidence,
    evidence: stringifyEvidence(candidate.evidence),
    coverageStatus: result.coverageStatus,
    reviewReason: candidate.reason,
  })));
  await writeFile(path.join(args.outputDir, 'training-semantic-review-candidates.csv'), writeCsv(['productId', 'candidateCapabilities', 'relationTypes', 'confidence', 'evidence', 'coverageStatus', 'reviewReason'], reviewRows), 'utf8');

  const sampleText = await readFile(REVIEW_SAMPLE_PATH, 'utf8');
  const sampleIds = new Set(parseCsvRecords(sampleText).map((row) => Number(row.productId)).filter((id) => Number.isInteger(id)));
  const humanReviewRows = inputs
    .map((input) => ({ input, result: resultById.get(input.productId)! }))
    .filter(({ input, result }) => sampleIds.has(input.productId) || isPriorityReview(input, result))
    .sort((a, b) => (b.input.revenue ?? -1) - (a.input.revenue ?? -1) || a.input.productId - b.input.productId)
    .map(({ input, result }) => ({
      productId: input.productId,
      name: input.name,
      productFamily: input.productFamily ?? '',
      active: input.activeStatus ?? '',
      candidateCapabilities: [...result.assignments.map((assignment) => assignment.capabilityCode), ...result.reviewCandidates.map((candidate) => candidate.capabilityCode)].filter((code, index, all) => all.indexOf(code) === index).join(';'),
      relationTypes: [...result.assignments.map((assignment) => assignment.relationType), ...result.reviewCandidates.map((candidate) => candidate.relationType)].filter((value, index, all) => all.indexOf(value) === index).join(';'),
      confidence: [...result.assignments.map((assignment) => assignment.classificationConfidence), ...result.reviewCandidates.map((candidate) => candidate.classificationConfidence)].filter((value, index, all) => all.indexOf(value) === index).join(';'),
      evidence: stringifyEvidence([...result.assignments.flatMap((assignment) => assignment.evidence), ...result.reviewCandidates.flatMap((candidate) => candidate.evidence)]),
      coverageStatus: result.coverageStatus,
      reviewReason: [...result.reviewCandidates.map((candidate) => candidate.reason), ...result.warnings, ...result.deferredFindings.map((finding) => `${finding.candidateCode}: ${finding.reason}`)].join(' | '),
    }));
  await writeFile(path.join(args.outputDir, 'training-semantic-review-prioritized.csv'), writeCsv(['productId', 'name', 'productFamily', 'active', 'candidateCapabilities', 'relationTypes', 'confidence', 'evidence', 'coverageStatus', 'reviewReason'], humanReviewRows), 'utf8');

  await writeFile(path.join(args.outputDir, 'training-semantic-deferred-findings.csv'), writeCsv(['productId', 'candidateCode', 'matchedText', 'reason'], results.flatMap((result) => result.deferredFindings)), 'utf8');
  await writeFile(path.join(args.outputDir, 'training-semantic-summary.json'), `${JSON.stringify({ generatedAt, ...summary, capabilityCounts: sortCapabilityCounts(summary.capabilityCounts), loaderWarnings }, null, 2)}\n`, 'utf8');

  console.info(`[training-semantic-classification] classified ${results.length} products`);
  console.info(`[training-semantic-classification] coverage=${JSON.stringify(summary.coverageCounts)}`);
  console.info(`[training-semantic-classification] capabilities=${JSON.stringify(summary.capabilityCounts)}`);
  console.info(`[training-semantic-classification] output=${args.outputDir}`);
}

main().catch((error: unknown) => {
  console.error('[training-semantic-classification] Failed.', error);
  process.exitCode = 1;
});

