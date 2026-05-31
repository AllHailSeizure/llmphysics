import type { BingoEvent } from './tile-validator-helper';
import { appendBingoEvent } from './tile-validator-helper';

const DEV_SUB = 'llmphysics_dev';

export async function injectTestEvent(
  gameId: string,
  subredditName: string,
  event: BingoEvent
): Promise<{ ok: boolean; reason?: string }> {
  if (subredditName !== DEV_SUB) {
    return { ok: false, reason: `Injection blocked: only allowed on r/${DEV_SUB}` };
  }
  await appendBingoEvent(gameId, event);
  return { ok: true };
}
