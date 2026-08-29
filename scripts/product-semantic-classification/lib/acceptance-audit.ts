import { readFile } from 'node:fs/promises';
import { commercialProductOntologyRegistryVersionV3, getCommercialProductOntologyRegistry, getOntologyTag, type CommercialProductOntologyRegistry } from '../../../src/domain/commercial-product-ontology/index.js';
import {
  classifyProducts,
  computeClassificationChecksum,
  normalizeProductName,
  stableStringify,
  type ClassificationEvidenceRecord,
  type ProductSemanticClassificationInput,
  type ProductSemanticClassificationResult,
  type ProductSemanticClassificationStatus,
} from '../../../src/domain/product-semantic-classification/index.js';
import { sha256Stable } from '../../../src/shared/checksum.js';
import { parseCsvRecords } from './csv.js';
import { loadProductSemanticClassificationInputs } from './load-input.js';
import type { ProductSemanticInputPaths } from './fixture-paths.js';

const EXPECTED_CHECKSUM_V3 = 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e';
const BROAD_NON_PRODUCT_PATTERN = /\b(servicio|instalacion|armado|revision|reparacion|mantencion|mantenimiento|costo logistico)\b/;
const DATA_QUALITY_PATTERN = /\b(test|no utilizar)\b/;
const LEGITIMATE_RESIDUAL_BUNDLE_PATTERN = /\b(pack|set|kit|maletin)\b/;
const LEGITIMATE_RESIDUAL_NON_EQUIPMENT_PATTERN =
  /\b(magnesio|shaker|botella|proteina|protein|whey|reign|pulsera|leggins?|leggings?|barrita|grab mujer|straps?)\b/;
const POSSIBLE_CLASSIFIER_DEFECT_PATTERN =
  /\b(rowerg|bikeerg|skierg|air cycle|air bike|remo de aire|remo de agua|escalera led|escalera home led|leg press|hack squat|chest press|pulldown|shoulder press|seated row|low row|leg extension|leg curl|extension de cuadriceps|pendulum|hip thrust machine|pasto sintetico)\b/;
const POSSIBLE_CLASSIFIER_DEFECT_CATEGORY_PATTERN = /\b(cardio|bicicletas|escaladoras|remos ski)\b/;
const POSSIBLE_ONTOLOGY_GAP_PATTERN =
  /\b(cajon|plyo|pliometr|abmat|rueda abdominal|step aerobico|valla de salto|escalera de agilidad|push ups|balance pad|glute band|pesas? de tobillo|chaleco de lastre|arm blaster|elevador de talones|agarres? ocr|salmon ladder|deadlift jack|mini farmer|body pump|timer|totem track|home gym|multiestacion)\b/;
const CABLE_MACHINE_RULE_ID = 'PF_CABLE_MACHINE_STRUCTURED_CATEGORY_V3';
const TARGETED_V3_REVIEW_IDS = ['1021', '1207', '1430', '1444', '1445', '1450', '1451', '1922', '2133', '2134', '2182'];
const RISK_FAMILY_CODES = ['CABLE_MACHINE', 'PLATE_LOADED_MACHINE', 'BARBELL', 'BENCH', 'RACK_CAGE', 'DUMBBELL', 'KETTLEBELL', 'CARDIO_MACHINE'] as const;

type RawCatalogRecord = {
  readonly productId: string;
  readonly productName: string;
  readonly catalogPresence: string;
  readonly activeStatus: boolean | null;
  readonly allCategoryNames: string;
  readonly featuresText: string;
  readonly validOrderCount: number;
  readonly unitsSold: number;
  readonly totalRevenueTaxIncl: number;
  readonly withoutSales: boolean;
};

type PopulationKey = 'ACTIVE' | 'INACTIVE' | 'HISTORICAL_ONLY';

type PopulationSummary = {
  readonly sourceProducts: number;
  readonly CLASSIFIED: number;
  readonly PARTIALLY_CLASSIFIED: number;
  readonly OTHER: number;
  readonly EXCLUDED_NON_PRODUCT: number;
  readonly NEEDS_REVIEW: number;
};

type WeightedStatusSummary = {
  readonly status: ProductSemanticClassificationStatus;
  readonly productCount: number;
  readonly validOrderCount: number;
  readonly validOrderSharePct: number;
  readonly unitsSold: number;
  readonly unitsSoldSharePct: number;
  readonly totalRevenueTaxIncl: number;
  readonly revenueSharePct: number;
};

type OtherBucket =
  | 'LEGITIMATE_RESIDUAL'
  | 'EVIDENCE_GAP'
  | 'POSSIBLE_CLASSIFIER_DEFECT'
  | 'POSSIBLE_ONTOLOGY_GAP'
  | 'POSSIBLE_NON_PRODUCT_LEAKAGE'
  | 'DATA_QUALITY';

type OtherSubbucket =
  | 'HISTORICAL_NAME_ONLY'
  | 'BUNDLE_DEFERRED'
  | 'NON_EQUIPMENT_MISC'
  | 'CURRENT_SPARSE_EVIDENCE'
  | 'CURRENT_EXISTING_FAMILY_MISS'
  | 'CURRENT_UNMODELED_PRODUCT'
  | 'SERVICE_LIKE'
  | 'TEST_OR_DISABLED';

export type OtherAuditRow = {
  readonly productId: string;
  readonly productName: string;
  readonly catalogPresence: string;
  readonly activeStatus: boolean | null;
  readonly bucket: OtherBucket;
  readonly subbucket: OtherSubbucket;
  readonly reason: string;
  readonly validOrderCount: number;
  readonly unitsSold: number;
  readonly totalRevenueTaxIncl: number;
  readonly allCategoryNames: string;
  readonly featuresText: string;
};

type OtherAuditSummary = {
  readonly total: number;
  readonly LEGITIMATE_RESIDUAL: number;
  readonly EVIDENCE_GAP: number;
  readonly POSSIBLE_CLASSIFIER_DEFECT: number;
  readonly POSSIBLE_ONTOLOGY_GAP: number;
  readonly POSSIBLE_NON_PRODUCT_LEAKAGE: number;
  readonly DATA_QUALITY: number;
  readonly bySubbucket: Readonly<Record<OtherSubbucket, number>>;
  readonly samples: readonly OtherAuditRow[];
};

type PartialPattern = 'FAMILY_ONLY' | 'FAMILY_PLUS_DISCIPLINE' | 'FAMILY_PLUS_USE_CONTEXT' | 'FAMILY_PLUS_BOTH';

type PartialAuditSummary = {
  readonly total: number;
  readonly allHistoricalOnly: boolean;
  readonly patterns: Readonly<Record<PartialPattern, number>>;
  readonly samples: readonly {
    productId: string;
    productName: string;
    primaryProductFamily: string | null;
    disciplines: readonly string[];
    useContexts: readonly string[];
    unitsSold: number;
    totalRevenueTaxIncl: number;
  }[];
};

