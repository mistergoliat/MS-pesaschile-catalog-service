// P2.3-QA2 preliminary proposals written by the AI agent. Pure data; no I/O on import.
// These are NOT gold labels and NOT human adjudications. Basis: frozen-source name/categories/features and
// registry definition text only; no external evidence was consulted. Metrics code refuses to consume them.
export const PROPOSAL_META = {
  reviewerType: 'AI_AGENT_PRELIMINARY', reviewerId: 'claude-opus-5-5/qa2-agent', humanReviewEffective: false, adjudicationStatus: 'NOT_ADJUDICATED',
  basis: 'Frozen source (name, categories, features) + registry definitions. No commercial description, no external source, no physical inspection.',
  use: 'Prioritise and pre-fill human review; never counted as reference labels.',
};
// outcome = proposed QA2 outcome for the system claim; confidence = agent confidence in the proposal.
const P = (ids, claim, system, proposed, outcome, errorType, confidence, rationale, contractBasis = null) => ids.map(productId => ({ productId, claim, system, proposed, outcome, errorType, confidence, rationale, contractBasis }));

const CABLE_DEF = 'Registry v3: CABLE_MACHINE = "Cable/pulley stations"; MACHINE_ATTACHMENT = "Cable/rack/bench add-ons (… ankle straps …)"; ROPE_SLED negative: "cable-machine rope attachments sold as machine accessories"; CABLE_MACHINE negative evidence includes category 451 "Accesorios de Polea".';

