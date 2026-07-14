import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, EncounterContentEntry, GroupEncounterDefinition } from '@woven-deep/content';
import {
  applyGroupLeaderOutcomes,
  coordinateGroups,
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  groupCombatModifiers,
  resolveWorldStep,
  type ActiveRun,
  type ActorState,
  type GroupPopulation,
} from '../src/index.js';

const ROLE = { roleId: 'guard', monsterId: 'monster.training-beetle', minimumQuantity: 1,
  maximumQuantity: 8, formationPreference: 'front' as const, behaviorParameters: {} };

function definition(overrides: Partial<GroupEncounterDefinition> = {}): GroupEncounterDefinition {
  return {
    roles: [ROLE], formation: 'line', communicationRadius: 2, leaderChance: 1,
    leaderRoleId: 'guard', leaderAccentColor: '#ffcc00', leaderAlternateGlyph: 'L',
    coordinationModifiers: { accuracy: 2, defense: 3, damage: 4 },
    leaderDeathResponse: 'weaken',
    responseParameters: { modifiers: { accuracy: -1, defense: -2, damage: -3 } },
    supernaturalBond: false, collapseRewards: 'none', ...overrides,
  };
}

function pack(groupDefinition = definition()): CompiledContentPack {
  const base = createDemoContentPack();
  const monster = {
    kind: 'monster' as const, id: 'monster.training-beetle', name: 'Training beetle', tags: [],
    glyph: 'g', color: '#888888', attributes: { might: 3, agility: 3, vitality: 3, wits: 3, resolve: 3 },
    health: 10, speed: 100, accuracy: 1, defense: 5, perception: 6,
    damage: { count: 1, sides: 2, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, poison: 0, arcane: 0 },
    disposition: 'hostile' as const, behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    minDepth: 1, maxDepth: 20, rarity: 'common' as const,
  };
  const encounter: EncounterContentEntry = {
    kind: 'encounter', id: 'encounter.group-test', name: 'Test group', description: '', tags: [],
    adminDescription: null, model: 'group', minDepth: 1, maxDepth: 20, environmentTags: [],
    requiredVaultTags: [], weight: 1, rarity: 'common', runAppearanceChance: 1,
    discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1,
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 8,
      allowedTerrainTags: ['floor'], requiresVaultSlot: false, failureMode: 'optional' },
    intentPresentation: { visible: true }, definition: groupDefinition,
  };
  return { ...base, entries: [...base.entries, monster, encounter] };
}

function member(base: ActorState, id: string, x: number, y: number, directAt?: number): ActorState {
  return {
    ...base, actorId: id, contentId: 'monster.training-beetle', playerControlled: false,
    x, y, health: 10, maxHealth: 10, disposition: 'hostile', behaviorId: 'behavior.approach-and-attack',
    populationId: 'population.group-test', populationRoleId: 'guard',
    populationPresentation: { name: 'Guard', glyph: 'g', color: '#888888', leader: id === 'monster.a' },
    behaviorState: { intent: 'hold', goal: null, investigation: null,
      lastKnownTargets: directAt === undefined ? [] : [{ targetActorId: 'hero.demo', floorId: base.floorId,
        x: 5, y: 3, observedAt: directAt, source: 'sight', observerActorId: id }] },
  };
}

function fixture(options: Readonly<{ positions?: readonly [string, number, number, number?][];
  groupDefinition?: GroupEncounterDefinition; active?: boolean }> = {}) {
  const base = createDemoRun();
  const hero = base.actors[0]!;
  const groupDefinition = options.groupDefinition ?? definition();
  const positions = options.positions ?? [['monster.a', 1, 2, 10], ['monster.b', 2, 2], ['monster.c', 4, 2]];
  const members = positions.map(([id, x, y, at]) => {
    const actor = member(hero, id, x, y, at);
    return id === 'monster.a' ? { ...actor, populationPresentation: {
      name: 'Guard', glyph: groupDefinition.leaderAlternateGlyph ?? 'g',
      color: groupDefinition.leaderAccentColor, leader: true,
    } } : actor;
  });
  const population: GroupPopulation = {
    populationId: 'population.group-test', encounterId: 'encounter.group-test', model: 'group',
    floorId: hero.floorId, createdAt: 0, livingMemberIds: members.map((actor) => actor.actorId).sort(),
    formerMemberIds: [], leaderActorId: 'monster.a', bonusActive: true,
    roleMembership: members.map((actor) => ({ actorId: actor.actorId, roleId: 'guard' })),
    sharedKnowledge: [], leaderResponseApplied: false,
  };
  const state: ActiveRun = { ...base, worldTime: 20,
    activeFloorId: options.active === false ? 'floor.inactive' : hero.floorId,
    actors: [hero, ...members], populations: [population], encounterDecisions: [{
      encounterId: 'encounter.group-test', baseProbability: 1, protectionBonus: 0,
      effectiveProbability: 1, eligible: true, reachedEligibleDepth: true, encountered: false,
      instancesCreated: 1,
    }] };
  return { state, content: pack(groupDefinition), population, members };
}