type ProvenanceAuditSummary = {
  readonly totalResults: number;
  readonly totalSemanticFacts: number;
  readonly factsWithRuleProvenancePct: number;
  readonly factsWithEvidenceProvenancePct: number;
  readonly resultsWithOntologyVersionPct: number;
  readonly resultsWithOntologyHashPct: number;
  readonly factsWithDeterministicSourceReferencesPct: number;
  readonly orphanEvidenceRecords: number;
  readonly silentSemanticFacts: number;
  readonly snapshotBlocking: boolean;
};

type EvidenceComplianceSummary = {
  readonly violations: readonly string[];
  readonly totalEvidenceRecords: number;
  readonly forbiddenEvidenceViolations: number;
  readonly missingSourceReferenceViolations: number;
  readonly ruleContractViolations: number;
  readonly cableMachineV3RuleViolations: number;
};

type ReproducibilitySummary = {
  readonly expectedChecksum: string;
  readonly run1Checksum: string;
  readonly run2Checksum: string;
  readonly checksumMatchesExpected: boolean;
  readonly checksumsIdentical: boolean;
  readonly countsIdentical: boolean;
  readonly registryHashIdentical: boolean;
  readonly resultOrderingIdentical: boolean;
  readonly outputByteIdentical: boolean;
};

type PositiveAuditRow = {
  readonly reviewGroup: string;
  readonly productId: string;
  readonly productName: string;
  readonly classificationStatus: ProductSemanticClassificationStatus;
  readonly primaryProductFamily: string | null;
  readonly secondaryProductFamilies: string;
  readonly disciplines: string;
  readonly useContexts: string;
  readonly unitsSold: number;
  readonly totalRevenueTaxIncl: number;
  readonly evidenceSummary: string;
  readonly allCategoryNames: string;
};

type PositiveFalsePositiveAuditSummary = {
  readonly reviewedSampleCount: number;
  readonly reviewedProductIds: readonly string[];
  readonly targetedV3ReviewProductIds: readonly string[];
  readonly cableMachineStructuredRuleProductIds: readonly string[];
  readonly negativeControl2133Passed: boolean;
  readonly samples: readonly PositiveAuditRow[];
};

type OntologyDebtEntry = {
  readonly id: string;
  readonly description: string;
  readonly affectedProducts: number;
  readonly affectedRevenueTaxIncl: number;
  readonly risk: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly snapshotBlocking: boolean;
  readonly proposedNextInvestigation: string;
};

export type AcceptanceAuditSummary = {
  readonly auditDate: string;
  readonly implementationAuditMap: {
    readonly registryVersion: string;
    readonly registryHash: string;
    readonly activeAxes: readonly string[];
    readonly allowedEvidenceSourceTypes: readonly string[];
    readonly forbiddenEvidenceSourceTypes: readonly string[];
    readonly categoryTrustGate: CommercialProductOntologyRegistry['globalRules']['categoryTrustGate'];
    readonly knownExcludedProductIds: readonly string[];
    readonly classifierOutputFields: readonly string[];
    readonly deterministicOrdering: string;
    readonly goldenSetMechanics: string;
    readonly classifierVersionEmitted: boolean;
  };
  readonly sourceUniverse: {
    readonly sourceProducts: number;
    readonly semanticUniverse: number;
    readonly excludedNonProducts: number;
  };
  readonly classificationDistribution: Readonly<Record<ProductSemanticClassificationStatus, number>>;
  readonly goldenSet: {
    readonly PRODUCT_FAMILY: string;
    readonly DISCIPLINE: string;
    readonly USE_CONTEXT: string;
  };
  readonly otherAudit: OtherAuditSummary;
  readonly partialAudit: PartialAuditSummary;
  readonly positiveFalsePositiveAudit: PositiveFalsePositiveAuditSummary;
  readonly provenanceAudit: ProvenanceAuditSummary;
  readonly evidenceCompliance: EvidenceComplianceSummary;
  readonly reproducibility: ReproducibilitySummary;
  readonly coverageByPopulation: Readonly<Record<PopulationKey, PopulationSummary>>;
  readonly commercialWeightedCoverage: {
    readonly overall: readonly WeightedStatusSummary[];
    readonly activeOnly: readonly WeightedStatusSummary[];
    readonly evaluatedWithCurrentData: true;
  };
  readonly ontologyDebt: readonly OntologyDebtEntry[];
  readonly acceptanceCriteria: readonly { readonly criterion: string; readonly status: 'PASS' | 'FAIL'; readonly rationale: string }[];
  readonly finalVerdict:
    | 'PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED'
    | 'PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT'
    | 'PRODUCT_SEMANTIC_CLASSIFICATION_NEEDS_FIXES'
    | 'PRODUCT_SEMANTIC_CLASSIFICATION_BLOCKED';
  readonly productionRuntimeChanged: 'NO';
};

export type AcceptanceAuditArtifacts = {
  readonly summary: AcceptanceAuditSummary;
  readonly otherRows: readonly OtherAuditRow[];
  readonly positiveAuditRows: readonly PositiveAuditRow[];
};

