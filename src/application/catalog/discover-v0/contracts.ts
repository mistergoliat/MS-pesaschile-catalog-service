/*
 * CAT-DISCOVER-V0.2 — experimental contracts of `catalog.discoverV0` (PRD §20–§24).
 *
 * Offline vertical slice only: not wired to HTTP, R4 or the production runtime.
 * Retrieval returns productKeys plus retrieval signals; it never computes price,
 * promotion or stock. Commercial data appears only when a real Commercial Truth
 * hydrator supplied it; offline it is explicitly NOT_OBSERVED.
 *
 * V0.2 keeps three questions apart (each with its own fields):
 *   1. relevance   — is the product potentially relevant to the need?   (RelevanceAssessment)
 *   2. constraints — which constraints are SATISFIED / VIOLATED / UNKNOWN / UNSUPPORTED? (ConstraintResult)
 *   3. claims      — what can Catalog assert without exceeding evidence? (CandidateDisposition)
 * Lexical relevance can justify retrieval, never certify a function, compatibility or spec.
 */

export const DISCOVER_V0_RETRIEVAL_VERSION = 'catalog-discover-v0.2';
export const DISCOVER_V0_MAX_CANDIDATES = 8;
export const DISCOVER_AGENT_MAX_VERIFIED = 8;
export const DISCOVER_AGENT_MAX_POSSIBLE = 3;

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

/** What a span of the query talks about (V0.2 interpretation roles). */
export type SemanticRole =
  | 'PRODUCT_IDENTITY'
  | 'PRODUCT_ROLE'
  | 'TRAINING_FUNCTION'
  | 'EXERCISE_CAPABILITY'
  | 'USE_PURPOSE'
  | 'RELATIONSHIP'
  | 'SPECIFICATION'
  | 'COMMERCIAL_CONSTRAINT';

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

/**
 * Physical scope of a quantity. PER_SIDE and SUBCOMPONENT extend the base set:
 * a per-side load is not a product total, and a subcomponent value ("barra pull
 * up: 150 kg") applies to one part of the product only.
 */
export type QuantityScope =
  | 'PER_UNIT'
  | 'PER_PAIR'
  | 'PACK_TOTAL'
  | 'PRODUCT_TOTAL'
  | 'USER_CAPACITY'
  | 'CONFIGURATION_DEPENDENT'
  | 'PER_SIDE'
  | 'SUBCOMPONENT'
  | 'UNKNOWN';

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
  /** SPEC weight only: the physical scope the query asks about, and why. */
  quantityScope?: QuantityScope;
  quantityScopeRule?: string;
  /** Set when the constraint belongs to one reading of a materially ambiguous span. */
  groupId?: string;
  readingId?: string;
  role?: SemanticRole;
};

/**
 * A relevance requirement is part of the need that no projection can certify
 * (a named subtype, a stored object, a named product identity). It is matched in
 * the product's own source text. Gating requirements filter retrieval; the
 * others only boost relevance. Neither ever makes a constraint SATISFIED.
 */
export type RelevanceRequirement = {
  id: string;
  role: SemanticRole;
  text: string;
  /** Any-of alternatives of stemmed tokens (all tokens of one alternative must appear). */
  alternatives: string[][];
  /** Where the text must appear: NAME only (served objects) or any indexed source text (default, as V0 subtypes). */
  field?: 'NAME' | 'ANY';
  gating: boolean;
  constraintId?: string;
  groupId?: string;
  readingId?: string;
  note: string;
};

export type ReadingStatus = 'SELECTED' | 'PLAUSIBLE_UNRESOLVED' | 'RELEVANCE_ONLY' | 'CONSIDERED_REJECTED';

export type SpanReading = {
  readingId: string;
  role: SemanticRole;
  status: ReadingStatus;
  concepts: string[];
  evidence: string[];
  derivedConstraintIds: string[];
  derivedRequirementIds: string[];
  reason?: string;
};

export type InterpretationSpan = {
  spanId: string;
  text: string;
  tokenStart: number;
  tokenEnd: number;
  readings: SpanReading[];
  ambiguity: 'NONE' | 'MATERIAL';
  resolution: 'RESOLVED' | 'UNRESOLVED';
  unresolvedReasons: string[];
  lexiconEntryId?: string;
};

