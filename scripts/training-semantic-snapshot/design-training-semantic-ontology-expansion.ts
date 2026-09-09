import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCsv } from '../product-semantic-classification/lib/csv.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../../docs/design/training-semantics/a00.6.4');
const RESOLUTION_REPORT = path.resolve(SCRIPT_DIR, '../../docs/audits/training-semantics/a00.6.2/training-semantic-resolution-report.json');
const EXPECTED_ONTOLOGY_GAPS = 41;
const DENOMINATOR = 240;
const CURRENT_RESOLVED = 180;
const TARGET_RESOLVED = 228;

type ResolutionRecord = {
  readonly productId: number;
  readonly name: string;
  readonly active: boolean;
  readonly productFamily: string;
  readonly currentCoverageStatus: string;
  readonly resolutionState: string;
  readonly commercialContext: { readonly revenue: number | null; readonly orderLines: number | null; readonly unitsSold: number | null };
  readonly reason: string;
};
type Proposal = {
  readonly actualFunctionalTruth: string;
  readonly candidateSemanticConcept: string;
  readonly candidateAxis: 'TRAINING_FUNCTION' | 'EXERCISE_CAPABILITY' | 'RULE_CLOSURE';
  readonly sourcePolicy: string;
  readonly relationMode: 'FAMILY_DERIVED' | 'DIRECT' | 'SUPPORTED' | 'RULE_CLOSURE';
  readonly proposedResolution: 'SEMANTIC_COMPLETE' | 'SEMANTIC_PARTIAL';
  readonly confidence: 'HIGH' | 'MEDIUM';
  readonly note: string;
};
type JsonReport = {
  readonly authority: Record<string, unknown>;
  readonly records: readonly ResolutionRecord[];
  readonly kpis: Record<string, number>;
};

const proposals = new Map<number, Proposal>();

function add(ids: readonly number[], proposal: Proposal): void {
  for (const id of ids) proposals.set(id, proposal);
}

