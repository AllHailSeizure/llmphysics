import { context, reddit, settings } from '@devvit/web/server';
import { redis } from '@devvit/redis';
import { TILE_VALIDATORS, type BingoEvent } from './tiles';
import { runPacing, type TileTrigger } from './pacing';
import { appendBingoEvent, runBatchValidation, evaluateTestEvents } from './validator';
import { readSetting, writeSetting } from './settings';
import type { OnCommentCreateRequest, OnPostSubmitRequest, OnPostReportRequest, OnModActionRequest, OnCommentReportRequest } from '@devvit/web/shared';
import {
  getSimulationData,
  saveSimulationData,
  fetchDaySlice,
  dayBoundaries,
  type SimulationData,
} from './simulation';

// ─── Types ────────────────────────────────────────────────────────────────────

type TileDefinition = {
  label: string;
  displayName: string;
  gameDescription: string;
  valueKey: string;
};

type Square = {
  label: string;
  displayName: string;
  gameDescription: string;
  valueKey: string;
  marked: boolean;
  free?: boolean;
  selfTriggered?: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE_POOL: TileDefinition[] = TILE_VALIDATORS.map(({ label, displayName, gameDescription, valueKey }) => ({
  label,
  displayName: displayName ?? '',
  gameDescription: gameDescription ?? '',
  valueKey,
}));
const GAME_TTL_SECS = 60 * 60 * 24 * 8;

// ─── Card generation ──────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCard(): Square[] {
  let picked = shuffle(TILE_POOL);
  while (picked.length < 24) {
    picked = picked.concat(shuffle(TILE_POOL));
  }
  picked = picked.slice(0, 24);

  const squares: Square[] = picked.map(({ label, displayName, gameDescription, valueKey }) => ({
    label,
    displayName,
    gameDescription,
    valueKey,
    marked: false,
  }));
  squares.splice(12, 0, { label: 'FREE', displayName: 'FREE', gameDescription: '', valueKey: 'free', marked: true, free: true });
  return squares;
}

// ─── Tile checking ────────────────────────────────────────────────────────────

