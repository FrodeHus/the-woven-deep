import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  placeVaults,
  stableJson,
  type TileId,
  type TopologyDraft,
  type VaultPlacementResult,
} from '../src/index.js';

let bundled: VaultContentEntry;

beforeAll(async () => {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
    registries: { ai: new Set(['ai.skittish']), effects: new Set(['effect.light-source']) },
  });
  bundled = pack.entries.find((entry): entry is VaultContentEntry => entry.kind === 'vault')!;
});

function topology(vaultState = [1, 2, 3, 4] as const): TopologyDraft {
  const width = 30; const height = 15;
  const tiles = Array<TileId>(width * height).fill(0);
  const carve = (left: number, top: number, right: number, bottom: number): void => {
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) tiles[y * width + x] = 1;
  };
  carve(1, 2, 13, 10); carve(16, 2, 28, 10); carve(13, 6, 16, 6);
  const stairUp = { x: 1, y: 2 }; const stairDown = { x: 28, y: 2 };
  tiles[stairUp.y * width + stairUp.x] = 4; tiles[stairDown.y * width + stairDown.x] = 5;
  const connectivity = analyzeConnectivity({ width, height, tiles, start: stairUp, target: stairDown });
  return {
    floorId: 'floor.vault-test', floorSeed: [4, 3, 2, 1], depth: 3, themeId: 'theme.test',
    width, height, tiles,
    rooms: [
      { roomId: 'room.0', left: 1, top: 2, right: 13, bottom: 10 },
      { roomId: 'room.1', left: 16, top: 2, right: 28, bottom: 10 },
    ],
    corridors: [{ corridorId: 'corridor.0', start: { x: 13, y: 6 }, end: { x: 16, y: 6 } }],
    stairUp, stairDown, vaultState,
    report: {
      generatorVersion: 2, attempt: 0, fallback: false, roomCount: 2, corridorCount: 1, vaults: [],
      stairUp, stairDown, stairDistance: connectivity.distance!,
      traversableCellCount: connectivity.traversableCellCount, connected: true, rejectionCounts: {},
    },
  };
}

function success(result: VaultPlacementResult): Extract<VaultPlacementResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result;
}

describe('vault placement', () => {
  it('places the bundled vault with stable unique ownership and all six transformed slot kinds', () => {
    const input = topology();
    const before = stableJson(input);
    const first = success(placeVaults(input, [bundled], { requiredVaultId: bundled.id }));
    const second = success(placeVaults(input, [bundled], { requiredVaultId: bundled.id }));
    expect(stableJson(first)).toBe(stableJson(second));
    expect(stableJson(input)).toBe(before);
    expect(first.vaults).toHaveLength(1);
    expect(first.vaults[0]!.placementId).toBe('vault-placement.vault-test.0');
    expect(first.lights).toEqual([expect.objectContaining({
      lightId: 'light.vault-test.0.amber-lamp', vaultPlacementId: 'vault-placement.vault-test.0',
      location: expect.objectContaining({ type: 'fixed' }), color: [255, 179, 71], radius: 7,
      strength: 180, enabled: true, falloff: 'linear', presentation: { glyph: '*', token: 'fixture.lamp' },
    })]);
    expect(first.placementSlots.map((slot) => slot.kind).sort()).toEqual([
      'fixture', 'item', 'monster', 'npc', 'objective', 'trap',
    ]);
    expect(new Set(first.placementSlots.map((slot) => slot.slotId)).size).toBe(6);
    expect(first.placementSlots.every((slot) => slot.vaultPlacementId === first.vaults[0]!.placementId)).toBe(true);
    expect(first.vaults[0]!.entrances.every((entrance) =>
      analyzeConnectivity({ width: input.width, height: input.height, tiles: first.tiles, start: input.stairUp, target: entrance }).distance !== null)).toBe(true);
    expect(first.placementSlots.filter((slot) => slot.required).every((slot) =>
      analyzeConnectivity({ width: input.width, height: input.height, tiles: first.tiles, start: input.stairUp, target: slot }).distance !== null)).toBe(true);
    expect(analyzeConnectivity({ width: input.width, height: input.height, tiles: first.tiles,
      start: input.stairUp, target: input.stairDown }).connected).toBe(true);
  });

  it('filters by inclusive depth and all requested tags without exposing a partial draft', () => {
    const input = topology();
    const tooDeep = { ...bundled, minDepth: 4 };
    expect(placeVaults(input, [tooDeep], { requiredVaultId: tooDeep.id })).toEqual({
      ok: false, code: 'vault.required-unavailable',
    });
    expect(placeVaults(input, [bundled], { vaultTags: ['cache', 'missing'] })).toEqual({
      ok: true, tiles: input.tiles, vaults: [], lights: [], placementSlots: [],
    });
  });

  it('honors margin, mask, stairs, entrance reconnection, and occupied-cell exclusions', () => {
    const input = topology();
    const blocked = { ...input, tiles: [...input.tiles] };
    for (const x of [1, 13, 16, 28]) blocked.tiles[6 * blocked.width + x] = 0;
    expect(placeVaults(blocked, [bundled], { requiredVaultId: bundled.id })).toEqual({
      ok: false, code: 'vault.no-valid-placement',
    });
    const stairInside = { ...input, stairUp: { x: 2, y: 3 }, tiles: [...input.tiles] };
    stairInside.tiles[2 * input.width + 1] = 1;
    stairInside.tiles[3 * input.width + 2] = 4;
    const placed = success(placeVaults(stairInside, [bundled], { requiredVaultId: bundled.id }));
    expect(placed.vaults[0]!.x).toBeGreaterThanOrEqual(17);
  });

  it('places one template in multiple rooms up to maxPerFloor with unique stable IDs', () => {
    const repeated = { ...bundled, maxPerFloor: 2 };
    const placed = success(placeVaults(topology(), [repeated], { requiredVaultId: repeated.id }));
    expect(placed.vaults.map((vault) => vault.placementId)).toEqual([
      'vault-placement.vault-test.0', 'vault-placement.vault-test.1',
    ]);
    expect(new Set(placed.lights.map((light) => light.lightId)).size).toBe(2);
    expect(new Set(placed.placementSlots.map((slot) => slot.slotId)).size).toBe(12);
  });

  it('uses template weights in stable ID order before a uniform stable candidate draw', () => {
    const first = { ...bundled, id: 'vault.a', weight: 1, maxPerFloor: 1 };
    const second = { ...bundled, id: 'vault.b', weight: 1, maxPerFloor: 1 };
    const placed = success(placeVaults(topology([1, 2, 3, 4]), [second, first]));
    expect(placed.vaults.map((vault) => vault.vaultId)).toEqual(['vault.a', 'vault.b']);
  });

  it('returns untouched topology when no optional vault has a valid candidate', () => {
    const input = topology();
    const impossible = { ...bundled, margin: 99 };
    expect(placeVaults(input, [impossible])).toEqual({
      ok: true, tiles: input.tiles, vaults: [], lights: [], placementSlots: [],
    });
  });
});
