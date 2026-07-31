import { describe, expect, it } from 'vitest';
import type {
  BalanceContentEntry,
  BossEncounterDefinition,
  CompiledContentPack,
  CurseContentEntry,
  EncounterContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
} from '@woven-deep/content';
import {
  advanceBosses,
  bossCombatModifiers,
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  selectPatrolGoal,
  validateContentBoundRun,
  type ActiveRun,
  type ActorState,
  type BossPopulation,
} from '../src/index.js';

const monster = {
  kind: 'monster' as const,
  id: 'monster.boss',
  name: 'Boss',
  description: '',
  tags: ['boss'],
  glyph: 'B',
  color: '#aa3300',
  attributes: { might: 6, agility: 4, vitality: 8, wits: 4, resolve: 8 },
  health: 100,
  speed: 100,
  accuracy: 5,
  defense: 5,
  perception: 8,
  damage: { count: 1, sides: 6, bonus: 2 },
  armor: 1,
  resistances: { physical: 0, fire: 0, cold: 0, poison: 0, arcane: 0 },
  disposition: 'hostile' as const,
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  minDepth: 1,
  maxDepth: 20,
  rarity: 'legendary' as const,
};

function item(id: string): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    description: '',
    tags: [],
    glyph: '*',
    color: '#ffaa00',
    category: 'misc',
    stackLimit: 10,
    price: 1,
    rarity: 'legendary',
    heirloomEligible: true,
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

const table: LootTableContentEntry = {
  kind: 'loot-table',
  id: 'loot-table.boss',
  name: 'Boss loot',
  description: '',
  tags: [],
  rolls: 2,
  choices: [
    {
      contentId: 'item.extra-a',
      lootTableId: null,
      weight: 1,
      minimumQuantity: 1,
      maximumQuantity: 1,
    },
    {
      contentId: 'item.extra-b',
      lootTableId: null,
      weight: 1,
      minimumQuantity: 2,
      maximumQuantity: 2,
    },
  ],
};

function definition(overrides: Partial<BossEncounterDefinition> = {}): BossEncounterDefinition {
  return {
    monsterId: monster.id,
    phases: [
      {
        phaseId: 'kindled',
        healthThresholdPercent: 70,
        behaviorId: 'behavior.patrol',
        behaviorParameters: { waypoints: [{ x: 2, y: 2 }] },
        modifiers: { accuracy: 1, defense: 2, damage: 3 },
        effects: [
          {
            effectId: 'effect.condition.apply',
            parameters: { conditionId: 'condition.disengaged', duration: 100 },
            requiresLivingTarget: true,
          },
        ],
      },
      {
        phaseId: 'inferno',
        healthThresholdPercent: 30,
        behaviorId: 'behavior.approach-and-attack',
        behaviorParameters: {},
        modifiers: { accuracy: 4, defense: -1, damage: 6 },
        effects: [],
      },
    ],
    recoveryPerWorldTime: 0.01,
    recoveryCapPercent: 20,
    uniqueItemId: 'item.unique',
    enhancedLootTableId: table.id,
    vaultTags: [],
    ...overrides,
  };
}

