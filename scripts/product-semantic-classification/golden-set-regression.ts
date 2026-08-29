// Ad-hoc golden-set regression runner (Section 22). Compares the classifier's output against
// `ontology_review_closure.csv` (the A00.1C reviewed golden set) and prints per-axis agreement plus
// mismatch details. This is a debugging/reporting tool; the durable regression assertion lives in
// tests/unit/product-semantic-classification-golden-set-regression.test.ts.
import { readFile } from 'node:fs/promises';
import { classifyProduct } from '../../src/domain/product-semantic-classification/index.js';
import { parseCsvRecords } from './lib/csv.js';
import { resolveGoldenSetClosureCsvPath, resolveProductSemanticInputPaths } from './lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from './lib/load-input.js';

type CliArgs = {
  readonly catalogCsvPath?: string;
  readonly categoryTrustMapCsvPath?: string;
  readonly featureTrustMapCsvPath?: string;
  readonly closureCsvPath?: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0) {
    return {};
  }
  const [catalogCsvPath, categoryTrustMapCsvPath, featureTrustMapCsvPath, closureCsvPath] = argv;
  if (!catalogCsvPath || !categoryTrustMapCsvPath || !featureTrustMapCsvPath || !closureCsvPath || argv.length !== 4) {
    throw new Error('Usage: tsx golden-set-regression.ts [<catalog.csv> <category-trust-map.csv> <feature-trust-map.csv> <ontology_review_closure.csv>]');
  }
  return { catalogCsvPath, categoryTrustMapCsvPath, featureTrustMapCsvPath, closureCsvPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = await resolveProductSemanticInputPaths(args);
  const closureCsvPath = resolveGoldenSetClosureCsvPath(args.closureCsvPath);

  const { inputs } = await loadProductSemanticClassificationInputs(inputPaths);
  const inputsById = new Map(inputs.map((input) => [input.productId, input]));

  const closureText = await readFile(closureCsvPath, 'utf8');
  const closureRows = parseCsvRecords(closureText);

  let familyMatch = 0;
  let familyMismatch = 0;
  let disciplineMatch = 0;
  let disciplineMismatch = 0;
  let contextMatch = 0;
  let contextMismatch = 0;
  const mismatchDetails: string[] = [];

  for (const row of closureRows) {
    const input = inputsById.get(row.productId ?? '');
    if (!input) {
      mismatchDetails.push(`productId ${row.productId}: not found in catalog export`);
      continue;
    }
    const result = classifyProduct(input);

    const expectedFamilies = (row.finalFamily ?? '').split(';').filter((code) => code.length > 0 && code !== 'OTHER');
    const actualFamilies = [result.primaryProductFamily?.code, ...result.secondaryProductFamilies.map((t) => t.code)].filter(Boolean) as string[];
    const familiesEqual = sameSet(expectedFamilies, actualFamilies);
    if (familiesEqual) familyMatch += 1;
    else {
      familyMismatch += 1;
      mismatchDetails.push(`FAMILY productId=${row.productId} name="${input.productName}" expected=[${expectedFamilies.join(',')}] actual=[${actualFamilies.join(',')}] status=${result.classificationStatus}`);
    }

    const expectedDisciplines = parseTagConfidencePairs(row.finalDisciplines ?? '');
    const actualDisciplines = new Set(result.disciplines.map((t) => t.code));
    const expectedDisciplineCodes = new Set(expectedDisciplines.map((p) => p.code));
    const disciplinesEqual = sameSet([...expectedDisciplineCodes], [...actualDisciplines]);
    if (disciplinesEqual) disciplineMatch += 1;
    else {
      disciplineMismatch += 1;
      mismatchDetails.push(`DISCIPLINE productId=${row.productId} name="${input.productName}" expected=[${[...expectedDisciplineCodes].join(',')}] actual=[${[...actualDisciplines].join(',')}]`);
    }

    const expectedContexts = parseTagConfidencePairs(row.finalUseContexts ?? '');
    const actualContexts = new Set(result.useContexts.map((t) => t.code));
    const expectedContextCodes = new Set(expectedContexts.map((p) => p.code));
    const contextsEqual = sameSet([...expectedContextCodes], [...actualContexts]);
    if (contextsEqual) contextMatch += 1;
    else {
      contextMismatch += 1;
      mismatchDetails.push(`CONTEXT productId=${row.productId} name="${input.productName}" expected=[${[...expectedContextCodes].join(',')}] actual=[${[...actualContexts].join(',')}]`);
    }
  }

  console.info(`FAMILY: ${familyMatch} match, ${familyMismatch} mismatch (of ${closureRows.length})`);
  console.info(`DISCIPLINE: ${disciplineMatch} match, ${disciplineMismatch} mismatch`);
  console.info(`CONTEXT: ${contextMatch} match, ${contextMismatch} mismatch`);
  console.info('--- mismatch details ---');
  for (const line of mismatchDetails) console.info(line);
}

function parseTagConfidencePairs(raw: string): readonly { readonly code: string; readonly confidence: string }[] {
  return raw
    .split(';')
    .filter(Boolean)
    .map((entry) => {
      const [code, confidence] = entry.split(':');
      return { code: code ?? '', confidence: confidence ?? '' };
    });
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((value) => setA.has(value));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
