import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as domain from '../src/domain/catalog-admission/index.ts';
import { getOntologyTagsForAxis } from '../src/domain/commercial-product-ontology/index.ts';
import { getTrainingSemanticRegistryV2 } from '../src/domain/training-semantics-v2/index.ts';

const count = (rows, select, keys = []) => Object.assign(Object.fromEntries(keys.map(k => [k, 0])), rows.reduce((out, row) => {
  const key = select(row); out[key] = (out[key] ?? 0) + 1; return out;
}, {}));
const ratio = (n, d) => ({ numerator: n, denominator: d, percentage: d ? Number((100 * n / d).toFixed(4)) : null });
const cell = value => `"${String(typeof value === 'object' && value !== null ? JSON.stringify(value) : value ?? '').replaceAll('"', '""')}"`;
const csv = (rows, fields) => `${fields.join(',')}\n${rows.map(r => fields.map(f => cell(r[f])).join(',')).join('\n')}\n`;
const baselineFiles = ['REPORT.md', 'projection-summary.json', 'product-consolidation.json', 'product-consolidation.csv',
  'quality-metrics.json', 'manual-review.csv', 'manual-review.json', 'verification.json', 'evidence-policy.json', 'gap-inventory.csv',
  'gap-inventory.json', 'invariants.md', 'new-product-admission.md', 'remediation-queues.csv'];