function fixture(overrides: Partial<BossEncounterDefinition> = {}) {
  const base = createDemoRun();
  const hero = base.actors[0]!;
  const boss: ActorState = {
    ...hero,
    actorId: 'actor.boss',
    contentId: monster.id,
    playerControlled: false,
    x: 4,
    y: 3,
    health: 100,
    maxHealth: 100,
    disposition: 'hostile',
    behaviorId: monster.behaviorId,
    populationId: 'population.boss',
    populationRoleId: null,
    populationPresentation: { name: 'Boss', glyph: 'B', color: '#aa3300', leader: false },
  };
  const encounter: EncounterContentEntry = {
    kind: 'encounter',
    id: 'encounter.boss',
    name: 'Boss',
    description: '',
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
    definition: definition(overrides),
  };
  const content: CompiledContentPack = {
    ...createDemoContentPack(),
    entries: [
      ...createDemoContentPack().entries,
      monster,
      item('item.unique'),
      item('item.extra-a'),
      item('item.extra-b'),
      table,
      encounter,
    ],
  };
  const population: BossPopulation = {
    populationId: 'population.boss',
    encounterId: encounter.id,
    model: 'boss',
    floorId: hero.floorId,
    createdAt: 0,
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
  const state: ActiveRun = {
    ...base,
    actors: [boss, hero],
    populations: [population],
    encounterDecisions: [
      {
        encounterId: encounter.id,
        baseProbability: 1,
        protectionBonus: 0,
        effectiveProbability: 1,
        eligible: true,
        reachedEligibleDepth: true,
        encountered: true,
        instancesCreated: 1,
      },
    ],
    floors: [{ ...base.floors[0]!, entities: [{ entityId: boss.actorId, x: boss.x, y: boss.y }] }],
  };
  return { state, content };
}

describe('boss phases', () => {
  it('requires exactly one current encounter decision and exact boss membership', () => {
    const { state, content } = fixture();
    expect(() => validateContentBoundRun({ ...state, encounterDecisions: [] }, content)).toThrow(
      /every encounter|encounter decision/i,
    );
    const boss = state.populations[0] as BossPopulation;
    const malformed = {
      ...state,
      populations: [
        { ...boss, livingMemberIds: [...boss.livingMemberIds, state.hero.actorId].sort() },
      ],
    };
    expect(() => validateContentBoundRun(malformed, content)).toThrow(
      /boss.*(membership|wrong monster)|primary actor/i,
    );
  });

  it('persists authored arena feature mutations across exit and re-entry', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            {
              effectId: 'effect.feature.mutate',
              parameters: { state: 'door.open' },
              requiresLivingTarget: false,
            },
            {
              effectId: 'effect.light.toggle',
              parameters: { enabled: false },
              requiresLivingTarget: false,
            },
          ],
        },
      ],
    });
    const door = {
      featureId: 'feature.arena-door',
      floorId: state.activeFloorId,
      x: 5,
      y: 3,
      contentId: null,
      coverTileId: 1 as const,
      type: 'door' as const,
      state: 'locked' as const,
    };
    const light = {
      lightId: 'light.arena',
      location: { type: 'fixed' as const, x: 4, y: 2 },
      color: [255, 80, 20] as const,
      radius: 5,
      strength: 180,
      enabled: true,
      falloff: 'linear' as const,
      vaultPlacementId: null,
      presentation: null,
    };
    const phased = advanceBosses({
      state: {
        ...state,
        features: [door],
        floors: state.floors.map((floor) =>
          floor.floorId === state.activeFloorId ? { ...floor, lights: [light] } : floor,
        ),
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
        ),
      },
      content,
      eventId: 'event.arena-open',
    });
    expect(phased.state.features).toEqual([{ ...door, state: 'open' }]);
    expect(phased.state.floors[0]!.lights).toEqual([{ ...light, enabled: false }]);
    const inactive = advanceBosses({
      state: { ...phased.state, worldTime: 20, activeFloorId: 'floor.other' },
      content,
      eventId: 'event.arena-exit',
    });
    const reentered = advanceBosses({
      state: {
        ...inactive.state,
        worldTime: 30,
        activeFloorId: 'floor.demo',
        activeFloorEnteredAt: 30,
      },
      content,
      eventId: 'event.arena-return',
    });
    expect(reentered.state.features).toEqual([{ ...door, state: 'open' }]);
    expect(reentered.state.floors[0]!.lights).toEqual([{ ...light, enabled: false }]);
    expect(reentered.events).not.toContainEqual(
      expect.objectContaining({ type: 'boss.phase-changed' }),
    );
    expect(decodeActiveRun(encodeActiveRun(reentered.state))).toEqual(reentered.state);
  });

  it('drops the lock when an arena mutation opens a locked door', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            {
              effectId: 'effect.feature.mutate',
              parameters: { state: 'door.open' },
              requiresLivingTarget: false,
            },
          ],
        },
      ],
    });
    const door = {
      featureId: 'feature.arena-door',
      floorId: state.activeFloorId,
      x: 5,
      y: 3,
      contentId: null,
      coverTileId: 1 as const,
      type: 'door' as const,
      state: 'locked' as const,
      lock: { difficulty: 14, keyContentId: null },
    };
    const phased = advanceBosses({
      state: {
        ...state,
        features: [door],
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
        ),
      },
      content,
      eventId: 'event.arena-unlock',
    });
    expect(phased.state.features).toEqual([
      {
        featureId: door.featureId,
        floorId: door.floorId,
        x: door.x,
        y: door.y,
        contentId: null,
        coverTileId: 1,
        type: 'door',
        state: 'open',
      },
    ]);
  });

  it('refuses an arena mutation that would lock a lockless door', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            {
              effectId: 'effect.feature.mutate',
              parameters: { state: 'door.locked' },
              requiresLivingTarget: false,
            },
          ],
        },
      ],
    });
    const door = {
      featureId: 'feature.arena-door',
      floorId: state.activeFloorId,
      x: 5,
      y: 3,
      contentId: null,
      coverTileId: 1 as const,
      type: 'door' as const,
      state: 'closed' as const,
    };
    const damaged = {
      ...state,
      features: [door],
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
      ),
    };
    const before = structuredClone(damaged);
    expect(() => advanceBosses({ state: damaged, content, eventId: 'event.arena-lock' })).toThrow(
      /feature\.arena-door.*lock/i,
    );
    expect(damaged).toEqual(before);
  });

  it('rolls back an earlier arena mutation when a later environment reference is missing', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            {
              effectId: 'effect.feature.mutate',
              parameters: { state: 'door.open' },
              requiresLivingTarget: false,
            },
            {
              effectId: 'effect.light.toggle',
              parameters: { enabled: false },
              requiresLivingTarget: false,
            },
          ],
        },
      ],
    });
    const door = {
      featureId: 'feature.arena-door',
      floorId: state.activeFloorId,
      x: 5,
      y: 3,
      contentId: null,
      coverTileId: 1 as const,
      type: 'door' as const,
      state: 'locked' as const,
    };
    const damaged = {
      ...state,
      features: [door],
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
      ),
    };
    const before = structuredClone(damaged);
    expect(() =>
      advanceBosses({ state: damaged, content, eventId: 'event.arena-rollback' }),
    ).toThrow(/arena light/i);
    expect(damaged).toEqual(before);
    expect(damaged.populations[0]).toMatchObject({ currentPhaseId: null, crossedPhaseIds: [] });
    expect(damaged.items).toEqual([]);
  });

  it.each([
    ['effect.hunger.restore', { amount: 1 }],
    ['effect.item.consume', { quantity: 1 }],
    ['effect.force-move', { distance: 1 }],
  ] as const)(
    'rejects bypassed boss phase %s before an earlier arena effect can publish',
    (effectId, parameters) => {
      const { state, content } = fixture({
        phases: [
          {
            ...definition().phases[0]!,
            effects: [
              {
                effectId: 'effect.feature.mutate',
                parameters: { state: 'door.open' },
                requiresLivingTarget: false,
              },
              { effectId, parameters, requiresLivingTarget: false },
            ],
          },
        ],
      });
      const door = {
        featureId: 'feature.arena-door',
        floorId: state.activeFloorId,
        x: 5,
        y: 3,
        contentId: null,
        coverTileId: 1 as const,
        type: 'door' as const,
        state: 'locked' as const,
      };
      const damaged = {
        ...state,
        features: [door],
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
        ),
      };
      expect(() =>
        advanceBosses({ state: damaged, content, eventId: 'event.unsupported-phase' }),
      ).toThrow(new RegExp(`boss phase effect ${effectId.replace('.', '\\.')}`));
      expect(damaged.features).toEqual([door]);
      expect(damaged.populations[0]).toMatchObject({ currentPhaseId: null, crossedPhaseIds: [] });
      expect(damaged.items).toEqual([]);
    },
  );

  it('passes immutable item changes between authored arena fuel and light operations', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            {
              effectId: 'effect.fuel.transfer',
              parameters: { maximum: 3 },
              requiresLivingTarget: false,
            },
            {
              effectId: 'effect.light.toggle',
              parameters: { enabled: true },
              requiresLivingTarget: false,
            },
          ],
        },
      ],
    });
    const lantern = {
      ...item('item.arena-lantern'),
      tags: ['arena-light'],
      light: {
        color: [255, 120, 40] as const,
        radius: 5,
        strength: 180,
        fuelCapacity: 5,
        fuelPerTime: 1,
        warningThresholds: [1],
        fuelTags: ['arena-fuel'],
      },
    };
    const fuel = { ...item('item.arena-fuel'), tags: ['arena-fuel'] };
    const enriched = { ...content, entries: [...content.entries, fuel, lantern] };
    const items = [
      {
        itemId: 'item.arena-fuel.1',
        contentId: fuel.id,
        quantity: 4,
        condition: 100,
        enchantment: null,
        identified: true,
        charges: null,
        fuel: null,
        enabled: null,
        location: { type: 'backpack' as const, actorId: 'actor.boss' },
      },
      {
        itemId: 'item.arena-light.1',
        contentId: lantern.id,
        quantity: 1,
        condition: 100,
        enchantment: null,
        identified: true,
        charges: null,
        fuel: 0,
        enabled: false,
        location: { type: 'backpack' as const, actorId: 'actor.boss' },
      },
    ];
    const phased = advanceBosses({
      state: {
        ...state,
        items,
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
        ),
      },
      content: enriched,
      eventId: 'event.arena-fuel',
    });
    expect(phased.state.items).toEqual([
      { ...items[0]!, quantity: 1 },
      { ...items[1]!, fuel: 3, enabled: true },
    ]);
    expect(phased.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'item.refueled', quantity: 3, fuel: 3 }),
        expect.objectContaining({ type: 'item.light-toggled', enabled: true }),
      ]),
    );
  });

  it('leaves an inextinguishable artifact lit when the arena douses lights', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            {
              effectId: 'effect.light.toggle',
              parameters: { enabled: false },
              requiresLivingTarget: false,
            },
          ],
        },
      ],
    });
    const grace: ItemContentEntry = {
      ...item('item.marias-grace'),
      stackLimit: 1,
      equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
      light: {
        color: [255, 217, 160] as const,
        radius: 7,
        strength: 180,
        fuelCapacity: 2400,
        fuelPerTime: 1,
        warningThresholds: [600],
        fuelTags: ['lamp-oil'],
      },
      artifact: {
        canon: true,
        signature: null,
        drawbackModifiers: {},
        light: { fuelless: true, inextinguishable: true },
      },
    };
    const graceItem = {
      itemId: 'item.marias-grace.1',
      contentId: grace.id,
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: 2400,
      enabled: true,
      location: { type: 'backpack' as const, actorId: 'actor.boss' },
    };
    const phased = advanceBosses({
      state: {
        ...state,
        items: [graceItem],
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
        ),
      },
      content: { ...content, entries: [...content.entries, grace] },
      eventId: 'event.arena-douse',
    });
    expect(phased.state.items).toEqual([graceItem]);
    expect(phased.events.some((event) => event.type === 'item.light-toggled')).toBe(false);
  });

  it('crosses multiple thresholds once in authored descending order and changes behavior, effects, and modifiers atomically', () => {
    const { state, content } = fixture();
    const damaged = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 20 } : actor,
      ),
    };
    const before = structuredClone(damaged);
    const first = advanceBosses({ state: damaged, content, eventId: 'event.phases' });
    expect(damaged).toEqual(before);
    expect(first.state.populations[0]).toMatchObject({
      currentPhaseId: 'inferno',
      crossedPhaseIds: ['kindled', 'inferno'],
    });
    expect(first.state.actors.find((actor) => actor.actorId === 'actor.boss')).toMatchObject({
      behaviorId: 'behavior.approach-and-attack',
      conditions: [expect.objectContaining({ conditionId: 'condition.disengaged' })],
    });
    expect(
      first.events
        .filter((event) => event.type === 'boss.phase-changed')
        .map((event) => ('phaseId' in event ? event.phaseId : null)),
    ).toEqual(['kindled', 'inferno']);
    expect(bossCombatModifiers({ state: first.state, content, actorId: 'actor.boss' })).toEqual({
      accuracy: 4,
      defense: -1,
      damage: 6,
    });
    const again = advanceBosses({ state: first.state, content, eventId: 'event.again' });
    expect(again.events.filter((event) => event.type === 'boss.phase-changed')).toEqual([]);
    expect(again.state.populations[0]).toEqual(first.state.populations[0]);
  });

  it('fails an invalid phase effect without partially crossing a phase or changing behavior', () => {
    const { state, content } = fixture({
      phases: [
        {
          ...definition().phases[0]!,
          effects: [
            { effectId: 'effect.missing' as never, parameters: {}, requiresLivingTarget: true },
          ],
        },
      ],
    });
    const damaged = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 50 } : actor,
      ),
    };
    expect(() =>
      advanceBosses({ state: damaged, content, eventId: 'event.invalid-phase' }),
    ).toThrow(/boss phase effect effect\.missing is unsupported/i);
    expect(damaged.populations[0]).toMatchObject({ currentPhaseId: null, crossedPhaseIds: [] });
    expect(damaged.actors.find((actor) => actor.actorId === 'actor.boss')?.behaviorId).toBe(
      monster.behaviorId,
    );
  });

  it('uses the saved current phase behavior parameters', () => {
    const { state, content } = fixture();
    const phased = advanceBosses({
      state: {
        ...state,
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 60 } : actor,
        ),
      },
      content,
      eventId: 'event.kindled',
    });
    const boss = phased.state.actors.find((actor) => actor.actorId === 'actor.boss')!;
    expect(boss.behaviorId).toBe('behavior.patrol');
    expect(selectPatrolGoal({ state: phased.state, actor: boss, content })).toEqual({
      type: 'cell',
      floorId: boss.floorId,
      x: 2,
      y: 2,
    });
  });

  it('rejects more than one population instance for the same boss encounter', () => {
    const { state, content } = fixture();
    const duplicate = {
      ...state.populations[0]!,
      populationId: 'population.boss-copy',
    } as BossPopulation;
    expect(() =>
      advanceBosses({
        state: { ...state, populations: [state.populations[0]!, duplicate] },
        content,
        eventId: 'event.duplicate-instance',
      }),
    ).toThrow(/one instance/i);
  });
});

