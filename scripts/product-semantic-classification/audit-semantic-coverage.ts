import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeCommercialProductOntologyRegistryHash,
  getCommercialProductOntologyRegistry,
  type OntologyAxis,
} from '../../src/domain/commercial-product-ontology/index.js';
import {
  productSemanticSnapshotSchema,
  type ProductSemanticSnapshot,
  type ProductSemanticSnapshotFact,
} from '../../src/domain/product-semantic-snapshot/index.js';
import { FileProductSemanticSnapshotStore } from '../../src/infrastructure/product-semantic/fileProductSemanticSnapshotStore.js';
import { resolveProductSemanticSnapshotDir } from '../../src/shared/productSemanticSnapshotConfig.js';
import { parseCsvRecords, writeCsv } from './lib/csv.js';
import { resolveProductSemanticInputPaths } from './lib/fixture-paths.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_SNAPSHOT_ID = 'sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12';
const EXPECTED_ONTOLOGY_HASH = 'f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955';
const EXPECTED_SEMANTIC_CHECKSUM = 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e';
const AXES: readonly OntologyAxis[] = ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'];
const CONTROL_IDS = ['29', '31', '1023', '1619', '2134', '332', '444'];
const RECENTLY_FIXED_RULES = new Set(['PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3']);

type Population = 'ACTIVE' | 'INACTIVE' | 'HISTORICAL';
type CatalogMeta = {
  readonly productId: string;
  readonly name: string;
  readonly active: boolean | null;
  readonly catalogPresence: string;
  readonly validOrderCount: number;
  readonly unitsSold: number;
  readonly revenue: number;
  readonly categories: string;
  readonly features: string;
};
type AuditProduct = {
  readonly fact: ProductSemanticSnapshotFact;
  readonly meta: CatalogMeta | undefined;
  readonly population: Population;
};

function parseArgs(argv: readonly string[]): {
  snapshotDir?: string;
  snapshotId?: string;
  outputDir?: string;
  catalog?: string;
  categoryTrustMap?: string;
  featureTrustMap?: string;
} {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(arg);
    if (!match) throw new Error(`Unsupported argument: ${arg}`);
    values[match[1]!] = match[2]!;
  }
  return {
    snapshotDir: values['snapshot-dir'],
    snapshotId: values['snapshot-id'],
    outputDir: values['output-dir'],
    catalog: values.catalog,
    categoryTrustMap: values['category-trust-map'],
    featureTrustMap: values['feature-trust-map'],
  };
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function catalogMetadata(record: Record<string, string>): CatalogMeta {
  const active = record.active === '1' ? true : record.active === '0' ? false : null;
  return {
    productId: record.productId ?? '',
    name: record.name ?? '',
    active,
    catalogPresence: record.catalogPresence ?? '',
    validOrderCount: numberValue(record.validOrderCount),
    unitsSold: numberValue(record.unitsSold),
    revenue: numberValue(record.totalRevenueTaxIncl),
    categories: record.allCategoryNames ?? '',
    features: record.features_text ?? '',
  };
}

function getPopulation(meta: CatalogMeta | undefined): Population {
  if (meta?.catalogPresence === 'historical_order_detail_only') return 'HISTORICAL';
  return meta?.active === true ? 'ACTIVE' : 'INACTIVE';
}

function families(fact: ProductSemanticSnapshotFact): readonly string[] {
  return [
    ...(fact.primaryProductFamily ? [fact.primaryProductFamily.code] : []),
    ...fact.secondaryProductFamilies.map((tag) => tag.code),
  ];
}

function axisCodes(fact: ProductSemanticSnapshotFact, axis: OntologyAxis): readonly string[] {
  if (axis === 'PRODUCT_FAMILY') return families(fact);
  if (axis === 'DISCIPLINE') return fact.disciplines.map((tag) => tag.code);
  return fact.useContexts.map((tag) => tag.code);
}