async function checkTiles(squares: Square[], gameId: string, username?: string): Promise<Square[]> {
  return Promise.all(
    squares.map(async (sq) => {
      if (sq.free) return sq;
      const val = await redis.get(`bot:bingo:game:${gameId}:value:${sq.valueKey}`);
      if (val !== '1') return { ...sq, marked: false, selfTriggered: false };
      let selfTriggered = false;
      if (username) {
        const rawBy = await redis.get(`bot:bingo:game:${gameId}:triggered-by:${sq.valueKey}`);
        const by = rawBy?.replace(/^u\//, '').toLowerCase() ?? null;
        selfTriggered = !!by && by === username.toLowerCase();
      }
      return { ...sq, marked: true, selfTriggered };
    })
  );
}

// ─── Win detection ────────────────────────────────────────────────────────────

function checkWin(squares: Square[]): { hasWin: boolean; winningIndices: number[] } {
  if (!squares || squares.length < 25) {
    return { hasWin: false, winningIndices: [] };
  }

  const winning = new Set<number>();
  const countsForWin = (sq: Square | undefined): boolean => !!sq?.marked && !sq?.selfTriggered;

  for (let row = 0; row < 5; row++) {
    const indices = [row * 5, row * 5 + 1, row * 5 + 2, row * 5 + 3, row * 5 + 4];
    if (indices.every((i) => countsForWin(squares[i]))) {
      indices.forEach((i) => winning.add(i));
    }
  }

  for (let col = 0; col < 5; col++) {
    const indices = [col, col + 5, col + 10, col + 15, col + 20];
    if (indices.every((i) => countsForWin(squares[i]))) {
      indices.forEach((i) => winning.add(i));
    }
  }

  const diag1 = [0, 6, 12, 18, 24];
  if (diag1.every((i) => countsForWin(squares[i]))) {
    diag1.forEach((i) => winning.add(i));
  }

  const diag2 = [4, 8, 12, 16, 20];
  if (diag2.every((i) => countsForWin(squares[i]))) {
    diag2.forEach((i) => winning.add(i));
  }

  return { hasWin: winning.size > 0, winningIndices: Array.from(winning) };
}

// ─── Redis helpers (inlined) ──────────────────────────────────────────────────

async function tagPostWithGame(postId: string, gameId: string): Promise<void> {
  await redis.hSet(`flood:post:${postId}`, { gameId });
  await redis.expire(`flood:post:${postId}`, 8 * 24 * 60 * 60);
}

// ─── Direct Inject Test harness (fully detached sandbox) ──────────────────────
// Resolves real posts/comments by ID from the CURRENT sub and accumulates them in a
// per-mod sandbox namespace (`bot:bingo:test:<userId>:events`). Nothing here touches
// any live `bot:bingo:game:*` key, so tests can run against a live, released game
// without affecting its state or pacing stats.

const TEST_TTL_SECS = 60 * 60 * 24;
const testEventsKey = (userId: string) => `bot:bingo:test:${userId}:events`;

/** Resolve a thing-ID to a BingoEvent, enforcing that it belongs to the current sub. */
async function resolveTestEventForSub(
  type: 'post' | 'comment',
  id: string
): Promise<{ ok: true; event: BingoEvent } | { ok: false; reason: string }> {
  const sub = (context.subredditName ?? '').toLowerCase();
  if (!sub) return { ok: false, reason: 'No current subreddit context.' };

  try {
    if (type === 'post') {
      const post = await reddit.getPostById(id as `t3_${string}`);
      if ((post.subredditName ?? '').toLowerCase() !== sub) {
        return { ok: false, reason: `That post belongs to r/${post.subredditName}, not r/${context.subredditName}.` };
      }
      return {
        ok: true,
        event: {
          type: 'post_submit',
          ts: post.createdAt?.getTime?.() ?? Date.now(),
          author: post.authorName,
          title: post.title,
          body: post.body ?? '',
          flair: post.flair?.text,
          postId: post.id,
        },
      };
    }
    const comment = await reddit.getCommentById(id as `t1_${string}`);
    if ((comment.subredditName ?? '').toLowerCase() !== sub) {
      return { ok: false, reason: `That comment belongs to r/${comment.subredditName}, not r/${context.subredditName}.` };
    }
    return {
      ok: true,
      event: {
        type: 'comment_create',
        ts: comment.createdAt?.getTime?.() ?? Date.now(),
        author: comment.authorName,
        body: comment.body,
        postId: comment.postId,
      },
    };
  } catch (err) {
    return { ok: false, reason: `Could not resolve ${id} — check the ID. (${(err as Error).message})` };
  }
}

async function readTestBatch(userId: string): Promise<BingoEvent[]> {
  const raw = await redis.zRange(testEventsKey(userId), 0, -1);
  return raw.map((e: { member: string }) => JSON.parse(e.member) as BingoEvent);
}

// ─── Winner announcement ──────────────────────────────────────────────────────

async function getAnnouncedForGoal(gameId: string, goalType: string): Promise<string[]> {
  const raw = await redis.get(`bot:bingo:game:${gameId}:announced-goals:${goalType}`);
  return raw ? JSON.parse(raw) : [];
}

async function addAnnouncedForGoal(gameId: string, goalType: string, userId: string): Promise<void> {
  const announced = await getAnnouncedForGoal(gameId, goalType);
  announced.push(userId);
  await redis.set(`bot:bingo:game:${gameId}:announced-goals:${goalType}`, JSON.stringify(announced));
  await redis.expire(`bot:bingo:game:${gameId}:announced-goals:${goalType}`, GAME_TTL_SECS);
}

async function announceWinners(gameId: string): Promise<void> {
  const userIds = await redis.hKeys(`bot:bingo:game:${gameId}:users`);
  if (userIds.length === 0) return;

  const announcedBingo = await getAnnouncedForGoal(gameId, 'bingo');
  const announcedFullCard = await getAnnouncedForGoal(gameId, 'full_card');

  const firstWinnerTemplate = await readSetting('bingoFirstWinnerMessage', '🎉 **FIRST BINGO!** Congrats to u/{userId} for being the first to win!');
  const bingoTemplate = await readSetting('bingoBingoMessage', '✅ Bingo! u/{userId} got five in a row!');
  const fullCardTemplate = await readSetting('bingoFullCardMessage', '⭐ FULL CARD! u/{userId} marked all 25 tiles! Incredible!');

  for (const userId of userIds) {
    const cardJson = await redis.get(`bot:bingo:card:${gameId}:${userId}`);
    if (!cardJson) continue;

    let username: string | undefined;
    try {
      const user = await reddit.getUserById(userId as `t2_${string}`);
      username = user?.username?.toLowerCase();
    } catch {
      // self-trigger check skipped for this user
    }
    let squares: Square[] = JSON.parse(cardJson);
    squares = await checkTiles(squares, gameId, username);

    const { hasWin } = checkWin(squares);
    const isFullCard = squares.every((sq) => sq.marked && !sq.selfTriggered);

    if (hasWin && !announcedBingo.includes(userId)) {
      const won = await redis.get(`bot:bingo:game:${gameId}:won`);
      const isFirstWinner = !won || won === '0';

      let message: string;
      if (isFirstWinner) {
        message = firstWinnerTemplate.replace('{userId}', userId);
        await redis.set(`bot:bingo:game:${gameId}:won`, '1');
        await redis.expire(`bot:bingo:game:${gameId}:won`, GAME_TTL_SECS);
      } else {
        message = bingoTemplate.replace('{userId}', userId);
      }

      try {
        await reddit.submitComment({ id: gameId as `t3_${string}`, text: message });
      } catch (err) {
        console.error(`Failed to announce bingo for ${userId}:`, err);
      }

      await addAnnouncedForGoal(gameId, 'bingo', userId);
    }

    if (isFullCard && !announcedFullCard.includes(userId)) {
      const message = fullCardTemplate.replace('{userId}', userId);
      try {
        await reddit.submitComment({ id: gameId as `t3_${string}`, text: message });
      } catch (err) {
        console.error(`Failed to announce full card for ${userId}:`, err);
      }
      await addAnnouncedForGoal(gameId, 'full_card', userId);
    }
  }
}

// ─── Event capture handlers (called by triggers in index.ts) ──────────────────

export async function captureCommentEvent(event: OnCommentCreateRequest): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.post?.id;
    if (!postId) return;
    const body = event?.comment?.body ?? '';
    await appendBingoEvent(gameId, {
      type: 'comment_create',
      ts: Date.now(),
      author: event?.comment?.author,
      body: body.slice(0, 500),
      postId,
    });
  } catch (err) {
    console.error('captureCommentEvent error:', err);
  }
}

