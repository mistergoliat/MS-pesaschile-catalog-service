// Classifier-owned mapping from trusted PrestaShop category *names* to ontology tag codes
// (Section 2: "HOW approved evidence rules are evaluated" is the classifier's job; the registry
// only says WHAT evidence sources and trust classes are allowed per tag/axis — see
// `commercial-product-ontology`'s `categoryTrustGate` and each tag's `allowedEvidenceSources`).
//
// Every mapping below only applies to a tag that actually declares `TRUSTED_CATEGORY` among its
// `allowedEvidenceSources` — callers must also check that. Category *names* (not ids) are the
// mapping key: ids are dataset-specific database identifiers, names are the stable semantic anchor
// documented in the A00.1B/A00.1C review this registry was built from.
//
// A category name deliberately absent from a table below is not classification evidence, even if
// its trust class would technically qualify — e.g. "Accesorios de Weightlifting" is SEMANTIC_STRONG
// but is explicitly excluded from MACHINE_ATTACHMENT (A00.1C: it wrongly voted this family for
// chalk in an earlier draft). Do not add it.

import { normalizeEvidenceValue } from './normalize.js';

function names(...values: readonly string[]): readonly string[] {
  return values.map((value) => normalizeEvidenceValue(value));
}

/** PRODUCT_FAMILY: trusted-category evidence, only for tags that allow TRUSTED_CATEGORY. */
export const PRODUCT_FAMILY_CATEGORY_NAMES: Readonly<Record<string, readonly string[]>> = {
  WEIGHT_PLATE: names('Discos', 'Discos Bumper', 'Discos de Competición', 'Discos Fraccionados', 'Discos Con Agarre', 'Discos de Acero', 'Discos de Powerlifting', 'Discos Preolímpicos', 'Bumper Plates'),
  DUMBBELL: names('Mancuernas', 'Mancuernas Hexagonales', 'Mancuernas Pu', 'Mancuernas de Acero', 'Mancuernas de Neopreno', 'Mancuernas Ajustables', 'Set de Mancuernas'),
  PLATE_LOADED_MACHINE: names('Máquinas con Carga de Discos'),
  SELECTORIZED_MACHINE: names('Máquinas Selectorizadas'),
  STORAGE: names('ALMACENAMIENTO', 'Racks para Balones', 'Racks para Barras', 'Racks para Discos', 'Racks para Kettlebells', 'Racks para Mancuernas'),
  // Deliberately excludes the broad "Accesorios de Protección" WEAK parent category: A00.1C found
  // this level of the trust map wrongly votes families for unrelated products (e.g. chalk) — only
  // the specific STRONG-trust children below are trustworthy PROTECTIVE_GEAR evidence.
  PROTECTIVE_GEAR: names('Calleras', 'Cinturones de Levantamiento', 'Muñequeras', 'Rodilleras', 'Correas de Levantamiento', 'Guantes', 'Vendaje', 'Boxeo & MMA'),
  MACHINE_ATTACHMENT: names('Accesorios para Máquinas', 'Accesorios para Racks', 'Accesorios para Bancos', 'Accesorios de Polea'),
  YOGA_PILATES: names('Yoga & Pilates', 'Balones de Pilates'),
};

/** DISCIPLINE: trusted-category evidence (SEMANTIC_STRONG only, enforced by the caller's trust gate). */
export const DISCIPLINE_CATEGORY_NAMES: Readonly<Record<string, readonly string[]>> = {
  HYROX: names('HYROX'),
  POWERLIFTING: names('Powerlifting', 'Barras Powerlifting', 'Discos de Powerlifting', 'Powerlifting Racks'),
  CALISTHENICS: names('Calistenia'),
  YOGA_PILATES: names('Yoga & Pilates'),
  BOXING_MMA: names('Boxeo & MMA'),
};

/** REHABILITATION's category path is compound (family=RECOVERY_TOOL + one of these categories) — see discipline-rules.ts. */
export const REHABILITATION_CLINICAL_DEVICE_CATEGORY_NAMES: readonly string[] = names('Cámaras Hiperbáricas', 'Presoterapia');

/** USE_CONTEXT: trusted-category evidence (SEMANTIC_STRONG only). */
export const HOME_GYM_CATEGORY_NAMES: readonly string[] = names('Máquinas Home Gym');
export const CLINICAL_RECOVERY_CATEGORY_NAMES: readonly string[] = names('Cámaras Hiperbáricas', 'Presoterapia');

export function matchesCategoryName(candidateNormalizedName: string, table: readonly string[]): boolean {
  return table.includes(candidateNormalizedName);
}
