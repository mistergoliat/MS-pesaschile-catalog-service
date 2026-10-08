import { DEFAULT_PRODUCT_SEARCH_SYNONYMS } from '../product-intent/synonyms.js';
import type { ConceptAxis } from './contracts.js';

/*
 * CAT-DISCOVER-V0 governed query lexicon.
 *
 * Maps Spanish query phrases to EXISTING registry codes (Product Ontology v3,
 * Training Semantics V2 registry). It never creates a new concept: every code
 * below exists in the registries, and anatomy codes are only the registry's own
 * exercise-derived MUSCLE_GROUP / BODY_REGION codes (no new anatomical mapping).
 *
 * Provenance of every entry is explicit:
 *  - PRODUCT_INTENT_SYNONYMS: inherited verbatim from the production table
 *    src/application/catalog/product-intent/synonyms.ts.
 *  - CLASSIFIER_NAME_VOCABULARY: the same word the Product Semantics name rule
 *    (ruleId) uses for that family; the lexicon reuses the vocabulary, not the
 *    classifier's first-match precedence.
 *  - REGISTRY_CANONICAL_NAME: the registry's English canonical name.
 *  - DISCOVER_V0_TRANSLATION: Spanish rendering of a registry code proposed for
 *    this prototype. NOT domain-reviewed (reviewStatus PENDING_DOMAIN_REVIEW).
 *
 * Unmodeled entries record terms that must stay UNKNOWN because no registry code
 * covers them (e.g. a generic "sentadilla"), so the interpreter never guesses.
 */

export const DISCOVER_V0_LEXICON_VERSION = 'discover-v0-lexicon-v1';

export type LexiconProvenance =
  | { source: 'PRODUCT_INTENT_SYNONYMS'; file: string }
  | { source: 'CLASSIFIER_NAME_VOCABULARY'; ruleId: string }
  | { source: 'REGISTRY_CANONICAL_NAME'; registry: string }
  | { source: 'DISCOVER_V0_TRANSLATION'; note?: string };

export type LexiconReviewStatus = 'INHERITED_PRODUCTION_TABLE' | 'PENDING_DOMAIN_REVIEW';

export type ConceptLexiconEntry = {
  id: string;
  type: 'CONCEPT';
  terms: string[];
  axis: ConceptAxis;
  code: string;
  provenance: LexiconProvenance;
  reviewStatus: LexiconReviewStatus;
  note?: string;
  /**
   * PRODUCT_FAMILY only: terms that name the family as a whole. Any other term of
   * the entry names a SUBTYPE the ontology does not model ("j cups" within
   * MACHINE_ATTACHMENT); a subtype is a lexical relevance requirement, never a
   * certified claim.
   */
  familyLevelTerms?: string[];
};

export type SynonymLexiconEntry = {
  id: string;
  type: 'LEXICAL_SYNONYM';
  terms: string[];
  replacements: string[];
  provenance: LexiconProvenance;
  reviewStatus: LexiconReviewStatus;
};

export type MarkerLexiconEntry = {
  id: string;
  type: 'UNMODELED' | 'COMPATIBILITY' | 'SOFT_MARKER' | 'FILLER' | 'COMMERCIAL_LOW_PRICE' | 'COMMERCIAL_AVAILABILITY';
  terms: string[];
  note: string;
  /** UNMODELED only: the term carries part of the NEED (not a modifier), so the need cannot be verified. */
  blocking?: 'UNMODELED_NEED' | 'SUBSTITUTION' | 'VARIANT_ATTRIBUTE';
  provenance: LexiconProvenance;
  reviewStatus: LexiconReviewStatus;
};

export type LexiconEntry = ConceptLexiconEntry | SynonymLexiconEntry | MarkerLexiconEntry;

const T: LexiconProvenance = { source: 'DISCOVER_V0_TRANSLATION' };
const P = 'PENDING_DOMAIN_REVIEW' as const;
const rule = (ruleId: string): LexiconProvenance => ({ source: 'CLASSIFIER_NAME_VOCABULARY', ruleId });
const registry = (name: string): LexiconProvenance => ({ source: 'REGISTRY_CANONICAL_NAME', registry: name });
const TRAINING_V2 = 'training-semantic-registry-v2';

