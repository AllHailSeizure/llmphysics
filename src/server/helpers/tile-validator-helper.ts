import { redis } from '@devvit/redis';
import { reddit } from '@devvit/web/server';

export type BingoEventType = 'post_submit' | 'comment_create' | 'post_delete' | 'post_report' | 'comment_report' | 'mod_action';

export type BingoEvent = {
  type: BingoEventType;
  ts: number;
  author?: string;
  title?: string;
  body?: string;
  postId?: string;
  meta?: string;
};

export type TileValidatorDefinition = {
  valueKey: string;
  label: string;
  description: string;
  examples: string[];
  edgeCaseGuidelines: string;
  relevantTypes: BingoEventType[];
};

export const TILE_VALIDATORS: TileValidatorDefinition[] = [
  {
    valueKey: 'test:comment',
    label: 'Someone commented "test"',
    description: 'A comment contains only the word "test" or starts with "test".',
    examples: [
      'test',
      'testing',
      'test123',
      'test to see if this works',
    ],
    edgeCaseGuidelines:
      'Do NOT count comments that only mention "test" inside a larger sentence (e.g. "this is a test of the broadcast system" or "testing the hypothesis that..."). The comment must be predominantly an isolated test, not a sentence that happens to use the word.',
    relevantTypes: ['comment_create'],
  },
];

export async function appendBingoEvent(
  gameId: string,
  event: BingoEvent
): Promise<void> {
  const key = `bot:bingo:game:${gameId}:events`;
  await redis.zAdd(key, { member: JSON.stringify(event), score: event.ts });
  await redis.zRemRangeByRank(key, 0, -1001);
  await redis.expire(key, 60 * 60 * 24 * 8);
}

// ─── Thread tree building ──────────────────────────────────────────────────────

type ThreadNode = { author: string; body: string; replies: ThreadNode[] };

type RawComment = {
  id?: string;
  authorName?: string;
  author?: { name?: string };
  body?: string;
  parentId?: string;
};

