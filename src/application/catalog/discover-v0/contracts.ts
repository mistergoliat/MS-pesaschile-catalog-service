/*
 * CAT-DISCOVER-V0 — experimental contracts of `catalog.discoverV0` (PRD §20–§24).
 *
 * Offline vertical slice only: not wired to HTTP, R4 or the production runtime.
 * Retrieval returns productKeys plus retrieval signals; it never computes price,
 * promotion or stock. Commercial data appears only when a real Commercial Truth
 * hydrator supplied it; offline it is explicitly NOT_OBSERVED.
 */

export const DISCOVER_V0_RETRIEVAL_VERSION = 'catalog-discover-v0.1';
export const DISCOVER_V0_MAX_CANDIDATES = 8;

/** LEXICAL_PLUS: exact + lexical generators only. HYBRID: plus structured semantics and constraint verification. */
export type DiscoverV0Mode = 'LEXICAL_PLUS' | 'HYBRID';

export type DiscoverV0Request = {
  schemaVersion: 1;
  need: string;
  limit?: number;
};

export type ConceptAxis =
  | 'PRODUCT_FAMILY'
  | 'DISCIPLINE'
  | 'USE_CONTEXT'
  | 'EXERCISE_CAPABILITY'
  | 'TRAINING_FUNCTION'
  | 'MUSCLE_GROUP'
  | 'BODY_REGION';

export type ConstraintKind =
  | 'PRODUCT_TYPE'
  | 'EXERCISE'
  | 'TRAINING_FUNCTION'
  | 'ANATOMY'
  | 'SPEC'
  | 'COMMERCIAL_MAX_PRICE'
  | 'COMMERCIAL_AVAILABILITY'
  | 'COMMERCIAL_LOW_PRICE'
  | 'COMPATIBILITY'
  | 'DISCIPLINE'
  | 'USE_CONTEXT'
  | 'BUNDLE_COMPONENT'
  | 'SUBSTITUTION'
  | 'UNMODELED_NEED'
  | 'VARIANT_ATTRIBUTE'
  | 'NOMINAL_TEXT';

export type SpecKeyV0 = 'max_user_weight_kg' | 'max_load_kg' | 'assembled_length_cm' | 'assembled_width_cm' | 'assembled_height_cm' | 'weight_kg';

export type DiscoverConstraint = {
  id: string;
  kind: ConstraintKind;
  domain: 'TECHNICAL' | 'COMMERCIAL';
  matchedText: string;
  /** Concept codes (any-of) for PRODUCT_TYPE / EXERCISE / TRAINING_FUNCTION / ANATOMY / DISCIPLINE / USE_CONTEXT. */
  axis?: ConceptAxis;
  codes?: string[];
  specKey?: SpecKeyV0;
  operator?: 'EQ' | 'GTE' | 'LTE';
  value?: number;
  unit?: 'kg' | 'cm' | 'CLP';
  target?: string;
  /**
   * PRODUCT_TYPE only: the query named a subtype the ontology does not model.
   * Any-of alternatives; every token of an alternative must appear in the
   * product's indexed source text. A relevance gate, never a certification.
   */
  subtypeText?: string[][];
  /** Set when a hard constraint was demoted because the query named one exact product. */
  demotedFrom?: 'HARD';
};

export type InterpretationState = 'RECOGNIZED' | 'CONSTRAINT' | 'FILLER' | 'UNKNOWN';

export type InterpretationEntry = {
  text: string;
  state: InterpretationState;
  axis?: ConceptAxis | 'LEXICAL_SYNONYM' | 'EXACT_ID' | 'COMMERCIAL' | 'COMPATIBILITY' | 'SPEC' | 'UNMODELED';
  code?: string;
  lexiconEntryId?: string;
  note?: string;
};

