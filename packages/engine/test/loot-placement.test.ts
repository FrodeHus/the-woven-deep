import { describe, expect, it } from 'vitest';
import type {
  BalanceContentEntry,
  CompiledContentPack,
  CurseContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
} from '@woven-deep/content';
import {
  analyzeConnectivity,
  balanceEntry,
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  depthBandFor,
  placeFloorLoot,
  preservesRequiredRoutes,
  protectedRouteIndexes,
  requiredPoints,
  tileDefinition,
  validateContentBoundRun,
  validateRequiredFloorLootTables,
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
    artifact: null,
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

/**
 * A floor whose only route between the stair block and the far chamber is a one-wide ledge: every
 * corridor cell (and the chamber mouth) is an articulation point of the walkable graph, so a chest
 * dropped on one seals the run. The stairs sit together in the left block, which keeps the whole
 * ledge OFF the protected stair route -- the pre-existing exclusion the chest pass already honours,
 * and the reason a plain route check never caught this.
 */
function ledgeFloor(): FloorSnapshot {
  const tiles: TileId[] = Array.from({ length: WIDTH * HEIGHT }, () => 0 as TileId);
  const open = (x: number, y: number): void => {
    tiles[y * WIDTH + x] = 1 as TileId;
  };
  for (let y = 1; y <= 13; y += 1) for (let x = 1; x <= 4; x += 1) open(x, y);
  for (let x = 5; x <= 20; x += 1) open(x, 7);
  for (let y = 2; y <= 12; y += 1) for (let x = 21; x <= 29; x += 1) open(x, y);
  tiles[2 * WIDTH + 2] = 4 as TileId;
  tiles[12 * WIDTH + 2] = 5 as TileId;
  return floor({
    tiles,
    stairUp: { x: 2, y: 2 },
    stairDown: { x: 2, y: 12 },
    vaults: [],
  });
}

/** A wider seed set than `SEEDS`: the ledge only draws a chest on some seeds, so the sweep needs
 * enough draws for the unguarded pass to actually land on one. */
const LEDGE_SEEDS: readonly Uint32State[] = Array.from(
  { length: 40 },
  (_, index) =>
    [
      (0x5100_0001 + index * 0x0013_2331) >>> 0,
      (0x6200_0002 + index * 0x0047_5567) >>> 0,
      (0x7300_0003 + index * 0x0079_889b) >>> 0,
      (0x8400_0004 + index * 0x00ab_bbcd) >>> 0,
    ] as Uint32State,
);

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

  it('never seals a narrow ledge with a chest, and still fills the open chamber', () => {
    const ledged = ledgeFloor();
    let chests = 0;
    for (const seed of LEDGE_SEEDS) {
      const placed = placeFloorLoot({ run: run(), floor: ledged, content: content() }, seed)
        .features.filter((feature): feature is ChestFeature => feature.type === 'chest')
        .map((chest) => ({ x: chest.x, y: chest.y }));
      chests += placed.length;
      for (const chest of placed) {
        const sealed = [...ledged.tiles];
        sealed[chest.y * ledged.width + chest.x] = 0 as TileId;
        const analysis = analyzeConnectivity({
          width: ledged.width,
          height: ledged.height,
          tiles: sealed,
        });
        expect({ chest, connected: analysis.connected }).toEqual({ chest, connected: true });
      }
    }
    expect(chests).toBeGreaterThan(0);
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
      if (door.state === 'locked') {
        expect(protectedIdx.has(index)).toBe(false);
        expect(door.lock?.difficulty).toBe(
          balanceEntry(content()).floorLoot.chestLockDifficulty.shallow,
        );
      } else {
        expect(door.state).toBe('closed');
        expect(door.lock).toBeUndefined();
      }
    }
  });

  /** A door tile planted on the stair-to-stair protected route, plus its index. */
  function floorWithProtectedDoor(): Readonly<{ floor: FloorSnapshot; index: number }> {
    const base = floor();
    const anchors = new Set(
      [base.stairUp!, base.stairDown!].map((anchor) => anchor.y * WIDTH + anchor.x),
    );
    const target = [...protectedRouteIndexes(base)].find(
      (index) => !anchors.has(index) && base.tiles[index] === 1,
    );
    if (target === undefined) throw new Error('fixture must expose a protected route cell');
    const tiles = [...base.tiles];
    tiles[target] = 2;
    return { floor: { ...base, tiles }, index: target };
  }

  it('gives every door tile a door feature, leaving none bare', () => {
    const { floor: generated, index: protectedDoor } = floorWithProtectedDoor();
    const doorIndexes = generated.tiles
      .map((tile, index) => (tile === 2 ? index : -1))
      .filter((index) => index >= 0);
    expect(doorIndexes).toContain(protectedDoor);
    for (const seed of SEEDS) {
      const doors = placeFloorLoot(
        { run: run(), floor: generated, content: content() },
        seed,
      ).features.filter((feature): feature is DoorFeature => feature.type === 'door');
      for (const index of doorIndexes) {
        const at = doors.filter(
          (door) => door.x === index % WIDTH && door.y === Math.floor(index / WIDTH),
        );
        expect(at).toHaveLength(1);
        expect(at[0]!.coverTileId).toBe(2);
      }
      expect(doors).toHaveLength(doorIndexes.length);
    }
  });

  it('refuses to hang a door on an occupied door tile', () => {
    const generated = floor();
    const door = DOOR_CELLS[0]!;
    const base = run();
    const hero = base.actors[0]!;
    const occupiedByEntity = {
      run: base,
      floor: {
        ...generated,
        entities: [{ entityId: 'entity.squatter', x: door.x, y: door.y }],
      },
      content: content(),
    };
    expect(() => placeFloorLoot(occupiedByEntity, SEED)).toThrow(
      /door tile 6,4 on floor floor\.loot-placement is occupied/,
    );

    const occupiedByActor = {
      run: {
        ...base,
        actors: base.actors.map((actor) =>
          actor.actorId === hero.actorId
            ? { ...actor, floorId: generated.floorId, x: door.x, y: door.y }
            : actor,
        ),
      },
      floor: generated,
      content: content(),
    };
    expect(() => placeFloorLoot(occupiedByActor, SEED)).toThrow(/is occupied/);
  });

  it('leaves protected-route door tiles closed and never locked', () => {
    const { floor: generated, index: protectedDoor } = floorWithProtectedDoor();
    for (const seed of SEEDS) {
      const door = placeFloorLoot(
        { run: run(), floor: generated, content: content() },
        seed,
      ).features.find(
        (feature): feature is DoorFeature =>
          feature.type === 'door' &&
          feature.x === protectedDoor % WIDTH &&
          feature.y === Math.floor(protectedDoor / WIDTH),
      );
      expect(door?.state).toBe('closed');
      expect(door?.lock).toBeUndefined();
    }
  });

  it('produces both locked and closed doors across the seed set', () => {
    const generated = floor();
    const doors = SEEDS.flatMap((seed) =>
      placeFloorLoot({ run: run(), floor: generated, content: content() }, seed).features.filter(
        (feature): feature is DoorFeature => feature.type === 'door',
      ),
    );
    expect(doors.some((door) => door.state === 'locked')).toBe(true);
    expect(doors.some((door) => door.state === 'closed')).toBe(true);
  });

  it('numbers door features row-major across locked and closed alike', () => {
    const { floor: generated } = floorWithProtectedDoor();
    const doors = placeFloorLoot(
      { run: run(), floor: generated, content: content() },
      SEED,
    ).features.filter((feature): feature is DoorFeature => feature.type === 'door');
    expect(doors.length).toBeGreaterThan(1);
    for (const door of doors) {
      expect(door.featureId).toMatch(/^feature\.floor-loot\.floor\.loot-placement\.door-\d{6}$/);
    }
    expect([...doors].map((door) => door.featureId).sort()).toEqual(
      doors.map((door) => door.featureId),
    );
    const rowMajor = [...doors].sort((left, right) =>
      left.y === right.y ? left.x - right.x : left.y - right.y,
    );
    expect(rowMajor.map((door) => door.featureId)).toEqual(doors.map((door) => door.featureId));
  });

  it('adds no second door feature where a vault already authored one', () => {
    const generated = floor();
    const doorCell = DOOR_CELLS[0]!;
    const authored: DoorFeature = {
      featureId: 'feature.vault.pre-existing-door',
      floorId: generated.floorId,
      x: doorCell.x,
      y: doorCell.y,
      contentId: null,
      coverTileId: 2,
      type: 'door',
      state: 'locked',
      lock: { difficulty: 9, keyContentId: null },
    };
    const authoredRun: ActiveRun = { ...run(), features: [authored] };
    for (const seed of SEEDS) {
      const doors = placeFloorLoot(
        { run: authoredRun, floor: generated, content: content() },
        seed,
      ).features.filter((feature): feature is DoorFeature => feature.type === 'door');
      expect(doors.some((door) => door.x === doorCell.x && door.y === doorCell.y)).toBe(false);
    }
  });

  it('never places on a cell held by a floor entity or an existing feature', () => {
    const generated = floor();
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

    const blocked: FloorSnapshot = {
      ...generated,
      entities: [{ entityId: 'actor.blocker', x: entityCell.x, y: entityCell.y }],
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
      for (const occupied of [entityCell, featureCell]) {
        expect(placed.some((cell) => cell.x === occupied.x && cell.y === occupied.y)).toBe(false);
      }
    }
  });

  it('never places on a cell held by a living actor on this floor', () => {
    const generated = floor();
    // A cell the unobstructed pass actually uses, so occupying it proves the exclusion bites.
    const actorCell = groundCells(
      placeFloorLoot({ run: run(), floor: generated, content: content() }, SEEDS[0]!).items,
    )[0]!;
    const base = run();
    const blocker = {
      ...base.actors[0]!,
      actorId: 'actor.floor-blocker',
      playerControlled: false,
      floorId: generated.floorId,
      x: actorCell.x,
      y: actorCell.y,
      health: 5,
    };
    const blockedRun: ActiveRun = { ...base, actors: [...base.actors, blocker] };

    for (const seed of SEEDS) {
      const result = placeFloorLoot(
        { run: blockedRun, floor: generated, content: content() },
        seed,
      );
      const placed = [...groundCells(result.items), ...result.features];
      expect(placed.some((cell) => cell.x === actorCell.x && cell.y === actorCell.y)).toBe(false);
    }
  });

  it('pads the scatter ordinal so a batch of ten or more still sorts by placement order', () => {
    const items = placeFloorLoot(fixture(), SEED).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.itemId).toMatch(/^item\.floor-loot\.floor\.loot-placement\.\d{6}\.\d{6}$/);
    }
    const sorted = [...items].map((item) => item.itemId).sort();
    expect(sorted).toEqual(items.map((item) => item.itemId));
  });

  it('keeps the stairs mutually reachable after every lock is placed', () => {
    const generated = floor();
    for (const seed of SEEDS) {
      const result = placeFloorLoot({ run: run(), floor: generated, content: content() }, seed);
      const locked = result.features.filter((feature) => feature.state === 'locked');
      expect(
        preservesRequiredRoutes({
          width: generated.width,
          height: generated.height,
          tiles: generated.tiles,
          requiredPoints: requiredPoints(generated),
          blockedPoints: locked.map((feature) => ({ x: feature.x, y: feature.y })),
        }),
      ).toBe(true);
    }
  });

  it('places nothing on depth-0 floors', () => {
    expect(placeFloorLoot(townFixture(), SEED)).toEqual({ items: [], features: [], state: SEED });
  });
});

