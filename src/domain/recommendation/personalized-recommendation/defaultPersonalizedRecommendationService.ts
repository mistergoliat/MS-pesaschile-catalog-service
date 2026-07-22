import { cloneJsonValue, deepFreeze } from '../relationship-engine/publication/canonicalJson.js';
import { createProductRuntimeIdentity } from '../relationship-engine/runtime/index.js';
import {
  DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS,
  PERSONALIZED_RECOMMENDATION_SCORING_VERSION,
  commercialRecommendationResultSchema,
  personalizedRecommendationParametersSchema,
  personalizedRecommendationRequestSchema,
  personalizedRecommendationResultSchema,
  personalizedRecommendationScoreComponentsSchema,
  type CommercialRecommendation,
  type PersonalizedRecommendation,
  type PersonalizedRecommendationContext,
  type PersonalizedRecommendationExclusion,
  type PersonalizedRecommendationParameters,
  type PersonalizedRecommendationReason,
  type PersonalizedRecommendationReasonCode,
  type PersonalizedRecommendationRequest,
  type PersonalizedRecommendationResult,
  type PersonalizedRecommendationScoreResult,
  type PersonalizedRecommendationScorer,
  type PersonalizedRecommendationService,
  type PersonalizedRecommendationStatistics,
  type PersonalizedRecommendationWarning,
} from './contracts.js';
import type { CustomerProductAffinity, CustomerProductAffinityResult } from '../customer-affinity/index.js';
import { customerProductAffinityResultSchema } from '../customer-affinity/index.js';
import { PersonalizedRecommendationError } from './errors.js';

type ScoredCandidate = {
  commercialRecommendation: CommercialRecommendation;
  customerAffinity?: CustomerProductAffinity;
  score: PersonalizedRecommendationScoreResult;
  warnings: PersonalizedRecommendationWarning[];
};

type PreparedInput = {
  commercialRecommendations: readonly CommercialRecommendation[];
  affinityByIdentity: ReadonlyMap<string, CustomerProductAffinity>;
  ignoredAffinityEntries: number;
  warnings: PersonalizedRecommendationWarning[];
  customer?: CustomerProductAffinityResult['customer'];
  parameters: PersonalizedRecommendationParameters;
  context?: PersonalizedRecommendationContext;
};

function warning(
  code: PersonalizedRecommendationWarning['code'],
  productIdentity?: string,
  details?: PersonalizedRecommendationWarning['details'],
): PersonalizedRecommendationWarning {
  return {
    code,
    ...(productIdentity === undefined ? {} : { productIdentity }),
    ...(details === undefined ? {} : { details }),
  };
}

function commercialScore(recommendation: CommercialRecommendation): number {
  return recommendation.score.total / 100;
}

function hasProductRejection(affinity: CustomerProductAffinity | undefined): boolean {
  return affinity?.signals.some((signal) => signal.code === 'PRODUCT_REJECTION') ?? false;
}

function isContextExcluded(
  recommendation: CommercialRecommendation,
  context: PersonalizedRecommendationContext | undefined,
): boolean {
  const identity = createProductRuntimeIdentity(recommendation.product);
  return context?.excludedProductIds?.some((product) => createProductRuntimeIdentity(product) === identity) ?? false;
}

function affinityWarningCode(code: string): PersonalizedRecommendationWarning['code'] {
  if (code === 'CUSTOMER_NOT_IDENTIFIED') return 'CUSTOMER_NOT_IDENTIFIED';
  if (code === 'NO_CUSTOMER_HISTORY') return 'NO_CUSTOMER_HISTORY';
  if (code === 'PARTIAL_CUSTOMER_HISTORY') return 'PARTIAL_CUSTOMER_HISTORY';
  return 'AFFINITY_WARNING_PROPAGATED';
}

