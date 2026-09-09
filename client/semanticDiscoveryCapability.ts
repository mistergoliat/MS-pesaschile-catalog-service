import {
  batchGetProducts,
  CatalogClientError,
  getProductSemanticsRegistry,
  getTrainingSemanticRegistry,
  querySemanticDiscovery,
  type CatalogClientContext,
} from './catalogClient.js';
import type { BatchGetProductsResult } from './types.js';
import {
  semanticDiscoveryAxes,
  semanticDiscoveryIntentRequirementSchema,
  semanticDiscoveryIntentSchema,
  semanticDiscoveryProductAxes,
  semanticDiscoveryProductRegistrySchema,
  semanticDiscoveryTrainingAxes,
  semanticDiscoveryTrainingRegistrySchema,
  type SemanticDiscoveryCatalogResponse,
  type SemanticDiscoveryCapabilityResult,
  type SemanticDiscoveryCapabilityResultItem,
  type SemanticDiscoveryIntent,
  type SemanticDiscoveryIntentInput,
  type SemanticDiscoveryProductRegistry,
  type SemanticDiscoveryRegistry,
  type SemanticDiscoveryTrainingRegistry,
} from './semanticDiscoveryContracts.js';

export const SEARCH_PRODUCTS_BY_SEMANTICS = 'search_products_by_semantics' as const;

export type SemanticDiscoveryCapabilityErrorCategory =
  | 'input_error'
  | 'snapshot_mismatch'
  | 'temporarily_unavailable'
  | 'unauthorized'
  | 'rate_limited'
  | 'registry_sync_failure'
  | 'invalid_response'
  | 'upstream_failure';

export type SemanticDiscoveryCapabilityErrorCode =
  | 'CAPABILITY_INPUT_ERROR'
  | 'SEMANTIC_VERSION_MISMATCH'
  | 'CAPABILITY_TEMPORARILY_UNAVAILABLE'
  | 'CAPABILITY_UNAUTHORIZED'
  | 'CAPABILITY_RATE_LIMITED'
  | 'CAPABILITY_REGISTRY_SYNC_FAILED'
  | 'CAPABILITY_INVALID_RESPONSE'
  | 'CAPABILITY_UPSTREAM_FAILURE';

export class SemanticDiscoveryCapabilityError extends Error {
  readonly name = 'SemanticDiscoveryCapabilityError';