function buildThreadTree(comments: RawComment[]): ThreadNode[] {
  const wrapped = new Map<string, { node: ThreadNode; parentId: string }>();
  for (const c of comments) {
    if (!c?.id) continue;
    wrapped.set(c.id, {
      node: {
        author: c.authorName ?? c.author?.name ?? '?',
        body: c.body ?? '',
        replies: [],
      },
      parentId: c.parentId ?? '',
    });
  }
  const roots: ThreadNode[] = [];
  for (const { node, parentId } of wrapped.values()) {
    const parent = wrapped.get(parentId);
    if (parent) parent.node.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

async function fetchComments(postId: string): Promise<RawComment[]> {
  try {
    const result = await reddit.getComments({ postId, limit: 200 });
    if (result && typeof (result as { all?: unknown }).all === 'function') {
      return await (result as { all: () => Promise<RawComment[]> }).all();
    }
    if (Array.isArray(result)) return result as RawComment[];
    return [];
  } catch (err) {
    console.error(`getComments failed for ${postId}:`, err);
    return [];
  }
}

// ─── Batch validation ──────────────────────────────────────────────────────────

export async function runBatchValidation(
  geminiApiKey: string,
  gameId: string
): Promise<void> {
  console.log(`[bingo-batch] Starting validation for game ${gameId}`);

  const events = (await redis.zRange(`bot:bingo:game:${gameId}:events`, 0, -1))
    .map((e: { member: string }) => JSON.parse(e.member) as BingoEvent);
  console.log(`[bingo-batch] Events in queue: ${events.length}`);
  if (events.length === 0) {
    console.log('[bingo-batch] No events — skipping');
    return;
  }

  const pending = await Promise.all(
    TILE_VALIDATORS.map(async (t) => {
      const val = await redis.get(`bot:bingo:game:${gameId}:value:${t.valueKey}`);
      if (val !== '1') return t; // not yet triggered → include
      // Globally marked — re-check only if a self-trigger is on record (may be superseded later)
      const by = await redis.get(`bot:bingo:game:${gameId}:triggered-by:${t.valueKey}`);
      console.log(`[bingo-batch] Tile "${t.valueKey}" already marked — triggered-by: ${by ?? '(none, community-triggered)'}`);
      return by ? t : null; // self-triggered → re-check; community-triggered → skip
    })
  );
  const untriggered = pending.filter(Boolean) as TileValidatorDefinition[];
  console.log(`[bingo-batch] Tiles to validate: ${untriggered.map((t) => t.valueKey).join(', ') || 'none'}`);
  if (untriggered.length === 0) {
    console.log('[bingo-batch] All tiles already community-triggered — nothing to do');
    return;
  }

  // Fetch live comment trees for every post in this game.
  const postIds: string[] = await redis.hKeys(`bot:bingo:game:${gameId}:posts`);
  const postEvents = events.filter((e: BingoEvent) => e.type === 'post_submit');
  const threads = await Promise.all(
    postIds.map(async (postId) => {
      const meta = postEvents.find((e: BingoEvent) => e.postId === postId);
      const comments = await fetchComments(postId);
      return {
        postId,
        title: meta?.title ?? '',
        body: meta?.body ?? '',
        comments: buildThreadTree(comments),
      };
    })
  );

  const threadData =
    threads.length > 0 ? JSON.stringify(threads, null, 1) : '(no post threads captured)';

  // Raw events still cover injected test events and signals (reports, mod actions)
  // that have no comment-tree representation.
  const eventSummary = events
    .map((e: BingoEvent) => `[${e.type}] author=${e.author ?? '?'} title=${e.title ?? ''} body=${e.body ?? ''} meta=${e.meta ?? ''}`)
    .join('\n');

  const tileList = untriggered
    .map((t) => {
      const exStr = t.examples.map((ex) => `    • ${ex}`).join('\n');
      return `- valueKey: "${t.valueKey}"
  Description: ${t.description}
  Examples of valid triggers:
${exStr}
  Do NOT count: ${t.edgeCaseGuidelines}`;
    })
    .join('\n\n');

  const prompt = `You are analyzing Reddit sub activity for a bingo game.
Return ONLY a JSON array of objects for tiles that have been triggered by the activity below.
Each object: {"valueKey": "...", "triggeredBy": "reddit_username_or_null"}
For each triggered tile, set triggeredBy to the Reddit username whose content most recently triggered it.
If multiple users triggered the same tile, return the MOST RECENT author.
If the triggering content has no clear individual author (e.g. a mod action or bot event), set triggeredBy to null.
If no tiles are triggered, return [].

CRITICAL RULE: If activity is ambiguous or could be interpreted multiple ways, follow the examples and "Do NOT count" guidelines. ERR ON THE SIDE OF NOT TRIGGERING a tile unless you are very confident it matches.

TILES TO CHECK:
${tileList}

THREAD DATA (posts with nested comment trees, each comment includes author and body):
${threadData}

RAW EVENTS (signals + any injected test events, each includes author):
${eventSummary}

Respond with ONLY valid JSON. Example: [{"valueKey":"tile:one","triggeredBy":"someuser"},{"valueKey":"tile:two","triggeredBy":null}]`;

  console.log(`[bingo-batch] Sending ${untriggered.length} tile(s) to Gemini for validation`);

  if (!geminiApiKey) {
    console.error('[bingo-batch] No Gemini API key provided');
    return;
  }

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
    console.error(`[bingo-batch] Gemini error (${res.status}): ${errorBody}`);
    return;
  }

  const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  console.log(`[bingo-batch] Gemini raw response: ${text}`);

  type TriggeredTile = { valueKey: string; triggeredBy: string | null };
  let triggered: TriggeredTile[] = [];
  try {
    const raw = JSON.parse(text.match(/\[.*\]/s)?.[0] ?? '[]');
    if (Array.isArray(raw)) {
      // Accept both new object format and old string[] format gracefully
      triggered = raw.map((item: unknown) =>
        typeof item === 'string'
          ? { valueKey: item, triggeredBy: null }
          : (item as TriggeredTile)
      );
    }
  } catch (e) {
    console.error('[bingo-batch] Gemini response parse error:', text, e);
    return;
  }

  console.log(`[bingo-batch] Gemini triggered ${triggered.length} tile(s): ${triggered.map((t) => `${t.valueKey} by ${t.triggeredBy ?? 'null'}`).join(', ') || 'none'}`);

  const TILE_TTL = 60 * 60 * 24 * 8;
  for (const { valueKey, triggeredBy } of triggered) {
    if (!TILE_VALIDATORS.some((t) => t.valueKey === valueKey)) continue;

    const globalKey = `bot:bingo:game:${gameId}:value:${valueKey}`;
    const byKey = `bot:bingo:game:${gameId}:triggered-by:${valueKey}`;

    // Always mark the tile globally (shows as marked for all players)
    await redis.set(globalKey, '1');
    await redis.expire(globalKey, TILE_TTL);

    // Normalize username: strip "u/" prefix and lowercase (Reddit names are case-insensitive)
    const author = triggeredBy?.replace(/^u\//, '').toLowerCase() || null;

    const existingSelfTrigger = await redis.get(byKey);

    if (existingSelfTrigger && author && author !== existingSelfTrigger) {
      // A different author triggered it this pass → community has now triggered it.
      // Lift the self-trigger restriction so the original self-triggerer can also win.
      await redis.del(byKey);
      console.log(`[bingo-batch] Tile "${valueKey}" restriction lifted — community trigger by ${author}`);
    } else if (!existingSelfTrigger && author) {
      // First trigger with a known author → record it (may be a self-trigger)
      await redis.set(byKey, author);
      await redis.expire(byKey, TILE_TTL);
      console.log(`[bingo-batch] Tile "${valueKey}" first trigger recorded — triggered-by: ${author}`);
    }
    // If existingSelfTrigger === author → same person again, no change needed
    // If author is null → no clear author (mod action etc.) → don't record
  }
}
