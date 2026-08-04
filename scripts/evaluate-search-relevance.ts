import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../src/infrastructure/database/pool.js';
import { MySqlCatalogRepository } from '../src/infrastructure/repositories/mysqlCatalogRepository.js';
import { MySqlSearchProvider } from '../src/infrastructure/search/mysqlSearchProvider.js';
import type { SearchCandidate, SearchProvider } from '../src/domain/catalog/ports.js';
import type { SearchItem, SearchMatchType } from '../src/domain/catalog/types.js';
import { isDiscoveryExcludedProductId } from '../src/domain/catalog/discoveryExclusionPolicy.js';
import {
  catalogSearchQueryVariants,
  normalizeCatalogSearchText,
  tokenizeCatalogSearchText,
} from '../src/domain/catalog/searchTextNormalization.js';
import { evaluateCatalogSearchTextRelevance } from '../src/domain/catalog/searchTextRelevance.js';
import { catalogSearchRelevanceCases, type SearchRelevanceCase } from '../tests/fixtures/catalogSearchRelevanceCases.js';

type RepositoryCallAudit = {
  readonly variant: string;
  readonly includeOutOfStock: boolean;
  readonly limit: number;
  readonly phraseMatchBranch: true;
  readonly tokenFallbackBranch: boolean;
  readonly candidateCount: number;
};

type EvaluatedResult = {
  readonly rank: number;
  readonly productId: number;
  readonly combinationId: number;
  readonly reference: string | null;
  readonly name: string;
  readonly stock: number;
  readonly matchType: SearchMatchType;
  readonly score: number;
  readonly exactPhraseInName: boolean;
  readonly nameTokenCoverage: number;
  readonly orderedTokensInName: boolean;
  readonly descriptionTokenCoverage: number;
  readonly isDefault: boolean;
  readonly tokenCoverage: {
    readonly name: number;
    readonly reference: number;
  };
};

type EvaluatedCase = SearchRelevanceCase & {
  readonly normalizedQuery: string;
  readonly tokens: readonly string[];
  readonly variants: readonly string[];
  readonly resultCount: number;
  readonly distinctScores: number;
  readonly topScoreTieCount: number;
  readonly distinctMatchTypes: number;
  readonly exactReferenceAtRank1: boolean | null;
  readonly repositoryCalls: readonly RepositoryCallAudit[];
  readonly results: readonly EvaluatedResult[];
};

type EvaluationReport = {
  readonly generatedAt: string;
  readonly mode: EvaluationMode;
  readonly limit: number;
  readonly includeOutOfStock: boolean;
  readonly queryCount: number;
  readonly resultCount: number;
  readonly technicalErrors: readonly string[];
  readonly cases: readonly EvaluatedCase[];
};

type EvaluationMode = 'current' | 'historical-ranking';

class AuditedCatalogRepository extends MySqlCatalogRepository {
  readonly calls: RepositoryCallAudit[] = [];
  readonly candidatesByKey = new Map<string, SearchCandidate>();

  resetAudit(): void {
    this.calls.length = 0;
    this.candidatesByKey.clear();
  }

  override async getSearchCandidates(query: string, includeOutOfStock: boolean, limit: number): Promise<SearchCandidate[]> {
    const candidates = await super.getSearchCandidates(query, includeOutOfStock, limit);
    for (const candidate of candidates) {
      const key = candidateKey(candidate.productId, candidate.combinationId);
      if (!this.candidatesByKey.has(key)) {
        this.candidatesByKey.set(key, candidate);
      }
    }
    this.calls.push({
      variant: query,
      includeOutOfStock,
      limit,
      phraseMatchBranch: true,
      tokenFallbackBranch: usesTokenFallback(query),
      candidateCount: candidates.length,
    });
    return candidates;
  }
}

function outputPath(): string {
  const argument = process.argv.find((item) => item.startsWith('--output='));
  return argument?.slice('--output='.length) || 'artifacts/catalog-search-relevance-baseline.json';
}