function concept(id: string, axis: ConceptAxis, code: string, terms: string[], provenance: LexiconProvenance = T, note?: string): ConceptLexiconEntry {
  return { id, type: 'CONCEPT', axis, code, terms, provenance, reviewStatus: P, ...(note ? { note } : {}) };
}

const FAMILY_LEVEL_TERMS: Record<string, string[]> = {
  BARBELL: ['barra', 'barras'],
  WEIGHT_PLATE: ['disco', 'discos'],
  DUMBBELL: ['mancuerna', 'mancuernas'],
  KETTLEBELL: ['kettlebell', 'kettlebells', 'pesa rusa', 'pesas rusas'],
  BENCH: ['banco', 'bancos'],
  RACK_CAGE: ['rack', 'racks', 'jaula', 'jaulas'],
  CABLE_MACHINE: ['polea', 'poleas', 'maquina de poleas', 'estacion de poleas'],
  PLATE_LOADED_MACHINE: ['maquina de carga de discos', 'carga de discos'],
  SELECTORIZED_MACHINE: ['selectorizada', 'maquina selectorizada', 'maquinas selectorizadas'],
  CARDIO_MACHINE: ['maquina de cardio', 'maquinas de cardio'],
  FLOORING: ['piso', 'pisos'],
  STORAGE: ['almacenamiento', 'rack de almacenamiento', 'organizador'],
  BAND_SUSPENSION: ['banda', 'bandas', 'banda elastica', 'bandas elasticas'],
};

