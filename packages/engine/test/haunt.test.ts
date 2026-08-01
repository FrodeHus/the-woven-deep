import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  MonsterContentEntry,
  SpellContentEntry,
} from '@woven-deep/content';
import {
  advanceFallenHeroEncounters,
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  normalizeFallenHero,
  placeFallenHeroEncounters,
  resolveCommand,
  validatePlayerAction,
  resolveOffer,
  validateContentBoundRun,
  type ActiveRun,
  type ActorState,
  type ChampionPopulation,
  type EchoPopulation,
  type FallenHeroStandingSnapshot,
  type ItemInstance,
  type OfferAction,
  type RecordedHeirloomSnapshot,
} from '../src/index.js';

const HERO_ID = 'hero.demo';
const HAUNT_ACTOR_ID = 'actor.population.haunt.001';
const POPULATION_ID = 'population.haunt';
const HALL_RECORD_ID = 'hall.appease-1';
const OFFERED_ITEM_ID = 'item.scroll.0001';
const HAUNT_X = 2;
const HAUNT_Y = 1;
const PIECE_PREFIX = `item.haunt.${POPULATION_ID}`;
const CHAMPION_RECORD_ID = 'hall.appease-champion';

const fallbackMonster: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.champion-fallback',
  name: 'Ashen Warden',
  tags: ['boss'],
  glyph: 'W',
  color: '#aa7755',
  attributes: { might: 18, agility: 12, vitality: 20, wits: 10, resolve: 16 },
  health: 60,
  speed: 100,
  accuracy: 18,
  defense: 16,
  perception: 10,
  damage: { count: 2, sides: 6, bonus: 2 },
  armor: 8,
  resistances: { physical: 10, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  minDepth: 1,
  maxDepth: 20,
  rarity: 'legendary',
  threat: 40,
  lootTableId: null,
  dropChance: 0,
};

function itemDefinition(
  id: string,
  category: ItemContentEntry['category'],
  overrides: Partial<ItemContentEntry> = {},
): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    glyph: '?',
    color: '#ffffff',
    tags: [],
    category,
    stackLimit: category === 'scroll' ? 10 : 1,
    price: 10,
    rarity: 'common',
    heirloomEligible: true,
    minDepth: 0,
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

const scrollDefinition = itemDefinition('item.offer-scroll', 'scroll');
const swordDefinition = itemDefinition('item.offer-sword', 'weapon');
const pieceDefinitions = [
  itemDefinition('item.piece-a', 'weapon'),
  itemDefinition('item.piece-b', 'armor'),
  itemDefinition('item.piece-c', 'ring'),
];
const fallbackDefinition = itemDefinition('item.fallback', 'weapon');
const relicDefinition = itemDefinition('item.relic', 'ring', {
  rarity: 'legendary',
  artifact: { canon: true, signature: null, drawbackModifiers: {}, light: null },
});

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

const template: FallenChampionTemplateContentEntry = {
  kind: 'fallen-champion-template',
  id: 'fallen-champion-template.core',
  name: "The Deep's Champion",
  tags: ['champion'],
  fallbackMonsterId: fallbackMonster.id,
  fallbackItemId: fallbackDefinition.id,
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
  echoLootTableId: 'loot-table.echo-remnant',
  heirloomSelection: {
    rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 },
    qualityRankBonus: 2,
  },
  appeasement: {
    classFavors: { loomcaller: ['scroll', 'potion'] },
    causelessCategories: ['light'],
    defaultCategories: ['food', 'potion'],
  },
};

const pack: CompiledContentPack = {
  ...createDemoContentPack(),
  entries: [
    ...createDemoContentPack().entries,
    fallbackMonster,
    template,
    spell,
    scrollDefinition,
    swordDefinition,
    fallbackDefinition,
    relicDefinition,
    ...pieceDefinitions,
  ],
};

function snapshot(contentId: string, index: number): RecordedHeirloomSnapshot {
  return {
    contentId,
    sourceItemId: `item.recorded.${index}`,
    enchantment: null,
    condition: 90,
    charges: null,
    fuel: null,
    curse: null,
    qualityRank: 2,
    displayName: `Recorded ${contentId}`,
    glyph: ')',
    color: '#d8d8d8',
    originatingHallRecordId: HALL_RECORD_ID,
  };
}

