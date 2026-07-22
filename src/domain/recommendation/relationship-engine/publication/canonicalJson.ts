import type { JsonValue } from './contracts.js';

function isSerializableRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function fail(message: string): never {
  throw new TypeError(message);
}

export function canonicalizeJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('Cannot canonicalize non-finite number');
    }
    return JSON.stringify(value);
  }
  if (value === undefined) {
    fail('Cannot canonicalize undefined');
  }
  if (typeof value === 'bigint') {
    fail('Cannot canonicalize BigInt');
  }
  if (typeof value === 'symbol') {
    fail('Cannot canonicalize symbol');
  }
  if (typeof value === 'function') {
    fail('Cannot canonicalize function');
  }
  if (typeof value !== 'object') {
    fail('Cannot canonicalize unsupported value');
  }

  if (seen.has(value)) {
    fail('Cannot canonicalize circular reference');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const serializedItems = value.map((item) => canonicalizeJson(item, seen));
    seen.delete(value);
    return `[${serializedItems.join(',')}]`;
  }

  if (!isSerializableRecord(value)) {
    fail('Cannot canonicalize non-plain object');
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const serializedEntries = entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJson(item, seen)}`);
  seen.delete(value);
  return `{${serializedEntries.join(',')}}`;
}

export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(canonicalizeJson(value)) as T;
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested, seen);
  }

  return Object.freeze(value);
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  canonicalizeJson(value);
}
