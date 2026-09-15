import { describe, expect, it } from 'vitest';
import { resolve, sequenceLive, stepsRemaining, stepTarget, targetKey, targetToUrl } from '../src/resolve';
import type { Sequence, State, Target } from '../src/types';

const FALLBACK = 'https://fallback.example.com/';
const NOW = 1_000_000;

const urlTarget = (url: string): Target => ({ kind: 'url', url });

function state(partial: Partial<State> = {}): State {
  return {
    main: null,
    temp: null,
    sequence: null,
    stickySteps: false,
    splash: false,
    bookmarks: [],
    mru: [],
    files: [],
    pools: [],
    giphy: {},
    trafficEnabled: false,
    partyEnabled: false,
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

describe('sequenceLive', () => {
  const armed = (partial: Partial<Sequence> = {}): Sequence => ({
    steps: [
      { id: 'a', target: { kind: 'text', text: 'one' } },
      { id: 'b', target: { kind: 'text', text: 'two' } },
    ],
    cursor: 0,
    armedAt: 0,
    expiresAt: NOW + 1,
    runId: 'run-1',
    ...partial,
  });

  it('is live when armed, unexpired, and unspent', () => {
    expect(sequenceLive(state({ sequence: armed() }), NOW)).toBe(true);
    expect(stepsRemaining(state({ sequence: armed() }), NOW)).toBe(2);
  });

  // The deadline exists so a forgotten sequence cannot ambush a stranger
  // scanning the code next week.
  it('goes dormant the instant its deadline passes', () => {
    const sequence = armed({ expiresAt: NOW });
    expect(sequenceLive(state({ sequence }), NOW - 1)).toBe(true);
    expect(sequenceLive(state({ sequence }), NOW)).toBe(false);
    expect(stepsRemaining(state({ sequence }), NOW)).toBe(0);
  });

  it('goes dormant once every step is claimed', () => {
    expect(sequenceLive(state({ sequence: armed({ cursor: 2 }) }), NOW)).toBe(false);
  });

  it('is not live with no steps, and not live when absent', () => {
    expect(sequenceLive(state({ sequence: armed({ steps: [] }) }), NOW)).toBe(false);
    expect(sequenceLive(state(), NOW)).toBe(false);
  });

  it('an expired sequence leaves main resolution untouched', () => {
    const result = resolve(
      state({
        sequence: armed({ expiresAt: NOW - 1 }),
        main: { target: urlTarget('https://main.example.com/'), setAt: 0 },
      }),
      NOW,
      FALLBACK,
    );
    expect(result.source).toBe('main');
  });
});

describe('stepTarget', () => {
  const withSteps = state({
    sequence: {
      steps: [
        { id: 'a', target: { kind: 'text', text: 'one' } },
        { id: 'b', target: { kind: 'text', text: 'two' } },
      ],
      cursor: 0,
      armedAt: 0,
      expiresAt: NOW + 1,
      runId: 'run-1',
    },
  });

  it('returns the target at an in-range index', () => {
    expect(stepTarget(withSteps, 1)).toEqual({ kind: 'text', text: 'two' });
  });

  // A forged or stale cookie must fall through, never crash and never claim.
  it.each([-1, 2, 99, 1.5, Number.NaN])('returns null for out-of-range index %s', (index) => {
    expect(stepTarget(withSteps, index)).toBeNull();
  });

  it('returns null when there is no sequence at all', () => {
    expect(stepTarget(state(), 0)).toBeNull();
  });
});

describe('targetKey', () => {
  it('separates the three kinds so recents de-duplicate correctly', () => {
    expect(targetKey({ kind: 'url', url: 'x' })).toBe('url:x');
    expect(targetKey({ kind: 'file', key: 'x', name: 'n' })).toBe('file:x');
    expect(targetKey({ kind: 'text', text: 'x' })).toBe('text:x');
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
