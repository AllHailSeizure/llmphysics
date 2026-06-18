import { describe, it, expect } from 'vitest';
import { WIN_LINES, generateCardKeys, earliestBingo, runPacing } from './pacing';
import type { TileTrigger } from './pacing';

describe('WIN_LINES', () => {
  it('has 12 lines (5 rows, 5 cols, 2 diagonals) all including 5 indices', () => {
    expect(WIN_LINES).toHaveLength(12);
    expect(WIN_LINES.every((l) => l.length === 5)).toBe(true);
    expect(WIN_LINES).toContainEqual([0, 1, 2, 3, 4]);     // row 0
    expect(WIN_LINES).toContainEqual([0, 6, 12, 18, 24]);  // diag
  });
});

describe('generateCardKeys', () => {
  it('produces 25 cells with FREE at index 12 and 24 pool tiles', () => {
    const pool = Array.from({ length: 35 }, (_, i) => `t${i}`);
    const card = generateCardKeys(pool, () => 0.5);
    expect(card).toHaveLength(25);
    expect(card[12]).toBe('free');
  });
});

describe('earliestBingo', () => {
  it('returns the time the first full line completes (FREE always marked)', () => {
    // trigger map: row 0 tiles complete at t=10,20,30,40 (index4 is FREE? no)
    const card = ['a', 'b', 'c', 'd', 'e', ...Array(7).fill('z'), 'free', ...Array(12).fill('z')];
    const firstTrigger: Record<string, number | null> = { a: 10, b: 20, c: 30, d: 40, e: 50, z: null, free: 0 };
    // row 0 = a,b,c,d,e completes at max=50
    expect(earliestBingo(card, firstTrigger, new Set())).toBe(50);
  });

  it('excludes self-triggered tiles from a line', () => {
    const card = ['a', 'b', 'c', 'd', 'e', ...Array(20).fill('z')];
    card[12] = 'free';
    const firstTrigger: Record<string, number | null> = { a: 10, b: 20, c: 30, d: 40, e: 50, z: null, free: 0 };
    expect(earliestBingo(card, firstTrigger, new Set(['c']))).toBeNull(); // row 0 broken by self-trigger
  });
});

describe('runPacing', () => {
  it('computes a distribution over many cards', () => {
    const pool = Array.from({ length: 35 }, (_, i) => `t${i}`);
    const timeline: TileTrigger[] = pool.map((k, i) => ({
      valueKey: k, firstTriggerAt: i < 30 ? (i + 1) * 3_600_000 : null, triggeredBy: null, fireCount: 1,
    }));
    const res = runPacing(pool, timeline, { cards: 500, startTs: 0, rng: Math.random });
    expect(res.cards).toBe(500);
    expect(res.medianBingoMs === null || res.medianBingoMs >= 0).toBe(true);
    expect(res.verdict).toMatch(/too easy|good|too vague/);
  });
});
