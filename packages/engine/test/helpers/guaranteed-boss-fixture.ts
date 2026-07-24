import type {
  BossEncounterContentEntry,
  CompiledContentPack,
  EncounterContentEntry,
  MonsterContentEntry,
  VaultContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  type ActiveRun,
  type FloorSnapshot,
} from '../../src/index.js';

const WIDTH = 9;
const HEIGHT = 7;

function monster(id: string): MonsterContentEntry {
  return {
    kind: 'monster',
    id,
    name: id,
    tags: ['test'],
    glyph: 'm',
    color: '#808080',
    attributes: { might: 6, agility: 4, vitality: 8, wits: 2, resolve: 4 },
    health: 40,
    speed: 100,
    accuracy: 3,
    defense: 4,
    perception: 5,
    damage: { count: 2, sides: 6, bonus: 2 },
    armor: 1,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    behaviorParameters: {},
    minDepth: 1,
    maxDepth: 20,
    rarity: 'legendary',
  };
}

const bossPlacement = {
  minimumStairDistance: 0,
  minimumObjectiveDistance: 0,
  maximumMemberDistance: 0,
  allowedTerrainTags: ['floor'],
  requiresVaultSlot: true,
  failureMode: 'optional' as const,
};

function bossEncounter(
  id: string,
  monsterId: string,
  requiredVaultTags: readonly string[],
  weight = 1,
): BossEncounterContentEntry {
  return {
    kind: 'encounter',
    id,
    name: id,
    tags: ['test', 'boss'],
    model: 'boss',
    adminDescription: null,
    minDepth: 1,
    maxDepth: 10,
    environmentTags: [],
    requiredVaultTags,
    weight,
    rarity: 'legendary',
    runAppearanceChance: 1,
    discoveryProtectionIncrement: 0,
    discoveryProtectionCap: 1,
    maximumInstancesPerRun: 1,
    placement: { ...bossPlacement, requiresVaultSlot: requiredVaultTags.length > 0 },
    intentPresentation: { visible: true },
    definition: {
      monsterId,
      phases: [],
      recoveryPerWorldTime: 0,
      recoveryCapPercent: 0,
      uniqueItemId: `item.${id}-reward`,
      enhancedLootTableId: `loot-table.${id}`,
      vaultTags: [],
    },
  };
}

/**
 * A weighted, vault-tag-gated `individual` encounter present alongside the bosses on every
 * `arenaTagPresent` floor. Its overwhelming weight against the arena boss's `weight: 0` proves
 * the guaranteed pre-pass forces the boss in ahead of (and independent from) the weighted draw --
 * without it, this filler would always win the floor's single weighted attempt and the boss would
 * never spawn. It shares the boss's vault-tag gate, so on an `arenaTagPresent: false` floor it is
 * excluded from `candidates()` exactly like the boss, keeping the RNG untouched.
 */
function fillerEncounter(monsterId: string): EncounterContentEntry {
  return {
    kind: 'encounter',
    id: 'encounter.arena-filler',
    name: 'Arena filler',
    tags: ['test'],
    model: 'individual',
    adminDescription: null,
    minDepth: 1,
    maxDepth: 10,
    environmentTags: [],
    requiredVaultTags: ['arena-tag'],
    weight: 1000,
    rarity: 'common',
    runAppearanceChance: 1,
    discoveryProtectionIncrement: 0,
    discoveryProtectionCap: 1,
    maximumInstancesPerRun: 8,
    placement: {
      minimumStairDistance: 0,
      minimumObjectiveDistance: 0,
      maximumMemberDistance: 0,
      allowedTerrainTags: ['floor'],
      requiresVaultSlot: false,
      failureMode: 'optional',
    },
    intentPresentation: { visible: true },
    definition: { monsterId, minimumQuantity: 1, maximumQuantity: 1 },
  };
}

function arenaVault(): VaultContentEntry {
  return {
    kind: 'vault',
    id: 'vault.guaranteed-boss-arena',
    name: 'Guaranteed boss arena',
    tags: ['arena-tag'],
    minDepth: 1,
    maxDepth: 10,
    rarity: 'legendary',
    weight: 1,
    maxPerFloor: 1,
    margin: 0,
    transforms: { rotations: [0], reflectHorizontal: false },
    layout: ['.'],
    legend: { '.': { terrain: 'floor', entrance: false, light: null, slot: null } },
    entranceCount: 0,
    requiredSlotIds: [],
  };
}