function factCount(fact: ProductSemanticSnapshotFact): number {
  return AXES.reduce((total, axis) => total + axisCodes(fact, axis).length, 0);
}

function pct(value: number, denominator: number): number {
  return denominator === 0 ? 0 : Number(((value / denominator) * 100).toFixed(2));
}

function csvList(values: readonly string[]): string {
  return [...values].sort((a, b) => a.localeCompare(b)).join('|');
}

function examples(products: readonly AuditProduct[], limit = 3): string {
  return [...products]
    .sort((a, b) => (b.meta?.revenue ?? 0) - (a.meta?.revenue ?? 0) || a.fact.productId.localeCompare(b.fact.productId, undefined, { numeric: true }))
    .slice(0, limit)
    .map((product) => `${product.fact.productId}:${product.meta?.name ?? ''}`)
    .join(' || ');
}

function allProducts(snapshot: ProductSemanticSnapshot, catalogById: ReadonlyMap<string, CatalogMeta>): readonly AuditProduct[] {
  return snapshot.records.map((fact) => ({ fact, meta: catalogById.get(fact.productId), population: getPopulation(catalogById.get(fact.productId)) }));
}

function isSemanticProduct(product: AuditProduct): boolean {
  return product.fact.classificationStatus !== 'EXCLUDED_NON_PRODUCT';
}

function buildCoverageRows(products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  const semantic = products.filter(isSemanticProduct);
  return [
    {
      axis: 'ANY_FACT',
      recordsWithAtLeastOneFact: semantic.filter((product) => factCount(product.fact) > 0).length,
      recordsWithoutFacts: semantic.filter((product) => factCount(product.fact) === 0).length,
      semanticProductCount: semantic.length,
      coveragePct: pct(semantic.filter((product) => factCount(product.fact) > 0).length, semantic.length),
    },
    ...AXES.map((axis) => {
      const covered = semantic.filter((product) => axisCodes(product.fact, axis).length > 0).length;
      return {
        axis,
        recordsWithAtLeastOneFact: covered,
        recordsWithoutFacts: semantic.length - covered,
        semanticProductCount: semantic.length,
        coveragePct: pct(covered, semantic.length),
      };
    }),
  ];
}

function buildFamilyRows(snapshot: ProductSemanticSnapshot, products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  const semantic = products.filter(isSemanticProduct);
  const registry = getCommercialProductOntologyRegistry(snapshot.ontologyVersion as Parameters<typeof getCommercialProductOntologyRegistry>[0]);
  const codes = registry.tags.filter((tag) => tag.axis === 'PRODUCT_FAMILY').map((tag) => tag.code);
  return codes.map((code) => {
    const assigned = semantic.filter((product) => families(product.fact).includes(code));
    const active = assigned.filter((product) => product.population === 'ACTIVE');
    const secondary = assigned.filter((product) => product.fact.secondaryProductFamilies.some((tag) => tag.code === code));
    const withDiscipline = assigned.filter((product) => product.fact.disciplines.length > 0);
    const withContext = assigned.filter((product) => product.fact.useContexts.length > 0);
    const revenue = assigned.reduce((sum, product) => sum + (product.meta?.revenue ?? 0), 0);
    return {
      productFamily: code,
      productCount: assigned.length,
      activeProductCount: active.length,
      productsWithDiscipline: withDiscipline.length,
      productsWithoutDiscipline: assigned.length - withDiscipline.length,
      productsWithUseContext: withContext.length,
      productsWithoutUseContext: assigned.length - withContext.length,
      secondaryFamilyCount: secondary.length,
      commercialRevenueTaxIncl: Number(revenue.toFixed(2)),
      examples: examples(assigned),
    };
  });
}

