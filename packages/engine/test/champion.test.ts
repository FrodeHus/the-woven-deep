import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  EnchantmentContentEntry,
  EncounterContentEntry,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
  MonsterContentEntry,
  SpellContentEntry,
} from '@woven-deep/content';
import {
  advanceBosses,
  advanceFallenHeroEncounters,
  createPopulationLoot,
  createDemoContentPack,
  createDemoRun,
  createFallenHeroRunDecisions,
  decodeActiveRun,
  dropItem,
  encodeActiveRun,
  normalizeFallenHero,
  placeFallenHeroEncounters,
  fallenHeroCombatModifiers,
  mergeStacks,
  pickupItem,
  projectGameplayState,
  retainEchoCandidates,
  rollDie,
  validateContentBoundRun,
  validateEchoLootGraph,
  type ActiveRun,
  type ActorState,
  type BossPopulation,
  type FallenHeroStandingSnapshot,
  type RecordedHeirloomSnapshot,
  type Uint32State,
} from '../src/index.js';

const monster: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.champion-fallback',
  name: 'Ashen Warden',
  tags: ['boss'],
  glyph: 'W',
  color: '#aa7755',
  attributes: { might: 18, agility: 12, vitality: 20, wits: 10, resolve: 16 },
  health: 120,
  speed: 100,
  accuracy: 18,
  defense: 16,
  perception: 10,
  damage: { count: 2, sides: 6, bonus: 2 },
  armor: 8,
  resistances: { physical: 10, fire: 20, cold: 0, lightning: 0, poison: 30, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  minDepth: 1,
  maxDepth: 20,
  rarity: 'legendary',
};

function item(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    description: '',
    tags: [],
    glyph: ')',
    color: '#c0c0c0',
    category: 'weapon',
    stackLimit: 1,
    price: 10,
    rarity: 'rare',
    heirloomEligible: true,
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

const spell: SpellContentEntry = {
  kind: 'spell',
  id: 'spell.ember',
  name: 'Ember',
  description: '',
  tags: [],
  targetingId: 'target.actor',
  range: 5,
  actionCost: 100,
  effects: [],
};
/** A second spell, so a multi-ability standing can be exercised. */
const galeSpell: SpellContentEntry = { ...spell, id: 'spell.gale', name: 'Gale' };
const echoLoot: LootTableContentEntry = {
  kind: 'loot-table',
  id: 'loot-table.echo',
  name: 'Echo loot',
  description: '',
  tags: [],
  rolls: 1,
  choices: [
    {
      contentId: 'item.echo-loot',
      lootTableId: null,
      weight: 1,
      minimumQuantity: 1,
      maximumQuantity: 1,
    },
  ],
};
const template: FallenChampionTemplateContentEntry = {
  kind: 'fallen-champion-template',
  id: 'fallen-champion-template.core',
  name: "The Deep's Champion",
  tags: ['champion'],
  fallbackMonsterId: monster.id,
  fallbackItemId: 'item.fallback',
  minimumHealth: 30,
  maximumHealth: 100,
  attributeMaximum: 20,
  damageMaximum: 24,
  abilityLimit: 2,
  echoAppearanceChance: 0.5,
  maximumEchoesPerRun: 2,
  echoHealthPercent: 65,
  echoDamagePercent: 70,
  echoDefensePercent: 80,
  echoAbilityLimit: 1,
  echoLootTableId: echoLoot.id,
  heirloomSelection: {
    rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 },
    qualityRankBonus: 2,
  },
  // Required since content v13: the haunt need derivation reads it, and the gameplay projection
  // derives `needCategories` from it for every projected haunt.
  appeasement: {
    classFavors: { loomcaller: ['scroll', 'potion'] },
    causelessCategories: ['light'],
    defaultCategories: ['food', 'potion'],
  },
};

const honedEnchantment: EnchantmentContentEntry = {
  kind: 'enchantment',
  id: 'enchantment.honed',
  name: 'Honed',
  tags: ['enchantment', 'weapon'],
  categories: ['weapon'],
  modifiers: { meleeDamageBonus: 2 },
  weight: 1,
};

function pack(): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      monster,
      honedEnchantment,
      item('item.heirloom', {
        combat: {
          accuracy: 3,
          defense: 2,
          armor: 1,
          damage: { count: 1, sides: 2, bonus: 3 },
          range: 1,
          ammunitionTag: null,
        },
        light: {
          color: [255, 220, 180],
          radius: 3,
          strength: 100,
          fuelCapacity: 20,
          fuelPerTime: 1,
          warningThresholds: [5],
          fuelTags: ['oil'],
        },
      }),
      item('item.fallback'),
      item('item.echo-loot', { heirloomEligible: false, rarity: 'common', equipment: null }),
      spell,
      galeSpell,
      echoLoot,
      template,
    ],
  };
}

function standing(
  rank: number,
  overrides: Partial<FallenHeroStandingSnapshot> = {},
): FallenHeroStandingSnapshot {
  const hallRecordId = `hall.hero-${rank}`;
  const heirloom = {
    contentId: 'item.heirloom',
    sourceItemId: `item.original-${rank}`,
    enchantment: { enchantmentId: 'enchantment.honed', modifiers: { meleeDamageBonus: 2 } },
    condition: 73,
    charges: 4,
    fuel: 9,
    curse: null,
    qualityRank: 2,
    displayName: `Hero ${rank}'s Blade`,
    glyph: ')',
    color: '#ddeeff',
    originatingHallRecordId: hallRecordId,
  };
  const resolved = {
    rank,
    hallRecordId,
    heroName: `Hero ${rank}`,
    portraitGlyph: '@',
    classTags: ['fighter'],
    attributes: { might: 99, agility: 12, vitality: 18, wits: 11, resolve: 13 },
    equippedItemContentIds: ['item.heirloom'],
    signatureAbilityIds: ['spell.ember'],
    deathDepth: 4,
    sourceContentHash: 'b'.repeat(64),
    heirloom,
    cause: null,
    ...overrides,
  };
  // The recorded heirloom is always a MEMBER of the death inventory, so an overridden heirloom has
  // to travel into the default inventory too -- otherwise a fixture that degrades the heirloom
  // would still drop the pristine original.
  return { ...resolved, deathInventory: overrides.deathInventory ?? [resolved.heirloom] };
}

function initialized(
  standings: readonly FallenHeroStandingSnapshot[],
  conquered: readonly string[] = [],
): ActiveRun {
  const base = createDemoRun();
  const selected = createFallenHeroRunDecisions({
    standings,
    conqueredChampionRecordIds: conquered,
    template,
    state: base.rng['population-gates'],
  });
  return {
    ...base,
    contentHash: pack().hash,
    fallenHeroStandings: standings,
    conqueredChampionRecordIds: conquered,
    fallenHeroDecisions: selected.decisions,
    rng: { ...base.rng, 'population-gates': selected.state },
  };
}

function withArena(run: ActiveRun, depth = 4, slots = 3): ActiveRun {
  const floor = run.floors[0]!;
  const cells = [
    { x: 5, y: 1 },
    { x: 5, y: 2 },
    { x: 5, y: 3 },
  ].slice(0, slots);
  return {
    ...run,
    floors: [
      {
        ...floor,
        depth,
        vaults: [
          {
            placementId: 'vault.side',
            vaultId: 'vault.side-arena',
            x: 4,
            y: 0,
            width: 3,
            height: 5,
            rotation: 0,
            reflected: false,
            entrances: [{ x: 4, y: 2 }],
          },
        ],
        placementSlots: cells.map((cell, index) => ({
          slotId: `slot.side-${index}`,
          vaultPlacementId: 'vault.side',
          kind: 'monster' as const,
          required: false,
          tags: ['side-arena', 'fallen-hero'],
          ...cell,
        })),
      },
    ],
  };
}