describe('boss recovery and defeat rewards', () => {
  it('does not resurrect a boss killed across multiple phases by a default healing effect', () => {
    const healingPhases = definition().phases.map((phase) => ({
      ...phase,
      effects: [
        {
          effectId: 'effect.heal' as const,
          parameters: { dice: { count: 1, sides: 1, bonus: 49 } },
          requiresLivingTarget: false,
        },
      ],
    }));
    const { state, content } = fixture({ phases: healingPhases });
    const dead = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const first = advanceBosses({ state: dead, content, eventId: 'event.killing-thresholds' });
    expect(first.state.actors.find((actor) => actor.actorId === 'actor.boss')?.health).toBe(0);
    expect(first.state.populations[0]).toMatchObject({ crossedPhaseIds: [], rewardCreated: true });
    expect(first.events.filter((event) => event.type === 'boss.phase-changed')).toHaveLength(0);
    expect(first.events.filter((event) => event.type === 'boss.reward-created')).toHaveLength(1);
    const retried = advanceBosses({
      state: first.state,
      content,
      eventId: 'event.killing-thresholds-retry',
    });
    expect(retried.state.actors.find((actor) => actor.actorId === 'actor.boss')?.health).toBe(0);
    expect(retried.events.filter((event) => event.type === 'boss.reward-created')).toHaveLength(0);
  });

  it('freezes inactive bosses, then recovers one elapsed interval without reversing phase or resurrecting', () => {
    const { state, content } = fixture();
    const phased = advanceBosses({
      state: {
        ...state,
        worldTime: 10,
        actors: state.actors.map((actor) =>
          actor.actorId === 'actor.boss' ? { ...actor, health: 20 } : actor,
        ),
      },
      content,
      eventId: 'event.phase',
    });
    const inactive = advanceBosses({
      state: { ...phased.state, worldTime: 20, activeFloorId: 'floor.other' },
      content,
      eventId: 'event.exit',
    });
    expect(inactive.state.actors).toEqual(phased.state.actors);
    expect(inactive.state.populations[0]).toMatchObject({
      lastFloorExitAt: 20,
      currentPhaseId: 'inferno',
    });
    const stillInactive = advanceBosses({
      state: { ...inactive.state, worldTime: 50 },
      content,
      eventId: 'event.frozen',
    });
    expect(stillInactive.state.populations[0]).toEqual(inactive.state.populations[0]);
    const reentered = advanceBosses({
      state: { ...stillInactive.state, activeFloorId: 'floor.demo', activeFloorEnteredAt: 50 },
      content,
      eventId: 'event.return',
    });
    expect(reentered.state.actors.find((actor) => actor.actorId === 'actor.boss')?.health).toBe(30);
    expect(reentered.state.populations[0]).toMatchObject({
      lastFloorExitAt: null,
      currentPhaseId: 'inferno',
      recoveryHistory: [{ at: 50, amount: 10 }],
    });
    expect(reentered.events).toContainEqual(
      expect.objectContaining({ type: 'boss.recovered', amount: 10 }),
    );
    const duplicate = advanceBosses({
      state: reentered.state,
      content,
      eventId: 'event.return-again',
    });
    expect(duplicate.state.actors.find((actor) => actor.actorId === 'actor.boss')?.health).toBe(30);
    expect(duplicate.events).not.toContainEqual(
      expect.objectContaining({ type: 'boss.recovered' }),
    );

    const dead = {
      ...inactive.state,
      actors: inactive.state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const deadReturn = advanceBosses({
      state: { ...dead, worldTime: 100, activeFloorId: 'floor.demo', activeFloorEnteredAt: 100 },
      content,
      eventId: 'event.dead-return',
    });
    expect(deadReturn.state.actors.find((actor) => actor.actorId === 'actor.boss')?.health).toBe(0);
  });

  it('creates the unique and one enhanced resolution exactly once across retries and save/reload', () => {
    const { state, content } = fixture();
    const defeated = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const first = advanceBosses({ state: defeated, content, eventId: 'event.defeat' });
    const bossItems = first.state.items.filter((entry) =>
      entry.itemId.startsWith('item.reward.population.boss.'),
    );
    expect(
      bossItems.some((entry) => entry.contentId === 'item.unique' && entry.quantity === 1),
    ).toBe(true);
    expect(bossItems.filter((entry) => entry.itemId.includes('.loot.')).length).toBe(2);
    expect(first.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['boss.defeated', 'boss.reward-created']),
    );
    const restored = decodeActiveRun(encodeActiveRun(first.state));
    expect(() => validateContentBoundRun(restored, content)).not.toThrow();
    const retried = advanceBosses({ state: restored, content, eventId: 'event.duplicate' });
    expect(retried.state.items).toEqual(first.state.items);
    expect(retried.state.rng.loot).toEqual(first.state.rng.loot);
    expect(retried.events.filter((event) => event.type.startsWith('boss.'))).toEqual([]);
  });

  it.each([
    [
      'picked up',
      (items: ActiveRun['items'], ordinaryId: string, heroId: string) =>
        items.map((entry) =>
          entry.itemId === ordinaryId
            ? { ...entry, location: { type: 'backpack' as const, actorId: heroId } }
            : entry,
        ),
    ],
    [
      'partly consumed',
      (items: ActiveRun['items'], ordinaryId: string) =>
        items.map((entry) => (entry.itemId === ordinaryId ? { ...entry, quantity: 1 } : entry)),
    ],
    [
      'split',
      (items: ActiveRun['items'], ordinaryId: string) =>
        items.flatMap((entry) =>
          entry.itemId === ordinaryId
            ? [
                { ...entry, quantity: 1 },
                { ...entry, itemId: `${entry.itemId}.split`, quantity: 1 },
              ]
            : [entry],
        ),
    ],
    [
      'damaged',
      (items: ActiveRun['items'], ordinaryId: string) =>
        items.map((entry) => (entry.itemId === ordinaryId ? { ...entry, condition: 7 } : entry)),
    ],
    [
      'deleted',
      (items: ActiveRun['items'], ordinaryId: string) =>
        items.filter((entry) => entry.itemId !== ordinaryId),
    ],
  ] as const)('keeps the boss receipt valid after ordinary loot is %s', (_label, transform) => {
    const { state, content } = fixture();
    const defeated = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const rewarded = advanceBosses({
      state: defeated,
      content,
      eventId: 'event.mutable-loot',
    }).state;
    const ordinary = rewarded.items.find((entry) => entry.contentId === 'item.extra-b')!;
    expect(() =>
      validateContentBoundRun(
        { ...rewarded, items: transform(rewarded.items, ordinary.itemId, rewarded.hero.actorId) },
        content,
      ),
    ).not.toThrow();
  });

  it('keeps the boss receipt valid after ordinary loot is equipped', () => {
    const base = fixture();
    const content = {
      ...base.content,
      entries: base.content.entries.map((entry) =>
        entry.id === 'item.extra-a'
          ? {
              ...entry,
              equipment: {
                slots: ['main-hand' as const],
                handedness: 'one-handed' as const,
                reservedSlots: [],
              },
            }
          : entry,
      ),
    };
    const defeated = {
      ...base.state,
      actors: base.state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const rewarded = advanceBosses({
      state: defeated,
      content,
      eventId: 'event.equipped-loot',
    }).state;
    const ordinary = rewarded.items.find((entry) => entry.contentId === 'item.extra-a')!;
    const equipped = {
      ...rewarded,
      items: rewarded.items.map((entry) =>
        entry.itemId === ordinary.itemId
          ? {
              ...entry,
              location: {
                type: 'equipped' as const,
                actorId: rewarded.hero.actorId,
                slot: 'main-hand' as const,
              },
            }
          : entry,
      ),
      actors: rewarded.actors.map((actor) =>
        actor.actorId === rewarded.hero.actorId
          ? { ...actor, equipment: { ...actor.equipment, 'main-hand': ordinary.itemId } }
          : actor,
      ),
    };
    expect(() => validateContentBoundRun(equipped, content)).not.toThrow();
  });

  it('rejects a tampered receipt and missing or duplicate guaranteed unique rewards', () => {
    const { state, content } = fixture();
    const defeated = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const rewarded = advanceBosses({
      state: defeated,
      content,
      eventId: 'event.reward-binding',
    }).state;
    const rewardItems = rewarded.items.filter((entry) =>
      entry.itemId.startsWith('item.reward.population.boss.'),
    );
    const population = rewarded.populations[0] as BossPopulation;
    expect(() =>
      validateContentBoundRun(
        {
          ...rewarded,
          populations: [
            {
              ...population,
              rewardReceipt: {
                ...population.rewardReceipt!,
                items: population.rewardReceipt!.items.map((item, index) =>
                  index === 1 ? { ...item, contentId: 'item.unique' } : item,
                ),
              },
            },
          ],
        },
        content,
      ),
    ).toThrow(/boss reward/i);
    expect(() =>
      validateContentBoundRun(
        { ...rewarded, items: rewarded.items.filter((entry) => entry.contentId !== 'item.unique') },
        content,
      ),
    ).toThrow(/boss reward/i);
    expect(() =>
      validateContentBoundRun(
        {
          ...rewarded,
          items: rewarded.items.map((entry) =>
            entry.contentId === 'item.unique' ? { ...entry, contentId: 'item.extra-a' } : entry,
          ),
        },
        content,
      ),
    ).toThrow(/boss reward/i);
    expect(() =>
      validateContentBoundRun(
        {
          ...rewarded,
          items: [
            ...rewarded.items,
            {
              ...rewardItems.find((entry) => entry.contentId === 'item.unique')!,
            },
          ].sort((left, right) => left.itemId.localeCompare(right.itemId)),
        },
        content,
      ),
    ).toThrow(/boss reward/i);
  });

  it('validates every reward reference before consuming loot RNG or creating any item', () => {
    const { state, content } = fixture();
    const broken = {
      ...content,
      entries: content.entries.filter((entry) => entry.id !== 'item.extra-b'),
    };
    const defeated = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    expect(() =>
      advanceBosses({ state: defeated, content: broken, eventId: 'event.broken' }),
    ).toThrow(/item\.extra-b/);
    expect(defeated.items).toEqual([]);
    expect(defeated.rng.loot).toEqual(state.rng.loot);
  });

  it.each([
    ['roll count', (current: LootTableContentEntry) => ({ ...current, rolls: 257 })],
    [
      'choice weight',
      (current: LootTableContentEntry) => ({
        ...current,
        choices: current.choices.map((choice, index) => ({
          ...choice,
          weight: index === 0 ? 0x8000_0000 : 0x8000_0001,
        })),
      }),
    ],
    [
      'choice quantity',
      (current: LootTableContentEntry) => ({
        ...current,
        choices: current.choices.map((choice, index) =>
          index === 0 ? { ...choice, maximumQuantity: 257 } : choice,
        ),
      }),
    ],
  ] as const)('preflights bypassed boss loot %s before RNG or item changes', (_label, mutate) => {
    const { state, content } = fixture();
    const unsafe = {
      ...content,
      entries: content.entries.map((entry) =>
        entry.id === table.id && entry.kind === 'loot-table' ? mutate(entry) : entry,
      ),
    };
    const defeated = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    const before = structuredClone(defeated);
    expect(() =>
      advanceBosses({ state: defeated, content: unsafe, eventId: 'event.unsafe-loot' }),
    ).toThrow(/loot preflight.*(roll|weight|quantity).*(256|2\^32)/i);
    expect(defeated).toEqual(before);
  });
});

describe('boss relic discovery gate', () => {
  const ARTIFACT_ID = 'item.artifact-relic';

  function artifactItem(): ItemContentEntry {
    return {
      ...item(ARTIFACT_ID),
      stackLimit: 1,
      artifact: {
        canon: true,
        signature: null,
        drawbackModifiers: { defense: -1 },
        light: null,
      },
    };
  }

  /**
   * The boss fixture with its guaranteed unique replaced by an artifact, and the run's
   * undiscovered pool under the test's control.
   */
  function relicFixture(undiscovered: readonly string[]) {
    const base = fixture({ uniqueItemId: ARTIFACT_ID });
    const content: CompiledContentPack = {
      ...base.content,
      entries: [...base.content.entries, artifactItem()],
    };
    const state: ActiveRun = {
      ...base.state,
      artifactsUndiscovered: [...undiscovered],
      actors: base.state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };
    return { state, content };
  }

  it('drops the relic while it is still undiscovered', () => {
    const { state, content } = relicFixture([ARTIFACT_ID]);

    const result = advanceBosses({ state, content, eventId: 'event.relic-undiscovered' });

    expect(
      result.state.items.filter((entry) => entry.itemId === 'item.reward.population.boss.unique'),
    ).toEqual([expect.objectContaining({ contentId: ARTIFACT_ID, quantity: 1 })]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'boss.reward-created',
        uniqueItemId: 'item.reward.population.boss.unique',
      }),
    );
    expect(() => validateContentBoundRun(result.state, content)).not.toThrow();
  });

  it('withholds a relic that is no longer undiscovered without consuming extra randomness', () => {
    const undiscovered = relicFixture([ARTIFACT_ID]);
    const secured = relicFixture([]);

    const dropped = advanceBosses({
      state: undiscovered.state,
      content: undiscovered.content,
      eventId: 'event.relic-drop',
    });
    const withheld = advanceBosses({
      state: secured.state,
      content: secured.content,
      eventId: 'event.relic-withheld',
    });

    expect(withheld.state.items.some((entry) => entry.contentId === ARTIFACT_ID)).toBe(false);
    expect(
      withheld.state.items.filter((entry) =>
        entry.itemId.startsWith('item.reward.population.boss.loot'),
      ).length,
    ).toBe(2);
    expect(withheld.events).toContainEqual(
      expect.objectContaining({ type: 'boss.reward-created', uniqueItemId: null }),
    );
    // The unique costs no draws either way: the enhanced table lands on the same loot stream.
    expect(withheld.state.rng.loot).toEqual(dropped.state.rng.loot);
    expect(() => validateContentBoundRun(withheld.state, secured.content)).not.toThrow();
    expect(() =>
      validateContentBoundRun(decodeActiveRun(encodeActiveRun(withheld.state)), secured.content),
    ).not.toThrow();
  });

  it('leaves a non-artifact unique reward untouched by the discovery pool', () => {
    const base = fixture();
    const state: ActiveRun = {
      ...base.state,
      artifactsUndiscovered: [],
      actors: base.state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };

    const result = advanceBosses({ state, content: base.content, eventId: 'event.plain-unique' });

    expect(
      result.state.items.filter((entry) => entry.itemId === 'item.reward.population.boss.unique'),
    ).toEqual([expect.objectContaining({ contentId: 'item.unique' })]);
  });
});

