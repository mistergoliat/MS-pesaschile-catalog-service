import { describe, expect, it } from 'vitest';
import { DISCOVER_V0_LEXICON } from '../../../src/application/catalog/discover-v0/lexicon.js';
import { DiscoverQueryInterpreter } from '../../../src/application/catalog/discover-v0/queryInterpreter.js';
import { commercialProductOntologyRegistryVersionV3, getOntologyTagsForAxis } from '../../../src/domain/commercial-product-ontology/index.js';
import { getTrainingSemanticRegistryV2 } from '../../../src/domain/training-semantics-v2/index.js';
import { bodyRegionCodes, muscleGroupCodes } from '../../../src/domain/training-semantics/contracts.js';

const interpreter = new DiscoverQueryInterpreter();
const hard = (query: string) => interpreter.interpret(query).hardConstraints;
const soft = (query: string) => interpreter.interpret(query).softPreferences;

describe('DiscoverQueryInterpreter', () => {
  it('separates product type and a weight spec from "pesa rusa de 20 kg"', () => {
    const constraints = hard('pesa rusa de 20 kg');
    expect(constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'PRODUCT_TYPE', codes: ['KETTLEBELL'] }),
      expect.objectContaining({ kind: 'SPEC', specKey: 'weight_kg', operator: 'EQ', value: 20 }),
    ]));
    expect(interpreter.interpret('pesa rusa de 20 kg').synonymExpansions[0]?.replacement).toEqual(['kettlebell']);
  });

  it('parses user weight, load, dimensions with unit conversion and prices', () => {
    expect(hard('banco para una persona de 150 kg')).toEqual(expect.arrayContaining([expect.objectContaining({ specKey: 'max_user_weight_kg', operator: 'GTE', value: 150 })]));
    expect(hard('rack que soporte 400 kg')).toEqual(expect.arrayContaining([expect.objectContaining({ specKey: 'max_load_kg', operator: 'GTE', value: 400 })]));
    expect(hard('banco de menos de 1.3 m de largo')).toEqual(expect.arrayContaining([expect.objectContaining({ specKey: 'assembled_length_cm', operator: 'LTE', value: 130 })]));
    expect(hard('jaula de mas de 200 cm de alto')).toEqual(expect.arrayContaining([expect.objectContaining({ specKey: 'assembled_height_cm', operator: 'GTE', value: 200 })]));
    expect(hard('kettlebell menos de 50 mil')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'COMMERCIAL_MAX_PRICE', domain: 'COMMERCIAL', value: 50000 })]));
    expect(hard('banco hasta $120.000')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'COMMERCIAL_MAX_PRICE', value: 120000 })]));
  });

  it('does not turn a bare measure into a spec without a load family', () => {
    const interpretation = interpreter.interpret('rack 20kg');
    expect(interpretation.hardConstraints.some((constraint) => constraint.kind === 'SPEC')).toBe(false);
    expect(interpretation.entries).toEqual(expect.arrayContaining([expect.objectContaining({ text: '20kg', state: 'UNKNOWN', note: 'WEIGHT_WITHOUT_LOAD_FAMILY' })]));
    expect(interpretation.lexicalTokens).toContain('20kg');
  });

  it('keeps disciplines and use contexts as preferences, and honours soft markers', () => {
    expect(soft('banco para crossfit en casa').map((constraint) => constraint.kind).sort()).toEqual(['DISCIPLINE', 'USE_CONTEXT']);
    expect(hard('banco para crossfit en casa').map((constraint) => constraint.kind)).toEqual(['PRODUCT_TYPE']);
    expect(soft('banco idealmente con dominadas').map((constraint) => constraint.kind)).toContain('EXERCISE');
  });

  it('models compatibility and substitution as constraints, never as concepts of the need', () => {
    const constraints = hard('collarines compatibles con barra olimpica');
    expect(constraints.find((constraint) => constraint.kind === 'COMPATIBILITY')?.target).toBe('barra olimpica');
    expect(constraints.find((constraint) => constraint.kind === 'PRODUCT_TYPE')?.codes).toEqual(['MACHINE_ATTACHMENT']);
    expect(hard('disco para barra olimpica').map((constraint) => constraint.kind)).toEqual(expect.arrayContaining(['COMPATIBILITY', 'PRODUCT_TYPE']));
    expect(hard('algo parecido al P1543').map((constraint) => constraint.kind)).toContain('SUBSTITUTION');
  });

  it('keeps unknown terms as retrieval text and never invents anatomy or exercises', () => {
    const interpretation = interpreter.interpret('algo para la rodilla y sentadillas');
    expect(interpretation.recognizedConcepts).toEqual([]);
    expect(interpretation.unrecognizedTerms).toEqual(expect.arrayContaining(['rodilla', 'sentadillas']));
    expect(interpretation.entries).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'sentadillas', state: 'UNKNOWN' })]));
    expect(interpretation.lexicalTokens).toEqual(expect.arrayContaining(['rodilla', 'sentadillas']));
  });

  it('marks subtypes as lexical relevance requirements and family-level words as plain families', () => {
    expect(hard('j cups')[0]).toMatchObject({ kind: 'PRODUCT_TYPE', codes: ['MACHINE_ATTACHMENT'], subtypeText: [['j', 'cup']] });
    expect(hard('mancuernas')[0]!.subtypeText).toBeUndefined();
  });

  it('adds a nominal-text condition only when nothing was interpreted', () => {
    expect(hard('proteina whey')).toEqual([expect.objectContaining({ kind: 'NOMINAL_TEXT', matchedText: 'proteina whey' })]);
    expect(hard('mancuernas').some((constraint) => constraint.kind === 'NOMINAL_TEXT')).toBe(false);
  });
});

describe('governed lexicon', () => {
  const registry = getTrainingSemanticRegistryV2();
  const allowed: Record<string, Set<string>> = {
    PRODUCT_FAMILY: new Set(getOntologyTagsForAxis('PRODUCT_FAMILY', commercialProductOntologyRegistryVersionV3).map((tag) => tag.code)),
    DISCIPLINE: new Set(getOntologyTagsForAxis('DISCIPLINE', commercialProductOntologyRegistryVersionV3).map((tag) => tag.code)),
    USE_CONTEXT: new Set(getOntologyTagsForAxis('USE_CONTEXT', commercialProductOntologyRegistryVersionV3).map((tag) => tag.code)),
    EXERCISE_CAPABILITY: new Set(registry.exerciseCapabilities.map((definition) => definition.code)),
    TRAINING_FUNCTION: new Set(registry.trainingFunctions.map((definition) => definition.code)),
    MUSCLE_GROUP: new Set(muscleGroupCodes),
    BODY_REGION: new Set(bodyRegionCodes),
  };

  it('maps only to codes that exist in the registries', () => {
    for (const entry of DISCOVER_V0_LEXICON) {
      if (entry.type === 'CONCEPT') expect(allowed[entry.axis]?.has(entry.code), `${entry.id} → ${entry.axis}:${entry.code}`).toBe(true);
    }
  });

  it('declares provenance and review status for every entry', () => {
    for (const entry of DISCOVER_V0_LEXICON) {
      expect(entry.provenance.source).toBeTruthy();
      expect(['INHERITED_PRODUCTION_TABLE', 'PENDING_DOMAIN_REVIEW']).toContain(entry.reviewStatus);
    }
    expect(new Set(DISCOVER_V0_LEXICON.map((entry) => entry.id)).size).toBe(DISCOVER_V0_LEXICON.length);
  });
});