// Two extra pieces beside the recorded heirloom, so a champion's inventory is a real kit rather
// than three copies of one blade. Added to the shared pack rather than replacing it: entries are
// additive and the compiled hash is the demo pack's either way, so `initialized`'s `contentHash`
// still agrees.
function kitPack(): CompiledContentPack {
  const base = pack();
  return {
    ...base,
    entries: [
      ...base.entries,
      item('item.hero-armor', {
        name: 'Scarred Jerkin',
        category: 'armor',
        glyph: '[',
        color: '#a08050',
        equipment: { slots: ['body'], handedness: 'one-handed', reservedSlots: [] },
      }),
      item('item.hero-lantern', {
        name: 'Guttering Lantern',
        category: 'light',
        glyph: '(',
        color: '#ffd9a0',
        equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
        light: {
          color: [255, 217, 160],
          radius: 6,
          strength: 160,
          fuelCapacity: 60,
          fuelPerTime: 1,
          warningThresholds: [10],
          fuelTags: ['oil'],
        },
      }),
      item('item.hero-relic', {
        name: 'Bound Signet',
        category: 'ring',
        glyph: '"',
        color: '#88ddff',
        rarity: 'legendary',
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
        artifact: { canon: true, signature: null, drawbackModifiers: {}, light: null },
      }),
      item('item.hero-ring', {
        name: 'Worn Signet',
        category: 'ring',
        glyph: '=',
        color: '#c8c8d8',
        equipment: { slots: ['left-ring'], handedness: 'one-handed', reservedSlots: [] },
      }),
    ],
  };
}

/** The first `count` pieces of a haunt's death inventory, the recorded heirloom first (it is the
 * distinguished member, matched by `sourceItemId`). */
function withDeathInventory(count: number, rank = 1): readonly RecordedHeirloomSnapshot[] {
  const { heirloom } = standing(rank);
  return [
    heirloom,
    {
      ...heirloom,
      contentId: 'item.hero-armor',
      sourceItemId: 'item.original-1.armor',
      enchantment: null,
      charges: null,
      fuel: null,
      condition: 61,
      displayName: "Hero 1's Jerkin",
      glyph: '[',
      color: '#a08050',
    },
    {
      ...heirloom,
      contentId: 'item.hero-lantern',
      sourceItemId: 'item.original-1.lantern',
      enchantment: null,
      charges: null,
      fuel: 40,
      condition: 88,
      displayName: "Hero 1's Lantern",
      glyph: '(',
      color: '#ffd9a0',
    },
    {
      ...heirloom,
      contentId: 'item.hero-ring',
      sourceItemId: `item.original-${rank}.ring`,
      enchantment: null,
      charges: null,
      fuel: null,
      condition: 95,
      displayName: `Hero ${rank}'s Signet`,
      glyph: '=',
      color: '#c8c8d8',
    },
  ].slice(0, count);
}

describe('fallen hero selection', () => {
  it('creates no decisions without host standings and consumes no rolls', () => {
    const state = createDemoRun().rng['population-gates'];
    expect(
      createFallenHeroRunDecisions({
        standings: [],
        conqueredChampionRecordIds: [],
        template,
        state,
      }),
    ).toEqual({ decisions: [], state });
  });

  it('suppresses a conquered rank one without promoting lower standings', () => {
    const standings = [standing(1), standing(2)];
    const result = createFallenHeroRunDecisions({
      standings,
      conqueredChampionRecordIds: ['hall.hero-1'],
      template,
      state: createDemoRun().rng['population-gates'],
    });
    expect(result.decisions[0]).toMatchObject({ rank: 1, role: 'champion', retained: false });
    expect(result.decisions[1]).toMatchObject({ rank: 2, role: 'echo' });
    expect(
      result.decisions.filter((decision) => decision.role === 'champion' && decision.retained),
    ).toHaveLength(0);
  });

  it('retains lowest passing independent rolls and resolves ties by rank then record ID', () => {
    const candidates = [
      standing(4, { hallRecordId: 'hall.z' }),
      standing(2, { hallRecordId: 'hall.b' }),
      standing(3, { hallRecordId: 'hall.c' }),
      standing(3, { hallRecordId: 'hall.a' }),
      standing(5, { hallRecordId: 'hall.never' }),
    ];
    expect(
      retainEchoCandidates({
        candidates,
        rolls: [20, 10, 10, 10, 0xffff_ffff],
        chance: 0.5,
        maximum: 3,
      }),
    ).toEqual(['hall.b', 'hall.a', 'hall.c']);
  });

  it('persists rolls and decisions byte-identically instead of rerolling on reload', () => {
    const standings = [standing(1), standing(2), standing(3)];
    const run = initialized(standings);
    const loaded = decodeActiveRun(encodeActiveRun(run));
    expect(loaded.fallenHeroDecisions).toEqual(run.fallenHeroDecisions);
    expect(loaded.rng['population-gates']).toEqual(run.rng['population-gates']);
  });
});

