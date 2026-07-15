import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  emptyRunMetrics,
  foldRunMetrics,
  recordFloorEntered,
  type ActiveRun,
  type ActorState,
  type BossPopulation,
  type ChampionPopulation,
  type DomainEvent,
  type GroupPopulation,
  type IndividualPopulation,
  type RunMetrics,
  type SwarmPopulation,
} from '../src/index.js';

const HERO = 'hero.demo';

function monster(id: string, threat: number): MonsterContentEntry {
  return {
    kind: 'monster', id, name: id, glyph: 'm', color: '#aa4444', tags: [],
    minDepth: 1, maxDepth: 20,
    attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10, speed: 100, accuracy: 100, defense: 8, perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    rarity: 'common', threat,
  };
}

function content(): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      monster('monster.individual-foe', 3),
      monster('monster.group-member', 2),
      monster('monster.swarm-member', 1),
      monster('monster.boss-actor', 10),
    ],
  };
}

const ACTOR_FIXTURES: Readonly<Record<string, Readonly<{ contentId: string; populationId: string | null }>>> = {
  'actor.individual-member': { contentId: 'monster.individual-foe', populationId: 'population.individual-1' },
  'actor.group-member': { contentId: 'monster.group-member', populationId: 'population.group-1' },
  'actor.swarm-member': { contentId: 'monster.swarm-member', populationId: 'population.swarm-1' },
  'actor.boss-actor': { contentId: 'monster.boss-actor', populationId: 'population.boss-1' },
  'actor.champion-actor': { contentId: 'monster.individual-foe', populationId: 'population.champion-1' },
  'actor.no-population': { contentId: 'monster.individual-foe', populationId: null },
  'actor.no-monster-def': { contentId: 'npc.wanderer', populationId: null },
};

function actorState(actorId: string): ActorState {
  const hero = createDemoRun().actors[0]!;
  const fixture = ACTOR_FIXTURES[actorId];
  if (!fixture) throw new Error(`unknown fixture actor ${actorId}`);
  return {
    ...hero, actorId, contentId: fixture.contentId, playerControlled: false,
    disposition: 'hostile', health: 0, populationId: fixture.populationId,
    populationRoleId: null, populationPresentation: null,
  };
}

function fixtureState(): ActiveRun {
  const base = createDemoRun();
  const actors = Object.keys(ACTOR_FIXTURES).map((actorId) => actorState(actorId));
  const individual: IndividualPopulation = {
    model: 'individual', populationId: 'population.individual-1', encounterId: 'encounter.individual',
    floorId: base.activeFloorId, createdAt: 0, livingMemberIds: [], formerMemberIds: ['actor.individual-member'],
  };
  const group: GroupPopulation = {
    model: 'group', populationId: 'population.group-1', encounterId: 'encounter.group',
    floorId: base.activeFloorId, createdAt: 0, livingMemberIds: [], formerMemberIds: ['actor.group-member'],
    leaderActorId: null, bonusActive: false, roleMembership: [], sharedKnowledge: [],
    leaderResponseApplied: false, leaderResponseExpiresAt: null,
  };
  const swarm: SwarmPopulation = {
    model: 'swarm', populationId: 'population.swarm-1', encounterId: 'encounter.swarm',
    floorId: base.activeFloorId, createdAt: 0, livingMemberIds: [], formerMemberIds: ['actor.swarm-member'],
    sourceActorId: 'actor.swarm-member', nextSpawnAt: 0, spawnedCount: 0, peakLivingSize: 1,
    shutdownState: null, emittedCapLevels: [], shutdownExpiresAt: null,
  };
  const boss: BossPopulation = {
    model: 'boss', populationId: 'population.boss-1', encounterId: 'encounter.boss',
    floorId: base.activeFloorId, createdAt: 0, livingMemberIds: [], formerMemberIds: ['actor.boss-actor'],
    actorId: 'actor.boss-actor', currentPhaseId: null, crossedPhaseIds: [], lastFloorExitAt: null,
    rewardCreated: false, rewardReceipt: null, recoveryHistory: [],
  };
  const champion: ChampionPopulation = {
    model: 'champion', populationId: 'population.champion-1', encounterId: 'encounter.champion',
    floorId: base.activeFloorId, createdAt: 0, livingMemberIds: [], formerMemberIds: ['actor.champion-actor'],
    actorId: 'actor.champion-actor', hallRecordId: 'hall.champion-1', rank: 1, defeated: true,
    rewardCreated: false, equipmentContentIds: [], abilityIds: [],
  };
  return {
    ...base, actors: [...base.actors, ...actors],
    populations: [individual, group, swarm, boss, champion],
  };
}

