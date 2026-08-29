import { describe, expect, it } from 'vitest';
import {
  classifyProduct,
  type ProductSemanticClassificationInput,
  type ProductSemanticClassificationInputCategory,
  type ProductSemanticClassificationInputFeature,
} from '../../src/domain/product-semantic-classification/index.js';

let nextId = 1;
function input(
  productName: string,
  overrides: Partial<Omit<ProductSemanticClassificationInput, 'productName'>> = {},
): ProductSemanticClassificationInput {
  nextId += 1;
  return {
    productId: String(nextId),
    productName,
    catalogPresence: 'current_catalog',
    activeStatus: true,
    categories: [],
    features: [],
    ...overrides,
  };
}

function category(categoryId: string, name: string, trustClass: ProductSemanticClassificationInputCategory['trustClass']): ProductSemanticClassificationInputCategory {
  return { categoryId, name, trustClass };
}

function feature(
  featureId: string,
  featureName: string,
  value: string,
  trustClass: ProductSemanticClassificationInputFeature['trustClass'],
): ProductSemanticClassificationInputFeature {
  return { featureId, featureName, value, trustClass };
}

describe('PRODUCT_FAMILY - one rule per tag', () => {
  it('BARBELL: name literal "Barra Olimpica"', () => {
    const result = classifyProduct(input('Barra Olimpica 20kg Training | HWM'));
    expect(result.primaryProductFamily).toMatchObject({ code: 'BARBELL', confidence: 'EXPLICIT', ruleId: 'PF_BARBELL_NAME_V1' });
    expect(result.classificationStatus).toBe('CLASSIFIED');
  });

  it('WEIGHT_PLATE: name literal "disco"/"bumper"', () => {
    expect(classifyProduct(input('Par Bumper Plates Eco 10kg')).primaryProductFamily?.code).toBe('WEIGHT_PLATE');
  });

  it('WEIGHT_PLATE: trusted-category fallback (STRONGLY_INFERRED) when name gives no hint', () => {
    const result = classifyProduct(input('Set 20kg Maletin Cast Iron', { categories: [category('267', 'Mancuernas', 'SEMANTIC_STRONG')] }));
    const plateResult = classifyProduct(input('Disco Especial Serie X', { categories: [] }));
    expect(plateResult.primaryProductFamily?.code).toBe('WEIGHT_PLATE');
    expect(result.primaryProductFamily?.code).toBe('DUMBBELL');
  });

  it('DUMBBELL: category fallback is STRONGLY_INFERRED when the name has no "mancuerna" wording', () => {
    const result = classifyProduct(input('Set 20kg Maletin Cast Iron', { categories: [category('273', 'Set de Mancuernas', 'SEMANTIC_STRONG')] }));
    expect(result.primaryProductFamily).toMatchObject({ code: 'DUMBBELL', confidence: 'STRONGLY_INFERRED', ruleId: 'PF_DUMBBELL_CATEGORY_V1' });
  });

  it('KETTLEBELL: name literal', () => {
    expect(classifyProduct(input('Kettlebell Acero 20kg | HWM')).primaryProductFamily?.code).toBe('KETTLEBELL');
  });

  it('BENCH: name literal "banco"', () => {
    expect(classifyProduct(input('Banco Regulable 3.0')).primaryProductFamily?.code).toBe('BENCH');
  });

  it('BENCH: "cajon hip thrust" (padded hip-thrust box)', () => {
    expect(classifyProduct(input('Cajon Hip Thrust Acolchado | FullFit')).primaryProductFamily?.code).toBe('BENCH');
  });

  it('RACK_CAGE: name literal "power rack"/"squat rack"', () => {
    expect(classifyProduct(input('Squat Rack | KONG')).primaryProductFamily?.code).toBe('RACK_CAGE');
  });

  it('CABLE_MACHINE: name literal "polea"/"crossover"', () => {
    expect(classifyProduct(input('Crossover Lat Pulldown ZR Series | PROmachine')).primaryProductFamily?.code).toBe('CABLE_MACHINE');
  });

  it('PLATE_LOADED_MACHINE: name literal "prensa"', () => {
    expect(classifyProduct(input('Prensa Inclinada 45 Lineal MO 2.0 | Obelix')).primaryProductFamily?.code).toBe('PLATE_LOADED_MACHINE');
  });

  it('SELECTORIZED_MACHINE: name literal "dual cuadriceps/femoral"', () => {
    expect(classifyProduct(input('Dual Cuadriceps / Femoral Sentado MO 2.0 | Obelix')).primaryProductFamily?.code).toBe('SELECTORIZED_MACHINE');
  });

  it('SELECTORIZED_MACHINE still resolves "extension de cuadriceps" via category fallback when no stack guard is present', () => {
    const result = classifyProduct(input('Extension de Cuadriceps MO 2.0 Obelix', { categories: [category('281', 'Maquinas Selectorizadas', 'SEMANTIC_STRONG')] }));
    expect(result.primaryProductFamily).toMatchObject({ code: 'SELECTORIZED_MACHINE', confidence: 'STRONGLY_INFERRED', ruleId: 'PF_SELECTORIZED_MACHINE_CATEGORY_V1' });
  });

  it('CARDIO_MACHINE: name literal "trotadora"', () => {
    expect(classifyProduct(input('Trotadora Comercial S1 Series LED | Obelix')).primaryProductFamily?.code).toBe('CARDIO_MACHINE');
  });

  it('FLOORING: name literal "palmeta"/"piso"', () => {
    expect(classifyProduct(input('Palmeta de Caucho 100x100cm 15mm (Unidad)')).primaryProductFamily?.code).toBe('FLOORING');
  });

  it('STORAGE: name literal "almacenamiento", checked before the generic DUMBBELL noun', () => {
    const result = classifyProduct(input('Rack de Almacenamiento Mancuernas 3 Niveles | HWM'));
    expect(result.primaryProductFamily).toMatchObject({ code: 'STORAGE', ruleId: 'PF_STORAGE_NAME_V1' });
  });

  it('BALL_BAG: name literal "sand bag"/"bosu"', () => {
    expect(classifyProduct(input('Sand Bag Training 25kg - 2da Seleccion | HWM')).primaryProductFamily?.code).toBe('BALL_BAG');
    expect(classifyProduct(input('Bosu Ball 1.0 | Mindfullness')).primaryProductFamily?.code).toBe('BALL_BAG');
  });

  it('ROPE_SLED: name literal "soga"/"trineo"', () => {
    expect(classifyProduct(input('Soga de Trepa 7mt | HWM')).primaryProductFamily?.code).toBe('ROPE_SLED');
    expect(classifyProduct(input('Trineo Multifuncional 3.0 Power Sled | HWM')).primaryProductFamily?.code).toBe('ROPE_SLED');
  });

  it('BAND_SUSPENSION: name literal "banda"/"x-mount"', () => {
    expect(classifyProduct(input('Banda de Resistencia Light 22mm 50Lbs Negro | HWM')).primaryProductFamily?.code).toBe('BAND_SUSPENSION');
    expect(classifyProduct(input('X-Mount Anclaje Banda de Suspension | FullFit')).primaryProductFamily?.code).toBe('BAND_SUSPENSION');
  });

  it('BODYWEIGHT_GYMNASTICS: name literal "anillas"/"dominadas"', () => {
    expect(classifyProduct(input('Par Anillas Olimpicas de Gimnasia Madera | HWM')).primaryProductFamily?.code).toBe('BODYWEIGHT_GYMNASTICS');
  });

  it('PROTECTIVE_GEAR: name literal "cinturon"/"guante"', () => {
    expect(classifyProduct(input('Cinturon de Levantamiento Heavy Duty | HWM')).primaryProductFamily?.code).toBe('PROTECTIVE_GEAR');
    expect(classifyProduct(input('Par Guantes de Boxeo | Rising')).primaryProductFamily?.code).toBe('PROTECTIVE_GEAR');
  });

  it('MACHINE_ATTACHMENT: category fallback (Accesorios para Racks)', () => {
    const result = classifyProduct(input('Almohadilla Bulgara Accesorio Alpha | HWM', { categories: [category('300', 'Accesorios para Racks', 'SEMANTIC_STRONG')] }));
    expect(result.primaryProductFamily).toMatchObject({ code: 'MACHINE_ATTACHMENT', confidence: 'STRONGLY_INFERRED', ruleId: 'PF_MACHINE_ATTACHMENT_CATEGORY_V1' });
  });

  it('RECOVERY_TOOL: name literal "camara hiperbarica"', () => {
    expect(classifyProduct(input('Camara Hiperbarica ST801 1.5ATA | O2Life')).primaryProductFamily?.code).toBe('RECOVERY_TOOL');
  });

  it('YOGA_PILATES: name literal "yoga"/"pilates"', () => {
    expect(classifyProduct(input('Mat de Yoga TPE C/Colgador 173x61cm 8mm | Rising')).primaryProductFamily?.code).toBe('YOGA_PILATES');
    expect(classifyProduct(input('Balon Pilates 65cm')).primaryProductFamily?.code).toBe('YOGA_PILATES');
  });

  it('APPAREL: name literal "crop top"', () => {
    expect(classifyProduct(input('CROP TOP CROSSFIT HATERS ROSADO | KILO')).primaryProductFamily?.code).toBe('APPAREL');
  });

  it('OTHER: no rule matches - insufficient-evidence provenance, not a positive family', () => {
    const result = classifyProduct(input('AbMat 1.0 | HWM'));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });
});

