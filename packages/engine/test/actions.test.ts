import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  encodeActiveRun,
  normalizeFallenHero,
  projectGameplayState,
  resolveCommand,
  stableJson,
  validatePlayerAction,
  type ActiveRun,
  type ActorState,
  type FallenHeroStandingSnapshot,
  type GameCommand,
  type ItemInstance,
  type ResolutionContext,
} from '../src/index.js';

const context: ResolutionContext = { content: createDemoContentPack() };

function withAdjacentActor(disposition: ActorState['disposition']) {
  const run = createDemoRun();
  const target = {
    ...run.actors[0]!,
    actorId: 'npc.traveler',
    contentId: 'npc.traveler',
    playerControlled: false,
    x: 2,
    y: 1,
    disposition,
    energy: 0,
  };
  return {
    ...run,
    actors: [...run.actors, target].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
  };
}

describe('player action validation', () => {
  it('returns complete authoritative movement and wait actions', () => {
    const state = createDemoRun();
    expect(
      validatePlayerAction({
        state,
        command: {
          type: 'move',
          commandId: 'command.move',
          expectedRevision: 0,
          direction: 'southeast',
        },
        context,
      }),
    ).toEqual({ type: 'move', actorId: 'hero.demo', to: { x: 2, y: 2 }, cost: 100 });
    expect(
      validatePlayerAction({
        state,
        command: { type: 'wait', commandId: 'command.wait', expectedRevision: 0 },
        context,
      }),
    ).toEqual({ type: 'wait', actorId: 'hero.demo', cost: 100 });
  });

  it('returns action.unavailable for commands whose subsystem is not registered', () => {
    expect(
      validatePlayerAction({
        state: createDemoRun(),
        command: {
          type: 'attack',
          commandId: 'command.attack',
          expectedRevision: 0,
          targetActorId: 'monster.absent',
        },
        context,
      }),
    ).toEqual({ status: 'invalid', reason: 'action.unavailable' });
  });

  it('surfaces the specific reason when opening a locked door', () => {
    const run = createDemoRun();
    const locked = {
      ...run,
      features: [
        {
          featureId: 'door.locked',
          type: 'door' as const,
          floorId: run.floors[0]!.floorId,
          x: 2,
          y: 1,
          contentId: null,
          coverTileId: 2 as const,
          state: 'locked' as const,
        },
      ],
    };
    expect(
      validatePlayerAction({
        state: locked,
        command: {
          type: 'open-door',
          commandId: 'command.open-door',
          expectedRevision: 0,
          featureId: 'door.locked',
        },
        context,
      }),
    ).toEqual({ status: 'invalid', reason: 'door.locked' });
  });

  it('surfaces the specific reason when opening a door that is not adjacent', () => {
    const run = createDemoRun();
    const distant = {
      ...run,
      features: [
        {
          featureId: 'door.distant',
          type: 'door' as const,
          floorId: run.floors[0]!.floorId,
          x: 5,
          y: 3,
          contentId: null,
          coverTileId: 2 as const,
          state: 'closed' as const,
        },
      ],
    };
    expect(
      validatePlayerAction({
        state: distant,
        command: {
          type: 'open-door',
          commandId: 'command.open-door',
          expectedRevision: 0,
          featureId: 'door.distant',
        },
        context,
      }),
    ).toEqual({ status: 'invalid', reason: 'door.not-adjacent' });
  });

  it('never resolves trade commands through the world-step action path', () => {
    expect(
      validatePlayerAction({
        state: createDemoRun(),
        command: {
          type: 'trade-open',
          commandId: 'command.trade-open',
          expectedRevision: 0,
          merchantActorId: 'actor.absent',
        },
        context,
      }),
    ).toEqual({ status: 'invalid', reason: 'action.unavailable' });
    expect(
      validatePlayerAction({
        state: createDemoRun(),
        command: {
          type: 'trade-close',
          commandId: 'command.trade-close',
          expectedRevision: 0,
          merchantPopulationId: 'population.absent',
        },
        context,
      }),
    ).toEqual({ status: 'invalid', reason: 'action.unavailable' });
  });

  it('rejects actions while the hero is incapacitated', () => {
    const state = createDemoRun();
    const hero = state.actors[0]!;
    const incapacitated = {
      ...state,
      actors: [
        {
          ...hero,
          conditions: [
            {
              conditionId: 'condition.incapacitated',
              sourceActorId: null,
              appliedAt: 0,
              expiresAt: null,
              stacks: 1,
            },
          ],
        },
      ],
    };
    expect(
      validatePlayerAction({
        state: incapacitated,
        command: { type: 'wait', commandId: 'command.stunned', expectedRevision: 0 },
        context,
      }),
    ).toEqual({ status: 'invalid', reason: 'action.unavailable' });
    const resolution = resolveCommand(
      incapacitated,
      { type: 'wait', commandId: 'command.stunned', expectedRevision: 0 },
      context,
    );
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('deduplicates unavailable commands and rejects conflicting reuse before content lookup', () => {
    const command = {
      type: 'attack',
      commandId: 'command.repeat-attack',
      expectedRevision: 0,
      targetActorId: 'monster.a',
    } as const;
    const first = resolveCommand(createDemoRun(), command, context);
    const mismatched = { content: { ...createDemoContentPack(), hash: 'b'.repeat(64) } };
    const duplicate = resolveCommand(first.state, command, mismatched);
    expect(duplicate.result).toBe(first.result);
    expect(duplicate.events).toBe(first.events);
    const conflict = resolveCommand(
      first.state,
      { ...command, targetActorId: 'monster.b' },
      mismatched,
    );
    expect(conflict.result).toMatchObject({ status: 'rejected', reason: 'command_id_conflict' });
    const stale = resolveCommand(
      first.state,
      {
        type: 'wait',
        commandId: 'command.stale-before-pack',
        expectedRevision: 99,
      },
      mismatched,
    );
    expect(stale.result).toMatchObject({ status: 'rejected', reason: 'stale_revision' });
  });

  it('does not record or mutate a decision-required command', () => {
    const run = withAdjacentActor('neutral');
    const before = encodeActiveRun(run);
    const resolution = resolveCommand(
      run,
      {
        type: 'move',
        commandId: 'command.neutral',
        expectedRevision: run.revision,
        direction: 'east',
      },
      context,
    );
    expect(resolution.result).toEqual({
      status: 'decision_required',
      commandId: 'command.neutral',
      revision: 0,
      turn: 0,
      decision: { type: 'confirm-aggression', targetActorId: 'npc.traveler' },
    });
    expect(encodeActiveRun(resolution.state)).toBe(before);
    expect(resolution.events).toEqual([]);
    expect(resolution.state.recentCommands).toEqual([]);
  });

  it('treats an explicit adjacent attack as confirmed aggression and saves it', () => {
    const run = withAdjacentActor('neutral');
    const resolution = resolveCommand(
      run,
      {
        type: 'attack',
        commandId: 'command.attack-neutral',
        expectedRevision: 0,
        targetActorId: 'npc.traveler',
      },
      context,
    );
    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.events[0]).toMatchObject({
      type: 'relationship.changed',
      actorId: 'hero.demo',
      targetActorId: 'npc.traveler',
      relationship: 'hostile',
    });
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('keeps bump confirmation and explicit attack behavior for neutral NPC targets', () => {
    const run = withAdjacentActor('neutral');
    const bump = validatePlayerAction({
      state: run,
      command: {
        type: 'move',
        commandId: 'command.bump-npc',
        expectedRevision: 0,
        direction: 'east',
      },
      context,
    });
    expect(bump).toMatchObject({
      status: 'decision_required',
      decision: { type: 'confirm-aggression', targetActorId: 'npc.traveler' },
    });
    const explicit = validatePlayerAction({
      state: run,
      command: {
        type: 'attack',
        commandId: 'command.attack-npc',
        expectedRevision: 0,
        targetActorId: 'npc.traveler',
      },
      context,
    });
    expect(explicit).toEqual({
      type: 'bump-attack',
      actorId: 'hero.demo',
      targetActorId: 'npc.traveler',
      cost: 100,
    });
  });

  it('turns hostile bump movement into an attack without moving', () => {
    const run = withAdjacentActor('hostile');
    const resolution = resolveCommand(
      run,
      { type: 'move', commandId: 'command.hostile', expectedRevision: 0, direction: 'east' },
      context,
    );
    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.events.some((event) => event.type === 'combat.observed')).toBe(true);
    expect(
      resolution.state.actors.find((actor) => actor.actorId === run.hero.actorId),
    ).toMatchObject({ x: 1, y: 1 });
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('moves through an open door cover cell and remains saveable', () => {
    const run = createDemoRun();
    const floor = run.floors[0]!;
    const throughDoor = {
      ...run,
      floors: [{ ...floor, tiles: floor.tiles.map((tile, index) => (index === 9 ? 2 : tile)) }],
      features: [
        {
          featureId: 'door.open',
          type: 'door' as const,
          floorId: floor.floorId,
          x: 2,
          y: 1,
          contentId: null,
          coverTileId: 2 as const,
          state: 'open' as const,
        },
      ],
    };
    const resolution = resolveCommand(
      throughDoor,
      { type: 'move', commandId: 'command.open-door', expectedRevision: 0, direction: 'east' },
      context,
    );
    expect(resolution.result.status).toBe('applied');
    expect(() => encodeActiveRun(resolution.state)).not.toThrow();
  });

  it('rejects a mismatched content pack without publishing or mutation', () => {
    const run = createDemoRun();
    const mismatched = { content: { ...createDemoContentPack(), hash: 'b'.repeat(64) } };
    expect(() =>
      resolveCommand(
        run,
        { type: 'wait', commandId: 'command.bad-pack', expectedRevision: 0 },
        mismatched,
      ),
    ).toThrow(/invariant.*content hash/i);
    expect(run.recentCommands).toEqual([]);
  });
});

describe('offer validation', () => {
  const HAUNT_ACTOR_ID = 'actor.population.fallen-champion.record.b.001';
  const RAT_ACTOR_ID = 'monster.rat.1';
  const HALL_RECORD_ID = 'hall.offer-1';
  const POPULATION_ID = 'population.haunt';
  const SCROLL_ID = 'item.scroll.0001';
  const SWORD_ID = 'item.iron-sword.0001';
  const EQUIPPED_SCROLL_ID = 'item.scroll.0002';

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

  const template: FallenChampionTemplateContentEntry = {
    kind: 'fallen-champion-template',
    id: 'fallen-champion-template.core',
    name: "The Deep's Champion",
    tags: ['champion'],
    fallbackMonsterId: fallbackMonster.id,
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
    echoLootTableId: 'loot-table.echo-remnant',
    heirloomSelection: {
      rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 },
      qualityRankBonus: 2,
    },
    appeasement: {
      classFavors: { loomcaller: ['scroll', 'potion'], lamplighter: ['light', 'fuel'] },
      causelessCategories: ['light'],
      defaultCategories: ['food', 'potion'],
    },
  };

  function itemDefinition(id: string, category: ItemContentEntry['category']): ItemContentEntry {
    return {
      kind: 'item',
      id,
      name: id,
      glyph: '?',
      color: '#ffffff',
      tags: [],
      category,
      stackLimit: 1,
      price: 10,
      rarity: 'common',
      heirloomEligible: true,
      minDepth: 0,
      maxDepth: 20,
      actionCost: 100,
      // Both fixture items are hand-held: the equipped-scroll case has to prove that
      // `item.unavailable` beats `offer.refused` for an item that IS in the haunt's need.
      equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
      combat: null,
      light: null,
      artifact: null,
      identification: { mode: 'known', poolId: null },
      effects: [],
    };
  }

  const scrollDefinition = itemDefinition('item.offer-scroll', 'scroll');
  const swordDefinition = itemDefinition('item.offer-sword', 'weapon');
  // The template's fallback relic: an accepted offering materializes the haunt's death inventory,
  // and any piece the pack no longer defines degrades to this one.
  const fallbackDefinition = itemDefinition('item.fallback', 'weapon');

  const offerPack: CompiledContentPack = {
    ...createDemoContentPack(),
    entries: [
      ...createDemoContentPack().entries,
      fallbackMonster,
      template,
      scrollDefinition,
      swordDefinition,
      fallbackDefinition,
    ],
  };
  const offerContext: ResolutionContext = { content: offerPack };

  function instance(
    itemId: string,
    contentId: string,
    location: ItemInstance['location'],
  ): ItemInstance {
    return {
      itemId,
      contentId,
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location,
    };
  }

  function standing(): FallenHeroStandingSnapshot {
    const heirloom = {
      contentId: swordDefinition.id,
      sourceItemId: 'item.offer-original.1',
      enchantment: null,
      condition: 90,
      charges: null,
      fuel: null,
      curse: null,
      qualityRank: 2,
      displayName: "Bryn's Sword",
      glyph: ')',
      color: '#d8d8d8',
      originatingHallRecordId: HALL_RECORD_ID,
    };
    return {
      rank: 1,
      hallRecordId: HALL_RECORD_ID,
      heroName: 'Bryn',
      portraitGlyph: '@',
      classTags: ['loomcaller'],
      attributes: { might: 12, agility: 12, vitality: 12, wits: 12, resolve: 12 },
      equippedItemContentIds: [],
      signatureAbilityIds: [],
      deathDepth: 5,
      sourceContentHash: 'b'.repeat(64),
      // A named killer keeps the causeless `light` out of the need: it is exactly [potion, scroll].
      cause: { killerContentId: 'monster.bone-gnawer', depth: 7, turn: 1, worldTime: 1 },
      heirloom,
      deathInventory: [heirloom],
    };
  }

  /**
   * The hero at (1, 1) carrying a scroll and a sword (plus an equipped scroll), with a living
   * retained Champion haunt standing adjacent at (2, 1). Built through `normalizeFallenHero` so
   * the actor and population satisfy `validateContentBoundRun`, which every `resolveCommand`
   * below has to pass.
   */
  function heroBesideHaunt(
    overrides: Readonly<{
      withHaunt?: boolean;
      appeased?: boolean;
      defeated?: boolean;
      retained?: boolean;
      hauntHealth?: number;
      hauntAt?: Readonly<{ x: number; y: number }>;
    }> = {},
  ): ActiveRun {
    const base = createDemoRun();
    const hero: ActorState = {
      ...base.actors[0]!,
      equipment: { ...base.actors[0]!.equipment, 'main-hand': EQUIPPED_SCROLL_ID },
    };
    const normalized = normalizeFallenHero({
      standing: standing(),
      template,
      content: offerPack,
      role: 'champion',
    });
    const haunt: ActorState = {
      ...hero,
      // The haunt carries its build as population state, not as equipped item instances: the
      // hero's own equipment map must not ride along on the spread.
      equipment: base.actors[0]!.equipment,
      actorId: HAUNT_ACTOR_ID,
      contentId: normalized.monsterId,
      playerControlled: false,
      x: overrides.hauntAt?.x ?? hero.x + 1,
      y: overrides.hauntAt?.y ?? hero.y,
      health: overrides.hauntHealth ?? normalized.health,
      maxHealth: normalized.health,
      disposition: 'hostile',
      populationId: POPULATION_ID,
      populationPresentation: {
        name: normalized.displayName,
        glyph: normalized.glyph,
        color: normalized.color,
        leader: false,
      },
    };
    const withHaunt = overrides.withHaunt !== false;
    return {
      ...base,
      contentHash: offerPack.hash,
      actors: withHaunt
        ? [hero, haunt].sort((left, right) => (left.actorId < right.actorId ? -1 : 1))
        : [hero],
      items: [
        instance(SCROLL_ID, scrollDefinition.id, { type: 'backpack', actorId: hero.actorId }),
        instance(EQUIPPED_SCROLL_ID, scrollDefinition.id, {
          type: 'equipped',
          actorId: hero.actorId,
          slot: 'main-hand',
        }),
        instance(SWORD_ID, swordDefinition.id, { type: 'backpack', actorId: hero.actorId }),
      ].sort((left, right) => (left.itemId < right.itemId ? -1 : 1)),
      populations: withHaunt
        ? [
            {
              model: 'champion',
              populationId: POPULATION_ID,
              encounterId: template.id,
              floorId: hero.floorId,
              createdAt: 0,
              livingMemberIds: [HAUNT_ACTOR_ID],
              formerMemberIds: [],
              actorId: HAUNT_ACTOR_ID,
              hallRecordId: HALL_RECORD_ID,
              rank: 1,
              defeated: false,
              rewardCreated: false,
              equipmentContentIds: normalized.equipmentContentIds,
              abilityIds: normalized.abilityIds,
            },
          ]
        : [],
      fallenHeroStandings: [standing()],
      fallenHeroDecisions: [
        {
          hallRecordId: HALL_RECORD_ID,
          rank: 1,
          role: 'champion',
          // The rank-1 Champion is never gate-rolled: only Echoes carry a roll.
          gateRoll: null,
          retained: overrides.retained ?? true,
          encountered: true,
          defeated: overrides.defeated ?? false,
          appeased: overrides.appeased ?? false,
        },
      ],
    };
  }

  /** The same hero, with an ordinary hostile monster where the haunt would have stood. */
  function heroBesideRat(): ActiveRun {
    const state = heroBesideHaunt({ withHaunt: false });
    const hero = state.actors[0]!;
    return {
      ...state,
      actors: [
        hero,
        {
          ...hero,
          equipment: createDemoRun().actors[0]!.equipment,
          actorId: RAT_ACTOR_ID,
          contentId: 'monster.rat',
          playerControlled: false,
          x: hero.x + 1,
          health: 4,
          maxHealth: 4,
          disposition: 'hostile',
          populationId: null,
        },
      ].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
    };
  }

  function offerCommand(itemId: string, targetActorId = HAUNT_ACTOR_ID): GameCommand {
    return {
      type: 'offer',
      commandId: 'command.offer',
      expectedRevision: 0,
      itemId,
      targetActorId,
    };
  }

  function validate(state: ActiveRun, command: GameCommand) {
    return validatePlayerAction({ state, command, context: offerContext });
  }

  it('accepts an offer of a favored category from the backpack', () => {
    expect(validate(heroBesideHaunt(), offerCommand(SCROLL_ID))).toEqual({
      type: 'offer',
      actorId: 'hero.demo',
      targetActorId: HAUNT_ACTOR_ID,
      itemId: SCROLL_ID,
      cost: 100,
    });
  });

  it('refuses an offer outside the haunt need', () => {
    expect(validate(heroBesideHaunt(), offerCommand(SWORD_ID))).toEqual({
      status: 'invalid',
      reason: 'offer.refused',
    });
  });

  it('leaves the run untouched when an offer is refused', () => {
    const state = heroBesideHaunt();
    const before = stableJson(state);
    validate(state, offerCommand(SWORD_ID));
    expect(stableJson(state)).toBe(before);
  });

  it('rejects an offer with no adjacent haunt', () => {
    expect(validate(heroBesideHaunt({ withHaunt: false }), offerCommand(SCROLL_ID))).toEqual({
      status: 'invalid',
      reason: 'target.invalid',
    });
  });

  it('rejects an offer to a haunt two cells away', () => {
    expect(validate(heroBesideHaunt({ hauntAt: { x: 3, y: 1 } }), offerCommand(SCROLL_ID))).toEqual(
      { status: 'invalid', reason: 'target.invalid' },
    );
  });

  it('rejects an offer to a non-haunt actor', () => {
    expect(validate(heroBesideRat(), offerCommand(SCROLL_ID, RAT_ACTOR_ID))).toEqual({
      status: 'invalid',
      reason: 'target.invalid',
    });
  });

  it('rejects an offer to an already-appeased haunt', () => {
    expect(validate(heroBesideHaunt({ appeased: true }), offerCommand(SCROLL_ID))).toEqual({
      status: 'invalid',
      reason: 'target.invalid',
    });
  });

  it('rejects an offer to a defeated or unretained haunt', () => {
    expect(validate(heroBesideHaunt({ defeated: true }), offerCommand(SCROLL_ID))).toEqual({
      status: 'invalid',
      reason: 'target.invalid',
    });
    expect(validate(heroBesideHaunt({ retained: false }), offerCommand(SCROLL_ID))).toEqual({
      status: 'invalid',
      reason: 'target.invalid',
    });
  });

  it('rejects an offer to a dead haunt', () => {
    expect(validate(heroBesideHaunt({ hauntHealth: 0 }), offerCommand(SCROLL_ID))).toEqual({
      status: 'invalid',
      reason: 'target.invalid',
    });
  });

  it('rejects an offer of an equipped item', () => {
    expect(validate(heroBesideHaunt(), offerCommand(EQUIPPED_SCROLL_ID))).toEqual({
      status: 'invalid',
      reason: 'item.unavailable',
    });
  });

  it('rejects an offer of an item the hero does not have', () => {
    expect(validate(heroBesideHaunt(), offerCommand('item.nope'))).toEqual({
      status: 'invalid',
      reason: 'item.missing',
    });
  });

  it('consumes no randomness whether the offer is accepted or refused', () => {
    const state = heroBesideHaunt();
    for (const itemId of [SCROLL_ID, SWORD_ID]) {
      const resolved = resolveCommand(state, offerCommand(itemId), offerContext);
      expect(resolved.state.rng, itemId).toEqual(state.rng);
    }
  });

  it('appeases rather than attacking, spending the offering', () => {
    // The registered resolver is also what keeps a validated offer off `applyAction`'s bump-attack
    // default, which would turn an offering into a swing at the haunt.
    const resolved = resolveCommand(heroBesideHaunt(), offerCommand(SCROLL_ID), offerContext);
    expect(resolved.result).toMatchObject({ status: 'applied' });
    expect(resolved.events.some((event) => event.type === 'attack.hit')).toBe(false);
    expect(resolved.events).toContainEqual(expect.objectContaining({ type: 'haunt.appeased' }));
    expect(resolved.state.actors.some((actor) => actor.actorId === HAUNT_ACTOR_ID)).toBe(false);
    expect(resolved.state.items.map((item) => item.itemId)).not.toContain(SCROLL_ID);
  });

  it('rejects every command on a concluded run, offer included', () => {
    const state = heroBesideHaunt();
    const concluded: ActiveRun = {
      ...state,
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 0, worldTime: 0 },
        concludedAtRevision: 0,
        finalized: false,
      },
    };
    const resolved = resolveCommand(concluded, offerCommand(SCROLL_ID), offerContext);
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'run.concluded' });
    expect(resolved.state.rng).toEqual(concluded.rng);
  });

  it('records a refused offer without throwing on encode', () => {
    const resolved = resolveCommand(heroBesideHaunt(), offerCommand(SWORD_ID), offerContext);
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'offer.refused' });
    expect(() => encodeActiveRun(resolved.state)).not.toThrow();
  });

  it.each(['item.missing', 'item.unavailable', 'target.invalid'] as const)(
    'records an offer rejected as %s without throwing on encode',
    (reason) => {
      // `target.invalid` is taken through an out-of-reach haunt: it is the one refusal cause whose
      // run state is fully representable (an appeased haunt has no actor left to stand beside, and
      // an unretained one cannot still have a population).
      const state =
        reason === 'target.invalid'
          ? heroBesideHaunt({ hauntAt: { x: 3, y: 1 } })
          : heroBesideHaunt();
      const itemId =
        reason === 'item.missing'
          ? 'item.nope'
          : reason === 'item.unavailable'
            ? EQUIPPED_SCROLL_ID
            : SCROLL_ID;
      const resolved = resolveCommand(state, offerCommand(itemId), offerContext);
      expect(resolved.result).toMatchObject({ status: 'invalid', reason });
      expect(() => encodeActiveRun(resolved.state)).not.toThrow();
    },
  );

  it('exposes the same need on the projection that validation enforces', () => {
    const projected = projectGameplayState({
      state: heroBesideHaunt(),
      content: offerPack,
    });
    expect(projected.haunts).toHaveLength(1);
    expect(projected.haunts[0]!.needCategories).toEqual(['potion', 'scroll']);
  });
});