add([1121, 1535, 1539, 1544], {
  actualFunctionalTruth: 'Supports and positions a free barbell for loaded training; it does not assert a squat exercise.',
  candidateSemanticConcept: 'BARBELL_SUPPORT', candidateAxis: 'TRAINING_FUNCTION', sourcePolicy: 'TRUSTED_CATEGORY+NAME', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Do not derive generic SQUAT; support function is the Product Truth.'
});
add([1274, 1922, 2068, 2133, 2134], {
  actualFunctionalTruth: 'Provides guided or fixed-path barbell support through a Smith/Multipower structure.',
  candidateSemanticConcept: 'GUIDED_BARBELL_SUPPORT', candidateAxis: 'TRAINING_FUNCTION', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'A guided bar path is distinct from a generic rack and does not imply generic SQUAT.'
});
add([1126], {
  actualFunctionalTruth: 'Provides a bodyweight training support/obstacle surface without asserting one exercise capability.',
  candidateSemanticConcept: 'BODYWEIGHT_SUPPORT', candidateAxis: 'TRAINING_FUNCTION', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Do not infer PULL_UP or DIP without an explicit module.'
});
add([1450, 1451], {
  actualFunctionalTruth: 'Provides a general cable-resistance station for multiple exercises.',
  candidateSemanticConcept: 'CABLE_RESISTANCE', candidateAxis: 'TRAINING_FUNCTION', sourcePolicy: 'PRODUCT_FAMILY+TRUSTED_CATEGORY+NAME', relationMode: 'FAMILY_DERIVED', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'This is not LAT_PULLDOWN, ROW or TRICEPS_EXTENSION.'
});
add([1455, 1921], {
  actualFunctionalTruth: 'Provides multi-directional cable resistance through crossover/dual cable geometry.',
  candidateSemanticConcept: 'CABLE_RESISTANCE|MULTI_DIRECTIONAL_RESISTANCE', candidateAxis: 'TRAINING_FUNCTION', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'The second function requires explicit crossover/dual-cable evidence; it is not derived from every cable machine.'
});
add([258], {
  actualFunctionalTruth: 'Dedicated triceps-extension machine.',
  candidateSemanticConcept: 'TRICEPS_EXTENSION', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+STRUCTURED_FEATURE', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Promote only as a narrow explicit exercise capability.'
});
add([491, 1273, 1275, 1655, 1658, 1662, 2018, 2188], {
  actualFunctionalTruth: 'Dedicated leg-press machine with explicit press geometry.',
  candidateSemanticConcept: 'LEG_PRESS', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Active explicit products materially support promotion; this is not generic lower-body equipment.'
});
add([1229, 1272, 1654, 1661, 1884, 2019], {
  actualFunctionalTruth: 'Dedicated squat-machine product with explicit hack/V-squat/squat-machine wording.',
  candidateSemanticConcept: 'HACK_SQUAT', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY+STRUCTURED_FEATURE', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'MEDIUM', note: 'Requires a mechanism/geometry gate for generic “Squat Machine”; never reintroduce generic SQUAT.'
});
add([1660], {
  actualFunctionalTruth: 'Dual dedicated hack/press machine supporting two explicit lower-body exercise functions.',
  candidateSemanticConcept: 'HACK_SQUAT|LEG_PRESS', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Multifunction completeness requires both assignments, not one dominant label.'
});
add([1284, 1511], {
  actualFunctionalTruth: 'Dedicated standing/seated calf-raise machine.',
  candidateSemanticConcept: 'CALF_RAISE', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'New narrow exercise capability; do not infer from every lower-body machine.'
});
add([1266, 1664], {
  actualFunctionalTruth: 'Machine explicitly combining pec-fly/chest-fly and rear-delt-fly functions.',
  candidateSemanticConcept: 'PEC_DECK|REAR_DELT_FLY', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Requires exhaustive multi-assignment; REAR_DELT_FLY is the narrow new capability.'
});
add([1507], {
  actualFunctionalTruth: 'Dual biceps/triceps machine with two explicit exercise functions.',
  candidateSemanticConcept: 'BICEPS_CURL|TRICEPS_EXTENSION', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Both exercise capabilities are required; one assignment would be partial.'
});
add([1655], {
  actualFunctionalTruth: 'Pivoting leg-press machine; included in the LEG_PRESS family only with explicit geometry validation.',
  candidateSemanticConcept: 'LEG_PRESS', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'The pivot mechanism must be confirmed in structured evidence during V2 migration.'
});
add([1663], {
  actualFunctionalTruth: 'Pendulum squat machine with explicit pendulum geometry.',
  candidateSemanticConcept: 'PENDULUM_SQUAT', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Do not collapse pendulum squat into generic SQUAT.'
});
add([2021], {
  actualFunctionalTruth: 'Dedicated belt-squat machine.',
  candidateSemanticConcept: 'BELT_SQUAT', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'A distinct capability is safer than generic SQUAT.'
});
add([2022], {
  actualFunctionalTruth: 'Dedicated reverse-hyper machine.',
  candidateSemanticConcept: 'REVERSE_HYPER', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Explicit product function; no anatomy derivation is implied.'
});
add([2026], {
  actualFunctionalTruth: 'Multi deadlift training machine with explicit deadlift wording.',
  candidateSemanticConcept: 'DEADLIFT', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'Reevaluate the previous accessory-only DEADLIFT finding; this product is a separate active machine.'
});
add([2091], {
  actualFunctionalTruth: 'Dedicated pullover machine.',
  candidateSemanticConcept: 'PULLOVER', candidateAxis: 'EXERCISE_CAPABILITY', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'DIRECT', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'New narrow exercise capability; do not infer from generic cable machines.'
});
add([2089], {
  actualFunctionalTruth: 'Explicit 3D hip-thrust machine; existing HIP_THRUST capability is applicable.',
  candidateSemanticConcept: 'HIP_THRUST', candidateAxis: 'RULE_CLOSURE', sourcePolicy: 'NAME+PRODUCT_FAMILY', relationMode: 'RULE_CLOSURE', proposedResolution: 'SEMANTIC_COMPLETE', confidence: 'HIGH', note: 'This is a classifier rule closure, not a new ontology concept.'
});