  constructor(
    message: string,
    public readonly category: SemanticDiscoveryCapabilityErrorCategory,
    public readonly retryable: boolean,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  get code(): SemanticDiscoveryCapabilityErrorCode {
    switch (this.category) {
      case 'input_error': return 'CAPABILITY_INPUT_ERROR';
      case 'snapshot_mismatch': return 'SEMANTIC_VERSION_MISMATCH';
      case 'temporarily_unavailable': return 'CAPABILITY_TEMPORARILY_UNAVAILABLE';
      case 'unauthorized': return 'CAPABILITY_UNAUTHORIZED';
      case 'rate_limited': return 'CAPABILITY_RATE_LIMITED';
      case 'registry_sync_failure': return 'CAPABILITY_REGISTRY_SYNC_FAILED';
      case 'invalid_response': return 'CAPABILITY_INVALID_RESPONSE';
      case 'upstream_failure': return 'CAPABILITY_UPSTREAM_FAILURE';
    }
  }
}

export type SemanticDiscoveryCapabilityLogger = {
  info?(event: string, fields: Readonly<Record<string, unknown>>): void;
  error?(event: string, fields: Readonly<Record<string, unknown>>): void;
};

export type SemanticDiscoveryCapabilityOptions = {
  /** A registry previously obtained from Catalog. Useful for boot-time sync. */
  readonly registry?: SemanticDiscoveryRegistry;
  /** Pin source snapshot ids between calls made by this capability instance. */
  readonly pinLineage?: boolean;
  readonly logger?: SemanticDiscoveryCapabilityLogger;
};

export type SemanticDiscoveryCapabilityPort = {
  readonly name: typeof SEARCH_PRODUCTS_BY_SEMANTICS;
  execute(input: SemanticDiscoveryIntentInput): Promise<SemanticDiscoveryCapabilityResult>;
  refreshRegistry(): Promise<SemanticDiscoveryRegistry>;
};

type RegistryIndexes = {
  readonly productCodes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly trainingCodes: ReadonlyMap<string, ReadonlySet<string>>;
};

type SnapshotPins = {
  readonly productSemanticSnapshotId?: string;
  readonly trainingSemanticSnapshotId?: string;
};

const productAxisSet = new Set<string>(semanticDiscoveryProductAxes);
const trainingAxisSet = new Set<string>(semanticDiscoveryTrainingAxes);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function mapCodes(
  entries: ReadonlyArray<{ readonly axis: string; readonly codes: readonly string[] }>,
  source: 'product' | 'training',
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, ReadonlySet<string>>();
  for (const entry of entries) {
    if (map.has(entry.axis)) {
      throw new SemanticDiscoveryCapabilityError(
        `${source} semantic registry contains duplicate axis ${entry.axis}`,
        'registry_sync_failure',
        false,
      );
    }
    const codes = unique(entry.codes);
    if (codes.length !== entry.codes.length) {
      throw new SemanticDiscoveryCapabilityError(
        `${source} semantic registry contains duplicate codes for ${entry.axis}`,
        'registry_sync_failure',
        false,
      );
    }
    map.set(entry.axis, new Set(codes));
  }
  return map;
}

function validateProductRegistry(registry: SemanticDiscoveryProductRegistry): ReadonlyMap<string, ReadonlySet<string>> {
  const expected = new Set<string>(semanticDiscoveryProductAxes);
  if (registry.axes.length !== expected.size || registry.axes.some((entry) => !expected.has(entry.axis))) {
    throw new SemanticDiscoveryCapabilityError(
      'Catalog Product Semantic Registry does not expose the required axes',
      'registry_sync_failure',
      false,
    );
  }
  return mapCodes(registry.axes.map((entry) => ({ axis: entry.axis, codes: entry.values.map((value) => value.code) })), 'product');
}

function validateTrainingRegistry(registry: SemanticDiscoveryTrainingRegistry): ReadonlyMap<string, ReadonlySet<string>> {
  const entries = [
    { axis: 'EXERCISE_CAPABILITY', codes: registry.exerciseCapabilities.map((definition) => definition.code) },
    { axis: 'TRAINING_FUNCTION', codes: registry.trainingFunctions.map((definition) => definition.code) },
    { axis: 'BODY_REGION', codes: registry.bodyRegions },
    { axis: 'MUSCLE_GROUP', codes: registry.muscleGroups },
    { axis: 'TRAINING_PATTERN', codes: registry.trainingPatterns },
  ] as const;
  return mapCodes(entries, 'training');
}

function indexesFor(registry: SemanticDiscoveryRegistry): RegistryIndexes {
  return {
    productCodes: validateProductRegistry(registry.product),
    trainingCodes: validateTrainingRegistry(registry.training),
  };
}

function normalizeRegistry(
  product: unknown,
  training: unknown,
): SemanticDiscoveryRegistry {
  const productRegistry = semanticDiscoveryProductRegistrySchema.parse(product);
  const trainingRegistry = semanticDiscoveryTrainingRegistrySchema.parse(training);
  const registry = { product: productRegistry, training: trainingRegistry };
  indexesFor(registry);
  return registry;
}

export async function getSemanticDiscoveryRegistry(
  context: CatalogClientContext,
): Promise<SemanticDiscoveryRegistry> {
  try {
    const [product, training] = await Promise.all([
      getProductSemanticsRegistry(context),
      getTrainingSemanticRegistry(context),
    ]);
    return normalizeRegistry(product, training);
  } catch (error) {
    throw mapCapabilityError(error, true);
  }
}

function inputError(message: string, details?: unknown): SemanticDiscoveryCapabilityError {
  return new SemanticDiscoveryCapabilityError(message, 'input_error', false, undefined, details);
}

function validateIntent(rawInput: unknown): SemanticDiscoveryIntent {
  const parsed = semanticDiscoveryIntentSchema.safeParse(rawInput);
  if (!parsed.success) throw inputError('Invalid semantic discovery capability input', parsed.error.flatten());

  const seenRequirements = new Set<string>();
  for (const requirement of parsed.data.requirements) {
    if (new Set(requirement.codes).size !== requirement.codes.length) {
      throw inputError('Semantic requirement codes must be unique');
    }
    if (requirement.relations && new Set(requirement.relations).size !== requirement.relations.length) {
      throw inputError('Semantic requirement relations must be unique');
    }
    if (productAxisSet.has(requirement.axis) && requirement.relations) {
      throw inputError(`Relations are not supported for axis ${requirement.axis}`);
    }
    const allowedRelations = requirement.axis === 'TRAINING_FUNCTION'
      ? new Set(['DIRECT', 'FAMILY_DERIVED'])
      : new Set(['DIRECT', 'SUPPORTED']);
    for (const relation of requirement.relations ?? []) {
      if (!allowedRelations.has(relation)) {
        throw inputError(`Relation ${relation} is not valid for axis ${requirement.axis}`);
      }
    }
    const signature = JSON.stringify({
      axis: requirement.axis,
      codes: [...requirement.codes].sort(),
      mode: requirement.mode,
      match: requirement.match,
      relations: [...(requirement.relations ?? [])].sort(),
    });
    if (seenRequirements.has(signature)) throw inputError('Duplicate semantic discovery requirement');
    seenRequirements.add(signature);
  }
  return parsed.data;
}

function validateCodes(intent: SemanticDiscoveryIntent, indexes: RegistryIndexes): void {
  for (const requirement of intent.requirements) {
    const allowed = productAxisSet.has(requirement.axis)
      ? indexes.productCodes.get(requirement.axis)
      : indexes.trainingCodes.get(requirement.axis);
    if (!allowed) {
      throw new SemanticDiscoveryCapabilityError(
        `Semantic registry is missing axis ${requirement.axis}`,
        'registry_sync_failure',
        false,
      );
    }
    for (const code of requirement.codes) {
      if (!allowed.has(code)) throw inputError(`Unknown canonical code ${code} for axis ${requirement.axis}`);
    }
  }
}

function pinsFor(
  lineage: SemanticDiscoveryCatalogResponse['lineage'] | null,
  intent: SemanticDiscoveryIntent,
): SnapshotPins {
  const usesProduct = intent.requirements.some((requirement) => productAxisSet.has(requirement.axis));
  const usesTraining = intent.requirements.some((requirement) => trainingAxisSet.has(requirement.axis));
  return {
    ...(usesProduct && lineage?.productSemantics ? { productSemanticSnapshotId: lineage.productSemantics.snapshotId } : {}),
    ...(usesTraining && lineage?.trainingSemantics ? { trainingSemanticSnapshotId: lineage.trainingSemantics.snapshotId } : {}),
  };
}

function compactProductTag(tag: NonNullable<NonNullable<SemanticDiscoveryCatalogResponse['results'][number]['productSemantics']>['primaryProductFamily']>) {
  return { code: tag.code, confidence: tag.confidence };
}

function compactResult(result: SemanticDiscoveryCatalogResponse['results'][number]): SemanticDiscoveryCapabilityResultItem {
  return {
    productId: result.productId,
    matchedRequirements: result.matchedRequirements,
    productSemantics: result.productSemantics ? {
      classificationStatus: result.productSemantics.classificationStatus,
      primaryProductFamily: result.productSemantics.primaryProductFamily ? compactProductTag(result.productSemantics.primaryProductFamily) : null,
      secondaryProductFamilies: result.productSemantics.secondaryProductFamilies.map(compactProductTag),
      disciplines: result.productSemantics.disciplines.map(compactProductTag),
      useContexts: result.productSemantics.useContexts.map(compactProductTag),
    } : null,
    trainingSemantics: result.trainingSemantics ? {
      resolutionState: result.trainingSemantics.resolutionState,
      coverageStatus: result.trainingSemantics.coverageStatus,
      exerciseCapabilities: result.trainingSemantics.exerciseCapabilities.map(({ code, relationType, classificationConfidence }) => ({ code, relationType, classificationConfidence })),
      trainingFunctions: result.trainingSemantics.trainingFunctions.map(({ code, relationType }) => ({ code, relationType })),
      derived: result.trainingSemantics.derived,
    } : null,
  };
}

function compactResponse(response: SemanticDiscoveryCatalogResponse): SemanticDiscoveryCapabilityResult {
  return {
    results: response.results.map(compactResult),
    totalMatches: response.totalMatches,
    truncated: response.truncated,
    lineage: response.lineage,
  };
}

function mapCapabilityError(error: unknown, registryOperation = false): SemanticDiscoveryCapabilityError {
  if (error instanceof SemanticDiscoveryCapabilityError) return error;
  if (!(error instanceof CatalogClientError)) {
    return new SemanticDiscoveryCapabilityError(
      registryOperation ? 'Semantic registry is unavailable' : 'Semantic discovery capability failed',
      registryOperation ? 'registry_sync_failure' : 'upstream_failure',
      false,
    );
  }

  if (error.code === 'INVALID_RESPONSE') {
    return new SemanticDiscoveryCapabilityError(
      registryOperation ? 'Semantic registry response is incompatible' : 'Semantic discovery response is incompatible',
      registryOperation ? 'registry_sync_failure' : 'invalid_response',
      false,
      error.correlationId,
    );
  }
  if (error.statusCode === 400 || error.code === 'INVALID_SEMANTIC_DISCOVERY_REQUEST') {
    return new SemanticDiscoveryCapabilityError('Catalog rejected the semantic capability input', 'input_error', false, error.correlationId);
  }
  if (error.statusCode === 409 || error.code.endsWith('SNAPSHOT_MISMATCH')) {
    return new SemanticDiscoveryCapabilityError('Semantic Product Truth changed during capability execution', 'snapshot_mismatch', true, error.correlationId);
  }
  if (error.statusCode === 401 || error.statusCode === 403) {
    return new SemanticDiscoveryCapabilityError('Catalog capability authentication failed', 'unauthorized', false, error.correlationId);
  }
  if (error.statusCode === 429) {
    return new SemanticDiscoveryCapabilityError('Catalog capability rate limit exceeded', 'rate_limited', true, error.correlationId);
  }
  if (error.statusCode === 408 || error.statusCode >= 500) {
    return new SemanticDiscoveryCapabilityError('Catalog semantic discovery is temporarily unavailable', 'temporarily_unavailable', true, error.correlationId);
  }
  return new SemanticDiscoveryCapabilityError('Catalog semantic discovery failed', 'upstream_failure', false, error.correlationId);
}

function logFields(intent: SemanticDiscoveryIntent, result: SemanticDiscoveryCapabilityResult): Record<string, unknown> {
  return {
    capability: SEARCH_PRODUCTS_BY_SEMANTICS,
    axes: unique(intent.requirements.map((requirement) => requirement.axis)),
    requiredCount: intent.requirements.filter((requirement) => requirement.mode === 'required').length,
    preferredCount: intent.requirements.filter((requirement) => requirement.mode === 'preferred').length,
    resultCount: result.results.length,
    totalMatches: result.totalMatches,
    truncated: result.truncated,
    lineage: result.lineage,
  };
}

class DefaultSemanticDiscoveryCapability implements SemanticDiscoveryCapabilityPort {
  readonly name = SEARCH_PRODUCTS_BY_SEMANTICS;
  private productRegistry: SemanticDiscoveryProductRegistry | null;
  private trainingRegistry: SemanticDiscoveryTrainingRegistry | null;
  private pinnedLineage: SemanticDiscoveryCatalogResponse['lineage'] | null = null;

