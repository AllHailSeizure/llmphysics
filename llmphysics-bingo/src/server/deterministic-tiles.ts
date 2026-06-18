// Deterministic tile evaluators.
//
// Three bingo tiles are pure *counts*, not semantic judgments — and LLMs count
// unreliably (the em-dash tile fired at ~15 when its threshold is 40). These are
// decided in code instead. Everything fuzzy/contextual stays with Gemini; only the
// arithmetic lives here. Pure and side-effect-free so they unit-test directly.
//
// Parked sibling (see llmphysics-bot/ideas.md): a scope→prefilter→adjudicate pipeline
// for semantic tiles, to be adopted per-tile only if one proves flaky in live use.

import type { TriggeredTile } from './validation-core';
import type { BingoEvent } from './tiles';

/** A nested comment node (structurally the validator's ThreadNode). */
export type CommentNode = { author: string; body: string; replies: CommentNode[] };

/** Mod-log action strings that count as a comment removal (not user-deleted, not post removal). */
const REMOVAL_ACTIONS = new Set(['removecomment', 'spamcomment']);

/** A single post plus the data needed to evaluate the count-based tiles. */
export type CountedThread = {
  postId: string;
  opAuthor: string;
  title: string;
  body: string;
  comments: { author: string; body: string }[];
  /** mod-removal actions recorded against this post over its lifetime */
  modRemovals: number;
  /** depth-cap comment reports (automated bot reports with reason "Depth cap trigger") */
  depthCapReports: number;
};

const EM_DASH = '—';

/** Count em-dashes (—) only — not hyphens (-, U+002D) or en-dashes (–, U+2013). */
export function countEmDashes(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === EM_DASH) n++;
  return n;
}

/** 40+ em-dashes across the post body and all its comments combined. */
export function emDashEpidemic(t: CountedThread): boolean {
  let n = countEmDashes(t.body);
  for (const c of t.comments) n += countEmDashes(c.body);
  return n >= 40;
}

/** 50+ comments where OP plus one other user account for 75%+ of all comments. */
export function twoPersonWar(t: CountedThread): boolean {
  const total = t.comments.length;
  if (total < 50) return false;

  const tally = new Map<string, number>();
  for (const c of t.comments) tally.set(c.author, (tally.get(c.author) ?? 0) + 1);

  const opCount = tally.get(t.opAuthor) ?? 0;
  let maxOther = 0;
  for (const [author, count] of tally) {
    if (author !== t.opAuthor && count > maxOther) maxOther = count;
  }
  return (opCount + maxOther) / total >= 0.75;
}

/** 7+ comments removed via mod action within a single post. */
export function commentPurge(t: CountedThread): boolean {
  return t.modRemovals >= 7;
}

/** 120+ comments on a single post. */
export function commentExplosion(t: CountedThread): boolean {
  return t.comments.length >= 120;
}

/** 6+ depth-cap bot reports (reason "Depth cap trigger") recorded against a single post. */
export function depthCapSpiral(t: CountedThread): boolean {
  return t.depthCapReports >= 6;
}

/** Depth-first flatten of a nested comment tree into a flat list of {author, body}. */
export function flattenComments(nodes: CommentNode[]): { author: string; body: string }[] {
  const out: { author: string; body: string }[] = [];
  const walk = (ns: CommentNode[]) => {
    for (const n of ns) {
      out.push({ author: n.author, body: n.body });
      if (n.replies?.length) walk(n.replies);
    }
  };
  walk(nodes);
  return out;
}

/** Count comment-removal mod actions recorded against a given post. */
export function countModRemovals(events: BingoEvent[], postId: string): number {
  return events.filter(
    (e) =>
      e.type === 'mod_action' &&
      e.postId === postId &&
      typeof e.meta === 'string' &&
      REMOVAL_ACTIONS.has(e.meta.toLowerCase())
  ).length;
}

/** Count automated depth-cap bot reports (comment_report with reason "Depth cap trigger") for a post. */
export function countDepthCapReports(events: BingoEvent[], postId: string): number {
  return events.filter(
    (e) =>
      e.type === 'comment_report' &&
      e.postId === postId &&
      typeof e.meta === 'string' &&
      e.meta === 'Depth cap trigger'
  ).length;
}

/**
 * Build the count-based view of each post from the event log alone — no Reddit API fetch.
 * Groups comment_create events by postId; opAuthor and body come from the post_submit event.
 */
export function buildCountedThreadsFromEvents(events: BingoEvent[]): CountedThread[] {
  const postIds = new Set(events.map((e) => e.postId).filter((id): id is string => !!id));
  return [...postIds].map((postId) => {
    const postSubmit = events.find((e) => e.type === 'post_submit' && e.postId === postId);
    const commentEvents = events.filter((e) => e.type === 'comment_create' && e.postId === postId);
    return {
      postId,
      opAuthor: (postSubmit?.author ?? '').toLowerCase(),
      title: postSubmit?.title ?? '',
      body: postSubmit?.body ?? '',
      comments: commentEvents.map((e) => ({
        author: (e.author ?? '').toLowerCase(),
        body: e.body ?? '',
      })),
      modRemovals: countModRemovals(events, postId),
      depthCapReports: countDepthCapReports(events, postId),
    };
  });
}

/** A tile carrying a deterministic `validate` (the count-based tiles). */
export type DeterministicTile = {
  valueKey: string;
  validate?: (t: CountedThread) => boolean;
  /** Optional: when validate fires, return the username most responsible. null = community trigger. */
  attribute?: (t: CountedThread) => string | null;
};

