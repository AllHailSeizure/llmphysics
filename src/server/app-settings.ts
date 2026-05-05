import { redis } from '@devvit/web/server';

const DEFAULTS: Record<string, string | number | boolean> = {
  botSignature: '^I ^am ^a ^bot. ^This ^action ^was ^performed ^automatically. ^Contact ^the ^moderators ^if ^you ^have ^questions.',
  depthCap: 10,
  depthCapNotice: 'This comment has reached the maximum comment depth and locked. The comment was submitted for review and if found to be productive will be unlocked.',
};

export async function readSetting<T extends string | number | boolean>(
  key: string,
  defaultValue: T,
): Promise<T> {
  const raw = await redis.get(`settings:${key}`);
  if (raw == null) return defaultValue;
  if (typeof defaultValue === 'number') return Number(raw) as T;
  if (typeof defaultValue === 'boolean') return (raw === 'true') as T;
  return raw as T;
}

export async function writeSetting(key: string, value: string | number | boolean): Promise<void> {
  await redis.set(`settings:${key}`, String(value));
}

export async function readAllSettings(): Promise<Record<string, string | number | boolean>> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    result[key] = await readSetting(key, defaultValue);
  }
  return result;
}