const FAMILY: ConceptLexiconEntry[] = [
  concept('fam.barbell', 'PRODUCT_FAMILY', 'BARBELL', ['barra', 'barras', 'barra olimpica', 'barras olimpicas', 'barra z', 'barra hexagonal'], rule('PF_BARBELL_NAME_V1')),
  concept('fam.weight_plate', 'PRODUCT_FAMILY', 'WEIGHT_PLATE', ['disco', 'discos', 'bumper', 'bumpers', 'disco olimpico', 'discos olimpicos', 'disco de goma', 'discos de goma', 'fraccionales'], rule('PF_WEIGHT_PLATE_NAME_V1')),
  concept('fam.dumbbell', 'PRODUCT_FAMILY', 'DUMBBELL', ['mancuerna', 'mancuernas'], rule('PF_DUMBBELL_NAME_V1')),
  concept('fam.kettlebell', 'PRODUCT_FAMILY', 'KETTLEBELL', ['kettlebell', 'kettlebells', 'pesa rusa', 'pesas rusas'], rule('PF_KETTLEBELL_NAME_V1')),
  concept('fam.bench', 'PRODUCT_FAMILY', 'BENCH', ['banco', 'bancos', 'ghd'], rule('PF_BENCH_NAME_V1')),
  concept('fam.rack_cage', 'PRODUCT_FAMILY', 'RACK_CAGE', ['rack', 'racks', 'power rack', 'squat rack', 'jaula', 'jaulas', 'atril', 'atriles', 'rack para sentadillas', 'rack de sentadillas'], rule('PF_RACK_CAGE_NAME_V1')),
  concept('fam.cable_machine', 'PRODUCT_FAMILY', 'CABLE_MACHINE', ['polea', 'poleas', 'maquina de poleas', 'polea cruzada', 'crossover', 'estacion de poleas'], rule('PF_CABLE_MACHINE_NAME_V1'),
    'Station-level wording. Passive pulley accessories are mapped to MACHINE_ATTACHMENT below (aligned with the QA2-B1 proposal, NOT adjudicated).'),
  concept('fam.machine_attachment', 'PRODUCT_FAMILY', 'MACHINE_ATTACHMENT', ['accesorio de polea', 'accesorio para polea', 'accesorios de polea', 'accesorio polea', 'agarre', 'agarres', 'agarre de polea', 'agarre para polea', 'maneral', 'manilla', 'soga de triceps', 'collarin', 'collarines', 'j cups', 'jcups', 'j cup', 'landmine', 'ankle straps', 'spotter arms', 'soporte para barra'], rule('PF_MACHINE_ATTACHMENT_NAME_V1'),
    'Registry definition lists collars, J-cups, spotter arms, ankle straps, mount hardware; cable grips added as a lexicon proposal only.'),
  concept('fam.plate_loaded', 'PRODUCT_FAMILY', 'PLATE_LOADED_MACHINE', ['maquina de carga de discos', 'carga de discos', 'smith', 'maquina smith', 'multipower'], rule('PF_PLATE_LOADED_MACHINE_NAME_V1')),
  concept('fam.selectorized', 'PRODUCT_FAMILY', 'SELECTORIZED_MACHINE', ['selectorizada', 'maquina selectorizada', 'maquinas selectorizadas'], rule('PF_SELECTORIZED_MACHINE_NAME_V1')),
  concept('fam.cardio', 'PRODUCT_FAMILY', 'CARDIO_MACHINE', ['trotadora', 'trotadoras', 'cinta de correr', 'bicicleta de spinning', 'bicicleta estatica', 'spinning', 'eliptica', 'elipticas', 'remo de aire', 'remo ergometro', 'air bike', 'airbike', 'escaladora', 'maquina de cardio', 'maquinas de cardio'], rule('PF_CARDIO_MACHINE_NAME_V1')),
  concept('fam.flooring', 'PRODUCT_FAMILY', 'FLOORING', ['piso', 'pisos', 'piso de caucho', 'palmeta', 'palmetas', 'tatami', 'plataforma de levantamiento', 'pasto sintetico'], rule('PF_FLOORING_NAME_V1')),
  concept('fam.storage', 'PRODUCT_FAMILY', 'STORAGE', ['rack de almacenamiento', 'almacenamiento', 'organizador', 'rack organizador',
    'rack para mancuernas', 'rack para discos', 'rack para barras', 'rack para kettlebells', 'rack para balones', 'porta mancuernas'], rule('PF_STORAGE_NAME_V1')),
  concept('fam.ball_bag', 'PRODUCT_FAMILY', 'BALL_BAG', ['balon medicinal', 'balones medicinales', 'slam ball', 'slam balls', 'sandbag', 'saco bulgaro', 'wall ball'], rule('PF_BALL_BAG_NAME_V1')),
  concept('fam.rope_sled', 'PRODUCT_FAMILY', 'ROPE_SLED', ['cuerda de salto', 'cuerda para saltar', 'cuerdas de salto', 'battle rope', 'trineo', 'sled', 'soga de trepa', 'speed rope'], rule('PF_ROPE_SLED_NAME_V1')),
  concept('fam.band', 'PRODUCT_FAMILY', 'BAND_SUSPENSION', ['banda', 'bandas', 'banda elastica', 'bandas elasticas', 'bandas de resistencia', 'banda de resistencia', 'banda de suspension', 'trx', 'liga', 'ligas'], rule('PF_BAND_SUSPENSION_NAME_V1')),
  concept('fam.bodyweight', 'PRODUCT_FAMILY', 'BODYWEIGHT_GYMNASTICS', ['paralelas', 'barras paralelas', 'anillas', 'anillas de gimnasia'], rule('PF_BODYWEIGHT_GYMNASTICS_NAME_V1')),
  concept('fam.protective', 'PRODUCT_FAMILY', 'PROTECTIVE_GEAR', ['cinturon', 'cinturon de levantamiento', 'rodilleras', 'munequeras', 'calleras', 'guantes', 'vendas'], rule('PF_PROTECTIVE_GEAR_NAME_V1')),
  concept('fam.recovery', 'PRODUCT_FAMILY', 'RECOVERY_TOOL', ['foam roller', 'rodillo de espuma', 'pistola de masaje', 'masajeador', 'botas de compresion', 'camara hiperbarica'], rule('PF_RECOVERY_TOOL_NAME_V1')),
  concept('fam.yoga', 'PRODUCT_FAMILY', 'YOGA_PILATES', ['mat de yoga', 'colchoneta de yoga', 'bloque de yoga', 'balon de pilates', 'pelota de pilates'], rule('PF_YOGA_PILATES_NAME_V1')),
  concept('fam.apparel', 'PRODUCT_FAMILY', 'APPAREL', ['polera', 'poleras', 'gorra', 'poleron', 'mochila', 'morral'], rule('PF_APPAREL_NAME_V1')),
];

