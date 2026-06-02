import { reddit, redis } from '@devvit/web/server';
import type { OnCommentReportRequest, OnPostReportRequest } from '@devvit/web/shared';
import { logger } from '../helpers/log-helper';
import type { CommentId, PostId } from '../types';

export const MODULE = {
  name: 'report-moderator',
  type: 'trigger',
  description: 'Ignores reports on bot-authored comments and posts to keep the mod queue clean.',
  triggers: ['onCommentReport', 'onPostReport'],
  redisKeys: [
    'bot:rf:comment:{commentId}',
    'bot:rf:post:{postId}',
  ],
  settings: [],
} as const;

const log = logger(MODULE.name);

const BOT_AUTHORS = new Set(['AutoModerator', 'FloodAssistant', 'LLMPhysics-ModTeam', 'llmphysics-bot']);

export async function runOnCommentReport(event: OnCommentReportRequest): Promise<void> {
  const cv2 = event.comment;
  if (!cv2) {
    log.warn('comment_report_no_event', {});
    return;
  }

  // cv2.author is a user ID (t2_xxx), not a username — fetch the comment to get authorName
  const comment = await reddit.getCommentById(cv2.id as CommentId);
  log.info('comment_report_received', { commentId: cv2.id, author: comment.authorName, reason: event.reason });

  if (!BOT_AUTHORS.has(comment.authorName)) {
    log.info('comment_report_skipped', { author: comment.authorName, reason: 'not_bot_author' });
    return;
  }

  const dedupeKey = `bot:rf:comment:${cv2.id}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.info('comment_report_dedup', { commentId: cv2.id, dedupeKey });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('comment_report_dedup_expire_failed', { dedupeKey, error: (err as Error).message });
  }

  try {
    await comment.ignoreReports();
    log.info('comment_report_ignored', { commentId: cv2.id, author: comment.authorName, reason: event.reason });
  } catch (err) {
    log.error('comment_report_ignore_failed', err as Error, { commentId: cv2.id });
  }
}

export async function runOnPostReport(event: OnPostReportRequest): Promise<void> {
  const pv2 = event.post;
  if (!pv2) {
    log.warn('post_report_no_event', {});
    return;
  }

  const post = await reddit.getPostById(pv2.id as PostId);
  log.info('post_report_received', { postId: pv2.id, author: post.authorName, reason: event.reason });

  if (!BOT_AUTHORS.has(post.authorName)) {
    log.info('post_report_skipped', { author: post.authorName, reason: 'not_bot_author' });
    return;
  }

  const dedupeKey = `bot:rf:post:${pv2.id}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.info('post_report_dedup', { postId: pv2.id, dedupeKey });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('post_report_dedup_expire_failed', { dedupeKey, error: (err as Error).message });
  }

  try {
    await post.ignoreReports();
    log.info('post_report_ignored', { postId: pv2.id, author: post.authorName, reason: event.reason });
  } catch (err) {
    log.error('post_report_ignore_failed', err as Error, { postId: pv2.id });
  }
}
