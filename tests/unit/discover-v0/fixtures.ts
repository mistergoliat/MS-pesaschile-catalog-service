import { DISCOVER_V0_RETRIEVAL_VERSION, type SpecKeyV0 } from '../../../src/application/catalog/discover-v0/contracts.js';
import { DISCOVER_V0_LEXICON_VERSION } from '../../../src/application/catalog/discover-v0/lexicon.js';
import {
  assembleDiscoverIndex,
  DISCOVER_V0_DOCUMENT_RULES_VERSION,
  type DiscoverIndex,
  type DocumentAdmission,
  type ProductRetrievalDocument,
} from '../../../src/application/catalog/discover-v0/retrievalDocument.js';

/*
 * SYNTHETIC fixtures for CAT-DISCOVER-V0 unit tests. Product ids, names and facts
 * are invented for the test only and never stand for catalog records.
 */

export const SYNTHETIC_BUNDLE_ID = 'sha256:' + '1'.repeat(64);
export const SYNTHETIC_SOURCE_ID = 'sha256:' + '2'.repeat(64);

const admitted: DocumentAdmission = {
  productDiscovery: 'ADMITTED', exerciseDiscovery: 'ADMITTED', functionDiscovery: 'ADMITTED',
  specFilteringByKey: { weight_kg: 'ADMITTED', max_user_weight_kg: 'ADMITTED', max_load_kg: 'ADMITTED', assembled_length_cm: 'ADMITTED', assembled_width_cm: 'ADMITTED', assembled_height_cm: 'ADMITTED' },
  unified: 'ADMITTED', lexicalSearch: 'ADMITTED', exerciseNegativeEvidence: 'NOT_REQUIRED', functionNegativeEvidence: 'NOT_REQUIRED', consolidation: 'CONSOLIDATED',
  unmetFamilyObligations: [],
};

type DocInput = {
  id: number;
  name: string;
  family?: string | null;
  classificationStatus?: string;
  exercises?: { code: string; relationType?: string; muscleGroups?: string[] }[];
  functions?: { code: string; relationType?: string }[];
  resolutionState?: string;
  specs?: { key: SpecKeyV0; value: number | null; status?: 'parsed' | 'ambiguous' | 'unsupported'; rawValue?: string; qualifier?: string | null }[];
  admission?: Partial<DocumentAdmission>;
  categories?: { categoryId: number; name: string; trustClass: string }[];
  inUniverse?: boolean;
  disciplines?: string[];
  training?: false;
};

export function doc(input: DocInput): ProductRetrievalDocument {
  return {
    productKey: `P${input.id}`,
    productId: input.id,
    name: input.name,
    references: [],
    brand: null,
    catalogPresence: 'current_catalog',
    current: true,
    active: true,
    inUniverse: input.inUniverse ?? true,
    universeExclusion: input.inUniverse === false ? 'INACTIVE' : null,
    categories: input.categories ?? [],
    features: [],
    productSemantics: {
      classificationStatus: input.classificationStatus ?? (input.family ? 'CLASSIFIED' : 'OTHER'),
      primaryFamily: input.family ? { code: input.family, confidence: 'EXPLICIT', ruleId: `PF_${input.family}_NAME_V1` } : null,
      secondaryFamilies: [],
      disciplines: (input.disciplines ?? []).map((code) => ({ code, confidence: 'EXPLICIT', ruleId: `DIS_${code}` })),
      useContexts: [],
    },
    training: input.training === false ? null : {
      resolutionState: input.resolutionState ?? ((input.exercises?.length || input.functions?.length) ? 'SEMANTIC_COMPLETE' : 'ONTOLOGY_GAP'),
      coverageStatus: 'UNMODELED',
      exercises: (input.exercises ?? []).map((exercise) => ({ code: exercise.code, relationType: exercise.relationType ?? 'DIRECT', confidence: 'HIGH', ruleIds: ['SYNTHETIC_RULE'],
        muscleGroups: exercise.muscleGroups ?? [], bodyRegions: [] })),
      functions: (input.functions ?? []).map((fn) => ({ code: fn.code, relationType: fn.relationType ?? 'DIRECT', confidence: 'EXPLICIT', ruleIds: ['SYNTHETIC_RULE'] })),
    },
    specs: (input.specs ?? []).map((spec) => ({ key: spec.key, value: spec.value, unit: spec.key.endsWith('_cm') ? 'cm' : 'kg', status: spec.status ?? 'parsed',
      rawValue: spec.rawValue ?? `${spec.value} kg.`, featureId: 3, featureValueId: 900000 + input.id, derivationRule: 'feature-3-kg-v1', qualifier: spec.qualifier ?? null })),
    admission: { ...admitted, ...input.admission },
  };
}

