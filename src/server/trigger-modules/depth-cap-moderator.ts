import { reddit } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { logger, logZSet } from '../logger';
import { readSetting } from '../app-settings';
import type { CommentId } from '../types';

const log = logger('depth-cap-moderator');
const CAP_LOG_KEY = 'bot:chainmod:depth-log';
const CAP_LOG_MAX = 200;

export async function run(event: OnCommentCreateRequest): Promise<void> {
  const cv2 = event.comment;
  if (!cv2) return;

  const rawCap = await readSetting('depthCap', 10);
  const cap = Number(rawCap);
  if (isNaN(cap) || cap <= 0) return;

  const signature = await readSetting('botSignature', '');
  const noticeBody = await readSetting(
    'depthCapNotice',
    'This comment has reached the maximum comment depth and locked. The comment was submitted for review and if found to be productive will be unlocked.',
  );
  const notice = (noticeBody || 'Depth cap reached.') + (signature ? `\n\n${signature}` : '');

  // Fast exit: direct reply to post is depth 1
  if (cv2.parentId.startsWith('t3_') && cap > 1) return;

  // Walk up cap-1 times to determine exact depth, collecting the ancestor chain
  const ancestors: Awaited<ReturnType<typeof reddit.getCommentById>>[] = [];
  const deepest = await reddit.getCommentById(cv2.id as CommentId);
  ancestors.push(deepest);

  let current = deepest;
  for (let i = 1; i < cap; i++) {
    if (!current.parentId.startsWith('t1_')) return; // depth < cap
    current = await reddit.getCommentById(current.parentId as CommentId);
    ancestors.push(current);
  }
  if (!current.parentId.startsWith('t3_')) return; // depth > cap

  // depth == cap — enforce
  log.info('Depth cap reached', { commentId: cv2.id, cap });

  // Reply before locking so the bot can post to an unlocked comment
  try {
    await deepest.reply({
      text: notice,
    });
  } catch (err) {
    log.warn('Could not leave depth cap notice', { error: (err as Error).message });
  }

  if (!deepest.locked) await deepest.lock();

  await logZSet(CAP_LOG_KEY, { commentId: cv2.id, cap }, CAP_LOG_MAX);
}