const EXERCISE: ConceptLexiconEntry[] = [
  concept('ex.pull_up', 'EXERCISE_CAPABILITY', 'PULL_UP', ['dominada', 'dominadas', 'pull up', 'pull ups', 'barra de dominadas', 'barra para dominadas', 'barra pull up', 'barra de dominada'], registry(TRAINING_V2)),
  concept('ex.dip', 'EXERCISE_CAPABILITY', 'DIP', ['fondos', 'dip', 'dips', 'soporte para fondos'], registry(TRAINING_V2)),
  concept('ex.lat_pulldown', 'EXERCISE_CAPABILITY', 'LAT_PULLDOWN', ['jalon', 'jalon al pecho', 'lat pulldown', 'lat pull down'], registry(TRAINING_V2)),
  concept('ex.row', 'EXERCISE_CAPABILITY', 'ROW', ['remo sentado', 'remo bajo', 'remo con polea', 't bar row', 'remo t'], registry(TRAINING_V2), 'Bare "remo" is ambiguous with cardio rowers and is UNMODELED.'),
  concept('ex.chest_press', 'EXERCISE_CAPABILITY', 'CHEST_PRESS', ['press de pecho', 'press pectoral', 'chest press'], registry(TRAINING_V2)),
  concept('ex.pec_deck', 'EXERCISE_CAPABILITY', 'PEC_DECK', ['pec deck', 'pec fly', 'aperturas de pecho', 'aperturas'], registry(TRAINING_V2)),
  concept('ex.shoulder_press', 'EXERCISE_CAPABILITY', 'SHOULDER_PRESS', ['press de hombro', 'press de hombros', 'shoulder press'], registry(TRAINING_V2)),
  concept('ex.leg_extension', 'EXERCISE_CAPABILITY', 'LEG_EXTENSION', ['extension de cuadriceps', 'extension de piernas', 'maquina de cuadriceps', 'silla de cuadriceps', 'leg extension'], registry(TRAINING_V2)),
  concept('ex.leg_curl', 'EXERCISE_CAPABILITY', 'LEG_CURL', ['curl femoral', 'maquina femoral', 'leg curl', 'curl de femoral'], registry(TRAINING_V2)),
  concept('ex.hip_thrust', 'EXERCISE_CAPABILITY', 'HIP_THRUST', ['hip thrust', 'empuje de cadera'], registry(TRAINING_V2)),
  concept('ex.adductor', 'EXERCISE_CAPABILITY', 'ADDUCTOR', ['aductor', 'aductores', 'maquina de aductores'], registry(TRAINING_V2)),
  concept('ex.abductor', 'EXERCISE_CAPABILITY', 'ABDUCTOR', ['abductor', 'abductores', 'maquina de abductores'], registry(TRAINING_V2)),
  concept('ex.hack_squat', 'EXERCISE_CAPABILITY', 'HACK_SQUAT', ['hack squat', 'sentadilla hack'], registry(TRAINING_V2)),
  concept('ex.leg_press', 'EXERCISE_CAPABILITY', 'LEG_PRESS', ['prensa', 'prensa de piernas', 'leg press'], registry(TRAINING_V2)),
  concept('ex.calf_raise', 'EXERCISE_CAPABILITY', 'CALF_RAISE', ['calf raise', 'elevacion de talones', 'elevacion de pantorrillas'], registry(TRAINING_V2)),
  concept('ex.rear_delt', 'EXERCISE_CAPABILITY', 'REAR_DELT_FLY', ['rear delt', 'deltoide posterior'], registry(TRAINING_V2)),
  concept('ex.biceps_curl', 'EXERCISE_CAPABILITY', 'BICEPS_CURL', ['curl de biceps', 'biceps curl'], registry(TRAINING_V2)),
  concept('ex.triceps_ext', 'EXERCISE_CAPABILITY', 'TRICEPS_EXTENSION', ['extension de triceps', 'triceps extension'], registry(TRAINING_V2)),
  concept('ex.pendulum', 'EXERCISE_CAPABILITY', 'PENDULUM_SQUAT', ['pendulum squat', 'sentadilla pendulo'], registry(TRAINING_V2)),
  concept('ex.belt_squat', 'EXERCISE_CAPABILITY', 'BELT_SQUAT', ['belt squat', 'sentadilla con cinturon'], registry(TRAINING_V2)),
  concept('ex.reverse_hyper', 'EXERCISE_CAPABILITY', 'REVERSE_HYPER', ['reverse hyper', 'hiperextension inversa'], registry(TRAINING_V2)),
  concept('ex.deadlift', 'EXERCISE_CAPABILITY', 'DEADLIFT', ['peso muerto', 'deadlift'], registry(TRAINING_V2)),
  concept('ex.pullover', 'EXERCISE_CAPABILITY', 'PULLOVER', ['pullover'], registry(TRAINING_V2)),
  concept('ex.crunch', 'EXERCISE_CAPABILITY', 'ABDOMINAL_CRUNCH', ['abdominales', 'crunch', 'crunch abdominal'], registry(TRAINING_V2),
    'Registry code with 0 assignments in both bundles (QA1 orphan concept).'),
];

