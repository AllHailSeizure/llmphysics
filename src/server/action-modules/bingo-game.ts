import { context, reddit, settings } from '@devvit/web/server';
import { redis } from '@devvit/redis';
import type { Hono } from 'hono';
import { TILE_VALIDATORS, appendBingoEvent, runBatchValidation, type BingoEvent } from '../helpers/tile-validator-helper';
import { injectTestEvent } from '../helpers/bingo-event-injector';
import { tagPostWithGame } from '../helpers/redis-helper';
import { readSetting, writeSetting } from '../helpers/settings-helper';
import type { UiResponse, OnCommentCreateRequest, OnPostSubmitRequest, OnPostReportRequest, OnModActionRequest } from '@devvit/web/shared';

type TileDefinition = {
  label: string;
  valueKey: string;
};

type Square = {
  label: string;
  valueKey: string;
  marked: boolean;
  free?: boolean;
  selfTriggered?: boolean; // tile is marked but was triggered by the card owner themselves
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

async function checkTiles(squares: Square[], gameId: string, username?: string): Promise<Square[]> {
  return Promise.all(
    squares.map(async (sq) => {
      if (sq.free) return sq;
      const val = await redis.get(`bot:bingo:game:${gameId}:value:${sq.valueKey}`);
      if (val !== '1') return { ...sq, marked: false, selfTriggered: false };
      let selfTriggered = false;
      if (username) {
        const rawBy = await redis.get(`bot:bingo:game:${gameId}:triggered-by:${sq.valueKey}`);
        // Normalize: strip "u/" prefix, lowercase both sides (Reddit usernames are case-insensitive)
        const by = rawBy?.replace(/^u\//, '').toLowerCase() ?? null;
        selfTriggered = !!by && by === username.toLowerCase();
      }
      return { ...sq, marked: true, selfTriggered };
    })
  );
}

function checkWin(squares: Square[]): { hasWin: boolean; winningIndices: number[] } {
  if (!squares || squares.length < 25) {
    return { hasWin: false, winningIndices: [] };
  }

  const winning = new Set<number>();

  // Self-triggered tiles are visible as marked but don't count toward a win
  const countsForWin = (sq: Square | undefined): boolean => !!sq?.marked && !sq?.selfTriggered;

  // Check rows
  for (let row = 0; row < 5; row++) {
    const indices = [row * 5, row * 5 + 1, row * 5 + 2, row * 5 + 3, row * 5 + 4];
    if (indices.every((i) => countsForWin(squares[i]))) {
      indices.forEach((i) => winning.add(i));
    }
  }

  // Check columns
  for (let col = 0; col < 5; col++) {
    const indices = [col, col + 5, col + 10, col + 15, col + 20];
    if (indices.every((i) => countsForWin(squares[i]))) {
      indices.forEach((i) => winning.add(i));
    }
  }

  // Check diagonals
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

// ─── Winner announcement helpers ──────────────────────────────────────────

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

// ─── Winner announcement ──────────────────────────────────────────

async function announceWinners(gameId: string): Promise<void> {
  const userIds = await redis.hKeys(`bot:bingo:game:${gameId}:users`);
  if (userIds.length === 0) return;

  const announcedBingo = await getAnnouncedForGoal(gameId, 'bingo');
  const announcedFullCard = await getAnnouncedForGoal(gameId, 'full_card');

  // Read configurable messages
  const firstWinnerTemplate = await readSetting('bingoFirstWinnerMessage', '🎉 **FIRST BINGO!** Congrats to u/{userId} for being the first to win!');
  const bingoTemplate = await readSetting('bingoBingoMessage', '✅ Bingo! u/{userId} got five in a row!');
  const fullCardTemplate = await readSetting('bingoFullCardMessage', '⭐ FULL CARD! u/{userId} marked all 25 tiles! Incredible!');

  for (const userId of userIds) {
    const cardJson = await redis.get(`bot:bingo:card:${gameId}:${userId}`);
    if (!cardJson) continue;

    // Stored card has stale marked values — fetch live tile state.
    // Look up username so checkTiles can apply self-trigger exclusion.
    let username: string | undefined;
    try {
      const user = await reddit.getUserById(userId as `t2_${string}`);
      username = user?.username?.toLowerCase();
    } catch {
      // Can't resolve username — self-trigger check skipped for this user
    }
    let squares: Square[] = JSON.parse(cardJson);
    squares = await checkTiles(squares, gameId, username);

    const { hasWin } = checkWin(squares);

    // Check if full card (all 25 marked, excluding self-triggered tiles)
    const isFullCard = squares.every((sq) => sq.marked && !sq.selfTriggered);

    // Announce bingo goal
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
        await reddit.submitComment({
          id: gameId as `t3_${string}`,
          text: message,
        });
      } catch (err) {
        console.error(`Failed to announce bingo for ${userId}:`, err);
      }

      await addAnnouncedForGoal(gameId, 'bingo', userId);
    }

    // Announce full card goal
    if (isFullCard && !announcedFullCard.includes(userId)) {
      const message = fullCardTemplate.replace('{userId}', userId);

      try {
        await reddit.submitComment({
          id: gameId as `t3_${string}`,
          text: message,
        });
      } catch (err) {
        console.error(`Failed to announce full card for ${userId}:`, err);
      }

      await addAnnouncedForGoal(gameId, 'full_card', userId);
    }
  }
}

// ─── Trigger handlers for event capture ────────────────────────────────────────

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
      author: event?.comment?.author?.name,
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
      author: event?.post?.author?.name,
      title: event?.post?.title?.slice(0, 200),
      body: event?.post?.body?.slice(0, 500),
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
      meta: event?.reportReasons ? event.reportReasons.join(', ') : undefined,
    });
  } catch (err) {
    console.error('capturePostReportEvent error:', err);
  }
}

