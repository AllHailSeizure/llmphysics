import { context, reddit, settings } from '@devvit/web/server';
import { redis } from '@devvit/redis';
import type { Hono } from 'hono';
import { TILE_VALIDATORS, appendBingoEvent, runBatchValidation, type BingoEvent } from '../helpers/tile-validator-helper';
import { injectTestEvent } from '../helpers/bingo-event-injector';
import { tagPostWithGame, getPostGameId } from '../helpers/redis-helper';

type TileDefinition = {
  label: string;
  valueKey: string;
};

type Square = {
  label: string;
  valueKey: string;
  marked: boolean;
  free?: boolean;
};

const TILE_POOL: TileDefinition[] = TILE_VALIDATORS.map(({ label, valueKey }) => ({ label, valueKey }));
const GAME_TTL_SECS = 60 * 60 * 24 * 8;

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
  // If we don't have enough tiles, repeat the pool until we have 24
  while (picked.length < 24) {
    picked = picked.concat(shuffle(TILE_POOL));
  }
  picked = picked.slice(0, 24);

  const squares: Square[] = picked.map(({ label, valueKey }) => ({
    label,
    valueKey,
    marked: false,
  }));
  squares.splice(12, 0, { label: 'FREE', valueKey: 'free', marked: true, free: true });
  return squares;
}

async function checkTiles(squares: Square[], gameId: string): Promise<Square[]> {
  return Promise.all(
    squares.map(async (sq) => {
      if (sq.free) return sq;
      const val = await redis.get(`bot:bingo:game:${gameId}:value:${sq.valueKey}`);
      return { ...sq, marked: val === '1' };
    })
  );
}

function checkWin(squares: Square[]): { hasWin: boolean; winningIndices: number[] } {
  if (!squares || squares.length < 25) {
    return { hasWin: false, winningIndices: [] };
  }

  const winning = new Set<number>();

  // Check rows
  for (let row = 0; row < 5; row++) {
    const indices = [row * 5, row * 5 + 1, row * 5 + 2, row * 5 + 3, row * 5 + 4];
    if (indices.every((i) => squares[i]?.marked)) {
      indices.forEach((i) => winning.add(i));
    }
  }

  // Check columns
  for (let col = 0; col < 5; col++) {
    const indices = [col, col + 5, col + 10, col + 15, col + 20];
    if (indices.every((i) => squares[i]?.marked)) {
      indices.forEach((i) => winning.add(i));
    }
  }

  // Check diagonals
  const diag1 = [0, 6, 12, 18, 24];
  if (diag1.every((i) => squares[i]?.marked)) {
    diag1.forEach((i) => winning.add(i));
  }

  const diag2 = [4, 8, 12, 16, 20];
  if (diag2.every((i) => squares[i]?.marked)) {
    diag2.forEach((i) => winning.add(i));
  }

  return { hasWin: winning.size > 0, winningIndices: Array.from(winning) };
}

// ─── Trigger handlers for event capture ────────────────────────────────────────

export async function captureCommentEvent(event: any): Promise<void> {
  try {
    const postId = event?.post?.id;
    if (!postId) return;
    const gameId = await getPostGameId(postId);
    if (!gameId) return;
    const body = event?.comment?.body ?? '';
    await appendBingoEvent(redis, gameId, {
      type: 'comment_create',
      ts: Date.now(),
      author: event?.comment?.author?.name,
      body: body.slice(0, 500),
      postId,
    });
  } catch (err) {
    console.error('captureCommentEvent error:', err);
  }
}

export async function capturePostEvent(event: any): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.post?.id;
    if (!postId || postId === gameId) return;
    await tagPostWithGame(postId, gameId);
    await redis.hSet(`bot:bingo:game:${gameId}:posts`, { [postId]: '1' });
    await redis.expire(`bot:bingo:game:${gameId}:posts`, GAME_TTL_SECS);
    await appendBingoEvent(redis, gameId, {
      type: 'post_submit',
      ts: Date.now(),
      author: event?.post?.author?.name,
      title: event?.post?.title?.slice(0, 200),
      body: event?.post?.body?.slice(0, 500),
      postId,
    });
  } catch (err) {
    console.error('capturePostEvent error:', err);
  }
}