function diedEvent(input: Readonly<{ actorId: string; killerActorId: string }>): DomainEvent {
  const fixture = ACTOR_FIXTURES[input.actorId];
  if (!fixture) throw new Error(`unknown fixture actor ${input.actorId}`);
  return {
    type: 'actor.died', eventId: `event.${input.actorId}.died`,
    actorId: input.actorId, contentId: fixture.contentId, killerActorId: input.killerActorId,
  };
}

function fold(events: readonly DomainEvent[], metrics: RunMetrics = emptyRunMetrics(),
  turnAdvanced = false): RunMetrics {
  return foldRunMetrics({ metrics, state: fixtureState(), content: content(), events, turnAdvanced });
}

describe('foldRunMetrics', () => {
  it('credits a hero kill, its model bucket, authored threat, and the turn counter together', () => {
    const folded = foldRunMetrics({
      metrics: emptyRunMetrics(), state: fixtureState(), content: content(),
      events: [diedEvent({ actorId: 'actor.group-member', killerActorId: HERO })],
      turnAdvanced: true,
    });
    expect(folded.kills).toBe(1);
    expect(folded.killsByModel.group).toBe(1);
    expect(folded.killsByModel.individual).toBe(0);
    expect(folded.killsByModel.swarm).toBe(0);
    expect(folded.killsByModel.boss).toBe(0);
    expect(folded.threatDefeated).toBe(2);
    expect(folded.turnsElapsed).toBe(1);
  });

  it.each([
    ['actor.individual-member', 'individual', 3],
    ['actor.swarm-member', 'swarm', 1],
    ['actor.boss-actor', 'boss', 10],
  ] as const)('credits %s to the %s bucket', (actorId, model, threat) => {
    const folded = fold([diedEvent({ actorId, killerActorId: HERO })]);
    expect(folded.kills).toBe(1);
    expect(folded.killsByModel[model]).toBe(1);
    expect(folded.threatDefeated).toBe(threat);
  });

  it('leaves every counter unchanged for a non-hero kill', () => {
    const folded = fold([diedEvent({ actorId: 'actor.group-member', killerActorId: 'actor.individual-member' })]);
    expect(folded).toEqual(emptyRunMetrics());
  });

  it('counts a hero kill without population membership but does not bump a model bucket', () => {
    const folded = fold([diedEvent({ actorId: 'actor.no-population', killerActorId: HERO })]);
    expect(folded.kills).toBe(1);
    expect(folded.threatDefeated).toBe(3);
    expect(folded.killsByModel).toEqual(emptyRunMetrics().killsByModel);
  });

  it('contributes zero threat for actors without an authored monster definition', () => {
    const folded = fold([diedEvent({ actorId: 'actor.no-monster-def', killerActorId: HERO })]);
    expect(folded.kills).toBe(1);
    expect(folded.threatDefeated).toBe(0);
  });

  it('does not bump a model bucket for a champion population, which is outside the four tracked models', () => {
    const folded = fold([diedEvent({ actorId: 'actor.champion-actor', killerActorId: HERO })]);
    expect(folded.kills).toBe(1);
    expect(folded.killsByModel).toEqual(emptyRunMetrics().killsByModel);
  });

  it.each([
    ['boss.defeated', 'bossKills'],
    ['champion.defeated', 'championKills'],
    ['echo.defeated', 'echoKills'],
  ] as const)('credits %s to %s', (type, field) => {
    const event = { type, eventId: 'event.defeat', populationId: 'population.boss-1',
      actorId: 'actor.boss-actor', encounterId: 'encounter.boss', hallRecordId: 'hall.1', rank: 1 } as DomainEvent;
    const folded = fold([event]);
    expect(folded[field]).toBe(1);
  });

  it('credits damage dealt by the hero to a non-hero target', () => {
    const folded = fold([{ type: 'actor.damaged', eventId: 'event.damage', actorId: 'actor.group-member',
      sourceActorId: HERO, amount: 4, health: 6 }]);
    expect(folded.damageDealt).toBe(4);
    expect(folded.damageTaken).toBe(0);
  });

  it('credits damage taken by the hero regardless of source', () => {
    const folded = fold([{ type: 'actor.damaged', eventId: 'event.damage', actorId: HERO,
      sourceActorId: 'actor.group-member', amount: 5, health: 15 }]);
    expect(folded.damageTaken).toBe(5);
    expect(folded.damageDealt).toBe(0);
  });

  it('excludes hero self-damage from damageDealt but still credits damageTaken', () => {
    const folded = fold([{ type: 'actor.damaged', eventId: 'event.damage', actorId: HERO,
      sourceActorId: HERO, amount: 2, health: 18 }]);
    expect(folded.damageDealt).toBe(0);
    expect(folded.damageTaken).toBe(2);
  });

  it('sums hero item.picked-up quantities into itemsCollected', () => {
    const folded = fold([
      { type: 'item.picked-up', eventId: 'event.pickup.1', actorId: HERO, itemId: 'item.a', quantity: 2 },
      { type: 'item.picked-up', eventId: 'event.pickup.2', actorId: HERO, itemId: 'item.b', quantity: 3 },
    ]);
    expect(folded.itemsCollected).toBe(5);
  });

  it('does not credit item.picked-up for a non-hero actor', () => {
    const folded = fold([{ type: 'item.picked-up', eventId: 'event.pickup', actorId: 'actor.group-member',
      itemId: 'item.a', quantity: 2 }]);
    expect(folded.itemsCollected).toBe(0);
  });

  it('credits trade.bought quantities to itemsCollected and totals to currencySpent', () => {
    const folded = fold([{ type: 'trade.bought', eventId: 'event.buy', merchantPopulationId: 'population.merchant-1',
      itemId: 'item.a', contentId: 'item.a', quantity: 3, unitPrice: 10, total: 30, currency: 70 }]);
    expect(folded.itemsCollected).toBe(3);
    expect(folded.currencySpent).toBe(30);
  });

  it('credits item.identified count to itemsIdentified', () => {
    const folded = fold([
      { type: 'item.identified', eventId: 'event.id.1', itemId: 'item.a' },
      { type: 'item.identified', eventId: 'event.id.2', itemId: 'item.b' },
    ]);
    expect(folded.itemsIdentified).toBe(2);
  });

  it('credits trade.sold totals to currencyEarned', () => {
    const folded = fold([{ type: 'trade.sold', eventId: 'event.sell', merchantPopulationId: 'population.merchant-1',
      itemId: 'item.a', contentId: 'item.a', quantity: 1, unitPrice: 12, total: 12, currency: 52 }]);
    expect(folded.currencyEarned).toBe(12);
  });

  it('credits trade.service-purchased prices to currencySpent', () => {
    const folded = fold([{ type: 'trade.service-purchased', eventId: 'event.service',
      merchantPopulationId: 'population.merchant-1', serviceId: 'merchant-service.identify',
      targetItemId: 'item.a', price: 8, currency: 32, remainingUses: 2 }]);
    expect(folded.currencySpent).toBe(8);
  });

  it('credits tradesCompleted only when trade.closed completed commerce', () => {
    const completed = fold([{ type: 'trade.closed', eventId: 'event.close', merchantPopulationId: 'population.merchant-1',
      reason: 'player', completedCommerce: true }]);
    expect(completed.tradesCompleted).toBe(1);
    const uncompleted = fold([{ type: 'trade.closed', eventId: 'event.close', merchantPopulationId: 'population.merchant-1',
      reason: 'player', completedCommerce: false }]);
    expect(uncompleted.tradesCompleted).toBe(0);
  });

  it('credits hero feature.revealed to discoveriesRevealed', () => {
    const folded = fold([{ type: 'feature.revealed', eventId: 'event.reveal', actorId: HERO, featureId: 'feature.a' }]);
    expect(folded.discoveriesRevealed).toBe(1);
  });

  it('does not credit feature.revealed for a non-hero actor', () => {
    const folded = fold([{ type: 'feature.revealed', eventId: 'event.reveal', actorId: 'actor.group-member',
      featureId: 'feature.a' }]);
    expect(folded.discoveriesRevealed).toBe(0);
  });

  it('credits rest.completed to restsCompleted', () => {
    const folded = fold([{ type: 'rest.completed', eventId: 'event.rest', stopReason: 'full-health',
      elapsed: 500, effectiveHealing: 5 }]);
    expect(folded.restsCompleted).toBe(1);
  });

  it('advances turnsElapsed only when the caller reports a turn advance', () => {
    expect(fold([], emptyRunMetrics(), true).turnsElapsed).toBe(1);
    expect(fold([], emptyRunMetrics(), false).turnsElapsed).toBe(0);
  });

  it('throws when a counter would exceed safe integer arithmetic', () => {
    const saturated = { ...emptyRunMetrics(), kills: Number.MAX_SAFE_INTEGER };
    expect(() => fold([diedEvent({ actorId: 'actor.group-member', killerActorId: HERO })], saturated))
      .toThrow(/safe integer/i);
  });

  it('never decreases a counter across a mixed batch of events', () => {
    const seed: RunMetrics = { ...emptyRunMetrics(), kills: 4, damageDealt: 20, currencySpent: 15 };
    const folded = fold([
      diedEvent({ actorId: 'actor.group-member', killerActorId: HERO }),
      { type: 'actor.damaged', eventId: 'event.damage', actorId: 'actor.group-member', sourceActorId: HERO, amount: 3, health: 3 },
      { type: 'trade.bought', eventId: 'event.buy', merchantPopulationId: 'population.merchant-1',
        itemId: 'item.a', contentId: 'item.a', quantity: 1, unitPrice: 5, total: 5, currency: 10 },
    ], seed, true);
    for (const key of Object.keys(seed) as (keyof RunMetrics)[]) {
      if (key === 'killsByModel') continue;
      expect(folded[key] as number).toBeGreaterThanOrEqual(seed[key] as number);
    }
  });
});

describe('recordFloorEntered', () => {
  it('increments floorsEntered and raises deepestDepth to the maximum reached', () => {
    const run = fixtureState();
    const first = recordFloorEntered(run, 3);
    expect(first.metrics.floorsEntered).toBe(1);
    expect(first.metrics.deepestDepth).toBe(3);
    const second = recordFloorEntered(first, 2);
    expect(second.metrics.floorsEntered).toBe(2);
    expect(second.metrics.deepestDepth).toBe(3);
    const third = recordFloorEntered(second, 5);
    expect(third.metrics.floorsEntered).toBe(3);
    expect(third.metrics.deepestDepth).toBe(5);
  });

  it('rejects a negative depth', () => {
    expect(() => recordFloorEntered(fixtureState(), -1)).toThrow(RangeError);
  });

  it('rejects an unsafe depth', () => {
    expect(() => recordFloorEntered(fixtureState(), Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});