function fixtureFloor(withArena: boolean, blockArenaSlot = false): FloorSnapshot {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) return 0 as const;
    return 1 as const;
  });
  tiles[1 * WIDTH + 1] = 4;
  tiles[5 * WIDTH + 7] = 5;
  return {
    floorId: 'floor.guaranteed-boss',
    seed: [11, 12, 13, 14],
    generatorVersion: 2,
    width: WIDTH,
    height: HEIGHT,
    depth: 3,
    tiles,
    // A pre-existing entity pinned to the arena's `monster` slot cell (5,3) reserves it via
    // `reservedCellIndexes`, so `selectCells` finds zero legal vault anchors for the boss --
    // the only way to make an otherwise-eligible-with-arena-present guaranteed boss fail to
    // place, for exercising the pre-pass's invariant assertion.
    entities: blockArenaSlot ? [{ entityId: 'entity.arena-slot-blocker', x: 5, y: 3 }] : [],
    themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 },
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
    stairUp: { x: 1, y: 1 },
    stairDown: { x: 7, y: 5 },
    vaults: withArena
      ? [
          {
            placementId: 'vault-placement.guaranteed-boss-arena',
            vaultId: 'vault.guaranteed-boss-arena',
            x: 4,
            y: 2,
            width: 3,
            height: 3,
            rotation: 0,
            reflected: false,
            entrances: [{ x: 4, y: 3 }],
          },
        ]
      : [],
    placementSlots: withArena
      ? [
          {
            slotId: 'slot.guaranteed-boss-arena',
            vaultPlacementId: 'vault-placement.guaranteed-boss-arena',
            kind: 'monster',
            required: false,
            tags: ['arena-tag'],
            x: 5,
            y: 3,
          },
        ]
      : [],
  };
}

export interface GuaranteedBossFixtureOptions {
  readonly arenaTagPresent: boolean;
  readonly emptyTagBoss?: boolean;
  /** Reserves the arena's `monster` slot cell so the guaranteed boss has no legal anchor. */
  readonly blockArenaSlot?: boolean;
}

export interface GuaranteedBossFixture {
  readonly content: CompiledContentPack;
  readonly run: ActiveRun;
  readonly floor: FloorSnapshot;
}

/**
 * Builds a minimal content pack + run + floor for exercising the guaranteed vault-gated boss
 * pre-pass in `placeFloorPopulations`: one boss encounter (`encounter.arena-boss`) whose
 * non-empty `requiredVaultTags: ['arena-tag']` is satisfied only when `arenaTagPresent` places a
 * vault (and matching `monster` slot) carrying that tag, and optionally a second boss
 * (`encounter.wild-boss`) with empty required vault tags to prove it is never force-placed.
 */
export function buildGuaranteedBossFixture(
  options: GuaranteedBossFixtureOptions,
): GuaranteedBossFixture {
  const arenaBossMonster = monster('monster.arena-boss');
  // weight: 0 -- never wins the weighted draw against the filler below; only the guaranteed
  // pre-pass's `forcedEncounterId` call can place it.
  const arenaBossEncounter = bossEncounter(
    'encounter.arena-boss',
    arenaBossMonster.id,
    ['arena-tag'],
    0,
  );
  const wildBossMonster = monster('monster.wild-boss');
  const wildBossEncounter = bossEncounter('encounter.wild-boss', wildBossMonster.id, []);
  const fillerMonster = monster('monster.arena-filler');
  const filler = fillerEncounter(fillerMonster.id);

  const base = createDemoContentPack();
  const content: CompiledContentPack = {
    ...base,
    entries: [
      ...base.entries,
      arenaBossMonster,
      arenaBossEncounter,
      fillerMonster,
      filler,
      ...(options.emptyTagBoss === true ? [wildBossMonster, wildBossEncounter] : []),
      ...(options.arenaTagPresent ? [arenaVault()] : []),
    ],
  };

  const encounterDecisions = [
    {
      encounterId: arenaBossEncounter.id,
      baseProbability: 1,
      protectionBonus: 0,
      effectiveProbability: 1,
      eligible: true,
      reachedEligibleDepth: false,
      encountered: false,
      instancesCreated: 0,
    },
    {
      encounterId: filler.id,
      baseProbability: filler.runAppearanceChance,
      protectionBonus: 0,
      effectiveProbability: filler.runAppearanceChance,
      eligible: true,
      reachedEligibleDepth: false,
      encountered: false,
      instancesCreated: 0,
    },
    ...(options.emptyTagBoss === true
      ? [
          {
            encounterId: wildBossEncounter.id,
            baseProbability: 1,
            protectionBonus: 0,
            effectiveProbability: 1,
            eligible: false,
            reachedEligibleDepth: false,
            encountered: false,
            instancesCreated: 0,
          },
        ]
      : []),
  ].sort((left, right) => (left.encounterId < right.encounterId ? -1 : 1));

  const baseRun = createDemoRun();
  const run: ActiveRun = {
    ...baseRun,
    contentHash: content.hash,
    rng: { ...baseRun.rng, encounters: [1, 2, 3, 4] },
    encounterDecisions,
  };

  return {
    content,
    run,
    floor: fixtureFloor(options.arenaTagPresent, options.blockArenaSlot ?? false),
  };
}