describe('normalization and optional placement', () => {
  it('clamps current combat boundaries, filters missing content, and makes Echo limits strictly weaker', () => {
    const historical = standing(1, {
      equippedItemContentIds: ['item.heirloom', 'item.missing'],
      signatureAbilityIds: ['spell.ember', 'spell.missing'],
    });
    const champion = normalizeFallenHero({
      standing: historical,
      template,
      content: pack(),
      role: 'champion',
    });
    const echo = normalizeFallenHero({
      standing: { ...historical, rank: 2 },
      template,
      content: pack(),
      role: 'echo',
    });
    expect(champion).toMatchObject({
      displayName: "Hero 1, the Deep's Champion",
      monsterId: monster.id,
      attributes: { might: 20 },
      health: 100,
      equipmentContentIds: ['item.heirloom'],
      abilityIds: ['spell.ember'],
    });
    expect(champion.damageMaximum).toBeLessThanOrEqual(template.damageMaximum);
    expect(echo.displayName).toBe('Echo of Hero 1');
    expect(echo.health).toBeLessThan(champion.health);
    expect(echo.damageMaximum).toBeLessThan(champion.damageMaximum);
    expect(echo.defenseMaximum).toBeLessThan(champion.defenseMaximum);
    expect(echo.accuracyMaximum).toBeLessThan(champion.accuracyMaximum);
    expect(echo.abilityIds.length).toBeLessThan(champion.abilityIds.length);
    expect(echo.abilityIds.length).toBeLessThanOrEqual(template.echoAbilityLimit);
  });

  it('omits current-valid negative equipment that would erase strict Echo combat boundaries', () => {
    const cursed = item('item.cursed', {
      combat: {
        accuracy: -99,
        defense: -99,
        armor: 0,
        damage: { count: 1, sides: 1, bonus: -99 },
        range: 1,
        ammunitionTag: null,
      },
    });
    const current = { ...pack(), entries: [...pack().entries, cursed] };
    const historical = standing(1, { equippedItemContentIds: ['item.cursed', 'item.heirloom'] });
    const champion = normalizeFallenHero({
      standing: historical,
      template,
      content: current,
      role: 'champion',
    });
    const echo = normalizeFallenHero({
      standing: { ...historical, rank: 2 },
      template,
      content: current,
      role: 'echo',
    });
    expect(champion.equipmentContentIds).toEqual(['item.heirloom']);
    expect(echo.equipmentContentIds).toEqual(['item.heirloom']);
    expect(echo.damageMaximum).toBeLessThan(champion.damageMaximum);
    expect(echo.defenseMaximum).toBeLessThan(champion.defenseMaximum);
    expect(echo.accuracyMaximum).toBeLessThan(champion.accuracyMaximum);
    const echoActor = {
      ...createDemoRun().actors[0]!,
      actorId: 'actor.echo',
      contentId: monster.id,
      playerControlled: false,
      populationId: 'population.echo',
      health: echo.health,
      maxHealth: echo.health,
    };
    expect(
      fallenHeroCombatModifiers({
        state: {
          actors: [echoActor],
          fallenHeroStandings: [{ ...historical, rank: 2 }],
          populations: [
            {
              populationId: 'population.echo',
              encounterId: template.id,
              floorId: 'floor.demo',
              model: 'echo',
              createdAt: 0,
              livingMemberIds: ['actor.echo'],
              formerMemberIds: [],
              actorId: 'actor.echo',
              hallRecordId: historical.hallRecordId,
              rank: 2,
              defeated: false,
              lootCreated: false,
              equipmentContentIds: echo.equipmentContentIds,
              abilityIds: echo.abilityIds,
            },
          ],
        },
        content: current,
        actorId: 'actor.echo',
      }),
    ).toMatchObject({
      accuracy: echo.accuracyMaximum - monster.accuracy,
      defense: echo.defenseMaximum - monster.defense,
    });
  });

  it('omits an Echo whose current build has no ability that can be made strictly weaker', () => {
    const standings = [standing(1), standing(2, { signatureAbilityIds: [] })];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2
          ? { ...decision, retained: true, gateRoll: 1 }
          : { ...decision, retained: false },
      ),
    };
    const run = withArena(forced, 4);
    expect(() =>
      normalizeFallenHero({ standing: standings[1]!, template, content: pack(), role: 'echo' }),
    ).toThrow(/ability.*strictly weaker/i);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations).toHaveLength(0);
    expect(placed.decisions.find((decision) => decision.rank === 2)).toMatchObject({
      retained: true,
      encountered: false,
    });
  });

  it('honors recorded death depth and only uses bypassable optional side-arena slots', () => {
    let run = withArena(initialized([standing(1)]), 3);
    expect(
      placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() }).populations,
    ).toHaveLength(0);
    run = withArena(run, 4);
    const result = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(result.populations).toHaveLength(1);
    expect(result.actors[0]!.populationPresentation?.name).toBe("Hero 1, the Deep's Champion");
    expect(result.floor.stairUp).toEqual(run.floors[0]!.stairUp);
    const requiredSlotRun = {
      ...run,
      floors: [
        {
          ...run.floors[0]!,
          placementSlots: run.floors[0]!.placementSlots.map((slot) => ({
            ...slot,
            required: true,
          })),
        },
      ],
    };
    // Required slots stay off limits, but the champion is still placed -- on the open-cell
    // fallback, outside the vault the required slots belong to.
    const required = placeFallenHeroEncounters({
      run: requiredSlotRun,
      floor: requiredSlotRun.floors[0]!,
      content: pack(),
    });
    expect(required.populations).toHaveLength(1);
    expect(
      requiredSlotRun.floors[0]!.placementSlots.some(
        (slot) => slot.x === required.actors[0]!.x && slot.y === required.actors[0]!.y,
      ),
    ).toBe(false);
  });

  it('falls back to a deterministic open cell when the death-depth floor authors no fallen-hero slot', () => {
    // `withArena(run, 4, 0)` keeps the vault footprint (x 4..6) but authors zero slots, which is
    // every shipping floor that rolls no fallen-hero vault.
    const run = withArena(initialized([standing(1)]), 4, 0);
    const floor = run.floors[0]!;
    expect(floor.placementSlots).toHaveLength(0);

    const placed = placeFallenHeroEncounters({ run, floor, content: pack() });
    expect(placed.populations).toHaveLength(1);
    expect(placed.populations[0]!.model).toBe('champion');
    const actor = placed.actors[0]!;
    // First qualifying cell in row-major order: (1,1) holds the hero, so (2,1) wins.
    expect({ x: actor.x, y: actor.y }).toEqual({ x: 2, y: 1 });
    // The parts of the envelope this floor can exercise: walkable, outside the vault footprint,
    // off a body. (Stair anchors and protected routes are covered by the chokepoint case below,
    // which authors objective points; this fixture floor has neither stair.)
    expect(floor.tiles[actor.y * floor.width + actor.x]).toBe(1);
    expect(
      floor.vaults.some(
        (vault) =>
          actor.x >= vault.x &&
          actor.x < vault.x + vault.width &&
          actor.y >= vault.y &&
          actor.y < vault.y + vault.height,
      ),
    ).toBe(false);
    expect(run.actors.some((other) => other.x === actor.x && other.y === actor.y)).toBe(false);
    // Identical inputs, identical placement -- the fallback draws no randomness.
    const again = placeFallenHeroEncounters({ run, floor, content: pack() });
    expect(again.actors).toEqual(placed.actors);
    expect(again.populations).toEqual(placed.populations);
    expect(again.decisions).toEqual(placed.decisions);
  });

  it('prefers an authored slot over the open-cell fallback', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const slot = run.floors[0]!.placementSlots[0]!;
    expect({ x: placed.actors[0]!.x, y: placed.actors[0]!.y }).toEqual({ x: slot.x, y: slot.y });
  });

  it('falls back when the only fallen-hero slot exists but is unroutable, rather than erasing the champion', () => {
    // A floor whose two objective points are joined by a single corridor cell, and whose only
    // authored fallen-hero slot sits ON that chokepoint: standing there would sever the required
    // route, so the slot is unusable. The fallback still owes the run its champion.
    const lines = ['#######', '#.....#', '###.###', '#.....#', '#######'] as const;
    const tiles = lines.flatMap((line) => [...line].map((glyph) => (glyph === '#' ? 0 : 1)));
    const base = withArena(initialized([standing(1)]), 4, 0);
    const floor = base.floors[0]!;
    const run: ActiveRun = {
      ...base,
      floors: [
        {
          ...floor,
          tiles,
          vaults: [{ ...floor.vaults[0]!, x: 3, y: 2, width: 1, height: 1 }],
          placementSlots: [
            {
              slotId: 'slot.objective-west',
              vaultPlacementId: floor.vaults[0]!.placementId,
              kind: 'objective',
              required: true,
              tags: [],
              x: 1,
              y: 1,
            },
            {
              slotId: 'slot.objective-east',
              vaultPlacementId: floor.vaults[0]!.placementId,
              kind: 'objective',
              required: true,
              tags: [],
              x: 1,
              y: 3,
            },
            {
              slotId: 'slot.side-choke',
              vaultPlacementId: floor.vaults[0]!.placementId,
              kind: 'monster',
              required: false,
              tags: ['side-arena', 'fallen-hero'],
              x: 3,
              y: 2,
            },
          ],
        },
      ],
    };
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations).toHaveLength(1);
    const actor = placed.actors[0]!;
    // Not the chokepoint slot, and not on the protected route between the two objectives.
    expect({ x: actor.x, y: actor.y }).not.toEqual({ x: 3, y: 2 });
    expect({ x: actor.x, y: actor.y }).toEqual({ x: 4, y: 1 });
    const again = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(again.actors).toEqual(placed.actors);
  });

  it('skips the champion when the floor offers neither a slot nor a qualifying open cell', () => {
    const base = withArena(initialized([standing(1)]), 4, 0);
    const floor = base.floors[0]!;
    // One vault swallowing every walkable cell leaves the fallback nothing to stand on.
    const run: ActiveRun = {
      ...base,
      floors: [
        {
          ...floor,
          vaults: [{ ...floor.vaults[0]!, x: 0, y: 0, width: floor.width, height: floor.height }],
        },
      ],
    };
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations).toHaveLength(0);
    expect(placed.decisions[0]).toMatchObject({ retained: true, encountered: false });
  });

  it('places the Champion independently of normal encounter decisions and suppresses repeat placement', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const first = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const published = {
      ...run,
      actors: [...run.actors, ...first.actors],
      populations: first.populations,
      fallenHeroDecisions: first.decisions,
      floors: [first.floor],
    };
    const second = placeFallenHeroEncounters({
      run: published,
      floor: published.floors[0]!,
      content: pack(),
    });
    expect(run.encounterDecisions).toEqual([]);
    expect(first.populations).toHaveLength(1);
    expect(second.populations).toEqual(first.populations);
  });

  it('applies cumulative route safety when multiple fallen heroes share a depth', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) => ({
        ...decision,
        retained: true,
        ...(decision.role === 'echo' ? { gateRoll: 1 } : {}),
      })),
    };
    const baseFloor = forced.floors[0]!;
    const floor = {
      ...baseFloor,
      width: 5,
      height: 3,
      depth: 4,
      tiles: [1, 1, 1, 1, 1, 4, 1, 0, 1, 5, 1, 1, 1, 1, 1] as const,
      stairUp: { x: 0, y: 1 },
      stairDown: { x: 4, y: 1 },
      entities: [],
      vaults: [
        {
          placementId: 'vault.side',
          vaultId: 'vault.side-arena',
          x: 0,
          y: 0,
          width: 5,
          height: 3,
          rotation: 0 as const,
          reflected: false,
          entrances: [{ x: 0, y: 1 }],
        },
      ],
      placementSlots: [
        {
          slotId: 'slot.a',
          vaultPlacementId: 'vault.side',
          kind: 'monster' as const,
          required: false,
          tags: ['side-arena'],
          x: 2,
          y: 0,
        },
        {
          slotId: 'slot.b',
          vaultPlacementId: 'vault.side',
          kind: 'monster' as const,
          required: false,
          tags: ['side-arena'],
          x: 2,
          y: 2,
        },
      ],
    };
    const result = placeFallenHeroEncounters({
      run: { ...forced, floors: [floor] },
      floor,
      content: pack(),
    });
    expect(result.populations).toHaveLength(1);
    expect(
      result.decisions.filter((decision) => decision.retained && !decision.encountered),
    ).toHaveLength(2);
    const published = {
      ...forced,
      actors: [...forced.actors, ...result.actors],
      populations: result.populations,
      fallenHeroDecisions: result.decisions,
      floors: [result.floor],
    };
    expect(
      placeFallenHeroEncounters({ run: published, floor: result.floor, content: pack() })
        .populations,
    ).toHaveLength(1);
  });

  it('persists normalized loadout choices and uses current-valid equipment in combat and projection', () => {
    const run = withArena(
      initialized([
        standing(1, {
          equippedItemContentIds: ['item.echo-loot', 'item.heirloom', 'item.missing'],
          signatureAbilityIds: ['spell.ember', 'spell.missing'],
        }),
      ]),
      4,
    );
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations[0]).toMatchObject({
      equipmentContentIds: ['item.heirloom'],
      abilityIds: ['spell.ember'],
    });
    const state = {
      ...run,
      actors: [...run.actors, ...placed.actors].sort((a, b) => a.actorId.localeCompare(b.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    expect(
      fallenHeroCombatModifiers({ state, content: pack(), actorId: placed.actors[0]!.actorId }),
    ).toMatchObject({ accuracy: 2, defense: 2, damage: 3 });
    expect(projectGameplayState({ state, content: pack() }).actors[0]).toMatchObject({
      equipmentContentIds: ['item.heirloom'],
      abilityIds: ['spell.ember'],
    });
  });

  it('rejects bypassed templates whose Echo combat boundaries cannot be strictly weaker', () => {
    const unsafeTemplate = {
      ...template,
      minimumHealth: 1,
      maximumHealth: 1,
      attributeMaximum: 1,
      damageMaximum: 1,
      abilityLimit: 0,
      echoAbilityLimit: 0,
    };
    const unsafePack = {
      ...pack(),
      entries: pack().entries.map((entry) =>
        entry.kind === 'fallen-champion-template' ? unsafeTemplate : entry,
      ),
    };
    const run = initialized([standing(1), standing(2)]);
    expect(() => validateContentBoundRun(run, unsafePack)).toThrow(
      /strictly weaker|strictly below|Echo.*boundar/i,
    );
  });
});

