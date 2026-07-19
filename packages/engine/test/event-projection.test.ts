import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack, createDemoRun, projectDomainEvents, stableJson,
  type ActiveRun,
  type DomainEvent,
  type MerchantPopulation,
  type PopulationDomainEvent,
} from '../src/index.js';

function exhaustPopulationEvent(event: PopulationDomainEvent): string {
  switch (event.type) {
    case 'population.created': case 'population.encountered': case 'population.placement-skipped':
    case 'actor.intent-changed': case 'group.awareness-shared': case 'group.leader-created':
    case 'group.leader-defeated': case 'group.outcome-applied': case 'swarm.members-created':
    case 'swarm.cap-reached': case 'swarm.source-destroyed': case 'boss.encountered':
    case 'boss.phase-changed': case 'boss.recovered': case 'boss.defeated': case 'boss.reward-created':
    case 'champion.encountered': case 'champion.defeated': case 'champion.heirloom-created':
    case 'echo.encountered': case 'echo.defeated': case 'echo.loot-created': return event.type;
    default: { const exhaustive: never = event; return exhaustive; }
  }
}

function monsterDefinition(): MonsterContentEntry {
  return {
    kind: 'monster', id: 'monster.hidden', name: 'Hidden monster', glyph: 'm', color: '#aa4444', tags: [],
    minDepth: 1, maxDepth: 20, attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10, speed: 100, accuracy: 1, defense: 8, perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    runAppearanceChance: 1, rarity: 'common',
  };
}

function fixture() {
  const base = createDemoRun();
  const attacker = { ...base.actors[0]!, actorId: 'monster.hidden', contentId: 'monster.hidden',
    playerControlled: false, disposition: 'hostile' as const, x: 3, y: 1 };
  const floor = { ...base.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
  const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, monsterDefinition()] };
  const events: DomainEvent[] = [{
    type: 'attack.hit', eventId: 'command.wait', actorId: attacker.actorId, targetActorId: base.hero.actorId,
    naturalRoll: 20, total: 21, defense: 8, critical: true, rolledDice: 1, rolledDamage: 3,
    effectiveDamage: 3, damageType: 'physical',
  }, {
    type: 'actor.damaged', eventId: 'command.wait', actorId: base.hero.actorId,
    sourceActorId: attacker.actorId, amount: 3, health: 17,
  }];
  return { state: { ...base, floors: [floor], actors: [base.actors[0]!, attacker] }, content, events };
}

function merchantEventFixture(visible: boolean) {
  const base = createDemoRun();
  const merchant = { ...base.actors[0]!, actorId: 'actor.merchant', contentId: 'npc.test-merchant',
    playerControlled: false, disposition: 'neutral' as const, x: visible ? 2 : 5, y: visible ? 1 : 3,
    populationId: 'population.merchant', populationRoleId: null,
    populationPresentation: { name: 'Travelling Lampwright', glyph: 'L', color: '#ffd166', leader: false } };
  const population: MerchantPopulation = {
    populationId: 'population.merchant', encounterId: 'encounter.merchant', floorId: base.activeFloorId,
    createdAt: 0, livingMemberIds: [merchant.actorId], formerMemberIds: [], model: 'merchant',
    actorId: merchant.actorId, npcId: merchant.contentId, factionId: 'npc-faction.test',
    rolledLifetime: 4000, departureAt: 4000, emittedWarningThresholds: [1000, 500],
    initialStockItemIds: [], stockItemIds: [], services: [], lifecycle: 'available', provoked: false,
    aggressionPenaltyApplied: false, deathPenaltyApplied: false, stockLossResolved: false,
    commerceBonusApplied: false,
  };
  const state: ActiveRun = { ...base, actors: [base.actors[0]!, merchant], populations: [population],
    encounterDecisions: [{ encounterId: 'encounter.merchant', baseProbability: 1, protectionBonus: 0,
      effectiveProbability: 1, eligible: true, reachedEligibleDepth: true, encountered: true, instancesCreated: 1 }] };
  const eventId = 'event.merchant';
  const events: DomainEvent[] = [
    { type: 'merchant.departure-warning', eventId, populationId: population.populationId,
      actorId: merchant.actorId, threshold: 500, remaining: 137 },
    { type: 'merchant.provoked', eventId, populationId: population.populationId,
      actorId: merchant.actorId, sourceActorId: base.hero.actorId, response: 'flee' },
    { type: 'merchant.stock-dropped', eventId, populationId: population.populationId,
      actorId: merchant.actorId, itemIds: ['item.drop-secret'], units: 3 },
    { type: 'merchant.died', eventId, populationId: population.populationId,
      actorId: merchant.actorId, killerActorId: base.hero.actorId, destroyedStockItemIds: ['item.destroyed-secret'] },
  ];
  return { state, content: createDemoContentPack(), events };
}