function signalReasonCode(code: string): PersonalizedRecommendationReasonCode | null {
  if (code === 'DIRECT_PRODUCT_PURCHASE') return 'CUSTOMER_PRODUCT_AFFINITY';
  if (code === 'CATEGORY_PURCHASE') return 'CUSTOMER_CATEGORY_AFFINITY';
  if (code === 'BRAND_PURCHASE') return 'CUSTOMER_BRAND_AFFINITY';
  if (code === 'RECENT_PRODUCT_INTEREST') return 'RECENT_PRODUCT_INTEREST';
  if (code === 'RECENT_CATEGORY_INTEREST') return 'RECENT_CATEGORY_INTEREST';
  if (code === 'OWNED_COMPATIBLE_PRODUCT') return 'OWNED_COMPATIBLE_PRODUCT';
  if (code === 'REPEAT_PURCHASE_PATTERN') return 'REPEAT_PURCHASE_PATTERN';
  if (code === 'OBSERVED_SPEND_FIT') return 'OBSERVED_SPEND_COMPATIBILITY';
  return null;
}

const reasonOrder: PersonalizedRecommendationReasonCode[] = [
  'STRONG_COMMERCIAL_RELEVANCE',
  'CUSTOMER_PRODUCT_AFFINITY',
  'CUSTOMER_CATEGORY_AFFINITY',
  'CUSTOMER_BRAND_AFFINITY',
  'RECENT_PRODUCT_INTEREST',
  'RECENT_CATEGORY_INTEREST',
  'OWNED_COMPATIBLE_PRODUCT',
  'REPEAT_PURCHASE_PATTERN',
  'OBSERVED_SPEND_COMPATIBILITY',
  'EXPLICIT_CONTEXT_PREFERENCE',
  'GENERAL_COMMERCIAL_FALLBACK',
];

function reasonRank(code: PersonalizedRecommendationReasonCode): number {
  return reasonOrder.indexOf(code);
}

function deduplicateReasons(reasons: PersonalizedRecommendationReason[]): PersonalizedRecommendationReason[] {
  const byCode = new Map<PersonalizedRecommendationReasonCode, PersonalizedRecommendationReason>();
  for (const reason of reasons) {
    if (!byCode.has(reason.code)) byCode.set(reason.code, reason);
  }
  return [...byCode.values()].sort((left, right) => reasonRank(left.code) - reasonRank(right.code));
}

function buildReasons(candidate: ScoredCandidate): PersonalizedRecommendationReason[] {
  const reasons: PersonalizedRecommendationReason[] = [];
  if (candidate.score.components.commercialScore >= 0.7) {
    reasons.push({
      code: 'STRONG_COMMERCIAL_RELEVANCE',
      contribution: candidate.score.components.normalizedCommercialContribution,
      source: 'commercial',
    });
  }
  if (candidate.customerAffinity && candidate.customerAffinity.confidence !== 'none') {
    for (const signal of candidate.customerAffinity.signals) {
      if (signal.direction !== 'positive') continue;
      const code = signalReasonCode(signal.code);
      if (code) {
        reasons.push({
          code,
          contribution: signal.strength,
          source: 'affinity',
        });
      }
    }
  }
  if (candidate.score.components.explicitPreferenceBoost > 0) {
    reasons.push({
      code: 'EXPLICIT_CONTEXT_PREFERENCE',
      contribution: candidate.score.components.explicitPreferenceBoost,
      source: 'context',
    });
  }
  if (!candidate.score.effectivePersonalization) {
    reasons.push({
      code: 'GENERAL_COMMERCIAL_FALLBACK',
      source: 'fallback',
    });
  }
  return deduplicateReasons(reasons);
}

function compareRankedCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return (
    right.score.components.finalScore - left.score.components.finalScore ||
    right.score.components.commercialScore - left.score.components.commercialScore ||
    left.commercialRecommendation.rank - right.commercialRecommendation.rank ||
    createProductRuntimeIdentity(left.commercialRecommendation.product).localeCompare(
      createProductRuntimeIdentity(right.commercialRecommendation.product),
    )
  );
}

function compareCommercialOrder(left: ScoredCandidate, right: ScoredCandidate): number {
  return (
    left.commercialRecommendation.rank - right.commercialRecommendation.rank ||
    createProductRuntimeIdentity(left.commercialRecommendation.product).localeCompare(
      createProductRuntimeIdentity(right.commercialRecommendation.product),
    )
  );
}