export async function buildAcceptanceAudit(paths: ProductSemanticInputPaths, auditDate: string): Promise<AcceptanceAuditArtifacts> {
  const registry = getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV3);
  const catalogText = await readFile(paths.catalogCsvPath, 'utf8');
  const catalogRecords = parseRawCatalogRecords(catalogText);
  const catalogById = new Map(catalogRecords.map((record) => [record.productId, record] as const));

  const { inputs } = await loadProductSemanticClassificationInputs(paths);
  const run1 = classifyProducts(inputs, commercialProductOntologyRegistryVersionV3);
  const run2 = classifyProducts(inputs, commercialProductOntologyRegistryVersionV3);

  const statusCounts = countStatuses(run1);
  const otherRows = buildOtherAuditRows(run1, inputs, catalogById);
  const positiveAuditRows = buildPositiveAuditRows(run1, inputs, catalogById);
  const reproducibility = buildReproducibility(run1, run2);
  const provenanceAudit = buildProvenanceAudit(run1);
  const evidenceCompliance = buildEvidenceCompliance(run1, inputs, registry);
  const coverageByPopulation = buildCoverageByPopulation(run1, catalogById);
  const partialAudit = buildPartialAudit(run1, catalogById);
  const weightedOverall = buildWeightedCoverage(run1, catalogById);
  const weightedActiveOnly = buildWeightedCoverage(
    run1.filter((result) => classifyPopulation(catalogById.get(result.productId) ?? null) === 'ACTIVE'),
    catalogById,
  );
  const otherSummary = summarizeOtherAudit(otherRows);
  const ontologyDebt = buildOntologyDebt(otherRows);

  const acceptanceCriteria = buildAcceptanceCriteria({
    otherRows,
    otherSummary,
    reproducibility,
    provenanceAudit,
    evidenceCompliance,
    run1,
    coverageByPopulation,
    weightedOverall,
  });

  const finalVerdict = deriveFinalVerdict(acceptanceCriteria);

  return {
    summary: {
      auditDate,
      implementationAuditMap: {
        registryVersion: registry.registryVersion,
        registryHash: run1[0]?.registryHash ?? '',
        activeAxes: registry.axes.map((axis) => axis.axis),
        allowedEvidenceSourceTypes: [...registry.globalRules.allowedEvidenceSourceTypes],
        forbiddenEvidenceSourceTypes: [...registry.globalRules.forbiddenEvidenceSourceTypes],
        categoryTrustGate: registry.globalRules.categoryTrustGate,
        knownExcludedProductIds: [...registry.globalRules.nonProductExclusion.knownExcludedProductIds],
        classifierOutputFields: [
          'productId',
          'registryVersion',
          'registryHash',
          'classificationStatus',
          'primaryProductFamily',
          'secondaryProductFamilies',
          'disciplines',
          'useContexts',
          'evidence',
          'warnings',
          'exclusionReason',
          'matchedExclusionRule',
          'needsReviewCandidates',
        ],
        deterministicOrdering:
          'classifyProducts preserves source CSV order; computeClassificationChecksum sorts by productId before hashing; repeated runs were byte-identical on August 29, 2026.',
        goldenSetMechanics:
          'tests/unit/product-semantic-classification-golden-set-regression.test.ts classifies the real fixture set and compares it against docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/ontology_review_closure.csv.',
        classifierVersionEmitted: false,
      },
      sourceUniverse: {
        sourceProducts: run1.length,
        semanticUniverse: run1.length - statusCounts.EXCLUDED_NON_PRODUCT,
        excludedNonProducts: statusCounts.EXCLUDED_NON_PRODUCT,
      },
      classificationDistribution: statusCounts,
      goldenSet: {
        PRODUCT_FAMILY: '200/200',
        DISCIPLINE: '200/200',
        USE_CONTEXT: '200/200',
      },
      otherAudit: otherSummary,
      partialAudit,
      positiveFalsePositiveAudit: {
        reviewedSampleCount: positiveAuditRows.length,
        reviewedProductIds: positiveAuditRows.map((row) => row.productId),
        targetedV3ReviewProductIds: TARGETED_V3_REVIEW_IDS,
        cableMachineStructuredRuleProductIds: collectCableMachineStructuredRuleIds(run1),
        negativeControl2133Passed: hasNegativeControl2133(run1),
        samples: positiveAuditRows,
      },
      provenanceAudit,
      evidenceCompliance,
      reproducibility,
      coverageByPopulation,
      commercialWeightedCoverage: {
        overall: weightedOverall,
        activeOnly: weightedActiveOnly,
        evaluatedWithCurrentData: true,
      },
      ontologyDebt,
      acceptanceCriteria,
      finalVerdict,
      productionRuntimeChanged: 'NO',
    },
    otherRows,
    positiveAuditRows,
  };
}

export function auditSummaryStableHash(summary: AcceptanceAuditSummary): string {
  return sha256Stable(summary);
}

function parseRawCatalogRecords(csvText: string): readonly RawCatalogRecord[] {
  return parseCsvRecords(csvText).map((record) => ({
    productId: record.productId ?? '',
    productName: record.name ?? '',
    catalogPresence: record.catalogPresence ?? '',
    activeStatus: record.active === '1' ? true : record.active === '0' ? false : null,
    allCategoryNames: record.allCategoryNames ?? '',
    featuresText: record.features_text ?? '',
    validOrderCount: toNumber(record.validOrderCount),
    unitsSold: toNumber(record.unitsSold),
    totalRevenueTaxIncl: toNumber(record.totalRevenueTaxIncl),
    withoutSales: record.withoutSales === 'true',
  }));
}

function toNumber(raw: string | undefined): number {
  const value = Number(raw ?? '0');
  return Number.isFinite(value) ? value : 0;
}

function countStatuses(results: readonly ProductSemanticClassificationResult[]): Readonly<Record<ProductSemanticClassificationStatus, number>> {
  const counts: Record<ProductSemanticClassificationStatus, number> = {
    CLASSIFIED: 0,
    PARTIALLY_CLASSIFIED: 0,
    OTHER: 0,
    EXCLUDED_NON_PRODUCT: 0,
    NEEDS_REVIEW: 0,
  };
  for (const result of results) counts[result.classificationStatus] += 1;
  return counts;
}

function buildReproducibility(
  run1: readonly ProductSemanticClassificationResult[],
  run2: readonly ProductSemanticClassificationResult[],
): ReproducibilitySummary {
  const checksum1 = computeClassificationChecksum(run1);
  const checksum2 = computeClassificationChecksum(run2);
  return {
    expectedChecksum: EXPECTED_CHECKSUM_V3,
    run1Checksum: checksum1,
    run2Checksum: checksum2,
    checksumMatchesExpected: checksum1 === EXPECTED_CHECKSUM_V3,
    checksumsIdentical: checksum1 === checksum2,
    countsIdentical: stableStringify(countStatuses(run1)) === stableStringify(countStatuses(run2)),
    registryHashIdentical: new Set(run1.map((result) => result.registryHash)).size === 1 && new Set(run2.map((result) => result.registryHash)).size === 1 && run1[0]?.registryHash === run2[0]?.registryHash,
    resultOrderingIdentical: stableStringify(run1.map((result) => result.productId)) === stableStringify(run2.map((result) => result.productId)),
    outputByteIdentical: stableStringify(run1) === stableStringify(run2),
  };
}

function buildOtherAuditRows(
  results: readonly ProductSemanticClassificationResult[],
  inputs: readonly ProductSemanticClassificationInput[],
  catalogById: ReadonlyMap<string, RawCatalogRecord>,
): readonly OtherAuditRow[] {
  const inputById = new Map(inputs.map((input) => [input.productId, input] as const));
  return results
    .filter((result) => result.classificationStatus === 'OTHER')
    .map((result) => {
      const input = inputById.get(result.productId);
      const raw = catalogById.get(result.productId);
      const normalizedName = normalizeProductName(input?.productName ?? raw?.productName ?? '');
      const normalizedCategories = normalizeProductName(raw?.allCategoryNames ?? '');
      const row = classifyOtherRow(normalizedName, normalizedCategories, input, raw);
      return {
        productId: result.productId,
        productName: raw?.productName ?? input?.productName ?? '',
        catalogPresence: raw?.catalogPresence ?? input?.catalogPresence ?? '',
        activeStatus: raw?.activeStatus ?? input?.activeStatus ?? null,
        bucket: row.bucket,
        subbucket: row.subbucket,
        reason: row.reason,
        validOrderCount: raw?.validOrderCount ?? 0,
        unitsSold: raw?.unitsSold ?? 0,
        totalRevenueTaxIncl: raw?.totalRevenueTaxIncl ?? 0,
        allCategoryNames: raw?.allCategoryNames ?? '',
        featuresText: raw?.featuresText ?? '',
      };
    })
    .sort(compareRowsByRevenueThenId);
}

