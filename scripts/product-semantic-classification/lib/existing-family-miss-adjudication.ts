import { readFile } from 'node:fs/promises';
import { classifyProducts, computeClassificationChecksum, type ProductSemanticClassificationInput, type ProductSemanticClassificationResult } from '../../../src/domain/product-semantic-classification/index.js';
import { commercialProductOntologyRegistryVersionV3, getCommercialProductOntologyRegistry, type CommercialProductOntologyRegistry, type OntologyEvidenceSourceType } from '../../../src/domain/commercial-product-ontology/index.js';
import { normalizeEvidenceValue } from '../../../src/domain/product-semantic-classification/normalize.js';
import { writeCsv } from './csv.js';
import { buildAcceptanceAudit } from './acceptance-audit.js';
import { parseCsvRecords } from './csv.js';
import { loadProductSemanticClassificationInputs } from './load-input.js';
import type { ProductSemanticInputPaths } from './fixture-paths.js';

const EXPECTED_CHECKSUM_V3 = '83d97a9ce4fb90fcf0159f80e81cc64e5518ae8be861659adc68a5c854bc3fe3';
const SOURCE_ACCEPTANCE_AUDIT_DATE = '2026-08-28';

type AdjudicationDecision =
  | 'CLEAR_EXISTING_FAMILY'
  | 'CONDITIONAL_EXISTING_FAMILY'
  | 'EVIDENCE_GAP'
  | 'ONTOLOGY_GAP'
  | 'DATA_QUALITY'
  | 'FALSE_POSITIVE_IN_A00_4_AUDIT';

type FalsePositiveRisk = 'LOW' | 'MEDIUM' | 'HIGH';

type CandidateDefinition = {
  readonly candidateFamily: string | null;
  readonly decision: AdjudicationDecision;
  readonly decisionReason: string;
  readonly ruleCandidate: string | null;
  readonly falsePositiveRisk: FalsePositiveRisk;
  readonly nameSignals: readonly string[];
  readonly supportingNeighbors: readonly string[];
  readonly collisionNeighbors: readonly string[];
};

export type ExistingFamilyMissAdjudicationRow = {
  readonly productId: string;
  readonly name: string;
  readonly currentStatus: string;
  readonly candidateFamily: string | null;
  readonly availableEvidence: string;
  readonly allowedEvidence: string;
  readonly disallowedEvidence: string;
  readonly trustedCategories: string;
  readonly structuredFeatures: string;
  readonly nameSignals: string;
  readonly decision: AdjudicationDecision;
  readonly decisionReason: string;
  readonly ruleCandidate: string | null;
  readonly falsePositiveRisk: FalsePositiveRisk;
  readonly commercialHistory: string;
  readonly activeStatus: boolean | null;
  readonly supportingNeighbors: readonly string[];
  readonly collisionNeighbors: readonly string[];
};

export type ExistingFamilyMissAdjudicationSummary = {
  readonly auditDate: string;
  readonly sourceAcceptanceAuditDate: string;
  readonly classificationChecksum: string;
  readonly checksumMatchesExpected: boolean;
  readonly productionRuntimeChanged: 'NO';
  readonly finalDecision: 'EXISTING_FAMILY_MISS_ADJUDICATION_COMPLETE' | 'EXISTING_FAMILY_MISS_ADJUDICATION_BLOCKED';
  readonly decisionCounts: Readonly<Record<AdjudicationDecision, number>>;
  readonly familiesAffected: readonly { readonly candidateFamily: string; readonly count: number }[];
  readonly totalCandidates: number;
  readonly rows: readonly ExistingFamilyMissAdjudicationRow[];
};

type CandidateCommercialRecord = {
  readonly validOrderCount: number;
  readonly unitsSold: number;
  readonly totalRevenueTaxIncl: number;
};

const RELEVANT_FEATURE_NAMES = new Set([
  'categoria',
  'pila de stack',
  'largo de la manga',
  'diametro de manga',
  'peso maximo de carga',
  'relacion de cable y polea',
  'resistencia',
  'pantalla',
  'velocidad',
  'clasificacion de uso',
  'modelo',
]);

