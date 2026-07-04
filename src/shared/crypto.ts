import { randomUUID, timingSafeEqual } from 'node:crypto';

export function createCorrelationId(): string {
  return randomUUID();
}

export function safeKeyEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isApiKeyAuthorized(value: string | undefined, keys: readonly string[]): boolean {
  if (!value) {
    return false;
  }

  return keys.some((key) => safeKeyEquals(value, key));
}