const FUNCTION: ConceptLexiconEntry[] = [
  concept('fn.cable', 'TRAINING_FUNCTION', 'CABLE_RESISTANCE', ['resistencia de cable', 'resistencia por cable', 'entrenar con poleas'], registry(TRAINING_V2)),
  concept('fn.multi_dir', 'TRAINING_FUNCTION', 'MULTI_DIRECTIONAL_RESISTANCE', ['resistencia multidireccional'], registry(TRAINING_V2)),
  concept('fn.bodyweight', 'TRAINING_FUNCTION', 'BODYWEIGHT_SUPPORT', ['peso corporal', 'soporte de peso corporal'], registry(TRAINING_V2)),
  concept('fn.barbell_support', 'TRAINING_FUNCTION', 'BARBELL_SUPPORT', ['soporte de barra', 'apoyar la barra', 'sostener la barra'], registry(TRAINING_V2)),
  concept('fn.guided', 'TRAINING_FUNCTION', 'GUIDED_BARBELL_SUPPORT', ['barra guiada', 'guiada'], registry(TRAINING_V2)),
];

const ANATOMY: ConceptLexiconEntry[] = [
  concept('mg.chest', 'MUSCLE_GROUP', 'CHEST', ['pecho', 'pectoral', 'pectorales']),
  concept('mg.back', 'MUSCLE_GROUP', 'BACK', ['espalda', 'dorsal', 'dorsales']),
  concept('mg.shoulders', 'MUSCLE_GROUP', 'SHOULDERS', ['hombro', 'hombros', 'deltoides']),
  concept('mg.biceps', 'MUSCLE_GROUP', 'BICEPS', ['biceps']),
  concept('mg.triceps', 'MUSCLE_GROUP', 'TRICEPS', ['triceps']),
  concept('mg.quadriceps', 'MUSCLE_GROUP', 'QUADRICEPS', ['cuadriceps']),
  concept('mg.hamstrings', 'MUSCLE_GROUP', 'HAMSTRINGS', ['femorales', 'isquiotibiales', 'isquios']),
  concept('mg.glutes', 'MUSCLE_GROUP', 'GLUTES', ['gluteo', 'gluteos']),
  concept('mg.calves', 'MUSCLE_GROUP', 'CALVES', ['pantorrilla', 'pantorrillas', 'gemelos']),
  concept('mg.core', 'MUSCLE_GROUP', 'CORE', ['abdomen', 'core', 'zona media']),
  concept('br.upper', 'BODY_REGION', 'UPPER_BODY', ['tren superior']),
  concept('br.lower', 'BODY_REGION', 'LOWER_BODY', ['tren inferior', 'piernas']),
  concept('br.full', 'BODY_REGION', 'FULL_BODY', ['cuerpo completo', 'full body']),
];

