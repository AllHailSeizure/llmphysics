import { reddit, redis } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { logger, logZSet } from '../logger';
import { readSetting, formatSignature } from '../app-settings';
import type { CommentId } from '../types';

const log = logger('self-response-moderator');
const SRM_LOG_KEY = 'bot:srmod:log';
const SRM_LOG_MAX = 200;

export async function run(event: OnCommentCreateRequest): Promise<void> {
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

  log.info('OP top-level comment — removing and locking', { commentId: cv2.id, postId: post.id });

  const comment = await reddit.getCommentById(cv2.id as CommentId);

  const selfResponseResponse = await readSetting('selfResponseResponse', '');
  if (selfResponseResponse) {
    const rawSignature = await readSetting('botSignature', '');
    const notice = selfResponseResponse + formatSignature(rawSignature);
    try {
      await comment.reply({ text: notice });
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
