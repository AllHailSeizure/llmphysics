import { describe, it, expect } from 'vitest';
import { TILE_VALIDATORS } from './tiles';

const tile = (key: string) => {
  const t = TILE_VALIDATORS.find((t) => t.valueKey === key);
  if (!t) throw new Error(`Tile not found: ${key}`);
  return t;
};

describe('postFilter on OP-identity tiles', () => {
  const opAuthors = new Set(['alice']);

  describe('op-cant-do-math', () => {
    const t = tile('op-cant-do-math');
    it('has a postFilter', () => expect(t.postFilter).toBeDefined());
    it('passes when triggeredBy is the OP', () => expect(t.postFilter!('alice', opAuthors)).toBe(true));
    it('fails when triggeredBy is a non-OP', () => expect(t.postFilter!('bob', opAuthors)).toBe(false));
    it('fails when triggeredBy is null', () => expect(t.postFilter!(null, opAuthors)).toBe(false));
  });

  describe('did-you-read-my-post', () => {
    const t = tile('did-you-read-my-post');
    it('has a postFilter', () => expect(t.postFilter).toBeDefined());
    it('passes when triggeredBy is the OP', () => expect(t.postFilter!('alice', opAuthors)).toBe(true));
    it('fails when triggeredBy is a non-OP', () => expect(t.postFilter!('bob', opAuthors)).toBe(false));
    it('fails when triggeredBy is null', () => expect(t.postFilter!(null, opAuthors)).toBe(false));
  });

  describe('did-you-read-your-post', () => {
    const t = tile('did-you-read-your-post');
    it('has a postFilter', () => expect(t.postFilter).toBeDefined());
    it('passes when triggeredBy is NOT the OP', () => expect(t.postFilter!('bob', opAuthors)).toBe(true));
    it('fails when triggeredBy is the OP', () => expect(t.postFilter!('alice', opAuthors)).toBe(false));
    it('fails when triggeredBy is null', () => expect(t.postFilter!(null, opAuthors)).toBe(false));
  });

  it('other tiles have no postFilter', () => {
    const noFilter = ['resonance-drop', 'citation-needed', 'two-person-war', 'em-dash-epidemic'];
    for (const key of noFilter) {
      expect(tile(key).postFilter).toBeUndefined();
    }
  });
});