function buildTagRows(snapshot: ProductSemanticSnapshot, products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  const registry = getCommercialProductOntologyRegistry(snapshot.ontologyVersion as Parameters<typeof getCommercialProductOntologyRegistry>[0]);
  return registry.tags.filter((tag) => !tag.residual).map((tag) => {
    const assigned = products.filter((product) => axisCodes(product.fact, tag.axis).includes(tag.code));
    const evidence = products.flatMap((product) => product.fact.provenance.evidence.filter((entry) => entry.axis === tag.axis && entry.code === tag.code));
    const sourceCount = (sourceType: string) => evidence.filter((entry) => entry.sourceType === sourceType).length;
    return {
      axis: tag.axis,
      code: tag.code,
      assignmentCount: assigned.length,
      evidenceRecordCount: evidence.length,
      productCount: assigned.length,
      activeCount: assigned.filter((product) => product.population === 'ACTIVE').length,
      inactiveCount: assigned.filter((product) => product.population === 'INACTIVE').length,
      historicalCount: assigned.filter((product) => product.population === 'HISTORICAL').length,
      sourceNameText: sourceCount('NAME_TEXT'),
      sourceTrustedCategory: sourceCount('TRUSTED_CATEGORY'),
      sourceStructuredFeature: sourceCount('STRUCTURED_FEATURE'),
      sourceFamilyInference: sourceCount('FAMILY_INFERENCE'),
      examples: examples(assigned),
    };
  });
}

function buildAxisUtilization(snapshot: ProductSemanticSnapshot, products: readonly AuditProduct[], axis: OntologyAxis): readonly Record<string, string | number>[] {
  const registry = getCommercialProductOntologyRegistry(snapshot.ontologyVersion as Parameters<typeof getCommercialProductOntologyRegistry>[0]);
  return registry.tags.filter((tag) => tag.axis === axis).map((tag) => {
    const assigned = products.filter((product) => axisCodes(product.fact, axis).includes(tag.code));
    const byFamily = new Map<string, number>();
    for (const product of assigned) for (const family of families(product.fact)) byFamily.set(family, (byFamily.get(family) ?? 0) + 1);
    return {
      axis,
      code: tag.code,
      totalAssignedProducts: assigned.length,
      activeAssignedProducts: assigned.filter((product) => product.population === 'ACTIVE').length,
      familyDistribution: [...byFamily.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([family, count]) => `${family}:${count}`)
        .join('|'),
      representativeExamples: examples(assigned),
    };
  });
}

function buildProvenanceRows(products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  return AXES.map((axis) => {
    const evidence = products.flatMap((product) => product.fact.provenance.evidence.filter((entry) => entry.axis === axis));
    const count = evidence.length;
    const source = (sourceType: string) => evidence.filter((entry) => entry.sourceType === sourceType).length;
    return {
      axis,
      evidenceRecordCount: count,
      nameTextCount: source('NAME_TEXT'),
      nameTextPct: pct(source('NAME_TEXT'), count),
      trustedCategoryCount: source('TRUSTED_CATEGORY'),
      trustedCategoryPct: pct(source('TRUSTED_CATEGORY'), count),
      structuredFeatureCount: source('STRUCTURED_FEATURE'),
      structuredFeaturePct: pct(source('STRUCTURED_FEATURE'), count),
      familyInferenceCount: source('FAMILY_INFERENCE'),
      familyInferencePct: pct(source('FAMILY_INFERENCE'), count),
    };
  });
}

function buildMatrixRows(snapshot: ProductSemanticSnapshot, products: readonly AuditProduct[], columnAxis: 'USE_CONTEXT' | 'DISCIPLINE'): readonly Record<string, string | number>[] {
  const registry = getCommercialProductOntologyRegistry(snapshot.ontologyVersion as Parameters<typeof getCommercialProductOntologyRegistry>[0]);
  const familiesPresent = registry.tags.filter((tag) => tag.axis === 'PRODUCT_FAMILY').map((tag) => tag.code);
  const columns = registry.tags.filter((tag) => tag.axis === columnAxis).map((tag) => tag.code);
  return familiesPresent.map((family) => {
    const row: Record<string, string | number> = { productFamily: family };
    for (const column of columns) {
      row[column] = products.filter((product) => families(product.fact).includes(family) && axisCodes(product.fact, columnAxis).includes(column)).length;
    }
    return row;
  });
}

