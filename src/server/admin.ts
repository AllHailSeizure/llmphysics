import type { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { readAllSettings, writeSetting } from './app-settings';
import { logger } from './logger';

const log = logger('admin');

type SettingsFormValues = {
  botSignature: string;
  depthCap: number;
  depthCapResponse: string;
  floodAssistantResponse: string;
  selfResponseResponse: string;
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
              helpText: 'Enter plain text — each word is auto-formatted as superscript. Leave blank for no signature.',
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
              name: 'depthCapResponse',
              label: 'Depth cap triggered comment',
              helpText: 'Overrides the depth cap notice when set.',
              defaultValue: String(current.depthCapResponse ?? ''),
              required: false,
            },
            {
              type: 'paragraph',
              name: 'floodAssistantResponse',
              label: 'Flood assistant triggered comment',
              helpText: 'Posted when a post is removed for exceeding the flood limit. Bot signature is appended.',
              defaultValue: String(current.floodAssistantResponse ?? ''),
              required: false,
            },
            {
              type: 'paragraph',
              name: 'selfResponseResponse',
              label: 'Self-response triggered comment',
              helpText: 'Posted when OP\'s top-level self-reply is removed. Leave blank to remove silently.',
              defaultValue: String(current.selfResponseResponse ?? ''),
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
    if (values.depthCapResponse !== undefined) await writeSetting('depthCapResponse', values.depthCapResponse);
    if (values.floodAssistantResponse !== undefined) await writeSetting('floodAssistantResponse', values.floodAssistantResponse);
    if (values.selfResponseResponse !== undefined) await writeSetting('selfResponseResponse', values.selfResponseResponse);
    log.info('Settings saved via form');
    return c.json<UiResponse>({ showToast: 'Settings saved.' });
  });
}