export async function capturePostEvent(event: OnPostSubmitRequest): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.post?.id;
    if (!postId || postId === gameId) return;
    await tagPostWithGame(postId, gameId);
    await redis.hSet(`bot:bingo:game:${gameId}:posts`, { [postId]: '1' });
    await redis.expire(`bot:bingo:game:${gameId}:posts`, GAME_TTL_SECS);
    await appendBingoEvent(gameId, {
      type: 'post_submit',
      ts: Date.now(),
      author: event?.author?.name,
      title: event?.post?.title?.slice(0, 200),
      body: event?.post?.selftext?.slice(0, 500),
      flair: event?.post?.linkFlair?.text,
      postId,
    });
  } catch (err) {
    console.error('capturePostEvent error:', err);
  }
}

export async function capturePostReportEvent(event: OnPostReportRequest): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.post?.id;
    if (!postId) return;
    await appendBingoEvent(gameId, {
      type: 'post_report',
      ts: Date.now(),
      postId,
      meta: event?.reason ?? undefined,
    });
  } catch (err) {
    console.error('capturePostReportEvent error:', err);
  }
}

export async function captureCommentReportEvent(event: OnCommentReportRequest): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.comment?.postId;
    if (!postId) return;
    await appendBingoEvent(gameId, {
      type: 'comment_report',
      ts: Date.now(),
      postId,
      meta: event?.reason,
    });
  } catch (err) {
    console.error('captureCommentReportEvent error:', err);
  }
}

