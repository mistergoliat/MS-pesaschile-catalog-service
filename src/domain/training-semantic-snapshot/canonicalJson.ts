import { createHash } from 'node:crypto';

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalizeTrainingSnapshotJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalize a non-finite number');
    return JSON.stringify(value);
  }
  if (value === undefined || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new TypeError('Cannot canonicalize unsupported JSON value');
  }
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Cannot canonicalize circular or unsupported value');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map((item) => canonicalizeTrainingSnapshotJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value)) throw new TypeError('Cannot canonicalize a non-plain object');
  const result = `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeTrainingSnapshotJson(item, seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return result;
}

export function hashTrainingSnapshotCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalizeTrainingSnapshotJson(value)).digest('hex');
}

export function cloneTrainingSnapshotJson<T>(value: T): T {
  return JSON.parse(canonicalizeTrainingSnapshotJson(value)) as T;
}

export function deepFreezeTrainingSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeTrainingSnapshot(nested, seen);
  return Object.freeze(value);
}
