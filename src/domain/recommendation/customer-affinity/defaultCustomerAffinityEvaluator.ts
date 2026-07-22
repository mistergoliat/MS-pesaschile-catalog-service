import { createProductRuntimeIdentity } from '../relationship-engine/runtime/index.js';
import {
  customerProductEvidenceSchema,
  type CustomerAffinityContext,
  type CustomerAffinityEvaluation,
  type CustomerAffinityEvaluator,
  type CustomerAffinityEvidenceSummary,
  type CustomerAffinityParameters,
  type CustomerAffinitySignal,
  type CustomerAffinitySignalCode,
  type CustomerAffinityWarning,
  type CustomerCommercialProfileEvidence,
  type CustomerProductEvidence,
  type MoneyEvidence,
} from './contracts.js';

type CountedEvidence = {
  count?: number;
  occurredAt?: string;
};

function sumCounts(values: readonly CountedEvidence[] | undefined): number {
  return (values ?? []).reduce((sum, value) => sum + (value.count ?? 1), 0);
}

function mostRecent(values: readonly CountedEvidence[] | undefined): string | undefined {
  return (values ?? [])
    .map((value) => value.occurredAt)
    .filter((value): value is string => value !== undefined)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .at(-1);
}

function inWindow(occurredAt: string | undefined, referenceTime: string | undefined, days: number): boolean {
  if (!occurredAt || !referenceTime) return false;
  const elapsedMs = Date.parse(referenceTime) - Date.parse(occurredAt);
  return elapsedMs >= 0 && elapsedMs <= days * 24 * 60 * 60 * 1000;
}

function warning(
  code: CustomerAffinityWarning['code'],
  productIdentity: string,
  details?: CustomerAffinityWarning['details'],
): CustomerAffinityWarning {
  return {
    code,
    productIdentity,
    ...(details === undefined ? {} : { details }),
  };
}

function signal(code: CustomerAffinitySignalCode, strength: number): CustomerAffinitySignal {
  return {
    code,
    direction: code === 'PRODUCT_REJECTION' || code === 'CATEGORY_REJECTION' ? 'negative' : 'positive',
    strength: Math.min(Math.max(strength, 0), 1),
  };
}

function summary(
  code: CustomerAffinitySignalCode,
  count: number,
  mostRecentAt?: string,
  details?: CustomerAffinityEvidenceSummary['details'],
): CustomerAffinityEvidenceSummary {
  return {
    code,
    count,
    ...(mostRecentAt === undefined ? {} : { mostRecentAt }),
    ...(details === undefined ? {} : { details }),
  };
}

function addSignal(signals: CustomerAffinitySignal[], next: CustomerAffinitySignal): void {
  const existing = signals.find((item) => item.code === next.code);
  if (!existing) {
    signals.push(next);
    return;
  }
  if (next.strength > existing.strength) {
    existing.strength = next.strength;
  }
}

function spendCurrency(profile: CustomerCommercialProfileEvidence): string | undefined {
  return profile.observedMaximumSpend?.currency ?? profile.observedAverageSpend?.currency ?? profile.observedMinimumSpend?.currency;
}

type SpendFitEvaluation =
  | { status: 'fit'; strength: number }
  | { status: 'profile_unavailable' }
  | { status: 'currency_mismatch' }
  | { status: 'outside_observed_range' };

function spendFitStrength(price: MoneyEvidence, profile: CustomerCommercialProfileEvidence): SpendFitEvaluation {
  const currency = spendCurrency(profile);
  if (!currency) return { status: 'profile_unavailable' };
  if (currency !== price.currency) return { status: 'currency_mismatch' };
  if (profile.observedMaximumSpend && price.amount <= profile.observedMaximumSpend.amount) return { status: 'fit', strength: 1 };
  if (profile.observedAverageSpend && price.amount <= profile.observedAverageSpend.amount) return { status: 'fit', strength: 0.8 };
  return { status: 'outside_observed_range' };
}