const CANDIDATE_DEFINITIONS: Readonly<Record<string, CandidateDefinition>> = {
  '280': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact Spanish machine noun "extension de cuadriceps" already maps to a classified selectorized neighbor and does not collide with the plate-loaded wording actually used elsewhere in this catalog.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bextension de cuadriceps\\b/ -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['extension de cuadriceps'],
    supportingNeighbors: ['492'],
    collisionNeighbors: [],
  },
  '416': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The product name is the ergometer product type itself; "rowerg" is cardio-specific and no conflicting strength-machine neighbor shares that token.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\browerg\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['rowerg'],
    supportingNeighbors: [],
    collisionNeighbors: [],
  },
  '448': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The family is credible, but "shoulder press" also appears on selectorized machines. A safe closure needs a plate-loaded guard such as Olympic sleeve/load features, not the noun alone.',
    ruleCandidate: 'NAME_TEXT "shoulder press" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['shoulder press'],
    supportingNeighbors: ['447'],
    collisionNeighbors: ['1367'],
  },
  '1023': {
    candidateFamily: null,
    decision: 'DATA_QUALITY',
    decisionReason:
      'The row exposes only a generic name ("maquina cuadriceps") with no trusted category and no structured features, so domain review cannot land a reproducible family decision.',
    ruleCandidate: null,
    falsePositiveRisk: 'HIGH',
    nameSignals: ['maquina cuadriceps'],
    supportingNeighbors: ['492'],
    collisionNeighbors: ['1232', '1372'],
  },
  '1070': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact name "linear leg press" is already inside the plate-loaded neighborhood and does not collide with the selectorized wording used by the seated-stack variant.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\blinear leg press\\b/ -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['linear leg press'],
    supportingNeighbors: ['451', '1227'],
    collisionNeighbors: ['1378'],
  },
  '1071': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'Hack-squat naming is consistently plate-loaded in the current catalog and no conflicting selectorized or accessory neighbor shares the exact phrase.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bhack squat\\b/ -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['hack squat'],
    supportingNeighbors: ['450', '1229', '1272'],
    collisionNeighbors: [],
  },
  '1072': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "hip thrust machine" isolates the standalone machine population from bench, belt, and pad products that also mention hip thrust.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bhip thrust machine\\b/ -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['hip thrust machine'],
    supportingNeighbors: ['1226', '1234', '1659', '2020'],
    collisionNeighbors: ['1125', '1337', '2125'],
  },
  '1162': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The phrase "remo de aire" is a rowing-ergometer signal, not a strength-row station signal, and no conflicting classified neighbor uses that wording.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bremo de aire\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['remo de aire'],
    supportingNeighbors: ['1241'],
    collisionNeighbors: ['264', '265', '489', '503'],
  },
  '1179': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'BikeErg is an unambiguous cardio product token with no strength-family collisions in the current catalog.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bbikeerg\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['bikeerg'],
    supportingNeighbors: [],
    collisionNeighbors: [],
  },
  '1180': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'SkiErg is an unambiguous cardio product token with no conflicting non-cardio neighbor in the source universe.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bskierg\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['skierg'],
    supportingNeighbors: [],
    collisionNeighbors: [],
  },
  '1188': {
    candidateFamily: 'FLOORING',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'Synthetic turf roll naming is a direct flooring concept and does not collide with yoga/pilates or machine families.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bpasto sintetico\\b/ -> FLOORING',
    falsePositiveRisk: 'LOW',
    nameSignals: ['pasto sintetico'],
    supportingNeighbors: ['319', '723'],
    collisionNeighbors: [],
  },
  '1231': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "standing leg curl" matches the plate-loaded neighborhood and does not collide with the seated/prone stack machines.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bstanding leg curl\\b/ -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['standing leg curl'],
    supportingNeighbors: ['445'],
    collisionNeighbors: ['1373', '1374'],
  },
  '1232': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The family is likely correct, but "leg extension" crosses plate-loaded and selectorized neighborhoods. A safe fix needs a plate-loaded guard such as sleeve/load features.',
    ruleCandidate: 'NAME_TEXT "leg extension" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['leg extension'],
    supportingNeighbors: ['452'],
    collisionNeighbors: ['280', '1372'],
  },
  '1240': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "escalera led" is a cardio-machine signal in this catalog and avoids the agility-ladder collision created by the bare word "escalera".',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bescalera led\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['escalera led'],
    supportingNeighbors: ['1158'],
    collisionNeighbors: ['157', '2127', '2136'],
  },
  '1241': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The phrase "remo de agua" is a rowing-ergometer signal and does not collide with the strength-row machine population.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bremo de agua\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['remo de agua'],
    supportingNeighbors: ['1162'],
    collisionNeighbors: ['264', '265', '489', '503'],
  },
  '1289': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact token "air cycle" is cardio-specific and no non-cardio neighbor shares the phrase.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bair cycle\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['air cycle'],
    supportingNeighbors: ['2297'],
    collisionNeighbors: [],
  },
  '1360': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The Solid Rock row looks plate-loaded, but "chest press" also names selectorized machines. A closure rule should require a plate-loaded structured guard, not the noun alone.',
    ruleCandidate: 'NAME_TEXT "chest press" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['chest press'],
    supportingNeighbors: ['447'],
    collisionNeighbors: ['1364'],
  },
  '1361': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The row looks plate-loaded, but "pulldown" spans plate-loaded and cable-machine populations. A safe rule needs an explicit plate-loaded guard and cable exclusion.',
    ruleCandidate: 'NAME_TEXT "pulldown" + STRUCTURED_FEATURE sleeve/load guard + no cable tokens -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'HIGH',
    nameSignals: ['pulldown'],
    supportingNeighbors: ['449'],
    collisionNeighbors: ['176', '899', '1365'],
  },
  '1362': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The family is credible, but "shoulder press" appears in both machine neighborhoods. A future rule must carry a plate-loaded guard.',
    ruleCandidate: 'NAME_TEXT "shoulder press" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['shoulder press'],
    supportingNeighbors: ['447', '448'],
    collisionNeighbors: ['1367'],
  },
  '1363': {
    candidateFamily: 'PLATE_LOADED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The row likely belongs to the plate-loaded line, but low-row naming overlaps with selectorized and cable-row concepts. A structured plate-loaded guard is needed.',
    ruleCandidate: 'NAME_TEXT "low row" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE',
    falsePositiveRisk: 'HIGH',
    nameSignals: ['low row'],
    supportingNeighbors: ['1885'],
    collisionNeighbors: ['264', '503', '1366'],
  },
  '1364': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The stack feature strongly points to selectorized, but "chest press" by itself collides with plate-loaded machines. A stack guard is required for a safe rule.',
    ruleCandidate: 'NAME_TEXT "chest press" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['chest press'],
    supportingNeighbors: ['492'],
    collisionNeighbors: ['1360', '447'],
  },
  '1366': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The stack feature points to selectorized, but "seated row" overlaps with plate-loaded and row-machine naming. A future rule should combine the noun with stack evidence.',
    ruleCandidate: 'NAME_TEXT "seated row" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'HIGH',
    nameSignals: ['seated row'],
    supportingNeighbors: ['265', '489'],
    collisionNeighbors: ['446', '1885'],
  },
  '1367': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The family is plausible because of the stack feature, but the noun "shoulder press" also names plate-loaded rows in the current catalog.',
    ruleCandidate: 'NAME_TEXT "shoulder press" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['shoulder press'],
    supportingNeighbors: ['492'],
    collisionNeighbors: ['448', '1362'],
  },
  '1372': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The stack feature points to selectorized, but "leg extension" alone collides with the plate-loaded leg-extension neighborhood.',
    ruleCandidate: 'NAME_TEXT "leg extension" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['leg extension'],
    supportingNeighbors: ['280', '492'],
    collisionNeighbors: ['1232', '452'],
  },
  '1373': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "seated leg curl" is distinct from the standing plate-loaded curl and from bench attachments, so name-only classification is bounded.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bseated leg curl\\b/ -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['seated leg curl'],
    supportingNeighbors: [],
    collisionNeighbors: ['1231', '1381'],
  },
  '1374': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "prone leg curl" is a selectorized station concept in the current catalog and does not collide with the standing plate-loaded curl or bench accessories.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bprone leg curl\\b/ -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['prone leg curl'],
    supportingNeighbors: [],
    collisionNeighbors: ['1231', '1381'],
  },
  '1378': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CONDITIONAL_EXISTING_FAMILY',
    decisionReason:
      'The family is plausible because the row has a stack, but "seated leg press" stays too close to the plate-loaded leg-press neighborhood to clear on name alone.',
    ruleCandidate: 'NAME_TEXT "seated leg press" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'MEDIUM',
    nameSignals: ['seated leg press'],
    supportingNeighbors: [],
    collisionNeighbors: ['1070', '1227', '451'],
  },
  '1381': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "dual leg curl/extension" already expresses the selectorized dual-station concept and avoids the bench-attachment wording used elsewhere.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bdual leg curl\\/extension\\b/ -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['dual leg curl/extension'],
    supportingNeighbors: [],
    collisionNeighbors: ['1619', '1874', '440'],
  },
  '1385': {
    candidateFamily: 'SELECTORIZED_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The same exact dual-station phrase is present here and remains bounded away from pack and bench-accessory rows.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bdual leg curl\\/extension\\b/ -> SELECTORIZED_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['dual leg curl/extension'],
    supportingNeighbors: ['1381'],
    collisionNeighbors: ['1619', '1874', '440'],
  },
  '1619': {
    candidateFamily: null,
    decision: 'FALSE_POSITIVE_IN_A00_4_AUDIT',
    decisionReason:
      'This is a pack SKU containing two machines. Under the current ontology boundary, the residual pack space is intentional, so OTHER was already correct.',
    ruleCandidate: null,
    falsePositiveRisk: 'HIGH',
    nameSignals: ['pack duo leg curl/extension'],
    supportingNeighbors: ['1622', '1623'],
    collisionNeighbors: ['1381', '1385'],
  },
  '1881': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The exact phrase "escalera home led" is bounded to the cardio stair-machine population and avoids the agility-ladder collision of the bare word "escalera".',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bescalera home led\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['escalera home led'],
    supportingNeighbors: ['1158', '1240'],
    collisionNeighbors: ['157', '2127', '2136'],
  },
  '2297': {
    candidateFamily: 'CARDIO_MACHINE',
    decision: 'CLEAR_EXISTING_FAMILY',
    decisionReason:
      'The spaced form "air bike" is the same cardio concept already classified elsewhere as the unspaced "airbike" token.',
    ruleCandidate: 'NAME_TEXT exact phrase: /\\bair bike\\b/ -> CARDIO_MACHINE',
    falsePositiveRisk: 'LOW',
    nameSignals: ['air bike'],
    supportingNeighbors: ['779'],
    collisionNeighbors: [],
  },
};