/** A materially ambiguous span: its readings are alternatives, never simultaneous hard constraints. */
export type AmbiguityGroup = {
  groupId: string;
  spanId: string;
  text: string;
  readings: { readingId: string; role: SemanticRole; label: string; constraintIds: string[]; requirementIds: string[] }[];
};

export type InterpretationState = 'RECOGNIZED' | 'CONSTRAINT' | 'FILLER' | 'UNKNOWN';

export type InterpretationEntry = {
  text: string;
  state: InterpretationState;
  axis?: ConceptAxis | 'LEXICAL_SYNONYM' | 'EXACT_ID' | 'COMMERCIAL' | 'COMPATIBILITY' | 'SPEC' | 'UNMODELED' | 'AMBIGUOUS' | 'USE_PURPOSE';
  code?: string;
  lexiconEntryId?: string;
  note?: string;
};

export type QueryInterpretation = {
  normalizedQuery: string;
  recognizedConcepts: string[];
  unrecognizedTerms: string[];
  /** Required constraints. Constraints carrying a groupId are alternatives of an AmbiguityGroup. */
  hardConstraints: DiscoverConstraint[];
  softPreferences: DiscoverConstraint[];
  relevanceRequirements: RelevanceRequirement[];
  spans: InterpretationSpan[];
  ambiguityGroups: AmbiguityGroup[];
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
  /** LEXICAL BM25 only: share of lexical query tokens covered. */
  coverage?: number;
};

export type GeneratedCandidate = { productKey: string; signals: RetrievalSignal[] };

export type ConstraintState = 'SATISFIED' | 'VIOLATED' | 'UNKNOWN' | 'UNSUPPORTED';

/** Typed reading of one published spec value (derived, never written back to Specs). */
export type SpecQuantity = {
  key: SpecKeyV0;
  magnitude: 'MASS' | 'LOAD_CAPACITY' | 'USER_CAPACITY' | 'LENGTH';
  scope: QuantityScope;
  appliesTo: string;
  componentCount: number | null;
  value: number | null;
  unit: 'kg' | 'cm';
  qualifier: string | null;
  approximate: boolean;
  includesUser: boolean;
  subcomponentExercises: string[];
  status: 'INTERPRETED' | 'AMBIGUOUS' | 'CONFLICTING' | 'UNSUPPORTED';
  /**
   * Typing a value is not certifying it. CERTIFIABLE: usable for a product-level constraint of its
   * natural scope. CONDITIONAL: usable only in a matching context (subcomponent asked about, all
   * configurations agreeing, range-only for approximate values, component family known). NOT_CERTIFIABLE:
   * never used to satisfy or violate a constraint.
   */
  certification: 'CERTIFIABLE' | 'CONDITIONAL' | 'NOT_CERTIFIABLE';
  rule: string;
  evidence: string;
};

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
  /** Source text and classification disagree; the uncertainty is preserved (never resolved for the classifier). */
  conflict?: 'CONFLICTING_EVIDENCE';
  groupId?: string;
  readingId?: string;
  quantity?: Pick<SpecQuantity, 'scope' | 'appliesTo' | 'status' | 'rule' | 'approximate'> & { comparedValue: number | null; derived: boolean };
};

export type ReadingState = ConstraintState | 'OFF_TARGET';

export type GroupResult = {
  groupId: string;
  state: ConstraintState;
  reason: string;
  satisfiedUnder: string[];
  readings: { readingId: string; state: ReadingState; reason: string }[];
};

export type CommercialObservation =
  | { status: 'NOT_OBSERVED'; reason: string }
  | {
      status: 'OBSERVED';
      authority: string;
      asOf: string;
      validUntil?: string | null;
      finalGrossClp: number | null;
      sellability: 'sellable' | 'backorder' | 'not_sellable' | 'check_with_staff';
      availabilityReason?: string;
    };

export type CandidateDisposition = 'VERIFIED_MATCH' | 'POSSIBLE_MATCH' | 'REJECTED';

export type RelevanceTier = 'EXACT' | 'STRONG' | 'PARTIAL' | 'WEAK';

export type RelevanceAssessment = {
  tier: RelevanceTier;
  exactTier: number | null;
  lexical: number;
  structured: number;
  coverage: number;
  requirementsMatched: string[];
  requirementsMissed: string[];
  score: number;
};

export type ScoreComponents = {
  exactTier: number | null;
  relevance: number;
  lexical: number;
  structured: number;
  constraintFit: number;
  softPreferences: number;
  total: number;
};

