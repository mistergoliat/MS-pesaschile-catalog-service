import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['NODE_ENV', 'CATALOG_SERVICE_BUILD_REF'] as const;
type EnvKey = (typeof ENV_KEYS)[number];

function snapshotEnv(): Partial<Record<EnvKey, string | undefined>> {
  const snapshot: Partial<Record<EnvKey, string | undefined>> = {};
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Partial<Record<EnvKey, string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function loadConfig() {
  vi.resetModules();
  return import('../../src/shared/config.js');
}

describe('catalog service build reference configuration', () => {
  afterEach(() => vi.resetModules());

  it('allows the explicit local reference outside production', async () => {
    const original = snapshotEnv();
    process.env.NODE_ENV = 'development';
    delete process.env.CATALOG_SERVICE_BUILD_REF;
    try {
      const { config } = await loadConfig();
      expect(config.build.serviceBuildRef).toBe('catalog-service@local');
    } finally {
      restoreEnv(original);
    }
  });

  it('requires a build reference in production', async () => {
    const original = snapshotEnv();
    process.env.NODE_ENV = 'production';
    delete process.env.CATALOG_SERVICE_BUILD_REF;
    try {
      await expect(loadConfig()).rejects.toThrow('CATALOG_SERVICE_BUILD_REF is required when NODE_ENV=production');
    } finally {
      restoreEnv(original);
    }
  });

  it('uses the exact injected build reference in production', async () => {
    const original = snapshotEnv();
    process.env.NODE_ENV = 'production';
    process.env.CATALOG_SERVICE_BUILD_REF = 'catalog-service@abc123';
    try {
      const { config } = await loadConfig();
      expect(config.build.serviceBuildRef).toBe('catalog-service@abc123');
    } finally {
      restoreEnv(original);
    }
  });
});
