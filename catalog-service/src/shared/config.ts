import 'dotenv/config';
import { z } from 'zod';

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4010),
  LOG_LEVEL: z.string().default('info'),
  API_KEY: z.string().min(8).optional(),
  CATALOG_API_KEYS: z.string().optional(),
  PRESTASHOP_DB_PREFIX: z.string().default('ps_'),
  PRESTASHOP_SHOP_ID: z.coerce.number().int().default(1),
  PRESTASHOP_LANG_ID: z.coerce.number().int().positive().default(1),
  PRESTASHOP_CURRENCY_ID: z.coerce.number().int().nonnegative().default(1),
  PRESTASHOP_CURRENCY_CODE: z.string().default('CLP'),
  PRESTASHOP_COUNTRY_ID: z.coerce.number().int().nonnegative().default(0),
  PRESTASHOP_CUSTOMER_GROUP_ID: z.coerce.number().int().nonnegative().default(0),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(3000),
  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().optional().or(z.literal('')),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
  PRODUCT_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
  PRICE_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  STOCK_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(15),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(262144),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  ENABLE_METRICS: z.string().optional(),
  METRICS_REQUIRE_API_KEY: z.string().optional(),
  TAX_RATE: z.coerce.number().min(0).max(1).default(0.19),
  ENABLE_DOCS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

const raw = parsed.data;
const apiKeys = (raw.CATALOG_API_KEYS ?? raw.API_KEY ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (apiKeys.length === 0) {
  throw new Error('At least one API key must be configured through API_KEY or CATALOG_API_KEYS');
}

if (raw.PRESTASHOP_SHOP_ID !== 1) {
  throw new Error('PRESTASHOP_SHOP_ID must be 1 for this service');
}

const prefixPattern = /^[A-Za-z0-9_]+$/;
if (!prefixPattern.test(raw.PRESTASHOP_DB_PREFIX) || !raw.PRESTASHOP_DB_PREFIX.endsWith('_')) {
  throw new Error('PRESTASHOP_DB_PREFIX must contain only alphanumerics/underscores and end with "_"');
}

if (raw.CACHE_DRIVER === 'redis' && !raw.REDIS_URL) {
  throw new Error('REDIS_URL is required when CACHE_DRIVER=redis');
}

export const config = {
  env: raw.NODE_ENV,
  host: raw.HOST,
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  apiKeys,
  prestashop: {
    prefix: raw.PRESTASHOP_DB_PREFIX,
    shopId: raw.PRESTASHOP_SHOP_ID,
    langId: raw.PRESTASHOP_LANG_ID,
    currencyId: raw.PRESTASHOP_CURRENCY_ID,
    currencyCode: raw.PRESTASHOP_CURRENCY_CODE,
    countryId: raw.PRESTASHOP_COUNTRY_ID,
    customerGroupId: raw.PRESTASHOP_CUSTOMER_GROUP_ID,
  },
  db: {
    host: raw.DB_HOST,
    port: raw.DB_PORT,
    user: raw.DB_USER,
    password: raw.DB_PASSWORD,
    database: raw.DB_NAME,
    connectionLimit: raw.DB_CONNECTION_LIMIT,
    queryTimeoutMs: raw.DB_QUERY_TIMEOUT_MS,
  },
  cache: {
    driver: raw.CACHE_DRIVER,
    redisUrl: raw.REDIS_URL || null,
    searchTtlSeconds: raw.SEARCH_CACHE_TTL_SECONDS,
    productTtlSeconds: raw.PRODUCT_CACHE_TTL_SECONDS,
    priceTtlSeconds: raw.PRICE_CACHE_TTL_SECONDS,
    stockTtlSeconds: raw.STOCK_CACHE_TTL_SECONDS,
  },
  limits: {
    bodyLimitBytes: raw.BODY_LIMIT_BYTES,
    rateLimitMax: raw.RATE_LIMIT_MAX,
    rateLimitTimeWindowMs: raw.RATE_LIMIT_TIME_WINDOW_MS,
  },
  observability: {
    enableMetrics: parseBoolean(raw.ENABLE_METRICS, true),
    metricsRequireApiKey: parseBoolean(raw.METRICS_REQUIRE_API_KEY, true),
    enableDocs: parseBoolean(raw.ENABLE_DOCS, true),
  },
  pricing: {
    taxRate: raw.TAX_RATE,
  },
} as const;
