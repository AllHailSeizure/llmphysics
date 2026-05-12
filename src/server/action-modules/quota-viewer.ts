import type { Hono } from 'hono';
import { reddit, redis } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { logger } from '../helpers/log-helper';
import { readSetting } from '../helpers/settings-helper';
import { evaluateFloodStatus } from '../helpers/redis-helper';

const log = logger('quota-viewer');
const SESSION_TTL = 300;

type QuotaViewerSession = { targetUsername: string };

function sessionKey(mod: string): string {
  return `bot:quotaviewer:session:${mod}`;
}

async function setSession(mod: string, data: QuotaViewerSession): Promise<void> {
  const key = sessionKey(mod);
  await redis.set(key, JSON.stringify(data));
  await redis.expire(key, SESSION_TTL);
}

async function getSession(mod: string): Promise<QuotaViewerSession | null> {
  const raw = await redis.get(sessionKey(mod));
  return raw ? (JSON.parse(raw) as QuotaViewerSession) : null;
}

export function register(app: Hono): void {
  // Menu item: open quota viewer
  app.post('/internal/menu/quota-viewer', async (c) => {
    const enabled = await readSetting('floodModEnabled', true);
    if (!enabled) return c.json<UiResponse>({ showToast: 'Flood Moderator is disabled.' });

    const mod = (await reddit.getCurrentUsername()) ?? 'unknown';
    await setSession(mod, { targetUsername: '' });

    return c.json<UiResponse>({
      showForm: {
        name: 'quota-viewer-search',
        form: {
          title: 'Flood Quota Checker',
          acceptLabel: 'Search',
          fields: [
            {
              type: 'string',
              name: 'username',
              label: 'Username to check',
              helpText: 'Enter the username without u/',
              required: true,
            },
          ],
        },
      },
    });
  });

  // Form: search for user
  app.post('/internal/forms/quota-viewer-search', async (c) => {
    const { username } = await c.req.json<{ username: string }>();
    const mod = (await reddit.getCurrentUsername()) ?? 'unknown';

    if (!username || username.trim() === '') {
      return c.json<UiResponse>({ showToast: { text: 'Username required', appearance: 'neutral' } });
    }

    try {
      const user = await reddit.getUserByUsername(username);
      if (!user) {
        return c.json<UiResponse>({ showToast: { text: `User "${username}" not found`, appearance: 'neutral' } });
      }

      // Store username for next form
      await setSession(mod, { targetUsername: username });

      const [maxPosts, windowHours, ignoreDeleted, ignoreRemoved, ignoreAutoRemoved, ignoreModerators, ignoreContributors] = await Promise.all([
        readSetting('floodAssistantMaxPosts', 1),
        readSetting('floodAssistantWindowHours', 24),
        readSetting('floodAssistantIgnoreDeleted', true),
        readSetting('floodAssistantIgnoreRemoved', true),
        readSetting('floodAssistantIgnoreAutoRemoved', true),
        readSetting('floodAssistantIgnoreModerators', true),
        readSetting('floodAssistantIgnoreContributors', true),
      ]);

      const status = await evaluateFloodStatus(user.id, user.username, maxPosts, windowHours, {
        ignoreDeleted,
        ignoreRemoved,
        ignoreAutoRemoved,
        ignoreModerators,
        ignoreContributors,
      });

      const nextPostStr = status.nextPostTime
        ? status.nextPostTime.toISOString()
        : 'Now';

      const postFields = status.validPosts.length > 0
        ? status.validPosts.map((p) => ({
            type: 'string' as const,
            name: `post_${p.id}`,
            label: p.id,
            defaultValue: p.includedInQuota ? 'Included In Quota' : 'Excluded From Quota',
            helpText: `Created: ${p.createdAt.toISOString()}`,
            disabled: true,
          }))
        : [{
            type: 'string' as const,
            name: 'no_posts',
            label: 'No tracked posts',
            defaultValue: 'No posts found in the current window',
            disabled: true,
          }];

      return c.json<UiResponse>({
        showForm: {
          name: 'quota-viewer-result',
          form: {
            title: 'User Quota Information',
            description: "This form shows the posts that are currently being tracked for the user, as well as whether those posts count towards the user's post quota.",
            acceptLabel: 'Search again',
            fields: [
              {
                type: 'paragraph',
                name: 'header',
                label: `Tracked Posts - ${username}`,
                defaultValue: `${status.validPostCount} / ${status.maxPosts} quota posts`,
                disabled: true,
              },
              ...postFields,
              {
                type: 'string',
                name: 'nextPost',
                label: 'Next Post Opportunity',
                defaultValue: nextPostStr,
                helpText: 'This is when the user will have an empty spot in their post limit quota.',
                disabled: true,
              },
            ],
          },
        },
      });
    } catch (err) {
      log.error('Error checking quota', err, { username });
      return c.json<UiResponse>({
        showToast: { text: `Error checking quota: ${(err as Error).message}`, appearance: 'neutral' },
      });
    }
  });

  // Form: result back to search
  app.post('/internal/forms/quota-viewer-result', async (c) => {
    const mod = (await reddit.getCurrentUsername()) ?? 'unknown';
    await setSession(mod, { targetUsername: '' });

    return c.json<UiResponse>({
      showForm: {
        name: 'quota-viewer-search',
        form: {
          title: 'Flood Quota Checker',
          acceptLabel: 'Search',
          fields: [
            {
              type: 'string',
              name: 'username',
              label: 'Username to check',
              helpText: 'Enter the username without u/',
              required: true,
            },
          ],
        },
      },
    });
  });
}
