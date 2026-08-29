import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  commercialProductOntologyRegistryVersion,
  computeCommercialProductOntologyRegistryHash,
  deferredOrDroppedAxes,
  getCommercialProductOntologyRegistry,
  getOntologyAxis,
  getOntologyTag,
  getOntologyTagsForAxis,
  isAllowedEvidenceSource,
  isResidualOntologyTag,
  isValidOntologyTag,
  ontologyAxes,
  rejectedOntologyTags,
  serializeCommercialProductOntologyRegistry,
  validateCommercialProductOntologyRegistry,
  type CommercialProductOntologyRegistry,
} from '../../src/domain/commercial-product-ontology/index.js';

const EXPECTED_PRODUCT_FAMILY_CODES = [
  'BARBELL',
  'WEIGHT_PLATE',
  'DUMBBELL',
  'KETTLEBELL',
  'BENCH',
  'RACK_CAGE',
  'CABLE_MACHINE',
  'PLATE_LOADED_MACHINE',
  'SELECTORIZED_MACHINE',
  'CARDIO_MACHINE',
  'FLOORING',
  'STORAGE',
  'BALL_BAG',
  'ROPE_SLED',
  'BAND_SUSPENSION',
  'BODYWEIGHT_GYMNASTICS',
  'PROTECTIVE_GEAR',
  'MACHINE_ATTACHMENT',
  'RECOVERY_TOOL',
  'YOGA_PILATES',
  'APPAREL',
] as const;

const EXPECTED_DISCIPLINE_CODES = [
  'CROSSFIT',
  'HYROX',
  'POWERLIFTING',
  'CALISTHENICS',
  'CARDIO_ENDURANCE',
  'YOGA_PILATES',
  'BOXING_MMA',
  'REHABILITATION',
] as const;

const EXPECTED_USE_CONTEXT_CODES = ['HOME_GYM', 'SMALL_SPACE', 'COMMERCIAL_GYM', 'SEMI_COMMERCIAL_STUDIO', 'CLINICAL_RECOVERY', 'OUTDOOR_HIGH_TRAFFIC'] as const;

