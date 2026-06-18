import type { TileValidatorDefinition, BingoEvent } from './tiles';

export type TriggeredTile = { valueKey: string; triggeredBy: string | null };

function buildTileList(tiles: TileValidatorDefinition[]): string {
  return tiles
    .map((t) => {
      const exStr = t.examples.map((ex) => `    • ${ex}`).join('\n');
      return `- valueKey: "${t.valueKey}"
  Description: ${t.description}
  Examples of valid triggers:
${exStr}
  Do NOT count: ${t.edgeCaseGuidelines}`;
    })
    .join('\n\n');
}

const INSTRUCTIONS = `Return ONLY a JSON array for tiles that were triggered.
Each object: {"valueKey": "...", "eventIndex": N}
N is the index from the numbered list below of the event that triggered the tile.
If multiple events trigger the same tile, return the most recent one (highest index).
If no tiles are triggered, return [].
CRITICAL RULE: ERR ON THE SIDE OF NOT TRIGGERING unless you are very confident it matches.`;

/** Build the Gemini prompt for a batch of post_submit events checked against post-scope tiles. */
export function buildPostBatchPrompt(tiles: TileValidatorDefinition[], postEvents: BingoEvent[]): string {
  const eventList = postEvents
    .map((e, i) => `[${i}] author=${e.author ?? '?'} title=${e.title ?? ''} body=${e.body ?? ''}`)
    .join('\n');

  return `You are checking Reddit posts for bingo tile triggers.
${INSTRUCTIONS}

TILES TO CHECK:
${buildTileList(tiles)}

POSTS TO CHECK:
${eventList}

Respond with ONLY valid JSON. Example: [{"valueKey":"tile-one","eventIndex":2}]`;
}

/**
 * Build the Gemini prompt for a batch of comment_create events checked against comment-scope tiles.
 * contextPostEvents provides flair for parent posts (e.g. Humorous) so Gemini can judge
 * tiles like missing-the-joke that require knowing the post's flair.
 */
export function buildCommentBatchPrompt(
  tiles: TileValidatorDefinition[],
  commentEvents: BingoEvent[],
  contextPostEvents: BingoEvent[]
): string {
  const postContext = contextPostEvents
    .filter((e) => e.postId)
    .map((e) => `  ${e.postId}: flair=${e.flair ?? '(none)'}`)
    .join('\n');

  const eventList = commentEvents
    .map((e, i) => `[${i}] author=${e.author ?? '?'} postId=${e.postId ?? '?'} body=${e.body ?? ''}`)
    .join('\n');

  const postSection = postContext
    ? `\nPOST CONTEXT (flair of parent posts — referenced by postId in comments below):\n${postContext}\n`
    : '';

  return `You are checking Reddit comments for bingo tile triggers.
${INSTRUCTIONS}
${postSection}
TILES TO CHECK:
${buildTileList(tiles)}

COMMENTS TO CHECK:
${eventList}

Respond with ONLY valid JSON. Example: [{"valueKey":"tile-one","eventIndex":0}]`;
}

/**
 * Parse Gemini's eventIndex response. Validates each index against the batch length and
 * resolves triggeredBy from the batch event's author. Out-of-range indices are dropped
 * (hallucination guard — Gemini can only reference events we actually sent it).
 */
export function parseEventIndexResponse(text: string, batch: BingoEvent[]): TriggeredTile[] {
  try {
    const raw = JSON.parse(text.match(/\[.*\]/s)?.[0] ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item: unknown): TriggeredTile | null => {
        if (!item || typeof item !== 'object') return null;
        const { valueKey, eventIndex } = item as { valueKey?: unknown; eventIndex?: unknown };
        if (typeof valueKey !== 'string') return null;
        if (typeof eventIndex !== 'number' || eventIndex < 0 || eventIndex >= batch.length) return null;
        return { valueKey, triggeredBy: batch[eventIndex].author ?? null };
      })
      .filter((t): t is TriggeredTile => t !== null);
  } catch (e) {
    console.error('[validation-core] Failed to parse eventIndex response:', text, e);
    return [];
  }
}