function standing(
  pieces: number,
  contentIds?: readonly string[],
  rank = 1,
): FallenHeroStandingSnapshot {
  const ids = contentIds ?? pieceDefinitions.slice(0, pieces).map((entry) => entry.id);
  const deathInventory = ids.map((contentId, index) => snapshot(contentId, index));
  return {
    rank,
    hallRecordId: HALL_RECORD_ID,
    heroName: 'Bryn',
    portraitGlyph: '@',
    classTags: ['loomcaller'],
    attributes: { might: 12, agility: 12, vitality: 12, wits: 12, resolve: 12 },
    equippedItemContentIds: ids,
    // An Echo must be able to give up an ability to be strictly weaker than its Champion.
    signatureAbilityIds: [spell.id],
    deathDepth: 5,
    sourceContentHash: 'b'.repeat(64),
    cause: { killerContentId: 'monster.bone-gnawer', depth: 7, turn: 1, worldTime: 1 },
    heirloom: deathInventory[0]!,
    deathInventory,
  };
}

/** The rank-1 Champion standing an Echo run always sits behind. */
function championRecord(): FallenHeroStandingSnapshot {
  const base = standing(1, [pieceDefinitions[0]!.id], 1);
  // A snapshot's provenance names its own record: the save schema checks both directions.
  const rebound = base.deathInventory.map((piece) => ({
    ...piece,
    originatingHallRecordId: CHAMPION_RECORD_ID,
  }));
  return {
    ...base,
    hallRecordId: CHAMPION_RECORD_ID,
    heroName: 'Kaelen',
    heirloom: rebound[0]!,
    deathInventory: rebound,
  };
}

function offerItem(quantity: number): ItemInstance {
  return {
    itemId: OFFERED_ITEM_ID,
    contentId: scrollDefinition.id,
    quantity,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: HERO_ID },
  };
}

/**
 * The hero at (1, 1) beside a living retained haunt at (2, 1), with the offering already in the
 * backpack. Built through `normalizeFallenHero` so the actor and population satisfy
 * `validateContentBoundRun`.
 */
function heroBesideHaunt(
  overrides: Readonly<{
    pieces?: number;
    quantity?: number;
    role?: 'champion' | 'echo';
    aware?: boolean;
    extraItems?: readonly ItemInstance[];
    standing?: FallenHeroStandingSnapshot;
  }> = {},
): ActiveRun {
  const role = overrides.role ?? 'champion';
  // Rank 1 is the Champion slot; an Echo is always a lower-ranked record.
  const record =
    overrides.standing ?? standing(overrides.pieces ?? 3, undefined, role === 'echo' ? 2 : 1);
  const base = createDemoRun();
  const normalized = normalizeFallenHero({ standing: record, template, content: pack, role });
  const hero: ActorState = {
    ...base.actors[0]!,
    ...(overrides.aware ? { awareActorIds: [HAUNT_ACTOR_ID] } : {}),
  };
  const haunt: ActorState = {
    ...base.actors[0]!,
    actorId: HAUNT_ACTOR_ID,
    contentId: normalized.monsterId,
    playerControlled: false,
    x: HAUNT_X,
    y: HAUNT_Y,
    health: normalized.health,
    maxHealth: normalized.health,
    disposition: 'hostile',
    populationId: POPULATION_ID,
    populationPresentation: {
      name: normalized.displayName,
      glyph: normalized.glyph,
      color: normalized.color,
      leader: false,
    },
    ...(overrides.aware ? { awareActorIds: [HERO_ID] } : {}),
  };
  const populationBase = {
    populationId: POPULATION_ID,
    encounterId: template.id,
    floorId: hero.floorId,
    createdAt: 0,
    livingMemberIds: [HAUNT_ACTOR_ID],
    formerMemberIds: [],
    actorId: HAUNT_ACTOR_ID,
    hallRecordId: HALL_RECORD_ID,
    defeated: false,
    equipmentContentIds: normalized.equipmentContentIds,
    abilityIds: normalized.abilityIds,
  } as const;
  const population: ChampionPopulation | EchoPopulation =
    role === 'champion'
      ? { ...populationBase, model: 'champion', rank: 1, rewardCreated: false }
      : { ...populationBase, model: 'echo', rank: record.rank, lootCreated: false };
  return {
    ...base,
    contentHash: pack.hash,
    actors: [haunt, hero].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
    items: [offerItem(overrides.quantity ?? 1), ...(overrides.extraItems ?? [])].sort(
      (left, right) => (left.itemId < right.itemId ? -1 : 1),
    ),
    populations: [population],
    // An Echo standing is always preceded by the run's rank-1 Champion standing: content-bound
    // validation re-derives Echo retention from `standings.slice(1)` against the echo decisions.
    fallenHeroStandings: role === 'echo' ? [championRecord(), record] : [record],
    fallenHeroDecisions:
      role === 'echo'
        ? [
            {
              hallRecordId: CHAMPION_RECORD_ID,
              rank: 1,
              role: 'champion',
              gateRoll: null,
              retained: false,
              encountered: false,
              defeated: false,
              appeased: false,
            },
            {
              hallRecordId: HALL_RECORD_ID,
              rank: record.rank,
              role,
              gateRoll: 1,
              retained: true,
              encountered: true,
              defeated: false,
              appeased: false,
            },
          ]
        : [
            {
              hallRecordId: HALL_RECORD_ID,
              rank: record.rank,
              role,
              gateRoll: null,
              retained: true,
              encountered: true,
              defeated: false,
              appeased: false,
            },
          ],
    // A Champion decision that is not retained must already be conquered.
    conqueredChampionRecordIds: role === 'echo' ? [CHAMPION_RECORD_ID] : [],
  };
}

