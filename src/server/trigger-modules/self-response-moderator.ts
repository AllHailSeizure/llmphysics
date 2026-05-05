import { reddit } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { logger, logZSet } from '../logger';
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

  log.info('OP top-level comment — removing and locking', { commentId: cv2.id, postId: post.id });

  const comment = await reddit.getCommentById(cv2.id as CommentId);

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
