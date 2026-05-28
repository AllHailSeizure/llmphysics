import { redis } from '@devvit/web/server';

const DEFAULTS: Record<string, string | number | boolean> = {
  botSignature: 'I am a bot. This action was performed automatically. Contact the moderators if you have questions.',
  depthCapModEnabled: true,
  depthCap: 10,
  depthCapResponse: '',
  floodModEnabled: true,
  floodAssistantResponse: '',
  floodAssistantMaxPosts: 1,
  floodAssistantWindowHours: 24,
  floodAssistantIgnoreModerators: true,
  floodAssistantIgnoreContributors: true,
  floodAssistantIgnoreAutoRemoved: true,
  floodAssistantIgnoreRemoved: true,
  floodAssistantIgnoreDeleted: true,
  selfResponseModEnabled: true,
  selfResponseResponse: '',
  selfResponseIgnoreModerators: true,
  selfResponseIgnoreContributors: true,
  lengthModEnabled: true,
  lengthModFlairId: '',
  lengthModMaxUnhostedLength: 0,
  lengthModMinHostedLength: 0,
  lengthModMaxUnhostedComment: '',
  lengthModMinHostedComment: '',
  mopToolEnabled: true,
  responseToolEnabled: true,
  defineCommandEnabled: true,
  defineCommandCategory: 'physics, mathematics, and AI',
  defineCommandSearchGrounding: true,
  adversarialReviewerEnabled: false,
  adversarialReviewerFlairId: '',
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

export function formatSignature(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const superscripted = trimmed.split(/\s+/).map(token => `^${token}`).join(' ');
  return `\n\n---\n\n${superscripted}`;
}
