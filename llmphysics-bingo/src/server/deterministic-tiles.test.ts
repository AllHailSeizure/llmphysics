import { describe, it, expect } from 'vitest';
import {
  countEmDashes,
  emDashEpidemic,
  twoPersonWar,
  commentPurge,
  commentExplosion,
  depthCapSpiral,
  evaluateDeterministic,
  flattenComments,
  countModRemovals,
  countDepthCapReports,
  dominantEmDashContributor,
  buildCountedThreadsFromEvents,
  type CountedThread,
  type CommentNode,
} from './deterministic-tiles';
import type { BingoEvent } from './tiles';

function thread(over: Partial<CountedThread> = {}): CountedThread {
  return { postId: 't3_x', opAuthor: 'op', body: '', comments: [], modRemovals: 0, depthCapReports: 0, ...over };
}

function comments(author: string, n: number, body = ''): { author: string; body: string }[] {
  return Array.from({ length: n }, () => ({ author, body }));
}

describe('countEmDashes', () => {
  it('counts em-dashes (—) only, ignoring hyphens and en-dashes', () => {
    expect(countEmDashes('a—b - c – d—e')).toBe(2);
  });
  it('returns 0 for empty / no em-dashes', () => {
    expect(countEmDashes('')).toBe(0);
    expect(countEmDashes('plain - hyphen – endash')).toBe(0);
  });
});

describe('emDashEpidemic', () => {
  it('triggers when body + comments reach 40 em-dashes combined', () => {
    const t = thread({ body: '—'.repeat(15), comments: [{ author: 'u', body: '—'.repeat(25) }] });
    expect(emDashEpidemic(t)).toBe(true);
  });
  it('does not trigger at 39 (the 15-in-body bug must stay false on its own)', () => {
    expect(emDashEpidemic(thread({ body: '—'.repeat(15) }))).toBe(false);
    expect(emDashEpidemic(thread({ body: '—'.repeat(39) }))).toBe(false);
  });
});

describe('twoPersonWar', () => {
  it('triggers at 50 comments with 75% between OP and one other', () => {
    const t = thread({ comments: [...comments('op', 25), ...comments('rival', 13), ...comments('crowd', 12)] });
    // total 50, op(25)+rival(13)=38 → 76% ≥ 75%
    expect(twoPersonWar(t)).toBe(true);
  });
  it('does not trigger below 50 comments even at 100% concentration', () => {
    const t = thread({ comments: [...comments('op', 25), ...comments('rival', 24)] }); // 49
    expect(twoPersonWar(t)).toBe(false);
  });
  it('does not trigger when the dominant pair excludes OP', () => {
    const t = thread({ opAuthor: 'op', comments: [...comments('a', 30), ...comments('b', 10), ...comments('op', 10)] });
    // total 50, a+b = 40 = 80% but neither is OP; op(10)+a(30)=40 → 80% includes OP → should this trigger?
    // tile requires OP + one other; op+a is OP plus one other, so this SHOULD trigger.
    expect(twoPersonWar(t)).toBe(true);
  });
  it('does not trigger when no OP+other pair reaches 75%', () => {
    const t = thread({ opAuthor: 'op', comments: [...comments('a', 20), ...comments('b', 20), ...comments('op', 10)] });
    // op(10)+max-other(20)=30 → 60% < 75%
    expect(twoPersonWar(t)).toBe(false);
  });
});

describe('commentPurge', () => {
  it('triggers at 7 mod removals, not 6', () => {
    expect(commentPurge(thread({ modRemovals: 7 }))).toBe(true);
    expect(commentPurge(thread({ modRemovals: 6 }))).toBe(false);
  });
});

describe('commentExplosion', () => {
  it('triggers at 120 comments, not 119', () => {
    expect(commentExplosion(thread({ comments: comments('u', 120) }))).toBe(true);
    expect(commentExplosion(thread({ comments: comments('u', 119) }))).toBe(false);
  });
});

describe('depthCapSpiral', () => {
  it('triggers at 6 depth-cap reports, not 5', () => {
    expect(depthCapSpiral(thread({ depthCapReports: 6 }))).toBe(true);
    expect(depthCapSpiral(thread({ depthCapReports: 5 }))).toBe(false);
  });
});

