import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  heroHoldsAllFragments,
  nextUint32,
  placeFloorPopulations,
  stableJson,
  tabletFragmentIds,
  TABLET_FRAGMENT_TAG,
  type ActiveRun,
  type FloorSnapshot,
  type ItemInstance,
  type Uint32State,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const FRAGMENT_IDS = ['item.tablet-fragment.a', 'item.tablet-fragment.b', 'item.tablet-fragment.c'];

function fragment(contentId: string, overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    itemId: `${contentId}.instance`,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' },
    ...overrides,
  };
}

function runWithItems(items: readonly ItemInstance[]): ActiveRun {
  const run = createDemoRun();
  return { ...run, items };
}

describe('tabletFragmentIds', () => {
  it('returns exactly the 3 authored fragment ids, each carrying the tablet-fragment tag', () => {
    const ids = tabletFragmentIds(pack);
    expect([...ids].sort()).toEqual(FRAGMENT_IDS);
    for (const id of ids) {
      const entry = pack.entries.find((candidate) => candidate.id === id);
      expect(entry?.kind).toBe('item');
      expect(entry?.tags).toContain(TABLET_FRAGMENT_TAG);
    }
  });
});

describe('heroHoldsAllFragments', () => {
  it('is true when the hero backpack holds all 3 fragments', () => {
    const run = runWithItems(FRAGMENT_IDS.map((id) => fragment(id)));
    expect(heroHoldsAllFragments(run, pack)).toBe(true);
  });

  it('is false when one fragment is missing', () => {
    const run = runWithItems(FRAGMENT_IDS.slice(0, 2).map((id) => fragment(id)));
    expect(heroHoldsAllFragments(run, pack)).toBe(false);
  });

  it('is false when a fragment sits on the floor rather than the hero backpack', () => {
    const items = [
      fragment(FRAGMENT_IDS[0]),
      fragment(FRAGMENT_IDS[1]),
      fragment(FRAGMENT_IDS[2], {
        location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
      }),
    ];
    const run = runWithItems(items);
    expect(heroHoldsAllFragments(run, pack)).toBe(false);
  });

  it('is false when content defines zero fragments (guard against a vacuous true)', () => {
    const emptyPack: CompiledContentPack = { ...pack, entries: [] };
    const run = runWithItems(FRAGMENT_IDS.map((id) => fragment(id)));
    expect(heroHoldsAllFragments(run, emptyPack)).toBe(false);
  });
});

describe('deep-floor fragment spawn', () => {
  const TEST_FRAGMENT_IDS = [
    'item.test-fragment.a',
    'item.test-fragment.b',
    'item.test-fragment.c',
  ] as const;

  function testFragmentItem(id: string): ItemContentEntry {
    return {
      kind: 'item',
      id,
      name: id,
      tags: [TABLET_FRAGMENT_TAG],
      glyph: '=',
      color: '#c9b37a',
      category: 'misc',
      stackLimit: 1,
      price: 0,
      rarity: 'legendary',
      heirloomEligible: false,
      minDepth: 15,
      maxDepth: 20,
      actionCost: 100,
      equipment: null,
      combat: null,
      light: null,
      identification: { mode: 'known', poolId: null },
      effects: [],
    };
  }

  function fragmentPack(): CompiledContentPack {
    const base = createDemoContentPack();
    return {
      ...base,
      entries: [...base.entries, ...TEST_FRAGMENT_IDS.map((id) => testFragmentItem(id))],
    };
  }

  function testFloor(depth: number, overrides: Partial<FloorSnapshot> = {}): FloorSnapshot {
    const width = 9;
    const height = 7;
    const tiles = Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      return x === 0 || y === 0 || x === width - 1 || y === height - 1
        ? (0 as const)
        : (1 as const);
    });
    return {
      floorId: 'floor.deep',
      seed: [21, 22, 23, 24],
      generatorVersion: 2,
      width,
      height,
      depth,
      tiles,
      entities: [],
      themeId: 'theme.cavern',
      ambient: { color: [0, 0, 0], strength: 0 },
      knowledge: createUnknownKnowledge(tiles.length),
      lights: [],
      stairUp: { x: 1, y: 1 },
      stairDown: { x: 7, y: 5 },
      vaults: [],
      placementSlots: [],
      ...overrides,
    };
  }

  function runAt(encounters: Uint32State, overrides: Partial<ActiveRun> = {}): ActiveRun {
    const base = createDemoRun();
    return { ...base, rng: { ...base.rng, encounters }, encounterDecisions: [], ...overrides };
  }

  function placedFragmentContentIds(run: ActiveRun, floor: FloorSnapshot): readonly string[] {
    return run.items
      .filter((item) => item.location.type === 'floor' && item.location.floorId === floor.floorId)
      .map((item) => item.contentId)
      .filter((contentId) => (TEST_FRAGMENT_IDS as readonly string[]).includes(contentId));
  }

  /**
   * The spawn roll is rare (~1-in-40 per floor generation): search a deterministic sequence of
   * seeds (advancing via the same `nextUint32` the engine's own RNG streams use) for one that
   * lands a fragment on an empty deep floor, so the determinism/no-duplicate tests below exercise
   * a real hit rather than asserting only on misses.
   */
  function findSeedThatSpawnsAFragment(): Uint32State {
    let seed: Uint32State = [5, 6, 7, 8];
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const run = runAt(seed);
      const result = placeFloorPopulations({
        run,
        floor: testFloor(15),
        content: fragmentPack(),
      });
      if (placedFragmentContentIds(result.state, testFloor(15)).length === 1) return seed;
      seed = nextUint32(seed).state;
    }
    throw new Error('test invariant: no seed in range spawned a fragment');
  }

  it('is deterministic: the same seed on a deep floor produces the same placement', () => {
    const seed = findSeedThatSpawnsAFragment();
    const floor = testFloor(15);
    const first = placeFloorPopulations({ run: runAt(seed), floor, content: fragmentPack() });
    const second = placeFloorPopulations({ run: runAt(seed), floor, content: fragmentPack() });
    expect(stableJson(first.state.items)).toBe(stableJson(second.state.items));
    expect(stableJson(first.state.rng)).toBe(stableJson(second.state.rng));
    expect(placedFragmentContentIds(first.state, floor)).toHaveLength(1);
  });

  it('never places a fragment type the hero already holds this run (run-local no-duplicate)', () => {
    const seed = findSeedThatSpawnsAFragment();
    const floor = testFloor(15);
    const withoutHolding = placeFloorPopulations({
      run: runAt(seed),
      floor,
      content: fragmentPack(),
    });
    const spawnedId = placedFragmentContentIds(withoutHolding.state, floor)[0]!;

    const heroAlreadyHolds = runAt(seed, {
      items: [fragment(spawnedId)],
    });
    const withHolding = placeFloorPopulations({
      run: heroAlreadyHolds,
      floor,
      content: fragmentPack(),
    });
    expect(placedFragmentContentIds(withHolding.state, floor)).not.toContain(spawnedId);
  });

  it('never places a fragment on a shallow floor (depth < 15)', () => {
    let seed: Uint32State = [5, 6, 7, 8];
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const floor = testFloor(14);
      const result = placeFloorPopulations({ run: runAt(seed), floor, content: fragmentPack() });
      expect(placedFragmentContentIds(result.state, floor)).toHaveLength(0);
      seed = nextUint32(seed).state;
    }
  });
});