describe('fallen hero rewards and run-local lifecycle', () => {
  it('allows a legitimate Champion heirloom sharing boss-unique content before the exact boss reward', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const championDead = {
      ...run,
      actors: [...run.actors, ...placed.actors].map((actor) =>
        actor.populationId === null ? actor : { ...actor, health: 0 },
      ),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const championRewarded = advanceFallenHeroEncounters({
      state: championDead,
      content: pack(),
      eventId: 'event.shared-content-champion',
    }).state;
    const bossLoot: LootTableContentEntry = { ...echoLoot, id: 'loot-table.shared-content-boss' };
    const bossEncounter: EncounterContentEntry = {
      kind: 'encounter',
      id: 'encounter.shared-content-boss',
      name: 'Shared content boss',
      tags: [],
      adminDescription: null,
      model: 'boss',
      minDepth: 1,
      maxDepth: 20,
      environmentTags: [],
      requiredVaultTags: [],
      weight: 1,
      rarity: 'legendary',
      runAppearanceChance: 1,
      discoveryProtectionIncrement: 0,
      discoveryProtectionCap: 1,
      maximumInstancesPerRun: 1,
      placement: {
        minimumStairDistance: 0,
        minimumObjectiveDistance: 0,
        maximumMemberDistance: 0,
        allowedTerrainTags: ['floor'],
        requiresVaultSlot: false,
        failureMode: 'optional',
      },
      intentPresentation: { visible: true },
      definition: {
        monsterId: monster.id,
        phases: [],
        recoveryPerWorldTime: 0,
        recoveryCapPercent: 0,
        uniqueItemId: 'item.heirloom',
        enhancedLootTableId: bossLoot.id,
        vaultTags: [],
      },
    };
    const content = { ...pack(), entries: [...pack().entries, bossLoot, bossEncounter] };
    const hero = championRewarded.actors.find(
      (actor) => actor.actorId === championRewarded.hero.actorId,
    )!;
    const boss: ActorState = {
      ...hero,
      actorId: 'actor.shared-content-boss',
      contentId: monster.id,
      playerControlled: false,
      health: 0,
      maxHealth: monster.health,
      disposition: 'hostile',
      populationId: 'population.shared-content-boss',
      populationRoleId: null,
      populationPresentation: {
        name: 'Shared content boss',
        glyph: 'B',
        color: '#aa7755',
        leader: false,
      },
    };
    const population: BossPopulation = {
      populationId: 'population.shared-content-boss',
      encounterId: bossEncounter.id,
      floorId: boss.floorId,
      model: 'boss',
      createdAt: championRewarded.worldTime,
      livingMemberIds: [boss.actorId],
      formerMemberIds: [],
      actorId: boss.actorId,
      currentPhaseId: null,
      crossedPhaseIds: [],
      lastFloorExitAt: null,
      rewardCreated: false,
      rewardReceipt: null,
      recoveryHistory: [],
    };
    const prepared = {
      ...championRewarded,
      actors: [...championRewarded.actors, boss],
      populations: [...championRewarded.populations, population],
      encounterDecisions: [
        {
          encounterId: bossEncounter.id,
          baseProbability: 1,
          protectionBonus: 0,
          effectiveProbability: 1,
          eligible: true,
          reachedEligibleDepth: true,
          encountered: true,
          instancesCreated: 1,
        },
      ],
    };
    const rewarded = advanceBosses({
      state: prepared,
      content,
      eventId: 'event.shared-content-boss',
    }).state;
    expect(rewarded.items.filter((entry) => entry.contentId === 'item.heirloom')).toHaveLength(2);
    expect(
      rewarded.items.some((entry) => entry.heirloom?.originatingHallRecordId === 'hall.hero-1'),
    ).toBe(true);
    expect(
      rewarded.items.some(
        (entry) => entry.itemId === 'item.reward.population.shared-content-boss.unique',
      ),
    ).toBe(true);
    expect(() => validateContentBoundRun(rewarded, content)).not.toThrow();
  });

  it('creates the recorded eligible equipped heirloom exactly once with provenance fields intact', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const state = {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const first = advanceFallenHeroEncounters({
      state,
      content: pack(),
      eventId: 'event.champion-defeat',
    });
    const reward = first.state.items.find((entry) => entry.itemId.startsWith('item.haunt.'))!;
    expect(reward).toMatchObject({
      contentId: 'item.heirloom',
      quantity: 1,
      condition: 73,
      enchantment: { enchantmentId: 'enchantment.honed', modifiers: { meleeDamageBonus: 2 } },
      charges: 4,
      fuel: 9,
    });
    expect(first.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'champion.defeated',
          hallRecordId: 'hall.hero-1',
          rank: 1,
        }),
        expect.objectContaining({
          type: 'champion.heirloom-created',
          originatingHallRecordId: 'hall.hero-1',
          displayName: "Hero 1's Blade",
        }),
      ]),
    );
    expect(reward).toMatchObject({
      heirloom: {
        displayName: "Hero 1's Blade",
        glyph: ')',
        color: '#ddeeff',
        originatingHallRecordId: 'hall.hero-1',
        originatingRank: 1,
        sourceItemId: 'item.original-1',
      },
    });
    const carriedState = {
      ...first.state,
      items: first.state.items.map((item) =>
        item.itemId === reward.itemId
          ? { ...item, location: { type: 'backpack' as const, actorId: first.state.hero.actorId } }
          : item,
      ),
    };
    const dropped = dropItem({
      run: carriedState,
      actorId: first.state.hero.actorId,
      itemId: reward.itemId,
      quantity: 1,
    });
    if (!dropped.ok) throw new Error(`test setup failed to drop heirloom: ${dropped.reason}`);
    const loadedState = decodeActiveRun(encodeActiveRun(dropped.run));
    expect(loadedState.items.find((item) => item.itemId === reward.itemId)).toMatchObject({
      contentId: reward.contentId,
      heirloom: reward.heirloom,
      location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
    });
    const projected = projectGameplayState({ state: loadedState, content: pack() });
    expect(projected.groundItems.find((item) => item.itemId === reward.itemId)).toMatchObject({
      name: "Hero 1's Blade",
      glyph: ')',
      color: '#ddeeff',
      provenance: { originatingHallRecordId: 'hall.hero-1' },
    });
    expect(
      JSON.stringify(projected.groundItems.find((item) => item.itemId === reward.itemId)),
    ).not.toMatch(/sourceItemId|qualityRank|sourceContentHash|equippedItemContentIds/);
    expect(() => validateContentBoundRun(loadedState, pack())).not.toThrow();
    const corrupted = {
      ...loadedState,
      items: loadedState.items.map((item) =>
        item.itemId === reward.itemId
          ? { ...item, heirloom: { ...item.heirloom!, displayName: 'Tampered history' } }
          : item,
      ),
    };
    expect(() => validateContentBoundRun(corrupted, pack())).toThrow(/Champion reward/i);
    const ordinary = {
      ...reward,
      itemId: 'item.ordinary-copy',
      heirloom: undefined,
      location: { type: 'backpack' as const, actorId: first.state.hero.actorId },
    };
    const pickupRun = {
      ...first.state,
      items: [
        ...first.state.items.map((item) =>
          item.itemId === reward.itemId
            ? { ...item, location: { type: 'floor' as const, floorId: 'floor.demo', x: 1, y: 1 } }
            : item,
        ),
        ordinary,
      ],
    };
    const picked = pickupItem({
      run: pickupRun,
      content: pack(),
      actorId: first.state.hero.actorId,
      itemId: reward.itemId,
      quantity: 1,
    });
    expect(picked.ok).toBe(true);
    if (!picked.ok) throw new Error(picked.reason);
    expect(picked.items.filter((item) => item.contentId === reward.contentId)).toHaveLength(2);
    expect(
      mergeStacks({
        run: picked.run,
        content: pack(),
        actorId: first.state.hero.actorId,
        leftItemId: reward.itemId,
        rightItemId: ordinary.itemId,
      }),
    ).toEqual({ ok: false, reason: 'item.incompatible' });
    const forged = {
      ...loadedState,
      items: [
        ...loadedState.items,
        { ...ordinary, itemId: 'item.forged', heirloom: reward.heirloom },
      ].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    };
    expect(() => validateContentBoundRun(forged, pack())).toThrow(/provenance|heirloom/i);
    expect(() => encodeActiveRun(forged)).toThrow(/provenance|heirloom/i);
    for (const heirloom of [
      { ...reward.heirloom!, originatingHallRecordId: 'hall.wrong' },
      { ...reward.heirloom!, originatingRank: 2 },
      { ...reward.heirloom!, sourceItemId: 'item.wrong' },
    ]) {
      const tampered = {
        ...loadedState,
        items: loadedState.items.map((item) =>
          item.itemId === reward.itemId ? { ...item, heirloom } : item,
        ),
      };
      expect(() => validateContentBoundRun(tampered, pack())).toThrow(
        /Champion reward|provenance|heirloom/i,
      );
      expect(() => encodeActiveRun(tampered)).toThrow(/provenance|heirloom/i);
    }
    const again = advanceFallenHeroEncounters({
      state: loadedState,
      content: pack(),
      eventId: 'event.champion-duplicate',
    });
    expect(again.state.items).toEqual(loadedState.items);
    expect(again.events).toEqual([]);
  });

  it('keeps derived Unicode Champion, Echo, and fallback heirloom display strings save-schema safe', () => {
    const longName = '🛡'.repeat(40);
    const longFallback = item('item.fallback', { name: 'Relic '.repeat(12) });
    const current = {
      ...pack(),
      entries: pack().entries.map((entry) => (entry.id === 'item.fallback' ? longFallback : entry)),
    };
    const historical = standing(1, { heroName: longName });
    const champion = normalizeFallenHero({
      standing: historical,
      template,
      content: current,
      role: 'champion',
    });
    const echo = normalizeFallenHero({
      standing: { ...historical, rank: 2 },
      template,
      content: current,
      role: 'echo',
    });
    expect([...champion.displayName]).toHaveLength(40);
    expect(champion.displayName).toMatch(/, the Deep's Champion$/);
    expect([...echo.displayName]).toHaveLength(40);
    expect(echo.displayName).toMatch(/^Echo of /);
    const changed = standing(1, {
      heroName: longName,
      heirloom: { ...historical.heirloom, contentId: 'item.removed' },
    });
    const base = initialized([changed]);
    const run = withArena({ ...base, contentHash: current.hash }, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: current });
    const dead = {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((a, b) => a.actorId.localeCompare(b.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const result = advanceFallenHeroEncounters({
      state: dead,
      content: current,
      eventId: 'event.long-name',
    });
    const reward = result.state.items.find((entry) => entry.heirloom)!;
    expect([...reward.heirloom!.displayName]).toHaveLength(40);
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });

  it('normalizes NFC, removes controls and formats, and supplies a non-empty derived display label', () => {
    const unsafeName = `Cafe\u0000\u200b\u0301`;
    const champion = normalizeFallenHero({
      standing: standing(1, { heroName: unsafeName }),
      template,
      content: pack(),
      role: 'champion',
    });
    const echo = normalizeFallenHero({
      standing: standing(2, { heroName: unsafeName }),
      template,
      content: pack(),
      role: 'echo',
    });
    expect(champion.displayName).toBe("Café, the Deep's Champion");
    expect(echo.displayName).toBe('Echo of Café');
    expect(champion.displayName.normalize('NFC')).toBe(champion.displayName);
    expect(champion.displayName).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(
      normalizeFallenHero({
        standing: standing(1, { heroName: '\u0000\u200b' }),
        template,
        content: pack(),
        role: 'champion',
      }).displayName,
    ).toBe("Unknown, the Deep's Champion");
  });

  it('sanitizes a bypassed fallback item name before reward metadata, event emission, and save round-trip', () => {
    const unsafeFallback = item('item.fallback', { name: `${'e\u0301'.repeat(50)}\u0000\u200b` });
    const current = {
      ...pack(),
      entries: pack().entries.map((entry) =>
        entry.id === 'item.fallback' ? unsafeFallback : entry,
      ),
    };
    const original = standing(1);
    const changed = standing(1, { heirloom: { ...original.heirloom, contentId: 'item.removed' } });
    const base = initialized([changed]);
    const run = withArena({ ...base, contentHash: current.hash }, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: current });
    const dead = {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((a, b) => a.actorId.localeCompare(b.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const result = advanceFallenHeroEncounters({
      state: dead,
      content: current,
      eventId: 'event.sanitized-fallback',
    });
    const expected = 'é'.repeat(40);
    expect(result.state.items.find((entry) => entry.heirloom)?.heirloom?.displayName).toBe(
      expected,
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'champion.heirloom-created', displayName: expected }),
    );
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });

  it.each([
    ['missing definition', { contentId: 'item.removed' }],
    ['invalid backpack-like record', { sourceItemId: null }],
    ['not recorded as equipped', { contentId: 'item.echo-loot' }],
  ])(
    'uses the fallback relic for %s while retaining Hall provenance',
    (_label, heirloomOverrides) => {
      const original = standing(1);
      const changed = standing(1, { heirloom: { ...original.heirloom, ...heirloomOverrides } });
      const run = withArena(initialized([changed]), 4);
      const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
      const dead = {
        ...run,
        actors: [...run.actors, ...placed.actors].map((actor) =>
          actor.populationId === null ? actor : { ...actor, health: 0 },
        ),
        populations: placed.populations,
        fallenHeroDecisions: placed.decisions,
        floors: [placed.floor],
      };
      const result = advanceFallenHeroEncounters({
        state: dead,
        content: pack(),
        eventId: 'event.fallback',
      });
      expect(result.state.items).toEqual([expect.objectContaining({ contentId: 'item.fallback' })]);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'champion.heirloom-created',
          originatingHallRecordId: 'hall.hero-1',
          fallback: true,
        }),
      );
    },
  );

  it('gives an Echo ordinary table loot plus one guarded piece, and suppresses only that run', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2
          ? { ...decision, retained: true, gateRoll: 1 }
          : { ...decision, retained: false },
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const dead = {
      ...run,
      actors: [...run.actors, ...placed.actors].map((actor) =>
        actor.populationId === null ? actor : { ...actor, health: 0 },
      ),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const result = advanceFallenHeroEncounters({
      state: dead,
      content: pack(),
      eventId: 'event.echo-defeat',
    });
    // The SPOILS TABLE still never produces the recorded heirloom -- that is what
    // `validateEchoLootGraph` forbids at the content level. The heirloom on the ground here is the
    // piece the haunt guarded and surrendered, which arrives by the death-inventory draw instead.
    expect(
      result.state.items
        .filter((entry) => entry.itemId.startsWith('item.echo-loot.'))
        .map((entry) => entry.contentId),
    ).toEqual(['item.echo-loot']);
    expect(
      result.state.items.filter((entry) => entry.itemId.startsWith('item.haunt.')),
    ).toHaveLength(1);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'echo.defeated', hallRecordId: 'hall.hero-2', rank: 2 }),
        expect.objectContaining({ type: 'echo.loot-created' }),
        expect.objectContaining({ type: 'echo.death-inventory-created', rank: 2 }),
      ]),
    );
    const retry = placeFallenHeroEncounters({
      run: result.state,
      floor: result.state.floors[0]!,
      content: pack(),
    });
    expect(retry.populations).toHaveLength(1);
    const laterRun = initialized(standings);
    expect(laterRun.fallenHeroDecisions.find((decision) => decision.rank === 2)?.defeated).toBe(
      false,
    );
  });

  it('preflights the complete Echo loot graph before consuming RNG or creating a forbidden reward', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2
          ? { ...decision, retained: true, gateRoll: 1 }
          : { ...decision, retained: false },
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const dead = {
      ...run,
      actors: [...run.actors, ...placed.actors].map((actor) =>
        actor.populationId === null ? actor : { ...actor, health: 0 },
      ),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const unsafe = pack();
    const entries = unsafe.entries.map((entry) =>
      entry.id === echoLoot.id && entry.kind === 'loot-table'
        ? {
            ...entry,
            choices: [
              {
                contentId: 'item.heirloom',
                lootTableId: null,
                weight: 1,
                minimumQuantity: 1,
                maximumQuantity: 1,
              },
            ],
          }
        : entry,
    );
    const before = structuredClone(dead);
    expect(() =>
      advanceFallenHeroEncounters({
        state: dead,
        content: { ...unsafe, entries },
        eventId: 'event.unsafe-echo',
      }),
    ).toThrow(/Echo loot.*heirloom|ordinary/i);
    expect(dead).toEqual(before);
  });

  it('preflights recursively excessive Echo loot expansion before RNG or item changes', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2
          ? { ...decision, retained: true, gateRoll: 1 }
          : { ...decision, retained: false },
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const dead = {
      ...run,
      actors: [...run.actors, ...placed.actors].map((actor) =>
        actor.populationId === null ? actor : { ...actor, health: 0 },
      ),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const child: LootTableContentEntry = { ...echoLoot, id: 'loot-table.echo-child', rolls: 256 };
    const unsafe = pack();
    const entries = [
      ...unsafe.entries.map((entry) =>
        entry.id === echoLoot.id && entry.kind === 'loot-table'
          ? {
              ...entry,
              choices: [
                {
                  contentId: null,
                  lootTableId: child.id,
                  weight: 1,
                  minimumQuantity: 17,
                  maximumQuantity: 17,
                },
              ],
            }
          : entry,
      ),
      child,
    ];
    const before = structuredClone(dead);
    expect(() =>
      advanceFallenHeroEncounters({
        state: dead,
        content: { ...unsafe, entries },
        eventId: 'event.excessive-echo',
      }),
    ).toThrow(/loot preflight.*worst-case.*4096/i);
    expect(dead).toEqual(before);
  });

  it('validates the complete current-content state after materialization', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const state = {
      ...run,
      actors: [...run.actors, ...placed.actors],
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    expect(() => validateContentBoundRun(state, pack())).not.toThrow();
  });
});

