import { reddit, redis, settings } from '@devvit/web/server';
import type { OnPostFlairUpdateRequest, OnPostSubmitRequest } from '@devvit/web/shared';
import { logger } from '../helpers/log-helper';
import { formatSignature } from '../helpers/settings-helper';
import type { PostId, SettingDef } from '../types';

const log = logger('length-moderator');

function bodyLength(text: string): number {
  return text.replace(/\s/g, '').length;
}

function containsLink(text: string): boolean {
  return /https?:\/\//.test(text);
}

async function enforce(
  fullPost: Awaited<ReturnType<typeof reddit.getPostById>>,
  postId: PostId,
  commentText: string,
  signature: string,
  reason: string,
  logr: ReturnType<typeof logger>,
): Promise<void> {
  try {
    await reddit.remove(postId, false);
    logr.info(`${reason}: post removed`, { postId });
  } catch (err) {
    logr.error(`${reason}: failed to remove post`, err as Error, { postId });
  }
  try {
    await fullPost.lock();
    logr.info(`${reason}: post locked`, { postId });
  } catch (err) {
    logr.error(`${reason}: failed to lock post`, err as Error, { postId });
  }
  if (commentText) {
    try {
      const reply = await fullPost.addComment({ text: commentText + signature });
      await reply.distinguish(true);
      await reply.lock();
      logr.info(`${reason}: comment posted, distinguished, locked`, { postId });
    } catch (err) {
      logr.error(`${reason}: failed to post or distinguish comment`, err as Error, { postId });
    }
  }
}

export async function run(event: OnPostSubmitRequest): Promise<void> {
  const enabled = (await settings.get<boolean>('lengthModEnabled')) ?? true;
  if (!enabled) return;

  const post = event.post;
  if (!post?.id) {
    log.warn('No post ID');
    return;
  }

  const postId = post.id as PostId;

  const dedupeKey = `bot:lenmod:handled:${postId}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.warn('Duplicate trigger', { postId });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('Failed to set expiration on dedup key', { error: (err as Error).message });
  }

  const [flairId, maxUnhostedLength, minHostedLength, unhostedComment, hostedComment, rawSignature] = await Promise.all([
    settings.get<string>('lengthModFlairId').then(v => v ?? ''),
    settings.get<number>('lengthModMaxUnhostedLength').then(v => v ?? 0),
    settings.get<number>('lengthModMinHostedLength').then(v => v ?? 0),
    settings.get<string>('lengthModMaxUnhostedComment').then(v => v ?? ''),
    settings.get<string>('lengthModMinHostedComment').then(v => v ?? ''),
    settings.get<string>('botSignature').then(v => v ?? ''),
  ]);
  const signature = formatSignature(rawSignature);

  const postBody = post.selftext ?? '';
  const charCount = bodyLength(postBody);
  const isLinkPost = !!post.url && post.url.startsWith('http');
  const hasLinkUrl = containsLink(postBody);
  const hasLinkContent = isLinkPost || hasLinkUrl;

  const fullPost = await reddit.getPostById(postId);
  const actualFlairMatch = flairId ? fullPost.flair?.templateId === flairId : false;

  log.info('Length moderator triggered', {
    postId,
    charCount,
    hasLinkContent,
    actualFlairMatch,
    postFlairId: fullPost.flair?.templateId,
    configuredFlairId: flairId,
  });

  // Check 1: flair-gated max unhosted length
  if (actualFlairMatch && maxUnhostedLength > 0 && charCount > maxUnhostedLength) {
    log.info('Post exceeds max unhosted length', { postId, charCount, maxUnhostedLength });
    await enforce(fullPost, postId, unhostedComment, signature, 'max-unhosted', log);
    return;
  }

  // Check 2: posts with link min hosted length (no flair gate)
  if (hasLinkContent && minHostedLength > 0 && charCount < minHostedLength) {
    log.info('Post with link below min hosted length', { postId, charCount, minHostedLength });
    await enforce(fullPost, postId, hostedComment, signature, 'min-hosted', log);
  }
}

export async function runOnFlairUpdate(event: OnPostFlairUpdateRequest): Promise<void> {
  const enabled = (await settings.get<boolean>('lengthModEnabled')) ?? true;
  if (!enabled) return;

  const post = event.post;
  if (!post?.id) {
    log.warn('onPostFlairUpdate: no post ID');
    return;
  }

  const postId = post.id as PostId;

  // Separate dedup key from the post-submit path so a post that passes on submit
  // (no restricted flair yet) is still checked when the flair is applied later.
  const dedupeKey = `bot:lenmod:flair-handled:${postId}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true });
  if (!claimed) {
    log.warn('Duplicate flair-update trigger', { postId });
    return;
  }
  try {
    await redis.expire(dedupeKey, 3600);
  } catch (err) {
    log.warn('Failed to set expiration on flair dedup key', { error: (err as Error).message });
  }

  const [flairId, maxUnhostedLength] = await Promise.all([
    settings.get<string>('lengthModFlairId').then(v => v ?? ''),
    settings.get<number>('lengthModMaxUnhostedLength').then(v => v ?? 0),
  ]);

  // Nothing to enforce if the rule isn't configured
  if (!flairId || maxUnhostedLength <= 0) return;

  // The new flair is directly in the event — no extra API call needed for the check
  const newFlairId = post.linkFlair?.templateId ?? '';
  if (newFlairId !== flairId) return;

  const postBody = post.selftext ?? '';
  const charCount = bodyLength(postBody);

  log.info('Length moderator (flair update) triggered', {
    postId,
    charCount,
    newFlairId,
    configuredFlairId: flairId,
  });

  if (charCount > maxUnhostedLength) {
    log.info('Post exceeds max unhosted length (flair change)', { postId, charCount, maxUnhostedLength });
    const [unhostedComment, rawSignature] = await Promise.all([
      settings.get<string>('lengthModMaxUnhostedComment').then(v => v ?? ''),
      settings.get<string>('botSignature').then(v => v ?? ''),
    ]);
    const signature = formatSignature(rawSignature);
    const fullPost = await reddit.getPostById(postId);
    await enforce(fullPost, postId, unhostedComment, signature, 'max-unhosted-flair-change', log);
  }
}