function offerAction(): OfferAction {
  return {
    type: 'offer',
    actorId: HERO_ID,
    targetActorId: HAUNT_ACTOR_ID,
    itemId: OFFERED_ITEM_ID,
    cost: 100,
  };
}

function appease(state: ActiveRun) {
  return resolveOffer({ state, content: pack, action: offerAction(), eventId: 'e1' });
}

function droppedPieces(state: ActiveRun): readonly ItemInstance[] {
  return state.items.filter((item) => item.itemId.startsWith(`${PIECE_PREFIX}.`));
}

describe('resolveOffer', () => {
  it('consumes the offered item', () => {
    const { state } = appease(heroBesideHaunt());
    expect(state.items.some((item) => item.itemId === OFFERED_ITEM_ID)).toBe(false);
  });

  it('consumes exactly one unit of a stack', () => {
    const { state } = appease(heroBesideHaunt({ quantity: 3 }));
    expect(state.items.find((item) => item.itemId === OFFERED_ITEM_ID)!.quantity).toBe(2);
  });

  it('leaves no dangling relationship override behind the faded haunt', () => {
    // The neutral override is set for the surrendered actor and dropped again with it: a row
    // naming a removed actor fails save validation.
    const { state } = appease(heroBesideHaunt());
    expect(
      state.relationships.some(
        (relationship) =>
          relationship.leftActorId === HAUNT_ACTOR_ID ||
          relationship.rightActorId === HAUNT_ACTOR_ID,
      ),
    ).toBe(false);
  });

  it('fades the haunt actor and scrubs every reference to it', () => {
    const { state } = appease(heroBesideHaunt({ aware: true }));
    expect(state.actors.some((actor) => actor.actorId === HAUNT_ACTOR_ID)).toBe(false);
    expect(state.actors.every((actor) => !actor.awareActorIds.includes(HAUNT_ACTOR_ID))).toBe(true);
    const population = state.populations.find(
      (candidate) => candidate.populationId === POPULATION_ID,
    )!;
    expect(population.livingMemberIds).toEqual([]);
    expect(population.formerMemberIds).toEqual([HAUNT_ACTOR_ID]);
  });

  it('drops the entire death inventory on the haunt cell', () => {
    const { state } = appease(heroBesideHaunt({ pieces: 3 }));
    const dropped = droppedPieces(state);
    expect(dropped).toHaveLength(3);
    for (const item of dropped) {
      expect(item.location).toMatchObject({ type: 'floor', x: HAUNT_X, y: HAUNT_Y });
    }
    expect(dropped.map((item) => item.itemId)).toEqual([
      `${PIECE_PREFIX}.0000`,
      `${PIECE_PREFIX}.0001`,
      `${PIECE_PREFIX}.0002`,
    ]);
  });

  it('drops the whole set for an echo too, not the single defeat piece', () => {
    const { state } = appease(heroBesideHaunt({ role: 'echo', pieces: 3 }));
    expect(droppedPieces(state)).toHaveLength(3);
  });

  it('degrades a piece whose artifact is already circulating instead of minting a second copy', () => {
    const circulating: ItemInstance = {
      itemId: 'item.already.0001',
      contentId: relicDefinition.id,
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'backpack', actorId: HERO_ID },
    };
    const { state } = appease(
      heroBesideHaunt({
        standing: standing(1, [relicDefinition.id]),
        extraItems: [circulating],
      }),
    );
    const dropped = droppedPieces(state);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.contentId).toBe(fallbackDefinition.id);
    expect(state.items.filter((item) => item.contentId === relicDefinition.id)).toHaveLength(1);
  });

  it('marks the decision appeased and never defeated', () => {
    const { state } = appease(heroBesideHaunt());
    const decision = state.fallenHeroDecisions.find(
      (candidate) => candidate.hallRecordId === HALL_RECORD_ID,
    )!;
    expect(decision).toMatchObject({
      appeased: true,
      defeated: false,
      encountered: true,
      retained: true,
    });
  });

  it('produces no conquest consequence', () => {
    const before = heroBesideHaunt();
    const { state } = appease(before);
    expect(state.conqueredChampionRecordIds).toEqual(before.conqueredChampionRecordIds);
    const population = state.populations.find(
      (candidate) => candidate.populationId === POPULATION_ID,
    )!;
    expect(population).toMatchObject({ defeated: false });
  });

  it('emits haunt.appeased with the offering and the released pieces', () => {
    const { state, events } = appease(heroBesideHaunt({ pieces: 2 }));
    expect(events).toContainEqual({
      type: 'haunt.appeased',
      eventId: 'e1',
      actorId: HAUNT_ACTOR_ID,
      hallRecordId: HALL_RECORD_ID,
      role: 'champion',
      offeredItemId: OFFERED_ITEM_ID,
      itemIds: droppedPieces(state).map((item) => item.itemId),
    });
  });

  it('never publishes the population id, which for an echo embeds its rank', () => {
    // Same redaction ruling `haunt.sighted` was held to: population bookkeeping ids (and the rank
    // an echo's population id spells out) are not the client's to see.
    const { events } = appease(heroBesideHaunt({ role: 'echo' }));
    const appeased = events.find((event) => event.type === 'haunt.appeased')!;
    expect(Object.keys(appeased)).not.toContain('populationId');
    // No field IS the population id. The released pieces' own item ids embed it by construction
    // (`item.haunt.<populationId>.NNNN`), and those are ordinary floor items the client already
    // sees in the item list -- that scheme predates this event and is not what the ruling covers.
    expect(Object.values(appeased)).not.toContain(POPULATION_ID);
  });

  it('consumes no randomness', () => {
    const before = heroBesideHaunt({ pieces: 3 });
    const { state } = appease(before);
    expect(state.rng).toEqual(before.rng);
  });

  it('never re-places or re-rewards an appeased haunt', () => {
    const { state } = appease(heroBesideHaunt());
    const advanced = advanceFallenHeroEncounters({ state, content: pack, eventId: 'e2' });
    expect(advanced.state.items).toEqual(state.items);
    expect(advanced.events).toEqual([]);
    const floor = state.floors.find((candidate) => candidate.floorId === state.activeFloorId)!;
    expect(placeFallenHeroEncounters({ run: state, floor, content: pack }).actors).toEqual([]);
  });

  it('passes content-bound validation for both roles', () => {
    for (const role of ['champion', 'echo'] as const) {
      const { state } = appease(heroBesideHaunt({ role, pieces: 3 }));
      expect(() => validateContentBoundRun(state, pack), role).not.toThrow();
    }
  });

  it.each(['champion', 'echo'] as const)(
    'rejects a save that lost a piece an appeased %s owes, at decode',
    (role) => {
      const { state } = appease(heroBesideHaunt({ role, pieces: 3 }));
      const missingLastPiece: ActiveRun = {
        ...state,
        items: state.items.filter((item) => item.itemId !== `${PIECE_PREFIX}.0002`),
      };
      expect(() => encodeActiveRun(missingLastPiece)).toThrow(/death inventory it surrendered/i);
    },
  );

  it('survives a save round trip after an appeasement, for both roles', () => {
    for (const role of ['champion', 'echo'] as const) {
      const { state } = appease(heroBesideHaunt({ role, pieces: 3 }));
      const encoded = encodeActiveRun(state);
      expect(encodeActiveRun(decodeActiveRun(encoded)), role).toBe(encoded);
    }
  });

  it('resolves end-to-end through resolveCommand', () => {
    const resolved = resolveCommand(
      heroBesideHaunt(),
      {
        type: 'offer',
        commandId: 'command.offer',
        expectedRevision: 0,
        itemId: OFFERED_ITEM_ID,
        targetActorId: HAUNT_ACTOR_ID,
      },
      { content: pack },
    );
    expect(resolved.result.status).toBe('applied');
    expect(resolved.events).toContainEqual(expect.objectContaining({ type: 'haunt.appeased' }));
    expect(resolved.state.actors.some((actor) => actor.actorId === HAUNT_ACTOR_ID)).toBe(false);
    expect(() => encodeActiveRun(resolved.state)).not.toThrow();
    expect(resolved.state.rng).toEqual(heroBesideHaunt().rng);
  });

  it('survives the world step that follows an appeasement', () => {
    // Clarification 6: the fade removes the actor, so `advanceFallenHeroEncounters` would throw
    // `fallen hero population ... is incomplete` on the very next step without the appeased skip.
    const first = resolveCommand(
      heroBesideHaunt(),
      {
        type: 'offer',
        commandId: 'command.offer',
        expectedRevision: 0,
        itemId: OFFERED_ITEM_ID,
        targetActorId: HAUNT_ACTOR_ID,
      },
      { content: pack },
    );
    const second = resolveCommand(
      first.state,
      { type: 'wait', commandId: 'command.wait', expectedRevision: first.state.revision },
      { content: pack },
    );
    expect(second.result.status).toBe('applied');
  });
});