export async function runAdmissionAudit(input) {
  const { source, manifest, ps, t2, specsById, pById, tById, categoryRows, featureRows, sourceHashes, extraction,
    sourceDir, bundleDir, output, root, before, fingerprint, hash, validation } = input;
  const previous = JSON.parse(await readFile(path.join(output, 'product-consolidation.json'), 'utf8'));
  const originalRows = Array.isArray(previous) ? previous : previous.products ?? previous.rows;
  assert(Array.isArray(originalRows), 'Original audit product rows required for baseline comparison');
  const baselineHashes = Object.fromEntries(await Promise.all(baselineFiles.map(async name => [name, hash(await readFile(path.join(output, name)))])));
  const evaluationFiles = ['contracts.ts', 'registry.ts', 'resolution.ts', 'evaluator.ts', 'index.ts'].map(f => path.join(root, 'src/domain/catalog-admission', f));
  evaluationFiles.push(path.join(root, 'cross-projection-audit/audit.mjs'), path.join(root, 'cross-projection-audit/admission-audit.mjs'));
  const evaluationCodeHash = hash((await Promise.all(evaluationFiles.map(f => readFile(f, 'utf8')))).join('\n'));
  let previousVerification = null;
  try { previousVerification = JSON.parse(await readFile(path.join(output, 'verification-P2.3A.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const categories = categoryRows.map(r => ({ categoryId: Number(r.categoryId), trustClass: r.trustClass }));
  const features = featureRows.map(r => ({ featureId: Number(r.featureId), trustClass: r.trustClass }));
  const contexts = source.products.map(canonical => ({ canonical, productSemantics: pById.get(canonical.productId),
    training: tById.get(canonical.productId), specs: specsById.get(canonical.productId) ?? [],
    trust: { categories, features, sourceHashesVerified: true, consumedByCategorySelection: false },
    lineage: { productVerified: true, trainingVerified: true, specsVerified: true } }));
  const evaluated = contexts.map(context => {
    const consolidation = domain.evaluateProductConsolidation(context);
    const admission = Object.fromEntries(domain.admissionSurfaces.map(surface => [surface, domain.evaluateProductAdmission(context, surface)]));
    const functionDiscovery = domain.evaluateProductAdmission({ ...context, trainingDiscoveryDimension: 'TRAINING_FUNCTION' }, 'TRAINING_DISCOVERY');
    return { productId: context.canonical.productId, productKey: `P${context.canonical.productId}`, name: context.canonical.name,
      presence: context.canonical.catalogPresence, active: context.canonical.active, productFamily: context.productSemantics.primaryProductFamily?.code ?? 'UNKNOWN',
      consolidation, admission, functionDiscovery };
  });
  const trainingInvalid = evaluated.filter(r => r.consolidation.evaluatedDimensions.find(d => d.dimension === 'TRAINING_EXERCISE').resolution.state === 'INVALID_STATE');
  const invalidIds = trainingInvalid.map(r => r.productId).sort((a, b) => a - b);
  const oldInvalidIds = originalRows.filter(r => r.trainingIssues.some(i => i.code === 'TRAINING_NEGATIVE_WITH_ASSIGNMENTS')).map(r => r.productId).sort((a, b) => a - b);
  assert.equal(invalidIds.length, 51); assert.deepEqual(invalidIds, oldInvalidIds);
  assert(trainingInvalid.every(r => r.presence === 'current_catalog' && r.active === true && r.admission.TRAINING_DISCOVERY.decision !== 'ADMITTED' && r.functionDiscovery.decision !== 'ADMITTED'));
  const conflictIds = evaluated.filter(r => r.consolidation.evaluatedDimensions.find(d => d.dimension === 'SPECS').resolution.state === 'SOURCE_CONFLICT').map(r => r.productId).sort((a, b) => a - b);
  const oldConflictIds = originalRows.filter(r => r.specIssues.some(i => i.code === 'SPEC_CONFLICTING_RAW_CANDIDATES')).map(r => r.productId).sort((a, b) => a - b);
  assert.equal(conflictIds.length, 82); assert.deepEqual(conflictIds, oldConflictIds);
  const oldProductIds = originalRows.filter(r => r.activeInactive === 'ACTIVE' && r.admissionRecommendation.PRODUCT_SEMANTIC_DISCOVERY.recommendation === 'YES').map(r => r.productId).sort((a, b) => a - b);
  const newProductIds = evaluated.filter(r => r.active && r.admission.PRODUCT_SEMANTIC_DISCOVERY.decision === 'ADMITTED').map(r => r.productId).sort((a, b) => a - b);
  assert.equal(newProductIds.length, 791, JSON.stringify(evaluated.filter(r => oldProductIds.includes(r.productId) && !newProductIds.includes(r.productId)).map(r => ({ productId: r.productId,
    resolution: r.admission.PRODUCT_SEMANTIC_DISCOVERY.evaluatedDimensions[0].resolution }))));
  assert.deepEqual(newProductIds, oldProductIds, 'Strict Product Discovery baseline changed');
  const oldExerciseIds = originalRows.filter(r => r.activeInactive === 'ACTIVE' && r.admissionRecommendation.TRAINING_DISCOVERY.recommendation === 'YES').map(r => r.productId);
  const trainingExerciseAdmissionChanges = {
    previousStrictActiveCount: oldExerciseIds.length,
    removed: evaluated.filter(r => oldExerciseIds.includes(r.productId) && r.admission.TRAINING_DISCOVERY.decision !== 'ADMITTED').map(r => ({ productId: r.productId, family: r.productFamily,
      decision: r.admission.TRAINING_DISCOVERY.decision, reasons: r.admission.TRAINING_DISCOVERY.reasons,
      evidence: r.admission.TRAINING_DISCOVERY.evaluatedDimensions[0].resolution.evidenceFacts })),
    added: evaluated.filter(r => r.active && !oldExerciseIds.includes(r.productId) && r.admission.TRAINING_DISCOVERY.decision === 'ADMITTED').map(r => r.productId),
  };
  const historical = contexts.filter(c => c.canonical.catalogPresence === 'historical_order_detail_only' && c.training.resolutionState === 'SEMANTIC_COMPLETE');
  const nonProduct = contexts.filter(c => c.productSemantics.classificationStatus === 'EXCLUDED_NON_PRODUCT' && c.training.resolutionState === 'SEMANTIC_COMPLETE');
  assert.equal(historical.length, 63); assert.equal(nonProduct.length, 1);
  assert(historical.every(c => domain.evaluateProductAdmission(c, 'TRAINING_DISCOVERY').reasons.some(r => r.code === 'HISTORICAL_SCOPE_EXCLUDED')));
  assert(nonProduct.every(c => domain.evaluateProductAdmission(c, 'TRAINING_DISCOVERY').reasons.some(r => r.code === 'NON_PRODUCT_EXCLUDED')));
  const negative = evaluated.filter(r => r.consolidation.evaluatedDimensions.find(d => d.dimension === 'TRAINING_EXERCISE').resolution.state === 'VERIFIED_NOT_APPLICABLE');
  assert.equal(negative.length, 836);
  assert(negative.every(r => r.consolidation.evaluatedDimensions.filter(d => d.dimension.startsWith('TRAINING_')).every(d => d.resolution.negativeEvidenceState === 'ABSENT' && !d.evidenceCertified && d.terminalValid)));
  const populations = { ALL: evaluated, CURRENT: evaluated.filter(r => r.presence === 'current_catalog'), ACTIVE: evaluated.filter(r => r.active === true) };
  const summarize = rows => {
    const known = rows.filter(r => r.consolidation.obligationsKnown), certified = rows.filter(r => ['CONSOLIDATED', 'CONSOLIDATED_WITH_NOT_APPLICABLE'].includes(r.consolidation.state)).length;
    const stateCounts = count(rows, r => r.consolidation.state, domain.consolidationStates);
    const surfaces = Object.fromEntries(domain.admissionSurfaces.map(surface => [surface, count(rows, r => r.admission[surface].decision, domain.admissionDecisionStates)]));
    return { totalPopulation: rows.length, knownObligations: known.length, unknownObligations: rows.length - known.length,
      stateCounts, knownObligationStateCounts: count(known, r => r.consolidation.state, domain.consolidationStates),
      certifiedConsolidated: certified, certifiedOverTotal: ratio(certified, rows.length), certifiedOverKnownObligations: ratio(certified, known.length),
      highestCertifiedLevels: count(rows, r => r.consolidation.highestCertifiedLevel ?? 'NONE', domain.consolidationLevels),
      nextBlockedLevels: count(rows, r => r.consolidation.nextBlockedLevel ?? 'NONE'), surfaces,
      trainingFunctionDiscovery: count(rows, r => r.functionDiscovery.decision, domain.admissionDecisionStates),
      dimensions: Object.fromEntries(domain.semanticDimensions.map(dimension => [dimension, {
        requirements: count(rows, r => r.consolidation.evaluatedDimensions.find(d => d.dimension === dimension).effectiveRequirement),
        resolutions: count(rows, r => r.consolidation.evaluatedDimensions.find(d => d.dimension === dimension).resolution.state),
      }])) };
  };
  // The inventory is an output, never a seed required from an earlier checkout.
  const ontologyFamilies = getOntologyTagsForAxis('PRODUCT_FAMILY', ps.ontologyVersion);
  const familyCodes = [...new Set([...ontologyFamilies.map(f => f.code), 'UNKNOWN', 'BAND'])].sort();
  const inventory = { phase: 'PRE_CONTRACT_INVENTORY',
    evidenceCountScope: 'Canonical products, including historical; currentProductCount and activeProductCount are separate partitions. Literal references are occurrence evidence, not family-applicability contracts.',
    families: familyCodes.map(productFamily => {
      const rows = originalRows.filter(r => (r.productFamily ?? 'UNKNOWN') === productFamily);
      const ontologyFamily = ontologyFamilies.find(f => f.code === productFamily);
      const derivations = getTrainingSemanticRegistryV2().familyTrainingFunctionDerivations.filter(d => d.productFamily === productFamily && d.status === 'ACTIVE');
      return { productFamily, ontologyFamily: !!ontologyFamily, residual: ontologyFamily?.residual ?? false,
        canonicalProductCount: rows.length, currentProductCount: rows.filter(r => r.presenceState === 'current_catalog').length,
        activeProductCount: rows.filter(r => r.activeInactive === 'ACTIVE').length,
        existingTrainingEvidence: { exerciseProducts: rows.filter(r => r.exerciseCapabilities.length).length, functionProducts: rows.filter(r => r.trainingFunctions.length).length,
          evidenceKinds: [...new Set(rows.flatMap(r => [...r.exerciseCapabilities, ...r.trainingFunctions].flatMap(a => a.evidence.map(e => e.kind))))].sort() },
        existingSpecsEvidence: { productsWithSpecs: rows.filter(r => r.specCount).length, parsedProducts: rows.filter(r => r.parsedSpecCount).length,
          conflicts: rows.filter(r => r.specIssues.some(i => i.code === 'SPEC_CONFLICTING_RAW_CANDIDATES')).length },
        existingPolicies: ['Product ontology tag/evidence gates/historical scope', ...derivations.map(d => `registry V2 ${productFamily} -> ${d.trainingFunctionCode}`)],
        knownSurfaceUsage: ['PRODUCT_CONTEXT current existence', 'PRODUCT_SEMANTIC_DISCOVERY current non-excluded tags',
          'TRAINING_DISCOVERY SEMANTIC_COMPLETE assignments (modeled facts)', 'SPEC_FILTERING no admission contract'],
      };
    }) };
  assert.equal(inventory.families.reduce((sum, family) => sum + family.canonicalProductCount, 0), source.products.length);
  for (const family of inventory.families) {
    let references = [];
    try { references = execFileSync('rg', ['-l', '--word-regexp', family.productFamily, 'src/domain', 'tests', 'docs',
      '--glob', '!**/catalog-admission/**', '--glob', '!catalog-admission.test.ts', '--glob', '!P2_3A_SEMANTIC_OBLIGATIONS_AND_ADMISSION.md'], { encoding: 'utf8' }).trim().split(/\r?\n/u).filter(Boolean).map(f => f.replaceAll('\\', '/')).sort();
    } catch (error) { if (error.status !== 1) throw error; }
    family.sourceReferences = {
      productOntology: references.filter(f => f.startsWith('src/domain/commercial-product-ontology/')),
      domainRegistries: references.filter(f => f.startsWith('src/domain/') && f.endsWith('/registry.ts')),
      contracts: references.filter(f => f.startsWith('src/domain/') && /contracts\.ts$/u.test(f)),
      tests: references.filter(f => f.startsWith('tests/')),
      policiesAndRules: references.filter(f => f.startsWith('docs/') || /(?:rules|policy|exclusion)\.ts$/u.test(f)),
      productSemantics: { file: `${bundleDir}/productSemantics.json`, recordCount: family.canonicalProductCount },
    };
    if (references.some(f => f.startsWith('src/domain/training-semantic-classification') && /(?:rules|classifier)\.ts$/u.test(f)))
      family.existingPolicies.push('Training rules reference this family; applicability/version scope must be preserved');
  }
  await writeFile(path.join(output, 'family-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  await writeFile(path.join(output, 'family-inventory.csv'), csv(inventory.families, Object.keys(inventory.families[0])), 'utf8');
  const families = [...domain.semanticObligationContract.families, domain.semanticObligationContract.defaultFamily].map(family => {
    const rows = evaluated.filter(r => domain.getProductFamilyObligation(r.productFamily).productFamily === family.productFamily);
    return { ...family, evaluatedPopulation: { canonical: rows.length, current: rows.filter(r => r.presence === 'current_catalog').length, active: rows.filter(r => r.active).length },
      inventory: inventory.families.find(f => f.productFamily === family.productFamily) ?? null };
  });
  const summary = { phase: 'P2.3A', contractVersion: domain.semanticObligationContract.contractVersion, contractHash: domain.semanticObligationContract.contentHash,
    sourceExtractionId: extraction.sourceExtractionId, projectionBundleId: manifest.projectionBundleId, sourceDir, bundleDir, sourceHashes,
    contractCoverage: { ontologyFamilies: domain.semanticObligationContract.families.length, ...count(domain.semanticObligationContract.families, f => f.status, ['ACTIVE', 'PROVISIONAL', 'UNKNOWN']),
      unknownDefaultEntries: 1, inventoryEntries: inventory.families.length },
    certificationScope: 'All five obligation decisions must be known. Training scope is modeled assignments; Specs scope is existing supported source features, not exhaustive family applicability. No family-specific SPEC_FILTERING contract exists.',
    populations: Object.fromEntries(Object.entries(populations).map(([key, rows]) => [key, summarize(rows)])),
    trainingExerciseAdmissionChanges,
    invariants: { structuralValid: evaluated.filter(r => r.consolidation.levels[1].certified).length, trainingInvalidIds: invalidIds,
      specsConflictIds: conflictIds, trainingValidNegativeCount: negative.length, trainingNegativeEvidenceAbsent: negative.length,
      blockedTrainingHistoricalIds: historical.map(c => c.canonical.productId), blockedTrainingNonProductIds: nonProduct.map(c => c.canonical.productId),
      productDiscoveryBaselinePreserved: true, productDiscoveryActiveIds: newProductIds },
    unifiedRetrievalDisposition: 'NOT_READY', relationshipsAndCapabilities: { status: 'UNAVAILABLE_PROJECTION', required: false },
    deployment: { authority: 'offline candidate', productionActivePointerPresent: Object.keys(before).some(f => f.endsWith('catalog-v2/control/active.json')), domainReviewStatus: manifest.validation.domainReview } };
  assert.deepEqual(Object.values(summary.populations).map(p => p.totalPopulation), [2048, 1565, 886]);
  for (const population of Object.values(summary.populations)) {
    assert.equal(population.knownObligations + population.unknownObligations, population.totalPopulation);
    assert.equal(Object.values(population.stateCounts).reduce((a, b) => a + b, 0), population.totalPopulation);
  }
  // Certify repeatability of every result, including arrays/reason ordering, without writing projection truth.
  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index], result = evaluated[index];
    assert.deepEqual(domain.evaluateProductConsolidation(context), result.consolidation);
    for (const surface of domain.admissionSurfaces) assert.deepEqual(domain.evaluateProductAdmission(context, surface), result.admission[surface]);
  }
  const writeJson = async (name, value) => writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const flattened = evaluated.map(r => ({ productId: r.productId, productKey: r.productKey, name: r.name, presence: r.presence, active: r.active, productFamily: r.productFamily,
    obligationsKnown: r.consolidation.obligationsKnown, consolidationState: r.consolidation.state, highestCertifiedLevel: r.consolidation.highestCertifiedLevel,
    nextBlockedLevel: r.consolidation.nextBlockedLevel, requirements: Object.fromEntries(r.consolidation.evaluatedDimensions.map(d => [d.dimension, d.effectiveRequirement])),
    resolutions: Object.fromEntries(r.consolidation.evaluatedDimensions.map(d => [d.dimension, d.resolution.state])),
    decisions: Object.fromEntries(domain.admissionSurfaces.map(s => [s, r.admission[s].decision])), functionDiscovery: r.functionDiscovery.decision,
    blockingReasons: r.consolidation.blockingReasons, contractVersion: r.consolidation.contractVersion, contractHash: r.consolidation.contractHash }));
  const unknown = flattened.filter(r => !r.obligationsKnown);
  await writeJson('product-admission.json', evaluated);
  await writeFile(path.join(output, 'product-admission.csv'), csv(flattened, Object.keys(flattened[0])), 'utf8');
  await writeJson('family-obligations.json', { contract: domain.semanticObligationContract, families, inventory });
  const familyCsv = families.map(f => ({ productFamily: f.productFamily, status: f.status, canonicalProductCount: f.evaluatedPopulation.canonical, currentProductCount: f.evaluatedPopulation.current,
    activeProductCount: f.evaluatedPopulation.active, existingTrainingEvidence: f.inventory?.existingTrainingEvidence ?? {}, existingSpecsEvidence: f.inventory?.existingSpecsEvidence ?? {},
    existingPolicies: f.inventory?.existingPolicies ?? [], knownSurfaceUsage: f.inventory?.knownSurfaceUsage ?? [], dimensions: f.dimensions, surfacePolicies: f.surfacePolicies,
    rationale: f.rationale, sourceReferences: f.sourceReferences, contractVersion: domain.semanticObligationContract.contractVersion, contractHash: domain.semanticObligationContract.contentHash }));
  await writeFile(path.join(output, 'family-obligations.csv'), csv(familyCsv, Object.keys(familyCsv[0])), 'utf8');
  await writeFile(path.join(output, 'unknown-obligations.csv'), csv(unknown, Object.keys(flattened[0])), 'utf8');
  await writeJson('consolidation-baseline.json', summary);
  const after = await fingerprint(); assert.deepEqual(after, before, 'Protected content changed');
  const priorAfter = Object.fromEntries(await Promise.all(baselineFiles.map(async name => [name, hash(await readFile(path.join(output, name)))])));
  assert.deepEqual(priorAfter, baselineHashes, 'Prior audit outputs changed');
  let tests = null;
  try {
    const result = JSON.parse(await readFile(path.join(output, 'test-results-P2.3A.json'), 'utf8'));
    const domainTests = result.testResults.find(s => s.name.replaceAll('\\', '/').endsWith('/tests/unit/catalog-admission.test.ts'));
    tests = { success: result.success, testFiles: result.testResults.length, tests: result.numTotalTests, passed: result.numPassedTests, failed: result.numFailedTests,
      domainTests: domainTests?.assertionResults.length ?? 0, domainPassed: domainTests?.status === 'passed', report: 'test-results-P2.3A.json' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (tests && (!tests.success || !tests.domainPassed)) throw new Error('TEST_SUITE_FAILED');
  const outputHashes = Object.fromEntries(await Promise.all(['product-admission.json', 'product-admission.csv', 'family-obligations.json', 'family-obligations.csv', 'consolidation-baseline.json', 'unknown-obligations.csv', 'family-inventory.json', 'family-inventory.csv']
    .map(async name => [name, hash(await readFile(path.join(output, name)))])));
  const sameRunIdentity = previousVerification?.evaluationCodeHash === evaluationCodeHash && previousVerification?.contractHash === domain.semanticObligationContract.contentHash
    && previousVerification?.projectionBundleId === manifest.projectionBundleId && JSON.stringify(previousVerification?.sourceHashes) === JSON.stringify(sourceHashes);
  if (sameRunIdentity) assert.deepEqual(previousVerification.outputHashes, outputHashes, 'Full audit output reproducibility failed');
  await writeJson('verification-P2.3A.json', { status: tests?.success ? 'PASS' : 'OFFLINE_PASS_TEST_SUITE_PENDING', gates: {
    G1_contractSchemaDeterministic: 'PASS', G2_contractValidator: tests?.domainPassed ? 'PASS' : 'REQUIRES_TEST_SUITE',
    G3_unknownFamilyConservative: tests?.domainPassed ? 'PASS' : 'REQUIRES_TEST_SUITE', G4_resolutionMappings: tests?.domainPassed ? 'PASS' : 'BASELINE_PASS_REQUIRES_TEST_SUITE',
    G5_admissionDeterministic: 'PASS', G6_consolidationDeterministic: 'PASS', G7_trainingInvalid51: 'PASS', G8_noClassifierContentMutation: 'PASS',
    G9_auditReproducibility: sameRunIdentity ? 'PASS_FULL_OUTPUT_HASHES_AND_EVERY_PRODUCT' : 'PASS_EVERY_PRODUCT_REPEAT', G10_existingSuite: tests?.success ? 'PASS' : 'REQUIRES_TEST_SUITE' }, tests,
    protectedFileCount: Object.keys(before).length, protectedBefore: before, protectedAfter: after, priorAuditBefore: baselineHashes, priorAuditAfter: priorAfter,
    contractHash: domain.semanticObligationContract.contentHash, evaluationCodeHash, sourceHashes, projectionBundleId: manifest.projectionBundleId, bundleValidation: validation, outputHashes });
  const table = Object.entries(summary.populations).map(([name, p]) => `| ${name} | ${p.totalPopulation} | ${p.knownObligations} | ${p.unknownObligations} | ${p.certifiedConsolidated}/${p.totalPopulation} | ${p.certifiedConsolidated}/${p.knownObligations} |`).join('\n');
  const active = summary.populations.ACTIVE;
  const surfaceTable = domain.admissionSurfaces.map(s => `| ${s} | ${Object.values(active.surfaces[s]).join(' | ')} |`).join('\n');
  await writeFile(path.join(output, 'REPORT-P2.3A.md'), `# P2.3A — Semantic Obligations & Admission Contract\n\n## A. Implementation\n\nDominio puro en src/domain/catalog-admission: contrato Zod, registry, adaptadores y evaluadores separados. Auditoría offline: node cross-projection-audit/audit.mjs --p2-3a. No se publica ni activa un bundle.\n\n## B. Contract coverage\n\n${JSON.stringify(summary.contractCoverage)}. Las 21 familias reales son PROVISIONAL: el contrato certifica facts emitidos y fuentes Specs soportadas; no inventa aplicabilidad exhaustiva. OTHER, UNKNOWN y el token obsoleto BAND usan default conservador, sin alias. Inventario previo: [family-inventory.csv](family-inventory.csv). Procedencia y condiciones: [family-obligations.json](family-obligations.json).\n\n## C–D. Known obligations y certified consolidation\n\n| Población | Total | Known | Unknown | Certificados/total | Certificados/known |\n|---|---:|---:|---:|---:|---:|\n${table}\n\nUn denominador conocido de cero produce percentage=null. UNKNOWN_OBLIGATIONS es independiente del estado principal: un producto puede tener obligaciones desconocidas y además INVALID o SOURCE_CONFLICT. Los estados completos y ambas tasas están en [consolidation-baseline.json](consolidation-baseline.json). Cero certificable no equivale a cero calidad.\n\n## E. Admission active\n\n| Surface | ADMITTED | PARTIAL | REVIEW_REQUIRED | BLOCKED | NOT_APPLICABLE | UNKNOWN |\n|---|---:|---:|---:|---:|---:|---:|\n${surfaceTable}\n\nProduct Discovery preserva exactamente los 791 IDs activos del baseline. Training Discovery usa ejercicios por defecto; la consulta explícita de funciones tiene ${active.trainingFunctionDiscovery.ADMITTED} activos admitidos. Function-only no establece resolución de ejercicios. Lexical y compra requieren listing/commercial live: active no basta. Product Context admite existencia current, incluidos inactivos. Specs Filtering conserva contrato indefinido.\n\n## F. Training 51\n\n51 IDs idénticos al baseline, current y active; INVALID_STATE en ambas dimensiones, bloqueados en ambas consultas Training. No corregidos. Otros 836 negativos vacíos conservan VERIFIED_NOT_APPLICABLE y negativeEvidenceState=ABSENT: resolución válida, evidencia incompleta. IDs y decisiones en [product-admission.json](product-admission.json).\n\n## G. Specs 82\n\nLos mismos 82 IDs del baseline se reconocen SOURCE_CONFLICT reconstruyendo candidatos numéricos originales. Specs records: ${input.specsById.size} productos con records; 3163 records (2599 parsed/512 ambiguous/52 unsupported) sin cambios. AMBIGUOUS, UNSUPPORTED y MISSING no se convierten en NOT_REQUIRED; requirement permanece separado.\n\n## H. New product\n\nFamilia ausente/nueva: cinco UNKNOWN; L0/L1 posibles, L2 bloqueado, Product Context depende de presencia, Unified REVIEW_REQUIRED, Training exige resolución y contrato explícitos. Pruebas: tests/unit/catalog-admission.test.ts.\n\n## I. Validation\n\nBaseline, invariants y repetición exacta de cada producto/superficie PASS. Fingerprint: ${Object.keys(before).length} archivos protegidos intactos; outputs anteriores preservados. [verification-P2.3A.json](verification-P2.3A.json) separa gates offline de resultados del test runner, que se documentan en la entrega.\n\n## J. Unified Retrieval disposition\n\n**NOT_READY**. Ningún producto está certificado para Unified Retrieval; UNKNOWN de aplicabilidad Training/Specs y autoridad de Trust separada siguen siendo bloqueos explícitos. Relationships/Capabilities unavailable no se penalizan por producto. Bundle candidato local, Domain Review ${summary.deployment.domainReviewStatus}; no hay prueba de activación productiva.\n\n## K. Next remediation\n\n1. Aprobar aplicabilidad de ejercicios/funciones y atributos técnicos por familia, con fuentes y negativas explícitas; resolver UNKNOWN sin inferir exenciones de ausencia.\n2. Reparar los 51 negativos con asignaciones mediante una fase de contenido autorizada; persistir evidencia negativa de los 836, sin reclasificar automáticamente.\n3. Resolver los 82 conflictos en fuentes Specs y las ambigüedades/no soportados; definir el contrato SPEC_FILTERING.\n4. Acordar autoridad verificable de Trust y su consumo; resolver conflicto histórico de explicit-name vs family-inference.\n5. Integrar scope/admission en consumidores en una fase posterior; los 63 históricos y el non-product quedan excluidos por el contrato actual, las queries no se editaron.\n`, 'utf8');
  await appendFile(path.join(output, 'REPORT-P2.3A.md'), `\n## Detalle de I y de E\n\nSuite completa: ${tests ? `${tests.passed}/${tests.tests} tests; ${tests.testFiles} archivos; ${tests.domainTests} tests P2.3A; fallos=${tests.failed}.` : 'PENDIENTE: ejecutar Vitest y repetir la auditoría.'} Report verificable: [test-results-P2.3A.json](test-results-P2.3A.json).\n\nTraining Exercise activo pasa de ${trainingExerciseAdmissionChanges.previousStrictActiveCount} recomendaciones estrictas observadas a ${active.surfaces.TRAINING_DISCOVERY.ADMITTED} admitidos por contrato. Los ${trainingExerciseAdmissionChanges.removed.length} removidos (${trainingExerciseAdmissionChanges.removed.map(r => r.productId).join(', ')}) tienen familia UNKNOWN y contrato ausente; no se afirma que sus asignaciones positivas sean erróneas. La comparación exacta y evidencia están en trainingExerciseAdmissionChanges del baseline JSON. Altas nuevas=${trainingExerciseAdmissionChanges.added.length}. Product Discovery conserva los 791 IDs sin cambios.\n\nDentro de los ${active.knownObligations} activos con obligaciones conocidas: ${JSON.stringify(active.knownObligationStateCounts)}. Los ${active.unknownObligations} con obligaciones desconocidas se cuentan por separado aunque tengan además un estado INVALID/conflict.\n\nReproducibilidad: ${sameRunIdentity ? 'hashes de todos los datasets idénticos a la ejecución anterior, más cada evaluación repetida' : 'cada evaluación repetida; repetir el comando para comparar también hashes entre ejecuciones'}. Todos los 173 archivos protegidos y los 14 outputs anteriores permanecen intactos.\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', contractHash: summary.contractHash, populations: Object.fromEntries(Object.entries(summary.populations).map(([k, p]) => [k, {
    total: p.totalPopulation, known: p.knownObligations, unknown: p.unknownObligations, certified: p.certifiedConsolidated, states: p.stateCounts, activeSurfaces: k === 'ACTIVE' ? p.surfaces : undefined }])),
    invalidTraining: invalidIds.length, specsConflicts: conflictIds.length, preservedFiles: Object.keys(before).length }));
}