/**
 * Find the author who contributed the most em-dashes in the thread.
 * Post body is attributed to opAuthor; each comment to its author.
 * Returns null if the thread has no em-dashes at all.
 */
export function dominantEmDashContributor(t: CountedThread): string | null {
  const byAuthor = new Map<string, number>();
  const postDashes = countEmDashes(t.body);
  if (postDashes > 0) byAuthor.set(t.opAuthor, postDashes);
  for (const c of t.comments) {
    const n = countEmDashes(c.body);
    if (n > 0) byAuthor.set(c.author, (byAuthor.get(c.author) ?? 0) + n);
  }
  let maxCount = 0;
  let dominant: string | null = null;
  for (const [author, count] of byAuthor) {
    if (count > maxCount) {
      maxCount = count;
      dominant = author;
    }
  }
  return dominant;
}

// ─── Keyword / phrase helpers ────────────────────────────────────────────────

function containsPhrase(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase());
}

function postContains(t: CountedThread, phrase: string): boolean {
  return containsPhrase(t.title, phrase) || containsPhrase(t.body, phrase);
}

function anyComment(t: CountedThread, pred: (body: string) => boolean): boolean {
  return t.comments.some((c) => pred(c.body.toLowerCase()));
}

// ─── Post-submit validators ──────────────────────────────────────────────────

export function tearMeApart(t: CountedThread): boolean {
  return containsPhrase(t.body, 'tear me apart');
}
export function coherenceDrop(t: CountedThread): boolean {
  return postContains(t, 'coher');
}
export function resonanceDrop(t: CountedThread): boolean {
  return postContains(t, 'resonan');
}
export function ontologyDrop(t: CountedThread): boolean {
  return postContains(t, 'ontol') || postContains(t, 'ontic');
}
export function consciousnessDrop(t: CountedThread): boolean {
  return postContains(t, 'consciousness');
}
export function frameworkDrop(t: CountedThread): boolean {
  return postContains(t, 'framework');
}
export function cosmologicalConstantDrop(t: CountedThread): boolean {
  return postContains(t, 'cosmological constant');
}
export function hubbleTensionDrop(t: CountedThread): boolean {
  return postContains(t, 'hubble tension');
}
export function toroidalDrop(t: CountedThread): boolean {
  return postContains(t, 'toroid');
}
export function fullyFalsifiableDrop(t: CountedThread): boolean {
  return postContains(t, 'falsif');
}
export function emergentDrop(t: CountedThread): boolean {
  return postContains(t, 'emerg');
}
export function scalarFieldDrop(t: CountedThread): boolean {
  return postContains(t, 'scalar field');
}
export function tensorDrop(t: CountedThread): boolean {
  return postContains(t, 'tensor');
}
export function lean4Proof(t: CountedThread): boolean {
  return postContains(t, 'lean 4') || postContains(t, 'lean4');
}

const UNFINISHED_PHRASES = [
  'incomplete', 'unfinished', 'rough draft', 'not fully developed',
  "isn't finished", "is not finished", 'not a finished',
];
export function unfinishedWorkDisclaimer(t: CountedThread): boolean {
  const body = t.body.toLowerCase();
  return UNFINISHED_PHRASES.some((p) => body.includes(p));
}

// ─── Comment validators ──────────────────────────────────────────────────────

export function dunningKrugerMention(t: CountedThread): boolean {
  return anyComment(t, (b) => b.includes('dunning') || b.includes('cognitive bias') || b.includes('path of ruin'));
}
export function notEvenWrong(t: CountedThread): boolean {
  return anyComment(t, (b) => b.includes('not even wrong'));
}
export function citationNeeded(t: CountedThread): boolean {
  return anyComment(t, (b) => b.includes('citation needed'));
}
export function whereMath(t: CountedThread): boolean {
  return t.comments.some((c) => /^where math[.?]?$/i.test(c.body.trim()));
}

const POSITIVE_QUESTION_ADJS = ['great', 'sharp', 'valuable', 'excellent', 'interesting', 'wonderful', 'fantastic', 'brilliant', 'insightful', 'important'];
export function thatsAGreatQuestion(t: CountedThread): boolean {
  return t.comments.some((c) => {
    const b = c.body.toLowerCase().trim();
    return POSITIVE_QUESTION_ADJS.some(
      (adj) =>
        b.startsWith(`that's a ${adj} question`) ||
        b.startsWith(`that is a ${adj} question`) ||
        b.startsWith(`thats a ${adj} question`) ||
        b.startsWith(`that's a really ${adj} question`) ||
        b.startsWith(`that is a really ${adj} question`)
    );
  });
}

/**
 * Evaluate the deterministic (count-based) tiles across the given threads. A tile fires
 * once if any thread meets its threshold. triggeredBy comes from the tile's `attribute` fn
 * if present; otherwise null (community trigger, never self-triggers). Tiles without a
 * `validate` are ignored here (they're semantic — handled by Gemini).
 */
export function evaluateDeterministic(tiles: DeterministicTile[], threads: CountedThread[]): TriggeredTile[] {
  const fired = new Map<string, CountedThread>();
  for (const t of threads) {
    for (const tile of tiles) {
      if (tile.validate && !fired.has(tile.valueKey) && tile.validate(t)) fired.set(tile.valueKey, t);
    }
  }
  return [...fired.entries()].map(([valueKey, thread]) => {
    const tile = tiles.find((t) => t.valueKey === valueKey)!;
    return { valueKey, triggeredBy: tile.attribute ? tile.attribute(thread) : null };
  });
}