describe('offering a haunt piece', () => {
  const ECHO_ACTOR_ID = 'actor.population.haunt-echo.001';
  const ECHO_POPULATION_ID = 'population.haunt-echo';
  const ECHO_RECORD_ID = 'hall.appease-echo';

  /**
   * The hero at (1, 1) with a Champion at (2, 1) and an Echo at (1, 2), both retained, living and
   * encountered. The Champion's death inventory is a single SCROLL, so the piece it releases is
   * squarely inside the Echo's need -- otherwise a refusal would prove nothing but a category miss.
   */
  function heroBetweenTwoHaunts(): ActiveRun {
    const championStanding: FallenHeroStandingSnapshot = {
      ...standing(1, [scrollDefinition.id], 1),
      hallRecordId: CHAMPION_RECORD_ID,
      heroName: 'Kaelen',
    };
    const rebound = championStanding.deathInventory.map((piece) => ({
      ...piece,
      originatingHallRecordId: CHAMPION_RECORD_ID,
    }));
    const champion: FallenHeroStandingSnapshot = {
      ...championStanding,
      heirloom: rebound[0]!,
      deathInventory: rebound,
    };
    const echo: FallenHeroStandingSnapshot = {
      ...standing(1, [scrollDefinition.id], 2),
      hallRecordId: ECHO_RECORD_ID,
      heroName: 'Mira',
    };
    const echoRebound = echo.deathInventory.map((piece) => ({
      ...piece,
      originatingHallRecordId: ECHO_RECORD_ID,
    }));
    const echoStanding: FallenHeroStandingSnapshot = {
      ...echo,
      heirloom: echoRebound[0]!,
      deathInventory: echoRebound,
    };
    const base = createDemoRun();
    const hero = base.actors[0]!;
    const normalizedChampion = normalizeFallenHero({
      standing: champion,
      template,
      content: pack,
      role: 'champion',
    });
    const normalizedEcho = normalizeFallenHero({
      standing: echoStanding,
      template,
      content: pack,
      role: 'echo',
    });
    const actorFor = (
      actorId: string,
      populationId: string,
      normalized: ReturnType<typeof normalizeFallenHero>,
      x: number,
      y: number,
    ): ActorState => ({
      ...hero,
      actorId,
      contentId: normalized.monsterId,
      playerControlled: false,
      x,
      y,
      health: normalized.health,
      maxHealth: normalized.health,
      disposition: 'hostile',
      populationId,
      populationPresentation: {
        name: normalized.displayName,
        glyph: normalized.glyph,
        color: normalized.color,
        leader: false,
      },
    });
    return {
      ...base,
      contentHash: pack.hash,
      actors: [
        hero,
        actorFor(HAUNT_ACTOR_ID, POPULATION_ID, normalizedChampion, HAUNT_X, HAUNT_Y),
        actorFor(ECHO_ACTOR_ID, ECHO_POPULATION_ID, normalizedEcho, 1, 2),
      ].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
      items: [offerItem(1)],
      populations: [
        {
          model: 'champion',
          populationId: POPULATION_ID,
          encounterId: template.id,
          floorId: hero.floorId,
          createdAt: 0,
          livingMemberIds: [HAUNT_ACTOR_ID],
          formerMemberIds: [],
          actorId: HAUNT_ACTOR_ID,
          hallRecordId: CHAMPION_RECORD_ID,
          rank: 1,
          defeated: false,
          rewardCreated: false,
          equipmentContentIds: normalizedChampion.equipmentContentIds,
          abilityIds: normalizedChampion.abilityIds,
        },
        {
          model: 'echo',
          populationId: ECHO_POPULATION_ID,
          encounterId: template.id,
          floorId: hero.floorId,
          createdAt: 0,
          livingMemberIds: [ECHO_ACTOR_ID],
          formerMemberIds: [],
          actorId: ECHO_ACTOR_ID,
          hallRecordId: ECHO_RECORD_ID,
          rank: 2,
          defeated: false,
          lootCreated: false,
          equipmentContentIds: normalizedEcho.equipmentContentIds,
          abilityIds: normalizedEcho.abilityIds,
        },
      ].sort((left, right) => (left.populationId < right.populationId ? -1 : 1)),
      fallenHeroStandings: [champion, echoStanding],
      fallenHeroDecisions: [
        {
          hallRecordId: CHAMPION_RECORD_ID,
          rank: 1,
          role: 'champion',
          gateRoll: null,
          retained: true,
          encountered: true,
          defeated: false,
          appeased: false,
        },
        {
          hallRecordId: ECHO_RECORD_ID,
          rank: 2,
          role: 'echo',
          gateRoll: 1,
          retained: true,
          encountered: true,
          defeated: false,
          appeased: false,
        },
      ],
    };
  }

  it('refuses a piece another haunt released, and the run still persists', () => {
    // The save tier requires every owed piece to exist for as long as its haunt does. Consuming one
    // as an offering would delete it and make the run un-persistable from that command onward.
    const appeased = resolveOffer({
      state: heroBetweenTwoHaunts(),
      content: pack,
      action: offerAction(),
      eventId: 'e1',
    }).state;
    const pieceId = `${PIECE_PREFIX}.0000`;
    expect(appeased.items.find((item) => item.itemId === pieceId)).toBeDefined();
    // The hero picks the released piece up: an ordinary floor item, freely carried.
    const carried: ActiveRun = {
      ...appeased,
      items: appeased.items.map((item) =>
        item.itemId === pieceId
          ? { ...item, location: { type: 'backpack' as const, actorId: HERO_ID } }
          : item,
      ),
    };
    expect(
      validatePlayerAction({
        state: carried,
        command: {
          type: 'offer',
          commandId: 'command.offer-piece',
          expectedRevision: carried.revision,
          itemId: pieceId,
          targetActorId: ECHO_ACTOR_ID,
        },
        context: { content: pack },
      }),
    ).toEqual({ status: 'invalid', reason: 'offer.refused' });
    expect(() => encodeActiveRun(carried)).not.toThrow();
  });

  it('still accepts an ordinary offering of the same category', () => {
    const carried = heroBetweenTwoHaunts();
    expect(
      validatePlayerAction({
        state: carried,
        command: {
          type: 'offer',
          commandId: 'command.offer-plain',
          expectedRevision: carried.revision,
          itemId: OFFERED_ITEM_ID,
          targetActorId: ECHO_ACTOR_ID,
        },
        context: { content: pack },
      }),
    ).toMatchObject({ type: 'offer', itemId: OFFERED_ITEM_ID });
  });
});