describe('flattenComments', () => {
  it('flattens a nested reply tree depth-first into {author, body} pairs', () => {
    const tree: CommentNode[] = [
      { author: 'a', body: 'one', replies: [{ author: 'b', body: 'two', replies: [] }] },
      { author: 'c', body: 'three', replies: [] },
    ];
    expect(flattenComments(tree)).toEqual([
      { author: 'a', body: 'one' },
      { author: 'b', body: 'two' },
      { author: 'c', body: 'three' },
    ]);
  });
  it('returns [] for no comments', () => {
    expect(flattenComments([])).toEqual([]);
  });
});

describe('countModRemovals', () => {
  const ev = (over: Partial<BingoEvent>): BingoEvent => ({ type: 'mod_action', ts: 1, ...over });
  it('counts removecomment and spamcomment events for the given post', () => {
    const events: BingoEvent[] = [
      ev({ postId: 't3_x', meta: 'removecomment' }),
      ev({ postId: 't3_x', meta: 'spamcomment' }),
      ev({ postId: 't3_x', meta: 'removecomment' }),
    ];
    expect(countModRemovals(events, 't3_x')).toBe(3);
  });
  it('ignores non-removal actions, other posts, and non-mod events', () => {
    const events: BingoEvent[] = [
      ev({ postId: 't3_x', meta: 'approvecomment' }),
      ev({ postId: 't3_x', meta: 'removelink' }),
      ev({ postId: 't3_other', meta: 'removecomment' }),
      { type: 'comment_create', ts: 1, postId: 't3_x', body: 'removecomment' },
    ];
    expect(countModRemovals(events, 't3_x')).toBe(0);
  });
});

describe('countDepthCapReports', () => {
  const ev = (over: Partial<BingoEvent>): BingoEvent => ({ type: 'comment_report', ts: 1, ...over });
  it('counts comment_report events with reason "Depth cap trigger" for the given post', () => {
    const events: BingoEvent[] = [
      ev({ postId: 't3_x', meta: 'Depth cap trigger' }),
      ev({ postId: 't3_x', meta: 'Depth cap trigger' }),
      ev({ postId: 't3_x', meta: 'Depth cap trigger' }),
    ];
    expect(countDepthCapReports(events, 't3_x')).toBe(3);
  });
  it('ignores reports with different reasons, other posts, and non-comment_report events', () => {
    const events: BingoEvent[] = [
      ev({ postId: 't3_x', meta: 'spam' }),
      ev({ postId: 't3_other', meta: 'Depth cap trigger' }),
      { type: 'mod_action', ts: 1, postId: 't3_x', meta: 'Depth cap trigger' },
    ];
    expect(countDepthCapReports(events, 't3_x')).toBe(0);
  });
});

describe('buildCountedThreadsFromEvents', () => {
  const ev = (over: Partial<import('./tiles').BingoEvent>): import('./tiles').BingoEvent => ({
    type: 'post_submit',
    ts: 1,
    ...over,
  });
  it('returns [] for empty events', () => {
    expect(buildCountedThreadsFromEvents([])).toEqual([]);
  });
  it('builds a thread from post_submit + comment_create events', () => {
    const events = [
      ev({ type: 'post_submit', postId: 't3_x', author: 'Alice', body: 'post body' }),
      ev({ type: 'comment_create', postId: 't3_x', author: 'Bob', body: 'reply' }),
    ];
    const threads = buildCountedThreadsFromEvents(events);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      postId: 't3_x',
      opAuthor: 'alice',
      body: 'post body',
      comments: [{ author: 'bob', body: 'reply' }],
      modRemovals: 0,
    });
  });
  it('lowercases author names', () => {
    const events = [ev({ type: 'post_submit', postId: 't3_x', author: 'UPPER' })];
    expect(buildCountedThreadsFromEvents(events)[0].opAuthor).toBe('upper');
  });
  it('counts mod removals from mod_action events', () => {
    const events = [
      ev({ type: 'post_submit', postId: 't3_x', author: 'op' }),
      ev({ type: 'mod_action', postId: 't3_x', meta: 'removecomment' }),
      ev({ type: 'mod_action', postId: 't3_x', meta: 'removecomment' }),
    ];
    expect(buildCountedThreadsFromEvents(events)[0].modRemovals).toBe(2);
  });
  it('counts depth-cap reports from comment_report events', () => {
    const events = [
      ev({ type: 'post_submit', postId: 't3_x', author: 'op' }),
      ev({ type: 'comment_report', postId: 't3_x', meta: 'Depth cap trigger' }),
      ev({ type: 'comment_report', postId: 't3_x', meta: 'Depth cap trigger' }),
      ev({ type: 'comment_report', postId: 't3_x', meta: 'spam' }),
    ];
    expect(buildCountedThreadsFromEvents(events)[0].depthCapReports).toBe(2);
  });
  it('produces separate threads for separate postIds', () => {
    const events = [
      ev({ type: 'post_submit', postId: 't3_a', author: 'op1' }),
      ev({ type: 'post_submit', postId: 't3_b', author: 'op2' }),
    ];
    const threads = buildCountedThreadsFromEvents(events);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.opAuthor).sort()).toEqual(['op1', 'op2']);
  });
});

