import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/redis';
import { describe, expect } from 'vitest';
import { recordFirstTrigger } from './validator';

const test = createDevvitTest({});

describe('recordFirstTrigger', () => {
  test('sets triggered-at only on the first call', async () => {
    const gameId = 't3_pace1';
    const key = `bot:bingo:game:${gameId}:triggered-at:resonance-drop`;
    await recordFirstTrigger(gameId, 'resonance-drop', 1000);
    expect(await redis.get(key)).toBe('1000');
    await recordFirstTrigger(gameId, 'resonance-drop', 9999); // must NOT overwrite
    expect(await redis.get(key)).toBe('1000');
  });
});
