import { reddit, redis } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { logger, logZSet } from '../helpers/log-helper';
import { readSetting, formatSignature } from '../helpers/settings-helper';
import type { CommentId, SettingDef } from '../types';

const log = logger('self-response-moderator');
const SRM_LOG_KEY = 'bot:srmod:log';
const SRM_LOG_MAX = 200;

export async function run(event: OnCommentCreateRequest): Promise<void> {
  const enabled = await readSetting('selfResponseModEnabled', true);
  if (!enabled) return;

  const cv2 = event.comment;
  const post = event.post;
  if (!cv2 || !post) return;
  if (!cv2.parentId.startsWith('t3_')) return; // not a top-level comment
  const commentAuthorId = event.author?.id;
  if (!commentAuthorId || commentAuthorId !== post.authorId) return; // top-level, but not OP

  const dedupeKey = `bot:srmod:handled:${cv2.id}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.warn('Duplicate trigger (redis dedup key already exists)', { commentId: cv2.id, dedupeKey });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('Failed to set expiration on dedup key', { dedupeKey, expireSeconds: 3600, error: (err as Error).message });
  }

  const ignoreModerators = await readSetting('selfResponseIgnoreModerators', true);
  const ignoreContributors = await readSetting('selfResponseIgnoreContributors', true);

  if ((ignoreModerators || ignoreContributors) && event.author?.name && event.subreddit?.name) {
    const subredditName = event.subreddit.name;
    const authorName = event.author.name;
    try {
      if (ignoreModerators) {
        const user = await reddit.getUserByUsername(authorName);
        if (user) {
          const modPerms = await user.getModPermissionsForSubreddit(subredditName);
          if (modPerms.length > 0) {
            log.info('Comment ignored (moderator)', { commentId: cv2.id, username: authorName });
            return;
          }
        }
      }
      if (ignoreContributors) {
        const approved = await reddit.getApprovedUsers({ subredditName, username: authorName }).all();
        if (approved.length > 0) {
          log.info('Comment ignored (approved submitter)', { commentId: cv2.id, username: authorName });
          return;
        }
      }
    } catch (err) {
      log.warn('Could not check author permissions', { error: (err as Error).message, commentId: cv2.id });
    }
  }

  log.info('OP top-level comment — removing and locking', { commentId: cv2.id, postId: post.id });

  const comment = await reddit.getCommentById(cv2.id as CommentId);

  const selfResponseResponse = await readSetting('selfResponseResponse', '');
  if (selfResponseResponse) {
    const rawSignature = await readSetting('botSignature', '');
    const notice = selfResponseResponse + formatSignature(rawSignature);
    try {
      const reply = await comment.reply({ text: notice });
      try { await reply.distinguish(); } catch (err) { log.warn('Could not distinguish self-response notice', { error: (err as Error).message }); }
      try { await reply.lock(); } catch (err) { log.warn('Could not lock self-response notice', { error: (err as Error).message }); }
    } catch (err) {
      log.warn('Could not leave self-response notice', { error: (err as Error).message });
    }
  }

  try {
    await reddit.remove(cv2.id as CommentId, false);
  } catch (err) {
    log.warn('remove failed', { error: (err as Error).message });
  }

  try {
    await comment.lock();
  } catch (err) {
    log.warn('lock failed', { error: (err as Error).message });
  }

  await logZSet(SRM_LOG_KEY, { postId: post.id, commentId: cv2.id }, SRM_LOG_MAX);
}

export const SELF_RESPONSE_SETTINGS = {
  enabled: [
    {
      key: 'selfResponseModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'selfResponseModEnabled',
        label: 'Self-Response Moderator',
        helpText: 'Enable or disable the self-response moderator module.',
      },
    } as SettingDef,
  ],
  ignoreFlags: [
    {
      key: 'selfResponseIgnoreModerators',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'selfResponseIgnoreModerators',
        label: 'Ignore moderators (self-reply)',
        helpText: 'Do not enforce the self-response rule for moderators.',
        required: false,
      },
    } as SettingDef,
    {
      key: 'selfResponseIgnoreContributors',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'selfResponseIgnoreContributors',
        label: 'Ignore approved submitters (self-reply)',
        helpText: 'Do not enforce the self-response rule for approved submitters.',
        required: false,
      },
    } as SettingDef,
  ],
  response: [
    {
      key: 'selfResponseResponse',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'selfResponseResponse',
        label: 'Self-response removal message',
        helpText: 'Posted when a user responds to their own post.',
        required: false,
      },
    } as SettingDef,
  ],
};
