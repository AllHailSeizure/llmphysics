// sim-mc.test.ts
//
// Testing approach:
//   Automated: All tests run unattended via `npx vitest run`. No Devvit context
//   needed — these are pure functions with no network or Redis calls.
//   Settings-dependent: None.

import { describe, it, expect } from 'vitest';
import { simGenerateCard, simEarliestBingo, runSimMonteCarlo } from './sim-mc';

const POOL = Array.from({ length: 31 }, (_, i) => `tile-${i}`);

describe('simGenerateCard', () => {
  it('produces 25 cells with free at index 12', () => {
    const card = simGenerateCard(POOL);
    expect(card).toHaveLength(25);
    expect(card[12]).toBe('free');
  });

  it('contains exactly 24 pool tiles (no extras, no missing)', () => {
    const card = simGenerateCard(POOL);
    const nonFree = card.filter((k) => k !== 'free');
    expect(nonFree).toHaveLength(24);
    for (const k of nonFree) expect(POOL).toContain(k);
  });
});

describe('simEarliestBingo', () => {
  it('returns null when no win line is complete', () => {
    const card = Array(25).fill('z') as string[];
    card[12] = 'free';
    expect(simEarliestBingo(card, {})).toBeNull();
  });

  it('returns the dayIndex of the first complete row', () => {
    // Row 0: indices 0-4
    const card = ['a', 'b', 'c', 'd', 'e', ...Array(7).fill('z'), 'free', ...Array(12).fill('z')];
    const dayTriggered: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5, z: 6 };
    // Row 0 completes on dayIndex 5 (max of days 1,2,3,4,5)
    expect(simEarliestBingo(card, dayTriggered)).toBe(5);
  });

  it('free square does not need a dayTriggered entry', () => {
    // Main diagonal [0,6,12,18,24] — index 12 is free
    const card: string[] = Array(25).fill('z');
    card[0] = 'a'; card[6] = 'b'; card[12] = 'free'; card[18] = 'c'; card[24] = 'd';
    expect(simEarliestBingo(card, { a: 1, b: 1, c: 1, d: 1, z: 99 })).toBe(1);
  });

  it('returns the earliest of multiple complete lines', () => {
    const card: string[] = Array(25).fill('z');
    card[12] = 'free';
    // Row 0 finishes dayIndex 3, row 1 finishes dayIndex 2 — should return 2
    card[0] = 'r0a'; card[1] = 'r0b'; card[2] = 'r0c'; card[3] = 'r0d'; card[4] = 'r0e';
    card[5] = 'r1a'; card[6] = 'r1b'; card[7] = 'r1c'; card[8] = 'r1d'; card[9] = 'r1e';
    const dt: Record<string, number> = {
      r0a: 1, r0b: 1, r0c: 1, r0d: 1, r0e: 3,
      r1a: 1, r1b: 1, r1c: 1, r1d: 1, r1e: 2,
      z: 6,
    };
    expect(simEarliestBingo(card, dt)).toBe(2);
  });
});

describe('runSimMonteCarlo', () => {
  it('totals to exactly N simulations', () => {
    const dt: Record<string, number> = {};
    POOL.forEach((k, i) => { dt[k] = i % 7; });
    const { dayCounts, neverCount } = runSimMonteCarlo(POOL, dt, 200);
    expect(dayCounts.reduce((s, c) => s + c, 0) + neverCount).toBe(200);
  });

  it('all-never when no tiles are triggered', () => {
    const { dayCounts, neverCount } = runSimMonteCarlo(POOL, {}, 100);
    expect(neverCount).toBe(100);
    expect(dayCounts.every((c) => c === 0)).toBe(true);
  });

  it('zero never when all pool tiles are triggered on dayIndex 0', () => {
    const dt: Record<string, number> = {};
    POOL.forEach((k) => { dt[k] = 0; });
    expect(runSimMonteCarlo(POOL, dt, 500).neverCount).toBe(0);
  });
});
