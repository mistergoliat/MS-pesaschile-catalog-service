import { describe, expect, it } from 'vitest';
import { buildAcceptanceAudit, auditSummaryStableHash } from '../../scripts/product-semantic-classification/lib/acceptance-audit.js';
import { resolveProductSemanticInputPaths } from '../../scripts/product-semantic-classification/lib/fixture-paths.js';

describe('product semantic acceptance audit', () => {
  it('is deterministic and preserves the current A00.4 gate summary on 2026-08-29', async () => {
    const paths = await resolveProductSemanticInputPaths();
    const audit = await buildAcceptanceAudit(paths, '2026-08-29');

    expect(auditSummaryStableHash(audit.summary)).toBe('64cad1c164d2b2da9e75f9b702f0574eb7e15ae0e3400fbee0643e810624fb82');
    expect(audit.summary.reproducibility).toMatchObject({
      expectedChecksum: 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e',
      run1Checksum: 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e',
      run2Checksum: 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e',
      checksumMatchesExpected: true,
      checksumsIdentical: true,
      countsIdentical: true,
      registryHashIdentical: true,
      resultOrderingIdentical: true,
      outputByteIdentical: true,
    });
    expect(audit.summary.otherAudit).toMatchObject({
      total: 317,
      LEGITIMATE_RESIDUAL: 138,
      EVIDENCE_GAP: 136,
      POSSIBLE_CLASSIFIER_DEFECT: 0,
      POSSIBLE_ONTOLOGY_GAP: 39,
      POSSIBLE_NON_PRODUCT_LEAKAGE: 0,
      DATA_QUALITY: 4,
    });
    expect(audit.summary.provenanceAudit).toMatchObject({
      factsWithRuleProvenancePct: 100,
      factsWithEvidenceProvenancePct: 100,
      resultsWithOntologyVersionPct: 100,
      resultsWithOntologyHashPct: 100,
      factsWithDeterministicSourceReferencesPct: 100,
      orphanEvidenceRecords: 0,
      silentSemanticFacts: 0,
      snapshotBlocking: false,
    });
    expect(audit.summary.evidenceCompliance.violations).toEqual([]);
    expect(audit.summary.finalVerdict).toBe('PRODUCT_SEMANTIC_CLASSIFICATION_ACCEPTED_WITH_DEBT');
  });
});
