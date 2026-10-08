import { writeFile } from 'node:fs/promises';
import { DISCOVER_V0_LEXICON } from '../../../src/application/catalog/discover-v0/lexicon.js';

/*
 * CAT-DISCOVER-G1 — registry-code picklist for human reviewers (stage A), so mandatory
 * constraints are written in a form the harness can compare. Contains codes only:
 * no system output, score or ranking. Create-only.
 *
 *   npx tsx scripts/catalog-v2/discover-g1/write-constraint-picklist.ts --out=<file.json>
 */

async function main(): Promise<void> {
  const out = /^--out=(.+)$/u.exec(process.argv[2] ?? '')?.[1];
  if (!out) throw new Error('INVALID_ARGUMENT: --out is required');
  const byAxis: Record<string, Set<string>> = {};
  for (const entry of DISCOVER_V0_LEXICON) {
    const pairs = entry.type === 'CONCEPT' ? [[entry.axis, entry.code]] : entry.type === 'AMBIGUOUS' ? entry.readings.map((reading) => [reading.axis, reading.code]) : [];
    for (const [axis, code] of pairs) (byAxis[axis!] ??= new Set()).add(code!);
  }
  const picklist = {
    picklistVersion: 'discover-g1-constraint-picklist-v1',
    purpose: 'Códigos de registro (Product Ontology v3 / Training Semantics V2) para que R1/R2 expresen restricciones obligatorias de forma comparable. No contiene salidas, scores ni rankings del sistema. Si ningún código expresa la restricción, usar kind=OTHER con texto libre.',
    kindToAxis: { PRODUCT_TYPE: 'PRODUCT_FAMILY', EXERCISE: 'EXERCISE_CAPABILITY', TRAINING_FUNCTION: 'TRAINING_FUNCTION', ANATOMY: 'MUSCLE_GROUP | BODY_REGION', DISCIPLINE: 'DISCIPLINE', USE_CONTEXT: 'USE_CONTEXT' },
    codes: Object.fromEntries(Object.entries(byAxis).sort(([left], [right]) => left.localeCompare(right)).map(([axis, codes]) => [axis, [...codes].sort()])),
    specKeys: ['weight_kg', 'max_load_kg', 'max_user_weight_kg', 'assembled_length_cm', 'assembled_width_cm', 'assembled_height_cm'],
    operators: ['EQ', 'GTE', 'LTE'],
    quantityScopes: ['PER_UNIT', 'PER_PAIR', 'PACK_TOTAL', 'PRODUCT_TOTAL', 'PRODUCT_TOTAL_INCLUDING_USER', 'EXTERNAL_LOAD_EXCLUDING_USER', 'USER_CAPACITY', 'UNSURE'],
    commercial: ['COMMERCIAL_MAX_PRICE (CLP)', 'COMMERCIAL_AVAILABILITY'],
    other: ['COMPATIBILITY', 'OTHER'],
  };
  await writeFile(out, `${JSON.stringify(picklist, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(picklist.codes).map(([axis, codes]) => [axis, codes.length]))));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