function createStatistics(input: {
  commercialCandidatesReceived: number;
  affinityEntriesReceived: number;
  candidatesWithAffinity: number;
  affinityEntriesIgnored: number;
  excluded: readonly PersonalizedRecommendationExclusion[];
  recommendations: readonly PersonalizedRecommendation[];
  warningsGenerated: number;
}): PersonalizedRecommendationStatistics {
  return {
    commercialCandidatesReceived: input.commercialCandidatesReceived,
    affinityEntriesReceived: input.affinityEntriesReceived,
    candidatesWithAffinity: input.candidatesWithAffinity,
    candidatesWithoutAffinity: input.commercialCandidatesReceived - input.candidatesWithAffinity,
    affinityEntriesIgnored: input.affinityEntriesIgnored,
    contextExclusions: input.excluded.filter((exclusion) => exclusion.code === 'EXPLICIT_CONTEXT_EXCLUSION').length,
    rejectionExclusions: input.excluded.filter((exclusion) => exclusion.code === 'EXPLICIT_PRODUCT_REJECTION').length,
    minimumScoreExclusions: input.excluded.filter((exclusion) => exclusion.code === 'BELOW_MINIMUM_PERSONALIZED_SCORE').length,
    resultLimitTruncations: input.excluded.filter((exclusion) => exclusion.code === 'RESULT_LIMIT_TRUNCATION').length,
    personalizedRecommendationsReturned: input.recommendations.length,
    recommendationsWithEffectivePersonalization: input.recommendations.filter((recommendation) => (
      recommendation.components.normalizedAffinityContribution > 0 ||
      recommendation.components.explicitPreferenceBoost > 0 ||
      recommendation.components.rejectionPenalty > 0
    )).length,
    commercialFallbackRecommendations: input.recommendations.filter((recommendation) => (
      recommendation.components.normalizedAffinityContribution === 0 &&
      recommendation.components.explicitPreferenceBoost === 0 &&
      recommendation.components.rejectionPenalty === 0
    )).length,
    warningsGenerated: input.warningsGenerated,
  };
}

function exclusion(
  recommendation: CommercialRecommendation,
  code: PersonalizedRecommendationExclusion['code'],
  affinity: CustomerProductAffinity | undefined,
): PersonalizedRecommendationExclusion {
  return {
    product: cloneJsonValue(recommendation.product),
    code,
    commercialScore: commercialScore(recommendation),
    ...(affinity === undefined ? {} : { affinityScore: affinity.score }),
  };
}

export class DefaultPersonalizedRecommendationService implements PersonalizedRecommendationService {
  constructor(private readonly scorer: PersonalizedRecommendationScorer) {}