export async function captureModActionEvent(event: OnModActionRequest): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.targetPost?.id;
    if (!postId) return;
    await appendBingoEvent(gameId, {
      type: 'mod_action',
      ts: Date.now(),
      postId,
      // `action` is the internal mod-log string (e.g. "removecomment", "spamcomment").
      // It is a string, not an object — the old `event.action.type` was always undefined.
      meta: event?.action,
    });
  } catch (err) {
    console.error('captureModActionEvent error:', err);
  }
}

// ─── Mod helpers ─────────────────────────────────────────────────────────────

/** True if the current user is a moderator of the current subreddit. */
export async function requesterIsMod(): Promise<boolean> {
  try {
    const username = (await reddit.getCurrentUsername())?.toLowerCase();
    if (!username) return false;
    const subredditName = context.subredditName ?? '';
    const mods = await reddit.getModerators({ subredditName, username }).all();
    return mods.length > 0;
  } catch {
    return false;
  }
}

// ─── HTTP route handlers (mounted in index.ts) ────────────────────────────────

export async function getBingoState(c: { req: { query: (k: string) => string | undefined }; json: (v: unknown, s?: number) => Response }): Promise<Response> {
  const postId = c.req.query('postId') ?? context.postId;
  const userId = c.req.query('userId') ?? context.userId;
  if (!postId || !userId) {
    return c.json({ error: 'Missing postId or userId' }, 400);
  }
  const currentGame = await redis.get('bot:bingo:current-game');
  const gameId = currentGame ? (JSON.parse(currentGame) as { gameId: string }).gameId : postId;
  const key = `bot:bingo:card:${gameId}:${userId}`;

  const stored = await redis.get(key);
  let squares: Square[] = stored ? JSON.parse(stored) : generateCard();

  if (!stored) {
    await redis.set(key, JSON.stringify(squares));
    await redis.expire(key, 60 * 60 * 24 * 14);
    await redis.hSet(`bot:bingo:game:${gameId}:users`, { [userId]: '1' });
    await redis.expire(`bot:bingo:game:${gameId}:users`, 60 * 60 * 24 * 14);
  }

  let username: string | undefined;
  try {
    username = (await reddit.getCurrentUsername())?.toLowerCase() ?? undefined;
  } catch {
    // skip self-trigger check
  }
  console.log(`[bingo-state] userId=${userId} username=${username ?? '(none)'}`);

  const subredditName = context.subredditName ?? '';
  const isMod = username
    ? (await reddit.getModerators({ subredditName, username }).all()).length > 0
    : false;
  if (!isMod) {
    return c.json({ operatorView: true });
  }

  squares = await checkTiles(squares, gameId, username);
  const { hasWin, winningIndices } = checkWin(squares);
  return c.json({ squares, hasWin, winningIndices, isMod: true });
}

