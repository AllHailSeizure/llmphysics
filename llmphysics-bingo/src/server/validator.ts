import { redis } from '@devvit/redis';
import { TILE_VALIDATORS, type BingoEvent, type TileValidatorDefinition } from './tiles';
import {
  buildPostBatchPrompt,
  buildCommentBatchPrompt,
  parseEventIndexResponse,
  type TriggeredTile,
} from './validation-core';
import { evaluateDeterministic, buildCountedThreadsFromEvents } from './deterministic-tiles';

/** Semantic tiles only — tiles carrying a `validate` fn are counted in code, not by Gemini. */
const SEMANTIC_TILES = TILE_VALIDATORS.filter((t) => !t.validate);

/** Semantic tiles that check post content (post_submit events). */
const POST_TILES = SEMANTIC_TILES.filter((t) => t.relevantTypes.includes('post_submit'));

/** Semantic tiles that check comment content (comment_create events). lean4-proof is in both. */
const COMMENT_TILES = SEMANTIC_TILES.filter((t) => t.relevantTypes.includes('comment_create'));

const TRIGGER_TTL = 60 * 60 * 24 * 8;

/** Record the wall-clock time a tile first triggered (idempotent — first write wins). */
export async function recordFirstTrigger(gameId: string, valueKey: string, ts: number): Promise<void> {
  const atKey = `bot:bingo:game:${gameId}:triggered-at:${valueKey}`;
  if ((await redis.get(atKey)) == null) {
    await redis.set(atKey, String(ts));
    await redis.expire(atKey, TRIGGER_TTL);
  }
}