  personalize(request: PersonalizedRecommendationRequest): PersonalizedRecommendationResult {
    const prepared = this.prepare(request);
    const excluded: PersonalizedRecommendationExclusion[] = [];
    const scored: ScoredCandidate[] = [];

    for (const recommendation of prepared.commercialRecommendations) {
      const identity = createProductRuntimeIdentity(recommendation.product);
      const affinity = prepared.affinityByIdentity.get(identity);
      const candidateWarnings = [
        ...recommendation.warnings.map(() => warning('COMMERCIAL_WARNING_PROPAGATED', identity)),
        ...(affinity?.warnings ?? []).map((item) => warning(affinityWarningCode(item.code), identity)),
      ];
      if (request.customerAffinities !== undefined && affinity === undefined) {
        const missing = warning('AFFINITY_MISSING_FOR_PRODUCT', identity);
        candidateWarnings.push(missing);
      }

      if (isContextExcluded(recommendation, prepared.context)) {
        excluded.push(exclusion(recommendation, 'EXPLICIT_CONTEXT_EXCLUSION', affinity));
        continue;
      }
      if (hasProductRejection(affinity)) {
        excluded.push(exclusion(recommendation, 'EXPLICIT_PRODUCT_REJECTION', affinity));
        continue;
      }

      const score = this.scorer.score(recommendation, affinity, prepared.context, prepared.parameters);
      if (!personalizedRecommendationScoreComponentsSchema.safeParse(score.components).success) {
        throw new PersonalizedRecommendationError('INVALID_SCORE', 'Personalized recommendation score is invalid');
      }
      if (score.components.finalScore < (prepared.parameters.minimumPersonalizedScore ?? 0)) {
        excluded.push(exclusion(recommendation, 'BELOW_MINIMUM_PERSONALIZED_SCORE', affinity));
        continue;
      }
      scored.push({
        commercialRecommendation: recommendation,
        customerAffinity: affinity,
        score,
        warnings: candidateWarnings,
      });
    }

    const ranked = [...scored].sort(
      scored.every((candidate) => !candidate.score.effectivePersonalization)
        ? compareCommercialOrder
        : compareRankedCandidates,
    );
    const maximumResults = prepared.parameters.maximumResults;
    const returnedCandidates = maximumResults === undefined ? ranked : ranked.slice(0, maximumResults);
    for (const truncated of maximumResults === undefined ? [] : ranked.slice(maximumResults)) {
      excluded.push(exclusion(truncated.commercialRecommendation, 'RESULT_LIMIT_TRUNCATION', truncated.customerAffinity));
    }

    const recommendations: PersonalizedRecommendation[] = returnedCandidates.map((candidate, index) => ({
      product: cloneJsonValue(candidate.commercialRecommendation.product),
      personalizedScore: candidate.score.components.finalScore,
      components: cloneJsonValue(candidate.score.components),
      affinityConfidence: candidate.score.affinityConfidence,
      reasons: deepFreeze(cloneJsonValue(buildReasons(candidate))),
      commercialRecommendation: cloneJsonValue(candidate.commercialRecommendation),
      ...(candidate.customerAffinity === undefined ? {} : { customerAffinity: cloneJsonValue(candidate.customerAffinity) }),
      originalCommercialRank: candidate.commercialRecommendation.rank,
      personalizedRank: index + 1,
      warnings: deepFreeze(cloneJsonValue(candidate.warnings)),
    }));

    const allWarnings = [
      ...prepared.warnings,
      ...(prepared.context?.budget === undefined ? [] : [warning('PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED')]),
    ];
    const productWarningCount = recommendations.reduce((count, recommendation) => count + recommendation.warnings.length, 0);
    const statistics = createStatistics({
      commercialCandidatesReceived: prepared.commercialRecommendations.length,
      affinityEntriesReceived: request.customerAffinities?.affinities.length ?? 0,
      candidatesWithAffinity: prepared.commercialRecommendations.filter((recommendation) => (
        prepared.affinityByIdentity.has(createProductRuntimeIdentity(recommendation.product))
      )).length,
      affinityEntriesIgnored: prepared.ignoredAffinityEntries,
      excluded,
      recommendations,
      warningsGenerated: allWarnings.length + productWarningCount,
    });

    const result: PersonalizedRecommendationResult = {
      ...(prepared.customer === undefined ? {} : { customer: cloneJsonValue(prepared.customer) }),
      recommendations: deepFreeze(cloneJsonValue(recommendations)),
      excluded: deepFreeze(cloneJsonValue(excluded)),
      warnings: deepFreeze(cloneJsonValue(allWarnings)),
      statistics,
      scoringVersion: PERSONALIZED_RECOMMENDATION_SCORING_VERSION,
    };
    personalizedRecommendationResultSchema.parse(result);
    return deepFreeze(result);
  }