export async function getBingoStats(c: { req: { query: (k: string) => string | undefined }; json: (v: unknown, s?: number) => Response }): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);

  const postId = c.req.query('postId') ?? context.postId;
  if (!postId) return c.json({ error: 'Missing postId' }, 400);

  const gameRaw = await redis.get('bot:bingo:current-game');
  const gameId = gameRaw ? (JSON.parse(gameRaw) as { gameId: string }).gameId : postId;
  const startTs = gameRaw ? (JSON.parse(gameRaw) as { startedAt: number }).startedAt : 0;

  const triggers: TileTrigger[] = await Promise.all(
    TILE_VALIDATORS.map(async (t) => {
      const at = await redis.get(`bot:bingo:game:${gameId}:triggered-at:${t.valueKey}`);
      const by = await redis.get(`bot:bingo:game:${gameId}:triggered-by:${t.valueKey}`);
      return {
        valueKey: t.valueKey,
        firstTriggerAt: at ? Number(at) : null,
        triggeredBy: by ?? null,
        fireCount: at ? 1 : 0,
      };
    })
  );

  const pool = TILE_VALIDATORS.map((t) => t.valueKey);
  const pacing = runPacing(pool, triggers, { cards: 5000, startTs });

  const tiles = triggers
    .map((t) => ({
      valueKey: t.valueKey,
      label: TILE_VALIDATORS.find((v) => v.valueKey === t.valueKey)?.displayName ?? t.valueKey,
      firstTriggerAt: t.firstTriggerAt == null ? null : t.firstTriggerAt - startTs,
      triggeredBy: t.triggeredBy,
    }))
    .sort((a, b) => (a.firstTriggerAt ?? Infinity) - (b.firstTriggerAt ?? Infinity));

  return c.json({ pacing, tiles });
}

export async function createBingoPost(c: { json: (v: unknown, s?: number) => Response }): Promise<Response> {
  try {
    const requester = (await reddit.getCurrentUsername())?.toLowerCase();
    if (!requester) {
      return c.json({ showToast: { text: 'Could not verify your identity.', appearance: 'neutral' } });
    }
    const subredditName = context.subredditName ?? '';
    const modMatches = await reddit.getModerators({ subredditName, username: requester }).all();
    const isMod = modMatches.length > 0;
    if (!isMod) {
      return c.json({ showToast: { text: 'Only moderators can create a bingo post.', appearance: 'neutral' } });
    }
    const post = await reddit.submitCustomPost({
      title: 'LLMPhysics Bingo!',
      entry: 'default',
    });
    const gameId = post.id;
    await redis.set('bot:bingo:current-game', JSON.stringify({ gameId, startedAt: Date.now() }));
    await redis.expire('bot:bingo:current-game', GAME_TTL_SECS);
    await redis.set(`bot:bingo:game:${gameId}:won`, '0');
    await redis.expire(`bot:bingo:game:${gameId}:won`, GAME_TTL_SECS);
    return c.json({ showToast: { text: 'Bingo post created!', appearance: 'success' } });
  } catch (error) {
    console.error('Failed to create bingo post:', error);
    return c.json({ showToast: { text: 'Failed to create post. Check logs.', appearance: 'failure' } }, 500);
  }
}

async function resetCurrentGame(): Promise<void> {
  const newGameId = `bingo-round-${Date.now()}`;
  await redis.set('bot:bingo:current-game', JSON.stringify({ gameId: newGameId, startedAt: Date.now() }));
  await redis.expire('bot:bingo:current-game', GAME_TTL_SECS);
  await redis.set(`bot:bingo:game:${newGameId}:won`, '0');
  await redis.expire(`bot:bingo:game:${newGameId}:won`, GAME_TTL_SECS);
}

export async function bingoSchedulerRun(c: { json: (v: unknown, s?: number) => Response }): Promise<Response> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return c.json({ status: 'no active game' });
    const { gameId, startedAt } = JSON.parse(raw) as { gameId: string; startedAt: number };

    const roundDurationDays = await readSetting('bingoRoundDurationDays', 0);
    if (roundDurationDays > 0 && Date.now() - startedAt > roundDurationDays * 24 * 60 * 60 * 1000) {
      await resetCurrentGame();
      return c.json({ status: 'round reset' });
    }

    const geminiApiKey = await settings.get<string>('geminiApiKey');
    await runBatchValidation(geminiApiKey ?? '', gameId);
    await announceWinners(gameId);
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('Batch validation failed:', error);
    return c.json({ status: 'error', error: String(error) }, 500);
  }
}