export const LENGTH_MOD_SETTINGS = {
  enabled: [
    {
      key: 'lengthModEnabled',
      defaultValue: true,
      field: {
        type: 'boolean',
        name: 'lengthModEnabled',
        label: 'Length Moderator',
        helpText: 'Enable or disable the length moderator module.',
      },
    } as SettingDef,
  ],
  limits: [
    {
      key: 'lengthModFlairId',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'lengthModFlairId',
        label: 'Flair template ID for max length posts',
        helpText: 'Flair template ID that triggers the character limit.',
        required: false,
      },
    } as SettingDef,
    {
      key: 'lengthModMaxUnhostedLength',
      defaultValue: 0,
      field: {
        type: 'number',
        name: 'lengthModMaxUnhostedLength',
        label: 'Max unhosted length',
        helpText: 'Maximum character count for posts with the specified flair.',
        required: false,
      },
    } as SettingDef,
    {
      key: 'lengthModMinHostedLength',
      defaultValue: 0,
      field: {
        type: 'number',
        name: 'lengthModMinHostedLength',
        label: 'Min hosted length',
        helpText: 'Minimum character count for link posts.',
        required: false,
      },
    } as SettingDef,
  ],
  response: [
    {
      key: 'lengthModMaxUnhostedComment',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'lengthModMaxUnhostedComment',
        label: 'Max post length message',
        helpText: 'Posted when character count exceeds limit for specific flairs.',
        required: false,
      },
    } as SettingDef,
    {
      key: 'lengthModMinHostedComment',
      defaultValue: '',
      field: {
        type: 'paragraph',
        name: 'lengthModMinHostedComment',
        label: 'Un-summarized link message',
        helpText: 'Posted when a link is present and character count not met.',
        required: false,
      },
    } as SettingDef,
  ],
};
