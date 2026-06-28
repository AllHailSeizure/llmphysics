import type { Hono } from 'hono';
import { redis, reddit, settings } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { logger, logZSet } from '../helpers/log-helper';
import type { CommentId } from '../types';
import { getBotConfig } from '../config';

export const MODULE = {
  name: 'mop-tool',
  type: 'action',
  description: 'Removes and/or locks a comment chain via a moderator menu action.',
  triggers: [],
  redisKeys: [
    'bot:chainmod:session:{username}',
    'bot:chainmod:log',
  ],
  settings: ['mopToolEnabled'],
} as const;

const log = logger(MODULE.name);
const CHAIN_LOG_KEY = 'bot:chainmod:log';
const CHAIN_LOG_MAX = 200;
const SESSION_TTL = 300;

type ChainMopSession = { targetId: string };
type ChainMopFormValues = { remove: boolean; lock: boolean; skipDistinguished: boolean };

function sessionKey(user: string): string {
  return `bot:chainmod:session:${user}`;
}

async function setSession(user: string, data: ChainMopSession): Promise<void> {
  const key = sessionKey(user);
  await redis.set(key, JSON.stringify(data));
  await redis.expire(key, SESSION_TTL);
}

async function getSession(user: string): Promise<ChainMopSession | null> {
  const raw = await redis.get(sessionKey(user));
  return raw ? (JSON.parse(raw) as ChainMopSession) : null;
}

async function collectSubtree(commentId: CommentId, skipDistinguished: boolean): Promise<CommentId[]> {
  const comment = await reddit.getCommentById(commentId);
  const ids: CommentId[] = [];
  const replies = await comment.replies.all();
  for (const reply of replies) {
    const childIds = await collectSubtree(reply.id as CommentId, skipDistinguished);
    ids.push(...childIds);
  }
  if (!skipDistinguished || comment.distinguishedBy === null || comment.distinguishedBy === undefined) {
    ids.push(commentId); // post-order: deepest children first
  }
  return ids;
}

async function lockSubtree(commentId: CommentId, skipDistinguished: boolean): Promise<number> {
  let comment;
  try {
    comment = await reddit.getCommentById(commentId);
  } catch (err) {
    log.warn('Could not fetch comment, skipping', { id: commentId, error: (err as Error).message });
    return 0;
  }
  let count = 0;
  const replies = await comment.replies.all();
  for (const reply of replies) {
    count += await lockSubtree(reply.id as CommentId, skipDistinguished);
  }
  if (!comment.locked && (!skipDistinguished || comment.distinguishedBy === null || comment.distinguishedBy === undefined)) {
    try {
      await comment.lock();
      count++;
    } catch (err) {
      log.warn('Failed to lock comment', { id: commentId, error: (err as Error).message });
    }
  }
  return count;
}

export async function runChainMop(
  targetId: CommentId,
  opts: { remove: boolean; lock: boolean; skipDistinguished: boolean },
  by = 'test',
): Promise<{ removed: number; locked: number; removeFailed: boolean; lockFailed: boolean }> {
  const { remove, lock, skipDistinguished } = opts;
  let removed = 0;
  let locked = 0;
  let removeFailed = false;
  let lockFailed = false;

  if (remove) {
    try {
      const ids = await collectSubtree(targetId, skipDistinguished);
      for (const id of ids) {
        try {
          await reddit.remove(id, false);
          removed++;
        } catch (err) {
          log.warn('Failed to remove comment', { id, error: (err as Error).message });
        }
      }
      try {
        await reddit.addRemovalNote({
          itemIds: [targetId],
          reasonId: 'other',
          modNote: `Chain removed by u/${by} via ${getBotConfig().botUsername} (${removed} comment${removed !== 1 ? 's' : ''})`,
        });
      } catch (err) {
        log.warn('Could not add removal note', { error: (err as Error).message });
      }
      await logZSet(CHAIN_LOG_KEY, { action: 'remove_chain', targetId, by, count: removed }, CHAIN_LOG_MAX);
    } catch (err) {
      log.error('Remove chain failed', err);
      removeFailed = true;
    }
  }

  if (lock) {
    try {
      locked = await lockSubtree(targetId, skipDistinguished);
      await logZSet(CHAIN_LOG_KEY, { action: 'lock_chain', targetId, by, count: locked }, CHAIN_LOG_MAX);
    } catch (err) {
      log.error('Lock chain failed', err);
      lockFailed = true;
    }
  }

  return { removed, locked, removeFailed, lockFailed };
}

export function register(app: Hono): void {
  app.post('/internal/menu/chain-mop', async (c) => {
    const enabled = (await settings.get<boolean>('mopToolEnabled')) ?? true;
    if (!enabled) return c.json<UiResponse>({ showToast: { text: 'Chain Mop is disabled. Enable it in bot settings.', appearance: 'neutral' } });

    const { targetId } = await c.req.json<MenuItemRequest>();
    const mod = (await reddit.getCurrentUsername()) ?? 'unknown';
    await setSession(mod, { targetId });
    return c.json<UiResponse>({
      showForm: {
        name: 'chain-mop',
        form: {
          title: 'Chain Mop',
          acceptLabel: 'Mop',
          fields: [
            { type: 'boolean', name: 'remove', label: 'Remove comments', defaultValue: true },
            { type: 'boolean', name: 'lock', label: 'Lock comments', defaultValue: false },
            { type: 'boolean', name: 'skipDistinguished', label: 'Skip distinguished comments', defaultValue: false },
          ],
        },
      },
    });
  });

  app.post('/internal/forms/chain-mop', async (c) => {
    const values = await c.req.json<ChainMopFormValues>();
    const { remove, lock, skipDistinguished } = values;
    const mod = (await reddit.getCurrentUsername()) ?? 'unknown';

    if (!remove && !lock) {
      return c.json<UiResponse>({ showToast: { text: 'No actions selected.', appearance: 'neutral' } });
    }

    const session = await getSession(mod);
    if (!session) {
      return c.json<UiResponse>({ showToast: { text: 'Session expired. Try again.', appearance: 'neutral' } });
    }
    const targetId = session.targetId as CommentId;

    log.info('chain_mop_triggered', { targetId, by: mod, remove, lock, skipDistinguished });

    const { removed, locked, removeFailed, lockFailed } = await runChainMop(targetId, { remove, lock, skipDistinguished }, mod);

    const parts: string[] = [];
    if (remove) parts.push(removeFailed ? 'Remove failed' : `Removed ${removed} comment${removed !== 1 ? 's' : ''}`);
    if (lock)   parts.push(lockFailed   ? 'lock failed'   : `locked ${locked} comment${locked !== 1 ? 's' : ''}`);

    const text = parts.join(', ') + '.';
    const allFailed = removeFailed && lockFailed;
    return c.json<UiResponse>({
      showToast: { text: text.charAt(0).toUpperCase() + text.slice(1), appearance: allFailed ? 'neutral' : 'success' },
    });
  });
}