export async function capturePostReportEvent(event: any): Promise<void> {
  try {
    const postId = event?.post?.id;
    if (!postId) return;
    const gameId = await getPostGameId(postId);
    if (!gameId) return;
    await appendBingoEvent(redis, gameId, {
      type: 'post_report',
      ts: Date.now(),
      postId,
      meta: event?.reportReasons ? event.reportReasons.join(', ') : undefined,
    });
  } catch (err) {
    console.error('capturePostReportEvent error:', err);
  }
}

export async function captureModActionEvent(event: any): Promise<void> {
  try {
    const postId = event?.targetPost?.id ?? event?.post?.id;
    if (!postId) return;
    const gameId = await getPostGameId(postId);
    if (!gameId) return;
    await appendBingoEvent(redis, gameId, {
      type: 'mod_action',
      ts: Date.now(),
      postId,
      meta: event?.action?.type,
    });
  } catch (err) {
    console.error('captureModActionEvent error:', err);
  }
}

export function register(app: Hono): void {
  // API: get card state with live tile checks
  app.get('/api/bingo/state', async (c) => {
    const postId = c.req.query('postId') ?? context.postId;
    const userId = c.req.query('userId') ?? context.userId;
    const gameId = postId;
    const key = `bot:bingo:card:${gameId}:${userId}`;

    const stored = await redis.get(key);
    let squares: Square[] = stored ? JSON.parse(stored) : generateCard();

    if (!stored) {
      await redis.set(key, JSON.stringify(squares));
      await redis.expire(key, 60 * 60 * 24 * 14);
    }

    squares = await checkTiles(squares, gameId);
    const { hasWin, winningIndices } = checkWin(squares);
    return c.json({ squares, hasWin, winningIndices });
  });

  // Mod menu: create a weekly bingo post
  app.post('/internal/menu/create-bingo-post', async (c) => {
    try {
      const post = await reddit.submitCustomPost({
        title: `Sub Bingo — ${new Date().toISOString().slice(0, 10)}`,
        entry: 'default',
      });
      const gameId = post.id;
      await redis.set('bot:bingo:current-game', JSON.stringify({ gameId, startedAt: Date.now() }));
      await redis.expire('bot:bingo:current-game', GAME_TTL_SECS);
      return c.json({ showToast: { text: 'Bingo post created!', appearance: 'success' } });
    } catch (error) {
      console.error('Failed to create bingo post:', error);
      return c.json(
        { showToast: { text: 'Failed to create post. Check logs.', appearance: 'failure' } },
        500
      );
    }
  });

  // Scheduler: hourly batch validation
  app.post('/internal/scheduler/bingo-batch-check', async (c) => {
    try {
      const raw = await redis.get('bot:bingo:current-game');
      if (!raw) return c.json({ status: 'no active game' });
      const { gameId } = JSON.parse(raw) as { gameId: string };
      const geminiApiKey = await settings.get<string>('geminiApiKey');
      await runBatchValidation(redis, reddit, geminiApiKey ?? '', gameId);
      return c.json({ status: 'ok' });
    } catch (error) {
      console.error('Batch validation failed:', error);
      return c.json({ status: 'error', error: String(error) }, 500);
    }
  });

  // Mod menu: inject a test event (dev-only via hardcoded check)
  app.post('/internal/menu/bingo-inject-event', async (c) => {
    const subredditName = context.subredditName ?? '';
    if (subredditName !== 'llmphysics_dev') {
      return c.json({
        showToast: { text: 'Injection only available on r/llmphysics_dev', appearance: 'neutral' },
      });
    }
    return c.json({
      showForm: 'bingo-inject-event',
    });
  });

  // Form: inject a test event
  app.post('/internal/forms/bingo-inject-event', async (c) => {
    const body = await c.req.json<{ eventType: string[]; content: string; author: string }>();
    const eventType = body.eventType[0] as BingoEvent['type'];
    const subredditName = context.subredditName ?? '';
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) {
      return c.json({ showToast: { text: 'No active game', appearance: 'neutral' } });
    }
    const { gameId } = JSON.parse(raw) as { gameId: string };

    const result = await injectTestEvent(redis, gameId, subredditName, {
      type: eventType,
      ts: Date.now(),
      author: body.author || 'test_user',
      body: body.content,
      title: body.content,
    });

    return c.json({
      showToast: {
        text: result.ok ? `Injected ${eventType} event.` : result.reason,
        appearance: result.ok ? 'success' : 'neutral',
      },
    });
  });
}
