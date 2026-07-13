import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  TILE_DEFINITIONS,
  movementBlockReason,
  tileDefinition,
  type TileId,
} from '../src/index.js';

describe('terrain registry', () => {
  it('keeps existing IDs and publishes every v2 tile exactly once', () => {
    expect(TILE_DEFINITIONS.map((entry) => [entry.id, entry.name])).toEqual([
      [0, 'wall'], [1, 'floor'], [2, 'closed-door'], [3, 'pillar'],
      [4, 'stair-up'], [5, 'stair-down'], [6, 'void'],
    ]);
    expect(new Set(TILE_DEFINITIONS.map((entry) => entry.id)).size).toBe(7);
  });

  it.each([
    [0, false, false, true, '#', 'blocked.wall'],
    [1, true, true, false, '.', undefined],
    [2, false, true, true, '+', 'blocked.door'],
    [3, false, false, true, 'O', 'blocked.pillar'],
    [4, true, true, false, '<', undefined],
    [5, true, true, false, '>', undefined],
    [6, false, false, true, ' ', 'blocked.void'],
  ] as const)('defines tile %s', (id, walkable, potentiallyTraversable, opaque, glyph, reason) => {
    expect(tileDefinition(id as TileId)).toMatchObject({ walkable, potentiallyTraversable, opaque, glyph });
    expect(movementBlockReason(id as TileId)).toBe(reason);
  });

  it('pins the reviewed ROT.js release exactly', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies['rot-js']).toBe('2.2.1');
    expect(packageJson.dependencies['@woven-deep/content']).toBe('0.0.0');
  });
});
