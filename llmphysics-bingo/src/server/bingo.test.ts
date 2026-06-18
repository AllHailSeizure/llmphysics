import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/redis';
import { describe, expect } from 'vitest';
import type { OnCommentCreateRequest, OnPostSubmitRequest } from '@devvit/web/shared';
import { captureCommentEvent, capturePostEvent } from './bingo';

const test = createDevvitTest({});

// ─── captureCommentEvent ──────────────────────────────────────────────────────

describe('captureCommentEvent', () => {
  test('no-ops when no active game', async () => {
    await expect(
      captureCommentEvent({
        type: 'CommentCreate',
        comment: { body: 'hello', author: 'user1' },
        post: { id: 't3_abc' },
      } as unknown as OnCommentCreateRequest)
    ).resolves.toBeUndefined();

    const events = await redis.zRange('bot:bingo:game:t3_abc:events', 0, -1);
    expect(events).toHaveLength(0);
  });

  test('appends event to sorted set when game is active', async () => {
    const gameId = 't3_game1';
    await redis.set('bot:bingo:current-game', JSON.stringify({ gameId, startedAt: Date.now() }));

    await captureCommentEvent({
      type: 'CommentCreate',
      comment: { body: 'test comment body', author: 'testuser' },
      post: { id: 't3_post1' },
    } as unknown as OnCommentCreateRequest);

    const events = await redis.zRange(`bot:bingo:game:${gameId}:events`, 0, -1);
    expect(events).toHaveLength(1);
    const event = JSON.parse(events[0]!.member);
    expect(event.type).toBe('comment_create');
    expect(event.body).toBe('test comment body');
    expect(event.author).toBe('testuser');
    expect(event.postId).toBe('t3_post1');
  });
});

// ─── capturePostEvent ─────────────────────────────────────────────────────────

describe('capturePostEvent', () => {
  test('appends event and registers post when game is active', async () => {
    const gameId = 't3_game2';
    await redis.set('bot:bingo:current-game', JSON.stringify({ gameId, startedAt: Date.now() }));

    await capturePostEvent({
      type: 'PostSubmit',
      post: { id: 't3_post2', title: 'Test post title', selftext: 'Test body' },
      author: { name: 'author1' },
    } as unknown as OnPostSubmitRequest);

    const events = await redis.zRange(`bot:bingo:game:${gameId}:events`, 0, -1);
    expect(events).toHaveLength(1);
    const event = JSON.parse(events[0]!.member);
    expect(event.type).toBe('post_submit');
    expect(event.title).toBe('Test post title');
    expect(event.author).toBe('author1');

    const posts = await redis.hGetAll(`bot:bingo:game:${gameId}:posts`);
    expect(posts['t3_post2']).toBe('1');
  });
});
