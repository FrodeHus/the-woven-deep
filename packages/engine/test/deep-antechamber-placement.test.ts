import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  placeVaults,
  type TileId,
  type TopologyDraft,
  type VaultPlacementResult,
} from '../src/index.js';

let vault: VaultContentEntry;

beforeAll(async () => {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  vault = pack.entries.find(
    (entry): entry is VaultContentEntry =>
      entry.kind === 'vault' && entry.id === 'vault.deep-antechamber',
  )!;
});

function deepTopology(depth: number): TopologyDraft {
  const width = 30;
  const height = 15;
  const tiles = Array<TileId>(width * height).fill(0);
  const carve = (l: number, t: number, r: number, b: number): void => {
    for (let y = t; y <= b; y += 1) for (let x = l; x <= r; x += 1) tiles[y * width + x] = 1;
  };
  carve(1, 2, 13, 12);
  carve(16, 2, 28, 12);
  carve(13, 7, 16, 7);
  const stairUp = { x: 1, y: 2 };
  const stairDown = { x: 28, y: 2 };
  tiles[stairUp.y * width + stairUp.x] = 4;
  tiles[stairDown.y * width + stairDown.x] = 5;
  const connectivity = analyzeConnectivity({
    width,
    height,
    tiles,
    start: stairUp,
    target: stairDown,
  });
  return {
    floorId: 'floor.deep-vault',
    floorSeed: [4, 3, 2, 1],
    depth,
    themeId: 'theme.test',
    width,
    height,
    tiles,
    rooms: [
      { roomId: 'room.0', left: 1, top: 2, right: 13, bottom: 12 },
      { roomId: 'room.1', left: 16, top: 2, right: 28, bottom: 12 },
    ],
    corridors: [{ corridorId: 'corridor.0', start: { x: 13, y: 7 }, end: { x: 16, y: 7 } }],
    stairUp,
    stairDown,
    vaultState: [1, 2, 3, 4],
    report: {
      generatorVersion: 2,
      attempt: 0,
      fallback: false,
      roomCount: 2,
      corridorCount: 1,
      vaults: [],
      stairUp,
      stairDown,
      stairDistance: connectivity.distance!,
      traversableCellCount: connectivity.traversableCellCount,
      connected: true,
      rejectionCounts: {},
    },
  };
}

function success(result: VaultPlacementResult): Extract<VaultPlacementResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result;
}

describe('deep antechamber placement', () => {
  it('places at depth 15 and exposes its trap and item slots', () => {
    const placed = success(placeVaults(deepTopology(15), [vault], { requiredVaultId: vault.id }));
    expect(placed.vaults).toHaveLength(1);
    const kinds = placed.placementSlots.map((slot) => slot.kind).sort();
    expect(kinds).toContain('trap');
    expect(kinds).toContain('item');
    // Two ambush slots plus the optional fallen-hero arena.
    expect(placed.placementSlots.filter((slot) => slot.kind === 'monster')).toHaveLength(3);
  });

  it('is rejected outside its depth band', () => {
    const result = placeVaults(deepTopology(3), [vault], { requiredVaultId: vault.id });
    expect(result.ok).toBe(false);
  });
});