describe('PRODUCT_FAMILY - boundary precedence (Section 6)', () => {
  it('STORAGE before generic equipment nouns', () => {
    expect(classifyProduct(input('Rack de Almacenamiento Mancuernas 3 Niveles | HWM')).primaryProductFamily?.code).toBe('STORAGE');
    expect(classifyProduct(input('Rack Organizador de Balones Accesorio Alpha | HWM')).primaryProductFamily?.code).toBe('STORAGE');
  });

  it('BODYWEIGHT_GYMNASTICS before the generic BARBELL pattern', () => {
    expect(classifyProduct(input('Barra Dominadas Pull Up/Chin Up HWM')).primaryProductFamily?.code).toBe('BODYWEIGHT_GYMNASTICS');
    expect(classifyProduct(input('Barra Pull Ups Multigrip 2.0 | HWM')).primaryProductFamily?.code).toBe('BODYWEIGHT_GYMNASTICS');
  });

  it('Smith-machine naming overrides RACK_CAGE ("jaula") naming', () => {
    const result = classifyProduct(input('Jaula Smith Machine | PROmachine'));
    expect(result.primaryProductFamily).toMatchObject({ code: 'PLATE_LOADED_MACHINE', ruleId: 'PF_SMITH_OVERRIDE_V1' });
  });

  it('Smith-machine override also wins over "Multifuncional" naming', () => {
    expect(classifyProduct(input('Multifuncional Smith ZR Series | PROmachine')).primaryProductFamily?.code).toBe('PLATE_LOADED_MACHINE');
  });

  it('CABLE_MACHINE before ROPE_SLED and MACHINE_ATTACHMENT (an accessory named by its own pulley wording)', () => {
    const result = classifyProduct(input('Soga de Triceps - Accesorio Polea | Obelix'));
    expect(result.primaryProductFamily?.code).toBe('CABLE_MACHINE');
  });

  it('FLOORING excludes yoga/pilates wording so YOGA_PILATES can win', () => {
    expect(classifyProduct(input('Mat de Yoga TPE C/Colgador 173x61cm 8mm | Rising')).primaryProductFamily?.code).toBe('YOGA_PILATES');
  });

  it('BALL_BAG excludes pilates wording', () => {
    expect(classifyProduct(input('Balon Pilates 65cm')).primaryProductFamily?.code).toBe('YOGA_PILATES');
  });

  it('mount-hardware accessories win over the generic noun they hold (bar/plate holders)', () => {
    expect(classifyProduct(input('Soporte de Barra x1 Accesorio Delta | HWM')).primaryProductFamily?.code).toBe('MACHINE_ATTACHMENT');
    expect(classifyProduct(input('Par de Soportes Para Discos Olimpicos Accesorio Delta | HWM')).primaryProductFamily?.code).toBe('MACHINE_ATTACHMENT');
  });
});