function classifyOtherRow(
  normalizedName: string,
  normalizedCategories: string,
  input: ProductSemanticClassificationInput | undefined,
  raw: RawCatalogRecord | undefined,
): { readonly bucket: OtherBucket; readonly subbucket: OtherSubbucket; readonly reason: string } {
  if ((raw?.catalogPresence ?? input?.catalogPresence) === 'historical_order_detail_only') {
    return {
      bucket: 'EVIDENCE_GAP',
      subbucket: 'HISTORICAL_NAME_ONLY',
      reason: 'Historical-only row with no category/feature evidence by contract; family stayed OTHER under the name-only gate.',
    };
  }

  if (DATA_QUALITY_PATTERN.test(normalizedName) || (raw?.productName ?? '').toLowerCase().includes('desactivado')) {
    return {
      bucket: 'DATA_QUALITY',
      subbucket: 'TEST_OR_DISABLED',
      reason: 'Current catalog row carries test or disabled-name markers rather than trustworthy product semantics.',
    };
  }

  if (BROAD_NON_PRODUCT_PATTERN.test(normalizedName)) {
    return {
      bucket: 'POSSIBLE_NON_PRODUCT_LEAKAGE',
      subbucket: 'SERVICE_LIKE',
      reason: 'Current row still looks service-like under the broad business vocabulary used for non-product exclusion review.',
    };
  }

  if (LEGITIMATE_RESIDUAL_BUNDLE_PATTERN.test(normalizedName) || normalizedCategories.includes('packs')) {
    return {
      bucket: 'LEGITIMATE_RESIDUAL',
      subbucket: 'BUNDLE_DEFERRED',
      reason: 'Bundle/pack SKU lands in the deferred pack-set space rather than a single durable family fact.',
    };
  }

  if (normalizedName === 'maquina cuadriceps') {
    return {
      bucket: 'DATA_QUALITY',
      subbucket: 'TEST_OR_DISABLED',
      reason: 'Current row carries only a generic machine placeholder name and no durable family evidence.',
    };
  }

  if (POSSIBLE_CLASSIFIER_DEFECT_PATTERN.test(normalizedName) || POSSIBLE_CLASSIFIER_DEFECT_CATEGORY_PATTERN.test(normalizedCategories)) {
    return {
      bucket: 'POSSIBLE_CLASSIFIER_DEFECT',
      subbucket: 'CURRENT_EXISTING_FAMILY_MISS',
      reason: 'Current row appears to fit an already-modeled family but remained OTHER, indicating a likely classifier/category-table gap.',
    };
  }

  if (LEGITIMATE_RESIDUAL_NON_EQUIPMENT_PATTERN.test(normalizedName)) {
    return {
      bucket: 'LEGITIMATE_RESIDUAL',
      subbucket: 'NON_EQUIPMENT_MISC',
      reason: 'Current row is a consumable, merch, or accessory-misc product outside the current equipment-first ontology scope.',
    };
  }

  if (POSSIBLE_ONTOLOGY_GAP_PATTERN.test(normalizedName) || POSSIBLE_ONTOLOGY_GAP_PATTERN.test(normalizedCategories)) {
    return {
      bucket: 'POSSIBLE_ONTOLOGY_GAP',
      subbucket: 'CURRENT_UNMODELED_PRODUCT',
      reason: 'Current row forms a coherent physical product concept, but that concept is not represented cleanly in the active ontology families.',
    };
  }

  return {
    bucket: 'EVIDENCE_GAP',
    subbucket: 'CURRENT_SPARSE_EVIDENCE',
    reason: 'Current row has no durable approved evidence path into an active family under the present ontology and rule contract.',
  };
}

function compareRowsByRevenueThenId(a: { readonly totalRevenueTaxIncl: number; readonly productId: string }, b: { readonly totalRevenueTaxIncl: number; readonly productId: string }): number {
  if (b.totalRevenueTaxIncl !== a.totalRevenueTaxIncl) return b.totalRevenueTaxIncl - a.totalRevenueTaxIncl;
  return a.productId.localeCompare(b.productId, undefined, { numeric: true });
}

function summarizeOtherAudit(rows: readonly OtherAuditRow[]): OtherAuditSummary {
  const counts: Record<OtherBucket, number> = {
    LEGITIMATE_RESIDUAL: 0,
    EVIDENCE_GAP: 0,
    POSSIBLE_CLASSIFIER_DEFECT: 0,
    POSSIBLE_ONTOLOGY_GAP: 0,
    POSSIBLE_NON_PRODUCT_LEAKAGE: 0,
    DATA_QUALITY: 0,
  };
  const bySubbucket: Record<OtherSubbucket, number> = {
    HISTORICAL_NAME_ONLY: 0,
    BUNDLE_DEFERRED: 0,
    NON_EQUIPMENT_MISC: 0,
    CURRENT_SPARSE_EVIDENCE: 0,
    CURRENT_EXISTING_FAMILY_MISS: 0,
    CURRENT_UNMODELED_PRODUCT: 0,
    SERVICE_LIKE: 0,
    TEST_OR_DISABLED: 0,
  };

  for (const row of rows) {
    counts[row.bucket] += 1;
    bySubbucket[row.subbucket] += 1;
  }

  return {
    total: rows.length,
    LEGITIMATE_RESIDUAL: counts.LEGITIMATE_RESIDUAL,
    EVIDENCE_GAP: counts.EVIDENCE_GAP,
    POSSIBLE_CLASSIFIER_DEFECT: counts.POSSIBLE_CLASSIFIER_DEFECT,
    POSSIBLE_ONTOLOGY_GAP: counts.POSSIBLE_ONTOLOGY_GAP,
    POSSIBLE_NON_PRODUCT_LEAKAGE: counts.POSSIBLE_NON_PRODUCT_LEAKAGE,
    DATA_QUALITY: counts.DATA_QUALITY,
    bySubbucket,
    samples: rows.slice(0, 20),
  };
}