export async function appendBingoEvent(
  gameId: string,
  event: BingoEvent
): Promise<void> {
  const key = `bot:bingo:game:${gameId}:events`;
  await redis.zAdd(key, { member: JSON.stringify(event), score: event.ts });
  await redis.zRemRangeByRank(key, 0, -1001);
  await redis.expire(key, 60 * 60 * 24 * 8);
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

/** One Gemini round-trip: send a pre-built prompt, parse eventIndex results against the batch. */
async function callGeminiBatch(
  geminiApiKey: string,
  prompt: string,
  batch: BingoEvent[]
): Promise<TriggeredTile[]> {
  if (!geminiApiKey || batch.length === 0) return [];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[bingo-validate] Gemini error (${res.status}): ${errorBody}`);
    return [];
  }

  const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  console.log(`[bingo-validate] Gemini raw response: ${text}`);

  return parseEventIndexResponse(text, batch);
}

// ─── postFilter ──────────────────────────────────────────────────────────────

/**
 * Apply tile-level postFilters to semantic results. Builds an opAuthors set from post_submit
 * events and drops any result whose tile has a postFilter that returns false.
 * Used for OP-identity tiles — Gemini identifies what was said; code verifies who said it.
 */
function applyPostFilters(results: TriggeredTile[], events: BingoEvent[]): TriggeredTile[] {
  const opAuthors = new Set(
    events
      .filter((e) => e.type === 'post_submit')
      .map((e) => (e.author ?? '').toLowerCase())
  );
  return results.filter(({ valueKey, triggeredBy }) => {
    const tile = TILE_VALIDATORS.find((t) => t.valueKey === valueKey);
    return !tile?.postFilter || tile.postFilter(triggeredBy, opAuthors);
  });
}

// ─── Stateless validation seam ───────────────────────────────────────────────
// Pure, live-state-free pieces shared by the live batch (runBatchValidation) and the
// detached test harness (evaluateTestEvents). Neither helper reads or writes any
// `bot:bingo:game:*` key — callers own all state.

/**
 * Run semantic Gemini batches against a set of events. Tiles filter by relevantTypes.
 * contextEvents is used to build post-flair context for the comments batch — pass the full
 * game event list when `events` is a subset (e.g. only untested events).
 */
async function runSemanticBatches(
  geminiApiKey: string,
  tiles: TileValidatorDefinition[],
  events: BingoEvent[],
  contextEvents?: BingoEvent[]
): Promise<TriggeredTile[]> {
  const postTiles = tiles.filter((t) => t.relevantTypes.includes('post_submit'));
  const commentTiles = tiles.filter((t) => t.relevantTypes.includes('comment_create'));
  const postEvents = events.filter((e) => e.type === 'post_submit');
  const commentEvents = events.filter((e) => e.type === 'comment_create');
  const contextPostEvents = (contextEvents ?? events).filter((e) => e.type === 'post_submit');

  const [postResults, commentResults] = await Promise.all([
    postTiles.length > 0 && postEvents.length > 0
      ? callGeminiBatch(geminiApiKey, buildPostBatchPrompt(postTiles, postEvents), postEvents)
      : Promise.resolve([]),
    commentTiles.length > 0 && commentEvents.length > 0
      ? callGeminiBatch(
          geminiApiKey,
          buildCommentBatchPrompt(commentTiles, commentEvents, contextPostEvents),
          commentEvents
        )
      : Promise.resolve([]),
  ]);

  return [...postResults, ...commentResults];
}

/**
 * Evaluate a set of events against ALL tiles, completely detached from any live game.
 * Used by the Direct Inject Test harness — all events are treated as untested.
 * Calls Gemini and returns what triggered. Writes nothing.
 */
export async function evaluateTestEvents(
  geminiApiKey: string,
  events: BingoEvent[]
): Promise<TriggeredTile[]> {
  if (events.length === 0) return [];

  const deterministic = evaluateDeterministic(TILE_VALIDATORS, buildCountedThreadsFromEvents(events));
  const semantic = applyPostFilters(await runSemanticBatches(geminiApiKey, SEMANTIC_TILES, events), events);
  return [...semantic, ...deterministic];
}

// ─── Batch validation ─────────────────────────────────────────────────────────

export async function runBatchValidation(
  geminiApiKey: string,
  gameId: string
): Promise<void> {
  console.log(`[bingo-batch] Starting validation for game ${gameId}`);

  const events = (await redis.zRange(`bot:bingo:game:${gameId}:events`, 0, -1))
    .map((e: { member: string }) => JSON.parse(e.member) as BingoEvent);
  console.log(`[bingo-batch] Events in queue: ${events.length}`);
  events.forEach((e, i) => console.log(`[bingo-batch] Event[${i}] type=${e.type} author=${e.author ?? '?'} body=${(e.body ?? '').slice(0, 80)}`));
  if (events.length === 0) {
    console.log('[bingo-batch] No events — skipping');
    return;
  }

  // Which *semantic* tiles still need Gemini? (Count-based tiles are evaluated in code below
  // every batch, regardless — they can newly cross their threshold at any time.)
  const pending = await Promise.all(
    SEMANTIC_TILES.map(async (t) => {
      const val = await redis.get(`bot:bingo:game:${gameId}:value:${t.valueKey}`);
      if (val !== '1') return t;
      const by = await redis.get(`bot:bingo:game:${gameId}:triggered-by:${t.valueKey}`);
      console.log(`[bingo-batch] Tile "${t.valueKey}" already marked — triggered-by: ${by ?? '(none, community-triggered)'}`);
      return by ? t : null;
    })
  );
  const untriggered = pending.filter(Boolean) as TileValidatorDefinition[];
  console.log(`[bingo-batch] Semantic tiles to validate: ${untriggered.map((t) => t.valueKey).join(', ') || 'none'}`);

  // Deterministic (code-counted) tiles — em-dash, two-person-war, comment-purge.
  const deterministic = evaluateDeterministic(TILE_VALIDATORS, buildCountedThreadsFromEvents(events));
  if (deterministic.length) {
    console.log(`[bingo-batch] Deterministic triggered ${deterministic.length} tile(s): ${deterministic.map((t) => t.valueKey).join(', ')}`);
  }

  // Semantic (Gemini) tiles — only the events we haven't checked before (untested cursor).
  let semanticTriggered: TriggeredTile[] = [];
  if (untriggered.length > 0) {
    const lastTs = Number((await redis.get(`bot:bingo:game:${gameId}:last-validated-ts`)) ?? '0');
    const untestedEvents = events.filter((e) => e.ts > lastTs);
    console.log(`[bingo-batch] Untested events since ts=${lastTs}: ${untestedEvents.length}`);

    if (untestedEvents.length > 0) {
      console.log(`[bingo-batch] Sending untested events to Gemini (${untriggered.length} tile(s))`);
      semanticTriggered = applyPostFilters(
        await runSemanticBatches(geminiApiKey, untriggered, untestedEvents, events),
        events
      );
      console.log(`[bingo-batch] Gemini triggered ${semanticTriggered.length} tile(s): ${semanticTriggered.map((t) => `${t.valueKey} by ${t.triggeredBy ?? 'null'}`).join(', ') || 'none'}`);
    } else {
      console.log('[bingo-batch] No untested events — skipping Gemini');
    }
  } else {
    console.log('[bingo-batch] All semantic tiles already community-triggered — skipping Gemini');
  }

  const triggered = [...semanticTriggered, ...deterministic];

  const TILE_TTL = 60 * 60 * 24 * 8;
  for (const { valueKey, triggeredBy } of triggered) {
    if (!TILE_VALIDATORS.some((t) => t.valueKey === valueKey)) continue;

    const globalKey = `bot:bingo:game:${gameId}:value:${valueKey}`;
    const byKey = `bot:bingo:game:${gameId}:triggered-by:${valueKey}`;

    await redis.set(globalKey, '1');
    await redis.expire(globalKey, TILE_TTL);
    await recordFirstTrigger(gameId, valueKey, Date.now());

    const author = triggeredBy?.replace(/^u\//, '').toLowerCase() || null;
    const existingSelfTrigger = await redis.get(byKey);

    if (existingSelfTrigger && author && author !== existingSelfTrigger) {
      await redis.del(byKey);
      console.log(`[bingo-batch] Tile "${valueKey}" restriction lifted — community trigger by ${author}`);
    } else if (!existingSelfTrigger && author) {
      await redis.set(byKey, author);
      await redis.expire(byKey, TILE_TTL);
      console.log(`[bingo-batch] Tile "${valueKey}" first trigger recorded — triggered-by: ${author}`);
    }
  }

  // Advance the untested cursor so the next batch only sees new events.
  await redis.set(`bot:bingo:game:${gameId}:last-validated-ts`, String(Date.now()));
  await redis.expire(`bot:bingo:game:${gameId}:last-validated-ts`, TRIGGER_TTL);
}
