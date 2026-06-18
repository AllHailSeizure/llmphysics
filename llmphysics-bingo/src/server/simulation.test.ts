// simulation.test.ts
//
// Testing approach:
//   Automated: All tests below run unattended via `npx vitest run`.
//   Settings-dependent: None — simulation.ts has no settings-gated paths.
//
// Mock strategy: simulation.ts imports @devvit/redis, @devvit/web/server, and
// ./validator. All three are mocked here with vi.mock (hoisted above imports)
// so the module loads in the test environment without a live Devvit context.
// The Listings plugin used by reddit.getNewPosts() is NOT mocked by
// createDevvitTest, which is why we use vi.mock directly rather than the
// createDevvitTest harness used in bingo.test.ts and validator.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

const store = new Map<string, string>();

vi.mock('@devvit/redis', () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); },
    expire: async () => {},
    del: async (k: string) => { store.delete(k); },
  },
}));

vi.mock('@devvit/web/server', () => ({
  reddit: { getNewPosts: vi.fn() },
  context: { subredditName: 'llmphysics' },
  settings: { get: vi.fn(async () => undefined) },
}));

vi.mock('./validator', () => ({
  evaluateTestEvents: vi.fn(async () => []),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getSimulationData,
  saveSimulationData,
  clearSimulationData,
  dayBoundaries,
  fetchDaySlice,
  type SimulationData,
} from './simulation';
import { reddit } from '@devvit/web/server';
import { evaluateTestEvents as mockEval } from './validator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockPost(ts: number, comments: object[] = []) {
  return {
    id: `t3_${ts}`,
    title: 'Test Post',
    body: 'body text',
    authorName: 'alice',
    createdAt: new Date(ts),
    flair: { text: 'Theory' },
    comments: { get: async (_n: number) => comments },
  };
}

function makeListing(items: object[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const x of items) yield x;
    },
  };
}

const MOCK_DATA: SimulationData = {
  generatedAt: 1_000_000,
  subredditName: 'llmphysics',
  pool: ['tile-a', 'tile-b'],
  days: [
    { dayIndex: 0, dayStartTs: 0, dayEndTs: 86_400_000, triggeredKeys: ['tile-a'], dayKeys: ['tile-a'], postsScanned: 5, commentsScanned: 20 },
  ],
};

const DAY_START = 1_704_844_800_000; // 2024-01-10T00:00:00Z
const DAY_END = DAY_START + 86_400_000;

// ─── Redis helpers ────────────────────────────────────────────────────────────

describe('getSimulationData', () => {
  beforeEach(() => store.clear());

  it('returns null when nothing is stored', async () => {
    expect(await getSimulationData()).toBeNull();
  });

  it('round-trips through saveSimulationData', async () => {
    await saveSimulationData(MOCK_DATA);
    expect(await getSimulationData()).toEqual(MOCK_DATA);
  });

  it('clearSimulationData removes the key', async () => {
    await saveSimulationData(MOCK_DATA);
    await clearSimulationData();
    expect(await getSimulationData()).toBeNull();
  });
});

// ─── dayBoundaries ────────────────────────────────────────────────────────────

describe('dayBoundaries', () => {
  // Anchor: 2024-01-10T00:00:00Z = 1704844800000
  const NOW = 1_704_844_800_000;

  it('dayIndex 6 = yesterday (2024-01-09)', () => {
    const { start, end } = dayBoundaries(6, NOW);
    expect(new Date(start).toISOString()).toBe('2024-01-09T00:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2024-01-10T00:00:00.000Z');
  });

  it('dayIndex 0 = 7 days ago (2024-01-03)', () => {
    const { start, end } = dayBoundaries(0, NOW);
    expect(new Date(start).toISOString()).toBe('2024-01-03T00:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2024-01-04T00:00:00.000Z');
  });

  it('each window is exactly 24h', () => {
    for (let i = 0; i <= 6; i++) {
      const { start, end } = dayBoundaries(i, NOW);
      expect(end - start).toBe(86_400_000);
    }
  });
});

// ─── fetchDaySlice ────────────────────────────────────────────────────────────

describe('fetchDaySlice', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.mocked(mockEval).mockResolvedValue([]);
  });

  it('returns zero counts when no posts fall in the window', async () => {
    const oldPost = mockPost(DAY_START - 1); // 1ms before window
    vi.mocked(reddit.getNewPosts).mockReturnValue(makeListing([oldPost]) as any);
    const result = await fetchDaySlice('llmphysics', DAY_START, DAY_END, 'key', []);
    expect(result.postsScanned).toBe(0);
    expect(result.commentsScanned).toBe(0);
    expect(result.triggeredKeys).toEqual([]);
  });

  it('counts posts and comments inside the window', async () => {
    const comments = [
      { authorName: 'bob', body: 'great comment', createdAt: new Date(DAY_START + 100), postId: 't3_x' },
    ];
    const post = mockPost(DAY_START + 1000, comments);
    vi.mocked(reddit.getNewPosts).mockReturnValue(makeListing([post]) as any);
    const result = await fetchDaySlice('llmphysics', DAY_START, DAY_END, 'key', []);
    expect(result.postsScanned).toBe(1);
    expect(result.commentsScanned).toBe(1);
  });

  it('merges new triggered keys with previous cumulative set', async () => {
    const post = mockPost(DAY_START + 1000);
    vi.mocked(reddit.getNewPosts).mockReturnValue(makeListing([post]) as any);
    vi.mocked(mockEval).mockResolvedValue([{ valueKey: 'resonance-drop', triggeredBy: null }]);
    const result = await fetchDaySlice('llmphysics', DAY_START, DAY_END, 'key', ['consciousness-drop']);
    expect(result.triggeredKeys).toContain('resonance-drop');
    expect(result.triggeredKeys).toContain('consciousness-drop');
    // dayKeys is non-cumulative: only what Gemini returned THIS day
    expect(result.dayKeys).toContain('resonance-drop');
    expect(result.dayKeys).not.toContain('consciousness-drop');
  });

  it('deduplicates keys present in both prev and new', async () => {
    const post = mockPost(DAY_START + 1000);
    vi.mocked(reddit.getNewPosts).mockReturnValue(makeListing([post]) as any);
    vi.mocked(mockEval).mockResolvedValue([{ valueKey: 'consciousness-drop', triggeredBy: null }]);
    const result = await fetchDaySlice('llmphysics', DAY_START, DAY_END, 'key', ['consciousness-drop']);
    const dupeCount = result.triggeredKeys.filter((k) => k === 'consciousness-drop').length;
    expect(dupeCount).toBe(1);
  });

  it('skips Gemini call when no events were found', async () => {
    vi.mocked(reddit.getNewPosts).mockReturnValue(makeListing([]) as any);
    await fetchDaySlice('llmphysics', DAY_START, DAY_END, 'key', []);
    expect(mockEval).not.toHaveBeenCalled();
  });
});