describe('champion haunt death-inventory drop', () => {
  function championHauntKilled(deathInventory: readonly RecordedHeirloomSnapshot[]): ActiveRun {
    const host = standing(1, {
      deathInventory,
      equippedItemContentIds: deathInventory.map((piece) => piece.contentId),
    });
    const run = withArena(initialized([host]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: kitPack() });
    return {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
  }

  it('drops the entire death inventory when a champion haunt is defeated', () => {
    const state = championHauntKilled(withDeathInventory(3));
    const { state: after, events } = advanceFallenHeroEncounters({
      state,
      content: kitPack(),
      eventId: 'e1',
    });
    const dropped = after.items.filter((item) => item.itemId.startsWith('item.haunt.'));
    expect(dropped).toHaveLength(3);
    expect(dropped.map((item) => item.contentId)).toEqual([
      'item.heirloom',
      'item.hero-armor',
      'item.hero-lantern',
    ]);
    expect(
      new Set(
        dropped.map((item) =>
          item.location.type === 'floor' ? `${item.location.x},${item.location.y}` : 'off-floor',
        ),
      ).size,
    ).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'champion.death-inventory-created',
        itemIds: dropped.map((item) => item.itemId),
      }),
    );
  });

  it('still names the recorded heirloom in champion.heirloom-created', () => {
    const state = championHauntKilled(withDeathInventory(3));
    const { state: after, events } = advanceFallenHeroEncounters({
      state,
      content: kitPack(),
      eventId: 'e1',
    });
    const distinguished = after.items.find(
      (item) => item.heirloom?.sourceItemId === 'item.original-1',
    )!;
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'champion.heirloom-created',
        itemId: distinguished.itemId,
        displayName: "Hero 1's Blade",
        fallback: false,
      }),
    );
  });

  it('latches the champion drop exactly once', () => {
    const state = championHauntKilled(withDeathInventory(3));
    const first = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    const second = advanceFallenHeroEncounters({
      state: first.state,
      content: kitPack(),
      eventId: 'e2',
    });
    expect(second.state.items).toEqual(first.state.items);
    expect(second.events).toEqual([]);
  });

  it('consumes no randomness for the champion drop', () => {
    const state = championHauntKilled(withDeathInventory(3));
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    expect(after.state.rng).toEqual(state.rng);
  });

  it('degrades only the piece the current pack no longer defines', () => {
    const inventory = withDeathInventory(3);
    const state = championHauntKilled([
      inventory[0]!,
      { ...inventory[1]!, contentId: 'item.deleted-by-a-later-pack' },
      inventory[2]!,
    ]);
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' }).state;
    const dropped = after.items.filter((item) => item.itemId.startsWith('item.haunt.'));
    expect(dropped.map((item) => item.contentId)).toEqual([
      'item.heirloom',
      'item.fallback',
      'item.hero-lantern',
    ]);
  });

  it('also drops a recorded heirloom the equipped-only capture missed, and keeps it save-valid', () => {
    // The capture is equipped-only, so a heirloom carried in the backpack at death is absent from
    // it. It must still come back -- for an artifact, the haunt drop is its one route back into
    // circulation -- and both validation tiers have to expect the appended piece.
    const inventory = withDeathInventory(3);
    const backpackHeirloom = {
      ...inventory[0]!,
      sourceItemId: 'item.original-1.backpack',
      displayName: "Hero 1's Hidden Blade",
    };
    const host = standing(1, {
      heirloom: backpackHeirloom,
      deathInventory: inventory.slice(1),
      equippedItemContentIds: inventory.map((piece) => piece.contentId),
    });
    const run = withArena(initialized([host]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: kitPack() });
    const state = {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    const result = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    const dropped = result.state.items.filter((item) => item.itemId.startsWith('item.haunt.'));
    expect(dropped).toHaveLength(3);
    const appended = dropped.at(-1)!;
    expect(appended.heirloom?.sourceItemId).toBe('item.original-1.backpack');
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'champion.heirloom-created', itemId: appended.itemId }),
    );
    expect(() => validateContentBoundRun(result.state, kitPack())).not.toThrow();
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });

  it('keeps the whole dropped set valid through save and content-bound validation', () => {
    const state = championHauntKilled(withDeathInventory(3));
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' }).state;
    expect(() => validateContentBoundRun(after, kitPack())).not.toThrow();
    const reloaded = decodeActiveRun(encodeActiveRun(after));
    expect(reloaded.items.filter((item) => item.itemId.startsWith('item.haunt.'))).toHaveLength(3);
  });
});

