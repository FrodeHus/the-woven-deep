import { describe, expect, it } from 'vitest';
import { stableJson } from '../src/compiler/index.js';

describe('stableJson', () => {
  it('sorts object keys by locale-independent code units at every depth', () => {
    expect(stableJson({ ä: { ä: 1, z: 2 }, z: 3 })).toBe('{"z":3,"ä":{"z":2,"ä":1}}');
  });
});
