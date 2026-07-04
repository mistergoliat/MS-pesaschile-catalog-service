export type CacheProvider = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  ping(): Promise<boolean>;
};

export type CacheStats = {
  hits: number;
  misses: number;
};