describe('echo haunt death-inventory piece', () => {
  /** Kills a retained rank-2 echo whose record carries `deathInventory`. Rank 1 is forced out of
   * retention so the only haunt on the floor is the echo. */
  function echoHauntKilled(deathInventory: readonly RecordedHeirloomSnapshot[]): ActiveRun {
    const host = standing(2, {
      deathInventory,
      equippedItemContentIds: deathInventory.map((piece) => piece.contentId),
    });
    // Rank one is CONQUERED rather than merely un-retained: a champion decision must agree with the
    // conquered set (`content-bound-validation.ts`), so simply forcing `retained: false` would build
    // a state the validators reject for an unrelated reason.
    const selected = initialized([standing(1), host], ['hall.hero-1']);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2 ? { ...decision, retained: true, gateRoll: 1 } : decision,
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: kitPack() });
    return {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
  }

  /** The `loot` state after the spoils table alone has rolled from `state` -- the reference a
   * single-piece inventory must land on, since it takes no piece draw at all. */
  function spoilsOnlyLootState(state: ActiveRun): Uint32State {
    const population = state.populations.find((candidate) => candidate.model === 'echo')!;
    const actor = state.actors.find((candidate) => candidate.actorId === population.actorId)!;
    const floor = state.floors.find((candidate) => candidate.floorId === population.floorId)!;
    return createPopulationLoot({
      content: kitPack(),
      state,
      tableId: 'loot-table.echo',
      itemIdPrefix: `item.echo-loot.${population.populationId}`,
      floorId: population.floorId,
      x: actor.x,
      y: actor.y,
      depth: floor.depth,
    }).state.rng.loot;
  }

  it('drops exactly one death-inventory piece plus the spoils roll', () => {
    const state = echoHauntKilled(withDeathInventory(4, 2));
    const { state: after } = advanceFallenHeroEncounters({
      state,
      content: kitPack(),
      eventId: 'e1',
    });
    expect(after.items.filter((item) => item.itemId.startsWith('item.haunt.'))).toHaveLength(1);
    expect(after.items.some((item) => item.itemId.startsWith('item.echo-loot.'))).toBe(true);
  });

  it('picks the piece on the loot stream, before the spoils roll', () => {
    const inventory = withDeathInventory(4, 2);
    const state = echoHauntKilled(inventory);
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    const expected = rollDie(state.rng.loot, 4);
    const piece = after.state.items.find((item) => item.itemId.startsWith('item.haunt.'))!;
    expect(piece.contentId).toBe(inventory[expected.value - 1]!.contentId);
  });

  it('is deterministic for a fixed stream state', () => {
    const state = echoHauntKilled(withDeathInventory(4, 2));
    const first = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    const second = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    expect(first.state.items).toEqual(second.state.items);
    expect(first.state.rng.loot).toEqual(second.state.rng.loot);
  });

  it('takes no piece draw for a single-item inventory', () => {
    const state = echoHauntKilled(withDeathInventory(1, 2));
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    // Exactly one drawn item means only the spoils table advanced `loot`; a needless 1-sided roll
    // would shift every later draw for no decision.
    expect(after.state.items.filter((item) => item.itemId.startsWith('item.haunt.'))).toHaveLength(
      1,
    );
    expect(after.state.rng.loot).toEqual(spoilsOnlyLootState(state));
  });

  it('may legitimately drop the recorded heirloom as its piece', () => {
    // The heirloom is placed at exactly the index the loot stream will draw, so the assertion is
    // about the rule (the heirloom is an ordinary member of the inventory) rather than about luck.
    const inventory = withDeathInventory(4, 2);
    const drawn = rollDie(echoHauntKilled(inventory).rng.loot, 4).value - 1;
    const reordered = inventory.map((piece, index) =>
      index === drawn ? inventory[0]! : index === 0 ? inventory[drawn]! : piece,
    );
    const state = echoHauntKilled(reordered);
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    expect(
      after.state.items.some(
        (item) => item.itemId.startsWith('item.haunt.') && item.contentId === 'item.heirloom',
      ),
    ).toBe(true);
  });

  it('still rejects a spoils table that can reach the recorded heirloom', () => {
    const heirloomTable: LootTableContentEntry = {
      ...echoLoot,
      choices: [
        ...echoLoot.choices,
        {
          contentId: 'item.heirloom',
          lootTableId: null,
          weight: 1,
          minimumQuantity: 1,
          maximumQuantity: 1,
        },
      ],
    };
    const packWithHeirloomInSpoils = {
      ...kitPack(),
      entries: kitPack().entries.map((entry) => (entry.id === echoLoot.id ? heirloomTable : entry)),
    };
    expect(() =>
      validateEchoLootGraph({
        content: packWithHeirloomInSpoils,
        tableId: echoLoot.id,
        recordedHeirloomContentId: 'item.heirloom',
      }),
    ).toThrow(/Echo rewards must be ordinary/);
  });

  it('latches the echo drop exactly once', () => {
    const state = echoHauntKilled(withDeathInventory(4, 2));
    const first = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' });
    const second = advanceFallenHeroEncounters({
      state: first.state,
      content: kitPack(),
      eventId: 'e2',
    });
    expect(second.state.items).toEqual(first.state.items);
    expect(second.state.rng.loot).toEqual(first.state.rng.loot);
    expect(second.events).toEqual([]);
  });

  it('announces the surrendered piece', () => {
    const state = echoHauntKilled(withDeathInventory(4, 2));
    const { state: after, events } = advanceFallenHeroEncounters({
      state,
      content: kitPack(),
      eventId: 'e1',
    });
    const piece = after.items.find((item) => item.itemId.startsWith('item.haunt.'))!;
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'echo.death-inventory-created',
        rank: 2,
        itemId: piece.itemId,
      }),
    );
  });

  it('keeps the surrendered piece valid through save and content-bound validation', () => {
    const state = echoHauntKilled(withDeathInventory(4, 2));
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' }).state;
    expect(() => validateContentBoundRun(after, kitPack())).not.toThrow();
    expect(decodeActiveRun(encodeActiveRun(after))).toEqual(after);
  });
});

