import { reddit, redis } from '@devvit/web/server';
import type { OnCommentReportRequest, OnPostReportRequest } from '@devvit/web/shared';
import { logger } from '../logger';
import type { CommentId, PostId } from '../types';

const log = logger('report-filter');

const BOT_AUTHORS = new Set(['AutoModerator', 'FloodAssistant', 'LLMPhysics-ModTeam', 'llmphysics-bot']);

export async function runOnCommentReport(event: OnCommentReportRequest): Promise<void> {
  log.info('runOnCommentReport triggered', { commentId: event.comment?.id, author: event.comment?.author, reason: event.reason });
  const cv2 = event.comment;
  if (!cv2) {
    log.warn('runOnCommentReport: no comment in event, exiting');
    return;
  }
  if (!BOT_AUTHORS.has(cv2.author)) {
    log.info('runOnCommentReport: author not in BOT_AUTHORS, skipping', { author: cv2.author, botAuthors: Array.from(BOT_AUTHORS) });
    return;
  }

  const dedupeKey = `bot:rf:comment:${cv2.id}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.info('Comment report: duplicate delivery', { commentId: cv2.id, dedupeKey });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('Failed to set expiration on dedup key', { dedupeKey, expireSeconds: 3600, error: (err as Error).message });
  }

  const comment = await reddit.getCommentById(cv2.id as CommentId);
  try {
    await comment.ignoreReports();
    log.info('Ignored bot comment report', { commentId: cv2.id, author: cv2.author, reason: event.reason });
  } catch (err) {
    log.error('runOnCommentReport: ignoreReports() failed', { err });
  }
}

export async function runOnPostReport(event: OnPostReportRequest): Promise<void> {
  log.info('runOnPostReport triggered', { postId: event.post?.id, reason: event.reason });
  const pv2 = event.post;
  if (!pv2) {
    log.warn('runOnPostReport: no post in event, exiting');
    return;
  }

  const dedupeKey = `bot:rf:post:${pv2.id}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.info('Post report: duplicate delivery', { postId: pv2.id, dedupeKey });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('Failed to set expiration on dedup key', { dedupeKey, expireSeconds: 3600, error: (err as Error).message });
  }

  const post = await reddit.getPostById(pv2.id as PostId);
  log.info('runOnPostReport: fetched post author', { postId: pv2.id, author: post.authorName });
  if (!BOT_AUTHORS.has(post.authorName)) {
    log.info('runOnPostReport: author not in BOT_AUTHORS, skipping', { author: post.authorName, botAuthors: Array.from(BOT_AUTHORS) });
    return;
  }

  try {
    await post.ignoreReports();
    log.info('Ignored bot post report', { postId: pv2.id, author: post.authorName, reason: event.reason });
  } catch (err) {
    log.error('runOnPostReport: ignoreReports() failed', { err });
  }
}
