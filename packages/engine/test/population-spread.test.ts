import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  ContentEntry,
  EncounterContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  placePopulation,
  type ActiveRun,
  type FloorSnapshot,
  type Uint32State,
} from '../src/index.js';

function monster(id: string): MonsterContentEntry {
  return {
    kind: 'monster',
    id,
    name: id,
    tags: ['test'],
    glyph: 'm',
    color: '#808080',
    attributes: { might: 3, agility: 4, vitality: 5, wits: 2, resolve: 1 },
    health: 7,
    speed: 90,
    accuracy: 1,
    defense: 2,
    perception: 4,
    damage: { count: 1, sides: 4, bonus: 0 },
    armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    behaviorParameters: {},
    minDepth: 1,
    maxDepth: 20,
    rarity: 'common',
  };
}

const placement = {
  minimumStairDistance: 1,
  minimumObjectiveDistance: 1,
  maximumMemberDistance: 3,
  allowedTerrainTags: ['floor'],
  requiresVaultSlot: false,
  failureMode: 'optional' as const,
};

function group(id: string): EncounterContentEntry {
  return {
    kind: 'encounter',
    id,
    name: id,
    tags: ['test'],
    model: 'group',
    adminDescription: null,
    minDepth: 1,
    maxDepth: 10,
    environmentTags: [],
    requiredVaultTags: [],
    weight: 1,
    rarity: 'common',
    runAppearanceChance: 1,
    discoveryProtectionIncrement: 0,
    discoveryProtectionCap: 1,
    maximumInstancesPerRun: 2,
    placement,
    intentPresentation: { visible: true },
    definition: {
      roles: [
        {
          roleId: 'grunt',
          monsterId: 'monster.test-a',
          minimumQuantity: 5,
          maximumQuantity: 5,
        },
      ],
      leaderRoleId: 'grunt',
      leaderChance: 0,
      leaderAlternateGlyph: null,
      leaderAccentColor: '#ffffff',
    },
  } as unknown as EncounterContentEntry;
}

function pack(encounters: readonly EncounterContentEntry[]): CompiledContentPack {
  const base = createDemoContentPack();
  const extras: ContentEntry[] = [monster('monster.test-a')];
  return { ...base, entries: [...base.entries, ...extras, ...encounters] };
}

/** A wide, mostly-open floor matching the shape depth-1 floors have in play (160x50). */
function wideFloor(): FloorSnapshot {
  const width = 160;
  const height = 50;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return 0 as const;
    return 1 as const;
  });
  return {
    floorId: 'floor.spread',
    seed: [11, 12, 13, 14],
    generatorVersion: 2,
    width,
    height,
    depth: 1,
    tiles,
    entities: [],
    themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 },
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
    stairUp: { x: 1, y: 1 },
    stairDown: { x: width - 2, y: height - 2 },
    vaults: [],
    placementSlots: [],
  };
}

function runFor(encounter: EncounterContentEntry, encounters: Uint32State): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    rng: { ...base.rng, encounters },
    encounterDecisions: [
      {
        encounterId: encounter.id,
        baseProbability: encounter.runAppearanceChance,
        protectionBonus: 0,
        effectiveProbability: encounter.runAppearanceChance,
        eligible: true,
        reachedEligibleDepth: false,
        encountered: false,
        instancesCreated: 0,
      },
    ],
  };
}

const SEEDS: readonly Uint32State[] = [
  [11, 22, 33, 44],
  [1, 2, 3, 4],
  [99, 7, 123, 55],
  [5, 500, 50, 5000],
  [42, 42, 42, 42],
];

describe('population placement spreads groups across the floor', () => {
  it('does not clamp every seed to the top edge and varies the anchor across seeds', () => {
    const encounter = group('encounter.spread-group');
    const content = pack([encounter]);
    const floor = wideFloor();

    const minYs = SEEDS.map((seed) => {
      const result = placePopulation({
        run: runFor(encounter, seed),
        floor,
        content,
        forcedEncounterId: encounter.id,
      });
      expect(result.status).toBe('placed');
      if (result.status !== 'placed') throw new Error('placement failed');
      return Math.min(...result.createdActors.map((actor) => actor.y));
    });

    // The bug: every seed clustered at y <= 4 (top edge). After seeding the scan
    // origin, placements spread down the floor.
    expect(minYs.some((y) => y > floor.height / 4)).toBe(true);
    // And the anchor row is not identical across every seed.
    expect(new Set(minYs).size).toBeGreaterThan(1);
  });
});
