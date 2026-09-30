/**
 * PrestaShop stores DATETIME columns as shop-local wall-clock time without an
 * offset. These helpers turn such a wall-clock value into a UTC instant for a
 * given IANA zone (DST-aware, no dependency), so promotion windows and
 * freshness bounds are real instants rather than wall times read as UTC.
 */

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/u;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wallAsUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** `'2026-09-30 23:59:59'` in `timeZone` → ISO instant; null for empty/zero/invalid values. */
export function wallTimeToIso(value: string | null, timeZone: string): string | null {
  if (value === null) return null;
  const match = WALL_TIME.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  if (year === 0) return null;
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(wallAsUtc)) return null;
  // Two passes settle the offset across a DST transition.
  let instant = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  const corrected = wallAsUtc - zoneOffsetMs(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}
