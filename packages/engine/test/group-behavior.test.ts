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
  projectDomainEvents,
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
    sharedKnowledge: [], leaderResponseApplied: false, leaderResponseExpiresAt: null,
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
      const groupActors = first.actors.filter((candidate) => candidate.populationId === 'population.group-test');
      expect(groupActors.find((actor) => actor.actorId === 'monster.a')?.behaviorState.goal).toBeNull();
      const formationGoals = groupActors.map((actor) => actor.behaviorState.goal)
        .filter((goal) => goal?.type === 'formation');
      expect(formationGoals.length).toBeGreaterThan(0);
      for (const goal of formationGoals) {
        expect(goal).toMatchObject({ type: 'formation', populationId: 'population.group-test' });
        expect(goal.type === 'formation' && goal.x >= 0 && goal.y >= 0).toBe(true);
      }
    },
  );

  it('assigns center, front, rear, and flank roles to distinct preferred slots', () => {
    const roles = [
      { ...ROLE, roleId: 'center', formationPreference: 'center' as const },
      { ...ROLE, roleId: 'front', formationPreference: 'front' as const },
      { ...ROLE, roleId: 'rear', formationPreference: 'rear' as const },
      { ...ROLE, roleId: 'flank', formationPreference: 'flank' as const },
    ];
    const { state, content } = fixture({ groupDefinition: definition({ formation: 'wedge', roles,
      leaderRoleId: 'center' }), positions: [
      ['monster.a', 3, 2], ['monster.b', 1, 1], ['monster.c', 5, 1], ['monster.d', 1, 3],
      ['monster.e', 6, 4],
    ] });
    const roleByActor = new Map([['monster.a', 'center'], ['monster.b', 'front'],
      ['monster.c', 'rear'], ['monster.d', 'flank'], ['monster.e', 'center']]);
    const actors = state.actors.map((actor) => roleByActor.has(actor.actorId)
      ? { ...actor, populationRoleId: roleByActor.get(actor.actorId)! } : actor);
    const populations = state.populations.map((population) => population.model === 'group' ? {
      ...population, roleMembership: [...roleByActor].map(([actorId, roleId]) => ({ actorId, roleId })),
    } : population);
    const openFloor = state.floors.map((floor) => floor.floorId === state.activeFloorId
      ? { ...floor, tiles: floor.tiles.map(() => 1 as const) } : floor);
    const result = coordinateGroups({ state: { ...state, actors, populations, floors: openFloor },
      content, eventId: 'event.roles' }).state;
    const goal = (actorId: string) => result.actors.find((actor) => actor.actorId === actorId)!.behaviorState.goal!;
    expect(goal('monster.a')).toBeNull();
    expect(goal('monster.e')).toMatchObject({ type: 'formation', roleId: 'center' });
    expect(Math.max(Math.abs(goal('monster.e').x - 3), Math.abs(goal('monster.e').y - 2))).toBe(1);
    expect(goal('monster.b')).toMatchObject({ type: 'formation', roleId: 'front' });
    expect(goal('monster.c')).toMatchObject({ type: 'formation', roleId: 'rear' });
    expect(goal('monster.d')).toMatchObject({ type: 'formation', roleId: 'flank' });
    expect(goal('monster.b').y).toBeGreaterThan(2);
    expect(goal('monster.c').y).toBeLessThan(2);
    expect(Math.abs(goal('monster.d').x - 3)).toBeGreaterThanOrEqual(2);
  });

  it('keeps a front-preference leader as a stable anchor across sequential world steps', () => {
    const { state, content } = fixture({ positions: [['monster.a', 4, 3]],
      groupDefinition: definition({ roles: [{ ...ROLE, formationPreference: 'front' }] }) });
    let current = { ...state, relationships: [{ leftActorId: state.hero.actorId,
      rightActorId: 'monster.a', relationship: 'neutral' as const }] };
    const origin = current.actors.find((actor) => actor.actorId === 'monster.a')!;
    for (let step = 0; step < 4; step += 1) {
      const result = resolveWorldStep({ state: current, content,
        action: { type: 'wait', actorId: state.hero.actorId, cost: 100 },
        eventId: `event.anchor.${step}`, maxInternalActions: 1 });
      current = result.state;
      expect(current.actors.find((actor) => actor.actorId === 'monster.a')).toMatchObject({
        x: origin.x, y: origin.y, behaviorState: { intent: 'hold', goal: null },
      });
      expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'actor.moved', actorId: 'monster.a' }));
    }
  });

  it('holds without a formation goal when every improving formation cell is blocked', () => {
    const { state, content } = fixture({ positions: [['monster.a', 4, 3], ['monster.b', 5, 3]] });
    const floor = state.floors[0]!;
    const open = new Set([`${state.actors[0]!.x}:${state.actors[0]!.y}`, '4:3', '5:3']);
    const floors = [{ ...floor, tiles: floor.tiles.map((_, index) => (
      open.has(`${index % floor.width}:${Math.floor(index / floor.width)}`) ? 1 as const : 0 as const
    )) }];
    const actors = state.actors.map((actor) => actor.actorId === 'monster.a' ? { ...actor, energy: 0 }
      : actor.actorId === 'monster.b' ? { ...actor, energy: 100 } : actor);
    const relationships = ['monster.a', 'monster.b'].map((actorId) => ({
      leftActorId: state.hero.actorId, rightActorId: actorId, relationship: 'neutral' as const,
    }));
    const result = resolveWorldStep({ state: { ...state, actors, floors, relationships }, content,
      action: { type: 'wait', actorId: state.hero.actorId, cost: 100 },
      eventId: 'event.blocked-formation', maxInternalActions: 1 });
    expect(result.state.actors.find((actor) => actor.actorId === 'monster.b')).toMatchObject({
      x: 5, y: 3, behaviorState: { intent: 'hold', goal: null },
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'actor.turn.completed', actorId: 'monster.b', actionType: 'wait',
    }));
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'actor.moved', actorId: 'monster.b' }));
  });
});

