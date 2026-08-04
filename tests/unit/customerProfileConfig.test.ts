import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['CUSTOMER_AFFINITY_PROVIDER_MODE', 'CUSTOMER_PROFILE_BASE_URL', 'CUSTOMER_PROFILE_TIMEOUT_MS'] as const;
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

describe('config: CUSTOMER_AFFINITY_PROVIDER_MODE and CUSTOMER_PROFILE_*', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('defaults to unavailable, with a null base URL and 2500ms timeout, and does not require a base URL', async () => {
    const original = snapshotEnv();
    delete process.env.CUSTOMER_AFFINITY_PROVIDER_MODE;
    delete process.env.CUSTOMER_PROFILE_BASE_URL;
    delete process.env.CUSTOMER_PROFILE_TIMEOUT_MS;
    try {
      const { config } = await loadConfig();
      expect(config.recommendation.customerAffinityProviderMode).toBe('unavailable');
      expect(config.recommendation.customerProfile.baseUrl).toBeNull();
      expect(config.recommendation.customerProfile.timeoutMs).toBe(2500);
    } finally {
      restoreEnv(original);
    }
  });

  it('mode=empty does not require a base URL', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'empty';
    delete process.env.CUSTOMER_PROFILE_BASE_URL;
    try {
      const { config } = await loadConfig();
      expect(config.recommendation.customerAffinityProviderMode).toBe('empty');
      expect(config.recommendation.customerProfile.baseUrl).toBeNull();
    } finally {
      restoreEnv(original);
    }
  });

  it('mode=unavailable does not require a base URL', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'unavailable';
    delete process.env.CUSTOMER_PROFILE_BASE_URL;
    try {
      const { config } = await loadConfig();
      expect(config.recommendation.customerAffinityProviderMode).toBe('unavailable');
      expect(config.recommendation.customerProfile.baseUrl).toBeNull();
    } finally {
      restoreEnv(original);
    }
  });

  it('accepts a valid mode=http configuration and normalizes a trailing slash', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'http://customer-profile.internal:4020/';
    process.env.CUSTOMER_PROFILE_TIMEOUT_MS = '3000';
    try {
      const { config } = await loadConfig();
      expect(config.recommendation.customerAffinityProviderMode).toBe('http');
      expect(config.recommendation.customerProfile.baseUrl).toBe('http://customer-profile.internal:4020');
      expect(config.recommendation.customerProfile.timeoutMs).toBe(3000);
    } finally {
      restoreEnv(original);
    }
  });

  it('accepts https base URLs', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'https://customer-profile.internal';
    try {
      const { config } = await loadConfig();
      expect(config.recommendation.customerProfile.baseUrl).toBe('https://customer-profile.internal');
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when mode=http and the base URL is missing', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    delete process.env.CUSTOMER_PROFILE_BASE_URL;
    try {
      await expect(loadConfig()).rejects.toThrow(/CUSTOMER_PROFILE_BASE_URL/);
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when mode=http and the base URL is not a valid absolute URL', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'not-a-url';
    try {
      await expect(loadConfig()).rejects.toThrow();
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when the base URL protocol is neither http nor https', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'ftp://customer-profile.internal';
    try {
      await expect(loadConfig()).rejects.toThrow(/http or https/);
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when the base URL contains embedded credentials', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'http://user:pass@customer-profile.internal';
    try {
      await expect(loadConfig()).rejects.toThrow(/embedded credentials/);
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when the base URL contains a query string', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'http://customer-profile.internal/?debug=1';
    try {
      await expect(loadConfig()).rejects.toThrow(/query string/);
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when the base URL contains a fragment', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'http://customer-profile.internal/#test';
    try {
      await expect(loadConfig()).rejects.toThrow(/fragment/);
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when the timeout is zero, negative, or not an integer', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'http://customer-profile.internal';
    try {
      process.env.CUSTOMER_PROFILE_TIMEOUT_MS = '0';
      await expect(loadConfig()).rejects.toThrow();
      process.env.CUSTOMER_PROFILE_TIMEOUT_MS = '-100';
      await expect(loadConfig()).rejects.toThrow();
      process.env.CUSTOMER_PROFILE_TIMEOUT_MS = '12.5';
      await expect(loadConfig()).rejects.toThrow();
    } finally {
      restoreEnv(original);
    }
  });

  it('fails to load when the timeout exceeds the reasonable upper bound', async () => {
    const original = snapshotEnv();
    process.env.CUSTOMER_AFFINITY_PROVIDER_MODE = 'http';
    process.env.CUSTOMER_PROFILE_BASE_URL = 'http://customer-profile.internal';
    process.env.CUSTOMER_PROFILE_TIMEOUT_MS = '999999';
    try {
      await expect(loadConfig()).rejects.toThrow();
    } finally {
      restoreEnv(original);
    }
  });
});