const DISCIPLINE: ConceptLexiconEntry[] = [
  concept('dis.crossfit', 'DISCIPLINE', 'CROSSFIT', ['crossfit', 'cross fit']),
  concept('dis.hyrox', 'DISCIPLINE', 'HYROX', ['hyrox']),
  concept('dis.powerlifting', 'DISCIPLINE', 'POWERLIFTING', ['powerlifting', 'levantamiento de potencia']),
  concept('dis.calisthenics', 'DISCIPLINE', 'CALISTHENICS', ['calistenia']),
  concept('dis.cardio', 'DISCIPLINE', 'CARDIO_ENDURANCE', ['cardio', 'resistencia cardiovascular']),
  concept('dis.yoga', 'DISCIPLINE', 'YOGA_PILATES', ['yoga', 'pilates']),
  concept('dis.boxing', 'DISCIPLINE', 'BOXING_MMA', ['boxeo', 'mma', 'artes marciales']),
  concept('dis.rehab', 'DISCIPLINE', 'REHABILITATION', ['rehabilitacion', 'kinesiologia']),
];

const USE_CONTEXT: ConceptLexiconEntry[] = [
  concept('uc.home', 'USE_CONTEXT', 'HOME_GYM', ['casa', 'hogar', 'home gym', 'gimnasio en casa', 'gym en casa']),
  concept('uc.small', 'USE_CONTEXT', 'SMALL_SPACE', ['departamento', 'espacio reducido', 'poco espacio', 'compacto', 'compacta', 'espacio pequeno']),
  concept('uc.commercial', 'USE_CONTEXT', 'COMMERCIAL_GYM', ['gimnasio comercial', 'uso comercial', 'gym comercial']),
  concept('uc.studio', 'USE_CONTEXT', 'SEMI_COMMERCIAL_STUDIO', ['estudio', 'box de crossfit']),
  concept('uc.clinical', 'USE_CONTEXT', 'CLINICAL_RECOVERY', ['clinica', 'kinesiologo', 'centro de rehabilitacion']),
  concept('uc.outdoor', 'USE_CONTEXT', 'OUTDOOR_HIGH_TRAFFIC', ['exterior', 'aire libre', 'al aire libre']),
];

const INHERITED_SYNONYMS: SynonymLexiconEntry[] = DEFAULT_PRODUCT_SEARCH_SYNONYMS
  .filter((rule) => !(rule.phrases.length === 1 && rule.phrases[0] === 'barra'))
  .map((rule, index) => ({
    id: `syn.inherited.${index}`,
    type: 'LEXICAL_SYNONYM',
    terms: [...rule.phrases],
    replacements: [...rule.terms],
    provenance: { source: 'PRODUCT_INTENT_SYNONYMS', file: 'src/application/catalog/product-intent/synonyms.ts' },
    reviewStatus: 'INHERITED_PRODUCTION_TABLE',
  }));

function synonym(id: string, terms: string[], replacements: string[]): SynonymLexiconEntry {
  return { id, type: 'LEXICAL_SYNONYM', terms, replacements, provenance: T, reviewStatus: P };
}

const PROPOSED_SYNONYMS: SynonymLexiconEntry[] = [
  synonym('syn.pull_up', ['dominada', 'dominadas', 'barra de dominadas', 'barra para dominadas'], ['pull up']),
  synonym('syn.dip', ['fondos'], ['dip']),
  synonym('syn.lat', ['jalon', 'jalon al pecho'], ['pulldown', 'pull down']),
  synonym('syn.treadmill', ['cinta de correr'], ['trotadora']),
  synonym('syn.foam', ['rodillo de espuma'], ['foam roller']),
  synonym('syn.yoga_mat', ['colchoneta de yoga'], ['mat de yoga']),
  synonym('syn.squat', ['sentadilla', 'sentadillas'], ['squat']),
  synonym('syn.band', ['liga', 'ligas', 'elastico', 'elasticos'], ['banda']),
  synonym('syn.jump_rope', ['cuerda para saltar', 'cuerda de saltar'], ['cuerda de salto']),
];

function marker(id: string, type: MarkerLexiconEntry['type'], terms: string[], note: string, blocking?: MarkerLexiconEntry['blocking']): MarkerLexiconEntry {
  return { id, type, terms, note, provenance: T, reviewStatus: P, ...(blocking ? { blocking } : {}) };
}

