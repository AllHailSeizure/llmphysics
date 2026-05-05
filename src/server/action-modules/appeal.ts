import { redis, reddit } from '@devvit/web/server';
import { logger, logZSet } from '../logger';
import type { PostId } from '../types';

const log = logger('appeal');
const APPEAL_LOG_KEY = 'bot:appeal:log';
const APPEAL_LOG_MAX = 200;
const APPEAL_TTL_SECONDS = 30 * 24 * 60 * 60;

type AppealState = 'pending' | 'removed';

export interface AppealRecord {
  authorName: string;
  postTitle: string;
  postUrl: string;
  subredditName: string;
  startedAt: number;
  state: AppealState;
}

export function appealKey(postId: string): string {
  return `appeal:post:${postId}`;
}

// Called from saved-responses.ts when "lock and start appeal" is chosen.
// Locks the post, creates an appeal record, and sends OP instructions via modmail.
// OP replies with `!remove` to remove the post; appeal-moderator handles the reply.
export async function startAppeal(targetId: string): Promise<void> {
  const post = await reddit.getPostById(targetId as PostId);
  const { subredditName, authorName } = post;

  await post.lock();

  const record: AppealRecord = {
    authorName,
    postTitle: post.title,
    postUrl: post.url,
    subredditName,
    startedAt: Date.now(),
    state: 'pending',
  };
  await redis.set(appealKey(targetId), JSON.stringify(record));
  await redis.expire(appealKey(targetId), APPEAL_TTL_SECONDS);

  await reddit.modMail.createConversation({
    subredditName,
    subject: 'Your post has been locked',
    body: [
      `Your [post](${post.url}) has been locked pending review.`,
      '',
      'To remove your post, reply to this message with: `!remove`',
      '',
      'Your appeal window expires in 30 days.',
    ].join('\n'),
    to: `u/${authorName}`,
  });

  await logZSet(APPEAL_LOG_KEY, { action: 'appeal_start', postId: targetId, authorName }, APPEAL_LOG_MAX);
  log.info('Appeal started', { postId: targetId, authorName });
}
