import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/compiler/index.js';

describe('canonicalJson', () => {
  it('sorts object keys by locale-independent code units at every depth', () => {
    expect(canonicalJson({ ä: { ä: 1, z: 2 }, z: 3 })).toBe('{"z":3,"ä":{"z":2,"ä":1}}');
  });
});
