import { describe, it, expect } from 'vitest';
import { buildPostBatchPrompt, buildCommentBatchPrompt, parseEventIndexResponse } from './validation-core';
import type { TileValidatorDefinition, BingoEvent } from './tiles';

const postTile: TileValidatorDefinition = {
  valueKey: 'resonance-drop',
  label: '"Resonance" in a Post',
  description: 'A post contains the word "resonance".',
  examples: ['resonance explains dark matter'],
  edgeCaseGuidelines: 'Posts only.',
  relevantTypes: ['post_submit'],
};

const commentTile: TileValidatorDefinition = {
  valueKey: 'citation-needed',
  label: '"Citation Needed" Comment',
  description: 'A comment contains the phrase "citation needed".',
  examples: ['citation needed'],
  edgeCaseGuidelines: 'Comments only.',
  relevantTypes: ['comment_create'],
};

const postEvent: BingoEvent = { type: 'post_submit', ts: 1000, author: 'op', title: 'T', body: 'resonance' };
const commentEvent: BingoEvent = { type: 'comment_create', ts: 2000, author: 'bob', postId: 't3_x', body: 'citation needed' };

describe('buildPostBatchPrompt', () => {
  it('includes tile valueKey, examples, and numbered event with author/body', () => {
    const p = buildPostBatchPrompt([postTile], [postEvent]);
    expect(p).toContain('resonance-drop');
    expect(p).toContain('resonance explains dark matter');
    expect(p).toContain('[0]');
    expect(p).toContain('author=op');
    expect(p).toContain('body=resonance');
    expect(p).toContain('eventIndex');
  });
});

describe('buildCommentBatchPrompt', () => {
  it('includes tile valueKey, examples, and numbered event with author/body', () => {
    const p = buildCommentBatchPrompt([commentTile], [commentEvent], []);
    expect(p).toContain('citation-needed');
    expect(p).toContain('[0]');
    expect(p).toContain('author=bob');
    expect(p).toContain('body=citation needed');
    expect(p).toContain('eventIndex');
  });
  it('includes post flair context when post events are provided', () => {
    const postEvent: BingoEvent = { type: 'post_submit', ts: 1, author: 'op', postId: 't3_x', flair: 'Humorous' };
    const p = buildCommentBatchPrompt([commentTile], [commentEvent], [postEvent]);
    expect(p).toContain('t3_x');
    expect(p).toContain('Humorous');
  });
  it('omits post context section when no post events', () => {
    const p = buildCommentBatchPrompt([commentTile], [commentEvent], []);
    expect(p).not.toContain('POST CONTEXT');
  });
});

describe('parseEventIndexResponse', () => {
  const batch: BingoEvent[] = [
    { type: 'comment_create', ts: 1, author: 'alice', postId: 't3_x', body: 'a' },
    { type: 'comment_create', ts: 2, author: 'bob', postId: 't3_x', body: 'b' },
  ];

  it('resolves triggeredBy from the batch at the given index', () => {
    const r = parseEventIndexResponse('[{"valueKey":"a","eventIndex":1}]', batch);
    expect(r).toEqual([{ valueKey: 'a', triggeredBy: 'bob' }]);
  });
  it('drops out-of-range eventIndex (hallucination guard)', () => {
    expect(parseEventIndexResponse('[{"valueKey":"a","eventIndex":99}]', batch)).toEqual([]);
    expect(parseEventIndexResponse('[{"valueKey":"a","eventIndex":-1}]', batch)).toEqual([]);
  });
  it('drops items with missing or non-number eventIndex', () => {
    expect(parseEventIndexResponse('[{"valueKey":"a"}]', batch)).toEqual([]);
    expect(parseEventIndexResponse('[{"valueKey":"a","eventIndex":"0"}]', batch)).toEqual([]);
  });
  it('drops items with missing valueKey', () => {
    expect(parseEventIndexResponse('[{"eventIndex":0}]', batch)).toEqual([]);
  });
  it('extracts array even when wrapped in prose/fences', () => {
    const r = parseEventIndexResponse('```json\n[{"valueKey":"a","eventIndex":0}]\n```', batch);
    expect(r).toEqual([{ valueKey: 'a', triggeredBy: 'alice' }]);
  });
  it('uses null triggeredBy when batch event has no author', () => {
    const noAuthor: BingoEvent[] = [{ type: 'mod_action', ts: 1, postId: 't3_x' }];
    const r = parseEventIndexResponse('[{"valueKey":"a","eventIndex":0}]', noAuthor);
    expect(r).toEqual([{ valueKey: 'a', triggeredBy: null }]);
  });
  it('returns [] on junk', () => {
    expect(parseEventIndexResponse('not json', batch)).toEqual([]);
  });
});
