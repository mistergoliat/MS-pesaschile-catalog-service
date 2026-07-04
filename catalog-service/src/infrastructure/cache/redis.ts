import type { CacheProvider } from './types.js';

export type RedisClientLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<'OK'>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
};

export class RedisCacheProvider implements CacheProvider {
  constructor(private readonly client: RedisClientLike) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