describe('Commercial Product Ontology Registry', () => {
  // -- A. Registry counts --
  describe('registry counts', () => {
    it('reports the approved registry version', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.registryVersion).toBe('commercial-product-ontology-v1');
      expect(registry.registryVersion).toBe(commercialProductOntologyRegistryVersion);
      expect(registry.status).toBe('PUBLISHED');
    });

    it('has exactly 3 active axes: PRODUCT_FAMILY, DISCIPLINE, USE_CONTEXT', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.axes.map((a) => a.axis)).toEqual(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
      expect(ontologyAxes).toEqual(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
    });

    it('has exactly 21 real PRODUCT_FAMILY tags + 1 OTHER residual', () => {
      const registry = getCommercialProductOntologyRegistry();
      const productFamilyTags = getOntologyTagsForAxis('PRODUCT_FAMILY');
      expect(productFamilyTags.filter((t) => !t.residual)).toHaveLength(21);
      expect(productFamilyTags.filter((t) => t.residual)).toHaveLength(1);
      expect(productFamilyTags).toHaveLength(22);
      expect(registry.axes.find((a) => a.axis === 'PRODUCT_FAMILY')?.tags).toHaveLength(22);
    });

    it('has exactly 8 DISCIPLINE tags', () => {
      expect(getOntologyTagsForAxis('DISCIPLINE')).toHaveLength(8);
    });

    it('has exactly 6 USE_CONTEXT tags', () => {
      expect(getOntologyTagsForAxis('USE_CONTEXT')).toHaveLength(6);
    });

    it('has exactly 35 real semantic tags total, 36 including the OTHER residual', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.tags.filter((t) => !t.residual)).toHaveLength(35);
      expect(registry.tags).toHaveLength(36);
    });
  });

  // -- B. Every expected tag exists --
  describe('every expected tag exists', () => {
    it.each(EXPECTED_PRODUCT_FAMILY_CODES)('has PRODUCT_FAMILY tag %s', (code) => {
      expect(isValidOntologyTag('PRODUCT_FAMILY', code)).toBe(true);
    });

    it.each(EXPECTED_DISCIPLINE_CODES)('has DISCIPLINE tag %s', (code) => {
      expect(isValidOntologyTag('DISCIPLINE', code)).toBe(true);
    });

    it.each(EXPECTED_USE_CONTEXT_CODES)('has USE_CONTEXT tag %s', (code) => {
      expect(isValidOntologyTag('USE_CONTEXT', code)).toBe(true);
    });

    it('has the OTHER residual tag in PRODUCT_FAMILY', () => {
      expect(isValidOntologyTag('PRODUCT_FAMILY', 'OTHER')).toBe(true);
    });

    it('every tag has a non-empty labelEs and definition', () => {
      const registry = getCommercialProductOntologyRegistry();
      for (const tag of registry.tags) {
        expect(tag.labelEs.length, `${tag.axis}/${tag.code} labelEs`).toBeGreaterThan(0);
        expect(tag.definition.length, `${tag.axis}/${tag.code} definition`).toBeGreaterThan(0);
      }
    });
  });

  // -- C. WEIGHTLIFTING absent --
  describe('WEIGHTLIFTING is absent', () => {
    it('is not a valid DISCIPLINE tag', () => {
      expect(isValidOntologyTag('DISCIPLINE', 'WEIGHTLIFTING')).toBe(false);
      expect(getOntologyTag('DISCIPLINE', 'WEIGHTLIFTING')).toBeUndefined();
    });

    it('does not appear anywhere in the registry under any axis', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.tags.some((t) => t.code === 'WEIGHTLIFTING')).toBe(false);
    });

    it('is recorded as a permanent rejected-tag design decision, not silently omitted', () => {
      const rejected = rejectedOntologyTags.find((t) => t.axis === 'DISCIPLINE' && t.code === 'WEIGHTLIFTING');
      expect(rejected).toBeDefined();
      expect(rejected?.reason).toMatch(/technical.*spec/i);
    });
  });

  // -- D. OTHER residual semantics --
  describe('OTHER residual semantics', () => {
    it('is marked residual=true with status=RESIDUAL', () => {
      const other = getOntologyTag('PRODUCT_FAMILY', 'OTHER');
      expect(other?.residual).toBe(true);
      expect(other?.status).toBe('RESIDUAL');
    });

    it('is the only residual tag in the registry', () => {
      const registry = getCommercialProductOntologyRegistry();
      const residualTags = registry.tags.filter((t) => t.residual);
      expect(residualTags).toEqual([expect.objectContaining({ axis: 'PRODUCT_FAMILY', code: 'OTHER' })]);
    });

    it('never appears as residual outside PRODUCT_FAMILY', () => {
      const registry = getCommercialProductOntologyRegistry();
      for (const axis of ['DISCIPLINE', 'USE_CONTEXT'] as const) {
        expect(getOntologyTagsForAxis(axis).some((t) => t.residual)).toBe(false);
      }
      expect(registry).toBeDefined();
    });

    it('isResidualOntologyTag helper agrees with the tag field', () => {
      expect(isResidualOntologyTag('PRODUCT_FAMILY', 'OTHER')).toBe(true);
      expect(isResidualOntologyTag('PRODUCT_FAMILY', 'BARBELL')).toBe(false);
      expect(isResidualOntologyTag('DISCIPLINE', 'CROSSFIT')).toBe(false);
    });

    it('every non-residual tag remains ACTIVE and non-residual', () => {
      const registry = getCommercialProductOntologyRegistry();
      for (const tag of registry.tags.filter((t) => !t.residual)) {
        expect(tag.status, `${tag.axis}/${tag.code}`).toBe('ACTIVE');
        expect(tag.residual, `${tag.axis}/${tag.code}`).toBe(false);
      }
    });

    it('does not expose positiveAffinitySignal on any tag or in serialized output', () => {
      const registry = getCommercialProductOntologyRegistry();
      for (const tag of registry.tags) {
        expect(Object.prototype.hasOwnProperty.call(tag, 'positiveAffinitySignal'), `${tag.axis}/${tag.code}`).toBe(false);
      }
      expect(serializeCommercialProductOntologyRegistry(registry)).not.toContain('positiveAffinitySignal');
    });
  });

  // -- E. Evidence-source rules --
  describe('evidence-source rules', () => {
    it('every tag only declares evidence sources from the allowed enum', () => {
      const registry = getCommercialProductOntologyRegistry();
      const allowed = new Set(registry.globalRules.allowedEvidenceSourceTypes);
      for (const tag of registry.tags) {
        for (const source of tag.allowedEvidenceSources) {
          expect(allowed.has(source), `${tag.axis}/${tag.code} declares ${source}`).toBe(true);
        }
      }
    });

    it('declares the 9 forbidden evidence source types, including FREE_TEXT_DESCRIPTION and SAMPLING_METADATA', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.forbiddenEvidenceSourceTypes).toHaveLength(9);
      expect(registry.globalRules.forbiddenEvidenceSourceTypes).toContain('FREE_TEXT_DESCRIPTION');
      expect(registry.globalRules.forbiddenEvidenceSourceTypes).toContain('SAMPLING_METADATA');
      expect(registry.globalRules.forbiddenEvidenceSourceTypes).toContain('LEGACY_CATEGORY');
    });

    it('no allowed evidence source type is also listed as forbidden', () => {
      const registry = getCommercialProductOntologyRegistry();
      const forbidden = new Set<string>(registry.globalRules.forbiddenEvidenceSourceTypes);
      for (const allowed of registry.globalRules.allowedEvidenceSourceTypes) {
        expect(forbidden.has(allowed)).toBe(false);
      }
    });

    it('isAllowedEvidenceSource reflects each tag’s declared sources', () => {
      expect(isAllowedEvidenceSource('PRODUCT_FAMILY', 'BARBELL', 'NAME_TEXT')).toBe(true);
      expect(isAllowedEvidenceSource('PRODUCT_FAMILY', 'BARBELL', 'STRUCTURED_FEATURE')).toBe(false);
      expect(isAllowedEvidenceSource('DISCIPLINE', 'CARDIO_ENDURANCE', 'FAMILY_INFERENCE')).toBe(true);
      expect(isAllowedEvidenceSource('DISCIPLINE', 'CARDIO_ENDURANCE', 'NAME_TEXT')).toBe(false);
      expect(isAllowedEvidenceSource('USE_CONTEXT', 'COMMERCIAL_GYM', 'STRUCTURED_FEATURE')).toBe(true);
    });

    it('isAllowedEvidenceSource returns false for an unknown tag rather than throwing', () => {
      expect(isAllowedEvidenceSource('PRODUCT_FAMILY', 'NOT_A_REAL_CODE', 'NAME_TEXT')).toBe(false);
    });

    it('COMMERCIAL_GYM never declares FAMILY_INFERENCE as an evidence source (must not be inferred from machine family alone)', () => {
      const tag = getOntologyTag('USE_CONTEXT', 'COMMERCIAL_GYM');
      expect(tag?.allowedEvidenceSources).not.toContain('FAMILY_INFERENCE');
    });

    it('HOME_GYM negative evidence documents that mere plausibility must never be used', () => {
      const tag = getOntologyTag('USE_CONTEXT', 'HOME_GYM');
      expect(tag?.negativeEvidence.join(' ')).toMatch(/plausib/i);
    });
  });

  // -- F. Category trust gates --
  describe('category trust gate', () => {
    it('PRODUCT_FAMILY allows SEMANTIC_STRONG and SEMANTIC_WEAK', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(new Set(registry.globalRules.categoryTrustGate.PRODUCT_FAMILY)).toEqual(new Set(['SEMANTIC_STRONG', 'SEMANTIC_WEAK']));
    });

    it('DISCIPLINE allows SEMANTIC_STRONG only', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.categoryTrustGate.DISCIPLINE).toEqual(['SEMANTIC_STRONG']);
    });

    it('USE_CONTEXT allows SEMANTIC_STRONG only', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.categoryTrustGate.USE_CONTEXT).toEqual(['SEMANTIC_STRONG']);
    });

    it('never permits CAMPAIGN, NAVIGATION, LEGACY, or UNKNOWN trust classes on any axis', () => {
      const registry = getCommercialProductOntologyRegistry();
      const disallowed = ['CAMPAIGN', 'NAVIGATION', 'LEGACY', 'UNKNOWN'];
      for (const axis of ontologyAxes) {
        for (const trustClass of registry.globalRules.categoryTrustGate[axis]) {
          expect(disallowed).not.toContain(trustClass);
        }
      }
    });
  });

  // -- G. Historical policy --
  describe('historical product policy', () => {
    it('applies to historical_order_detail_only catalog presence', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.historicalPolicy.appliesToCatalogPresence).toBe('historical_order_detail_only');
    });

    it('forbids automatic successor mapping and category/feature inference when unavailable', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.historicalPolicy.automaticSuccessorMappingAllowed).toBe(false);
      expect(registry.globalRules.historicalPolicy.categoryOrFeatureInferenceAllowedWhenUnavailable).toBe(false);
    });

    it('treats missing metadata as unknown, not negative evidence', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.historicalPolicy.missingMetadataIsUnknownNotNegative).toBe(true);
    });

    it('requires explicit name evidence for DISCIPLINE and USE_CONTEXT on historical rows', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.historicalPolicy.disciplineRequiresExplicitNameEvidence).toBe(true);
      expect(registry.globalRules.historicalPolicy.useContextRequiresExplicitNameEvidence).toBe(true);
    });

    it('is accessible programmatically from every tag, not only as prose', () => {
      const registry = getCommercialProductOntologyRegistry();
      for (const tag of registry.tags) {
        expect(typeof tag.historicalPolicy.classifiableFromNameOnly, `${tag.axis}/${tag.code}`).toBe('boolean');
      }
    });
  });

  // -- H. Non-product exclusion metadata --
  describe('non-product exclusion policy', () => {
    it('lists the 9 confirmed non-product SKU ids from A00.1C', () => {
      const registry = getCommercialProductOntologyRegistry();
      const ids = registry.globalRules.nonProductExclusion.knownExcludedProductIds;
      expect(ids).toHaveLength(9);
      expect(new Set(ids)).toEqual(new Set(['444', '505', '554', '555', '556', '557', '558', '902', '903']));
    });

    it('declares narrow, name-start-anchored exclusion patterns rather than broad substrings', () => {
      const registry = getCommercialProductOntologyRegistry();
      const patterns = registry.globalRules.nonProductExclusion.normalizedNameExclusionPatterns;
      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(pattern.startsWith('^'), `pattern "${pattern}" should be anchored to the start of the name`).toBe(true);
        expect(() => new RegExp(pattern)).not.toThrow();
      }
    });

    it('exclusion patterns match known non-product names but not legitimate product names', () => {
      const registry = getCommercialProductOntologyRegistry();
      const patterns = registry.globalRules.nonProductExclusion.normalizedNameExclusionPatterns.map((p) => new RegExp(p, 'i'));
      const matchesAny = (name: string) => patterns.some((re) => re.test(name));

      expect(matchesAny('servicio de armado tipo a-10')).toBe(true);
      expect(matchesAny('costo logistico')).toBe(true);
      expect(matchesAny('instalacion jaula a la pared')).toBe(true);

      // legitimate products must not be caught, including one whose description-style wording
      // contains "servicio" mid-string but not at the start of the name
      expect(matchesAny('barra olimpica 20kg training')).toBe(false);
      expect(matchesAny('power rack hell series')).toBe(false);
    });

    it('documents that application belongs to A00.3, not to this registry', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(registry.globalRules.nonProductExclusion.description).toMatch(/A00\.3/);
    });
  });

  // -- I. Immutability --
  describe('immutability', () => {
    it('throws when attempting to push into a tag’s positiveEvidence array', () => {
      const registry = getCommercialProductOntologyRegistry();
      const tag = registry.tags[0]!;
      const before = [...tag.positiveEvidence];
      expect(() => {
        (tag.positiveEvidence as unknown as string[]).push('mutated');
      }).toThrow();
      expect(tag.positiveEvidence).toEqual(before);
    });

    it('throws when attempting to reassign a tag field', () => {
      const tag = getOntologyTag('PRODUCT_FAMILY', 'BARBELL')!;
      expect(() => {
        (tag as unknown as { labelEs: string }).labelEs = 'Hacked';
      }).toThrow();
      expect(tag.labelEs).toBe('Barras');
    });

    it('throws when attempting to push a new tag into an axis', () => {
      const axis = getOntologyAxis('PRODUCT_FAMILY');
      expect(() => {
        (axis.tags as unknown as unknown[]).push({});
      }).toThrow();
      expect(axis.tags).toHaveLength(22);
    });

    it('throws when attempting to mutate globalRules', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(() => {
        (registry.globalRules as unknown as { allowedEvidenceSourceTypes: unknown[] }).allowedEvidenceSourceTypes = [];
      }).toThrow();
      expect(registry.globalRules.allowedEvidenceSourceTypes.length).toBeGreaterThan(0);
    });

    it('throws when attempting to mutate the known excluded product id list', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(() => {
        (registry.globalRules.nonProductExclusion.knownExcludedProductIds as unknown as string[]).push('999999');
      }).toThrow();
      expect(registry.globalRules.nonProductExclusion.knownExcludedProductIds).toHaveLength(9);
    });

    it('getCommercialProductOntologyRegistry always returns the same frozen singleton', () => {
      expect(getCommercialProductOntologyRegistry()).toBe(getCommercialProductOntologyRegistry());
      expect(Object.isFrozen(getCommercialProductOntologyRegistry())).toBe(true);
    });
  });

  // -- J. Deterministic registry hash --
  describe('deterministic registry hash', () => {
    it('is a 64-character lowercase hex sha256 digest', () => {
      const hash = computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistry());
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is identical across repeated calls (deterministic across executions)', () => {
      const registry = getCommercialProductOntologyRegistry();
      const first = computeCommercialProductOntologyRegistryHash(registry);
      const second = computeCommercialProductOntologyRegistryHash(registry);
      const third = computeCommercialProductOntologyRegistryHash(getCommercialProductOntologyRegistry());
      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it('changes if a semantically meaningful field changes', () => {
      const registry = getCommercialProductOntologyRegistry();
      const original = computeCommercialProductOntologyRegistryHash(registry);
      const mutated: CommercialProductOntologyRegistry = {
        ...registry,
        tags: registry.tags.map((t) => (t.code === 'BARBELL' ? { ...t, definition: `${t.definition} (changed)` } : t)),
      };
      expect(computeCommercialProductOntologyRegistryHash(mutated)).not.toBe(original);
    });

    it('is unaffected by object key insertion order', () => {
      const registry = getCommercialProductOntologyRegistry();
      const reordered = JSON.parse(
        JSON.stringify(registry, (_key, value) => {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value).sort().reverse();
            const out: Record<string, unknown> = {};
            for (const k of keys) out[k] = (value as Record<string, unknown>)[k];
            return out;
          }
          return value;
        }),
      ) as CommercialProductOntologyRegistry;
      expect(computeCommercialProductOntologyRegistryHash(reordered)).toBe(computeCommercialProductOntologyRegistryHash(registry));
    });
  });

  // -- K. Stable deterministic serialization --
  describe('deterministic serialization', () => {
    it('produces identical output across repeated calls', () => {
      const registry = getCommercialProductOntologyRegistry();
      expect(serializeCommercialProductOntologyRegistry(registry)).toBe(serializeCommercialProductOntologyRegistry(registry));
    });

    it('produces valid JSON that round-trips to an equivalent structure', () => {
      const registry = getCommercialProductOntologyRegistry();
      const parsed = JSON.parse(serializeCommercialProductOntologyRegistry(registry));
      expect(parsed.registryVersion).toBe(registry.registryVersion);
      expect(parsed.tags).toHaveLength(registry.tags.length);
    });

    it('preserves canonical axis order (PRODUCT_FAMILY, DISCIPLINE, USE_CONTEXT) and in-axis tag order', () => {
      const registry = getCommercialProductOntologyRegistry();
      const parsed = JSON.parse(serializeCommercialProductOntologyRegistry(registry));
      expect(parsed.axes.map((a: { axis: string }) => a.axis)).toEqual(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
      expect(parsed.axes[0].tags.map((t: { code: string }) => t.code)[0]).toBe('BARBELL');
    });

    it('serialization hash matches the registry hash function', () => {
      const registry = getCommercialProductOntologyRegistry();
      const manual = createHash('sha256').update(serializeCommercialProductOntologyRegistry(registry)).digest('hex');
      expect(manual).toBe(computeCommercialProductOntologyRegistryHash(registry));
    });
  });

  // -- L. Deferred/dropped axes --
  describe('deferred/dropped axes', () => {
    it('TRAINING_OBJECTIVE is DEFER, COMMERCIAL_LEVEL and COMMERCIAL_ROLE are DROP', () => {
      const byAxis = new Map(deferredOrDroppedAxes.map((d) => [d.axis, d]));
      expect(byAxis.get('TRAINING_OBJECTIVE')?.decision).toBe('DEFER');
      expect(byAxis.get('COMMERCIAL_LEVEL')?.decision).toBe('DROP');
      expect(byAxis.get('COMMERCIAL_ROLE')?.decision).toBe('DROP');
    });

    it('every deferred/dropped axis carries a non-empty reason', () => {
      for (const d of deferredOrDroppedAxes) {
        expect(d.reason.length, d.axis).toBeGreaterThan(0);
      }
    });

    it('none of the deferred/dropped axes appear as active axes', () => {
      const registry = getCommercialProductOntologyRegistry();
      const activeAxisNames = new Set(registry.axes.map((a) => a.axis as string));
      for (const d of deferredOrDroppedAxes) {
        expect(activeAxisNames.has(d.axis)).toBe(false);
      }
    });

    it('exposes exactly the 3 deferred/dropped axes considered in A00.1C', () => {
      expect(deferredOrDroppedAxes.map((d) => d.axis).sort()).toEqual(['COMMERCIAL_LEVEL', 'COMMERCIAL_ROLE', 'TRAINING_OBJECTIVE']);
    });
  });

  // -- M. Duplicate-tag validation failure --
  describe('validator rejects a broken registry: duplicate tag code', () => {
    it('throws when the same code appears twice within one axis', () => {
      const registry = getCommercialProductOntologyRegistry();
      const barbell = registry.tags.find((t) => t.axis === 'PRODUCT_FAMILY' && t.code === 'BARBELL')!;
      const productFamilyAxis = registry.axes.find((a) => a.axis === 'PRODUCT_FAMILY')!;
      const broken: CommercialProductOntologyRegistry = {
        ...registry,
        axes: registry.axes.map((a) => (a.axis === 'PRODUCT_FAMILY' ? { ...productFamilyAxis, tags: [...productFamilyAxis.tags, barbell] } : a)),
        tags: [...registry.tags, barbell],
      };

      expect(() => validateCommercialProductOntologyRegistry(broken)).toThrow(/duplicate tag code "BARBELL"/);
    });

    it('throws when the flattened tags array is inconsistent with axes[].tags', () => {
      const registry = getCommercialProductOntologyRegistry();
      const broken: CommercialProductOntologyRegistry = {
        ...registry,
        tags: registry.tags.slice(1),
      };

      expect(() => validateCommercialProductOntologyRegistry(broken)).toThrow(/does not match the concatenation/);
    });
  });

  // -- N. Invalid evidence-source validation failure --
  describe('validator rejects a broken registry: invalid evidence source', () => {
    it('throws when a tag declares an evidence source outside the allowed enum', () => {
      const registry = getCommercialProductOntologyRegistry();
      const broken: CommercialProductOntologyRegistry = {
        ...registry,
        axes: registry.axes.map((a) =>
          a.axis === 'DISCIPLINE'
            ? {
                ...a,
                tags: a.tags.map((t) =>
                  t.code === 'CROSSFIT' ? { ...t, allowedEvidenceSources: [...t.allowedEvidenceSources, 'FREE_TEXT_DESCRIPTION' as never] } : t,
                ),
              }
            : a,
        ),
      };
      // keep the flattened view consistent so this failure is isolated to the evidence-source check
      const rebuilt: CommercialProductOntologyRegistry = { ...broken, tags: broken.axes.flatMap((a) => a.tags) };

      expect(() => validateCommercialProductOntologyRegistry(rebuilt)).toThrow(/unknown evidence source "FREE_TEXT_DESCRIPTION"/);
    });

    it('throws when residual=true is set on a non-PRODUCT_FAMILY tag', () => {
      const registry = getCommercialProductOntologyRegistry();
      const broken: CommercialProductOntologyRegistry = {
        ...registry,
        axes: registry.axes.map((a) => (a.axis === 'DISCIPLINE' ? { ...a, tags: a.tags.map((t, i) => (i === 0 ? { ...t, residual: true } : t)) } : a)),
      };
      const rebuilt: CommercialProductOntologyRegistry = { ...broken, tags: broken.axes.flatMap((a) => a.tags) };

      expect(() => validateCommercialProductOntologyRegistry(rebuilt)).toThrow(/residual=true is only permitted in PRODUCT_FAMILY/);
    });

    it('throws when the real tag count for an axis is wrong', () => {
      const registry = getCommercialProductOntologyRegistry();
      const useContextAxis = registry.axes.find((a) => a.axis === 'USE_CONTEXT')!;
      const broken: CommercialProductOntologyRegistry = {
        ...registry,
        axes: registry.axes.map((a) => (a.axis === 'USE_CONTEXT' ? { ...a, tags: useContextAxis.tags.slice(0, 3) } : a)),
      };
      const rebuilt: CommercialProductOntologyRegistry = { ...broken, tags: broken.axes.flatMap((a) => a.tags) };

      expect(() => validateCommercialProductOntologyRegistry(rebuilt)).toThrow(/USE_CONTEXT: expected exactly 6 real tags, found 3/);
    });

    it('accepts the real, unmodified registry without throwing', () => {
      expect(() => validateCommercialProductOntologyRegistry(getCommercialProductOntologyRegistry())).not.toThrow();
    });
  });
});