const functionCandidates = [
  ['EXTERNAL_LOAD', 'No unique 41-product evidence', 'DO_NOT_ADD', 'Too broad; not discriminative for discovery.'],
  ['FREE_WEIGHT_LOAD', 'BARBELL/DUMBBELL/KETTLEBELL families, no ontology-gap evidence', 'DO_NOT_ADD', 'Duplicates Product Family unless modality evidence is added later.'],
  ['SELECTORIZED_RESISTANCE', 'SELECTORIZED_MACHINE family', 'DO_NOT_ADD', 'Directly repeats Product Family.'],
  ['PLATE_LOADED_RESISTANCE', 'PLATE_LOADED_MACHINE family', 'DO_NOT_ADD', 'Directly repeats Product Family.'],
  ['CABLE_RESISTANCE', '1450,1451,1455,1921', 'ADD', 'General resistance delivery is useful without inventing an exercise.'],
  ['MULTI_DIRECTIONAL_RESISTANCE', '1455,1921', 'ADD', 'Only explicit crossover/dual geometry qualifies.'],
  ['BODYWEIGHT_SUPPORT', '1126', 'ADD', 'Represents support/obstacle utility without exercise overclaim.'],
  ['BARBELL_SUPPORT', '1121,1535,1539,1544', 'ADD', 'Represents a rack/stand function, not SQUAT.'],
  ['GUIDED_BARBELL_SUPPORT', '1274,1922,2068,2133,2134', 'ADD', 'Distinguishes Smith/Multipower guided path from open rack.'],
  ['SAFETY_SUPPORT', 'No sufficient structured evidence in the 41', 'CONDITIONAL', 'Add only when safety arms/catches are explicit structured Product Truth.'],
  ['UNILATERAL_LOAD', '2018 wording is insufficient for universal function', 'DO_NOT_ADD', 'Keep as a feature/structured attribute until repeated evidence exists.'],
  ['BILATERAL_LOAD', 'No sufficient evidence', 'DO_NOT_ADD', 'No material resolution gain.'],
  ['BALLISTIC_LOAD', 'No sufficient evidence', 'DO_NOT_ADD', 'No material resolution gain.'],
  ['CARRY_LOAD', 'No sufficient evidence', 'DO_NOT_ADD', 'No material resolution gain.'],
  ['SUSPENSION_SUPPORT', 'No sufficient evidence in the 41', 'DO_NOT_ADD', 'Revisit only with explicit suspension products.'],
  ['DRAG_PUSH_RESISTANCE', 'ROPE_SLED is already a verified negative, not an ontology gap', 'DO_NOT_ADD_IN_MINIMUM', 'Potential future discovery concept, no A00.6.4 target gain.'],
  ['ANCHOR_SUPPORT', 'No sufficient evidence', 'DO_NOT_ADD', 'No material resolution gain.'],
] as const;

const exerciseCandidates = [
  ['HACK_SQUAT', '1229,1272,1654,1660,1661,1884,2019', 7, 'ADD', 'Explicit dedicated hack/V-squat evidence with mechanism gate.'],
  ['LEG_PRESS', '491,1273,1275,1655,1658,1662,2018,2188', 8, 'ADD', 'Eight active explicit leg-press products.'],
  ['CALF_RAISE', '1284,1511', 2, 'ADD', 'Explicit standing/seated calf-raise machines.'],
  ['REAR_DELT_FLY', '1266,1664', 2, 'ADD', 'Required for exhaustive dual pec-fly/rear-delt products.'],
  ['BICEPS_CURL', '1507', 1, 'ADD', 'Explicit dual biceps/triceps product.'],
  ['TRICEPS_EXTENSION', '258,1507', 2, 'ADD', 'One dedicated active product plus one dual machine.'],
  ['PENDULUM_SQUAT', '1663', 1, 'ADD', 'Explicit pendulum geometry.'],
  ['BELT_SQUAT', '2021', 1, 'ADD', 'Explicit belt-squat product; no generic SQUAT.'],
  ['REVERSE_HYPER', '2022', 1, 'ADD', 'Explicit reverse-hyper product.'],
  ['DEADLIFT', '2026', 1, 'LIMITED_ADD', 'Explicit active machine, distinct from the dropped accessory finding.'],
  ['PULLOVER', '2091', 1, 'ADD', 'Explicit dedicated pullover machine.'],
  ['HIP_THRUST', '2089', 1, 'RULE_CLOSURE', 'Existing V1 concept; classifier fix only.'],
] as const;

function csvRow(record: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? value.join('|') : value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value)]));
}