function evaluationMode(): EvaluationMode {
  const argument = process.argv.find((item) => item.startsWith('--mode='));
  const mode = argument?.slice('--mode='.length) || 'current';
  if (mode !== 'current' && mode !== 'historical-ranking') {
    throw new Error(`Unsupported evaluation mode: ${mode}`);
  }
  return mode;
}

function usesTokenFallback(query: string): boolean {
  const tokens = tokenizeCatalogSearchText(query.trim());
  const hasShortAlphabeticToken = tokens.some((token) => /^[a-z]{1,3}$/u.test(token));
  const hasCanonicalUnitToken = tokens.some((token) => /^\d+(?:\.\d+)?(?:kg|g|lb|mm|cm|m)$/u.test(token));
  return tokens.length >= 2 && (!hasShortAlphabeticToken || hasCanonicalUnitToken);
}

function candidateKey(productId: number, combinationId: number): string {
  return `${productId}:${combinationId}`;
}

function tokenCoverage(tokens: readonly string[], value: string | null): number {
  const normalized = normalizeCatalogSearchText(value ?? '');
  return tokens.filter((token) => normalized.includes(token)).length;
}

function distinct<T>(values: readonly T[]): number {
  return new Set(values).size;
}

function exactReferenceAtRank1(testCase: SearchRelevanceCase, results: readonly EvaluatedResult[]): boolean | null {
  if (testCase.intentClass !== 'reference') {
    return null;
  }
  const first = results[0];
  return first ? normalizeCatalogSearchText(first.reference ?? '') === normalizeCatalogSearchText(testCase.query) : false;
}

function containsHistoricalQuery(text: string, normalizedQuery: string, queryTokens: readonly string[]): boolean {
  return text.includes(normalizedQuery) || (queryTokens.length > 1 && queryTokens.every((token) => text.includes(token)));
}

function historicalScore(item: SearchItem, query: string): number {
  const normalized = normalizeCatalogSearchText(query);
  const queryTokens = tokenizeCatalogSearchText(query);
  const sku = item.sku ? normalizeCatalogSearchText(item.sku) : null;
  const name = normalizeCatalogSearchText(item.name);
  const shortDescription = normalizeCatalogSearchText(item.shortDescription ?? '');

  if (sku === normalized) {
    return 0;
  }
  if (name === normalized) {
    return 1;
  }
  if (containsHistoricalQuery(name, normalized, queryTokens)) {
    return 2;
  }
  if (containsHistoricalQuery(shortDescription, normalized, queryTokens)) {
    return 3;
  }
  return 4;
}

function historicalMatchType(item: SearchItem, query: string): SearchMatchType {
  const score = historicalScore(item, query);
  if (score === 0) {
    return 'exact_sku';
  }
  if (score === 1) {
    return 'exact_name';
  }
  if (score === 2) {
    return 'partial_name';
  }
  return 'description';
}

function candidateKeyFromCandidate(candidate: Pick<SearchCandidate, 'productId' | 'combinationId'>): string {
  return `${candidate.productId}:${candidate.combinationId}`;
}

class HistoricalRankingSearchProvider implements SearchProvider {
  constructor(private readonly repository: AuditedCatalogRepository) {}

  async search(query: string, limit: number, includeOutOfStock: boolean): Promise<SearchItem[]> {
    const variants = catalogSearchQueryVariants(query);
    const candidatesByKey = new Map<string, SearchCandidate>();
    for (const variant of variants) {
      const candidates = await this.repository.getSearchCandidates(variant, includeOutOfStock, limit);
      for (const candidate of candidates) {
        const key = candidateKeyFromCandidate(candidate);
        if (!candidatesByKey.has(key)) {
          candidatesByKey.set(key, candidate);
        }
      }
    }

    return [...candidatesByKey.values()]
      .filter((candidate) => !isDiscoveryExcludedProductId(candidate.productId))
      .map((candidate) => {
        const item: SearchItem = {
          productId: candidate.productId,
          combinationId: candidate.combinationId,
          sku: candidate.combinationSku ?? candidate.productSku,
          name: candidate.productName,
          variantLabel: candidate.variantLabel,
          shortDescription: candidate.shortDescription,
          physicalQuantity: candidate.physicalQuantity,
          available: candidate.physicalQuantity > 0,
          matchType: 'description',
        };
        const matchType = historicalMatchType(item, query);
        return {
          item: { ...item, matchType },
          score: historicalScore(item, query) - (candidate.isDefault ? 0.5 : 0),
        };
      })
      .sort((left, right) => left.score - right.score || left.item.name.localeCompare(right.item.name))
      .map((entry) => entry.item)
      .slice(0, limit);
  }
}