describe('group communication and formations', () => {
  it('relays in sorted breadth-first order across connected chains', () => {
    const { state, content } = fixture();
    const result = coordinateGroups({ state, content, eventId: 'event.relay' });
    expect(result.events.filter((event) => event.type === 'group.awareness-shared')
      .map((event) => 'actorId' in event ? event.actorId : null)).toEqual(['monster.b', 'monster.c']);
    expect(result.state.actors.filter((actor) => actor.populationId !== null)
      .map((actor) => actor.behaviorState.lastKnownTargets[0]?.source)).toEqual(['sight', 'group', 'group']);
    expect(result.state.actors.find((actor) => actor.actorId === 'monster.c')?.behaviorState.goal)
      .toMatchObject({ type: 'cell', floorId: 'floor.demo', x: 5, y: 3 });
  });

  it('does not share across a gap larger than communication range', () => {
    const { state, content } = fixture({ positions: [['monster.a', 1, 2, 10], ['monster.b', 4, 2]] });
    const result = coordinateGroups({ state, content, eventId: 'event.gap' });
    expect(result.state.actors.find((actor) => actor.actorId === 'monster.b')?.behaviorState.lastKnownTargets).toEqual([]);
  });

  it('chooses the latest legitimate direct observation and sorted observer on ties', () => {
    const { state, content } = fixture({ positions: [
      ['monster.a', 1, 2, 10], ['monster.b', 2, 2, 12], ['monster.c', 4, 2, 12],
    ] });
    const actors = state.actors.map((actor) => actor.actorId === 'monster.b'
      ? { ...actor, behaviorState: { ...actor.behaviorState, lastKnownTargets: [{
        ...actor.behaviorState.lastKnownTargets[0]!, x: 5, observerActorId: 'monster.b', observedAt: 12,
      }] } } : actor.actorId === 'monster.c' ? { ...actor, behaviorState: { ...actor.behaviorState,
        lastKnownTargets: [{ ...actor.behaviorState.lastKnownTargets[0]!, x: 4, observerActorId: 'monster.c', observedAt: 12 }] } }
      : actor);
    const result = coordinateGroups({ state: { ...state, actors }, content, eventId: 'event.latest' });
    const group = result.state.populations[0] as GroupPopulation;
    expect(group.sharedKnowledge[0]).toMatchObject({ observedAt: 12, observerActorId: 'monster.b', x: 5 });
  });

  it('freezes communication and goals on inactive floors', () => {
    const { state, content } = fixture({ active: false });
    expect(coordinateGroups({ state, content, eventId: 'event.inactive' })).toEqual({ state, events: [] });
  });

  it.each(['cluster', 'line', 'screen', 'wedge', 'surround'] as const)(
    'assigns stable legal %s formation goals without mutating input', (formation) => {
      const groupDefinition = definition({ formation, roles: [ROLE,
        { ...ROLE, roleId: 'rear', formationPreference: 'rear' }] });
      const { state, content } = fixture({ groupDefinition,
        positions: [['monster.a', 1, 2], ['monster.b', 2, 2], ['monster.c', 4, 2]] });
      const before = structuredClone(state);
      const first = coordinateGroups({ state, content, eventId: 'event.formation' }).state;
      const second = coordinateGroups({ state, content, eventId: 'event.formation' }).state;
      expect(first).toEqual(second);
      expect(state).toEqual(before);
      for (const actor of first.actors.filter((candidate) => candidate.populationId === 'population.group-test')) {
        expect(actor.behaviorState.goal).toMatchObject({ type: 'formation', populationId: 'population.group-test' });
        const goal = actor.behaviorState.goal!;
        expect(goal.type === 'formation' && goal.x >= 0 && goal.y >= 0).toBe(true);
      }
    },
  );
});

