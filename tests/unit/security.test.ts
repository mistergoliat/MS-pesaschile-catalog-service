import { describe, expect, it } from 'vitest';
import { isApiKeyAuthorized, safeKeyEquals } from '../../src/shared/crypto.js';
import { stripHtml } from '../../src/shared/html.js';

describe('security helpers', () => {
  it('compares API keys safely', () => {
    expect(safeKeyEquals('secret', 'secret')).toBe(true);
    expect(safeKeyEquals('secret', 'secretx')).toBe(false);
  });

  it('authorizes one of many API keys', () => {
    expect(isApiKeyAuthorized('rotate-me', ['test-api-key', 'rotate-me'])).toBe(true);
    expect(isApiKeyAuthorized('wrong', ['test-api-key', 'rotate-me'])).toBe(false);
  });

  it('sanitizes HTML content', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p><script>alert(1)</script>')).toBe(
      'Hello world',
    );
  });
});