async function evaluateCase(
  testCase: SearchRelevanceCase,
  repository: AuditedCatalogRepository,
  provider: SearchProvider,
  limit: number,
  includeOutOfStock: boolean,
  mode: EvaluationMode,
): Promise<EvaluatedCase> {
  repository.resetAudit();
  const items = await provider.search(testCase.query, limit, includeOutOfStock);
  const tokens = tokenizeCatalogSearchText(testCase.query);
  const results = items.map((item, index) => {
    const candidate = repository.candidatesByKey.get(candidateKey(item.productId, item.combinationId));
    const signals = evaluateCatalogSearchTextRelevance({
      item,
      query: testCase.query,
      isDefault: candidate?.isDefault ?? false,
    });
    return {
      rank: index + 1,
      productId: item.productId,
      combinationId: item.combinationId,
      reference: item.sku,
      name: item.name,
      stock: item.physicalQuantity,
      matchType: item.matchType,
      score: mode === 'historical-ranking' ? historicalScore(item, testCase.query) : signals.score,
      exactPhraseInName: signals.exactPhraseInName,
      nameTokenCoverage: signals.nameTokenCoverage,
      orderedTokensInName: signals.orderedTokensInName,
      descriptionTokenCoverage: signals.descriptionTokenCoverage,
      isDefault: candidate?.isDefault ?? false,
      tokenCoverage: {
        name: tokenCoverage(tokens, item.name),
        reference: tokenCoverage(tokens, item.sku),
      },
    };
  });
  const scores = results.map((result) => result.score);
  const bestScore = scores.length > 0 ? Math.min(...scores) : null;

  return {
    ...testCase,
    normalizedQuery: normalizeCatalogSearchText(testCase.query),
    tokens,
    variants: catalogSearchQueryVariants(testCase.query),
    resultCount: results.length,
    distinctScores: distinct(scores),
    topScoreTieCount: bestScore === null ? 0 : scores.filter((score) => score === bestScore).length,
    distinctMatchTypes: distinct(results.map((result) => result.matchType)),
    exactReferenceAtRank1: exactReferenceAtRank1(testCase, results),
    repositoryCalls: [...repository.calls],
    results,
  };
}

async function main(): Promise<void> {
  const limit = 10;
  const includeOutOfStock = true;
  const mode = evaluationMode();
  const pool = createPool();
  const repository = new AuditedCatalogRepository(pool);
  const provider = mode === 'historical-ranking'
    ? new HistoricalRankingSearchProvider(repository)
    : new MySqlSearchProvider(repository);
  const errors: string[] = [];
  const cases: EvaluatedCase[] = [];

  try {
    for (const testCase of catalogSearchRelevanceCases) {
      try {
        cases.push(await evaluateCase(testCase, repository, provider, limit, includeOutOfStock, mode));
      } catch (error) {
        errors.push(`${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await pool.end();
  }

  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    mode,
    limit,
    includeOutOfStock,
    queryCount: catalogSearchRelevanceCases.length,
    resultCount: cases.reduce((sum, item) => sum + item.resultCount, 0),
    technicalErrors: errors,
    cases,
  };

  const target = outputPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: target,
    queryCount: report.queryCount,
    evaluatedQueries: report.cases.length,
    resultCount: report.resultCount,
    technicalErrors: report.technicalErrors.length,
  }));

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

await main();
