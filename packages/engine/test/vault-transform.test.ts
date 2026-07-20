import { describe, expect, it } from 'vitest';
import type { VaultContentEntry, VaultLegendEntry } from '@woven-deep/content';
import { stableJson, transformVault, vaultTransforms } from '../src/index.js';

const marker = (overrides: Partial<VaultLegendEntry> = {}): VaultLegendEntry => ({
  terrain: 'floor',
  entrance: false,
  light: null,
  slot: null,
  ...overrides,
});

function template(): VaultContentEntry {
  return {
    kind: 'vault',
    id: 'vault.transform-test',
    name: 'Transform test',
    tags: [],
    minDepth: 0,
    maxDepth: 10,
    rarity: 'common',
    weight: 1,
    maxPerFloor: 1,
    margin: 0,
    transforms: { rotations: [270, 0, 180, 90], reflectHorizontal: true },
    layout: ['abc', 'def'],
    legend: {
      a: marker({ entrance: true }),
      b: marker({
        light: {
          idSuffix: 'lamp',
          glyph: '🔥',
          presentationToken: 'fixture.flame',
          color: [1, 2, 3],
          radius: 2,
          strength: 3,
          enabled: true,
        },
      }),
      c: marker({ slot: { id: 'monster', kind: 'monster', required: true, tags: ['guard'] } }),
      d: marker(),
      e: marker(),
      f: marker(),
    },
    entranceCount: 1,
    requiredSlotIds: ['monster'],
  };
}

const cases = [
  [
    0,
    false,
    ['abc', 'def'],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  ],
  [
    0,
    true,
    ['cba', 'fed'],
    [
      [2, 0],
      [1, 0],
      [0, 0],
    ],
  ],
  [
    90,
    false,
    ['da', 'eb', 'fc'],
    [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ],
  [
    90,
    true,
    ['ad', 'be', 'cf'],
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
  ],
  [
    180,
    false,
    ['fed', 'cba'],
    [
      [2, 1],
      [1, 1],
      [0, 1],
    ],
  ],
  [
    180,
    true,
    ['def', 'abc'],
    [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  ],
  [
    270,
    false,
    ['cf', 'be', 'ad'],
    [
      [0, 2],
      [0, 1],
      [0, 0],
    ],
  ],
  [
    270,
    true,
    ['fc', 'eb', 'da'],
    [
      [1, 2],
      [1, 1],
      [1, 0],
    ],
  ],
] as const;

describe('vault transforms', () => {
  it.each(cases)('maps %i degrees reflected=%s exactly', (rotation, reflected, rows, points) => {
    const transformed = transformVault(template(), rotation, reflected);
    expect(transformed.rows).toEqual(rows);
    expect(transformed.entrances).toEqual([{ x: points[0][0], y: points[0][1] }]);
    expect(transformed.fixtures.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: points[1][0], y: points[1][1] },
    ]);
    expect(transformed.slots.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: points[2][0], y: points[2][1] },
    ]);
  });

  it('converts Unicode code points before transforming and never mutates compiled content', () => {
    const base = template();
    const input: VaultContentEntry = {
      ...base,
      layout: ['a🔥c', 'def'],
      legend: { ...base.legend, '🔥': base.legend.b! },
    };
    const before = stableJson(input);
    expect(transformVault(input, 90, false).rows).toEqual(['da', 'e🔥', 'fc']);
    expect(stableJson(input)).toBe(before);
  });

  it('orders numeric rotations before unreflected and reflected variants', () => {
    expect(
      vaultTransforms(template()).map(({ rotation, reflected }) => [rotation, reflected]),
    ).toEqual([
      [0, false],
      [0, true],
      [90, false],
      [90, true],
      [180, false],
      [180, true],
      [270, false],
      [270, true],
    ]);
  });
});