const MARKERS: MarkerLexiconEntry[] = [
  marker('unm.squat', 'UNMODELED', ['sentadilla', 'sentadillas'], 'No generic squat code in Training V2 (only HACK/BELT/PENDULUM_SQUAT).'),
  marker('unm.row', 'UNMODELED', ['remo'], 'Ambiguous: ROW exercise vs cardio rower; not mapped.'),
  marker('unm.bench_press', 'UNMODELED', ['press de banca', 'press banca', 'press militar'], 'Free-weight press: no registry capability.'),
  marker('unm.weights', 'UNMODELED', ['pesa', 'pesas'], 'Ambiguous load equipment wording; not mapped to a family.'),
  marker('unm.cardio_goal', 'UNMODELED', ['bajar de peso', 'adelgazar', 'quemar grasa'], 'Goal outside the ontology.', 'UNMODELED_NEED'),
  marker('unm.quality', 'UNMODELED', ['mejor', 'el mejor', 'lo mejor', 'recomendado', 'buena calidad'], 'Subjective preference without a governed signal.', 'UNMODELED_NEED'),
  marker('unm.similar', 'UNMODELED', ['parecido', 'parecida', 'similar', 'alternativa', 'reemplazo'], 'Substitution relation UNAVAILABLE.', 'SUBSTITUTION'),
  marker('unm.variant', 'UNMODELED', ['talla', 'tallas'], 'Variant attributes are not in the frozen extraction.', 'VARIANT_ATTRIBUTE'),
  marker('compat', 'COMPATIBILITY', ['compatible', 'compatibles', 'compatibilidad', 'que calce', 'que encaje', 'sirva para mi', 'sirve para mi', 'que sirva con'], 'Relationship projection UNAVAILABLE.'),
  marker('soft', 'SOFT_MARKER', ['idealmente', 'preferiblemente', 'ojala', 'si es posible', 'de preferencia'], 'Following concepts become soft preferences.'),
  marker('low_price', 'COMMERCIAL_LOW_PRICE', ['barato', 'barata', 'baratos', 'baratas', 'economico', 'economica', 'mas barato', 'mas barata'], 'Requires Commercial Truth.'),
  marker('availability', 'COMMERCIAL_AVAILABILITY', ['en stock', 'con stock', 'disponible', 'disponibles', 'entrega inmediata'], 'Requires Commercial Truth.'),
  marker('filler', 'FILLER', ['algo', 'quiero', 'busco', 'necesito', 'para', 'entrenar', 'hacer', 'equipo', 'equipamiento', 'producto', 'productos',
    'un', 'una', 'unos', 'unas', 'de', 'del', 'la', 'el', 'los', 'las', 'que', 'con', 'mi', 'me', 'tengo', 'en', 'y', 'o', 'por', 'al', 'tipo', 'se', 'puedan',
    'pueda', 'sirva', 'sirvan', 'ejercicios', 'ejercicio', 'trabajar', 'tienen', 'hay', 'cual', 'cuales', 'implemento', 'implementos', 'maquina', 'maquinas', 'accesorio', 'accesorios'],
  'Need/linking words with no retrieval value.'),
];

export const DISCOVER_V0_LEXICON: readonly LexiconEntry[] = Object.freeze([
  ...FAMILY.map((entry) => ({ ...entry, familyLevelTerms: FAMILY_LEVEL_TERMS[entry.code] ?? [] })), ...EXERCISE, ...FUNCTION, ...ANATOMY, ...DISCIPLINE, ...USE_CONTEXT, ...INHERITED_SYNONYMS, ...PROPOSED_SYNONYMS, ...MARKERS,
]);

/** Families whose own weight is a meaningful product-level spec ("pesa rusa de 20 kg" → weight_kg). */
export const LOAD_FAMILIES_FOR_WEIGHT_SPEC: ReadonlySet<string> = new Set(['KETTLEBELL', 'DUMBBELL', 'WEIGHT_PLATE', 'BARBELL', 'BALL_BAG']);
