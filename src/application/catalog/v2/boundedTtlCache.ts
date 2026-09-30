/**
 * J1D-CAT-03: the v2 answer cache. Bounded by entry count (least recently
 * used entry evicted first), every entry carries its own expiry, and an entry
 * is never served at or after it. The caller sets the expiry to the answer's
 * owner validity, so the cache can never lengthen freshness.
 */
export class BoundedTtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAtMs: number }>();

  constructor(readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer');
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, nowMs: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAtMs <= nowMs) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, expiresAtMs: number, nowMs: number): void {
    this.entries.delete(key);
    if (!(expiresAtMs > nowMs)) return;
    this.entries.set(key, { value, expiresAtMs });
    if (this.entries.size <= this.maxEntries) return;
    for (const [candidate, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) this.entries.delete(candidate);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
