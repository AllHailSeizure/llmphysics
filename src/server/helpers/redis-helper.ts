import { redis } from '@devvit/web/server';

// ─── Post tracking (hash-based) ───────────────────────────────────────────────
// One hash per Reddit post. The flood moderator owns the quota fields and the
// quota evaluation; the bingo game tags posts with their game. The hash itself
// is a record of a post, not a flood-moderator artifact.

export interface FloodIgnoreSettings {
  ignoreDeleted: boolean;
  ignoreRemoved: boolean;
  ignoreAutoRemoved: boolean;
  ignoreModerators: boolean;
  ignoreContributors: boolean;
}

export interface FloodStatusPost {
  id: string;
  createdAt: Date;
  url: string;
  includedInQuota: boolean;
}

export interface FloodStatus {
  validPostCount: number;
  maxPosts: number;
  windowHours: number;
  exceedsQuota: boolean;
  nextPostTime: Date | null;
  validPosts: FloodStatusPost[];
}

// Key schema (string literals kept as-is so existing Redis data is not orphaned):
//   flood:post:{postId}  — Hash: userId, createdAt, isModerator, isApprovedUser,
//                          isUserDeleted, isModRemoved, isAutoRemoved, gameId
//   flood:posts          — Global sorted set, score = createdAt ms, member = postId
const postKey = (postId: string) => `flood:post:${postId}`;
const POSTS_KEY = 'flood:posts';

// Fixed buffer — longer than any reasonable quota window or game length so neither
// the flood quota nor the bingo game loses history. Quota math is window-based
// (zRemRangeByScore + zRange), so a longer TTL never affects it.
const POST_TTL_SECONDS = 8 * 24 * 60 * 60;

export async function trackPost(
  userId: string,
  postId: string,
  createdAt: Date,
  isModerator: boolean,
  isApprovedUser: boolean,
): Promise<void> {
  await Promise.all([
    redis.hSet(postKey(postId), {
      userId,
      createdAt: String(createdAt.getTime()),
      isModerator: isModerator ? '1' : '0',
      isApprovedUser: isApprovedUser ? '1' : '0',
      isUserDeleted: '0',
      isModRemoved: '0',
      isAutoRemoved: '0',
    }).then(() => redis.expire(postKey(postId), POST_TTL_SECONDS)),
    redis.zAdd(POSTS_KEY, { member: postId, score: createdAt.getTime() }),
  ]);
}

export async function markPostDeleted(postId: string): Promise<void> {
  await redis.hSet(postKey(postId), { isUserDeleted: '1' });
}

export async function markPostModRemoved(postId: string): Promise<void> {
  await redis.hSet(postKey(postId), { isModRemoved: '1' });
}

export async function markPostAutoRemoved(postId: string): Promise<void> {
  await redis.hSet(postKey(postId), { isAutoRemoved: '1' });
}

// ─── Bingo game association ───────────────────────────────────────────────────

export async function tagPostWithGame(postId: string, gameId: string): Promise<void> {
  await redis.hSet(postKey(postId), { gameId });
  // A function that can create a key owns that key's TTL. trackPost normally
  // creates the hash first, but if it never ran (e.g. the poster could not be
  // resolved) this hSet is the first writer — so set the TTL unconditionally.
  await redis.expire(postKey(postId), POST_TTL_SECONDS);
}

export async function getPostGameId(postId: string): Promise<string | null> {
  const val = await redis.hGet(postKey(postId), 'gameId');
  return val ?? null;
}

export async function evaluateFloodStatus(
  userId: string,
  username: string,
  maxPosts: number,
  windowHours: number,
  ignoreSettings: FloodIgnoreSettings,
  currentPostId?: string,
): Promise<FloodStatus> {
  const now = new Date();
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;

  // Prune entries outside the window, then fetch everything inside it
  await redis.zRemRangeByScore(POSTS_KEY, 0, cutoff - 1);
  const entries = await redis.zRange(POSTS_KEY, cutoff, now.getTime(), { by: 'score' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postIds = entries.map((e: any) => (typeof e === 'string' ? e : (e as { member: string }).member));

  // Fetch all hashes in parallel, filter for this user's posts
  const hashes = await Promise.all(
    postIds.map(async (postId: string) => {
      const hash = await redis.hGetAll(postKey(postId));
      return hash && Object.keys(hash).length > 0 ? { postId, hash } : null;
    }),
  );

  const userHashes = hashes.filter(
    (h): h is { postId: string; hash: Record<string, string> } =>
      h !== null && h.hash.userId === userId,
  );

  // Build all tracked posts with their inclusion status (excluding currentPostId — that's the post being evaluated right now)
  const allPosts: FloodStatusPost[] = userHashes
    .filter(({ postId }) => postId !== currentPostId)
    .sort((a, b) => Number(b.hash.createdAt) - Number(a.hash.createdAt)) // Newest first
    .map(({ postId, hash }) => {
      const includedInQuota =
        !(hash.isModerator === '1' && ignoreSettings.ignoreModerators) &&
        !(hash.isApprovedUser === '1' && ignoreSettings.ignoreContributors) &&
        !(hash.isUserDeleted === '1' && ignoreSettings.ignoreDeleted) &&
        !(hash.isModRemoved === '1' && ignoreSettings.ignoreRemoved) &&
        !(hash.isAutoRemoved === '1' && ignoreSettings.ignoreAutoRemoved);
      return {
        id: postId,
        createdAt: new Date(Number(hash.createdAt)),
        url: `https://reddit.com/r/${username}/comments/${postId}`,
        includedInQuota,
      };
    });

  const includedPosts = allPosts.filter((p) => p.includedInQuota);

  let nextPostTime: Date | null = null;
  if (includedPosts.length >= maxPosts) {
    // Oldest included post (last in newest-first array) determines when quota clears
    nextPostTime = new Date(includedPosts[includedPosts.length - 1].createdAt.getTime() + windowMs);
  } else {
    nextPostTime = now;
  }

  return {
    validPostCount: includedPosts.length,
    maxPosts,
    windowHours,
    exceedsQuota: includedPosts.length >= maxPosts,
    nextPostTime,
    validPosts: allPosts,
  };
}