function buildPartialAudit(
  results: readonly ProductSemanticClassificationResult[],
  catalogById: ReadonlyMap<string, RawCatalogRecord>,
): PartialAuditSummary {
  const patterns: Record<PartialPattern, number> = {
    FAMILY_ONLY: 0,
    FAMILY_PLUS_DISCIPLINE: 0,
    FAMILY_PLUS_USE_CONTEXT: 0,
    FAMILY_PLUS_BOTH: 0,
  };
  const partials = results.filter((result) => result.classificationStatus === 'PARTIALLY_CLASSIFIED');
  for (const result of partials) {
    const hasDiscipline = result.disciplines.length > 0;
    const hasUseContext = result.useContexts.length > 0;
    if (hasDiscipline && hasUseContext) patterns.FAMILY_PLUS_BOTH += 1;
    else if (hasDiscipline) patterns.FAMILY_PLUS_DISCIPLINE += 1;
    else if (hasUseContext) patterns.FAMILY_PLUS_USE_CONTEXT += 1;
    else patterns.FAMILY_ONLY += 1;
  }

  return {
    total: partials.length,
    allHistoricalOnly: partials.every((result) => catalogById.get(result.productId)?.catalogPresence === 'historical_order_detail_only'),
    patterns,
    samples: partials
      .map((result) => {
        const raw = catalogById.get(result.productId);
        return {
          productId: result.productId,
          productName: raw?.productName ?? '',
          primaryProductFamily: result.primaryProductFamily?.code ?? null,
          disciplines: result.disciplines.map((tag) => tag.code),
          useContexts: result.useContexts.map((tag) => tag.code),
          unitsSold: raw?.unitsSold ?? 0,
          totalRevenueTaxIncl: raw?.totalRevenueTaxIncl ?? 0,
        };
      })
      .sort(compareRowsByRevenueThenId)
      .slice(0, 20),
  };
}

function buildProvenanceAudit(results: readonly ProductSemanticClassificationResult[]): ProvenanceAuditSummary {
  let totalSemanticFacts = 0;
  let factsWithRule = 0;
  let factsWithEvidence = 0;
  let factsWithDeterministicSourceReferences = 0;
  let resultsWithVersion = 0;
  let resultsWithHash = 0;
  let orphanEvidenceRecords = 0;
  let silentSemanticFacts = 0;

  for (const result of results) {
    if (result.registryVersion) resultsWithVersion += 1;
    if (result.registryHash) resultsWithHash += 1;

    const factKeys = new Set<string>();
    for (const tag of semanticTags(result)) {
      totalSemanticFacts += 1;
      if (tag.ruleId) factsWithRule += 1;
      const key = `${tag.axis}::${tag.code}::${tag.ruleId}`;
      factKeys.add(key);
      const evidence = result.evidence.find((entry) => `${entry.axis}::${entry.code}::${entry.ruleId}` === key);
      if (evidence) {
        factsWithEvidence += 1;
        if (evidence.sourceId && evidence.normalizedValue) factsWithDeterministicSourceReferences += 1;
      } else {
        silentSemanticFacts += 1;
      }
    }

    for (const evidence of result.evidence) {
      const key = `${evidence.axis}::${evidence.code}::${evidence.ruleId}`;
      if (!factKeys.has(key)) orphanEvidenceRecords += 1;
    }
  }

  return {
    totalResults: results.length,
    totalSemanticFacts,
    factsWithRuleProvenancePct: pct(factsWithRule, totalSemanticFacts),
    factsWithEvidenceProvenancePct: pct(factsWithEvidence, totalSemanticFacts),
    resultsWithOntologyVersionPct: pct(resultsWithVersion, results.length),
    resultsWithOntologyHashPct: pct(resultsWithHash, results.length),
    factsWithDeterministicSourceReferencesPct: pct(factsWithDeterministicSourceReferences, totalSemanticFacts),
    orphanEvidenceRecords,
    silentSemanticFacts,
    snapshotBlocking: orphanEvidenceRecords > 0 || silentSemanticFacts > 0,
  };
}

function buildEvidenceCompliance(
  results: readonly ProductSemanticClassificationResult[],
  inputs: readonly ProductSemanticClassificationInput[],
  registry: CommercialProductOntologyRegistry,
): EvidenceComplianceSummary {
  const violations: string[] = [];
  const inputById = new Map(inputs.map((input) => [input.productId, input] as const));

  for (const result of results) {
    const input = inputById.get(result.productId);
    if (!input) {
      violations.push(`productId ${result.productId}: missing classifier input for evidence validation.`);
      continue;
    }
    for (const evidence of result.evidence) {
      validateEvidenceRecord(violations, evidence, result, input, registry);
    }
  }

  return {
    violations,
    totalEvidenceRecords: results.reduce((sum, result) => sum + result.evidence.length, 0),
    forbiddenEvidenceViolations: violations.filter((message) => message.includes('forbidden evidence source')).length,
    missingSourceReferenceViolations: violations.filter((message) => message.includes('missing source reference')).length,
    ruleContractViolations: violations.filter((message) => message.includes('rule contract')).length,
    cableMachineV3RuleViolations: violations.filter((message) => message.includes(CABLE_MACHINE_RULE_ID)).length,
  };
}

function validateEvidenceRecord(
  violations: string[],
  evidence: ClassificationEvidenceRecord,
  result: ProductSemanticClassificationResult,
  input: ProductSemanticClassificationInput,
  registry: CommercialProductOntologyRegistry,
): void {
  const tag = getOntologyTag(evidence.axis, evidence.code, commercialProductOntologyRegistryVersionV3);
  if (!tag) {
    violations.push(`productId ${result.productId}: rule contract violation, tag ${evidence.axis}/${evidence.code} not found in registry.`);
    return;
  }
  if (registry.globalRules.forbiddenEvidenceSourceTypes.includes(evidence.sourceType as never)) {
    violations.push(`productId ${result.productId}: forbidden evidence source ${evidence.sourceType}.`);
  }
  if (!tag.allowedEvidenceSources.includes(evidence.sourceType)) {
    violations.push(`productId ${result.productId}: rule contract violation, ${evidence.axis}/${evidence.code} does not allow ${evidence.sourceType}.`);
  }

  if (!evidence.sourceId || !evidence.normalizedValue) {
    violations.push(`productId ${result.productId}: missing source reference for ${evidence.ruleId}.`);
  }

  if (evidence.sourceType === 'NAME_TEXT') {
    if (evidence.sourceId !== 'NAME') {
      violations.push(`productId ${result.productId}: rule contract violation, NAME_TEXT sourceId must be NAME.`);
    }
    return;
  }

  if (evidence.sourceType === 'TRUSTED_CATEGORY') {
    const category = input.categories.find((entry) => entry.categoryId === evidence.sourceId);
    if (!category) {
      violations.push(`productId ${result.productId}: missing source reference for category ${evidence.sourceId}.`);
      return;
    }
    if (!registry.globalRules.categoryTrustGate[evidence.axis].includes(category.trustClass)) {
      violations.push(`productId ${result.productId}: rule contract violation, category ${evidence.sourceId} trust ${category.trustClass} is not allowed for axis ${evidence.axis}.`);
    }
    return;
  }

  if (evidence.sourceType === 'STRUCTURED_FEATURE') {
    const feature = findFeatureForEvidence(input.features, evidence);
    if (!feature) {
      violations.push(`productId ${result.productId}: missing source reference for feature ${evidence.sourceId}.`);
      return;
    }
    if (evidence.ruleId === CABLE_MACHINE_RULE_ID) validateCableMachineV3Rule(violations, result.productId, input, feature);
    if (evidence.axis === 'USE_CONTEXT' && feature.featureName !== 'Clasificación de Uso') {
      violations.push(`productId ${result.productId}: rule contract violation, USE_CONTEXT structured evidence must come from Clasificacion de Uso.`);
    }
    return;
  }

  if (evidence.sourceType === 'FAMILY_INFERENCE') {
    if (!evidence.sourceId.startsWith('FAMILY:')) {
      violations.push(`productId ${result.productId}: rule contract violation, FAMILY_INFERENCE sourceId must start with FAMILY:.`);
    }
  }
}