/** Every band's `chanceBps` forced to 10000 and `capBps` raised to 10000 (uncapped) so a curse
 * always resolves once rolled -- the demo pack's authored `capBps` (5000) would otherwise clamp a
 * forced 10000 chance back down to a 50/50. */
function forceCurseChance(content: CompiledContentPack): CompiledContentPack {
  return {
    ...content,
    entries: content.entries.map((entry) => {
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

describe('boss reward curses', () => {
  it('rolls a curse onto the table-drawn reward, never onto the guaranteed unique', () => {
    const rewardCurse: CurseContentEntry = {
      kind: 'curse',
      id: 'curse.boss-reward-test',
      name: 'Test Reward Curse',
      tags: ['curse', 'weapon'],
      revealText: 'What the boss guarded now guards itself.',
      drawbackModifiers: { meleeAccuracy: -1 },
      trigger: null,
    };
    const weaponRewardTable: LootTableContentEntry = {
      ...table,
      rolls: 1,
      choices: [
        {
          contentId: 'item.extra-a',
          lootTableId: null,
          weight: 1,
          minimumQuantity: 1,
          maximumQuantity: 1,
        },
      ],
    };
    const { state, content } = fixture();
    const weaponContent = forceCurseChance({
      ...content,
      entries: [
        ...content.entries.map((entry) => {
          if (entry.kind !== 'item' || entry.id !== 'item.extra-a') return entry;
          return {
            ...entry,
            category: 'weapon' as const,
            equipment: {
              slots: ['main-hand' as const],
              handedness: 'one-handed' as const,
              reservedSlots: [],
            },
            combat: {
              accuracy: 0,
              defense: 0,
              armor: 0,
              damage: { count: 1, sides: 4, bonus: 0 },
              range: 1,
              ammunitionTag: null,
            },
          };
        }),
        rewardCurse,
      ],
    });
    const finalContent: CompiledContentPack = {
      ...weaponContent,
      entries: weaponContent.entries.map((entry) =>
        entry.kind === 'loot-table' && entry.id === table.id ? weaponRewardTable : entry,
      ),
    };
    const defeated = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === 'actor.boss' ? { ...actor, health: 0 } : actor,
      ),
    };

    const result = advanceBosses({
      state: defeated,
      content: finalContent,
      eventId: 'event.curse-reward',
    });

    const bossItems = result.state.items.filter((entry) =>
      entry.itemId.startsWith('item.reward.population.boss.'),
    );
    const unique = bossItems.find((entry) => entry.contentId === 'item.unique');
    expect(unique?.curse).toBeUndefined();
    const weaponReward = bossItems.filter((entry) => entry.contentId === 'item.extra-a');
    expect(weaponReward.length).toBeGreaterThan(0);
    for (const item of weaponReward) {
      expect(item.curse).toEqual({ curseId: rewardCurse.id, revealed: false });
    }
  });
});