function proposalRows(records: readonly ResolutionRecord[]) {
  return records.filter((record) => record.resolutionState === 'ONTOLOGY_GAP').sort((left, right) => left.productId - right.productId).map((record) => {
    const proposal = proposals.get(record.productId);
    if (!proposal) throw new Error(`Missing A00.6.4 proposal for product ${record.productId}`);
    return csvRow({ productId: record.productId, name: record.name, productFamily: record.productFamily, active: record.active, revenue: record.commercialContext.revenue, currentState: record.resolutionState, whyV1CannotRepresent: record.reason, actualFunctionalProductTruth: proposal.actualFunctionalTruth, candidateSemanticConcept: proposal.candidateSemanticConcept, candidateAxis: proposal.candidateAxis, sourcePolicy: proposal.sourcePolicy, relationMode: proposal.relationMode, proposedResolution: proposal.proposedResolution, confidence: proposal.confidence, note: proposal.note });
  });
}

function renderMarkdown(report: JsonReport, gaps: readonly Record<string, string | number | boolean | null>[], simulation: readonly Record<string, string | number | boolean | null>[]): string {
  const table = (headers: readonly string[], rows: readonly (readonly unknown[])[]) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map((value) => String(value ?? '').replace(/\|/gu, '\\|')).join(' | ')} |`)].join('\n');
  const ontologyComplete = gaps.filter((row) => row.proposedResolution === 'SEMANTIC_COMPLETE' && row.candidateAxis !== 'RULE_CLOSURE').length;
  const ruleClosureCount = gaps.filter((row) => row.candidateAxis === 'RULE_CLOSURE').length;
  const ontologyPartial = gaps.filter((row) => row.proposedResolution === 'SEMANTIC_PARTIAL').length;
  const authority = report.authority;
  const lines = [
    '# CATALOG-INTELLIGENCE TRAINING-SEMANTICS-A00.6.4 — Ontology Expansion for 95% Semantic Resolution',
    '',
    '## Decision: TRAINING_SEMANTIC_ONTOLOGY_EXPANSION_READY_WITH_DEBT',
    '',
    'This is a design slice only. It does not modify the registry, classifier, Training Semantic Snapshot, Product Semantic Snapshot, runtime, API, Sales Agent or Customer Profile.',
    '',
    '## Baseline and gate',
    '',
    `- Active training-relevant denominator: ${report.kpis.activeTrainingRelevant ?? DENOMINATOR}`,
    `- Current resolved: ${CURRENT_RESOLVED} / ${DENOMINATOR} = 75%`,
    `- Target: ${TARGET_RESOLVED} / ${DENOMINATOR} = 95%`,
    `- Deficit: ${TARGET_RESOLVED - CURRENT_RESOLVED} products`,
    `- A00.5 snapshot lineage: \`${authority.snapshotId}\``,
    `- Registry lineage: \`${authority.registryVersion}\` / \`${authority.registryHash}\``,
    `- Classifier lineage: \`${authority.classifierVersion}\` / \`${authority.rulesHash}\``,
    '',
    '## Review of all 41 ontology gaps',
    '',
    `All ${gaps.length} A00.6.2 ONTOLOGY_GAP records are present in \`ontology-gap-products.csv\`. The proposed closure is ${ontologyComplete} records through new ontology concepts, ${ruleClosureCount} record through existing-V1 rule closure, and ${ontologyPartial} SEMANTIC_PARTIAL records under the evidence gates below. Product 2089 is retained as a current HIP_THRUST rule closure, not a new ontology concept.`,
    '',
    table(['Conceptual group', 'Products', 'Resolution role', 'Candidate concepts'], [
      ['Dedicated exercise machines', 26, 'New EXERCISE_CAPABILITY vocabulary', 'LEG_PRESS, HACK_SQUAT, CALF_RAISE, REAR_DELT_FLY, BICEPS_CURL, TRICEPS_EXTENSION, PENDULUM_SQUAT, BELT_SQUAT, REVERSE_HYPER, DEADLIFT, PULLOVER'],
      ['General/instrumental equipment', 14, 'New TRAINING_FUNCTION vocabulary', 'BARBELL_SUPPORT, GUIDED_BARBELL_SUPPORT, BODYWEIGHT_SUPPORT, CABLE_RESISTANCE, MULTI_DIRECTIONAL_RESISTANCE'],
      ['Existing V1 closure', 1, 'Classifier rule closure', 'HIP_THRUST (product 2089)'],
    ]),
    '',
    'The boundary is deliberate: EXERCISE_CAPABILITY asserts a specific exercise/function; TRAINING_FUNCTION asserts an instrumental training utility without deriving muscles, body regions or a customer workout goal.',
    '',
    '## Candidate TRAINING_FUNCTION vocabulary',
    '',
    table(['Code', 'Evidence', 'Decision', 'Rationale'], functionCandidates.map(([code, evidence, decision, rationale]) => [code, evidence, decision, rationale])),
    '',
    'Minimum accepted function set: CABLE_RESISTANCE, MULTI_DIRECTIONAL_RESISTANCE, BODYWEIGHT_SUPPORT, BARBELL_SUPPORT and GUIDED_BARBELL_SUPPORT. SAFETY_SUPPORT remains conditional because the 41 records do not contain sufficient structured safety-feature evidence.',
    '',
    '## Candidate EXERCISE_CAPABILITY v2 vocabulary',
    '',
    table(['Code', 'Evidence products', 'Gain', 'Decision', 'Precision gate'], exerciseCandidates.map(([code, ids, gain, decision, gate]) => [code, ids, gain, decision, gate])),
    '',
    'Generic SQUAT is not reintroduced. HACK_SQUAT is narrow and requires mechanism/geometry evidence. LEG_PRESS is promoted because eight active products have explicit press evidence. GLUTE_KICKBACK remains deferred because no active ontology-gap product establishes a safe gain.',
    '',
    '## General equipment family adjudication',
    '',
    table(['Family', 'Training Function policy', 'Direct vs derived', 'Discovery value', 'Decision'], [
      ['BARBELL', 'FREE_WEIGHT_LOAD is universal but redundant with Product Family; no new function in minimum set.', 'No new relation', 'Low incremental value', 'DO_NOT_ADD'],
      ['DUMBBELL', 'Do not derive a dummy function; unilateral/bilateral load requires explicit evidence.', 'No new relation', 'Potential future value', 'DO_NOT_ADD'],
      ['KETTLEBELL', 'BALLISTIC_LOAD is not universal enough from family alone.', 'No new relation', 'Potential future value', 'DO_NOT_ADD'],
      ['WEIGHT_PLATE', 'EXTERNAL_LOAD is too broad and redundant for this slice.', 'No new relation', 'Low incremental value', 'DO_NOT_ADD'],
      ['BENCH', 'Generic/adjustable/flat/abdominal/hip-thrust distinctions stay Product Family/features or explicit exercise assignments.', 'No family-wide function', 'Avoid CHEST_PRESS overclaim', 'DO_NOT_ADD'],
      ['RACK_CAGE', 'BARBELL_SUPPORT may be direct from explicit stand/rack evidence; GUIDED_BARBELL_SUPPORT for Smith/Multipower.', 'DIRECT; supported modules remain separate', 'High: safe bar support', 'ADD_LIMITED'],
      ['CABLE_MACHINE', 'CABLE_RESISTANCE for generic cable stations; MULTI_DIRECTIONAL_RESISTANCE only for explicit crossover/dual geometry.', 'FAMILY_DERIVED only for generic cable; DIRECT for geometry', 'High: “quiero entrenar con poleas”', 'ADD_LIMITED'],
      ['BAND_SUSPENSION', 'SUSPENSION_SUPPORT requires explicit product evidence; not family-wide in this slice.', 'DIRECT/structured only', 'Future value', 'DO_NOT_ADD'],
      ['ROPE_SLED', 'DRAG_PUSH_RESISTANCE is a future candidate; no A00.6.4 ontology-gap gain.', 'Potential family-derived', 'Future value', 'DO_NOT_ADD_IN_MINIMUM'],
      ['BODYWEIGHT_GYMNASTICS', 'BODYWEIGHT_SUPPORT for explicit support/obstacle equipment; PULL_UP/DIP remain explicit supported capabilities.', 'DIRECT or constrained family-derived', 'High without exercise overclaim', 'ADD_LIMITED'],
      ['MACHINE_ATTACHMENT', 'No generic Training Function; preserve attachment/support semantics and explicit supported modules.', 'No family-wide function', 'Avoid false positives', 'DO_NOT_ADD'],
    ]),
    '',
    '## Direct vs derived policy',
    '',
    '- FAMILY_DERIVED: only stable generic functions where Product Family is authoritative and the function is useful beyond a duplicate family label (generic cable resistance is the accepted example).',
    '- DIRECT: explicit name, trusted category or structured feature establishes a product function or exercise capability.',
    '- SUPPORTED: a rack/module supports PULL_UP or DIP only when the module is explicit; Training Function does not derive anatomy or exercise capabilities.',
    '- MANUAL_OVERRIDE: allowed only as a documented exception with evidence, never as silent classifier fallback.',
    '',
    '## Boundary with existing semantics',
    '',
    table(['Layer', 'Meaning', 'Example', 'Must not do'], [
      ['EXERCISE_CAPABILITY', 'Specific exercise/function asserted by Product Truth.', 'LEG_PRESS, HACK_SQUAT, LEG_EXTENSION.', 'Do not map generic rack/cable/bench to an exercise.'],
      ['TRAINING_FUNCTION', 'Instrumental/general training utility.', 'CABLE_RESISTANCE, BARBELL_SUPPORT.', 'Do not derive muscle groups, body regions or goals.'],
      ['PRODUCT_FAMILY', 'Commercial/product classification.', 'CABLE_MACHINE, RACK_CAGE.', 'Do not treat family as an exercise assignment.'],
      ['TRAINING_PATTERN', 'Derived only from an exercise capability where registry semantics support it.', 'Existing registry derivation.', 'Do not derive from generic equipment function.'],
    ]),
    '',
    '## 95% simulation',
    '',
    table(['Option', 'Resolved', 'Rate', 'Remaining', 'Precision risk', 'Complexity', 'Redundancy', 'Discovery value'], simulation.map((row) => [row.option, row.resolved, `${row.rate}%`, row.remaining, row.precisionRisk, row.complexity, row.redundancy, row.discoveryValue])),
    '',
    'Ontology expansion alone reaches 220/240 = 91.67%; it cannot honestly claim 95%. The minimum target path is the combined model plus four classifier closures (products 388, 1270, 2092 and 2089) plus four data closures selected from the highest-value DATA_GAP records (1427, 1517, 494 and 495). That yields 228/240 = 95.00%, leaving 12 unresolved: four remaining DATA_GAP, five AMBIGUOUS and three NEEDS_REVIEW.',
    '',
    '## Deferred exercise capability decisions',
    '',
    table(['Capability', 'Decision', 'Active gain observed in this audit', 'Reason'], [
      ['SQUAT', 'REDEFINE', 0, 'Generic SQUAT remains heterogeneous; split HACK_SQUAT, BELT_SQUAT, PENDULUM_SQUAT and support functions.'],
      ['HACK_SQUAT', 'ADD', 7, 'Dedicated explicit products with a mechanism gate.'],
      ['LEG_PRESS', 'ADD', 8, 'Eight active explicit products; material resolution gain.'],
      ['BICEPS_CURL', 'ADD', 1, 'Explicit dual biceps/triceps product.'],
      ['TRICEPS_EXTENSION', 'ADD', 2, 'Dedicated and dual explicit products.'],
      ['GLUTE_KICKBACK', 'DEFER', 0, 'No active ontology-gap product establishes a safe gain.'],
      ['DEADLIFT', 'LIMITED_ADD', 1, 'Product 2026 is a dedicated active machine, unlike the dropped accessory finding.'],
    ]),
    '',
    '## Proposed Training Semantics V2',
    '',
    'Training Semantics V2 should preserve the existing exercise assignment model and add a separate function relation:',
    '',
    '```text\nTRAINING_SEMANTICS\n├── EXERCISE_CAPABILITY\n├── TRAINING_FUNCTION\n├── derived BODY_REGION / MUSCLE_GROUP / TRAINING_PATTERN (exercise only)\n└── Product Family context (not a semantic assignment)\n```',
    '',
    'A product may have both DIRECT ExerciseCapability assignments and DIRECT/FAMILY_DERIVED TrainingFunction assignments. Function assignments never derive anatomy. SUPPORTED exercise assignments remain evidence-bound.',
    '',
    '## Versioning and migration',
    '',
    '- Propose `training-semantic-registry-v2`; the vocabulary and relation model change materially.',
    '- Propose `TrainingSemanticSnapshot` schemaVersion 2 for published V2 artifacts because records gain a separate trainingFunctions collection; keep the v1 reader immutable for the existing snapshot.',
    '- Preserve all v1 exercise assignments byte-for-byte and publish a v2 projection with explicit lineage to v1 snapshotId, v2 registryHash and v2 rulesHash.',
    '- Do not overwrite the v1 artifact or active pointer. A migration should build, validate, persist and activate a separate v2 artifact only after A00.6.5 acceptance.',
    '- No registry, classifier, snapshot or API implementation is included in A00.6.4.',
    '',
    '## Remaining debt before A00.6.5',
    '',
    '- Enrich structured semantic category/features for all eight DATA_GAP products; the minimum 95% path needs four prioritized closures.',
    '- Human-review the five AMBIGUOUS packs and three NEEDS_REVIEW multifunction products.',
    '- Implement and regression-test the four classifier closures separately from ontology additions.',
    '- Validate precision on representative generic cable, rack, Smith, bench, bodyweight and dual-machine products before registry publication.',
    '',
    '## Required artifacts',
    '',
    '- `ontology-gap-products.csv` — exhaustive 41-product review.',
    '- `candidate-training-functions.csv` — evaluated function vocabulary and redundancy decisions.',
    '- `candidate-exercise-capabilities-v2.csv` — narrow capability candidates and gains.',
    '- `ontology-expansion-simulation.csv` — quantitative option comparison.',
    '- `training-semantic-v2-proposed-registry.json` — design proposal only; not a published registry.',
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const report = JSON.parse(await readFile(RESOLUTION_REPORT, 'utf8')) as JsonReport;
  const ontologyRecords = report.records.filter((record) => record.resolutionState === 'ONTOLOGY_GAP');
  if (ontologyRecords.length !== EXPECTED_ONTOLOGY_GAPS) throw new Error(`TRAINING_SEMANTIC_ONTOLOGY_EXPANSION_BLOCKED: expected ${EXPECTED_ONTOLOGY_GAPS} ontology gaps, got ${ontologyRecords.length}`);
  if (proposals.size !== EXPECTED_ONTOLOGY_GAPS) throw new Error(`TRAINING_SEMANTIC_ONTOLOGY_EXPANSION_BLOCKED: proposal coverage is ${proposals.size}/${EXPECTED_ONTOLOGY_GAPS}`);
  const gaps = proposalRows(ontologyRecords);
  const simulation = [
    csvRow({ option: 'A_EXERCISE_CAPABILITY_ONLY', ontologyProductsClosed: 26, trainingFunctionProductsClosed: 0, classifierClosures: 0, dataClosures: 0, resolved: 206, rate: 85.83, remaining: 34, precisionRisk: 'MEDIUM_HIGH', complexity: 'MEDIUM', redundancy: 'LOW', discoveryValue: 'MEDIUM', gate: 'NO' }),
    csvRow({ option: 'B_TRAINING_FUNCTION_ONLY', ontologyProductsClosed: 14, trainingFunctionProductsClosed: 14, classifierClosures: 0, dataClosures: 0, resolved: 194, rate: 80.83, remaining: 46, precisionRisk: 'LOW_MEDIUM', complexity: 'LOW', redundancy: 'MEDIUM', discoveryValue: 'HIGH_FOR_GENERIC_EQUIPMENT', gate: 'NO' }),
    csvRow({ option: 'C_COMBINED_MINIMUM_ONTOLOGY', ontologyProductsClosed: 40, trainingFunctionProductsClosed: 14, classifierClosures: 0, dataClosures: 0, resolved: 220, rate: 91.67, remaining: 20, precisionRisk: 'MEDIUM_CONTROLLED_BY_EVIDENCE_GATES', complexity: 'HIGH', redundancy: 'LOW', discoveryValue: 'HIGH', gate: 'NO' }),
    csvRow({ option: 'D_COMBINED_PLUS_REQUIRED_CLOSURE', ontologyProductsClosed: 40, trainingFunctionProductsClosed: 14, classifierClosures: 4, dataClosures: 4, resolved: 228, rate: 95, remaining: 12, precisionRisk: 'CONTROLLED_WITH_REVIEW', complexity: 'HIGH', redundancy: 'LOW', discoveryValue: 'HIGHEST', gate: 'YES_WITH_DATA_AND_REVIEW_CLOSURE' }),
  ];
  const proposedRegistry = {
    proposalVersion: 'training-semantic-registry-v2-proposal',
    status: 'DESIGN_ONLY_NOT_PUBLISHED',
    baseRegistry: report.authority,
    semanticBoundary: { exerciseCapability: 'specific exercise/function asserted by Product Truth', trainingFunction: 'instrumental/general training utility without exercise, anatomy or goal inference' },
    trainingFunctions: functionCandidates.filter(([, , decision]) => decision === 'ADD').map(([code, evidence, , rationale]) => ({ code, evidenceProductIds: evidence.split(',').filter((value) => /^\d+$/u.test(value)).map(Number), sourcePolicy: code === 'CABLE_RESISTANCE' ? 'FAMILY_DERIVED_OR_DIRECT' : 'DIRECT', relationMode: code === 'CABLE_RESISTANCE' ? ['FAMILY_DERIVED', 'DIRECT'] : ['DIRECT'], rationale })),
    exerciseCapabilitiesV2: exerciseCandidates.filter(([, , , decision]) => decision === 'ADD' || decision === 'LIMITED_ADD').map(([code, evidence, , decision, precisionGate]) => ({ code, evidenceProductIds: evidence.split(',').map(Number), decision, precisionGate })),
    existingCapabilityClosures: [{ capabilityCode: 'HIP_THRUST', productIds: [2089], action: 'CLASSIFIER_RULE_CLOSURE' }],
    excludedFromV2Minimum: ['SQUAT', 'GLUTE_KICKBACK', 'SAFETY_SUPPORT', 'FREE_WEIGHT_LOAD', 'SELECTORIZED_RESISTANCE', 'PLATE_LOADED_RESISTANCE'],
    relationPolicy: { FAMILY_DERIVED: 'Only stable family-level function with incremental discovery meaning.', DIRECT: 'Trusted name/category/structured feature or manual adjudication.', SUPPORTED: 'Explicit module evidence only; no anatomy derivation.', MANUAL_OVERRIDE: 'Documented exception with evidence; never silent fallback.' },
    migration: { registryVersion: 'training-semantic-registry-v2', snapshotSchemaVersion: '2', preserveV1Assignments: true, v1ArtifactOverwritten: false, lineageRequired: ['sourceV1SnapshotId', 'registryHash', 'rulesHash'] },
  };
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, 'ontology-gap-products.csv'), writeCsv(Object.keys(gaps[0] ?? {}), gaps), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'candidate-training-functions.csv'), writeCsv(['code', 'evidenceProductIds', 'decision', 'rationale'], functionCandidates.map(([code, evidence, decision, rationale]) => ({ code, evidenceProductIds: evidence, decision, rationale }))), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'candidate-exercise-capabilities-v2.csv'), writeCsv(['code', 'evidenceProductIds', 'evidenceCount', 'decision', 'precisionGate'], exerciseCandidates.map(([code, evidence, gain, decision, precisionGate]) => ({ code, evidenceProductIds: evidence, evidenceCount: gain, decision, precisionGate }))), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'ontology-expansion-simulation.csv'), writeCsv(Object.keys(simulation[0] ?? {}), simulation), 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'training-semantic-v2-proposed-registry.json'), `${JSON.stringify(proposedRegistry, null, 2)}\n`, 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'training-semantic-ontology-expansion.md'), `${renderMarkdown(report, gaps, simulation)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', decision: 'TRAINING_SEMANTIC_ONTOLOGY_EXPANSION_READY_WITH_DEBT', ontologyGapProducts: ontologyRecords.length, newOntologyConceptClosures: gaps.filter((row) => row.proposedResolution === 'SEMANTIC_COMPLETE' && row.candidateAxis !== 'RULE_CLOSURE').length, existingV1RuleClosures: gaps.filter((row) => row.candidateAxis === 'RULE_CLOSURE').length, targetSimulation: '228/240 = 95%', outputDir: OUTPUT_DIR }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: 'failed', error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown ontology expansion design error' } }, null, 2));
  process.exitCode = 1;
});