describe('placeFloorLoot depth bands', () => {
  /** One unique item per band and kind, so a drawn item identifies the exact table it came from. */
  function bandedContent(): CompiledContentPack {
    const shared = content();
    const added: (ItemContentEntry | LootTableContentEntry)[] = [];
    for (const kind of ['floor-scatter', 'chest'] as const) {
      for (const band of ['shallow', 'mid', 'deep'] as const) {
        const itemId = `item.test-${kind}-${band}`;
        added.push(scatterItem(itemId), lootTable(`loot-table.${kind}-${band}`, [itemId]));
      }
    }
    const replacedIds = new Set(added.map((entry) => entry.id));
    return {
      ...shared,
      entries: [...shared.entries.filter((entry) => !replacedIds.has(entry.id)), ...added],
    };
  }

  const bandDepths = (): Readonly<Record<'shallow' | 'mid' | 'deep', number>> => {
    const bands = balanceEntry(bandedContent()).floorLoot.depthBands;
    return { shallow: 1, mid: bands.shallowMaxDepth + 1, deep: bands.midMaxDepth + 1 };
  };

  for (const band of ['shallow', 'mid', 'deep'] as const) {
    it(`draws ${band}-band floors from the ${band} scatter and chest tables`, () => {
      const pack = bandedContent();
      const depth = bandDepths()[band];
      expect(depthBandFor(depth, balanceEntry(pack).floorLoot.depthBands)).toBe(band);

      const scattered: string[] = [];
      const chestTableIds: string[] = [];
      for (const seed of SEEDS) {
        const result = placeFloorLoot({ run: run(), floor: floor({ depth }), content: pack }, seed);
        scattered.push(...result.items.map((item) => item.contentId));
        chestTableIds.push(
          ...result.features
            .filter((feature): feature is ChestFeature => feature.type === 'chest')
            .map((chest) => chest.lootTableId!),
        );
      }

      expect(scattered.length).toBeGreaterThan(0);
      expect([...new Set(scattered)]).toEqual([`item.test-floor-scatter-${band}`]);
      expect(chestTableIds.length).toBeGreaterThan(0);
      expect([...new Set(chestTableIds)]).toEqual([`loot-table.chest-${band}`]);
    });
  }
});