describe('haunt drops never mint a second copy of an artifact', () => {
  /** A snapshot of the same singleton artifact as it was recorded by `rank`'s Hall record. Two
   * records can legitimately both list it: it circulated through both heroes before it was lost. */
  function relicSnapshot(rank: number): RecordedHeirloomSnapshot {
    return {
      ...standing(rank).heirloom,
      contentId: 'item.hero-relic',
      sourceItemId: `item.original-${rank}.relic`,
      enchantment: null,
      charges: null,
      fuel: null,
      condition: 80,
      displayName: 'Bound Signet',
      glyph: '"',
      color: '#88ddff',
    };
  }

  /** A champion (rank 1) and an echo (rank 2) on the same floor, both dead, both records naming the
   * same artifact. The champion's population id sorts first, so it is materialized first. */
  function bothHauntsKilled(echoRelic: boolean): ActiveRun {
    const championStanding = standing(1, {
      heirloom: relicSnapshot(1),
      deathInventory: [relicSnapshot(1), withDeathInventory(2, 1)[1]!],
      equippedItemContentIds: ['item.hero-armor', 'item.hero-relic'],
    });
    const echoPiece = echoRelic ? relicSnapshot(2) : withDeathInventory(2, 2)[1]!;
    const echoStanding = standing(2, {
      heirloom: echoPiece,
      deathInventory: [echoPiece],
      equippedItemContentIds: [echoPiece.contentId],
    });
    const selected = initialized([championStanding, echoStanding]);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2 ? { ...decision, retained: true, gateRoll: 1 } : decision,
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: kitPack() });
    return {
      ...run,
      actors: [...run.actors, ...placed.actors]
        .map((actor) => (actor.populationId === null ? actor : { ...actor, health: 0 }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId)),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
  }

  it('degrades the second haunt piece to the fallback relic and leaves exactly one instance', () => {
    const state = bothHauntsKilled(true);
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' }).state;
    // The champion is materialized first and hands back the real singleton.
    expect(after.items.filter((item) => item.contentId === 'item.hero-relic')).toHaveLength(1);
    const echo = after.populations.find((population) => population.model === 'echo')!;
    const echoPiece = after.items.find((item) =>
      item.itemId.startsWith(`item.haunt.${echo.populationId}.`),
    )!;
    // The echo held only a memory of it, so a relic still drops -- the every-piece-comes-back rule
    // survives, it is the identity that degrades.
    expect(echoPiece.contentId).toBe('item.fallback');
    expect(echoPiece.heirloom?.originatingHallRecordId).toBe('hall.hero-2');
  });

  it('keeps the degraded outcome valid in both validation tiers', () => {
    const state = bothHauntsKilled(true);
    const after = advanceFallenHeroEncounters({ state, content: kitPack(), eventId: 'e1' }).state;
    expect(() => validateContentBoundRun(after, kitPack())).not.toThrow();
    expect(decodeActiveRun(encodeActiveRun(after))).toEqual(after);
  });

  it('consumes no randomness for the guard', () => {
    // Same scenario, once with the collision and once without: the guard only reads `run.items`, so
    // the loot stream must land in exactly the same place either way.
    const collided = advanceFallenHeroEncounters({
      state: bothHauntsKilled(true),
      content: kitPack(),
      eventId: 'e1',
    });
    const clear = advanceFallenHeroEncounters({
      state: bothHauntsKilled(false),
      content: kitPack(),
      eventId: 'e1',
    });
    expect(collided.state.rng.loot).toEqual(clear.state.rng.loot);
    // Every other stream is untouched by either drop path.
    expect({ ...collided.state.rng, loot: null }).toEqual({
      ...bothHauntsKilled(true).rng,
      loot: null,
    });
  });
});