  constructor(
    private readonly context: CatalogClientContext,
    private readonly options: SemanticDiscoveryCapabilityOptions,
  ) {
    this.productRegistry = options.registry?.product ?? null;
    this.trainingRegistry = options.registry?.training ?? null;
    if (options.registry) indexesFor(options.registry);
  }

  async refreshRegistry(): Promise<SemanticDiscoveryRegistry> {
    const registry = await getSemanticDiscoveryRegistry(this.context);
    this.productRegistry = registry.product;
    this.trainingRegistry = registry.training;
    return registry;
  }

  private async ensureRegistry(intent: SemanticDiscoveryIntent): Promise<RegistryIndexes> {
    const usesProduct = intent.requirements.some((requirement) => productAxisSet.has(requirement.axis));
    const usesTraining = intent.requirements.some((requirement) => trainingAxisSet.has(requirement.axis));
    try {
      if (usesProduct && !this.productRegistry) {
        this.productRegistry = semanticDiscoveryProductRegistrySchema.parse(await getProductSemanticsRegistry(this.context));
      }
      if (usesTraining && !this.trainingRegistry) {
        this.trainingRegistry = semanticDiscoveryTrainingRegistrySchema.parse(await getTrainingSemanticRegistry(this.context));
      }
      const indexes: RegistryIndexes = {
        productCodes: this.productRegistry ? validateProductRegistry(this.productRegistry) : new Map(),
        trainingCodes: this.trainingRegistry ? validateTrainingRegistry(this.trainingRegistry) : new Map(),
      };
      validateCodes(intent, indexes);
      return indexes;
    } catch (error) {
      throw mapCapabilityError(error, true);
    }
  }