export const PROPOSALS = [
  // 1. Cable boundary: passive pulley accessories classified as stations.
  ...P([437, 454, 455, 462, 466, 1004, 1020, 1022, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1917, 1996, 2195, 2285], 'FAMILY_PRIMARY', 'CABLE_MACHINE', 'MACHINE_ATTACHMENT',
    'INCORRECT', 'FAMILY_BOUNDARY_PASSIVE_ACCESSORY_AS_STATION', 'HIGH', 'Agarre/soga/barra/asiento/tobillera vendido como accesorio de polea; no es una estación de poleas. Rule PF_CABLE_MACHINE_NAME_V1 matches "polea" before MACHINE_ATTACHMENT.', CABLE_DEF),
  ...P([437, 454, 455, 462, 466, 1004, 1020, 1022, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1917, 1996, 2195, 2285], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY',
    'CORRECT', null, 'MEDIUM', 'Un accesorio pasivo no entrega resistencia por cable por sí mismo; atribuirle CABLE_RESISTANCE sería función del host. La negativa es coherente; el conflicto está en la familia, no en Training.'),
  ...P([247, 1624], 'FAMILY_PRIMARY', 'CABLE_MACHINE', 'CABLE_MACHINE', 'CORRECT', null, 'MEDIUM', 'Módulo "Polea Alta Remo" para jaula: mecanismo de polea propio por nombre; depende de un host (relación no modelada).'),
  ...P([247, 1624], 'TRAINING_ABSTENTION', 'DATA_GAP', 'DATA_GAP', 'CORRECT', null, 'MEDIUM', 'Sin feature 65 ni evidencia estructurada del mecanismo; abstenerse es razonable hasta tener ficha.'),
  ...P([897], 'FAMILY_PRIMARY', 'CABLE_MACHINE', null, 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', '"Accesorio polea con asiento": puede ser módulo de remo con mecanismo o asiento pasivo; requiere ficha técnica.'),
  ...P([1124], 'FAMILY_PRIMARY', 'PLATE_LOADED_MACHINE', 'CABLE_MACHINE', 'INCORRECT', 'SMITH_WORDING_OVERRIDE_ON_CABLE_MODULE', 'MEDIUM', 'Módulo Lat Pull Down con relación de polea 2:1 (feature 65) para Smith; la palabra "Smith" fuerza PLATE_LOADED_MACHINE aunque el producto vendido es el módulo de cable.',
    'Registry v3 PLATE_LOADED_MACHINE covers "Smith-machine variants"; the product is an add-on module, not the Smith machine.'),
  ...P([1124, 1813, 2008], 'TRAINING_EXERCISE_SET', 'no exercise', 'LAT_PULLDOWN (and ROW for Polea Alta/Remo)', 'INCOMPLETE', 'MODULE_EXERCISE_NOT_ASSIGNED', 'LOW', 'Estaciones equivalentes (P1887, P2142) reciben LAT_PULLDOWN/ROW; los módulos con el mismo mecanismo sólo reciben CABLE_RESISTANCE. Puede ser política deliberada (SUPPORTED exige evidencia de configuración).'),
  ...P([1811, 1813, 1999, 2006, 2008], 'FAMILY_PRIMARY', 'CABLE_MACHINE', 'CABLE_MACHINE', 'CORRECT', null, 'MEDIUM', 'Módulo con mecanismo de polea propio (feature 65 presente); dependencia del rack host no modelada (riesgo de recomendarlo como autónomo).'),
  ...P([463, 1137, 1138, 1139, 1140], 'FAMILY_PRIMARY', 'MACHINE_ATTACHMENT', 'MACHINE_ATTACHMENT', 'CORRECT', null, 'HIGH', 'Ankle straps figuran literalmente en la definición de MACHINE_ATTACHMENT. Contrasta con agarres/sogas de la misma categoría 451 clasificados CABLE_MACHINE.', CABLE_DEF),

  // 2. CLASSIFIED but not Product-Discovery admitted (weak category evidence).
  ...P([1807, 1997], 'FAMILY_PRIMARY', 'MACHINE_ATTACHMENT', 'MACHINE_ATTACHMENT', 'CORRECT', null, 'HIGH', 'J-Cups aparecen literalmente en la definición; la abstención proviene de evidencia sólo por categoría SEMANTIC_WEAK (292).'),
  ...P([1817, 1995, 2001, 2016], 'FAMILY_PRIMARY', 'MACHINE_ATTACHMENT', 'MACHINE_ATTACHMENT', 'CORRECT', null, 'MEDIUM', 'Add-on de rack ("Accesorio Delta/Alpha"); familia plausible, evidencia débil → abstención de Discovery, no falso positivo.'),

  // 3. Training negatives without negative evidence (ABSENT).
  ...P([430, 679, 1123, 1158, 1159, 1160, 1161, 1236, 1237, 1238, 1239, 1240, 1288, 1289, 1486, 1487, 1621, 1708, 1881, 1918, 2051, 2053, 2055, 2056, 2057, 2187, 2194, 2290, 2296, 2297, 2304],
    'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', 'UNMODELED_CONCEPT_CARDIO', 'MEDIUM', 'Ninguno de los 24 ejercicios / 5 funciones V2 describe cardio; la negativa es cierta respecto del registry pero no significa "sin valor de entrenamiento".'),
  ...P([1509, 2295], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', null, 'INSUFFICIENT_REFERENCE_EVIDENCE', 'DEFINITION_AMBIGUITY_ROW', 'LOW', 'Remo de aire: ROW se define como "rowing station or machine"; no está claro si el registry pretende incluir ergómetros.'),
  ...P([53, 54, 2261], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'PULL_UP/DIP + BODYWEIGHT_SUPPORT', 'INCORRECT', 'PROBABLE_FALSE_NEGATIVE', 'MEDIUM', 'Anillas de gimnasia son implemento canónico de dominadas/fondos en anillas; la familia BODYWEIGHT_GYMNASTICS lo reconoce.'),
  ...P([81, 821, 1263, 1330, 2128], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', null, 'HIGH', 'Collarines: sin capacidad de entrenamiento propia.'),
  ...P([463, 1137, 1138, 1139, 1140], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', null, 'MEDIUM', 'Tobillera de polea: la resistencia la aporta el host; no debe heredar CABLE_RESISTANCE.'),
  ...P([87], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', 'UNMODELED_CONCEPT_CONDITIONING', 'MEDIUM', 'Cuerda de salto: concepto no modelado.'),
  ...P([797], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', null, 'MEDIUM', 'Barra: el registry no deriva ejercicios de barras.'),
  ...P([1354], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', null, 'HIGH', 'Deadlift jack es herramienta de carga de discos, no implemento de entrenamiento.'),
  ...P([2111], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'NO_MODELED_CAPABILITY', 'CORRECT', 'UNMODELED_CONCEPT_LANDMINE', 'MEDIUM', 'Landmine habilita ejercicios no modelados en V2.'),

  // 4. OTHER active products: family decision.
  ...P([80, 1387, 1388, 803, 804, 1033, 1325, 1431, 223], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', null, 'HIGH', 'Magnesio, shakers, ventilador, máscara: ninguna familia del registry aplica.'),
  ...P([82, 85, 900, 157, 1826, 1827, 2127, 166, 167, 504, 2124], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', 'UNMODELED_CONCEPT_AGILITY_PLYOMETRIC', 'MEDIUM', 'Cajones, escaleras, conos, vallas, steps: rol no modelado (hipótesis QA1 AGILITY_PLYOMETRIC_ROLE).'),
  ...P([351, 353, 354, 358, 360, 361, 1184, 1185, 1290, 1291, 1859, 1860], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', 'UNMODELED_CONCEPT_WEARABLE_LOAD', 'MEDIUM', 'Tobilleras lastradas y chalecos: rol no modelado (hipótesis QA1 WEARABLE_LOAD_ROLE).'),
  ...P([420, 1190], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', 'UNMODELED_CONCEPT_TIMING', 'HIGH', 'Temporizadores: no hay familia aplicable.'),
  ...P([1178, 1192, 869, 808, 1355, 457], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', null, 'MEDIUM', 'Elevadores de talón, balance pad, arm blaster, farmer handles, tabla de escalada: sin familia aplicable en v3.'),
  ...P([1863], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', null, 'MEDIUM', 'Rueda abdominal: sin familia aplicable.'),
  ...P([427, 878, 879], 'FAMILY_PRIMARY', 'OTHER', 'BAND_SUSPENSION', 'INCORRECT', 'MISSED_EXISTING_FAMILY', 'HIGH', 'Glute bands son bandas de resistencia; BAND_SUSPENSION = "Resistance bands, tubes…".'),
  ...P([797], 'FAMILY_PRIMARY', 'OTHER', 'BARBELL', 'INCORRECT', 'MISSED_EXISTING_FAMILY', 'HIGH', 'Safety Squat Bar es una barra especial; BARBELL = "Straight, Olympic, or specialty training bars".'),
  ...P([388], 'FAMILY_PRIMARY', 'OTHER', 'BODYWEIGHT_GYMNASTICS', 'INCORRECT', 'MISSED_EXISTING_FAMILY', 'MEDIUM', 'Push-up bars ≈ parallettes (definición BODYWEIGHT_GYMNASTICS); categorías "Barras Pull Up & Push Up", "Barras Paralelas".'),
  ...P([1193], 'FAMILY_PRIMARY', 'OTHER', 'BODYWEIGHT_GYMNASTICS', 'INCORRECT', 'MISSED_EXISTING_FAMILY', 'MEDIUM', 'Salmon ladder es un aparato de dominadas.'),
  ...P([1619, 1620, 1622, 1623], 'FAMILY_PRIMARY', 'OTHER', 'SELECTORIZED_MACHINE/PLATE_LOADED_MACHINE (+bundle)', 'INCORRECT', 'BUNDLE_POLICY_INCONSISTENT', 'MEDIUM', 'Packs de máquinas con facts Training propios quedan OTHER, mientras P1974/P2316/P2317/P2326 reciben familia primaria + secundaria.'),
  ...P([1122], 'FAMILY_PRIMARY', 'OTHER', 'SELECTORIZED_MACHINE or CABLE_MACHINE', 'INCORRECT', 'MISSED_EXISTING_FAMILY', 'MEDIUM', 'Multiestación de poder es una máquina; el tipo exacto requiere ficha técnica.'),
  ...P([2113], 'FAMILY_PRIMARY', 'OTHER', 'FLOORING', 'INCORRECT', 'RULE_VOCABULARY_GAP', 'LOW', '"Mat de entrenamiento" 120x60 cm ≈ colchoneta de entrenamiento; la regla sólo reconoce "colchoneta"/"piso"/"tatami".'),
  ...P([464], 'FAMILY_PRIMARY', 'OTHER', 'MACHINE_ATTACHMENT', 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', 'Si "tenazas" son seguros de barra serían collarines (MACHINE_ATTACHMENT); confirmar producto.'),
  ...P([91], 'FAMILY_PRIMARY', 'OTHER', 'BALL_BAG?', 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', 'Disco de equilibrio en categoría "Bosu"; BALL_BAG incluye bosu pero no discos de equilibrio explícitamente.'),
  ...P([151, 1127], 'FAMILY_PRIMARY', 'OTHER', 'OTHER', 'CORRECT', null, 'LOW', 'AbMat: soporte abdominal sin familia aplicable.'),
  ...P([151, 1127, 1863], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'ABDOMINAL_CRUNCH?', 'INSUFFICIENT_REFERENCE_EVIDENCE', 'POSSIBLE_FALSE_NEGATIVE', 'LOW', 'ABDOMINAL_CRUNCH admite "autonomous abdominal implement"; la definición no aclara si AbMat/rueda abdominal califican. ABDOMINAL_CRUNCH no tiene assignments (huérfano QA1).'),
  ...P([1832], 'TRAINING_NEGATIVE', 'NO_MODELED_CAPABILITY', 'BICEPS_CURL/SUPPORTED?', 'INSUFFICIENT_REFERENCE_EVIDENCE', 'POSSIBLE_FALSE_NEGATIVE', 'LOW', 'Preacher pad: accesorio que configura curl de bíceps; depende del host.'),
  ...P([1832, 2125, 772], 'FAMILY_PRIMARY', 'OTHER', 'MACHINE_ATTACHMENT?', 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', 'Accesorio montado sobre barra/banco/barra de dominadas; la definición de MACHINE_ATTACHMENT podría cubrirlo.'),
  ...P([1191, 1331, 1332, 1333, 1335], 'FAMILY_PRIMARY', 'OTHER', 'BODYWEIGHT_GYMNASTICS?', 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', 'Agarres OCR colgantes: implementos de suspensión; definición no los menciona.'),
  ...P([1331, 1332, 1335], 'TRAINING_FACT', 'PULL_UP/DIRECT', 'PULL_UP/SUPPORTED?', 'INSUFFICIENT_REFERENCE_EVIDENCE', 'POSSIBLE_HOST_ATTRIBUTION', 'LOW', 'Agarre colgante requiere barra host; P1333 (T-Bar OCR, casi idéntico) tiene negativa → inconsistencia interna MEASURED.'),
  ...P([388], 'TRAINING_FACT', 'DIP/DIRECT', null, 'INSUFFICIENT_REFERENCE_EVIDENCE', 'POSSIBLE_FALSE_FACT', 'LOW', 'Push-up bars bajos: DIP dudoso salvo altura suficiente; requiere ficha.'),
  ...P([1830, 1831, 2090], 'FAMILY_PRIMARY', 'OTHER', 'KETTLEBELL?', 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', 'Martillo/maza en categoría Kettlebells; KETTLEBELL incluye clubbells.'),
  ...P([801, 1518, 1823, 1354], 'FAMILY_PRIMARY', 'OTHER', null, 'INSUFFICIENT_REFERENCE_EVIDENCE', null, 'LOW', 'Rol comercial no determinable sólo con nombre/categorías.'),
  ...P([425, 1935, 1936, 1937, 1938, 1945, 1946, 1947, 1948, 2319], 'FAMILY_PRIMARY', 'OTHER', 'bundle primary + secondary?', 'INSUFFICIENT_REFERENCE_EVIDENCE', 'BUNDLE_POLICY_UNDEFINED', 'LOW', 'Packs heterogéneos: no existe política de familia primaria para bundles (BUNDLE_COMPONENT_RELATION candidata).'),

  // 5. Training DATA_GAP / AMBIGUOUS active abstentions.
  ...P([1945, 1946, 1947, 1948, 435], 'TRAINING_ABSTENTION', 'AMBIGUOUS', 'AMBIGUOUS', 'CORRECT', null, 'MEDIUM', 'Packs con configuración no adjudicada: abstenerse es correcto.'),
  ...P([930, 1122, 1823, 2025, 2319], 'TRAINING_ABSTENTION', 'DATA_GAP', 'DATA_GAP', 'CORRECT', null, 'MEDIUM', 'Evidencia de mecanismo/configuración insuficiente en la fuente congelada.'),
];
