import { reddit, redis, settings } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { logger, logZSet } from '../helpers/log-helper';
import { formatSignature } from '../helpers/settings-helper';
import type { CommentId, SettingDef } from '../types';

export const MODULE = {
  name: 'depth-cap-moderator',
  type: 'trigger',
  description: 'Locks comment chains that exceed the configured maximum depth.',
  triggers: ['onCommentCreate'],
  redisKeys: [
    'bot:dcmod:handled:{commentId}',
    'bot:chainmod:depth-log',
  ],
  settings: [
    'depthCapModEnabled',
    'depthCap',
    'depthCapIgnoreModerators',
    'depthCapIgnoreContributors',
    'depthCapResponse',
  ],
} as const;

const log = logger(MODULE.name);
const CAP_LOG_KEY = 'bot:chainmod:depth-log';
const CAP_LOG_MAX = 200;

export async function run(event: OnCommentCreateRequest): Promise<void> {
  const enabled = (await settings.get<boolean>('depthCapModEnabled')) ?? true;
  if (!enabled) return;

  const cv2 = event.comment;
  if (!cv2) return;

  const rawCap = (await settings.get<number>('depthCap')) ?? 10;
  const cap = Number(rawCap);
  if (isNaN(cap) || cap <= 0) return;

  const dedupeKey = `bot:dcmod:handled:${cv2.id}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.warn('dedup_duplicate_trigger', { commentId: cv2.id, dedupeKey });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('dedup_expire_failed', { dedupeKey, expireSeconds: 3600, error: (err as Error).message });
  }
  log.info('dedup_claim_succeeded', { commentId: cv2.id, dedupeKey });

  const [ignoreMods, ignoreContributors] = await Promise.all([
    settings.get<boolean>('depthCapIgnoreModerators').then(v => v ?? true),
    settings.get<boolean>('depthCapIgnoreContributors').then(v => v ?? true),
  ]);

  if ((ignoreMods || ignoreContributors) && event.subreddit) {
    const authorId = cv2.author as `t2_${string}`;
    const subredditName = event.subreddit.name;

    let isModerator = false;
    let isApprovedUser = false;

    try {
      const user = await reddit.getUserById(authorId);
      if (user) {
        const [mods, approved] = await Promise.all([
          reddit.getModerators({ subredditName, username: user.username }).all(),
          reddit.getApprovedUsers({ subredditName, username: user.username }).all(),
        ]);
        isModerator = mods.length > 0;
        isApprovedUser = approved.length > 0;
      } else {
        log.warn('user_not_found', { authorId });
      }
    } catch (err) {
      log.warn('mod_status_check_failed', { error: (err as Error).message, authorId });
    }

    if (ignoreMods && isModerator) {
      log.info('skipping_moderator', { commentId: cv2.id, authorId });
      return;
    }

    if (ignoreContributors && isApprovedUser) {
      log.info('skipping_contributor', { commentId: cv2.id, authorId });
      return;
    }
  }

  const [rawSignature, depthCapResponse] = await Promise.all([
    settings.get<string>('botSignature').then(v => v ?? ''),
    settings.get<string>('depthCapResponse').then(v => v ?? ''),
  ]);
  const noticeBody = depthCapResponse || 'This comment has reached the maximum comment depth and locked.';
  const notice = (noticeBody || 'Depth cap reached.') + formatSignature(rawSignature);

  // Fast exit: direct reply to post is depth 1
  if (cv2.parentId.startsWith('t3_') && cap > 1) return;

  const deepest = await reddit.getCommentById(cv2.id as CommentId);
  let current = deepest;
  for (let i = 1; i < cap; i++) {
    if (!current.parentId.startsWith('t1_')) return; // depth < cap
    current = await reddit.getCommentById(current.parentId as CommentId);
  }
  if (!current.parentId.startsWith('t3_')) return; // depth > cap

  log.info('depth_cap_reached', { commentId: cv2.id, cap });

  // Reply before locking so the bot can post to an unlocked comment
  try {
    const reply = await deepest.reply({ text: notice });
    try { await reply.distinguish(); } catch (err) { log.warn('notice_distinguish_failed', { error: (err as Error).message }); }
    try { await reply.lock(); } catch (err) { log.warn('notice_lock_failed', { error: (err as Error).message }); }
  } catch (err) {
    log.warn('notice_reply_failed', { error: (err as Error).message });
  }

  if (!deepest.locked) await deepest.lock();

  try {
    await reddit.report(deepest, { reason: 'Depth cap trigger' });
  } catch (err) {
    log.warn('report_failed', { error: (err as Error).message });
  }

  await logZSet(CAP_LOG_KEY, { action: 'Depth cap trigger', commentId: cv2.id, cap }, CAP_LOG_MAX);
}

export const DEPTH_CAP_SETTINGS = {
  enabled: [
    {
      key: 'depthCapModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'depthCapModEnabled',
        label: 'Depth Cap Moderator',
        helpText: 'Enable or disable the depth cap module.',
      },
    } as SettingDef,
  ],
  limits: [
    {
      key: 'depthCap',
      defaultValue: 10,
      field: {
        type: 'number',
        name: 'depthCap',
        label: 'Depth cap',
        helpText: 'Lock comment chains at this depth.',
        required: false,
      },
    } as SettingDef,
  ],
  ignoreFlags: [
    {
      key: 'depthCapIgnoreModerators',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'depthCapIgnoreModerators',
        label: 'Ignore moderators (depth cap)',
        helpText: 'Do not enforce the depth cap for moderators.',
        required: false,
      },
    } as SettingDef,
    {
      key: 'depthCapIgnoreContributors',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'depthCapIgnoreContributors',
        label: 'Ignore approved submitters (depth cap)',
        helpText: 'Do not enforce the depth cap for approved submitters.',
        required: false,
      },
    } as SettingDef,
  ],
  response: [
    {
      key: 'depthCapResponse',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'depthCapResponse',
        label: 'Depth cap removal message',
        helpText: 'Posted when a comment reaches the maximum allowed depth.',
        required: false,
      },
    } as SettingDef,
  ],
};
