import type { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { readAllSettings, writeSetting } from './app-settings';
import { logger } from './logger';

const log = logger('admin');

type SettingsFormValues = {
  botSignature: string;
  depthCap: number;
  depthCapNotice: string;
};

export function register(app: Hono): void {

  // ── Menu item: open settings form ────────────────────────────────────────────
  app.post('/internal/menu/bot-settings', async (c) => {
    const current = await readAllSettings();
    return c.json<UiResponse>({
      showForm: {
        name: 'bot-settings',
        form: {
          title: 'Bot Settings',
          acceptLabel: 'Save',
          fields: [
            {
              type: 'paragraph',
              name: 'botSignature',
              label: 'Bot signature',
              helpText: 'Appended to all bot comments. Leave blank for no signature.',
              defaultValue: String(current.botSignature ?? ''),
              required: false,
            },
            {
              type: 'number',
              name: 'depthCap',
              label: 'Depth cap',
              helpText: 'Lock comment chains at this depth. Set to 0 to disable.',
              defaultValue: Number(current.depthCap ?? 10),
              required: false,
            },
            {
              type: 'paragraph',
              name: 'depthCapNotice',
              label: 'Depth cap notice',
              helpText: 'Message posted when a comment hits the depth cap.',
              defaultValue: String(current.depthCapNotice ?? ''),
              required: false,
            },
          ],
        },
      },
    });
  });

  // ── Form submission: save settings ───────────────────────────────────────────
  app.post('/internal/forms/bot-settings', async (c) => {
    const values = await c.req.json<Partial<SettingsFormValues>>();
    if (values.botSignature !== undefined) await writeSetting('botSignature', values.botSignature);
    if (values.depthCap !== undefined) await writeSetting('depthCap', Number(values.depthCap));
    if (values.depthCapNotice !== undefined) await writeSetting('depthCapNotice', values.depthCapNotice);
    log.info('Settings saved via form');
    return c.json<UiResponse>({ showToast: 'Settings saved.' });
  });
}
