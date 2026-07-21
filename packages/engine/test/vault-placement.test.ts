import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  nextUint32,
  placeVaults,
  stableJson,
  type RoomBounds,
  type TileId,
  type TopologyDraft,
  type VaultPlacementResult,
} from '../src/index.js';

let bundled: VaultContentEntry;

beforeAll(async () => {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  bundled = pack.entries.find(
    (entry): entry is VaultContentEntry =>
      entry.kind === 'vault' && entry.id === 'vault.lampwright-cache',
  )!;
});

function topology(vaultState = [1, 2, 3, 4] as const): TopologyDraft {
  const width = 30;
  const height = 15;
  const tiles = Array<TileId>(width * height).fill(0);
  const carve = (left: number, top: number, right: number, bottom: number): void => {
    for (let y = top; y <= bottom; y += 1)
      for (let x = left; x <= right; x += 1) tiles[y * width + x] = 1;
  };
  carve(1, 2, 13, 10);
  carve(16, 2, 28, 10);
  carve(13, 6, 16, 6);
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
    floorId: 'floor.vault-test',
    floorSeed: [4, 3, 2, 1],
    depth: 3,
    themeId: 'theme.test',
    width,
    height,
    tiles,
    rooms: [
      { roomId: 'room.0', left: 1, top: 2, right: 13, bottom: 10 },
      { roomId: 'room.1', left: 16, top: 2, right: 28, bottom: 10 },
    ],
    corridors: [{ corridorId: 'corridor.0', start: { x: 13, y: 6 }, end: { x: 16, y: 6 } }],
    stairUp,
    stairDown,
    vaultState,
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

const floorLegend = {
  terrain: 'floor' as const,
  entrance: false,
  light: null,
  slot: null,
};

function tinyVault(
  id: string,
  layout: readonly string[],
  legend: VaultContentEntry['legend'],
  overrides: Partial<VaultContentEntry> = {},
): VaultContentEntry {
  return {
    kind: 'vault',
    id,
    name: id,
    tags: [],
    minDepth: 1,
    maxDepth: 10,
    rarity: 'common',
    weight: 1,
    maxPerFloor: 1,
    margin: 0,
    transforms: { rotations: [0], reflectHorizontal: false },
    layout,
    legend,
    entranceCount: 1,
    requiredSlotIds: [],
    ...overrides,
  };
}

function openTopology(
  rooms: readonly RoomBounds[],
  vaultState = [1, 2, 3, 4] as const,
): TopologyDraft {
  const width = 20;
  const height = 12;
  const tiles = Array<TileId>(width * height).fill(0);
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      tiles[y * width + x] = 1;
    }
  const stairUp = { x: 1, y: 1 };
  const stairDown = { x: width - 2, y: height - 2 };
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
    floorId: 'floor.handcrafted',
    floorSeed: [9, 8, 7, 6],
    depth: 3,
    themeId: 'theme.test',
    width,
    height,
    tiles,
    rooms,
    corridors: [{ corridorId: 'corridor.0', start: stairUp, end: stairDown }],
    stairUp,
    stairDown,
    vaultState,
    report: {
      generatorVersion: 2,
      attempt: 0,
      fallback: false,
      roomCount: rooms.length,
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
    expect(first.lights).toEqual([
      expect.objectContaining({
        lightId: 'light.vault-test.0.amber-lamp',
        vaultPlacementId: 'vault-placement.vault-test.0',
        location: expect.objectContaining({ type: 'fixed' }),
        color: [255, 179, 71],
        radius: 7,
        strength: 180,
        enabled: true,
        falloff: 'linear',
        presentation: { glyph: '*', token: 'fixture.lamp' },
      }),
    ]);
    expect(first.placementSlots.map((slot) => slot.kind).sort()).toEqual([
      'fixture',
      'item',
      'monster',
      'npc',
      'objective',
      'trap',
    ]);
    expect(new Set(first.placementSlots.map((slot) => slot.slotId)).size).toBe(6);
    expect(
      first.placementSlots.every((slot) => slot.vaultPlacementId === first.vaults[0]!.placementId),
    ).toBe(true);
    expect(
      first.vaults[0]!.entrances.every(
        (entrance) =>
          analyzeConnectivity({
            width: input.width,
            height: input.height,
            tiles: first.tiles,
            start: input.stairUp,
            target: entrance,
          }).distance !== null,
      ),
    ).toBe(true);
    expect(
      first.placementSlots
        .filter((slot) => slot.required)
        .every(
          (slot) =>
            analyzeConnectivity({
              width: input.width,
              height: input.height,
              tiles: first.tiles,
              start: input.stairUp,
              target: slot,
            }).distance !== null,
        ),
    ).toBe(true);
    expect(
      analyzeConnectivity({
        width: input.width,
        height: input.height,
        tiles: first.tiles,
        start: input.stairUp,
        target: input.stairDown,
      }).connected,
    ).toBe(true);
  });

  it('filters by inclusive depth and all requested tags without exposing a partial draft', () => {
    const input = topology();
    const tooDeep = { ...bundled, minDepth: 4 };
    expect(placeVaults(input, [tooDeep], { requiredVaultId: tooDeep.id })).toEqual({
      ok: false,
      code: 'vault.required-unavailable',
    });
    expect(placeVaults(input, [bundled], { vaultTags: ['cache', 'missing'] })).toEqual({
      ok: true,
      tiles: input.tiles,
      vaults: [],
      lights: [],
      placementSlots: [],
    });
  });

  it('honors margin, mask, stairs, entrance reconnection, and occupied-cell exclusions', () => {
    const input = topology();
    const blocked = { ...input, tiles: [...input.tiles] };
    for (const x of [1, 13, 16, 28]) blocked.tiles[6 * blocked.width + x] = 0;
    expect(placeVaults(blocked, [bundled], { requiredVaultId: bundled.id })).toEqual({
      ok: false,
      code: 'vault.no-valid-placement',
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
      'vault-placement.vault-test.0',
      'vault-placement.vault-test.1',
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
      ok: true,
      tiles: input.tiles,
      vaults: [],
      lights: [],
      placementSlots: [],
    });
  });

  it('chooses the exact stable room, transform, reflection, and origin after reordering every input', () => {
    const roomA = { roomId: 'room.a', left: 5, top: 4, right: 5, bottom: 4 };
    const roomZ = { roomId: 'room.z', left: 10, top: 4, right: 10, bottom: 4 };
    const entrance = { ...floorLegend, entrance: true };
    const vaultA = tinyVault(
      'vault.a',
      ['+'],
      { '+': entrance },
      {
        transforms: { rotations: [180, 0], reflectHorizontal: true },
      },
    );
    const vaultB = tinyVault(
      'vault.b',
      ['+'],
      { '+': entrance },
      {
        transforms: { rotations: [180, 0], reflectHorizontal: true },
      },
    );
    const reorderedA = {
      ...vaultA,
      transforms: { rotations: [0, 180] as const, reflectHorizontal: true },
    };
    const reorderedB = {
      ...vaultB,
      transforms: { rotations: [0, 180] as const, reflectHorizontal: true },
    };

    const first = success(placeVaults(openTopology([roomZ, roomA]), [vaultB, vaultA]));
    const second = success(placeVaults(openTopology([roomA, roomZ]), [reorderedA, reorderedB]));

    expect(first.vaults[0]).toMatchObject({
      vaultId: 'vault.a',
      x: 5,
      y: 4,
      width: 1,
      height: 1,
      rotation: 0,
      reflected: false,
    });
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('skips an exact earliest rectangle containing void and chooses the next stable room', () => {
    const roomA = { roomId: 'room.a', left: 5, top: 4, right: 5, bottom: 4 };
    const roomB = { roomId: 'room.b', left: 10, top: 4, right: 10, bottom: 4 };
    const input = openTopology([roomB, roomA]);
    const masked = { ...input, tiles: [...input.tiles] };
    masked.tiles[4 * masked.width + 5] = 6;
    const vault = tinyVault('vault.mask', ['+'], { '+': { ...floorLegend, entrance: true } });

    const placed = success(placeVaults(masked, [vault]));

    expect(placed.vaults).toEqual([
      expect.objectContaining({ x: 10, y: 4, rotation: 0, reflected: false }),
    ]);
    expect(placed.tiles[4 * masked.width + 5]).toBe(6);
  });

  it('places repeated templates into exact non-overlapping rectangles without overwriting earlier vaults', () => {
    const rooms = [
      { roomId: 'room.c', left: 14, top: 5, right: 15, bottom: 5 },
      { roomId: 'room.a', left: 4, top: 5, right: 5, bottom: 5 },
      { roomId: 'room.b', left: 9, top: 5, right: 10, bottom: 5 },
    ];
    const vault = tinyVault(
      'vault.repeat',
      ['+O'],
      {
        '+': { ...floorLegend, terrain: 'closed-door', entrance: true },
        O: { ...floorLegend, terrain: 'pillar' },
      },
      { maxPerFloor: 3 },
    );

    const placed = success(
      placeVaults(openTopology(rooms), [vault], { requiredVaultId: vault.id }),
    );

    expect(placed.vaults.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
      { x: 4, y: 5, width: 2, height: 1 },
      { x: 9, y: 5, width: 2, height: 1 },
      { x: 14, y: 5, width: 2, height: 1 },
    ]);
    for (let left = 0; left < placed.vaults.length; left += 1)
      for (let right = left + 1; right < placed.vaults.length; right += 1) {
        const a = placed.vaults[left]!;
        const b = placed.vaults[right]!;
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
    expect([5, 10, 15].map((x) => placed.tiles[5 * 20 + x])).toEqual([3, 3, 3]);
  });

  it('weights templates before candidates when authored weights and candidate counts differ', () => {
    const state = [1, 300_010, 3, 4] as const;
    const room = { roomId: 'room.a', left: 4, top: 3, right: 10, bottom: 7 };
    const entrance = { ...floorLegend, entrance: true };
    const heavy = tinyVault(
      'vault.heavy',
      ['+..'],
      { '+': entrance, '.': floorLegend },
      {
        weight: 3,
        margin: 2,
      },
    );
    const manyCandidates = tinyVault('vault.many', ['+'], { '+': entrance }, { weight: 1 });
    const fraction = nextUint32(state).value / 0x1_0000_0000;
    expect(Math.floor(fraction * (3 + 1))).toBeLessThan(3);
    expect(Math.floor(fraction * (3 * 1 + 1 * 35))).toBeGreaterThanOrEqual(3);

    const placed = success(placeVaults(openTopology([room], state), [manyCandidates, heavy]));

    expect(placed.vaults[0]).toMatchObject({ vaultId: 'vault.heavy', x: 6, y: 5 });
  });

  it('rolls back a disconnecting draft before committing the next exact candidate', () => {
    const width = 20;
    const height = 10;
    const tiles = Array<TileId>(width * height).fill(0);
    for (let x = 1; x <= 18; x += 1) tiles[5 * width + x] = 1;
    for (let y = 3; y <= 5; y += 1) for (let x = 9; x <= 13; x += 1) tiles[y * width + x] = 1;
    const stairUp = { x: 1, y: 5 };
    const stairDown = { x: 18, y: 5 };
    tiles[stairUp.y * width + stairUp.x] = 4;
    tiles[stairDown.y * width + stairDown.x] = 5;
    const base = openTopology([], [1, 2, 3, 4]);
    const input: TopologyDraft = {
      ...base,
      width,
      height,
      tiles,
      stairUp,
      stairDown,
      rooms: [
        { roomId: 'room.b', left: 10, top: 3, right: 12, bottom: 3 },
        { roomId: 'room.a', left: 4, top: 5, right: 6, bottom: 5 },
      ],
      report: {
        ...base.report,
        roomCount: 2,
        stairUp,
        stairDown,
        stairDistance: analyzeConnectivity({
          width,
          height,
          tiles,
          start: stairUp,
          target: stairDown,
        }).distance!,
      },
    };
    const vault = tinyVault(
      'vault.rollback',
      ['+ls'],
      {
        '+': { ...floorLegend, terrain: 'closed-door', entrance: true },
        l: {
          ...floorLegend,
          terrain: 'wall',
          light: {
            idSuffix: 'draft-lamp',
            glyph: '*',
            presentationToken: 'fixture.test',
            color: [1, 2, 3],
            radius: 2,
            strength: 3,
            enabled: true,
          },
        },
        s: {
          ...floorLegend,
          slot: { id: 'draft-slot', kind: 'objective', required: true, tags: ['test'] },
        },
      },
      { requiredSlotIds: ['draft-slot'] },
    );

    const placed = success(placeVaults(input, [vault], { requiredVaultId: vault.id }));

    expect(placed.vaults).toEqual([
      expect.objectContaining({
        placementId: 'vault-placement.handcrafted.0',
        x: 10,
        y: 3,
        width: 3,
        height: 1,
      }),
    ]);
    expect([4, 5, 6].map((x) => placed.tiles[5 * width + x])).toEqual([1, 1, 1]);
    expect(placed.lights).toEqual([
      expect.objectContaining({
        lightId: 'light.handcrafted.0.draft-lamp',
        location: { type: 'fixed', x: 11, y: 3 },
      }),
    ]);
    expect(placed.placementSlots).toEqual([
      expect.objectContaining({
        slotId: 'slot.handcrafted.0.draft-slot',
        x: 12,
        y: 3,
      }),
    ]);
    expect(
      placed.lights.some((light) => light.location.type === 'fixed' && light.location.y === 5),
    ).toBe(false);
    expect(placed.placementSlots.some((slot) => slot.y === 5)).toBe(false);
  });

  it.each([
    [
      'light',
      {
        ...floorLegend,
        terrain: 'void' as const,
        light: {
          idSuffix: 'void-light',
          glyph: '*',
          presentationToken: 'fixture.test',
          color: [1, 2, 3] as const,
          radius: 2,
          strength: 3,
          enabled: true,
        },
      },
      'vault vault.invalid legend symbol x cannot place light void-light on void terrain',
    ],
    [
      'slot',
      {
        ...floorLegend,
        terrain: 'void' as const,
        slot: {
          id: 'void-slot',
          kind: 'item' as const,
          required: false,
          tags: ['test'],
        },
      },
      'vault vault.invalid legend symbol x cannot place slot void-slot on void terrain',
    ],
  ] as const)(
    'rejects compiled-shaped invalid vault %s records on void before placement',
    (_kind, action, message) => {
      const input = openTopology([{ roomId: 'room.a', left: 4, top: 4, right: 5, bottom: 4 }]);
      const invalid = tinyVault('vault.invalid', ['+x'], {
        '+': { ...floorLegend, entrance: true },
        x: action,
      });
      const before = stableJson(input);

      expect(() => placeVaults(input, [invalid], { requiredVaultId: invalid.id })).toThrow(
        new TypeError(message),
      );
      expect(stableJson(input)).toBe(before);
    },
  );

  it('preserves authored void terrain cells that contain no placement actions', () => {
    const input = openTopology([{ roomId: 'room.a', left: 4, top: 4, right: 5, bottom: 4 }]);
    const valid = tinyVault('vault.void-mask', ['+x'], {
      '+': { ...floorLegend, entrance: true },
      x: { ...floorLegend, terrain: 'void' },
    });

    const placed = success(placeVaults(input, [valid], { requiredVaultId: valid.id }));

    expect(placed.tiles[placed.vaults[0]!.y * input.width + placed.vaults[0]!.x + 1]).toBe(6);
    expect(placed.lights).toEqual([]);
    expect(placed.placementSlots).toEqual([]);
  });
});