describe('engine-required floor loot table preflight', () => {
  const requiredTableIds = [
    'loot-table.floor-scatter-shallow',
    'loot-table.floor-scatter-mid',
    'loot-table.floor-scatter-deep',
    'loot-table.chest-shallow',
    'loot-table.chest-mid',
    'loot-table.chest-deep',
  ] as const;

  it('accepts a pack carrying every engine-required table', () => {
    expect(() => validateRequiredFloorLootTables(content())).not.toThrow();
  });

  it('is not part of the per-command content-bound validation', () => {
    // Pack contents cannot change mid-run, so the six ids are checked at run creation and at save
    // load only -- never on the hot per-command path.
    const complete = content();
    const stripped: CompiledContentPack = {
      ...complete,
      entries: complete.entries.filter(
        (entry) => !requiredTableIds.some((tableId) => tableId === entry.id),
      ),
    };
    expect(() => validateContentBoundRun(run(), stripped)).not.toThrow();
  });

  for (const missing of requiredTableIds) {
    it(`rejects a pack missing ${missing}`, () => {
      const complete = content();
      const pack: CompiledContentPack = {
        ...complete,
        entries: complete.entries.filter((entry) => entry.id !== missing),
      };
      expect(() => validateRequiredFloorLootTables(pack)).toThrow(missing);
    });
  }

  it('rejects a required table whose graph resolves no choice in its own depth band', () => {
    const complete = content();
    const bands = balanceEntry(complete).floorLoot.depthBands;
    // Every choice is banded above the deep representative depth, so the projection keeps none and
    // the mid-run roll would divide by a zero weight total on the first deep descent.
    const starved: LootTableContentEntry = {
      ...lootTable('loot-table.chest-deep', [scatterItems[0]!.id]),
      choices: [
        {
          contentId: scatterItems[0]!.id,
          lootTableId: null,
          weight: 1,
          minimumQuantity: 1,
          maximumQuantity: 1,
          minDepth: bands.midMaxDepth + 100,
        },
      ],
    };
    const pack: CompiledContentPack = {
      ...complete,
      entries: complete.entries.map((entry) => (entry.id === starved.id ? starved : entry)),
    };

    expect(() => validateRequiredFloorLootTables(pack)).toThrow('loot-table.chest-deep');
  });

  it('rejects a required table whose graph points at a table that does not exist', () => {
    const complete = content();
    const dangling: LootTableContentEntry = {
      ...lootTable('loot-table.floor-scatter-mid', []),
      choices: [
        {
          contentId: null,
          lootTableId: 'loot-table.does-not-exist',
          weight: 1,
          minimumQuantity: 1,
          maximumQuantity: 1,
        },
      ],
    };
    const pack: CompiledContentPack = {
      ...complete,
      entries: complete.entries.map((entry) => (entry.id === dangling.id ? dangling : entry)),
    };

    expect(() => validateRequiredFloorLootTables(pack)).toThrow(/loot-table\.does-not-exist/);
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

const weaponScatterItem: ItemContentEntry = {
  ...scatterItem('item.test-scatter-weapon'),
  category: 'weapon',
  equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
  combat: {
    accuracy: 0,
    defense: 0,
    armor: 0,
    damage: { count: 1, sides: 4, bonus: 0 },
    range: 1,
    ammunitionTag: null,
  },
};

const scatterCurse: CurseContentEntry = {
  kind: 'curse',
  id: 'curse.scatter-weapon-test',
  name: 'Test Scatter Curse',
  tags: ['curse', 'weapon'],
  revealText: 'It scatters, and still it hungers.',
  drawbackModifiers: { meleeAccuracy: -1 },
  trigger: null,
};

/** Every band's `chanceBps` forced to 10000 and `capBps` raised to 10000 (uncapped) so a curse
 * always resolves once rolled -- the demo pack's authored `capBps` (5000) would otherwise clamp a
 * forced 10000 chance back down to a 50/50. */
function forceCurseChance(pack: CompiledContentPack): CompiledContentPack {
  return {
    ...pack,
    entries: pack.entries.map((entry) => {
      if (entry.kind !== 'balance') return entry;
      const balance = entry as BalanceContentEntry;
      return {
        ...balance,
        curses: {
          ...balance.curses,
          chanceBps: { shallow: 10000, mid: 10000, deep: 10000 },
          capBps: 10000,
        },
      };
    }),
  };
}

/** `fixture()`'s default floor sits at depth 3, which the demo pack's depth bands (shallowMaxDepth
 * 6) resolve to `shallow` -- only the shallow scatter table is swapped for an all-weapon choice
 * list so every drawn scatter item is curse-eligible. */
function cursedScatterContent(): CompiledContentPack {
  const base = content();
  const withWeaponTable: CompiledContentPack = {
    ...base,
    entries: [
      ...base.entries.filter((entry) => entry.id !== 'loot-table.floor-scatter-shallow'),
      weaponScatterItem,
      scatterCurse,
      lootTable('loot-table.floor-scatter-shallow', [weaponScatterItem.id]),
    ],
  };
  return forceCurseChance(withWeaponTable);
}

describe('placeFloorLoot curses', () => {
  it('rolls a curse onto every eligible scattered item, threading the loot-placement stream', () => {
    const f = fixture();
    const cursedContent = cursedScatterContent();
    const result = placeFloorLoot({ ...f, content: cursedContent }, SEED);
    const weaponItems = result.items.filter((item) => item.contentId === weaponScatterItem.id);
    expect(weaponItems.length).toBeGreaterThan(0);
    for (const item of weaponItems) {
      expect(item.curse).toEqual({ curseId: scatterCurse.id, revealed: false });
    }
    expect(result.state).not.toEqual(SEED);
  });
});
