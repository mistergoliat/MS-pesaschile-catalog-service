import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTrainingSemanticProducts, normalizeTrainingText, type TrainingSemanticClassificationInput } from '../../src/domain/training-semantic-classification/index.js';
import { writeCsv } from '../product-semantic-classification/lib/csv.js';
import { resolveProductSemanticInputPaths } from '../product-semantic-classification/lib/fixture-paths.js';
import { loadTrainingSemanticClassificationInputs } from './lib/load-input.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.4.1');

const reviewDecisions: Readonly<Record<number, { readonly capabilityCode: string; readonly decision: 'ACCEPT' | 'REJECT' | 'KEEP_REVIEW' | 'ONTOLOGY_MISMATCH'; readonly reason: string }>> = {
  290: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Inactive BENCH product explicitly named as an abdominal bench, but no crunch machine/station mechanism is evidenced.' },
  291: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Inactive mixed abdominal/fondos bench; abdominal support is not canonical ABDOMINAL_CRUNCH truth.' },
  471: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Active adjustable bench in trusted Bancos Abdominales/Bancos categories; category proves bench family, not a crunch station.' },
  480: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Mixed abdominal/fondos bench with structured support-load features; evidence does not identify a crunch machine.' },
  528: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Active bench combining abdominal, fondos and dominada; the explicit dominada evidence is separate and does not make the bench a crunch station.' },
  1125: { capabilityCode: 'HIP_THRUST', decision: 'REJECT', reason: 'Active padded box belongs to trusted Cajones de Salto; it facilitates positioning but is not a dedicated hip-thrust station or bench.' },
  1280: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Active adjustable bench in trusted Bancos Abdominales/Bancos categories; no dedicated crunch mechanism is evidenced.' },
  1514: { capabilityCode: 'ABDOMINAL_CRUNCH', decision: 'ONTOLOGY_MISMATCH', reason: 'Active dip/chin/abs bench; ABS wording is broad and the product is a multifunction bench, not an explicit crunch station.' },
};

const deferredCodes = ['SQUAT', 'LEG_PRESS', 'BICEPS_CURL', 'GLUTE_KICKBACK', 'DEADLIFT', 'TRICEPS_EXTENSION'] as const;
type DeferredCode = typeof deferredCodes[number];
type Bucket = 'DEDICATED_MACHINE' | 'RACK_CAGE' | 'ACCESSORY' | 'PACK' | 'TEXTUAL_FALSE_POSITIVE' | 'BENCH_OR_SUPPORT';

function evidenceText(input: TrainingSemanticClassificationInput): string {
  const categories = input.categories
    .filter((category) => category.trustClass === 'SEMANTIC_STRONG' || category.trustClass === 'SEMANTIC_WEAK')
    .map((category) => `${category.name}[${category.trustClass}]`);
  const features = input.features
    .filter((feature) => feature.trustClass === 'SEMANTIC')
    .map((feature) => `${feature.featureName}: ${feature.value}`);
  return [
    `NAME=${input.name}`,
    `FAMILY=${input.productFamily ?? 'UNKNOWN'}`,
    categories.length > 0 ? `TRUSTED_CATEGORY=${categories.join('; ')}` : '',
    features.length > 0 ? `STRUCTURED_FEATURE=${features.join('; ')}` : '',
  ].filter(Boolean).join(' | ');
}

function bucketFor(code: DeferredCode, input: TrainingSemanticClassificationInput): Bucket {
  const name = normalizeTrainingText(input.name);
  if (/\b(?:polera|poleron|crop top|apparel|talla)\b/.test(name)) return 'TEXTUAL_FALSE_POSITIVE';
  if (/\b(?:pack|set|kit|duo|trio)\b/.test(name)) return 'PACK';
  if (input.productFamily === 'MACHINE_ATTACHMENT' || input.productFamily === 'BARBELL' || /\b(?:accesorio|accessory|pad|preacher|jack|barra olimpica|safety squat bar)\b/.test(name)) return 'ACCESSORY';
  if (code === 'SQUAT' && input.productFamily === 'RACK_CAGE') return 'RACK_CAGE';
  if (code === 'SQUAT' && input.productFamily === 'BENCH') return 'BENCH_OR_SUPPORT';
  if (code === 'SQUAT' && /\b(?:hack squat|v squat|belt squat|super squat|squat machine)\b/.test(name)) return 'DEDICATED_MACHINE';
  if (code === 'LEG_PRESS' && /\b(?:leg press|pendulum leg press)\b/.test(name) && input.productFamily !== 'RACK_CAGE' && input.productFamily !== 'MACHINE_ATTACHMENT') return 'DEDICATED_MACHINE';
  if (code === 'BICEPS_CURL' && input.productFamily === 'SELECTORIZED_MACHINE') return 'DEDICATED_MACHINE';
  if (code === 'GLUTE_KICKBACK' && input.productFamily === 'SELECTORIZED_MACHINE') return 'DEDICATED_MACHINE';
  if (code === 'TRICEPS_EXTENSION' && /\b(?:triceps|tricep)\b/.test(name)) return 'DEDICATED_MACHINE';
  return 'TEXTUAL_FALSE_POSITIVE';
}

function rowDecision(bucket: Bucket): 'KEEP_DEFERRED' | 'REJECT' {
  return bucket === 'DEDICATED_MACHINE' ? 'KEEP_DEFERRED' : 'REJECT';
}

function recommendation(code: DeferredCode): 'PROMOTE_V1' | 'KEEP_DEFERRED' | 'DROP' | 'REDEFINE' {
  if (code === 'SQUAT') return 'REDEFINE';
  if (code === 'DEADLIFT') return 'DROP';
  return 'KEEP_DEFERRED';
}

