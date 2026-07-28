import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  ItemContentEntry,
  LootTableContentEntry,
} from '@woven-deep/content';
import {
  balanceEntry,
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  depthBandFor,
  placeFloorLoot,
  protectedRouteIndexes,
  tileDefinition,
  type ActiveRun,
  type ChestFeature,
  type DoorFeature,
  type FloorSnapshot,
  type ItemInstance,
  type TileId,
  type Uint32State,
} from '../src/index.js';

const WIDTH = 31;
const HEIGHT = 15;
const DOOR_CELLS: readonly Readonly<{ x: number; y: number }>[] = [
  { x: 6, y: 4 },
  { x: 10, y: 11 },
  { x: 16, y: 2 },
  { x: 20, y: 9 },
  { x: 24, y: 5 },
  { x: 27, y: 7 },
];
const VAULT_RECT = { x: 12, y: 5, width: 5, height: 5 } as const;

const SEED: Uint32State = [0x1357_9bdf, 0x2468_ace0, 0x0f0f_0f0f, 0xdead_beef];
const SEEDS: readonly Uint32State[] = Array.from(
  { length: 12 },
  (_, index) =>
    [
      (0x1000_0001 + index * 0x0011_2233) >>> 0,
      (0x2000_0002 + index * 0x0044_5566) >>> 0,
      (0x3000_0003 + index * 0x0077_8899) >>> 0,
      (0x4000_0004 + index * 0x00aa_bbcc) >>> 0,
    ] as Uint32State,
);

function scatterItem(id: string): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    tags: [],
    glyph: '*',
    color: '#ffaa00',
    category: 'misc',
    stackLimit: 10,
    price: 1,
    rarity: 'common',
    heirloomEligible: false,
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
}

function lootTable(id: string, contentIds: readonly string[]): LootTableContentEntry {
  return {
    kind: 'loot-table',
    id,
    name: id,
    tags: [],
    rolls: 1,
    choices: contentIds.map((contentId) => ({
      contentId,
      lootTableId: null,
      weight: 1,
      minimumQuantity: 1,
      maximumQuantity: 2,
    })),
  };
}

const scatterItems: readonly ItemContentEntry[] = [
  'item.test-scatter-a',
  'item.test-scatter-b',
  'item.test-scatter-c',
].map(scatterItem);

function content(): CompiledContentPack {
  const base = createDemoContentPack();
  const ids = scatterItems.map((entry) => entry.id);
  return {
    ...base,
    entries: [
      ...base.entries,
      ...scatterItems,
      lootTable('loot-table.floor-scatter-shallow', ids),
      lootTable('loot-table.floor-scatter-mid', ids),
      lootTable('loot-table.floor-scatter-deep', ids),
      lootTable('loot-table.chest-shallow', ids),
      lootTable('loot-table.chest-mid', ids),
      lootTable('loot-table.chest-deep', ids),
    ],
  };
}

function floor(overrides: Partial<FloorSnapshot> = {}): FloorSnapshot {
  const tiles: TileId[] = Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    return x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 0 : 1;
  });
  tiles[2 * WIDTH + 2] = 4;
  tiles[12 * WIDTH + 28] = 5;
  for (const door of DOOR_CELLS) tiles[door.y * WIDTH + door.x] = 2;
  return {
    floorId: 'floor.loot-placement',
    seed: [21, 22, 23, 24],
    generatorVersion: 2,
    width: WIDTH,
    height: HEIGHT,
    depth: 3,
    tiles,
    entities: [],
    themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 },
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
    stairUp: { x: 2, y: 2 },
    stairDown: { x: 28, y: 12 },
    vaults: [
      {
        placementId: 'placement.loot-vault',
        vaultId: 'vault.loot-test',
        ...VAULT_RECT,
        rotation: 0,
        reflected: false,
        entrances: [],
      },
    ],
    placementSlots: [],
    ...overrides,
  };
}

function run(): ActiveRun {
  return createDemoRun();
}

function fixture(
  floorOverrides: Partial<FloorSnapshot> = {},
): Readonly<{ run: ActiveRun; floor: FloorSnapshot; content: CompiledContentPack }> {
  return { run: run(), floor: floor(floorOverrides), content: content() };
}

function townFixture(): Readonly<{
  run: ActiveRun;
  floor: FloorSnapshot;
  content: CompiledContentPack;
}> {
  return fixture({ depth: 0 });
}

