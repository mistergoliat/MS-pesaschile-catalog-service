export type RuntimeReadinessChecks = {
  database: 'ok' | 'unavailable';
  redis: 'ok' | 'unavailable';
  relationshipSnapshot: 'ok' | 'unavailable';
};

type RepositoryLike = {
  ping(): Promise<void>;
};

type CacheLike = {
  ping(): Promise<boolean>;
};

type RelationshipSnapshotReaderLike = {
  getStatus(): { state: 'ready' | 'not_loaded' };
};

export async function collectRuntimeReadinessChecks(input: {
  repository: RepositoryLike;
  cache: CacheLike;
  cacheDriver: 'memory' | 'redis';
  relationshipSnapshotReader: RelationshipSnapshotReaderLike;
}): Promise<RuntimeReadinessChecks> {
  const [databaseResult, redisResult] = await Promise.allSettled([
    input.repository.ping(),
    input.cacheDriver === 'redis' ? input.cache.ping() : Promise.resolve(true),
  ]);

  return {
    database: databaseResult.status === 'fulfilled' ? 'ok' : 'unavailable',
    redis: input.cacheDriver === 'redis' && (redisResult.status !== 'fulfilled' || !redisResult.value)
      ? 'unavailable'
      : 'ok',
    relationshipSnapshot: input.relationshipSnapshotReader.getStatus().state === 'ready' ? 'ok' : 'unavailable',
  };
}
