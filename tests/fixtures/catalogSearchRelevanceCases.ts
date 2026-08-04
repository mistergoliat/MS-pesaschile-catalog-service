export type SearchRelevanceIntentClass =
  | 'broad'
  | 'product_type'
  | 'attribute'
  | 'specific'
  | 'reference';

export type SearchRelevanceCase = {
  readonly id: string;
  readonly query: string;
  readonly intentClass: SearchRelevanceIntentClass;
  readonly expectedSignals: readonly string[];
  readonly notes: string;
};

export const catalogSearchRelevanceCases: readonly SearchRelevanceCase[] = [
  { id: 'broad-barra', query: 'barra', intentClass: 'broad', expectedSignals: ['barra'], notes: 'Family-level bar search.' },
  { id: 'broad-disco', query: 'disco', intentClass: 'broad', expectedSignals: ['disco'], notes: 'Family-level plate search.' },
  { id: 'broad-mancuerna', query: 'mancuerna', intentClass: 'broad', expectedSignals: ['mancuerna'], notes: 'Family-level dumbbell search.' },
  { id: 'broad-banco', query: 'banco', intentClass: 'broad', expectedSignals: ['banco'], notes: 'Family-level bench search.' },
  { id: 'broad-rack', query: 'rack', intentClass: 'broad', expectedSignals: ['rack'], notes: 'Family-level rack search.' },

  { id: 'type-barra-olimpica', query: 'barra ol\u00edmpica', intentClass: 'product_type', expectedSignals: ['barra', 'olimpica'], notes: 'Olympic bar product type.' },
  { id: 'type-disco-bumper', query: 'disco bumper', intentClass: 'product_type', expectedSignals: ['disco', 'bumper'], notes: 'Bumper plate product type.' },
  { id: 'type-mancuerna-hexagonal', query: 'mancuerna hexagonal', intentClass: 'product_type', expectedSignals: ['mancuerna', 'hexagonal'], notes: 'Hex dumbbell product type.' },
  { id: 'type-banco-plano', query: 'banco plano', intentClass: 'product_type', expectedSignals: ['banco', 'plano'], notes: 'Flat bench product type.' },
  { id: 'type-rack-sentadilla', query: 'rack sentadilla', intentClass: 'product_type', expectedSignals: ['rack', 'sentadilla'], notes: 'Squat rack product type.' },

  { id: 'attr-barra-20kg', query: 'barra 20 kg', intentClass: 'attribute', expectedSignals: ['barra', '20kg'], notes: 'Abbreviated bar search with weight.' },
  { id: 'attr-barra-220cm', query: 'barra 220 cm', intentClass: 'attribute', expectedSignals: ['barra', '220cm'], notes: 'Bar search with length.' },
  { id: 'attr-disco-10kg', query: 'disco 10 kg', intentClass: 'attribute', expectedSignals: ['disco', '10kg'], notes: 'Plate search with weight.' },
  { id: 'attr-bumper-10kg', query: 'bumper 10 kg', intentClass: 'attribute', expectedSignals: ['bumper', '10kg'], notes: 'Bumper search with weight.' },
  { id: 'attr-mancuerna-20kg', query: 'mancuerna 20 kg', intentClass: 'attribute', expectedSignals: ['mancuerna', '20kg'], notes: 'Dumbbell search with weight.' },
  { id: 'attr-banco-ajustable', query: 'banco ajustable', intentClass: 'attribute', expectedSignals: ['banco', 'ajustable'], notes: 'Bench search with adjustability.' },

  { id: 'specific-barra-olimpica-20kg', query: 'barra ol\u00edmpica 20 kg', intentClass: 'specific', expectedSignals: ['barra', 'olimpica', '20kg'], notes: 'Specific Olympic bar weight search.' },
  { id: 'specific-barra-olimpica-20kg-220cm', query: 'barra ol\u00edmpica 20 kg 220 cm', intentClass: 'specific', expectedSignals: ['barra', 'olimpica', '20kg', '220cm'], notes: 'Specific Olympic bar weight and length search.' },
  { id: 'specific-barra-eco-20kg', query: 'barra ol\u00edmpica eco 20 kg', intentClass: 'specific', expectedSignals: ['barra', 'olimpica', 'eco', '20kg'], notes: 'Specific Olympic bar series search.' },
  { id: 'specific-bumper-eco-10kg', query: 'par bumper plates eco 10 kg', intentClass: 'specific', expectedSignals: ['par', 'bumper', 'plates', 'eco', '10kg'], notes: 'Specific bumper pair search.' },
  { id: 'specific-mancuerna-hexagonal-20kg', query: 'mancuerna hexagonal 20 kg', intentClass: 'specific', expectedSignals: ['mancuerna', 'hexagonal', '20kg'], notes: 'Specific hex dumbbell search.' },

  { id: 'ref-bore20', query: 'BORE20', intentClass: 'reference', expectedSignals: ['BORE20'], notes: 'Exact product reference.' },
  { id: 'ref-dobe10', query: 'DOBE10', intentClass: 'reference', expectedSignals: ['DOBE10'], notes: 'Exact product reference.' },
  { id: 'ref-borp', query: 'BORP', intentClass: 'reference', expectedSignals: ['BORP'], notes: 'Exact product reference.' },
  { id: 'ref-boeh', query: 'BOEH', intentClass: 'reference', expectedSignals: ['BOEH'], notes: 'Exact product reference.' },
  { id: 'ref-bort', query: 'BORT', intentClass: 'reference', expectedSignals: ['BORT'], notes: 'Exact product reference.' },

  { id: 'variant-barra-olimpica-20kg-compact', query: 'barra olimpica 20kg', intentClass: 'specific', expectedSignals: ['barra', 'olimpica', '20kg'], notes: 'Unaccented compact unit variant.' },
  { id: 'variant-barra-olimpica-20kg-spaced', query: 'barra ol\u00edmpica 20 kg', intentClass: 'specific', expectedSignals: ['barra', 'olimpica', '20kg'], notes: 'Accented spaced unit variant.' },
  { id: 'variant-barra-20kg-uppercase', query: 'barra 20 KG', intentClass: 'attribute', expectedSignals: ['barra', '20kg'], notes: 'Uppercase unit abbreviation.' },
  { id: 'variant-barra-20kg-hyphen', query: 'barra 20-kgs', intentClass: 'attribute', expectedSignals: ['barra', '20kg'], notes: 'Hyphenated plural unit abbreviation.' },
  { id: 'variant-disco-2-5kg-comma', query: 'disco 2,5 kg', intentClass: 'attribute', expectedSignals: ['disco', '2.5kg'], notes: 'Decimal comma unit variant.' },
  { id: 'variant-disco-2-5kg-dot', query: 'disco 2.5kg', intentClass: 'attribute', expectedSignals: ['disco', '2.5kg'], notes: 'Decimal dot unit variant.' },

  { id: 'ambiguous-barra-pro', query: 'barra pro', intentClass: 'attribute', expectedSignals: ['barra', 'pro'], notes: 'Potentially brand, quality, or series ambiguity.' },
  { id: 'ambiguous-barra-eco', query: 'barra eco', intentClass: 'attribute', expectedSignals: ['barra', 'eco'], notes: 'Potentially series or marketing term.' },
  { id: 'ambiguous-disco-pro', query: 'disco pro', intentClass: 'attribute', expectedSignals: ['disco', 'pro'], notes: 'Potentially brand, quality, or series ambiguity.' },
  { id: 'ambiguous-banco-gym', query: 'banco gym', intentClass: 'attribute', expectedSignals: ['banco', 'gym'], notes: 'Potentially generic gym descriptor.' },
  { id: 'ambiguous-rack-home', query: 'rack home', intentClass: 'attribute', expectedSignals: ['rack', 'home'], notes: 'Potentially use-case descriptor.' },

  { id: 'control-modelo-m20', query: 'modelo m20', intentClass: 'specific', expectedSignals: ['modelo', 'm20'], notes: 'Negative/control query for unit-letter safety.' },
  { id: 'control-programa', query: 'programa', intentClass: 'broad', expectedSignals: ['programa'], notes: 'Control query likely matching descriptions.' },
  { id: 'control-gimnasio', query: 'gimnasio', intentClass: 'broad', expectedSignals: ['gimnasio'], notes: 'Control query likely matching descriptions.' },
  { id: 'control-premium', query: 'premium', intentClass: 'broad', expectedSignals: ['premium'], notes: 'Control query for generic descriptor.' },
  { id: 'control-inexistente', query: 'producto inexistente xyz987', intentClass: 'specific', expectedSignals: ['producto', 'inexistente', 'xyz987'], notes: 'Expected to produce no results unless descriptions contain the phrase.' },
];