describe('leaders and deterministic outcomes', () => {
  it('reconciles an ordinary dead member before saves are encoded', () => {
    const { state, content } = fixture();
    const dead = { ...state, actors: state.actors.map((actor) => actor.actorId === 'monster.b'
      ? { ...actor, health: 0 } : actor) };
    const result = applyGroupLeaderOutcomes({ state: dead, content, eventId: 'event.member-death' });
    const population = result.state.populations[0] as GroupPopulation;
    expect(population.livingMemberIds).not.toContain('monster.b');
    expect(population.formerMemberIds).toContain('monster.b');
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });

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

  it('publishes qualitative visible group outcomes without authoritative details', () => {
    const { state, content } = fixture();
    const events = [
      { type: 'group.leader-defeated' as const, eventId: 'event.public',
        populationId: 'population.secret', actorId: 'monster.a' },
      { type: 'group.outcome-applied' as const, eventId: 'event.public',
        populationId: 'population.secret', actorId: 'monster.a', response: 'collapse' as const,
        individualRewards: true, collapsedMemberCount: 7 },
    ];
    expect(projectDomainEvents({ state, content, heroId: state.hero.actorId, events })).toEqual([
      { type: 'population.notice', eventId: 'event.public', category: 'leader-defeated',
        actorId: 'monster.a', presentation: 'group.leader-defeated' },
      { type: 'population.notice', eventId: 'event.public', category: 'group-outcome',
        actorId: 'monster.a', presentation: 'leader-response.collapse' },
    ]);
    expect(JSON.stringify(projectDomainEvents({ state, content, heroId: state.hero.actorId, events })))
      .not.toMatch(/population\.secret|individualRewards|collapsedMemberCount|7/);
  });

  it('applies frenzy combat modifiers through direct observation until deterministic expiry', () => {
    const groupDefinition = definition({ leaderDeathResponse: 'frenzy',
      responseParameters: { duration: 20, modifiers: { accuracy: 3, defense: 0, damage: 4 } } });
    const { state, content } = fixture({ groupDefinition,
      positions: [['monster.a', 1, 2], ['monster.b', 2, 2]] });
    const dead = { ...state, actors: state.actors.map((actor) => actor.actorId === 'monster.a'
      ? { ...actor, health: 0, energy: 0 } : actor) };
    const outcome = applyGroupLeaderOutcomes({ state: dead, content, eventId: 'event.frenzy' }).state;
    const runAt = (worldTime: number) => resolveWorldStep({
      state: { ...outcome, worldTime, rng: state.rng, actors: outcome.actors.map((actor) => ({
        ...actor, energy: actor.actorId === state.hero.actorId || actor.actorId === 'monster.b' ? 100 : 0,
      })) }, content, action: { type: 'wait', actorId: state.hero.actorId, cost: 100 },
      eventId: `event.frenzy.${worldTime}`, maxInternalActions: 1,
    });
    const activeAttack = runAt(39).events.find((event) => event.type === 'attack.hit' || event.type === 'attack.missed')!;
    const expiredAttack = runAt(40).events.find((event) => event.type === 'attack.hit' || event.type === 'attack.missed')!;
    expect(activeAttack.total - activeAttack.naturalRoll).toBe(4);
    expect(expiredAttack.total - expiredAttack.naturalRoll).toBe(1);
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
    if (response === 'frenzy') {
      expect(survivors.every((actor) => actor.behaviorState.investigation === null)).toBe(true);
      expect((first.state.populations[0] as GroupPopulation)).toMatchObject({ leaderResponseExpiresAt: 40 });
      const observed = { ...first.state, actors: first.state.actors.map((actor) => actor.actorId === 'monster.b'
        ? { ...actor, behaviorState: { ...actor.behaviorState, investigation: {
          floorId: actor.floorId, x: 1, y: 1, startedAt: 21, expiresAt: null,
        } } } : actor) };
      expect(groupCombatModifiers({ state: observed, content, actorId: 'monster.b' }))
        .toEqual(responseParameters.modifiers);
    }
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

  it('derives regroup intent from a formation goal before emitting or acting', () => {
    const { state, content } = fixture({ positions: [['monster.a', 4, 3], ['monster.b', 5, 3]] });
    const actors = state.actors.map((actor) => actor.actorId === 'monster.a' ? { ...actor, energy: 0 }
      : actor.actorId === 'monster.b' ? { ...actor, energy: 100 } : actor);
    const neutral = { ...state, actors, relationships: ['monster.a', 'monster.b'].map((actorId) => ({
      leftActorId: state.hero.actorId, rightActorId: actorId, relationship: 'neutral' as const,
    })) };
    const result = resolveWorldStep({ state: neutral, content,
      action: { type: 'wait', actorId: state.hero.actorId, cost: 100 },
      eventId: 'event.regroup', maxInternalActions: 1 });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'actor.intent-changed', actorId: 'monster.b', intent: 'regroup', presentation: 'intent.regroup',
    }));
    expect(result.state.actors.find((actor) => actor.actorId === 'monster.b')?.behaviorState)
      .toMatchObject({ intent: 'regroup', goal: { type: 'formation' } });
  });
});