export type QueryInterpretation = {
  normalizedQuery: string;
  recognizedConcepts: string[];
  unrecognizedTerms: string[];
  hardConstraints: DiscoverConstraint[];
  softPreferences: DiscoverConstraint[];
  entries: InterpretationEntry[];
  /** Tokens sent to lexical retrieval (fillers and constraint operators removed). */
  lexicalTokens: string[];
  /** Governed lexical synonym expansions: original phrase → replacement tokens. */
  synonymExpansions: { phrase: string[]; replacement: string[]; lexiconEntryId: string }[];
  productKeyLookups: string[];
  lexiconVersion: string;
};

export type RetrievalGenerator = 'EXACT' | 'LEXICAL' | 'STRUCTURED';

export type RetrievalSignal = {
  generator: RetrievalGenerator;
  kind: string;
  score: number;
  source: 'SOURCE_NAME' | 'SOURCE_REFERENCE' | 'SOURCE_BRAND' | 'SOURCE_CATEGORY' | 'SOURCE_FEATURE' | 'PRODUCT_KEY'
    | 'PRODUCT_SEMANTICS' | 'TRAINING_V2' | 'SPECS';
  matchedConcept?: string;
  evidence?: string;
  confidence?: string;
  admission?: string;
};

export type GeneratedCandidate = { productKey: string; signals: RetrievalSignal[] };

export type ConstraintState = 'SATISFIED' | 'VIOLATED' | 'UNKNOWN' | 'UNSUPPORTED';

export type ConstraintResult = {
  constraintId: string;
  kind: ConstraintKind;
  domain: 'TECHNICAL' | 'COMMERCIAL';
  hard: boolean;
  state: ConstraintState;
  reason: string;
  source?: 'PRODUCT_SEMANTICS' | 'TRAINING_V2' | 'SPECS' | 'COMMERCIAL_TRUTH' | 'RELATIONSHIPS' | 'SOURCE_NAME' | 'ONTOLOGY';
  matchedConcept?: string;
  evidence?: string;
  confidence?: string;
  admission?: string;
};

export type CommercialObservation =
  | { status: 'NOT_OBSERVED'; reason: string }
  | {
      status: 'OBSERVED';
      authority: string;
      asOf: string;
      finalGrossClp: number | null;
      sellability: 'sellable' | 'backorder' | 'not_sellable' | 'check_with_staff';
    };

export type ScoreComponents = {
  exactTier: number | null;
  lexical: number;
  structured: number;
  softPreferences: number;
  total: number;
};

export type DiscoverCandidate = {
  productKey: string;
  name: string;
  rank: number;
  score: number;
  matchedBy: string[];
  whyMatched: string[];
  constraintResults: ConstraintResult[];
  evidence: { source: string; ref: string; code?: string }[];
  scoreComponents: ScoreComponents;
  commercial: CommercialObservation;
};

export type DiscoverV0Response = {
  schemaVersion: 1;
  mode: DiscoverV0Mode;
  interpretation: {
    recognizedConcepts: string[];
    unrecognizedTerms: string[];
    hardConstraints: DiscoverConstraint[];
    softPreferences: DiscoverConstraint[];
    entries: InterpretationEntry[];
  };
  candidates: DiscoverCandidate[];
  unverifiedCandidates: DiscoverCandidate[];
  completeness: {
    candidateCount: number;
    eligibleCount: number;
    unverifiedCount: number;
    excludedCount: number;
    returnedCount: number;
    truncated: boolean;
    degraded: string[];
    strategy: RetrievalGenerator[];
    noResultReason: string | null;
  };
  lineage: {
    bundleId: string;
    bundleLabel: string;
    sourceExtractionId: string;
    retrievalVersion: string;
    lexiconVersion: string;
    indexFingerprint: string;
    productSemanticsSnapshotId: string | null;
    trainingV2SnapshotId: string | null;
    specsSnapshotId: string | null;
    admissionContractHash: string;
  };
};

/** Per-stage wall time in milliseconds (process-local, offline; never an HTTP latency). */
export type DiscoverStageTimings = Partial<Record<
  'interpret' | 'exact' | 'lexical' | 'structured' | 'fusion' | 'hydrate' | 'verify' | 'rank' | 'assemble' | 'total', number>>;
