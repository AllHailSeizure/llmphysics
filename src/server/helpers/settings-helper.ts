import { redis } from '@devvit/web/server';

const DEFAULTS: Record<string, string | number | boolean> = {
  bingoFirstWinnerMessage: '🎉 **FIRST BINGO!** Congrats to u/{userId} for being the first to win!',
  bingoBingoMessage: '✅ Bingo! u/{userId} got five in a row!',
  bingoFullCardMessage: '⭐ FULL CARD! u/{userId} marked all 25 tiles! Incredible!',
};

export async function readSetting<T extends string | number | boolean>(
  key: string,
  defaultValue: T,
): Promise<T> {
  const raw = await redis.get(`settings:${key}`);
  if (raw === null || raw === undefined) return defaultValue;
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

export function formatSignature(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const superscripted = trimmed.split(/\s+/).map(token => `^${token}`).join(' ');
  return `\n\n---\n\n${superscripted}`;
}