export async function getBingoSettings(c: { json: (v: unknown, s?: number) => Response }): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);
  return c.json({
    firstWinnerMessage: await readSetting('bingoFirstWinnerMessage', '🎉 **FIRST BINGO!** Congrats to u/{userId} for being the first to win!'),
    bingoMessage: await readSetting('bingoBingoMessage', '✅ Bingo! u/{userId} got five in a row!'),
    fullCardMessage: await readSetting('bingoFullCardMessage', '⭐ FULL CARD! u/{userId} marked all 25 tiles! Incredible!'),
    roundDurationDays: await readSetting('bingoRoundDurationDays', 0),
    subredditName: context.subredditName ?? '',
  });
}

export async function postBingoSettings(c: { req: { json: <T>() => Promise<T> }; json: (v: unknown, s?: number) => Response }): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json<{
    firstWinnerMessage?: string; bingoMessage?: string; fullCardMessage?: string;
    roundDurationDays?: number; runBatchNow?: boolean;
  }>();

  if (body.firstWinnerMessage) await writeSetting('bingoFirstWinnerMessage', body.firstWinnerMessage);
  if (body.bingoMessage) await writeSetting('bingoBingoMessage', body.bingoMessage);
  if (body.fullCardMessage) await writeSetting('bingoFullCardMessage', body.fullCardMessage);
  if (body.roundDurationDays !== undefined) await writeSetting('bingoRoundDurationDays', body.roundDurationDays);

  const messages: string[] = ['Settings saved.'];
  const gameRaw = await redis.get('bot:bingo:current-game');
  const activeGame = gameRaw ? (JSON.parse(gameRaw) as { gameId: string }) : null;

  if (body.runBatchNow) {
    if (!activeGame) messages.push('No active game to validate.');
    else {
      try {
        const geminiApiKey = await settings.get<string>('geminiApiKey');
        await runBatchValidation(geminiApiKey ?? '', activeGame.gameId);
        await announceWinners(activeGame.gameId);
        messages.push('Batch validation ran.');
      } catch (err) { messages.push(`Batch failed: ${(err as Error).message}`); }
    }
  }

  return c.json({ ok: true, message: messages.join(' ') });
}

// ─── Direct Inject Test endpoints (mod-gated, sandbox-only) ───────────────────

/** Resolve a thing-ID for the current sub and add it to the caller's test batch. */
export async function resolveTestEvent(c: { req: { json: <T>() => Promise<T> }; json: (v: unknown, s?: number) => Response }): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);
  const userId = context.userId;
  if (!userId) return c.json({ ok: false, reason: 'No user context.' });

  const { type, id } = await c.req.json<{ type: 'post' | 'comment'; id: string }>();
  if ((type !== 'post' && type !== 'comment') || !id?.trim()) {
    return c.json({ ok: false, reason: 'Provide a type (post/comment) and an ID.' });
  }

  const resolved = await resolveTestEventForSub(type, id.trim());
  if (!resolved.ok) return c.json({ ok: false, reason: resolved.reason });

  const key = testEventsKey(userId);
  await redis.zAdd(key, { member: JSON.stringify(resolved.event), score: resolved.event.ts });
  await redis.expire(key, TEST_TTL_SECS);

  const batch = await readTestBatch(userId);
  return c.json({ ok: true, event: resolved.event, batchSize: batch.length });
}