describe('leaders and deterministic outcomes', () => {
  it('resolves a defeated leader at the authoritative world-step boundary', () => {
    const { state, content } = fixture();
    const dead = { ...state, actors: state.actors.map((actor) => actor.actorId === 'monster.a'
      ? { ...actor, health: 0 } : actor) };
    const result = resolveWorldStep({ state: dead, content,
      action: { type: 'wait', actorId: dead.hero.actorId, cost: 100 },
      eventId: 'event.world-group', maxInternalActions: 2 });
    expect((result.state.populations[0] as GroupPopulation).leaderResponseApplied).toBe(true);
    expect(result.events.map((event) => event.type)).toContain('group.leader-defeated');
    expect(result.events.map((event) => event.type)).toContain('group.outcome-applied');
    const command = { type: 'wait' as const, commandId: 'event.world-group', expectedRevision: 0 };
    const recorded = { ...result.state, revision: 1, turn: 1, recentCommands: [{ command,
      result: { status: 'applied' as const, commandId: command.commandId, revision: 1, turn: 1 },
      events: result.events, publicEvents: result.publicEvents }] };
    expect(decodeActiveRun(encodeActiveRun(recorded))).toEqual(recorded);
  });

  it('uses authored leader presentation and applies coordination only while alive', () => {
    const { state, content } = fixture();
    expect(state.actors.find((actor) => actor.actorId === 'monster.a')?.populationPresentation)
      .toMatchObject({ glyph: 'L', color: '#ffcc00', leader: true });
    expect(groupCombatModifiers({ state, content, actorId: 'monster.b' }))
      .toEqual({ accuracy: 2, defense: 3, damage: 4 });
    const dead = { ...state, actors: state.actors.map((actor) => actor.actorId === 'monster.a' ? { ...actor, health: 0 } : actor) };
    expect(groupCombatModifiers({ state: dead, content, actorId: 'monster.b' }))
      .toEqual({ accuracy: 0, defense: 0, damage: 0 });
  });

  it.each([
    ['weaken', { modifiers: { accuracy: -1, defense: -2, damage: -3 } }],
    ['panic', { duration: 20 }], ['disband', {}], ['surrender', {}],
    ['frenzy', { duration: 20, modifiers: { accuracy: 3, defense: -1, damage: 4 } }],
  ] as const)('applies the %s response exactly once in sorted member order', (response, responseParameters) => {
    const { state, content } = fixture({ groupDefinition: definition({ leaderDeathResponse: response, responseParameters }) });
    const dead = { ...state, actors: state.actors.map((actor) => actor.actorId === 'monster.a' ? { ...actor, health: 0 } : actor) };
    const first = applyGroupLeaderOutcomes({ state: dead, content, eventId: 'event.death' });
    const second = applyGroupLeaderOutcomes({ state: first.state, content, eventId: 'event.death' });
    expect(first.events.map((event) => event.type)).toEqual(['group.leader-defeated', 'group.outcome-applied']);
    expect(second).toEqual({ state: first.state, events: [] });
    const survivors = first.state.actors.filter((actor) => actor.actorId === 'monster.b' || actor.actorId === 'monster.c');
    if (response === 'panic') expect(survivors.every((actor) => actor.behaviorState.intent === 'flee')).toBe(true);
    if (response === 'disband') expect(survivors.every((actor) => actor.populationId === null)).toBe(true);
    if (response === 'surrender') expect(survivors.every((actor) => actor.disposition === 'neutral')).toBe(true);
    if (response === 'weaken' || response === 'frenzy') {
      expect(groupCombatModifiers({ state: first.state, content, actorId: 'monster.b' }))
        .toEqual(responseParameters.modifiers);
    }
    if (response === 'frenzy') expect(groupCombatModifiers({
      state: { ...first.state, worldTime: first.state.worldTime + responseParameters.duration },
      content, actorId: 'monster.b',
    })).toEqual({ accuracy: 0, defense: 0, damage: 0 });
  });

  it.each(['none', 'individual'] as const)('collapses supernatural members with %s reward policy', (collapseRewards) => {
    const { state, content } = fixture({ groupDefinition: definition({ leaderDeathResponse: 'collapse',
      responseParameters: {}, supernaturalBond: true, collapseRewards }) });
    const dead = { ...state, actors: state.actors.map((actor) => actor.actorId === 'monster.a' ? { ...actor, health: 0 } : actor) };
    const result = applyGroupLeaderOutcomes({ state: dead, content, eventId: 'event.collapse' });
    expect(result.state.actors.filter((actor) => actor.populationId === 'population.group-test')
      .every((actor) => actor.health === 0)).toBe(true);
    expect(result.events.filter((event) => event.type === 'actor.died')).toHaveLength(collapseRewards === 'individual' ? 2 : 0);
    if (collapseRewards === 'individual') expect(result.events.filter((event) => event.type === 'actor.died')
      .every((event) => event.killerActorId === state.hero.actorId)).toBe(true);
    expect(result.events.find((event) => event.type === 'group.outcome-applied')).toMatchObject({
      response: 'collapse', individualRewards: collapseRewards === 'individual', collapsedMemberCount: 2,
    });
  });
});