function buildMultiLabelRows(products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  const combinations = new Map<string, AuditProduct[]>();
  for (const product of products.filter((entry) => entry.fact.secondaryProductFamilies.length > 0)) {
    const combination = csvList(families(product.fact));
    combinations.set(combination, [...(combinations.get(combination) ?? []), product]);
  }
  return [...combinations.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([combination, entries]) => ({
      familyCombination: combination,
      productCount: entries.length,
      activeProductCount: entries.filter((product) => product.population === 'ACTIVE').length,
      representativeExamples: examples(entries, 5),
      includes2134: entries.some((product) => product.fact.productId === '2134') ? 'YES' : 'NO',
    }));
}

function reviewSelection(products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  const selected = new Map<string, Set<string>>();
  const add = (product: AuditProduct, reason: string) => selected.set(product.fact.productId, new Set([...(selected.get(product.fact.productId) ?? []), reason]));
  const byRevenue = (left: AuditProduct, right: AuditProduct) =>
    (right.meta?.revenue ?? 0) - (left.meta?.revenue ?? 0) || left.fact.productId.localeCompare(right.fact.productId, undefined, { numeric: true });
  const semantic = products.filter(isSemanticProduct);
  for (const id of CONTROL_IDS) {
    const product = products.find((entry) => entry.fact.productId === id);
    if (product) add(product, 'KNOWN_CONTROL');
  }
  for (const product of [...semantic].sort(byRevenue).slice(0, 10)) add(product, 'HIGH_COMMERCIAL_VOLUME');
  for (const family of [...new Set(semantic.flatMap((product) => families(product.fact)))]) {
    const product = semantic.filter((entry) => families(entry.fact).includes(family)).sort(byRevenue)[0];
    if (product) add(product, 'EACH_PRODUCT_FAMILY');
  }
  for (const product of semantic.filter((entry) => entry.fact.secondaryProductFamilies.length > 0).sort(byRevenue).slice(0, 5)) add(product, 'MULTI_FAMILY');
  for (const product of semantic.filter((entry) => factCount(entry.fact) >= 2).sort(byRevenue).slice(0, 5)) add(product, 'MULTI_AXIS');
  for (const product of semantic.filter((entry) => families(entry.fact).length === 1 && entry.fact.disciplines.length === 0 && entry.fact.useContexts.length === 0).sort(byRevenue).slice(0, 5)) add(product, 'FAMILY_ONLY');
  for (const status of ['OTHER', 'PARTIALLY_CLASSIFIED', 'EXCLUDED_NON_PRODUCT'] as const) {
    for (const product of products.filter((entry) => entry.fact.classificationStatus === status).sort(byRevenue).slice(0, status === 'EXCLUDED_NON_PRODUCT' ? 2 : 4)) add(product, status);
  }
  for (const populationName of ['ACTIVE', 'INACTIVE', 'HISTORICAL'] as const) {
    const product = products.filter((entry) => entry.population === populationName).sort(byRevenue)[0];
    if (product) add(product, populationName);
  }
  for (const product of products.filter((entry) => entry.fact.provenance.evidence.some((evidence) => RECENTLY_FIXED_RULES.has(evidence.ruleId))).sort(byRevenue).slice(0, 5)) add(product, 'RECENTLY_FIXED_FAMILY');
  return [...selected.entries()]
    .map(([productId, reasons]) => {
      const product = products.find((entry) => entry.fact.productId === productId)!;
      return {
        productId,
        productName: product.meta?.name ?? '',
        catalogPresence: product.meta?.catalogPresence ?? '',
        population: product.population,
        active: product.meta?.active === null || product.meta?.active === undefined ? '' : product.meta.active ? 'YES' : 'NO',
        classificationStatus: product.fact.classificationStatus,
        primaryProductFamily: product.fact.primaryProductFamily?.code ?? '',
        secondaryProductFamilies: csvList(product.fact.secondaryProductFamilies.map((tag) => tag.code)),
        disciplines: csvList(product.fact.disciplines.map((tag) => tag.code)),
        useContexts: csvList(product.fact.useContexts.map((tag) => tag.code)),
        reviewGroups: csvList([...reasons]),
        validOrderCount: product.meta?.validOrderCount ?? 0,
        unitsSold: product.meta?.unitsSold ?? 0,
        totalRevenueTaxIncl: product.meta?.revenue ?? 0,
        categories: product.meta?.categories ?? '',
        features: product.meta?.features ?? '',
        provenance: product.fact.provenance.evidence.map((entry) => `${entry.axis}:${entry.code}:${entry.sourceType}:${entry.sourceId}`).join(' || '),
        primaryFamilyCorrect: '',
        secondaryFamiliesCorrect: '',
        disciplinesDefensible: '',
        useContextsDefensible: '',
        missingAxesAcceptable: '',
        suspiciousSignal: '',
        provenanceAdequate: '',
        humanReviewOutcome: '',
        humanReviewNotes: '',
      };
    })
    .sort((left, right) => (right.totalRevenueTaxIncl as number) - (left.totalRevenueTaxIncl as number) || (left.productId as string).localeCompare(right.productId as string, undefined, { numeric: true }));
}