export async function buildExistingFamilyMissAdjudication(
  paths: ProductSemanticInputPaths,
  auditDate: string,
): Promise<ExistingFamilyMissAdjudicationSummary> {
  await buildAcceptanceAudit(paths, SOURCE_ACCEPTANCE_AUDIT_DATE);
  const { inputs } = await loadProductSemanticClassificationInputs(paths);
  const results = classifyProducts(inputs, commercialProductOntologyRegistryVersionV3);
  const checksum = computeClassificationChecksum(results);
  const registry = getCommercialProductOntologyRegistry(commercialProductOntologyRegistryVersionV3);
  const commercialById = await loadCandidateCommercialHistory(paths.catalogCsvPath);

  const rows = Object.keys(CANDIDATE_DEFINITIONS)
    .slice()
    .sort((left, right) => Number(left) - Number(right))
    .map((productId) => {
      const commercial = commercialById.get(productId);
      return toAdjudicationRow(
        productId,
        commercial?.validOrderCount ?? 0,
        commercial?.unitsSold ?? 0,
        commercial?.totalRevenueTaxIncl ?? 0,
        inputs,
        results,
        registry,
      );
    });

  const decisionCounts = {
    CLEAR_EXISTING_FAMILY: 0,
    CONDITIONAL_EXISTING_FAMILY: 0,
    EVIDENCE_GAP: 0,
    ONTOLOGY_GAP: 0,
    DATA_QUALITY: 0,
    FALSE_POSITIVE_IN_A00_4_AUDIT: 0,
  } satisfies Record<AdjudicationDecision, number>;
  for (const row of rows) decisionCounts[row.decision] += 1;

  const familiesAffected = Array.from(
    rows.reduce((map, row) => {
      if (!row.candidateFamily) return map;
      map.set(row.candidateFamily, (map.get(row.candidateFamily) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .map(([candidateFamily, count]) => ({ candidateFamily, count }))
    .sort((left, right) => right.count - left.count || left.candidateFamily.localeCompare(right.candidateFamily));

  return {
    auditDate,
    sourceAcceptanceAuditDate: SOURCE_ACCEPTANCE_AUDIT_DATE,
    classificationChecksum: checksum,
    checksumMatchesExpected: checksum === EXPECTED_CHECKSUM_V3,
    productionRuntimeChanged: 'NO',
    finalDecision:
      rows.length === Object.keys(CANDIDATE_DEFINITIONS).length
        ? 'EXISTING_FAMILY_MISS_ADJUDICATION_COMPLETE'
        : 'EXISTING_FAMILY_MISS_ADJUDICATION_BLOCKED',
    decisionCounts,
    familiesAffected,
    totalCandidates: rows.length,
    rows,
  };
}

export function adjudicationCsv(summary: ExistingFamilyMissAdjudicationSummary): string {
  return writeCsv(
    [
      'productId',
      'name',
      'currentStatus',
      'candidateFamily',
      'availableEvidence',
      'allowedEvidence',
      'disallowedEvidence',
      'trustedCategories',
      'structuredFeatures',
      'nameSignals',
      'decision',
      'decisionReason',
      'ruleCandidate',
      'falsePositiveRisk',
      'commercialHistory',
      'activeStatus',
    ],
    summary.rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      currentStatus: row.currentStatus,
      candidateFamily: row.candidateFamily ?? '',
      availableEvidence: row.availableEvidence,
      allowedEvidence: row.allowedEvidence,
      disallowedEvidence: row.disallowedEvidence,
      trustedCategories: row.trustedCategories,
      structuredFeatures: row.structuredFeatures,
      nameSignals: row.nameSignals,
      decision: row.decision,
      decisionReason: row.decisionReason,
      ruleCandidate: row.ruleCandidate ?? '',
      falsePositiveRisk: row.falsePositiveRisk,
      commercialHistory: row.commercialHistory,
      activeStatus: row.activeStatus === null ? '' : String(row.activeStatus),
    })),
  );
}

export function renderExistingFamilyMissReleaseMarkdown(summary: ExistingFamilyMissAdjudicationSummary): string {
  const counts = summary.decisionCounts;
  const families = summary.familiesAffected.map((entry) => `- \`${entry.candidateFamily}\`: \`${entry.count}\``).join('\n');
  const dataQuality = summary.rows.filter((row) => row.decision === 'DATA_QUALITY').map((row) => `- \`${row.productId}\` \`${row.name}\``).join('\n') || '- none';
  const evidenceGap = summary.rows.filter((row) => row.decision === 'EVIDENCE_GAP').map((row) => `- \`${row.productId}\` \`${row.name}\``).join('\n') || '- none';
  const ontologyGap = summary.rows.filter((row) => row.decision === 'ONTOLOGY_GAP').map((row) => `- \`${row.productId}\` \`${row.name}\``).join('\n') || '- none';
  const highPriority = summary.rows
    .filter((row) => row.decision !== 'FALSE_POSITIVE_IN_A00_4_AUDIT' && row.commercialHistory !== 'orders=0 units=0 revenue=0')
    .slice()
    .sort((left, right) => parseRevenue(right.commercialHistory) - parseRevenue(left.commercialHistory))
    .slice(0, 10)
    .map((row) => `- \`${row.productId}\` \`${row.name}\` - ${row.decision} - ${row.commercialHistory}`)
    .join('\n');

  const ruleCandidates = summary.rows
    .filter((row) => row.ruleCandidate !== null)
    .map((row) => `- \`${row.productId}\` \`${row.name}\`: ${row.ruleCandidate}`)
    .join('\n');

  const falsePositiveRisks = summary.rows
    .filter((row) => row.decision === 'CONDITIONAL_EXISTING_FAMILY' || row.decision === 'FALSE_POSITIVE_IN_A00_4_AUDIT')
    .map(
      (row) =>
        `- \`${row.productId}\` \`${row.name}\` - risk \`${row.falsePositiveRisk}\`; supporting neighbors ${formatNeighborList(
          row.supportingNeighbors,
        )}; collision set ${formatNeighborList(row.collisionNeighbors)}`,
    )
    .join('\n');

  return `# CATALOG-INTELLIGENCE-A00.4.1 - Existing Family Miss Adjudication

Status: **READY**
Type: read-only domain/evidence adjudication for the 32 A00.4 existing-family-miss candidates.

## 1. Scope

This slice reviews exactly the 32 products flagged by A00.4 as:

\`CURRENT_EXISTING_FAMILY_MISS\`

It does not modify:

- ontology registry
- classifier rules
- ontology version
- ontology hash
- semantic checksum
- snapshot generation
- production runtime
- SearchProducts V2
- relationship engine
- \`customer-profile\`

Production runtime changed: **NO**

## 2. Methodology

The adjudication re-used the A00.4 candidate set derived from the acceptance audit dated
\`${summary.sourceAcceptanceAuditDate}\` and reviewed each row against the unchanged v3 classifier
output on \`${summary.auditDate}\`.

For each candidate, the review checked:

1. what existing family, if any, actually fits the product;
2. what evidence the current row really exposes;
3. whether that evidence is allowed by the current family policy;
4. whether a future rule candidate could be added without evident false positives in the local
   neighborhood.

Neighborhood review explicitly considered nearby products sharing:

- the relevant name token;
- trusted categories;
- structured machine features;
- the likely target family.

## 3. Evidence policy

Evidence priority used in the adjudication:

1. \`STRUCTURED_FEATURE\`
2. \`TRUSTED_CATEGORY\`
3. \`NAME_TEXT\`
4. bounded combinations of real signals

Still forbidden:

- \`FREE_TEXT_DESCRIPTION\`
- \`CAMPAIGN_CATEGORY\`
- \`NAVIGATION_CATEGORY\`
- \`LEGACY_CATEGORY\`
- \`UNKNOWN_CATEGORY\`
- \`NOISE_FEATURE\`
- \`PRESENTATION_FEATURE\`
- \`LOGISTICS_FEATURE\`

Comparison against the pre-closure A00.4 checksum:

- expected: \`${EXPECTED_CHECKSUM_V3}\`
- observed: \`${summary.classificationChecksum}\`
- matches baseline: \`${summary.checksumMatchesExpected}\`

## 4. Full adjudication table

\`\`\`csv
${adjudicationCsv(summary).trimEnd()}
\`\`\`

## 5. Counts by decision

- \`CLEAR_EXISTING_FAMILY\`: \`${counts.CLEAR_EXISTING_FAMILY}\`
- \`CONDITIONAL_EXISTING_FAMILY\`: \`${counts.CONDITIONAL_EXISTING_FAMILY}\`
- \`EVIDENCE_GAP\`: \`${counts.EVIDENCE_GAP}\`
- \`ONTOLOGY_GAP\`: \`${counts.ONTOLOGY_GAP}\`
- \`DATA_QUALITY\`: \`${counts.DATA_QUALITY}\`
- \`FALSE_POSITIVE_IN_A00_4_AUDIT\`: \`${counts.FALSE_POSITIVE_IN_A00_4_AUDIT}\`

## 6. Families affected

${families}

## 7. False-positive risks

The adjudication found three clear risk patterns:

- bare machine nouns like \`chest press\`, \`shoulder press\`, \`leg extension\`, \`pulldown\`,
  \`low row\`, and \`seated row\` cross plate-loaded, selectorized, and cable neighborhoods;
- bare \`escalera\` is unsafe because it collides with agility-ladder products, while the bounded
  phrases \`escalera led\` and \`escalera home led\` are safe;
- pack rows like \`1619\` must stay residual even when their component machines are semantically
  recognizable.

Conditional and false-positive rows:

${falsePositiveRisks}

## 8. Rule candidates

No production rule changed in this slice.

Safe-looking candidates carried forward to A00.4.2:

${ruleCandidates}

## 9. Cases that really were evidence gap

${evidenceGap}

## 10. Cases that really were ontology gap

${ontologyGap}

## 11. Cases that really were data quality

${dataQuality}

## 12. Commercial prioritization

Commercial history was used only for prioritization, not for semantic adjudication.

Top revenue/order candidates excluding the one audit false positive:

${highPriority}

## 13. Recommendation for the next slice

The adjudication supports a focused follow-up:

\`A00.4.2 - Existing Family Miss Rule Closure\`

Recommended scope for that slice:

- close the \`${counts.CLEAR_EXISTING_FAMILY}\` clear name-only misses first;
- add guarded closure only for the \`${counts.CONDITIONAL_EXISTING_FAMILY}\` conditional rows, where
  structured plate-loaded or stack evidence is needed to avoid false positives;
- leave \`1023\` in \`OTHER\` until source data improves;
- keep \`1619\` residual because it is a deferred pack SKU, not a single-family product.

## 14. Final decision

\`${summary.finalDecision}\`
`;
}

function toAdjudicationRow(
  productId: string,
  validOrderCount: number,
  unitsSold: number,
  totalRevenueTaxIncl: number,
  inputs: readonly ProductSemanticClassificationInput[],
  results: readonly ProductSemanticClassificationResult[],
  registry: CommercialProductOntologyRegistry,
): ExistingFamilyMissAdjudicationRow {
  const definition = CANDIDATE_DEFINITIONS[productId];
  if (!definition) throw new Error(`Missing A00.4.1 adjudication definition for productId ${productId}.`);

  const input = inputs.find((candidate) => candidate.productId === productId);
  const result = results.find((candidate) => candidate.productId === productId);
  if (!input || !result) throw new Error(`Missing classification row for productId ${productId}.`);

  const trustedCategories = input.categories
    .filter((category) => category.trustClass === 'SEMANTIC_STRONG' || category.trustClass === 'SEMANTIC_WEAK')
    .map((category) => `${category.categoryId}:${category.name}[${category.trustClass}]`);
  const forbiddenCategories = input.categories
    .filter((category) => category.trustClass !== 'SEMANTIC_STRONG' && category.trustClass !== 'SEMANTIC_WEAK' && category.trustClass !== 'UNKNOWN')
    .map((category) => `${category.categoryId}:${category.name}[${category.trustClass}]`);
  const relevantStructuredFeatures = input.features
    .filter((feature) => feature.trustClass === 'SEMANTIC' || feature.trustClass === 'TECHNICAL')
    .filter((feature) => RELEVANT_FEATURE_NAMES.has(normalizeEvidenceValue(feature.featureName)))
    .map((feature) => `${feature.featureId}:${feature.featureName}=${feature.value}[${feature.trustClass}]`);

  const availableEvidenceParts = [
    definition.nameSignals.length > 0 ? `NAME_TEXT:${definition.nameSignals.join(' + ')}` : null,
    trustedCategories.length > 0 ? `TRUSTED_CATEGORY:${trustedCategories.join(' ; ')}` : null,
    relevantStructuredFeatures.length > 0 ? `STRUCTURED_FEATURE:${relevantStructuredFeatures.join(' ; ')}` : null,
  ].filter((value): value is string => value !== null);

  const allowedSources =
    definition.candidateFamily === null
      ? new Set<OntologyEvidenceSourceType>()
      : new Set(
          registry.axes
            .find((axisDefinition) => axisDefinition.axis === 'PRODUCT_FAMILY')
            ?.tags.find((tagDefinition) => tagDefinition.code === definition.candidateFamily)
            ?.allowedEvidenceSources ?? [],
        );

  const allowedEvidenceParts = [
    allowedSources.has('NAME_TEXT') && definition.nameSignals.length > 0 ? `NAME_TEXT:${definition.nameSignals.join(' + ')}` : null,
    allowedSources.has('TRUSTED_CATEGORY') && trustedCategories.length > 0 ? `TRUSTED_CATEGORY:${trustedCategories.join(' ; ')}` : null,
    allowedSources.has('STRUCTURED_FEATURE') && relevantStructuredFeatures.length > 0 ? `STRUCTURED_FEATURE:${relevantStructuredFeatures.join(' ; ')}` : null,
  ].filter((value): value is string => value !== null);

  const disallowedEvidenceParts = [
    !allowedSources.has('TRUSTED_CATEGORY') && trustedCategories.length > 0 ? `TRUSTED_CATEGORY not allowed here: ${trustedCategories.join(' ; ')}` : null,
    !allowedSources.has('STRUCTURED_FEATURE') && relevantStructuredFeatures.length > 0
      ? `STRUCTURED_FEATURE not allowed here: ${relevantStructuredFeatures.join(' ; ')}`
      : null,
    forbiddenCategories.length > 0 ? `FORBIDDEN_CATEGORY:${forbiddenCategories.join(' ; ')}` : null,
  ].filter((value): value is string => value !== null);

  return {
    productId,
    name: input.productName,
    currentStatus: result.classificationStatus,
    candidateFamily: definition.candidateFamily,
    availableEvidence: availableEvidenceParts.join(' || ') || 'N/A',
    allowedEvidence: allowedEvidenceParts.join(' || ') || 'N/A',
    disallowedEvidence: disallowedEvidenceParts.join(' || ') || 'N/A',
    trustedCategories: trustedCategories.join(' || ') || 'N/A',
    structuredFeatures: relevantStructuredFeatures.join(' || ') || 'N/A',
    nameSignals: definition.nameSignals.join(' || ') || 'N/A',
    decision: definition.decision,
    decisionReason: definition.decisionReason,
    ruleCandidate: definition.ruleCandidate,
    falsePositiveRisk: definition.falsePositiveRisk,
    commercialHistory: `orders=${validOrderCount} units=${unitsSold} revenue=${totalRevenueTaxIncl}`,
    activeStatus: input.activeStatus,
    supportingNeighbors: definition.supportingNeighbors,
    collisionNeighbors: definition.collisionNeighbors,
  };
}

async function loadCandidateCommercialHistory(catalogCsvPath: string): Promise<ReadonlyMap<string, CandidateCommercialRecord>> {
  const text = await readFile(catalogCsvPath, 'utf8');
  const records = parseCsvRecords(text);
  return new Map(
    records.map((record) => [
      record.productId ?? '',
      {
        validOrderCount: toNumber(record.validOrderCount),
        unitsSold: toNumber(record.unitsSold),
        totalRevenueTaxIncl: toNumber(record.totalRevenueTaxIncl),
      },
    ]),
  );
}

function toNumber(raw: string | undefined): number {
  const value = Number(raw ?? '0');
  return Number.isFinite(value) ? value : 0;
}

function parseRevenue(commercialHistory: string): number {
  const match = /revenue=([0-9.]+)/.exec(commercialHistory);
  return match ? Number(match[1]) : 0;
}

function formatNeighborList(productIds: readonly string[]): string {
  return productIds.length === 0 ? 'none' : productIds.map((productId) => `\`${productId}\``).join(', ');
}