export function syntheticIndex(documents: ProductRetrievalDocument[], options: { degraded?: string[]; relationships?: 'PRESENT' | 'UNAVAILABLE' } = {}): DiscoverIndex {
  return assembleDiscoverIndex({
    label: 'synthetic', bundleId: SYNTHETIC_BUNDLE_ID, sourceExtractionId: SYNTHETIC_SOURCE_ID, documents, degraded: options.degraded ?? [],
    lineage: {
      productSemanticsSnapshotId: 'sha256:' + '3'.repeat(64), trainingV2SnapshotId: 'sha256:' + '4'.repeat(64), trainingV2ProjectionId: 'sha256:' + '5'.repeat(64),
      specsSnapshotId: 'sha256:' + '6'.repeat(64), relationships: options.relationships ?? 'UNAVAILABLE', admissionContractHash: 'sha256:' + '7'.repeat(64),
      lineageVerified: true, sourceHashesVerified: true, documentRulesVersion: DISCOVER_V0_DOCUMENT_RULES_VERSION, retrievalVersion: DISCOVER_V0_RETRIEVAL_VERSION,
      lexiconVersion: DISCOVER_V0_LEXICON_VERSION,
    },
  });
}

/** A small synthetic catalog that exercises every constraint state. */
export function syntheticCatalog(): ProductRetrievalDocument[] {
  return [
    doc({ id: 1, name: 'Kettlebell Hierro 20kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 20 }] }),
    doc({ id: 2, name: 'Kettlebell Hierro 24kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 24 }] }),
    doc({ id: 3, name: 'Kettlebell Vinilo 20kg', family: 'KETTLEBELL' }),
    doc({ id: 4, name: 'Kettlebell Competencia 20kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 20, rawValue: '20 kg. Aprox. (No calibrada)', qualifier: 'aprox no calibrada' }] }),
    doc({ id: 5, name: 'Kettlebell Pro 20kg', family: 'KETTLEBELL', specs: [{ key: 'weight_kg', value: 20 }], admission: { specFilteringByKey: { weight_kg: 'BLOCKED' } } }),
    doc({ id: 6, name: 'Mancuerna Hexagonal 20kg', family: 'DUMBBELL', specs: [{ key: 'weight_kg', value: 20 }] }),
    doc({ id: 7, name: 'Par Discos Olimpicos 20kg', family: 'WEIGHT_PLATE', specs: [{ key: 'weight_kg', value: 20, rawValue: '20 kg. cada disco', qualifier: 'cada disco' }] }),
    doc({ id: 10, name: 'Barra Dominadas Muro', family: 'BODYWEIGHT_GYMNASTICS', exercises: [{ code: 'PULL_UP', muscleGroups: ['BACK', 'BICEPS'] }] }),
    doc({ id: 11, name: 'Barra Dominadas Accesorio Rack', family: 'MACHINE_ATTACHMENT', exercises: [{ code: 'PULL_UP', muscleGroups: ['BACK', 'BICEPS'] }], admission: { exerciseDiscovery: 'BLOCKED' } }),
    doc({ id: 12, name: 'Par Anillas Gimnasia', family: 'BODYWEIGHT_GYMNASTICS', resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', admission: { exerciseNegativeEvidence: 'ABSENT' } }),
    doc({ id: 13, name: 'Banco Plano', family: 'BENCH', resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY', admission: { exerciseNegativeEvidence: 'PRESENT' },
      specs: [{ key: 'max_user_weight_kg', value: 150 }] }),
    doc({ id: 20, name: 'Agarre Simple Accesorio Polea', family: 'CABLE_MACHINE', resolutionState: 'VERIFIED_NO_APPLICABLE_CAPABILITY',
      admission: { functionNegativeEvidence: 'PRESENT', unmetFamilyObligations: ['TRAINING_FUNCTION'] } }),
    doc({ id: 21, name: 'Polea Cruzada Estacion', family: 'CABLE_MACHINE', functions: [{ code: 'CABLE_RESISTANCE' }] }),
    doc({ id: 22, name: 'Par J-Cups Accesorio', family: 'MACHINE_ATTACHMENT', admission: { productDiscovery: 'BLOCKED' } }),
    doc({ id: 23, name: 'Ankle Straps Cuero', family: 'MACHINE_ATTACHMENT' }),
    doc({ id: 24, name: 'Collarines Olimpicos 50mm', family: 'MACHINE_ATTACHMENT' }),
    doc({ id: 25, name: 'Barra Olimpica 20kg', family: 'BARBELL', specs: [{ key: 'weight_kg', value: 20 }] }),
    doc({ id: 30, name: 'Producto Inactivo Kettlebell 20kg', family: 'KETTLEBELL', inUniverse: false }),
    doc({ id: 31, name: 'Pack Mancuernas con Rack', family: 'DUMBBELL' }),
    doc({ id: 32, name: 'Bicicleta Spinning Casa', family: 'CARDIO_MACHINE' }),
  ];
}
