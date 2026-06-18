import { redis } from '@devvit/redis';
import { reddit } from '@devvit/web/server';
import type { BingoEvent } from './tiles';
import { evaluateTestEvents } from './validator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SimDay = {
  dayIndex: number;        // 0 = 7 days ago, 6 = most recent full day
  dayStartTs: number;      // unix ms, UTC midnight
  dayEndTs: number;        // unix ms, end of window (exclusive)
  triggeredKeys: string[]; // CUMULATIVE — all keys triggered through days 0..dayIndex (for MC)
  dayKeys: string[];       // NON-CUMULATIVE — raw Gemini output for this day only (for frequency)
  postsScanned: number;
  commentsScanned: number;
};

export type SimulationData = {
  generatedAt: number;
  subredditName: string;
  pool: string[];   // all tile valueKeys — sent to client for card generation
  days: SimDay[];   // 0..6, built incrementally
};

// ─── Day boundary math ────────────────────────────────────────────────────────

/**
 * Compute the UTC [start, end) window for a given dayIndex.
 * dayIndex 6 = yesterday, dayIndex 0 = 7 days ago.
 * nowTs should be Date.now() or a fixed anchor for tests.
 */
export function dayBoundaries(dayIndex: number, nowTs: number): { start: number; end: number } {
  const d = new Date(nowTs);
  const todayMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const offsetDays = 6 - dayIndex; // 6 → 1 day back (yesterday), 0 → 7 days back
  const start = todayMidnight - (offsetDays + 1) * 86_400_000;
  return { start, end: start + 86_400_000 };
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

const SIM_KEY = 'bot:bingo:sim:data';
const SIM_TTL = 60 * 60 * 48; // 48h

export async function getSimulationData(): Promise<SimulationData | null> {
  const raw = await redis.get(SIM_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SimulationData; } catch { return null; }
}

export async function saveSimulationData(data: SimulationData): Promise<void> {
  await redis.set(SIM_KEY, JSON.stringify(data));
  await redis.expire(SIM_KEY, SIM_TTL);
}

export async function clearSimulationData(): Promise<void> {
  await redis.del(SIM_KEY);
}

// ─── fetchDaySlice ────────────────────────────────────────────────────────────

/**
 * Fetch one 24h window of subreddit activity, run evaluateTestEvents against it,
 * and return a SimDay (dayIndex is set to -1 sentinel; caller sets the real value).
 * Does NOT write to Redis — the route handler owns persistence.
 *
 * Posts are fetched newest-first. The loop stops as soon as a post falls before
 * dayStartTs so we never page through the entire sub history.
 */
export async function fetchDaySlice(
  subredditName: string,
  dayStartTs: number,
  dayEndTs: number,
  geminiApiKey: string,
  prevTriggeredKeys: string[]
): Promise<SimDay> {
  const events: BingoEvent[] = [];
  let postsScanned = 0;
  let commentsScanned = 0;

  const listing = reddit.getNewPosts({ subredditName, limit: 200, pageSize: 100 });
  const posts: any[] = [];
  for await (const post of listing) {
    const ts = post.createdAt instanceof Date ? post.createdAt.getTime() : Number(post.createdAt);
    if (ts < dayStartTs) break; // newest-first; stop when we go past our window
    if (ts < dayEndTs) posts.push(post); // only posts inside [dayStart, dayEnd)
  }

  for (const post of posts) {
    const postTs = post.createdAt instanceof Date ? post.createdAt.getTime() : Number(post.createdAt);
    events.push({
      type: 'post_submit',
      ts: postTs,
      author: post.authorName,
      title: (post.title ?? '').slice(0, 300),
      body: (post.body ?? '').slice(0, 500),
      flair: post.flair?.text,
      postId: post.id,
    });
    postsScanned++;

    const comments = await post.comments.get(200);
    for (const c of comments) {
      events.push({
        type: 'comment_create',
        ts: c.createdAt instanceof Date ? c.createdAt.getTime() : postTs,
        author: c.authorName,
        body: (c.body ?? '').slice(0, 500),
        postId: post.id,
      });
      commentsScanned++;
    }
  }

  // Skip Gemini if nothing was found (avoids an empty API call)
  const triggered = events.length > 0 ? await evaluateTestEvents(geminiApiKey, events) : [];
  const newKeys = triggered.map((t) => t.valueKey);
  const triggeredKeys = [...new Set([...prevTriggeredKeys, ...newKeys])];

  return { dayIndex: -1, dayStartTs, dayEndTs, triggeredKeys, dayKeys: newKeys, postsScanned, commentsScanned };
}
