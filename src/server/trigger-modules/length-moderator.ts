import { reddit, redis } from '@devvit/web/server';
import type { OnPostSubmitRequest } from '@devvit/web/shared';
import { logger } from '../helpers/log-helper';
import { readSetting, formatSignature } from '../helpers/settings-helper';
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
  log.info('Length moderator called');
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
