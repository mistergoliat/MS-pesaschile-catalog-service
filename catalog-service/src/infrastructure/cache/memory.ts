import type { CacheProvider } from './types.js';

type Entry = {
  value: unknown;
  expiresAt: number;
};

export class MemoryCacheProvider implements CacheProvider {
  private readonly values = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.values.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.values.clear();
  }
}