function weightedRows(products: readonly AuditProduct[]): readonly Record<string, string | number>[] {
  const semantic = products.filter(isSemanticProduct);
  const populations: readonly { name: string; rows: readonly AuditProduct[] }[] = [
    { name: 'ALL_SEMANTIC', rows: semantic },
    { name: 'ACTIVE_ONLY', rows: semantic.filter((product) => product.population === 'ACTIVE') },
  ];
  return populations.flatMap(({ name, rows }) => {
    const total = rows.reduce((sum, product) => sum + (product.meta?.revenue ?? 0), 0);
    const metrics: readonly { metric: string; represented: (product: AuditProduct) => boolean }[] = [
      { metric: 'PRODUCT_FAMILY', represented: (product) => families(product.fact).length > 0 },
      { metric: 'DISCIPLINE', represented: (product) => product.fact.disciplines.length > 0 },
      { metric: 'USE_CONTEXT', represented: (product) => product.fact.useContexts.length > 0 },
      { metric: 'ANY_FACT', represented: (product) => factCount(product.fact) > 0 },
    ];
    return metrics.map(({ metric, represented }) => {
      const representedRows = rows.filter(represented);
      const revenue = representedRows.reduce((sum, product) => sum + (product.meta?.revenue ?? 0), 0);
      return {
        population: name,
        metric,
        representedProducts: representedRows.length,
        totalProducts: rows.length,
        revenueTaxIncl: Number(revenue.toFixed(2)),
        totalRevenueTaxIncl: Number(total.toFixed(2)),
        revenueCoveragePct: pct(revenue, total),
      };
    });
  });
}