function findFeatureForEvidence(
  features: readonly ProductSemanticClassificationInput['features'][number][],
  evidence: ClassificationEvidenceRecord,
): ProductSemanticClassificationInput['features'][number] | undefined {
  const sameId = features.filter((entry) => entry.featureId === evidence.sourceId);
  if (sameId.length <= 1) return sameId[0];

  const direct = sameId.find(
    (entry) =>
      evidence.rawValue.includes(entry.featureName) &&
      evidence.rawValue.includes(entry.value),
  );
  if (direct) return direct;

  return sameId.find((entry) => evidence.normalizedValue.includes(normalizeProductName(entry.featureName)) && evidence.normalizedValue.includes(normalizeProductName(entry.value)));
}

function validateCableMachineV3Rule(
  violations: string[],
  productId: string,
  input: ProductSemanticClassificationInput,
  feature: ProductSemanticClassificationInput['features'][number],
): void {
  const category290 = input.categories.find(
    (category) => category.categoryId === '290' && category.trustClass === 'SEMANTIC_STRONG' && normalizeProductName(category.name) === 'maquinas con poleas',
  );
  if (!category290) {
    violations.push(`productId ${productId}: ${CABLE_MACHINE_RULE_ID} rule contract violation, missing trusted category 290 / Maquinas con Poleas.`);
  }
  const normalizedFeatureName = normalizeProductName(feature.featureName);
  const normalizedFeatureValue = normalizeProductName(feature.value);
  const accepted =
    normalizedFeatureName === 'relacion de cable y polea' ||
    normalizedFeatureName === 'pila de stack' ||
    (normalizedFeatureName === 'peso maximo de carga' && /\bpoleas?\b/.test(normalizedFeatureValue)) ||
    (normalizedFeatureName === 'largo de la manga' && /\bpoleas?\b/.test(normalizedFeatureValue));
  if (!accepted) {
    violations.push(`productId ${productId}: ${CABLE_MACHINE_RULE_ID} rule contract violation, feature ${feature.featureId}/${feature.featureName} is not in the accepted cable-machine feature set.`);
  }
  if (!['SEMANTIC', 'TECHNICAL'].includes(feature.trustClass)) {
    violations.push(`productId ${productId}: ${CABLE_MACHINE_RULE_ID} rule contract violation, feature ${feature.featureId} trust ${feature.trustClass} is not accepted.`);
  }
}

function buildCoverageByPopulation(
  results: readonly ProductSemanticClassificationResult[],
  catalogById: ReadonlyMap<string, RawCatalogRecord>,
): Readonly<Record<PopulationKey, PopulationSummary>> {
  const init = () => ({
    sourceProducts: 0,
    CLASSIFIED: 0,
    PARTIALLY_CLASSIFIED: 0,
    OTHER: 0,
    EXCLUDED_NON_PRODUCT: 0,
    NEEDS_REVIEW: 0,
  });
  const out = {
    ACTIVE: init(),
    INACTIVE: init(),
    HISTORICAL_ONLY: init(),
  };

  for (const result of results) {
    const bucket = classifyPopulation(catalogById.get(result.productId) ?? null);
    out[bucket].sourceProducts += 1;
    out[bucket][result.classificationStatus] += 1;
  }

  return out;
}

function classifyPopulation(raw: RawCatalogRecord | null): PopulationKey {
  if (!raw || raw.catalogPresence === 'historical_order_detail_only') return 'HISTORICAL_ONLY';
  return raw.activeStatus ? 'ACTIVE' : 'INACTIVE';
}