function groundCells(
  items: readonly ItemInstance[],
): readonly Readonly<{ x: number; y: number }>[] {
  const seen = new Set<string>();
  const cells: Readonly<{ x: number; y: number }>[] = [];
  for (const item of items) {
    if (item.location.type !== 'floor') continue;
    const key = `${item.location.x}:${item.location.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ x: item.location.x, y: item.location.y });
  }
  return cells;
}

function chebyshev(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

describe('placeFloorLoot', () => {
  it('is deterministic', () => {
    expect(placeFloorLoot(fixture(), SEED)).toEqual(placeFloorLoot(fixture(), SEED));
  });

  it('places counts within the balance ranges and advances the stream', () => {
    const knobs = balanceEntry(content()).floorLoot;
    for (const seed of SEEDS) {
      const result = placeFloorLoot(fixture(), seed);
      const piles = groundCells(result.items);
      expect(piles.length).toBeGreaterThanOrEqual(0);
      expect(piles.length).toBeLessThanOrEqual(knobs.scatterCount.maximum);
      const chests = result.features.filter((feature) => feature.type === 'chest');
      expect(chests.length).toBeLessThanOrEqual(knobs.chestCount.maximum);
      expect(result.state).not.toEqual(seed);
    }
  });

  it('honors placement constraints', () => {
    const generated = floor();
    const protectedIdx = protectedRouteIndexes(generated);
    const knobs = balanceEntry(content()).floorLoot;
    const anchors = [generated.stairUp, generated.stairDown].filter(
      (anchor): anchor is Readonly<{ x: number; y: number }> => anchor !== null,
    );
    for (const seed of SEEDS) {
      const result = placeFloorLoot({ run: run(), floor: generated, content: content() }, seed);
      const chests = result.features.filter(
        (feature): feature is ChestFeature => feature.type === 'chest',
      );
      const anchored = [...groundCells(result.items), ...chests];
      for (const placed of anchored) {
        const index = placed.y * generated.width + placed.x;
        expect(tileDefinition(generated.tiles[index]!).walkable).toBe(true);
        expect(protectedIdx.has(index)).toBe(false);
        for (const anchor of anchors) {
          expect(chebyshev(placed, anchor)).toBeGreaterThanOrEqual(knobs.minimumAnchorDistance);
        }
        expect(
          placed.x >= VAULT_RECT.x &&
            placed.x < VAULT_RECT.x + VAULT_RECT.width &&
            placed.y >= VAULT_RECT.y &&
            placed.y < VAULT_RECT.y + VAULT_RECT.height,
        ).toBe(false);
      }
      for (let left = 0; left < anchored.length; left += 1) {
        for (let right = left + 1; right < anchored.length; right += 1) {
          expect(chebyshev(anchored[left]!, anchored[right]!)).toBeGreaterThanOrEqual(
            knobs.minimumSpreadDistance,
          );
        }
      }
    }
  });

  it('produces both locked and unlocked chests across the seed set', () => {
    const chests = SEEDS.flatMap((seed) =>
      placeFloorLoot(fixture(), seed).features.filter(
        (feature): feature is ChestFeature => feature.type === 'chest',
      ),
    );
    expect(chests.length).toBeGreaterThan(0);
    expect(chests.some((chest) => chest.state === 'locked' && chest.lock !== null)).toBe(true);
    expect(chests.some((chest) => chest.state === 'closed' && chest.lock === null)).toBe(true);
    for (const chest of chests) {
      expect(chest.lootTableId).toBe('loot-table.chest-shallow');
      expect(chest.featureId.startsWith('feature.floor-loot.floor.loot-placement.chest-')).toBe(
        true,
      );
    }
  });

  it('locks doors only on door tiles off the protected routes', () => {
    const generated = floor();
    const protectedIdx = protectedRouteIndexes(generated);
    const doors = SEEDS.flatMap((seed) =>
      placeFloorLoot({ run: run(), floor: generated, content: content() }, seed).features.filter(
        (feature): feature is DoorFeature => feature.type === 'door',
      ),
    );
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) {
      const index = door.y * generated.width + door.x;
      expect(generated.tiles[index]).toBe(2);
      expect(protectedIdx.has(index)).toBe(false);
      expect(door.state).toBe('locked');
      expect(door.lock?.difficulty).toBe(
        balanceEntry(content()).floorLoot.chestLockDifficulty.shallow,
      );
    }
  });

  it('never places on a cell held by a floor entity or an existing feature', () => {
    const generated = floor();
    const protectedIdx = protectedRouteIndexes(generated);
    // Cells the unobstructed pass actually uses, so blocking them proves the exclusion bites.
    const baseline = SEEDS.flatMap((seed) => [
      ...groundCells(
        placeFloorLoot({ run: run(), floor: generated, content: content() }, seed).items,
      ),
      ...placeFloorLoot({ run: run(), floor: generated, content: content() }, seed).features.filter(
        (feature): feature is ChestFeature => feature.type === 'chest',
      ),
    ]);
    const entityCell = baseline[0]!;
    const featureCell = baseline.find(
      (cell) => cell.x !== entityCell.x || cell.y !== entityCell.y,
    )!;
    const doorCell = DOOR_CELLS.find((door) => !protectedIdx.has(door.y * WIDTH + door.x))!;

    const blocked: FloorSnapshot = {
      ...generated,
      entities: [
        { entityId: 'actor.blocker', x: entityCell.x, y: entityCell.y },
        { entityId: 'actor.door-blocker', x: doorCell.x, y: doorCell.y },
      ],
    };
    const blockingFeature: ChestFeature = {
      featureId: 'feature.pre-existing.chest',
      floorId: generated.floorId,
      x: featureCell.x,
      y: featureCell.y,
      contentId: null,
      coverTileId: 1,
      type: 'chest',
      lootTableId: 'loot-table.chest-shallow',
      lootContentId: null,
      state: 'closed',
      lock: null,
    };
    const blockedRun: ActiveRun = { ...run(), features: [blockingFeature] };

    for (const seed of SEEDS) {
      const result = placeFloorLoot({ run: blockedRun, floor: blocked, content: content() }, seed);
      const placed = [...groundCells(result.items), ...result.features];
      for (const occupied of [entityCell, featureCell, doorCell]) {
        expect(placed.some((cell) => cell.x === occupied.x && cell.y === occupied.y)).toBe(false);
      }
    }
  });

  it('places nothing on depth-0 floors', () => {
    expect(placeFloorLoot(townFixture(), SEED)).toEqual({ items: [], features: [], state: SEED });
  });
});

it('depthBandFor maps thresholds inclusively', () => {
  const bands = { shallowMaxDepth: 6, midMaxDepth: 13 };
  expect(depthBandFor(1, bands)).toBe('shallow');
  expect(depthBandFor(6, bands)).toBe('shallow');
  expect(depthBandFor(7, bands)).toBe('mid');
  expect(depthBandFor(13, bands)).toBe('mid');
  expect(depthBandFor(14, bands)).toBe('deep');
});
