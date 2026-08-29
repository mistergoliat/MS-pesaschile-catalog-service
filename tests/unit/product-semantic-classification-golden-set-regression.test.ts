// Golden-set regression (Section 22-23): compares the classifier's output against
// `ontology_review_closure.csv` - the A00.1C human-reviewed 200-product golden set - using the real
// A00 product export and the real A00.1 category/feature trust maps. Read-only; no live PrestaShop.
//
// A00.3.5 upgrades the default classifier to commercial-product-ontology-v3, whose guarded
// CABLE_MACHINE structured-evidence rule recovers the previously-known 2134 hybrid case without
// using FREE_TEXT_DESCRIPTION. The golden set should now match 200/200 on PRODUCT_FAMILY again.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { classifyProduct } from '../../src/domain/product-semantic-classification/index.js';
import { sha256Stable } from '../../src/shared/checksum.js';
import { parseCsvRecords } from '../../scripts/product-semantic-classification/lib/csv.js';
import { resolveGoldenSetClosureCsvPath, resolveProductSemanticInputPaths } from '../../scripts/product-semantic-classification/lib/fixture-paths.js';
import { loadProductSemanticClassificationInputs } from '../../scripts/product-semantic-classification/lib/load-input.js';

const SEMANTIC_PROJECTION_CHECKSUM = '04babbde1ad0bbb8ea3fc9daa7216ab2ba65db8f9043e611f3d9f4c44b181040';

function parseCodes(raw: string): readonly string[] {
  return raw
    .split(';')
    .filter(Boolean)
    .map((entry) => entry.split(':')[0] ?? '')
    .filter((code) => code.length > 0 && code !== 'OTHER');
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((value) => setA.has(value));
}

describe('Golden-set regression against ontology_review_closure.csv', () => {
  it('agrees with the reviewed golden set on PRODUCT_FAMILY, DISCIPLINE, and USE_CONTEXT', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    const inputsById = new Map(inputs.map((productInput) => [productInput.productId, productInput]));

    const closureText = await readFile(resolveGoldenSetClosureCsvPath(), 'utf8');
    const closureRows = parseCsvRecords(closureText);
    expect(closureRows.length).toBe(200);

    const unexpectedMismatches: string[] = [];
    let familyMatches = 0;
    let disciplineMatches = 0;
    let contextMatches = 0;

    for (const row of closureRows) {
      const productId = row.productId ?? '';
      const productInput = inputsById.get(productId);
      expect(productInput, `productId ${productId} from the golden set must exist in the catalog export`).toBeDefined();
      if (!productInput) continue;

      const result = classifyProduct(productInput);

      const expectedFamilies = parseCodes(row.finalFamily ?? '');
      const actualFamilies = [result.primaryProductFamily?.code, ...result.secondaryProductFamilies.map((tag) => tag.code)].filter((code): code is string => Boolean(code));
      if (sameSet(expectedFamilies, actualFamilies)) familyMatches += 1;
      else unexpectedMismatches.push(`FAMILY productId=${productId} name="${productInput.productName}" expected=[${expectedFamilies.join(',')}] actual=[${actualFamilies.join(',')}]`);

      const expectedDisciplines = parseCodes(row.finalDisciplines ?? '');
      const actualDisciplines = result.disciplines.map((tag) => tag.code);
      if (sameSet(expectedDisciplines, actualDisciplines)) disciplineMatches += 1;
      else unexpectedMismatches.push(`DISCIPLINE productId=${productId} name="${productInput.productName}" expected=[${expectedDisciplines.join(',')}] actual=[${actualDisciplines.join(',')}]`);

      const expectedContexts = parseCodes(row.finalUseContexts ?? '');
      const actualContexts = result.useContexts.map((tag) => tag.code);
      if (sameSet(expectedContexts, actualContexts)) contextMatches += 1;
      else unexpectedMismatches.push(`CONTEXT productId=${productId} name="${productInput.productName}" expected=[${expectedContexts.join(',')}] actual=[${actualContexts.join(',')}]`);
    }

    if (unexpectedMismatches.length > 0) {
      console.error(`Golden-set regression: ${unexpectedMismatches.length} unexpected mismatch(es):\n${unexpectedMismatches.join('\n')}`);
    }
    expect(unexpectedMismatches).toEqual([]);
    expect(familyMatches).toBe(200);
    expect(disciplineMatches).toBe(200);
    expect(contextMatches).toBe(200);
  });

  it('excludes all 13 v2 known non-product SKUs and produces zero NEEDS_REVIEW rows across the full catalog', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    expect(inputs.length).toBe(2011);

    const results = inputs.map((productInput) => classifyProduct(productInput));
    const excluded = results.filter((result) => result.classificationStatus === 'EXCLUDED_NON_PRODUCT');
    const needsReview = results.filter((result) => result.classificationStatus === 'NEEDS_REVIEW');

    expect(excluded.map((result) => result.productId).sort()).toEqual(['444', '505', '550', '551', '552', '553', '554', '555', '556', '557', '558', '902', '903']);
    expect(needsReview).toEqual([]);
  });

  it('produces the expected v3 semantic projection checksum for the full catalog', async () => {
    const { inputs } = await loadProductSemanticClassificationInputs(await resolveProductSemanticInputPaths());
    const semanticProjection = inputs.map((productInput) => {
      const result = classifyProduct(productInput);
      return {
        productId: result.productId,
        classificationStatus: result.classificationStatus,
        primaryProductFamily: result.primaryProductFamily
          ? { code: result.primaryProductFamily.code, confidence: result.primaryProductFamily.confidence }
          : null,
        secondaryProductFamilies: result.secondaryProductFamilies.map((tag) => ({ code: tag.code, confidence: tag.confidence })),
        disciplines: result.disciplines.map((tag) => ({ code: tag.code, confidence: tag.confidence })),
        useContexts: result.useContexts.map((tag) => ({ code: tag.code, confidence: tag.confidence })),
      };
    });

    expect(sha256Stable(semanticProjection)).toBe(SEMANTIC_PROJECTION_CHECKSUM);
  });
});
