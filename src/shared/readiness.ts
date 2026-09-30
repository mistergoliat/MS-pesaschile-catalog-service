export type CapabilityState = 'ok' | 'unavailable';

/**
 * J1D-CAT-05: readiness is commercial truth. The database (and Redis when it
 * is the configured cache of the v1 commercial path) gate readiness; the
 * optional intelligence snapshots are reported per capability and NEVER take
 * /v2/catalog/* (or v1) out of rotation.
 */
export type RuntimeReadinessChecks = {
  database: CapabilityState;
  redis: CapabilityState;
  relationshipSnapshot: CapabilityState;
  capabilities: {
    commercialTruth: CapabilityState;
    relationships: CapabilityState;
    productSemantics: CapabilityState;
    trainingSemantics: CapabilityState;
  };
};

type RepositoryLike = {
  ping(): Promise<void>;
};

type CacheLike = {
  ping(): Promise<boolean>;
};

type SnapshotStatusReaderLike = {
  getStatus(): { state: 'ready' | 'not_loaded' };
};

type TrainingSemanticSnapshotReaderLike = {
  getMetadata(): unknown;
};

export async function collectRuntimeReadinessChecks(input: {
  repository: RepositoryLike;
  cache: CacheLike;
  cacheDriver: 'memory' | 'redis';
  relationshipSnapshotReader: SnapshotStatusReaderLike;
  productSemanticSnapshotReader?: SnapshotStatusReaderLike;
  trainingSemanticSnapshotReader?: TrainingSemanticSnapshotReaderLike;
}): Promise<RuntimeReadinessChecks> {
  const [databaseResult, redisResult] = await Promise.allSettled([
    input.repository.ping(),
    input.cacheDriver === 'redis' ? input.cache.ping() : Promise.resolve(true),
  ]);

  const database: CapabilityState = databaseResult.status === 'fulfilled' ? 'ok' : 'unavailable';
  const redis: CapabilityState = input.cacheDriver === 'redis' && (redisResult.status !== 'fulfilled' || !redisResult.value)
    ? 'unavailable'
    : 'ok';
  const relationshipSnapshot: CapabilityState = input.relationshipSnapshotReader.getStatus().state === 'ready' ? 'ok' : 'unavailable';
  return {
    database,
    redis,
    relationshipSnapshot,
    capabilities: {
      commercialTruth: database === 'ok' && redis === 'ok' ? 'ok' : 'unavailable',
      relationships: relationshipSnapshot,
      productSemantics: input.productSemanticSnapshotReader?.getStatus().state === 'ready' ? 'ok' : 'unavailable',
      trainingSemantics: input.trainingSemanticSnapshotReader?.getMetadata() ? 'ok' : 'unavailable',
    },
  };
}