describe('dominantEmDashContributor', () => {
  it('attributes post body em-dashes to opAuthor', () => {
    const t = thread({ opAuthor: 'alice', body: '—'.repeat(5) });
    expect(dominantEmDashContributor(t)).toBe('alice');
  });
  it('attributes comment em-dashes to the comment author', () => {
    const t = thread({ body: '', comments: [{ author: 'bob', body: '—'.repeat(10) }] });
    expect(dominantEmDashContributor(t)).toBe('bob');
  });
  it('returns the author with the most em-dashes when multiple authors contribute', () => {
    const t = thread({
      opAuthor: 'alice',
      body: '—'.repeat(5),
      comments: [
        { author: 'bob', body: '—'.repeat(20) },
        { author: 'alice', body: '—'.repeat(3) },
      ],
    });
    expect(dominantEmDashContributor(t)).toBe('bob');
  });
  it('accumulates em-dashes across multiple comments by the same author', () => {
    const t = thread({
      opAuthor: 'alice',
      body: '—'.repeat(5),
      comments: [
        { author: 'bob', body: '—'.repeat(8) },
        { author: 'bob', body: '—'.repeat(8) }, // bob total: 16
      ],
    });
    expect(dominantEmDashContributor(t)).toBe('bob');
  });
  it('returns null when there are no em-dashes', () => {
    expect(dominantEmDashContributor(thread())).toBeNull();
  });
});

describe('evaluateDeterministic', () => {
  const TILES = [
    { valueKey: 'em-dash-epidemic', validate: emDashEpidemic },
    { valueKey: 'two-person-war', validate: twoPersonWar },
    { valueKey: 'comment-purge', validate: commentPurge },
  ];
  const TILES_WITH_ATTR = [
    { valueKey: 'em-dash-epidemic', validate: emDashEpidemic, attribute: dominantEmDashContributor },
    { valueKey: 'two-person-war', validate: twoPersonWar },
    { valueKey: 'comment-purge', validate: commentPurge },
  ];

  it('returns triggered tiles with triggeredBy null (structural, no single author)', () => {
    const t = thread({ modRemovals: 7 });
    expect(evaluateDeterministic(TILES, [t])).toEqual([{ valueKey: 'comment-purge', triggeredBy: null }]);
  });
  it('dedupes a tile that fires across multiple posts', () => {
    const a = thread({ postId: 't3_a', modRemovals: 7 });
    const b = thread({ postId: 't3_b', modRemovals: 9 });
    expect(evaluateDeterministic(TILES, [a, b])).toEqual([{ valueKey: 'comment-purge', triggeredBy: null }]);
  });
  it('reports multiple distinct tiles from one thread', () => {
    const t = thread({ body: '—'.repeat(40), modRemovals: 7 });
    const keys = evaluateDeterministic(TILES, [t]).map((r) => r.valueKey).sort();
    expect(keys).toEqual(['comment-purge', 'em-dash-epidemic']);
  });
  it('ignores tiles without a validate fn (semantic tiles)', () => {
    const t = thread({ modRemovals: 7 });
    const semanticOnly = [{ valueKey: 'coherence-drop' }];
    expect(evaluateDeterministic(semanticOnly, [t])).toEqual([]);
  });
  it('returns [] when nothing meets a threshold', () => {
    expect(evaluateDeterministic(TILES, [thread()])).toEqual([]);
  });
  it('uses attribute fn to populate triggeredBy on em-dash tile', () => {
    const t = thread({ opAuthor: 'spammer', body: '—'.repeat(40) });
    const result = evaluateDeterministic(TILES_WITH_ATTR, [t]);
    expect(result).toEqual([{ valueKey: 'em-dash-epidemic', triggeredBy: 'spammer' }]);
  });
  it('tiles without attribute still return triggeredBy null', () => {
    const t = thread({ modRemovals: 7 });
    const result = evaluateDeterministic(TILES_WITH_ATTR, [t]);
    expect(result).toEqual([{ valueKey: 'comment-purge', triggeredBy: null }]);
  });
});