export type DiscoverCandidate = {
  productKey: string;
  name: string;
  rank: number;
  disposition: CandidateDisposition;
  score: number;
  relevance: RelevanceAssessment;
  matchedBy: string[];
  whyMatched: string[];
  /** Hard constraints that keep the candidate out of VERIFIED_MATCH (POSSIBLE) or reject it. */
  blocking: { constraintId: string; state: ConstraintState | ReadingState; reason: string; conflict?: 'CONFLICTING_EVIDENCE' }[];
  constraintResults: ConstraintResult[];
  groupResults: GroupResult[];
  evidence: { source: string; ref: string; code?: string }[];
  scoreComponents: ScoreComponents;
  commercial: CommercialObservation;
};

export type DiscoverCompleteness = {
  candidateCount: number;
  verifiedCount: number;
  possibleCount: number;
  rejectedCount: number;
  returnedCount: number;
  truncated: boolean;
  /** Lexical generator pool limit reached: lower-ranked lexical matches were never retrieved. */
  retrievalTruncated: boolean;
  commercialHydration: { bound: number; requested: number; technicallyEligibleBeyondBound: number; failed: boolean };
  degraded: string[];
  strategy: RetrievalGenerator[];
  noResultReason: string | null;
};

export type DiscoverLineage = {
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

export type ExactResolution = {
  status: 'RESOLVED' | 'NONE';
  kind: 'PRODUCT_KEY' | 'REFERENCE' | 'NAME' | null;
  productKeys: string[];
  /** RELATED_PRODUCT_DISCOVERY runs under the ORIGINAL constraints; exact identity never demotes them. */
  relatedDiscovery: 'APPLIED' | 'NOT_APPLICABLE';
};

/** Full diagnostic representation: the debugging authority. */
export type DiscoverDiagnosticResponse = {
  schemaVersion: 2;
  mode: DiscoverV0Mode;
  interpretation: {
    normalizedQuery: string;
    recognizedConcepts: string[];
    unrecognizedTerms: string[];
    hardConstraints: DiscoverConstraint[];
    softPreferences: DiscoverConstraint[];
    relevanceRequirements: RelevanceRequirement[];
    spans: InterpretationSpan[];
    ambiguityGroups: AmbiguityGroup[];
    entries: InterpretationEntry[];
  };
  exactResolution: ExactResolution & { entities: DiscoverCandidate[] };
  verified: DiscoverCandidate[];
  possible: DiscoverCandidate[];
  rejected: { productKey: string; name: string; relevanceTier: RelevanceTier; violated: { constraintId: string; reason: string }[] }[];
  completeness: DiscoverCompleteness;
  lineage: DiscoverLineage;
};

/** @deprecated V0 name of the diagnostic response, kept for existing callers. */
export type DiscoverV0Response = DiscoverDiagnosticResponse;

/** Compact representation for a future R4 consumer: no raw signals, tokens or source dumps. */
export type DiscoverAgentResponse = {
  schemaVersion: 1;
  version: string;
  interpretation: {
    need: string;
    required: string[];
    preferred: string[];
    notVerifiable: string[];
    ambiguities: { text: string; readings: string[] }[];
    unrecognized: string[];
  };
  exactMatch: AgentCandidate | null;
  verified: AgentCandidate[];
  possible: AgentCandidate[];
  completeness: {
    verified: number;
    possible: number;
    rejected: number;
    truncated: boolean;
    degraded: string[];
    noVerifiedReason: string | null;
    warnings: string[];
  };
  commercial: { status: 'NOT_OBSERVED'; reason: string } | { status: 'OBSERVED'; authority: string; asOf: string };
  lineage: { bundleId: string; sourceExtractionId: string; version: string; lexicon: string };
};

export type AgentCandidate = {
  productKey: string;
  name: string;
  disposition: CandidateDisposition;
  /** Short structured codes: what matched and which authority certified it. */
  verified: string[];
  /** Constraints / readings that are UNKNOWN, UNSUPPORTED or conflicting for this product. */
  unverified?: string[];
  readings?: string[];
  price?: { finalGrossClp: number | null; sellability: string; asOf: string; fresh: boolean };
};

/** Per-stage wall time in milliseconds (process-local, offline; never an HTTP latency). */
export type DiscoverStageTimings = Partial<Record<
  'interpret' | 'exact' | 'lexical' | 'structured' | 'fusion' | 'hydrate' | 'verify' | 'rank' | 'assemble' | 'total', number>>;
