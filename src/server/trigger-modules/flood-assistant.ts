import { reddit, redis } from '@devvit/web/server';
import type { OnPostSubmitRequest } from '@devvit/web/shared';
import { logger, logZSet } from '../logger';
import { readSetting } from '../app-settings';
import type { PostId } from '../types';

const log = logger('flood-assistant');
const LOG_KEY = 'bot:flood:log';
const LOG_MAX = 200;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function windowKey(username: string): string {
  return `bot:flood:posts:${username}`;
}

export async function run(event: OnPostSubmitRequest): Promise<void> {
  const post = event.post;
  if (!post) return;

  const enabled = await readSetting('floodassistant:enabled', true);
  if (!enabled) return;

  const maxPosts = await readSetting('floodassistant:maxPosts', 1);
  const replyMessage = await readSetting('floodassistant:replyMessage', '');

  const username = post.authorName;
  const now = Date.now();
  const key = windowKey(username);

  // Prune posts outside the rolling window
  await redis.zRemRangeByScore(key, 0, now - WINDOW_MS);

  const count = await redis.zCard(key);

  if (count >= maxPosts) {
    const defaultMsg =
      `Your post has been removed.\n\nUsers are limited to ${maxPosts} post per 24 hours.`;
    const msg = replyMessage || defaultMsg;

    try {
      const postObj = await reddit.getPostById(post.id as PostId);
      await postObj.addComment({ text: msg });
      await reddit.remove(post.id as PostId, false);
    } catch (err) {
      log.error('Failed to act on flood post', err, { postId: post.id, username });
      return;
    }

    log.warn('Flood post removed', { username, postId: post.id, count, maxPosts });
    await logZSet(LOG_KEY, { action: 'flood-removed', username, postId: post.id, count, maxPosts }, LOG_MAX);
    return;
  }

  // Record this post in the rolling window
  await redis.zAdd(key, { score: now, member: post.id });
  await redis.expire(key, 86400);

  log.info('Post allowed', { username, postId: post.id, postsInWindow: count + 1, maxPosts });
}