export async function captureModActionEvent(event: OnModActionRequest): Promise<void> {
  try {
    const raw = await redis.get('bot:bingo:current-game');
    if (!raw) return;
    const { gameId } = JSON.parse(raw) as { gameId: string; startedAt: number };
    const postId = event?.targetPost?.id ?? event?.post?.id;
    if (!postId) return;
    await appendBingoEvent(gameId, {
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
    if (!postId || !userId) {
      return c.json({ error: 'Missing postId or userId' }, 400);
    }
    const gameId = postId;
    const key = `bot:bingo:card:${gameId}:${userId}`;

    const stored = await redis.get(key);
    let squares: Square[] = stored ? JSON.parse(stored) : generateCard();

    if (!stored) {
      await redis.set(key, JSON.stringify(squares));
      await redis.expire(key, 60 * 60 * 24 * 14);
      await redis.hSet(`bot:bingo:game:${gameId}:users`, { [userId]: '1' });
      await redis.expire(`bot:bingo:game:${gameId}:users`, 60 * 60 * 24 * 14);
    }

    // getCurrentUsername() returns the user making this request (same pattern as other modules)
    let username: string | undefined;
    try {
      username = (await reddit.getCurrentUsername())?.toLowerCase() ?? undefined;
    } catch {
      // Skip self-trigger check if lookup fails
    }
    console.log(`[bingo-state] userId=${userId} username=${username ?? '(none)'}`);

    squares = await checkTiles(squares, gameId, username);
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
      // Initialize won flag (0 = no winner yet, 1 = first winner achieved)
      await redis.set(`bot:bingo:game:${gameId}:won`, '0');
      await redis.expire(`bot:bingo:game:${gameId}:won`, GAME_TTL_SECS);
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
      await runBatchValidation(geminiApiKey ?? '',gameId);
      await announceWinners(gameId);
      return c.json({ status: 'ok' });
    } catch (error) {
      console.error('Batch validation failed:', error);
      return c.json({ status: 'error', error: String(error) }, 500);
    }
  });

  // Mod menu: bingo settings
  app.post('/internal/menu/bingo-settings', async (c) => {
    const cronSchedule = await readSetting('bingoCronSchedule', '0 * * * *');
    const firstWinnerMsg = await readSetting('bingoFirstWinnerMessage', '🎉 **FIRST BINGO!** Congrats to u/{userId} for being the first to win!');
    const bingoMsg = await readSetting('bingoBingoMessage', '✅ Bingo! u/{userId} got five in a row!');
    const fullCardMsg = await readSetting('bingoFullCardMessage', '⭐ FULL CARD! u/{userId} marked all 25 tiles! Incredible!');

    return c.json<UiResponse>({
      showForm: {
        name: 'bingo-settings',
        form: {
          title: 'Bingo Settings',
          acceptLabel: 'Save',
          fields: [
            {
              type: 'boolean',
              name: 'runBatchNow',
              label: 'Run batch validation now',
              helpText: 'Trigger a Gemini tile-check pass immediately when you save.',
              defaultValue: false,
            },
            {
              type: 'string',
              name: 'cronSchedule',
              label: 'Auto-validation schedule (cron)',
              helpText: 'When batch validation runs automatically. Default: 0 * * * * (top of every hour). Changing this here saves it for reference — edit devvit.json to apply.',
              defaultValue: cronSchedule,
            },
            {
              type: 'string',
              name: 'firstWinnerMessage',
              label: 'First winner message',
              helpText: 'Message when the first user gets bingo. Use {userId} as a placeholder.',
              defaultValue: firstWinnerMsg,
              required: false,
            },
            {
              type: 'string',
              name: 'bingoMessage',
              label: 'Bingo message',
              helpText: 'Message when a user gets bingo (not first). Use {userId} as a placeholder.',
              defaultValue: bingoMsg,
              required: false,
            },
            {
              type: 'string',
              name: 'fullCardMessage',
              label: 'Full card message',
              helpText: 'Message when a user gets all 25 tiles. Use {userId} as a placeholder.',
              defaultValue: fullCardMsg,
              required: false,
            },
            {
              type: 'select',
              name: 'injectEventType',
              label: 'Inject test event (dev sub only)',
              helpText: 'Optionally inject a synthetic event into the current game.',
              options: [
                { label: 'None', value: '' },
                { label: 'comment_create', value: 'comment_create' },
                { label: 'post_submit', value: 'post_submit' },
                { label: 'post_report', value: 'post_report' },
                { label: 'mod_action', value: 'mod_action' },
                { label: 'post_delete', value: 'post_delete' },
              ],
              defaultValue: [''],
            },
            {
              type: 'string',
              name: 'injectContent',
              label: 'Test event content',
              helpText: 'Body/title for the injected event.',
              required: false,
            },
            {
              type: 'string',
              name: 'injectAuthor',
              label: 'Test event author',
              helpText: 'Author name for the injected event. Defaults to test_user.',
              required: false,
            },
          ],
        },
      },
    });
  });

  // Form: bingo settings submit
  app.post('/internal/forms/bingo-settings', async (c) => {
    const body = await c.req.json<{
      runBatchNow: boolean;
      cronSchedule: string;
      firstWinnerMessage: string;
      bingoMessage: string;
      fullCardMessage: string;
      injectEventType: string[];
      injectContent: string;
      injectAuthor: string;
    }>();

    await writeSetting('bingoCronSchedule', body.cronSchedule ?? '0 * * * *');
    if (body.firstWinnerMessage) await writeSetting('bingoFirstWinnerMessage', body.firstWinnerMessage);
    if (body.bingoMessage) await writeSetting('bingoBingoMessage', body.bingoMessage);
    if (body.fullCardMessage) await writeSetting('bingoFullCardMessage', body.fullCardMessage);

    const toastParts: string[] = ['Settings saved.'];

    // Resolve the active game once — used by both injection and batch steps
    const gameRaw = await redis.get('bot:bingo:current-game');
    const activeGame = gameRaw ? (JSON.parse(gameRaw) as { gameId: string }) : null;

    // Step 1: inject test event FIRST so it's in the queue before batch runs
    const eventType = body.injectEventType?.[0];
    if (eventType && eventType !== '' && body.injectContent) {
      if (activeGame) {
        const subredditName = context.subredditName ?? '';
        const result = await injectTestEvent(activeGame.gameId, subredditName, {
          type: eventType as BingoEvent['type'],
          ts: Date.now(),
          author: body.injectAuthor || 'test_user',
          body: body.injectContent,
          title: body.injectContent,
        });
        toastParts.push(result.ok ? `Injected ${eventType} event.` : (result.reason ?? 'Injection blocked.'));
      } else {
        toastParts.push('No active game for injection.');
      }
    }

    // Step 2: run batch validation (picks up any just-injected event)
    if (body.runBatchNow) {
      if (!activeGame) {
        toastParts.push('No active game to validate.');
      } else {
        try {
          const geminiApiKey = await settings.get<string>('geminiApiKey');
          await runBatchValidation(geminiApiKey ?? '',activeGame.gameId);
          await announceWinners(activeGame.gameId);
          toastParts.push('Batch validation ran.');
        } catch (err) {
          toastParts.push(`Batch failed: ${(err as Error).message}`);
        }
      }
    }

    return c.json<UiResponse>({
      showToast: { text: toastParts.join(' '), appearance: 'success' },
    });
  });
}
