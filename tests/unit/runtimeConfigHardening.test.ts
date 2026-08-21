import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['DB_PASSWORD', 'API_KEY', 'CATALOG_API_KEYS'] as const;
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

describe('runtime config hardening', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('fails to load when DB_PASSWORD is undefined', async () => {
    const original = snapshotEnv();
    delete process.env.DB_PASSWORD;
    try {
      await expect(loadConfig()).rejects.toThrow();
    } finally {
      restoreEnv(original);
    }
  });

  it.each(['', '   '])('fails to load when DB_PASSWORD is %j', async (password) => {
    const original = snapshotEnv();
    process.env.DB_PASSWORD = password;
    try {
      await expect(loadConfig()).rejects.toThrow();
    } finally {
      restoreEnv(original);
    }
  });

  it('accepts a valid DB_PASSWORD and trims outer whitespace', async () => {
    const original = snapshotEnv();
    process.env.DB_PASSWORD = '  valid-password  ';
    try {
      const { config } = await loadConfig();
      expect(config.db.password).toBe('valid-password');
    } finally {
      restoreEnv(original);
    }
  });

  it('keeps CATALOG_API_KEYS precedence over API_KEY', async () => {
    const original = snapshotEnv();
    process.env.API_KEY = 'fallback-key';
    process.env.CATALOG_API_KEYS = 'primary-key, rotated-key';
    try {
      const { config } = await loadConfig();
      expect(config.apiKeys).toEqual(['primary-key', 'rotated-key']);
    } finally {
      restoreEnv(original);
    }
  });

  it('does not fall back to API_KEY when CATALOG_API_KEYS is present but empty', async () => {
    const original = snapshotEnv();
    process.env.API_KEY = 'fallback-key';
    process.env.CATALOG_API_KEYS = '';
    try {
      await expect(loadConfig()).rejects.toThrow(/At least one API key/);
    } finally {
      restoreEnv(original);
    }
  });
});
