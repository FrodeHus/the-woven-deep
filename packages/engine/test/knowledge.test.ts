import { describe, expect, it } from 'vitest';
import {
  createUnknownKnowledge,
  isExplored,
  rememberedTile,
  rememberTiles,
  validateKnowledgePacking,
} from '../src/index.js';

describe('floor knowledge packing', () => {
  it('packs 35 explored bits and eight remembered terrain values per word', () => {
    const empty = createUnknownKnowledge(35);
    expect(empty.exploredWords).toEqual([0, 0]);
    expect(empty.rememberedTerrainWords).toHaveLength(5);
    expect(empty.rememberedTerrainWords[0]).toBe(0xffff_ffff);
    expect(empty.rememberedTerrainWords[4]).toBe(0x0000_0fff);
  });

  it('updates a cloned value and retains unknown cells', () => {
    const empty = createUnknownKnowledge(10);
    const next = rememberTiles(empty, 10, [
      { index: 0, tile: 1 },
      { index: 9, tile: 5 },
    ]);
    expect(next).not.toBe(empty);
    expect(next.exploredWords).not.toBe(empty.exploredWords);
    expect(next.rememberedTerrainWords).not.toBe(empty.rememberedTerrainWords);
    expect(empty.exploredWords).toEqual([0]);
    expect(empty.rememberedTerrainWords).toEqual([0xffff_ffff, 0x0000_00ff]);
    expect(isExplored(next, 0)).toBe(true);
    expect(rememberedTile(next, 0)).toBe(1);
    expect(rememberedTile(next, 8)).toBeUndefined();
    expect(rememberedTile(next, 9)).toBe(5);
  });

  it('rejects wrong lengths, nonzero padding, and explored/memory disagreement', () => {
    expect(() =>
      validateKnowledgePacking({ exploredWords: [], rememberedTerrainWords: [] }, 10),
    ).toThrow(/length/);
    expect(() =>
      validateKnowledgePacking(
        { exploredWords: [1 << 10], rememberedTerrainWords: [0xffff_ffff, 0x0000_00ff] },
        10,
      ),
    ).toThrow(/padding/);
    expect(() =>
      validateKnowledgePacking(
        { exploredWords: [1], rememberedTerrainWords: [0xffff_ffff, 0x0000_00ff] },
        10,
      ),
    ).toThrow(/disagree/);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed cell count %s',
    (cellCount) => {
      expect(() => createUnknownKnowledge(cellCount)).toThrow(/cell count/);
      expect(() =>
        validateKnowledgePacking({ exploredWords: [], rememberedTerrainWords: [] }, cellCount),
      ).toThrow(/cell count/);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000])(
    'rejects malformed packed word %s',
    (word) => {
      expect(() =>
        validateKnowledgePacking(
          { exploredWords: [word], rememberedTerrainWords: [0xffff_ffff] },
          8,
        ),
      ).toThrow(/unsigned 32-bit/);
      expect(() =>
        validateKnowledgePacking({ exploredWords: [0], rememberedTerrainWords: [word] }, 8),
      ).toThrow(/unsigned 32-bit/);
    },
  );

  it('rejects a sparse explored word array with the correct length', () => {
    const exploredWords = Array<number>(1);
    expect(() =>
      validateKnowledgePacking({ exploredWords, rememberedTerrainWords: [0xffff_ffff] }, 8),
    ).toThrow(/unsigned 32-bit/);
  });

  it('rejects a sparse remembered terrain word array with the correct length', () => {
    const rememberedTerrainWords = Array<number>(1);
    expect(() =>
      validateKnowledgePacking({ exploredWords: [0xff], rememberedTerrainWords }, 8),
    ).toThrow(/unsigned 32-bit/);
  });

  it('rejects nonzero remembered terrain padding and both disagreement directions', () => {
    expect(() =>
      validateKnowledgePacking(
        { exploredWords: [0], rememberedTerrainWords: [0xffff_ffff, 0x0000_001f] },
        9,
      ),
    ).toThrow(/padding/);
    expect(() =>
      validateKnowledgePacking({ exploredWords: [1], rememberedTerrainWords: [0xffff_ffff] }, 8),
    ).toThrow(/disagree/);
    expect(() =>
      validateKnowledgePacking({ exploredWords: [0], rememberedTerrainWords: [0xffff_fff1] }, 8),
    ).toThrow(/disagree/);
  });

  it('rejects packed terrain values that are neither tile IDs nor unknown', () => {
    expect(() =>
      validateKnowledgePacking({ exploredWords: [1], rememberedTerrainWords: [0xffff_fff7] }, 8),
    ).toThrow(/tile ID/);
  });

  it('accepts empty knowledge and valid unsigned high-bit words', () => {
    expect(createUnknownKnowledge(0)).toEqual({ exploredWords: [], rememberedTerrainWords: [] });
    expect(() =>
      validateKnowledgePacking({ exploredWords: [], rememberedTerrainWords: [] }, 0),
    ).not.toThrow();
    expect(() =>
      validateKnowledgePacking(
        {
          exploredWords: [0x8000_0000],
          rememberedTerrainWords: [0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0x1fff_ffff],
        },
        32,
      ),
    ).not.toThrow();
  });

  it('rejects duplicate, out-of-range, and malformed remembered tiles', () => {
    const empty = createUnknownKnowledge(10);
    expect(() =>
      rememberTiles(empty, 10, [
        { index: 0, tile: 1 },
        { index: 0, tile: 2 },
      ]),
    ).toThrow(/unique/);
    expect(() => rememberTiles(empty, 10, [{ index: 10, tile: 1 }])).toThrow(/index/);
    expect(() => rememberTiles(empty, 10, [{ index: -1, tile: 1 }])).toThrow(/index/);
    expect(() => rememberTiles(empty, 10, [{ index: 1.5, tile: 1 }])).toThrow(/index/);
    expect(() => rememberTiles(empty, 10, [{ index: 0, tile: 7 }])).toThrow(/tile/);
    expect(() => rememberTiles(empty, 10, [{ index: 0, tile: 1.5 }])).toThrow(/tile/);
  });

  it('rejects malformed lookup indexes without bitwise coercion', () => {
    const empty = createUnknownKnowledge(8);
    expect(() => isExplored(empty, -1)).toThrow(/index/);
    expect(() => isExplored(empty, 1.5)).toThrow(/index/);
    expect(() => rememberedTile(empty, Number.NaN)).toThrow(/index/);
    expect(() => rememberedTile(empty, 8)).toThrow(/index/);
  });
});
