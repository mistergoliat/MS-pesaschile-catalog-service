// Runtime immutability for the canonical registry singleton.
//
// The rest of this codebase relies on compile-time `readonly` typing alone (no runtime freezing
// anywhere else in src/). This module is a deliberate, narrowly-scoped exception: the registry is a
// durable, versioned semantic contract that future snapshot/classifier code depends on never silently
// mutating (A00.2 Section 15/19-I), and TypeScript's `readonly` does not stop a runtime mutation from
// a plain-JS caller or an `as any` cast — only `Object.freeze` does. This helper is intentionally
// local to this domain folder rather than a new shared utility, since no other module needs it.

/** Recursively freezes an object graph. Safe to call on data containing only plain objects and arrays. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
