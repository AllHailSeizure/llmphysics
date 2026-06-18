import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { readAllSettings, writeSetting } from './helpers/settings-helper';
import { logger } from './helpers/log-helper';
import { SETTINGS_MENUS } from './settings-registry';
import type { SettingDef } from './types';

const log = logger('admin');

async function showGroupForm(c: Context, groupKey: string): Promise<Response> {
  const menu = SETTINGS_MENUS.find((m) => m.key === groupKey);
  if (!menu) {
    return c.json<UiResponse>({ showToast: 'Unknown settings group.' });
  }

  const current = await readAllSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: any[] = menu.settings.map((def: SettingDef) => {
    const field = JSON.parse(JSON.stringify(def.field));
    field.defaultValue = current[def.key] !== undefined ? current[def.key] : def.defaultValue;
    return field;
  });

  return c.json<UiResponse>({
    showForm: {
      name: `bot-settings-${menu.key}`,
      form: {
        title: `${menu.label} Settings`,
        acceptLabel: 'Save',
        fields,
      },
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Response = any;

export function register(app: Hono): void {
  // ── Direct settings menu items — one per group ─────────────────────────────
  app.post('/internal/menu/bot-settings-modules', async (c) => showGroupForm(c, 'modules'));
  app.post('/internal/menu/bot-settings-flood', async (c) => showGroupForm(c, 'flood'));
  app.post('/internal/menu/bot-settings-commenting', async (c) => showGroupForm(c, 'commenting'));
  app.post('/internal/menu/bot-settings-posting', async (c) => showGroupForm(c, 'posting'));
  app.post('/internal/menu/bot-settings-removal-messages', async (c) => showGroupForm(c, 'removal-messages'));

  // ── Step 3: Dynamic save handlers — one per menu, registered in a loop ──────
  for (const menu of SETTINGS_MENUS) {
    app.post(`/internal/forms/bot-settings-${menu.key}`, async (c) => {
      const values = await c.req.json<Record<string, string | number | boolean | string[]>>();

      for (const def of menu.settings) {
        const value = values[def.key];
        let castedValue: string | number | boolean;

        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            // Select fields return string[], take first element
            const val = value[0];
            if (typeof def.defaultValue === 'number') {
              castedValue = Number(val);
            } else if (typeof def.defaultValue === 'boolean') {
              castedValue = val === 'true' || val.toLowerCase() === 'true';
            } else {
              castedValue = String(val);
            }
          } else {
            // Other field types (including booleans from checkbox fields)
            if (typeof def.defaultValue === 'number') {
              castedValue = Number(value);
            } else if (typeof def.defaultValue === 'boolean') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              castedValue = value === true || (typeof value === 'string' ? value.toLowerCase() === 'true' : (value as any) === true);
            } else {
              castedValue = String(value);
            }
          }
        } else {
          // Field not in submission (unchecked boolean) — save as false
          if (typeof def.defaultValue === 'boolean') {
            castedValue = false;
          } else {
            // Non-boolean fields without a value shouldn't happen, but skip them
            continue;
          }
        }

        log.info(`Saving ${def.key}`, { value, castedValue, type: typeof castedValue });
        await writeSetting(def.key, castedValue);
      }

      log.info(`${menu.label} settings saved`);
      return c.json<UiResponse>({ showToast: `${menu.label} settings saved.` });
    });
  }
}