describe('public event projection', () => {
  it('redacts an unseen attacker while preserving an audible direction', () => {
    const input = fixture();
    expect(projectDomainEvents({ ...input, heroId: input.state.hero.actorId })).toEqual([
      { type: 'sound.heard', category: 'combat', direction: 'east', distanceBand: 'near' },
      { type: 'hero.damaged', amount: 3, damageType: 'physical' },
    ]);
  });

  it('does not expose hidden identifiers, coordinates, or rolls', () => {
    const input = fixture();
    const json = stableJson(projectDomainEvents({ ...input, heroId: input.state.hero.actorId }));
    expect(json).not.toContain('monster.hidden');
    expect(json).not.toContain('naturalRoll');
    expect(json).not.toContain('rolledDamage');
    expect(json).not.toContain('"x"');
  });

  it('describes unseen movement with eight-way direction and coarse distance only', () => {
    const input = fixture();
    const events: DomainEvent[] = [{ type: 'actor.moved', eventId: 'command.wait', actorId: 'monster.hidden',
      from: { x: 2, y: 2 }, to: { x: 3, y: 2 } }];
    expect(projectDomainEvents({ ...input, events, heroId: input.state.hero.actorId })).toEqual([
      { type: 'sound.heard', category: 'movement', direction: 'southeast', distanceBand: 'near' },
    ]);
  });

  it('projects broad intent only for a currently visible actor', () => {
    const input = fixture();
    const event: DomainEvent = { type: 'actor.intent-changed', eventId: 'event.intent', actorId: 'monster.hidden',
      intent: 'approach', presentation: 'intent.approach', targetCategory: 'hero' };
    expect(projectDomainEvents({ ...input, events: [event], heroId: input.state.hero.actorId })).toEqual([]);
    const visible = { ...input, state: { ...input.state, floors: [{ ...input.state.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] } };
    expect(projectDomainEvents({ ...visible, events: [event], heroId: visible.state.hero.actorId })).toEqual([event]);
  });

  it('redacts every population lifecycle event to observable qualitative presentation', () => {
    const input = fixture();
    const visible = { ...input, state: { ...input.state, floors: [{ ...input.state.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] } };
    const actorId = 'monster.hidden';
    const eventId = 'event.population';
    const events: DomainEvent[] = [
      { type: 'population.created', eventId, populationId: 'population.secret', encounterId: 'encounter.secret',
        floorId: visible.state.activeFloorId, model: 'group', actorIds: [actorId, 'actor.unseen'] },
      { type: 'population.encountered', eventId, populationId: 'population.secret', encounterId: 'encounter.secret', actorId },
      { type: 'population.placement-skipped', eventId, encounterId: 'encounter.unseen',
        floorId: visible.state.activeFloorId, reason: 'no-valid-placement' },
      { type: 'group.awareness-shared', eventId, populationId: 'population.secret', actorId,
        targetActorId: visible.state.hero.actorId, floorId: visible.state.activeFloorId, x: 9, y: 9,
        observedAt: 99, observerActorId: 'actor.observer-secret' },
      { type: 'group.leader-created', eventId, populationId: 'population.secret', actorId, roleId: 'role.secret' },
      { type: 'group.leader-defeated', eventId, populationId: 'population.secret', actorId },
      { type: 'group.outcome-applied', eventId, populationId: 'population.secret', actorId,
        response: 'panic', individualRewards: false, collapsedMemberCount: 7 },
      { type: 'swarm.members-created', eventId, populationId: 'population.secret', sourceActorId: actorId,
        actorIds: ['actor.future-secret'], quantity: 4 },
      { type: 'swarm.cap-reached', eventId, populationId: 'population.secret', sourceActorId: actorId, level: 'floor' },
      { type: 'swarm.source-destroyed', eventId, populationId: 'population.secret', sourceActorId: actorId, response: 'decay' },
      { type: 'boss.encountered', eventId, populationId: 'population.secret', actorId, encounterId: 'encounter.secret' },
      { type: 'boss.phase-changed', eventId, populationId: 'population.secret', actorId,
        encounterId: 'encounter.secret', phaseId: 'enraged' },
      { type: 'boss.recovered', eventId, populationId: 'population.secret', actorId,
        encounterId: 'encounter.secret', amount: 22, health: 88 },
      { type: 'boss.defeated', eventId, populationId: 'population.secret', actorId, encounterId: 'encounter.secret' },
      { type: 'boss.reward-created', eventId, populationId: 'population.secret', actorId,
        encounterId: 'encounter.secret', uniqueItemId: 'item.unopened-secret', itemIds: ['item.roll-secret'] },
      { type: 'champion.encountered', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 1 },
      { type: 'champion.defeated', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 1 },
      { type: 'champion.heirloom-created', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 1, itemId: 'item.secret', contentId: 'item.content-secret',
        originatingHallRecordId: 'hall.secret', displayName: 'Observed heirloom', glyph: ')', color: '#ffffff', fallback: false },
      { type: 'echo.encountered', eventId, populationId: 'population.secret', actorId, hallRecordId: 'hall.secret', rank: 2 },
      { type: 'echo.defeated', eventId, populationId: 'population.secret', actorId, hallRecordId: 'hall.secret', rank: 2 },
      { type: 'echo.loot-created', eventId, populationId: 'population.secret', actorId,
        hallRecordId: 'hall.secret', rank: 2, itemIds: ['item.echo-secret'] },
    ];
    const output = projectDomainEvents({ ...visible, events, heroId: visible.state.hero.actorId });
    expect(events.map(exhaustPopulationEvent)).toHaveLength(21);
    expect(output.map((event) => event.type)).toEqual(Array(19).fill('population.notice'));
    const json = stableJson(output);
    for (const secret of ['population.secret', 'encounter.secret', 'actor.unseen', 'actor.future-secret',
      'observerActorId', 'observedAt', 'collapsedMemberCount', 'individualRewards', 'uniqueItemId',
      'item.roll-secret', 'hall.secret', 'amount', 'health']) expect(json).not.toContain(secret);
    expect(json).toContain('Observed heirloom');
  });

  it('never publishes combat rolls even when both participants are visible', () => {
    const input = fixture();
    const visible = { ...input, state: { ...input.state, floors: [{ ...input.state.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] } };
    const output = projectDomainEvents({ ...visible, events: [visible.events[0]!], heroId: visible.state.hero.actorId });
    expect(output).toEqual([{ type: 'combat.observed', eventId: 'command.wait', outcome: 'hit',
      attackerActorId: 'monster.hidden', targetActorId: visible.state.hero.actorId, attackerName: 'Hidden monster' }]);
    expect(stableJson(output)).not.toMatch(/naturalRoll|rolledDice|rolledDamage|defense/);
  });

  it('uses both prior and next observation without revealing the hidden endpoint', () => {
    const input = fixture();
    const state = { ...input.state, hero: { ...input.state.hero, sightRadius: 1 },
      floors: [{ ...input.state.floors[0]!, ambient: { color: [255, 255, 255] as const, strength: 255 } }] };
    const events: DomainEvent[] = [{ type: 'actor.moved', eventId: 'event.leave', actorId: 'monster.hidden',
      from: { x: 2, y: 1 }, to: { x: 3, y: 1 } }];
    expect(projectDomainEvents({ state, content: input.content, events, heroId: state.hero.actorId })).toEqual([{
      type: 'actor.movement-observed', eventId: 'event.leave', actorId: 'monster.hidden',
      direction: 'east', visibility: 'left',
    }]);
  });

  it('redacts hidden damage and death sources while retaining a visible victim transition', () => {
    const input = fixture();
    const victim = { ...input.state.actors[1]!, actorId: 'monster.victim', x: 2, y: 1 };
    const attacker = { ...input.state.actors[1]!, actorId: 'monster.hidden', x: 5, y: 3 };
    const state = { ...input.state, hero: { ...input.state.hero, sightRadius: 2 },
      floors: [{ ...input.state.floors[0]!, ambient: { color: [255, 255, 255] as const, strength: 255 } }],
      actors: [input.state.actors[0]!, victim, attacker] };
    const events: DomainEvent[] = [
      { type: 'actor.damaged', eventId: 'event.damage', actorId: victim.actorId,
        sourceActorId: attacker.actorId, amount: 4, health: 6 },
      { type: 'actor.died', eventId: 'event.death', actorId: victim.actorId,
        contentId: victim.contentId, killerActorId: attacker.actorId },
    ];
    expect(projectDomainEvents({ state, content: input.content, events, heroId: state.hero.actorId })).toEqual([
      { type: 'actor.damage-observed', eventId: 'event.damage', actorId: victim.actorId, amount: 4, health: 6 },
      { type: 'actor.death-observed', eventId: 'event.death', actorId: victim.actorId,
        contentId: victim.contentId, displayName: 'Hidden monster' },
    ]);
  });

  it('suppresses hidden victim transitions even when the source is visible, and suppresses both hidden', () => {
    const input = fixture();
    const hiddenVictim = { ...input.state.actors[1]!, actorId: 'monster.victim', x: 5, y: 3 };
    const hiddenKiller = { ...hiddenVictim, actorId: 'monster.killer', x: 5, y: 2 };
    const state = { ...input.state, hero: { ...input.state.hero, sightRadius: 2 },
      floors: [{ ...input.state.floors[0]!, ambient: { color: [255, 255, 255] as const, strength: 255 } }],
      actors: [input.state.actors[0]!, hiddenVictim, hiddenKiller] };
    const heroKill: DomainEvent = { type: 'actor.died', eventId: 'event.hero-kill', actorId: hiddenVictim.actorId,
      contentId: hiddenVictim.contentId, killerActorId: state.hero.actorId };
    const hiddenKill: DomainEvent = { ...heroKill, eventId: 'event.hidden-kill', killerActorId: hiddenKiller.actorId };
    expect(projectDomainEvents({ state, content: input.content, events: [heroKill, hiddenKill],
      heroId: state.hero.actorId })).toEqual([]);
  });

  it('keeps a hero death observable without publishing the hidden killer', () => {
    const input = fixture();
    const hero = input.state.actors[0]!;
    const event: DomainEvent = { type: 'actor.died', eventId: 'event.hero-death', actorId: hero.actorId,
      contentId: hero.contentId, killerActorId: 'monster.hidden' };
    expect(projectDomainEvents({ ...input, events: [event], heroId: input.state.hero.actorId })).toEqual([{
      type: 'actor.death-observed', eventId: event.eventId, actorId: hero.actorId, contentId: hero.contentId,
    }]);
  });

  it('suppresses an off-screen monster\'s loot.dropped while projecting a visible one', () => {
    const input = fixture();
    const droppedItemDefinition = { kind: 'item' as const, id: 'item.dropped-loot-content', name: 'Dropped loot',
      tags: [], glyph: '*', color: '#ffaa00', category: 'misc' as const, stackLimit: 10, price: 1,
      rarity: 'common' as const, minDepth: 1, maxDepth: 20, actionCost: 100, equipment: null, combat: null,
      light: null, identification: { mode: 'known' as const, poolId: null }, effects: [] };
    const content = { ...input.content, entries: [...input.content.entries, droppedItemDefinition] };
    const droppedItem = { itemId: 'item.dropped-loot', contentId: droppedItemDefinition.id, quantity: 1, condition: 100,
      enchantment: null, identified: true, charges: null, fuel: null, enabled: false,
      location: { type: 'floor' as const, floorId: input.state.activeFloorId, x: 3, y: 1 } };
    const stateWithItem = { ...input.state, items: [droppedItem] };
    const event: DomainEvent = { type: 'loot.dropped', eventId: 'event.loot', actorId: 'monster.hidden',
      contentId: 'monster.hidden', x: 3, y: 1, itemIds: [droppedItem.itemId] };
    expect(projectDomainEvents({ state: stateWithItem, content, events: [event],
      heroId: stateWithItem.hero.actorId })).toEqual([]);
    const visible = { ...stateWithItem, floors: [{ ...stateWithItem.floors[0]!,
      ambient: { color: [255, 255, 255] as const, strength: 255 } }] };
    expect(projectDomainEvents({ state: visible, content, events: [event],
      heroId: visible.hero.actorId })).toEqual([event]);
  });

  it('redacts visible merchant lifecycle events to qualitative notices', () => {
    const input = merchantEventFixture(true);
    const output = projectDomainEvents({ ...input, heroId: input.state.hero.actorId });
    expect(output).toEqual([
      { type: 'population.notice', eventId: 'event.merchant', category: 'merchant-departure-warning',
        actorId: 'actor.merchant', presentation: 'merchant.departure-warning.500', displayName: 'Travelling Lampwright' },
      { type: 'population.notice', eventId: 'event.merchant', category: 'merchant-provoked',
        actorId: 'actor.merchant', presentation: 'merchant.provoked.flee', displayName: 'Travelling Lampwright' },
      { type: 'population.notice', eventId: 'event.merchant', category: 'merchant-stock-dropped',
        actorId: 'actor.merchant', presentation: 'merchant.stock-dropped', displayName: 'Travelling Lampwright' },
      { type: 'population.notice', eventId: 'event.merchant', category: 'merchant-died',
        actorId: 'actor.merchant', presentation: 'merchant.died', displayName: 'Travelling Lampwright' },
    ]);
    const json = stableJson(output);
    for (const secret of ['remaining', '137', 'item.drop-secret', 'item.destroyed-secret',
      'stockItemIds', 'killerActorId', 'units']) expect(json, secret).not.toContain(secret);
  });

  it('suppresses merchant lifecycle events for unseen merchants entirely', () => {
    const input = merchantEventFixture(false);
    expect(projectDomainEvents({ ...input, heroId: input.state.hero.actorId })).toEqual([]);
  });

  it('notices an encountered same-floor departure without stock, and suppresses off-floor departures', () => {
    const departed: DomainEvent = { type: 'merchant.departed', eventId: 'event.merchant',
      populationId: 'population.merchant', actorId: 'actor.merchant', stockItemIds: ['item.unsold-secret'] };
    const base = merchantEventFixture(true);
    const gone = {
      ...base,
      state: { ...base.state, actors: base.state.actors.filter((actor) => actor.actorId !== 'actor.merchant') },
      events: [departed],
    };
    expect(projectDomainEvents({ ...gone, heroId: gone.state.hero.actorId })).toEqual([
      { type: 'population.notice', eventId: 'event.merchant', category: 'merchant-departed',
        actorId: null, presentation: 'merchant.departed' },
    ]);
    const offFloor = {
      ...gone,
      state: { ...gone.state, populations: gone.state.populations.map((population) =>
        ({ ...population, floorId: 'floor.elsewhere' })) } as ActiveRun,
    };
    expect(projectDomainEvents({ ...offFloor, heroId: offFloor.state.hero.actorId })).toEqual([]);
    const unencountered = {
      ...gone,
      state: { ...gone.state, encounterDecisions: gone.state.encounterDecisions.map((decision) =>
        ({ ...decision, encountered: false })) },
    };
    expect(projectDomainEvents({ ...unencountered, heroId: unencountered.state.hero.actorId })).toEqual([]);
  });

  it('always delivers the hero its own trade close and reputation change, even unseen', () => {
    const input = merchantEventFixture(false);
    const events: DomainEvent[] = [
      { type: 'trade.closed', eventId: 'event.merchant', merchantPopulationId: 'population.merchant',
        reason: 'departure', completedCommerce: false },
      { type: 'reputation.changed', eventId: 'event.merchant', factionId: 'npc-faction.test',
        previous: 0, delta: -300, value: -300, reason: 'aggression' },
    ];
    expect(projectDomainEvents({ ...input, events, heroId: input.state.hero.actorId })).toEqual(events);
  });

  it('delivers run-record events to the controlling hero unchanged', () => {
    const input = fixture();
    const events: DomainEvent[] = [
      { type: 'run.concluded', eventId: 'event.conclude', completionType: 'died',
        cause: { killerContentId: null, depth: 4, turn: 120, worldTime: 12_000 } },
      { type: 'run.finalized', eventId: 'event.finalize', recordId: 'record.test', completionType: 'died', scoreTotal: 900 },
      { type: 'achievement.granted', eventId: 'event.finalize', achievementId: 'achievement.test',
        criteriaId: 'first-champion-defeat', name: 'Test achievement' },
    ];
    expect(projectDomainEvents({ ...input, events, heroId: input.state.hero.actorId })).toEqual(events);
  });

  it('redacts partial forced movement and rejects unchecked thrown destinations and hidden feature/item IDs', () => {
    const input = fixture();
    const state = { ...input.state, hero: { ...input.state.hero, sightRadius: 1 },
      floors: [{ ...input.state.floors[0]!, ambient: { color: [255, 255, 255] as const, strength: 255 } }] };
    const events: DomainEvent[] = [
      { type: 'actor.forced-move', eventId: 'event.force', actorId: 'monster.hidden',
        from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
      { type: 'item.thrown', eventId: 'event.throw', actorId: state.hero.actorId,
        itemId: 'item.hidden', quantity: 1, to: { x: 5, y: 3 } },
      { type: 'door.opened', eventId: 'event.door', actorId: 'monster.hidden', featureId: 'feature.hidden' },
      { type: 'item.damaged', eventId: 'event.item', actorId: 'monster.hidden',
        itemId: 'item.hidden', amount: 1, condition: 9 },
    ];
    const output = projectDomainEvents({ state, content: input.content, events, heroId: state.hero.actorId });
    expect(output).toEqual([{ type: 'actor.movement-observed', eventId: 'event.force', actorId: 'monster.hidden',
      direction: 'east', visibility: 'left' }]);
    const json = stableJson(output);
    expect(json).not.toMatch(/item\.hidden|feature\.hidden|"from"|"to"/);
  });
});