describe('PRODUCT_FAMILY - A00.4.2 exact existing-family closures', () => {
  const exactCases = [
    ['RowErg | Concept2', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_ERG_EXACT_NAME_V1'],
    ['BikeErg | Concept2', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_ERG_EXACT_NAME_V1'],
    ['SkiErg | Concept2', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_ERG_EXACT_NAME_V1'],
    ['Remo de Aire Magnetico Lite Series | Obelix', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_ROWER_EXACT_NAME_V1'],
    ['Remo de Agua 1.0 | PROmachine', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_ROWER_EXACT_NAME_V1'],
    ['Air Cycle Eco Smart Connect | XEBEX', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_BIKE_EXACT_NAME_V1'],
    ['Air Bike Hurricane 3.0 HWM', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_BIKE_EXACT_NAME_V1'],
    ['Escalera LED S1 Series | Obelix', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_STAIR_EXACT_NAME_V1'],
    ['Escalera Home Led S1 Series | Obelix', 'CARDIO_MACHINE', 'PF_CARDIO_MACHINE_STAIR_EXACT_NAME_V1'],
    ['Pasto Sintetico Rollo 10x2mt', 'FLOORING', 'PF_FLOORING_TURF_NAME_V1'],
    ['Linear Leg Press PL Series | Obelix', 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_EXACT_NAME_V1'],
    ['Linear Hack Squat PL Series | Obelix', 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_EXACT_NAME_V1'],
    ['Hip Thrust Machine PL Series | Obelix', 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_EXACT_NAME_V1'],
    ['Standing Leg Curl Solid Rock | BODYTONE', 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_EXACT_NAME_V1'],
    ['Seated Leg Curl Forza Bold | BODYTONE', 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_EXACT_NAME_V1'],
    ['Prone Leg Curl Forza Bold | BODYTONE', 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_EXACT_NAME_V1'],
    ['Dual Leg Curl/Extension Forza Bold | BODYTONE', 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_EXACT_NAME_V1'],
    ['Dual Leg Curl/Extension MO Series | Obelix', 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_EXACT_NAME_V1'],
  ] as const;

  for (const [productName, code, ruleId] of exactCases) {
    it(`${code}: exact closure for "${productName}"`, () => {
      const result = classifyProduct(input(productName));
      expect(result.primaryProductFamily).toMatchObject({ code, confidence: 'EXPLICIT', ruleId });
      expect(result.classificationStatus).toBe('CLASSIFIED');
    });
  }
});

describe('PRODUCT_FAMILY - A00.4.2 guarded existing-family closures', () => {
  const plateLoadedGuard = [
    feature('2', 'Categoria', 'Olimpico', 'SEMANTIC'),
    feature('12', 'Peso maximo de carga', '280 kg. (140 kg. por lado)', 'SEMANTIC'),
    feature('45', 'Largo de la manga', '31 cm.', 'TECHNICAL'),
    feature('48', 'Diametro de manga', '50 mm', 'SEMANTIC'),
  ] as const;
  const selectorizedGuard = [feature('34', 'Pila de Stack', '105 kg., con placas de 7 kg.', 'SEMANTIC')] as const;

  const guardedCases = [
    ['Shoulder Press T8 Series | Obelix', plateLoadedGuard, 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1'],
    ['Leg Extension Solid Rock | BODYTONE', plateLoadedGuard, 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1'],
    ['Chest Press Solid Rock | BODYTONE', plateLoadedGuard, 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1'],
    ['Pulldown Solid Rock | BODYTONE', plateLoadedGuard, 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1'],
    ['Low Row Solid Rock | BODYTONE', plateLoadedGuard, 'PLATE_LOADED_MACHINE', 'PF_PLATE_LOADED_MACHINE_GUARDED_NAME_V1'],
    ['Extension de Cuadriceps MO Series | Obelix', selectorizedGuard, 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1'],
    ['Chest Press Forza Bold | BODYTONE', selectorizedGuard, 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1'],
    ['Seated Row Forza Bold | BODYTONE', selectorizedGuard, 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1'],
    ['Shoulder Press Forza Bold | BODYTONE', selectorizedGuard, 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1'],
    ['Leg Extension Forza Bold | BODYTONE', selectorizedGuard, 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1'],
    ['Seated Leg Press Forza Bold | BODYTONE', selectorizedGuard, 'SELECTORIZED_MACHINE', 'PF_SELECTORIZED_MACHINE_GUARDED_NAME_V1'],
  ] as const;

  for (const [productName, features, code, ruleId] of guardedCases) {
    it(`${code}: guarded closure for "${productName}"`, () => {
      const result = classifyProduct(input(productName, { features: [...features] }));
      expect(result.primaryProductFamily).toMatchObject({ code, confidence: 'EXPLICIT', ruleId });
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          axis: 'PRODUCT_FAMILY',
          code,
          ruleId,
          sourceType: 'NAME_TEXT',
          sourceId: 'NAME',
        }),
      );
    });
  }

  it('does not classify bare "pulldown" without the plate-loaded guard', () => {
    const result = classifyProduct(input('Pulldown Solid Rock | BODYTONE'));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('does not classify bare "chest press" without the selectorized or plate-loaded guard', () => {
    const result = classifyProduct(input('Chest Press Forza Bold | BODYTONE'));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('does not degrade existing CABLE_MACHINE semantics for pulldown wording', () => {
    const result = classifyProduct(input('Crossover Lat Pulldown ZR Series | PROmachine', { features: [...plateLoadedGuard] }));
    expect(result.primaryProductFamily).toMatchObject({ code: 'CABLE_MACHINE', ruleId: 'PF_CABLE_MACHINE_NAME_V1' });
  });

  it('does not classify an ambiguous machine when both guards are present', () => {
    const result = classifyProduct(input('Chest Press Hibrida', { features: [...plateLoadedGuard, ...selectorizedGuard] }));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });
});

describe('PRODUCT_FAMILY - A00.4.2 negative controls', () => {
  it('keeps agility ladders out of CARDIO_MACHINE despite the word "escalera"', () => {
    const result = classifyProduct(input('Escalera de Agilidad Pro 6m | HWM'));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('keeps the 1619 pack residual in OTHER even with stack evidence', () => {
    const result = classifyProduct(
      input('Pack Duo Leg Curl/Extension MO 2.0 | Obelix', {
        categories: [category('390', 'Packs Gimnasio', 'SEMANTIC_WEAK'), category('386', 'PACKS', 'SEMANTIC_WEAK')],
        features: [
          feature('1', 'Clasificacion de Uso', 'USO INTENSIVO - COMERCIAL', 'SEMANTIC'),
          feature('34', 'Pila de Stack', 'Extension de cuadriceps: 138 Kg + 4.6 Kg (Peso Incremental Desplegable)', 'SEMANTIC'),
          feature('35', 'Pila de Stack', 'Curl Femoral: 117 Kg + 4.6 Kg (Peso Incremental Desplegable)', 'SEMANTIC'),
        ],
      }),
    );
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('keeps the 1023 data-quality residual in OTHER', () => {
    const result = classifyProduct(input('MAQUINA CUADRICEPS'));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('does not turn plate-loaded "extension de cuadriceps" variants into selectorized machines', () => {
    const result = classifyProduct(
      input('Extension de Cuadriceps Iso Lateral Beast | Obelix', {
        categories: [category('285', 'Maquinas con Carga de Discos', 'SEMANTIC_STRONG')],
        features: [
          feature('2', 'Categoria', 'Olimpico', 'SEMANTIC'),
          feature('45', 'Largo de la manga', '28 cm.', 'TECHNICAL'),
          feature('48', 'Diametro de manga', '50 mm', 'SEMANTIC'),
        ],
      }),
    );
    expect(result.primaryProductFamily).toMatchObject({ code: 'PLATE_LOADED_MACHINE', ruleId: 'PF_PLATE_LOADED_MACHINE_CATEGORY_V1' });
  });
});

describe('PRODUCT_FAMILY - hybrid / multi-component products (Section 7)', () => {
  it('assigns a secondary family only for an explicit "+" bundle joining two distinct nouns', () => {
    const result = classifyProduct(input('Pack 105kg Mancuernas Hexagonales + Rack Vertical | HWM'));
    expect(result.primaryProductFamily?.code).toBe('DUMBBELL');
    expect(result.secondaryProductFamilies.map((tag) => tag.code)).toEqual(['STORAGE']);
  });

  it('a bare "+ Rack" (no "vertical") bundle secondary is RACK_CAGE, not STORAGE', () => {
    const result = classifyProduct(input('Pack 8 Pares de Mancuernas Black + Rack | HWM'));
    expect(result.primaryProductFamily?.code).toBe('DUMBBELL');
    expect(result.secondaryProductFamilies.map((tag) => tag.code)).toEqual(['RACK_CAGE']);
  });

  it('BENCH + BAND_SUSPENSION multi-component bundle', () => {
    const result = classifyProduct(input('Banco Multifuncional + Bandas de Resistencia - 2da Seleccion | Forza'));
    expect(result.primaryProductFamily?.code).toBe('BENCH');
    expect(result.secondaryProductFamilies.map((tag) => tag.code)).toEqual(['BAND_SUSPENSION']);
  });

  it('does not assign a secondary family merely for an ordinary "Pack"/"Set" of the same family', () => {
    const result = classifyProduct(input('Pack 4 Bandas de Resistencia | HWM'));
    expect(result.primaryProductFamily?.code).toBe('BAND_SUSPENSION');
    expect(result.secondaryProductFamilies).toEqual([]);
  });
});

describe('PRODUCT_FAMILY - category trust gating (Section 10)', () => {
  it('a SEMANTIC_WEAK category may still vote on PRODUCT_FAMILY', () => {
    const result = classifyProduct(input('Producto Sin Nombre Claro', { categories: [category('292', 'Accesorios para Maquinas', 'SEMANTIC_WEAK')] }));
    expect(result.primaryProductFamily?.code).toBe('MACHINE_ATTACHMENT');
  });

  it('a LEGACY-trust category never votes on PRODUCT_FAMILY, even if its name matches a mapped table', () => {
    const result = classifyProduct(input('Producto Sin Nombre Claro', { categories: [category('285', 'Maquinas con Carga de Discos', 'LEGACY')] }));
    expect(result.primaryProductFamily).toBeNull();
    expect(result.classificationStatus).toBe('OTHER');
  });

  it('excludes the broad "Accesorios de Weightlifting" category from MACHINE_ATTACHMENT even at SEMANTIC_STRONG trust', () => {
    const result = classifyProduct(input('Magnesio 56gr (Unidad) | Araknido', { categories: [category('478', 'Accesorios de Weightlifting', 'SEMANTIC_STRONG')] }));
    expect(result.primaryProductFamily).toBeNull();
  });

  it('a category with no trust-map entry never votes (defensive default: UNKNOWN)', () => {
    const result = classifyProduct(input('Producto Sin Nombre Claro', { categories: [category('999999', 'Maquinas con Carga de Discos', 'UNKNOWN')] }));
    expect(result.primaryProductFamily).toBeNull();
  });
});

describe('PRODUCT_FAMILY - conflict resolution (Section 17)', () => {
  it('NEEDS_REVIEW when two mutually-exclusive category-voted families survive with no name evidence and no approved hybrid rule', () => {
    const result = classifyProduct(
      input('Producto Sin Nombre Claro', {
        categories: [category('285', 'Maquinas con Carga de Discos', 'SEMANTIC_STRONG'), category('281', 'Maquinas Selectorizadas', 'SEMANTIC_STRONG')],
      }),
    );
    expect(result.classificationStatus).toBe('NEEDS_REVIEW');
    expect(result.primaryProductFamily).toBeNull();
    expect(result.needsReviewCandidates.map((tag) => tag.code).sort()).toEqual(['PLATE_LOADED_MACHINE', 'SELECTORIZED_MACHINE']);
  });

  it('does not arbitrarily pick a winner when NEEDS_REVIEW', () => {
    const result = classifyProduct(
      input('Producto Sin Nombre Claro', {
        categories: [category('267', 'Mancuernas', 'SEMANTIC_STRONG'), category('259', 'Discos', 'SEMANTIC_STRONG')],
      }),
    );
    expect(result.classificationStatus).toBe('NEEDS_REVIEW');
    expect(result.primaryProductFamily).toBeNull();
  });
});