  private prepare(request: PersonalizedRecommendationRequest): PreparedInput {
    const parameters = personalizedRecommendationParametersSchema.safeParse(
      request.parameters ?? DEFAULT_PERSONALIZED_RECOMMENDATION_PARAMETERS,
    );
    if (!parameters.success) {
      throw new PersonalizedRecommendationError('INVALID_PARAMETERS', 'Personalized recommendation parameters are invalid');
    }
    if (!commercialRecommendationResultSchema.safeParse(request.commercialRecommendations).success) {
      throw new PersonalizedRecommendationError('INVALID_COMMERCIAL_RESULT', 'Commercial recommendation result is invalid');
    }
    if (request.customerAffinities !== undefined && !customerProductAffinityResultSchema.safeParse(request.customerAffinities).success) {
      throw new PersonalizedRecommendationError('INVALID_AFFINITY_RESULT', 'Customer affinity result is invalid');
    }
    if (!personalizedRecommendationRequestSchema.safeParse(request).success) {
      throw new PersonalizedRecommendationError('INVALID_REQUEST', 'Personalized recommendation request is invalid');
    }
    if (
      request.customerAffinities?.customer !== undefined &&
      request.context?.customer !== undefined &&
      request.customerAffinities.customer.customerId !== request.context.customer.customerId
    ) {
      throw new PersonalizedRecommendationError('CUSTOMER_MISMATCH', 'Personalization context customer does not match affinity customer');
    }

    const commercialRecommendations = cloneJsonValue(request.commercialRecommendations.recommendations);
    this.validateCommercialRecommendations(commercialRecommendations);
    const commercialIdentities = new Set(commercialRecommendations.map((recommendation) => createProductRuntimeIdentity(recommendation.product)));
    const warnings: PersonalizedRecommendationWarning[] = [];
    if (!request.customerAffinities) {
      warnings.push(warning('CUSTOMER_AFFINITY_UNAVAILABLE'));
      return {
        commercialRecommendations,
        affinityByIdentity: new Map(),
        ignoredAffinityEntries: 0,
        warnings,
        parameters: parameters.data,
        context: request.context === undefined ? undefined : cloneJsonValue(request.context),
      };
    }

    const affinityByIdentity = new Map<string, CustomerProductAffinity>();
    let ignoredAffinityEntries = 0;
    for (const affinity of request.customerAffinities.affinities) {
      const identity = createProductRuntimeIdentity(affinity.product);
      if (affinityByIdentity.has(identity)) {
        throw new PersonalizedRecommendationError('DUPLICATED_AFFINITY_PRODUCT', 'Affinity result contains duplicated product identities');
      }
      if (!commercialIdentities.has(identity)) {
        ignoredAffinityEntries += 1;
        warnings.push(warning('AFFINITY_FOR_UNKNOWN_PRODUCT_IGNORED', identity));
        continue;
      }
      affinityByIdentity.set(identity, cloneJsonValue(affinity));
    }
    for (const affinityWarning of request.customerAffinities.warnings) {
      warnings.push(warning(affinityWarningCode(affinityWarning.code), affinityWarning.productIdentity));
    }

    return {
      commercialRecommendations,
      affinityByIdentity,
      ignoredAffinityEntries,
      warnings,
      customer: request.customerAffinities.customer,
      parameters: parameters.data,
      context: request.context === undefined ? undefined : cloneJsonValue(request.context),
    };
  }

  private validateCommercialRecommendations(recommendations: readonly CommercialRecommendation[]): void {
    const identities = new Set<string>();
    const ranks = new Set<number>();
    for (const recommendation of recommendations) {
      const identity = createProductRuntimeIdentity(recommendation.product);
      if (identity !== recommendation.productIdentity) {
        throw new PersonalizedRecommendationError('INVALID_COMMERCIAL_RESULT', 'Commercial product identity is inconsistent');
      }
      if (createProductRuntimeIdentity(recommendation.commercialData.product) !== identity) {
        throw new PersonalizedRecommendationError('INVALID_COMMERCIAL_RESULT', 'Commercial data product identity is inconsistent');
      }
      if (identities.has(identity)) {
        throw new PersonalizedRecommendationError('DUPLICATED_COMMERCIAL_PRODUCT', 'Commercial result contains duplicated product identities');
      }
      if (ranks.has(recommendation.rank)) {
        throw new PersonalizedRecommendationError('INVALID_COMMERCIAL_RESULT', 'Commercial result contains duplicated ranks');
      }
      identities.add(identity);
      ranks.add(recommendation.rank);
    }
  }
}