describe('recorded signature abilities reach the placed haunt', () => {
  function casterStanding(abilityIds: readonly string[]): FallenHeroStandingSnapshot {
    return standing(1, { signatureAbilityIds: abilityIds });
  }

  it('gives a placed champion its recorded abilities', () => {
    const run = withArena(initialized([casterStanding(['spell.ember'])]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
    expect(population.abilityIds).toEqual(['spell.ember']);
  });

  it('drops an ability the current pack no longer defines', () => {
    const run = withArena(initialized([casterStanding(['spell.deleted', 'spell.ember'])]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
    expect(population.abilityIds).toEqual(['spell.ember']);
  });

  it('places a champion with no recorded abilities, casting nothing', () => {
    // A pre-curve record (or a hero who never learned a spell) carries an empty list. The champion
    // still appears -- it simply has nothing to cast.
    const run = withArena(initialized([casterStanding([])]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
    expect(population.abilityIds).toEqual([]);
  });

  it('skips the echo whose champion selection cannot be made strictly weaker', () => {
    // `normalizeFallenHero` throws a RangeError when an echo's champion has no abilities to weaken
    // from, and `placeFallenHeroEncounters` catches exactly that and omits the placement. This is
    // pre-existing behavior that the recording half must not disturb: a haunt of a spell-less hero
    // has no echo at all.
    const standings = [standing(1), standing(2, { signatureAbilityIds: [] })];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2 ? { ...decision, retained: true, gateRoll: 1 } : decision,
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations.some((candidate) => candidate.model === 'echo')).toBe(false);
  });

  it('places an echo whose champion has abilities to weaken from', () => {
    const standings = [standing(1), standing(2, { signatureAbilityIds: ['spell.ember'] })];
    const selected = initialized(standings);
    const forced = {
      ...selected,
      fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
        decision.rank === 2 ? { ...decision, retained: true, gateRoll: 1 } : decision,
      ),
    };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const echo = placed.populations.find((candidate) => candidate.model === 'echo');
    expect(echo).toBeDefined();
    // Strictly weaker than its champion: one signature spell yields an echo that casts none.
    expect(echo!.abilityIds).toEqual([]);
  });
});

describe('a multi-ability haunt stays savable', () => {
  it('rejects a standing whose abilities are not in canonical id order', () => {
    // `save-schema/run-record.ts` validates BOTH `standing.signatureAbilityIds` and a placed
    // population's `abilityIds` as unique and strictly increasing. A selection recorded in
    // weave-cost order would therefore make the whole run unsavable the moment such a standing is
    // loaded -- which is why the recorded list is stored sorted by id, exactly like
    // `equippedItemContentIds` beside it.
    const run = initialized([standing(1, { signatureAbilityIds: ['spell.gale', 'spell.ember'] })]);
    expect(() => encodeActiveRun(run)).toThrow(/signature ability/i);
  });

  it('encodes a placed champion carrying two abilities in canonical order', () => {
    const ordered = ['spell.ember', 'spell.gale'];
    const run = withArena(initialized([standing(1, { signatureAbilityIds: ordered })]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const population = placed.populations.find((candidate) => candidate.model === 'champion')!;
    expect(population.abilityIds).toEqual(ordered);
    const withHaunt = {
      ...run,
      actors: [...run.actors, ...placed.actors].sort((left, right) =>
        left.actorId.localeCompare(right.actorId),
      ),
      populations: placed.populations,
      fallenHeroDecisions: placed.decisions,
      floors: [placed.floor],
    };
    expect(decodeActiveRun(encodeActiveRun(withHaunt))).toEqual(withHaunt);
  });
});
