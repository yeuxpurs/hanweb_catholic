import { describe, expect, it } from 'vitest';
import { koreanDateLabel, normalizeLinkUrl } from './editingHelpers';

describe('document link addresses', () => {
  it('preserves web, email and telephone destinations', () => {
    expect(normalizeLinkUrl(' https://example.org/안내?q=1#section ')).toBe(new URL('https://example.org/안내?q=1#section').href);
    expect(normalizeLinkUrl('mailto:office@example.org')).toBe('mailto:office@example.org');
    expect(normalizeLinkUrl('tel:+82212345678')).toBe('tel:+82212345678');
  });
  it('rejects active content, control-character obfuscation and local paths', () => {
    for (const address of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', 'file:///C:/private.txt', '//example.org', '/relative', 'https://', 'mailto:', 'https://user:password@example.org', 'https://exa mple.org']) {
      expect(normalizeLinkUrl(address), address).toBeNull();
    }
  });
});

it('inserts a Korean date using the Seoul calendar date across midnight UTC', () => {
  expect(koreanDateLabel(new Date('2026-10-26T16:00:00Z'))).toContain('2026년 10월 27일');
});