function recommendationReason(code: DeferredCode): string {
  if (code === 'SQUAT') return 'Generic SQUAT conflates racks, benches, accessories, apparel and dedicated machines. Keep out of V1; investigate a narrower HACK_SQUAT capability in a future ontology slice.';
  if (code === 'LEG_PRESS') return 'Five explicit dedicated leg-press products are strong Product Truth, but all six findings are inactive or historical/unknown; preserve the A00.2 KEEP_LATER gate until active availability is separately decided.';
  if (code === 'BICEPS_CURL') return 'Two explicit selectorized products are inactive; the active/unknown rows are preacher-pad or bench accessories. Insufficient current evidence for V1 promotion.';
  if (code === 'GLUTE_KICKBACK') return 'Two explicit products exist but both are inactive; keep deferred until current product truth is confirmed.';
  if (code === 'DEADLIFT') return 'The only finding is Deadlift Jack Bar, an accessory that facilitates loading and is not a DEADLIFT capability.';
  return 'One active name-only candidate exists, but family/category/feature evidence is absent; keep deferred under precision-first policy.';
}

async function main(): Promise<void> {
  const outputDir = path.resolve(process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice('--output-dir='.length) ?? DEFAULT_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });
  const inputPaths = await resolveProductSemanticInputPaths();
  const { inputs } = await loadTrainingSemanticClassificationInputs(inputPaths);
  const results = classifyTrainingSemanticProducts(inputs);
  const inputsById = new Map(inputs.map((input) => [input.productId, input]));
  const resultsById = new Map(results.map((result) => [result.productId, result]));

  const reviewRows = Object.entries(reviewDecisions).map(([rawId, decision]) => {
    const productId = Number(rawId);
    const input = inputsById.get(productId);
    if (!input) throw new Error(`Review product ${productId} not found in catalog input.`);
    return {
      productId,
      name: input.name,
      active: input.activeStatus ?? '',
      productFamily: input.productFamily ?? '',
      currentEvidence: evidenceText(input),
      candidateCapability: decision.capabilityCode,
      decision: decision.decision,
      reason: decision.reason,
    };
  });
  await writeFile(path.join(outputDir, 'review-decisions.csv'), writeCsv(['productId', 'name', 'active', 'productFamily', 'currentEvidence', 'candidateCapability', 'decision', 'reason'], reviewRows), 'utf8');

  const deferredRows = inputs.flatMap((input) => {
    const result = resultsById.get(input.productId)!;
    return result.deferredFindings
      .filter((finding): finding is typeof finding & { candidateCode: DeferredCode } => (deferredCodes as readonly string[]).includes(finding.candidateCode))
      .map((finding) => {
        const code = finding.candidateCode as DeferredCode;
        const bucket = bucketFor(code, input);
        return {
          productId: input.productId,
          name: input.name,
          active: input.activeStatus ?? '',
          productFamily: input.productFamily ?? '',
          candidateCode: code,
          observedEvidence: evidenceText(input),
          bucket,
          decision: rowDecision(bucket),
          reason: bucket === 'DEDICATED_MACHINE' ? 'Explicit product-function wording is credible, but the candidate remains deferred by the recommendation gate.' : `${bucket} does not establish the deferred exercise capability as Product Truth.`,
        };
      });
  });
  const summaryRows = deferredCodes.map((code) => {
    const rows = deferredRows.filter((row) => row.candidateCode === code);
    const directRows = rows.filter((row) => row.bucket === 'DEDICATED_MACHINE');
    const supportedRows = rows.filter((row) => row.bucket === 'RACK_CAGE');
    const falseRows = rows.filter((row) => row.decision === 'REJECT' && !['ACCESSORY', 'PACK', 'RACK_CAGE', 'DEDICATED_MACHINE'].includes(row.bucket));
    const accessoryPackRows = rows.filter((row) => row.bucket === 'ACCESSORY' || row.bucket === 'PACK');
    return {
      candidateCode: code,
      observedCount: rows.length,
      activeCount: rows.filter((row) => row.active === true).length,
      directWorthyProductIds: directRows.map((row) => row.productId).join(';'),
      directWorthyCount: directRows.length,
      supportedOnlyProductIds: supportedRows.map((row) => row.productId).join(';'),
      supportedOnlyCount: supportedRows.length,
      falsePositiveProductIds: falseRows.map((row) => row.productId).join(';'),
      falsePositiveCount: falseRows.length,
      accessoryPackProductIds: accessoryPackRows.map((row) => row.productId).join(';'),
      accessoryPackCount: accessoryPackRows.length,
      recommendation: recommendation(code),
      rationale: recommendationReason(code),
    };
  });
  await writeFile(path.join(outputDir, 'deferred-capability-adjudication.csv'), writeCsv([
    'candidateCode', 'observedCount', 'activeCount', 'directWorthyProductIds', 'directWorthyCount', 'supportedOnlyProductIds', 'supportedOnlyCount', 'falsePositiveProductIds', 'falsePositiveCount', 'accessoryPackProductIds', 'accessoryPackCount', 'recommendation', 'rationale',
  ], summaryRows), 'utf8');
  await writeFile(path.join(outputDir, 'deferred-capability-adjudication-detail.csv'), writeCsv(['productId', 'name', 'active', 'productFamily', 'candidateCode', 'observedEvidence', 'bucket', 'decision', 'reason'], deferredRows), 'utf8');
  console.info(`[training-semantic-adjudication] review decisions=${reviewRows.length}; deferred findings=${deferredRows.length}; output=${outputDir}`);
}

main().catch((error: unknown) => {
  console.error('[training-semantic-adjudication] Failed.', error);
  process.exitCode = 1;
});