export class DefaultCustomerAffinityEvaluator implements CustomerAffinityEvaluator {
  evaluate(
    product: CustomerAffinityEvaluation['product'],
    evidence: CustomerProductEvidence | undefined,
    profile: CustomerCommercialProfileEvidence | undefined,
    context: CustomerAffinityContext | undefined,
    parameters: CustomerAffinityParameters,
  ): CustomerAffinityEvaluation {
    const productIdentity = createProductRuntimeIdentity(product);
    const signals: CustomerAffinitySignal[] = [];
    const summaries: CustomerAffinityEvidenceSummary[] = [];
    const warnings: CustomerAffinityWarning[] = [];

    if (!evidence) {
      warnings.push(warning('NO_CUSTOMER_HISTORY', productIdentity));
      return {
        product,
        productIdentity,
        signals,
        evidence: summaries,
        warnings,
        validEvidenceCount: 0,
      };
    }

    const parsed = customerProductEvidenceSchema.safeParse(evidence);
    if (!parsed.success) {
      warnings.push(warning('INVALID_EVIDENCE_IGNORED', productIdentity));
      return {
        product,
        productIdentity,
        signals,
        evidence: summaries,
        warnings,
        validEvidenceCount: 0,
      };
    }

    const item = parsed.data;
    const directPurchaseCount = sumCounts(item.directPurchases);
    if (directPurchaseCount > 0) {
      addSignal(signals, signal('DIRECT_PRODUCT_PURCHASE', Math.min(1, directPurchaseCount / 3)));
      summaries.push(summary('DIRECT_PRODUCT_PURCHASE', directPurchaseCount, mostRecent(item.directPurchases)));
    }

    const categoryPurchaseCount = sumCounts(item.categoryPurchases);
    if (categoryPurchaseCount > 0) {
      addSignal(signals, signal('CATEGORY_PURCHASE', Math.min(1, categoryPurchaseCount / 5)));
      summaries.push(summary('CATEGORY_PURCHASE', categoryPurchaseCount, mostRecent(item.categoryPurchases)));
    }

    const brandPurchaseCount = sumCounts(item.brandPurchases);
    if (brandPurchaseCount > 0) {
      addSignal(signals, signal('BRAND_PURCHASE', Math.min(1, brandPurchaseCount / 5)));
      summaries.push(summary('BRAND_PURCHASE', brandPurchaseCount, mostRecent(item.brandPurchases)));
    }

    const recentProductInterests = (item.productInterests ?? []).filter((interest) => (
      inWindow(interest.occurredAt, context?.referenceTime, parameters.recentInterestWindowDays)
    ));
    if ((item.productInterests?.length ?? 0) > 0 && !context?.referenceTime) {
      warnings.push(warning('REFERENCE_TIME_UNAVAILABLE', productIdentity, { signal: 'RECENT_PRODUCT_INTEREST' }));
    }
    if (recentProductInterests.length > 0) {
      const count = sumCounts(recentProductInterests);
      addSignal(signals, signal('RECENT_PRODUCT_INTEREST', Math.min(1, count / 3)));
      summaries.push(summary('RECENT_PRODUCT_INTEREST', count, mostRecent(recentProductInterests)));
    }

    const recentCategoryInterests = (item.categoryInterests ?? []).filter((interest) => (
      inWindow(interest.occurredAt, context?.referenceTime, parameters.recentInterestWindowDays)
    ));
    if ((item.categoryInterests?.length ?? 0) > 0 && !context?.referenceTime) {
      warnings.push(warning('REFERENCE_TIME_UNAVAILABLE', productIdentity, { signal: 'RECENT_CATEGORY_INTEREST' }));
    }
    if (recentCategoryInterests.length > 0) {
      const count = sumCounts(recentCategoryInterests);
      addSignal(signals, signal('RECENT_CATEGORY_INTEREST', Math.min(1, count / 3)));
      summaries.push(summary('RECENT_CATEGORY_INTEREST', count, mostRecent(recentCategoryInterests)));
    }

    const productRejections = (item.productRejections ?? []).filter((rejection) => (
      context?.referenceTime ? inWindow(rejection.occurredAt, context.referenceTime, parameters.rejectionWindowDays) : true
    ));
    if (productRejections.length > 0) {
      const count = sumCounts(productRejections);
      addSignal(signals, signal('PRODUCT_REJECTION', Math.min(1, count)));
      summaries.push(summary('PRODUCT_REJECTION', count, mostRecent(productRejections)));
    }

    const categoryRejections = (item.categoryRejections ?? []).filter((rejection) => (
      context?.referenceTime ? inWindow(rejection.occurredAt, context.referenceTime, parameters.rejectionWindowDays) : true
    ));
    if (categoryRejections.length > 0) {
      const count = sumCounts(categoryRejections);
      addSignal(signals, signal('CATEGORY_REJECTION', Math.min(1, count)));
      summaries.push(summary('CATEGORY_REJECTION', count, mostRecent(categoryRejections)));
    }

    const ownedCompatibleCount = sumCounts(item.ownedCompatibleProducts);
    if (ownedCompatibleCount > 0) {
      addSignal(signals, signal('OWNED_COMPATIBLE_PRODUCT', Math.min(1, ownedCompatibleCount / 2)));
      summaries.push(summary('OWNED_COMPATIBLE_PRODUCT', ownedCompatibleCount, mostRecent(item.ownedCompatibleProducts)));
    }

    if (item.repeatPurchasePattern && item.repeatPurchasePattern.purchaseCount >= 2) {
      addSignal(signals, signal('REPEAT_PURCHASE_PATTERN', Math.min(1, item.repeatPurchasePattern.purchaseCount / 5)));
      summaries.push(summary(
        'REPEAT_PURCHASE_PATTERN',
        item.repeatPurchasePattern.purchaseCount,
        item.repeatPurchasePattern.lastPurchasedAt,
        item.repeatPurchasePattern.medianIntervalDays === undefined
          ? undefined
          : { medianIntervalDays: item.repeatPurchasePattern.medianIntervalDays },
      ));
    }

    if (item.candidatePrice) {
      if (!profile) {
        warnings.push(warning('SPEND_PROFILE_UNAVAILABLE', productIdentity));
      } else {
        const spendFit = spendFitStrength(item.candidatePrice, profile);
        if (spendFit.status === 'profile_unavailable') {
          warnings.push(warning('SPEND_PROFILE_UNAVAILABLE', productIdentity));
        } else if (spendFit.status === 'currency_mismatch') {
          warnings.push(warning('CURRENCY_MISMATCH', productIdentity));
        } else if (spendFit.status === 'fit') {
          addSignal(signals, signal('OBSERVED_SPEND_FIT', spendFit.strength));
          summaries.push(summary('OBSERVED_SPEND_FIT', 1, undefined, { amount: item.candidatePrice.amount, currency: item.candidatePrice.currency }));
        }
      }
    }

    return {
      product,
      productIdentity,
      signals,
      evidence: summaries,
      warnings,
      validEvidenceCount: summaries.reduce((count, current) => count + current.count, 0),
    };
  }
}