/** Run validation over the caller's test batch against ALL tiles. No live writes. */
export async function runTestValidation(c: { json: (v: unknown, s?: number) => Response }): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);
  const userId = context.userId;
  if (!userId) return c.json({ ok: false, reason: 'No user context.' });

  const events = await readTestBatch(userId);
  if (events.length === 0) return c.json({ ok: true, triggered: [], batchSize: 0, message: 'Test batch is empty.' });

  try {
    const geminiApiKey = await settings.get<string>('geminiApiKey');
    const triggered = await evaluateTestEvents(geminiApiKey ?? '', events);
    const result = triggered.map((t) => ({
      valueKey: t.valueKey,
      label: TILE_VALIDATORS.find((v) => v.valueKey === t.valueKey)?.displayName ?? t.valueKey,
      triggeredBy: t.triggeredBy,
    }));
    return c.json({ ok: true, triggered: result, batchSize: events.length });
  } catch (err) {
    return c.json({ ok: false, reason: `Validation failed: ${(err as Error).message}` });
  }
}

/** Clear the caller's test batch. */
export async function clearTestBatch(c: { json: (v: unknown, s?: number) => Response }): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);
  const userId = context.userId;
  if (!userId) return c.json({ ok: false, reason: 'No user context.' });
  await redis.del(testEventsKey(userId));
  return c.json({ ok: true, batchSize: 0 });
}

// ─── Simulation endpoints ─────────────────────────────────────────────────────

/** Return cached simulation data (or not_ready if none exists yet). */
export async function getSimulation(
  c: { json: (v: unknown, s?: number) => Response }
): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);
  const data = await getSimulationData();
  if (!data) return c.json({ status: 'not_ready' });
  const daysComputed = data.days.length;
  return c.json({ status: daysComputed >= 7 ? 'ready' : 'partial', daysComputed, data });
}

/**
 * Fetch one day of real subreddit activity, run tile evaluation, and cache the result.
 * The client calls this 7 times (dayIndex 0–6) sequentially to build the full dataset
 * without hitting Devvit's per-request timeout.
 */
export async function runSimulationFetchDay(
  c: { req: { json: <T>() => Promise<T> }; json: (v: unknown, s?: number) => Response }
): Promise<Response> {
  if (!(await requesterIsMod())) return c.json({ error: 'forbidden' }, 403);

  const { dayIndex, reset } = await c.req.json<{ dayIndex: number; reset?: boolean }>();
  if (typeof dayIndex !== 'number' || dayIndex < 0 || dayIndex > 6) {
    return c.json({ ok: false, reason: 'dayIndex must be 0–6' });
  }

  const subredditName = context.subredditName ?? '';
  if (!subredditName) return c.json({ ok: false, reason: 'No subreddit context.' });

  const geminiApiKey = (await settings.get<string>('geminiApiKey')) ?? '';

  let data: SimulationData | null = await getSimulationData();
  const pool = TILE_VALIDATORS.map((t) => t.valueKey);

  if (!data || reset) {
    data = { generatedAt: Date.now(), subredditName, pool, days: [] };
  }

  // Skip days already computed (unless resetting)
  if (!reset && data.days.some((d) => d.dayIndex === dayIndex)) {
    return c.json({ ok: true, daysComputed: data.days.length, data });
  }

  const { start: dayStartTs, end: dayEndTs } = dayBoundaries(dayIndex, Date.now());

  // Cumulative keys from the most recently computed day
  const sortedDays = [...data.days].sort((a, b) => a.dayIndex - b.dayIndex);
  const prevKeys = sortedDays.length > 0 ? sortedDays[sortedDays.length - 1]!.triggeredKeys : [];

  try {
    const simDay = await fetchDaySlice(subredditName, dayStartTs, dayEndTs, geminiApiKey, prevKeys);
    simDay.dayIndex = dayIndex;
    data.days = [...data.days.filter((d) => d.dayIndex !== dayIndex), simDay]
      .sort((a, b) => a.dayIndex - b.dayIndex);
    await saveSimulationData(data);
    return c.json({ ok: true, daysComputed: data.days.length, data });
  } catch (err) {
    return c.json({ ok: false, reason: `Fetch failed: ${(err as Error).message}` });
  }
}