async function loadSnapshot(snapshotDirectory: string, snapshotId?: string): Promise<ProductSemanticSnapshot> {
  const store = new FileProductSemanticSnapshotStore(snapshotDirectory);
  const snapshot = snapshotId ? await store.getById(snapshotId) : await store.getActive();
  if (!snapshot) {
    throw new Error(`Published semantic snapshot not found in ${snapshotDirectory}${snapshotId ? ` for ${snapshotId}` : ''}. Provide --snapshot-dir pointing at the deployed/published snapshot.`);
  }
  const parsed = productSemanticSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new Error('Published semantic snapshot failed schema validation');
  return snapshot;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const serviceRoot = path.resolve(SCRIPT_DIR, '../..');
  const snapshotDirectory = resolveProductSemanticSnapshotDir({ cwd: serviceRoot, directory: args.snapshotDir });
  const snapshot = await loadSnapshot(snapshotDirectory, args.snapshotId);
  if (snapshot.snapshotId !== EXPECTED_SNAPSHOT_ID) throw new Error(`Unexpected snapshotId ${snapshot.snapshotId}; expected ${EXPECTED_SNAPSHOT_ID}`);
  if (snapshot.ontologyHash !== EXPECTED_ONTOLOGY_HASH) throw new Error(`Unexpected ontologyHash ${snapshot.ontologyHash}; expected ${EXPECTED_ONTOLOGY_HASH}`);
  if (snapshot.semanticChecksum !== EXPECTED_SEMANTIC_CHECKSUM) throw new Error(`Unexpected semanticChecksum ${snapshot.semanticChecksum}; expected ${EXPECTED_SEMANTIC_CHECKSUM}`);

  const registry = getCommercialProductOntologyRegistry(snapshot.ontologyVersion as Parameters<typeof getCommercialProductOntologyRegistry>[0]);
  const registryHash = computeCommercialProductOntologyRegistryHash(registry);
  if (registryHash !== snapshot.ontologyHash) throw new Error(`Snapshot ontologyHash does not match local registry (${registryHash})`);

  const inputPaths = await resolveProductSemanticInputPaths({
    catalogCsvPath: args.catalog,
    categoryTrustMapCsvPath: args.categoryTrustMap,
    featureTrustMapCsvPath: args.featureTrustMap,
  });
  const catalogRecords = parseCsvRecords(await readFile(inputPaths.catalogCsvPath, 'utf8'));
  const catalogById = new Map(catalogRecords.map((record) => {
    const meta = catalogMetadata(record);
    return [meta.productId, meta] as const;
  }));
  const products = allProducts(snapshot, catalogById);
  const outputDirectory = path.resolve(serviceRoot, args.outputDir ?? 'docs/audits/product-semantic-coverage');
  await mkdir(outputDirectory, { recursive: true });

  const familyRows = buildFamilyRows(snapshot, products);
  const tagRows = buildTagRows(snapshot, products.filter(isSemanticProduct));
  const reviewRows = reviewSelection(products);
  const contextMatrix = buildMatrixRows(snapshot, products.filter(isSemanticProduct), 'USE_CONTEXT');
  const disciplineMatrix = buildMatrixRows(snapshot, products.filter(isSemanticProduct), 'DISCIPLINE');
  const matrixColumns = (rows: readonly Record<string, string | number>[]) => [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'productFamily')))].sort();
  const outputFiles: Record<string, string> = {
    'semantic_coverage_by_family.csv': writeCsv(['productFamily', 'productCount', 'activeProductCount', 'productsWithDiscipline', 'productsWithoutDiscipline', 'productsWithUseContext', 'productsWithoutUseContext', 'secondaryFamilyCount', 'commercialRevenueTaxIncl', 'examples'], familyRows),
    'semantic_tag_utilization.csv': writeCsv(['axis', 'code', 'assignmentCount', 'evidenceRecordCount', 'productCount', 'activeCount', 'inactiveCount', 'historicalCount', 'sourceNameText', 'sourceTrustedCategory', 'sourceStructuredFeature', 'sourceFamilyInference', 'examples'], tagRows),
    'semantic_review_sample.csv': writeCsv(['productId', 'productName', 'catalogPresence', 'population', 'active', 'classificationStatus', 'primaryProductFamily', 'secondaryProductFamilies', 'disciplines', 'useContexts', 'reviewGroups', 'validOrderCount', 'unitsSold', 'totalRevenueTaxIncl', 'categories', 'features', 'provenance', 'primaryFamilyCorrect', 'secondaryFamiliesCorrect', 'disciplinesDefensible', 'useContextsDefensible', 'missingAxesAcceptable', 'suspiciousSignal', 'provenanceAdequate', 'humanReviewOutcome', 'humanReviewNotes'], reviewRows),
    'family_use_context_matrix.csv': writeCsv(['productFamily', ...matrixColumns(contextMatrix)], contextMatrix),
    'family_discipline_matrix.csv': writeCsv(['productFamily', ...matrixColumns(disciplineMatrix)], disciplineMatrix),
  };
  const semantic = products.filter(isSemanticProduct);
  const evidence = semantic.flatMap((product) => product.fact.provenance.evidence);
  const report = {
    audit: 'CATALOG-INTELLIGENCE-A00.5.2',
    snapshot: {
      snapshotId: snapshot.snapshotId,
      builtAt: snapshot.builtAt,
      sourceProductCount: snapshot.sourceProductCount,
      recordCount: snapshot.recordCount,
      ontologyVersion: snapshot.ontologyVersion,
      ontologyHash: snapshot.ontologyHash,
      classifierVersion: snapshot.classifierVersion,
      semanticChecksum: snapshot.semanticChecksum,
    },
    registryTagCounts: Object.fromEntries(AXES.map((axis) => [axis, registry.tags.filter((tag) => tag.axis === axis && !tag.residual).length])),
    classificationCounts: snapshot.classificationCounts,
    semanticUniverse: semantic.length,
    catalogMetadataJoin: {
      matched: products.filter((product) => product.meta !== undefined).length,
      unmatched: products.filter((product) => product.meta === undefined).length,
    },
    axisCoverage: buildCoverageRows(products),
    activeInactiveHistoricalCoverage: ['ACTIVE', 'INACTIVE', 'HISTORICAL'].map((name) => ({ population: name, rows: buildCoverageRows(products.filter((product) => product.population === name)) })),
    disciplineUtilization: buildAxisUtilization(snapshot, semantic, 'DISCIPLINE'),
    useContextUtilization: buildAxisUtilization(snapshot, semantic, 'USE_CONTEXT'),
    provenanceByAxis: buildProvenanceRows(semantic),
    multiLabel: {
      productsWithSecondaryFamilies: products.filter((product) => product.fact.secondaryProductFamilies.length > 0).length,
      combinations: buildMultiLabelRows(products),
      explicitControl2134: products.find((product) => product.fact.productId === '2134')?.fact ?? null,
    },
    otherReview: {
      total: products.filter((product) => product.fact.classificationStatus === 'OTHER').length,
      rowsWithEvidence: products.filter((product) => product.fact.classificationStatus === 'OTHER' && product.fact.provenance.evidence.length > 0).length,
      rowsWithoutEvidence: products.filter((product) => product.fact.classificationStatus === 'OTHER' && product.fact.provenance.evidence.length === 0).length,
    },
    commercialWeightedCoverage: weightedRows(products),
    evidenceCompliance: {
      allowedSourceTypes: ['NAME_TEXT', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'FAMILY_INFERENCE'],
      observedSourceTypes: [...new Set(evidence.map((entry) => entry.sourceType))].sort(),
      factsWithoutEvidence: semantic.reduce((sum, product) => sum + AXES.reduce((axisSum, axis) => axisSum + axisCodes(product.fact, axis).filter((code) => !product.fact.provenance.evidence.some((entry) => entry.axis === axis && entry.code === code)).length, 0), 0),
    },
    generatedFiles: [...Object.keys(outputFiles), 'semantic-coverage-report.json'].sort(),
  };
  for (const [fileName, contents] of Object.entries(outputFiles)) await writeFile(path.join(outputDirectory, fileName), contents, 'utf8');
  await writeFile(path.join(outputDirectory, 'semantic-coverage-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', outputDirectory, report }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown semantic coverage audit error';
  console.error(JSON.stringify({ status: 'blocked', error: { name: error instanceof Error ? error.name : 'Error', message } }, null, 2));
  process.exitCode = 1;
});