  async execute(rawInput: SemanticDiscoveryIntentInput): Promise<SemanticDiscoveryCapabilityResult> {
    const startedAt = process.hrtime.bigint();
    let intent: SemanticDiscoveryIntent;
    try {
      intent = validateIntent(rawInput);
      await this.ensureRegistry(intent);
    } catch (error) {
      const mapped = mapCapabilityError(error);
      this.options.logger?.error?.('semantic_discovery_capability_failed', {
        capability: SEARCH_PRODUCTS_BY_SEMANTICS,
        errorCategory: mapped.category,
        retryable: mapped.retryable,
      });
      throw mapped;
    }

    const pins = this.options.pinLineage ? pinsFor(this.pinnedLineage, intent) : {};
    const request = {
      schemaVersion: 1 as const,
      requirements: intent.requirements,
      options: { limit: intent.limit },
      ...(Object.keys(pins).length > 0 ? { expectedSnapshots: pins } : {}),
    };
    let mismatchRetried = false;
    while (true) {
      try {
        const response = await querySemanticDiscovery(request, this.context);
        if (this.options.pinLineage) this.pinnedLineage = response.lineage;
        const result = compactResponse(response);
        this.options.logger?.info?.('semantic_discovery_capability_completed', {
          ...logFields(intent, result),
          latencyMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        });
        return result;
      } catch (error) {
        const mapped = mapCapabilityError(error);
        if (mapped.category === 'snapshot_mismatch' && this.options.pinLineage && !mismatchRetried) {
          this.pinnedLineage = null;
          mismatchRetried = true;
          continue;
        }
        this.options.logger?.error?.('semantic_discovery_capability_failed', {
          capability: SEARCH_PRODUCTS_BY_SEMANTICS,
          axes: unique(intent.requirements.map((requirement) => requirement.axis)),
          errorCategory: mapped.category,
          retryable: mapped.retryable,
          latencyMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        });
        throw mapped;
      }
    }
  }
}

export function createSemanticDiscoveryCapability(
  context: CatalogClientContext,
  options: SemanticDiscoveryCapabilityOptions = {},
): SemanticDiscoveryCapabilityPort {
  return new DefaultSemanticDiscoveryCapability(context, options);
}

export async function searchProductsBySemantics(
  input: SemanticDiscoveryIntentInput,
  context: CatalogClientContext,
  options: SemanticDiscoveryCapabilityOptions = {},
): Promise<SemanticDiscoveryCapabilityResult> {
  return createSemanticDiscoveryCapability(context, options).execute(input);
}

export type SemanticDiscoveryHydratedResult = {
  readonly semanticDiscovery: SemanticDiscoveryCapabilityResult;
  readonly productDetails: BatchGetProductsResult;
};

/**
 * Explicit two-stage orchestration. Semantic eligibility is completed first;
 * commercial details are then hydrated through the existing batch capability.
 */
export async function searchProductsBySemanticsWithDetails(
  input: SemanticDiscoveryIntentInput,
  context: CatalogClientContext,
  options: SemanticDiscoveryCapabilityOptions = {},
): Promise<SemanticDiscoveryHydratedResult> {
  const semanticDiscovery = await searchProductsBySemantics(input, context, options);
  const ids = semanticDiscovery.results.map((result) => result.productId);
  if (ids.length === 0) return { semanticDiscovery, productDetails: { items: [] } };

  const items: BatchGetProductsResult['items'][number][] = [];
  for (let offset = 0; offset < ids.length; offset += 20) {
    const chunk = ids.slice(offset, offset + 20).map((productId) => ({ productId }));
    const hydrated = await batchGetProducts({ items: chunk }, context);
    items.push(...hydrated.items);
  }
  return { semanticDiscovery, productDetails: { items } };
}

export const searchProductsBySemanticsToolDefinition = {
  name: SEARCH_PRODUCTS_BY_SEMANTICS,
  description: 'Finds products using canonical Product and Training Semantic constraints. Returns semantic eligibility only; use the product detail capability for price, stock, and other commercial fields.',
  inputSchema: {
    type: 'object',
    properties: {
      requirements: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            axis: { type: 'string', enum: [...semanticDiscoveryAxes] },
            codes: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string', minLength: 1 } },
            mode: { type: 'string', enum: ['required', 'preferred'] },
            match: { type: 'string', enum: ['any', 'all'] },
            relations: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: ['DIRECT', 'SUPPORTED', 'FAMILY_DERIVED'] } },
          },
          required: ['axis', 'codes', 'mode', 'match'],
          additionalProperties: false,
        },
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
    required: ['requirements'],
    additionalProperties: false,
  },
} as const;

export const semanticDiscoveryToolDefinition = searchProductsBySemanticsToolDefinition;

// Keep the contract schema available to tool registries that use Zod rather
// than JSON Schema. It does not include HTTP-only fields or snapshot pins.
export { semanticDiscoveryIntentRequirementSchema, semanticDiscoveryIntentSchema };