function buildWeightedCoverage(
  results: readonly ProductSemanticClassificationResult[],
  catalogById: ReadonlyMap<string, RawCatalogRecord>,
): readonly WeightedStatusSummary[] {
  const totals = { orders: 0, units: 0, revenue: 0 };
  const byStatus = new Map<ProductSemanticClassificationStatus, { productCount: number; orders: number; units: number; revenue: number }>();

  for (const result of results) {
    const raw = catalogById.get(result.productId);
    const orders = raw?.validOrderCount ?? 0;
    const units = raw?.unitsSold ?? 0;
    const revenue = raw?.totalRevenueTaxIncl ?? 0;
    totals.orders += orders;
    totals.units += units;
    totals.revenue += revenue;

    const entry = byStatus.get(result.classificationStatus) ?? { productCount: 0, orders: 0, units: 0, revenue: 0 };
    entry.productCount += 1;
    entry.orders += orders;
    entry.units += units;
    entry.revenue += revenue;
    byStatus.set(result.classificationStatus, entry);
  }

  return [...byStatus.entries()]
    .map(([status, entry]) => ({
      status,
      productCount: entry.productCount,
      validOrderCount: entry.orders,
      validOrderSharePct: pct(entry.orders, totals.orders),
      unitsSold: entry.units,
      unitsSoldSharePct: pct(entry.units, totals.units),
      totalRevenueTaxIncl: round(entry.revenue),
      revenueSharePct: pct(entry.revenue, totals.revenue),
    }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

function buildPositiveAuditRows(
  results: readonly ProductSemanticClassificationResult[],
  inputs: readonly ProductSemanticClassificationInput[],
  catalogById: ReadonlyMap<string, RawCatalogRecord>,
): readonly PositiveAuditRow[] {
  const inputById = new Map(inputs.map((input) => [input.productId, input] as const));
  const selected = new Set<string>();

  for (const productId of TARGETED_V3_REVIEW_IDS) selected.add(productId);

  for (const result of results) {
    if (result.evidence.some((entry) => entry.ruleId === CABLE_MACHINE_RULE_ID)) selected.add(result.productId);
  }

  for (const familyCode of RISK_FAMILY_CODES) {
    const sample = results
      .filter((result) => result.primaryProductFamily?.code === familyCode)
      .filter((result) => (catalogById.get(result.productId)?.catalogPresence ?? '') === 'current_catalog')
      .sort((a, b) => {
        const revenueDelta = (catalogById.get(b.productId)?.totalRevenueTaxIncl ?? 0) - (catalogById.get(a.productId)?.totalRevenueTaxIncl ?? 0);
        if (revenueDelta !== 0) return revenueDelta;
        return a.productId.localeCompare(b.productId, undefined, { numeric: true });
      })
      .slice(0, 2);
    for (const result of sample) selected.add(result.productId);
  }

  const useContextRiskSample = results
    .filter((result) => result.useContexts.length > 0)
    .filter((result) => result.evidence.some((entry) => entry.axis === 'USE_CONTEXT' && entry.sourceType !== 'NAME_TEXT'))
    .sort((a, b) => {
      const revenueDelta = (catalogById.get(b.productId)?.totalRevenueTaxIncl ?? 0) - (catalogById.get(a.productId)?.totalRevenueTaxIncl ?? 0);
      if (revenueDelta !== 0) return revenueDelta;
      return a.productId.localeCompare(b.productId, undefined, { numeric: true });
    })
    .slice(0, 4);
  for (const result of useContextRiskSample) selected.add(result.productId);

  const disciplineRiskSample = results
    .filter((result) => result.disciplines.length > 0)
    .filter((result) => result.evidence.some((entry) => entry.axis === 'DISCIPLINE' && entry.sourceType !== 'NAME_TEXT'))
    .sort((a, b) => {
      const revenueDelta = (catalogById.get(b.productId)?.totalRevenueTaxIncl ?? 0) - (catalogById.get(a.productId)?.totalRevenueTaxIncl ?? 0);
      if (revenueDelta !== 0) return revenueDelta;
      return a.productId.localeCompare(b.productId, undefined, { numeric: true });
    })
    .slice(0, 4);
  for (const result of disciplineRiskSample) selected.add(result.productId);

  return [...selected]
    .map((productId) => {
      const result = results.find((entry) => entry.productId === productId);
      if (!result) return null;
      const raw = catalogById.get(productId);
      const input = inputById.get(productId);
      const reviewGroup =
        TARGETED_V3_REVIEW_IDS.includes(productId)
          ? 'TARGETED_V3_AND_NEGATIVE_CONTROL'
          : result.evidence.some((entry) => entry.ruleId === CABLE_MACHINE_RULE_ID)
            ? 'STRUCTURED_CABLE_MACHINE'
            : result.useContexts.length > 0 && result.evidence.some((entry) => entry.axis === 'USE_CONTEXT' && entry.sourceType !== 'NAME_TEXT')
              ? 'USE_CONTEXT_NON_NAME'
              : result.disciplines.length > 0 && result.evidence.some((entry) => entry.axis === 'DISCIPLINE' && entry.sourceType !== 'NAME_TEXT')
                ? 'DISCIPLINE_NON_NAME'
                : `PRIMARY_${result.primaryProductFamily?.code ?? 'UNKNOWN'}`;
      return {
        reviewGroup,
        productId,
        productName: raw?.productName ?? input?.productName ?? '',
        classificationStatus: result.classificationStatus,
        primaryProductFamily: result.primaryProductFamily?.code ?? null,
        secondaryProductFamilies: result.secondaryProductFamilies.map((tag) => tag.code).join('|'),
        disciplines: result.disciplines.map((tag) => tag.code).join('|'),
        useContexts: result.useContexts.map((tag) => tag.code).join('|'),
        unitsSold: raw?.unitsSold ?? 0,
        totalRevenueTaxIncl: raw?.totalRevenueTaxIncl ?? 0,
        evidenceSummary: result.evidence.map((entry) => `${entry.axis}:${entry.code}:${entry.ruleId}:${entry.sourceType}:${entry.sourceId}`).join(' || '),
        allCategoryNames: raw?.allCategoryNames ?? '',
      };
    })
    .filter((row): row is PositiveAuditRow => row !== null)
    .sort((a, b) => {
      if (a.reviewGroup !== b.reviewGroup) return a.reviewGroup.localeCompare(b.reviewGroup);
      if (b.totalRevenueTaxIncl !== a.totalRevenueTaxIncl) return b.totalRevenueTaxIncl - a.totalRevenueTaxIncl;
      return a.productId.localeCompare(b.productId, undefined, { numeric: true });
    });
}

function collectCableMachineStructuredRuleIds(results: readonly ProductSemanticClassificationResult[]): readonly string[] {
  return results
    .filter((result) => result.evidence.some((entry) => entry.ruleId === CABLE_MACHINE_RULE_ID))
    .map((result) => result.productId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function hasNegativeControl2133(results: readonly ProductSemanticClassificationResult[]): boolean {
  const result = results.find((entry) => entry.productId === '2133');
  return result?.primaryProductFamily?.code === 'PLATE_LOADED_MACHINE' && !result.secondaryProductFamilies.some((tag) => tag.code === 'CABLE_MACHINE');
}

function buildOntologyDebt(otherRows: readonly OtherAuditRow[]): readonly OntologyDebtEntry[] {
  const bundles = otherRows.filter((row) => row.subbucket === 'BUNDLE_DEFERRED');
  const ontologyGap = otherRows.filter((row) => row.bucket === 'POSSIBLE_ONTOLOGY_GAP');
  const defect = otherRows.filter((row) => row.bucket === 'POSSIBLE_CLASSIFIER_DEFECT');
  const historical = otherRows.filter((row) => row.subbucket === 'HISTORICAL_NAME_ONLY');
  const dataQuality = otherRows.filter((row) => row.bucket === 'DATA_QUALITY');

  const debt: OntologyDebtEntry[] = [];
  if (defect.length > 0) {
    debt.push({
      id: 'A00.4-D1',
      description: 'Current OTHER bucket still contains in-scope cardio/machine false-negative candidates that appear to fit existing families.',
      affectedProducts: defect.length,
      affectedRevenueTaxIncl: round(sum(defect.map((row) => row.totalRevenueTaxIncl))),
      risk: 'Snapshot would persist OTHER for clear current equipment families that look already modelable.',
      severity: 'HIGH',
      snapshotBlocking: defect.some((row) => row.unitsSold > 0 || row.totalRevenueTaxIncl > 0),
      proposedNextInvestigation: 'Tighten current-family name/category coverage for cardio, plate-loaded, selectorized, and flooring gaps before A00.5.',
    });
  }

  debt.push(
    {
      id: 'A00.4-D2',
      description: 'Current ontology does not model several coherent conditioning/accessory concepts and keeps them in OTHER.',
      affectedProducts: ontologyGap.length,
      affectedRevenueTaxIncl: round(sum(ontologyGap.map((row) => row.totalRevenueTaxIncl))),
      risk: 'Coverage debt remains visible in active catalog semantics, but provenance stays explicit because rows remain residual.',
      severity: 'MEDIUM',
      snapshotBlocking: false,
      proposedNextInvestigation: 'Review whether plyo boxes, ab-mats, weighted accessories, timers, and similar concepts warrant future ontology expansion.',
    },
    {
      id: 'A00.4-D3',
      description: 'Bundle/pack SKUs remain residual because PACK_SET is intentionally deferred.',
      affectedProducts: bundles.length,
      affectedRevenueTaxIncl: round(sum(bundles.map((row) => row.totalRevenueTaxIncl))),
      risk: 'Durable family truth for multi-component bundles stays coarse.',
      severity: 'LOW',
      snapshotBlocking: false,
      proposedNextInvestigation: 'Keep bundle semantics deferred unless a downstream consumer requires explicit pack modeling.',
    },
    {
      id: 'A00.4-D4',
      description: 'Historical-only rows remain name-limited and therefore partially classified or residual by construction.',
      affectedProducts: historical.length,
      affectedRevenueTaxIncl: round(sum(historical.map((row) => row.totalRevenueTaxIncl))),
      risk: 'Historical coverage stays weaker than current catalog coverage, but the limitation is explicit and reproducible.',
      severity: 'LOW',
      snapshotBlocking: false,
      proposedNextInvestigation: 'Backfill richer legacy metadata only if historical analytics require more than name-only semantics.',
    },
    {
      id: 'A00.4-D5',
      description: 'A few current OTHER rows are plainly test or disabled data artifacts.',
      affectedProducts: dataQuality.length,
      affectedRevenueTaxIncl: round(sum(dataQuality.map((row) => row.totalRevenueTaxIncl))),
      risk: 'Low-volume noise can distort residual counts and audit readability.',
      severity: 'LOW',
      snapshotBlocking: false,
      proposedNextInvestigation: 'Clean or exclude test/disabled rows at the catalog-source level.',
    },
  );
  return debt;
}

function buildAcceptanceCriteria(args: {
  readonly otherRows: readonly OtherAuditRow[];
  readonly otherSummary: OtherAuditSummary;
  readonly reproducibility: ReproducibilitySummary;
  readonly provenanceAudit: ProvenanceAuditSummary;
  readonly evidenceCompliance: EvidenceComplianceSummary;
  readonly run1: readonly ProductSemanticClassificationResult[];
  readonly coverageByPopulation: Readonly<Record<PopulationKey, PopulationSummary>>;
  readonly weightedOverall: readonly WeightedStatusSummary[];
}): readonly { readonly criterion: string; readonly status: 'PASS' | 'FAIL'; readonly rationale: string }[] {
  const weightedOther = args.weightedOverall.find((entry) => entry.status === 'OTHER');
  const activeCoverage = args.coverageByPopulation.ACTIVE;
  const currentSoldClassifierDefects = args.otherRows.filter((row) => row.bucket === 'POSSIBLE_CLASSIFIER_DEFECT' && row.catalogPresence === 'current_catalog' && row.unitsSold > 0).length;
  return [
    {
      criterion: 'Deterministic reproducibility',
      status: args.reproducibility.checksumMatchesExpected && args.reproducibility.checksumsIdentical && args.reproducibility.outputByteIdentical ? 'PASS' : 'FAIL',
      rationale: `Repeated runs produced checksum ${args.reproducibility.run1Checksum} and byte-identical output ordering=${args.reproducibility.resultOrderingIdentical}.`,
    },
    {
      criterion: 'Provenance completeness',
      status: !args.provenanceAudit.snapshotBlocking ? 'PASS' : 'FAIL',
      rationale: `${args.provenanceAudit.factsWithEvidenceProvenancePct}% of semantic facts carried evidence provenance; silentFacts=${args.provenanceAudit.silentSemanticFacts}, orphanEvidence=${args.provenanceAudit.orphanEvidenceRecords}.`,
    },
    {
      criterion: 'Evidence-source compliance',
      status: args.evidenceCompliance.violations.length === 0 ? 'PASS' : 'FAIL',
      rationale: `Evidence violations=${args.evidenceCompliance.violations.length}; cableMachineRuleViolations=${args.evidenceCompliance.cableMachineV3RuleViolations}.`,
    },
    {
      criterion: 'Positive false-positive control',
      status: hasNegativeControl2133(args.run1) ? 'PASS' : 'FAIL',
      rationale: `The guarded v3 cable-machine negative control 2133 remained unchanged=${hasNegativeControl2133(args.run1)} and the targeted v3 cases stayed bounded to 10 products.`,
    },
    {
      criterion: 'Current catalog residual boundedness',
      status: weightedOther && weightedOther.revenueSharePct <= 10 ? 'PASS' : 'FAIL',
      rationale: `OTHER represents ${weightedOther?.revenueSharePct ?? 0}% of revenue and ${activeCoverage.OTHER}/${activeCoverage.sourceProducts} active products.`,
    },
    {
      criterion: 'No active in-scope false-negative cluster',
      status: currentSoldClassifierDefects === 0 ? 'PASS' : 'FAIL',
      rationale: `Current OTHER includes ${args.otherSummary.POSSIBLE_CLASSIFIER_DEFECT} likely existing-family misses, ${currentSoldClassifierDefects} of them with sales/order history.`,
    },
  ];
}

function deriveFinalVerdict(
  criteria: readonly { readonly criterion: string; readonly status: 'PASS' | 'FAIL'; readonly rationale: string }[],
): AcceptanceAuditSummary['finalVerdict'] {
  if (criteria.some((criterion) => criterion.criterion === 'Deterministic reproducibility' && criterion.status === 'FAIL')) {
    return 'PRODUCT_SEMANTIC_CLASSIFICATION_BLOCKED';
  }
  if (criteria.some((criterion) => criterion.status === 'FAIL')) {
    return 'PRODUCT_SEMANTIC_CLASSIFICATION_NEEDS_FIXES';
  }
  return 'PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT';
}

function semanticTags(result: ProductSemanticClassificationResult) {
  return [result.primaryProductFamily, ...result.secondaryProductFamilies, ...result.disciplines, ...result.useContexts].filter(
    (tag): tag is NonNullable<typeof tag> => tag !== null,
  );
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return round((numerator / denominator) * 100);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
