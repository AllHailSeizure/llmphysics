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
  redis: any,
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

function buildThreadTree(comments: any[]): ThreadNode[] {
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

async function fetchComments(reddit: any, postId: string): Promise<any[]> {
  try {
    const result: any = await reddit.getComments({ postId, limit: 200 });
    if (result && typeof result.all === 'function') return await result.all();
    if (Array.isArray(result)) return result;
    return [];
  } catch (err) {
    console.error(`getComments failed for ${postId}:`, err);
    return [];
  }
}

// ─── Batch validation ──────────────────────────────────────────────────────────

export async function runBatchValidation(
  redis: any,
  reddit: any,
  geminiApiKey: string,
  gameId: string
): Promise<void> {
  const events = (await redis.zRange(`bot:bingo:game:${gameId}:events`, 0, -1))
    .map((e: { member: string }) => JSON.parse(e.member) as BingoEvent);
  if (events.length === 0) return;

  const pending = await Promise.all(
    TILE_VALIDATORS.map(async (t) => {
      const val = await redis.get(`bot:bingo:game:${gameId}:value:${t.valueKey}`);
      return val === '1' ? null : t;
    })
  );
  const untriggered = pending.filter(Boolean) as TileValidatorDefinition[];
  if (untriggered.length === 0) return;

  // Fetch live comment trees for every post in this game.
  const postIds: string[] = await redis.hKeys(`bot:bingo:game:${gameId}:posts`);
  const postEvents = events.filter((e: BingoEvent) => e.type === 'post_submit');
  const threads = await Promise.all(
    postIds.map(async (postId) => {
      const meta = postEvents.find((e: BingoEvent) => e.postId === postId);
      const comments = await fetchComments(reddit, postId);
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
Return ONLY a JSON array of valueKey strings for tiles that have been triggered by the activity below.
If no tiles are triggered, return [].

CRITICAL RULE: If activity is ambiguous or could be interpreted multiple ways, follow the examples and "Do NOT count" guidelines. ERR ON THE SIDE OF NOT TRIGGERING a tile unless you are very confident it matches.

TILES TO CHECK:
${tileList}

THREAD DATA (posts with nested comment trees):
${threadData}

RAW EVENTS (signals + any injected test events):
${eventSummary}

Respond with ONLY valid JSON. Example: ["tile:one","tile:two"]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

  let triggered: string[] = [];
  try {
    triggered = JSON.parse(text.match(/\[.*\]/s)?.[0] ?? '[]');
  } catch {
    console.error('Gemini response parse error:', text);
    return;
  }

  for (const valueKey of triggered) {
    if (TILE_VALIDATORS.some((t) => t.valueKey === valueKey)) {
      const key = `bot:bingo:game:${gameId}:value:${valueKey}`;
      await redis.set(key, '1');
      await redis.expire(key, 60 * 60 * 24 * 8);
    }
  }
}
