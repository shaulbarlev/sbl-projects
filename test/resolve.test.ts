import { describe, expect, it } from 'vitest';
import { resolve, targetToUrl } from '../src/resolve';
import type { State, Target } from '../src/types';

const FALLBACK = 'https://fallback.example.com/';
const NOW = 1_000_000;

const urlTarget = (url: string): Target => ({ kind: 'url', url });

function state(partial: Partial<State> = {}): State {
  return {
    main: null,
    temp: null,
    splash: false,
    bookmarks: [],
    mru: [],
    files: [],
    hits: 0,
    ...partial,
  };
}

/**
 * The truth table. Every way this app can be embarrassingly wrong in public is
 * a row here.
 */
describe('resolve', () => {
  it('serves an unexpired temp over main', () => {
    const result = resolve(
      state({
        main: { target: urlTarget('https://main.example.com/'), setAt: 0 },
        temp: { target: urlTarget('https://temp.example.com/'), setAt: 0, expiresAt: NOW + 1 },
      }),
      NOW,
      FALLBACK,
    );
    expect(result.source).toBe('temp');
    expect(result.target).toEqual(urlTarget('https://temp.example.com/'));
  });

  it('falls back to main once the temp has expired', () => {
    const result = resolve(
      state({
        main: { target: urlTarget('https://main.example.com/'), setAt: 0 },
        temp: { target: urlTarget('https://temp.example.com/'), setAt: 0, expiresAt: NOW - 1 },
      }),
      NOW,
      FALLBACK,
    );
    expect(result.source).toBe('main');
    expect(result.target).toEqual(urlTarget('https://main.example.com/'));
  });

  it('treats the expiry instant itself as expired', () => {
    const temp = { target: urlTarget('https://temp.example.com/'), setAt: 0, expiresAt: NOW };
    expect(resolve(state({ temp }), NOW - 1, FALLBACK).source).toBe('temp');
    expect(resolve(state({ temp }), NOW, FALLBACK).source).toBe('fallback');
  });

  it('serves main when no temp exists', () => {
    const result = resolve(
      state({ main: { target: urlTarget('https://main.example.com/'), setAt: 0 } }),
      NOW,
      FALLBACK,
    );
    expect(result.source).toBe('main');
  });

  it('serves the fallback when nothing is set, never an error', () => {
    const result = resolve(state(), NOW, FALLBACK);
    expect(result.source).toBe('fallback');
    expect(result.target).toEqual(urlTarget(FALLBACK));
  });

  it('serves an expired temp with no main as the fallback', () => {
    const result = resolve(
      state({ temp: { target: urlTarget('https://temp.example.com/'), setAt: 0, expiresAt: NOW - 1 } }),
      NOW,
      FALLBACK,
    );
    expect(result.source).toBe('fallback');
  });
});

describe('targetToUrl', () => {
  it('passes URL targets through untouched', () => {
    expect(targetToUrl(urlTarget('https://a.example.com/x?y=1'), 'https://q.test')).toBe(
      'https://a.example.com/x?y=1',
    );
  });

  it('builds an origin-relative path for file targets and encodes the name', () => {
    expect(
      targetToUrl({ kind: 'file', key: 'abc123', name: 'my menu.pdf' }, 'https://q.test'),
    ).toBe('https://q.test/f/abc123/my%20menu.pdf');
  });
});
