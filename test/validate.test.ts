import { describe, expect, it } from 'vitest';
import { clampDuration, MAX_TEMP_MS, MIN_TEMP_MS, validateUrl } from '../src/validate';
import { checkBearer } from '../src/auth';
import { escapeHtml, escapeJsString } from '../src/html';

describe('validateUrl', () => {
  it('accepts https and preserves the path', () => {
    const result = validateUrl('https://example.com/a/b?c=1');
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com/a/b?c=1');
  });

  it('upgrades a bare host to https, which is what you actually type on a phone', () => {
    expect(validateUrl('example.com/menu').url).toBe('https://example.com/menu');
  });

  it('allows the app schemes on the list', () => {
    expect(validateUrl('mailto:a@b.com').ok).toBe(true);
    expect(validateUrl('tel:+15551234').ok).toBe(true);
  });

  // With splash on we render HTML on our own origin, so these are the
  // difference between a redirect tool and stored XSS against the admin panel.
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x'])(
    'rejects %s',
    (bad) => {
      expect(validateUrl(bad).ok).toBe(false);
    },
  );

  it('rejects empty and unparseable input', () => {
    expect(validateUrl('   ').ok).toBe(false);
    expect(validateUrl('https://').ok).toBe(false);
  });
});

describe('clampDuration', () => {
  it('clamps to the 7 day ceiling', () => {
    expect(clampDuration(MAX_TEMP_MS * 10)).toBe(MAX_TEMP_MS);
  });

  it('clamps to a one minute floor', () => {
    expect(clampDuration(1)).toBe(MIN_TEMP_MS);
    expect(clampDuration(-5)).toBe(MIN_TEMP_MS);
  });

  it('survives garbage', () => {
    expect(clampDuration(Number.NaN)).toBe(MIN_TEMP_MS);
  });
});

describe('checkBearer', () => {
  const offering = (token: string) =>
    new Request('https://q.test/_/agent', { headers: { authorization: `Bearer ${token}` } });

  it('never falls back to another token when the expected one is unset', async () => {
    expect(await checkBearer(offering('anything'), undefined)).toBe(false);
    expect(await checkBearer(offering('anything'), '')).toBe(false);
  });

  it('matches only the token it is given, and reports no bearer as null', async () => {
    expect(await checkBearer(offering('right'), 'right')).toBe(true);
    expect(await checkBearer(offering('wrong'), 'right')).toBe(false);
    expect(await checkBearer(new Request('https://q.test/'), 'right')).toBeNull();
  });
});

describe('escaping', () => {
  it('neutralises html metacharacters', () => {
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });

  it('prevents a target from closing the inline script tag', () => {
    expect(escapeJsString('</script><script>alert(1)')).not.toContain('</script>');
  });

  it('escapes js line separators that are legal inside JSON', () => {
    const separator = String.fromCharCode(0x2028);
    expect(escapeJsString(`a${separator}b`)).toBe('a\\u2028b');
  });
});
