import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory, type CompiledContentPack, type NpcFactionContentEntry,
} from '@woven-deep/content/compiler';
import {
  createGameplayDemoRun, emptyActorBehaviorState, emptyEquipment, mergeLastKnownTargets,
  resolveCommand, soundTargetObservation, tileDefinition, tileIndex, updateActorMemory,
  validateContentBoundRun, visibleTargetObservations, type ActiveRun, type GameCommand,
} from '../src/index.js';

describe('population perception and saved memory', () => {
  it('records only directly visible, illuminated targets', () => {
    const observations = visibleTargetObservations({
      observerActorId: 'monster.watcher', floorId: 'floor.one', width: 3,
      visibilityWords: [0b111], illuminationIntensity: [1, 0, 1], observedAt: 10,
      actors: [
        { actorId: 'hero.visible', x: 2, y: 0 },
        { actorId: 'monster.dark', x: 1, y: 0 },
        { actorId: 'monster.watcher', x: 0, y: 0 },
      ],
    });
    expect(observations).toEqual([{
      targetActorId: 'hero.visible', floorId: 'floor.one', x: 2, y: 0, observedAt: 10,
      source: 'sight', observerActorId: 'monster.watcher',
    }]);
  });

  it('records perceivable sound and investigates its last known cell', () => {
    const observation = soundTargetObservation({
      observerActorId: 'monster.listener', targetActorId: 'hero.one', floorId: 'floor.one',
      x: 4, y: 2, observedAt: 20,
    });
    const state = updateActorMemory({ state: emptyActorBehaviorState(), observations: [observation], investigationDuration: 100 });
    expect(state.lastKnownTargets).toEqual([observation]);
    expect(state.investigation).toEqual({ floorId: 'floor.one', x: 4, y: 2, startedAt: 20, expiresAt: 120 });
  });

  it('keeps newest observations and resolves equal-time conflicts by observer ID', () => {
    const base = { targetActorId: 'hero.one', floorId: 'floor.one', source: 'group' as const };
    const memories = mergeLastKnownTargets([], [
      { ...base, x: 3, y: 3, observedAt: 10, observerActorId: 'monster.z' },
      { ...base, x: 2, y: 2, observedAt: 11, observerActorId: 'monster.z' },
      { ...base, x: 1, y: 1, observedAt: 11, observerActorId: 'monster.a' },
    ]);
    expect(memories).toEqual([{ ...base, x: 1, y: 1, observedAt: 11, observerActorId: 'monster.a' }]);
  });

  it('does not track a target that later moves unseen', () => {
    const seen = soundTargetObservation({ observerActorId: 'monster.one', targetActorId: 'hero.one',
      floorId: 'floor.one', x: 2, y: 2, observedAt: 5 });
    const first = updateActorMemory({ state: emptyActorBehaviorState(), observations: [seen], investigationDuration: null });
    const later = updateActorMemory({ state: first, observations: [], investigationDuration: null });
    expect(later).toEqual(first);
    expect(later.lastKnownTargets[0]).toMatchObject({ x: 2, y: 2, observedAt: 5 });
  });
});

describe('merchant observation materializes faction reputation', () => {
  let content: CompiledContentPack;
  let faction: NpcFactionContentEntry;

  beforeAll(async () => {
    content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    faction = content.entries.find((entry): entry is NpcFactionContentEntry => entry.kind === 'npc-faction')!;
  });

  function merchantObservationRun(): ActiveRun {
    const base = createGameplayDemoRun(content).run;
    const heroActor = base.actors.find((actor) => actor.actorId === base.hero.actorId)!;
    const floor = base.floors.find((candidate) => candidate.floorId === heroActor.floorId)!;
    const occupied = new Set([
      ...base.actors.filter((actor) => actor.floorId === floor.floorId).map((actor) => `${actor.x}:${actor.y}`),
      ...base.features.filter((feature) => feature.floorId === floor.floorId)
        .map((feature) => `${feature.x}:${feature.y}`),
    ]);
    let position: Readonly<{ x: number; y: number }> | undefined;
    for (const dy of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        const x = heroActor.x + dx;
        const y = heroActor.y + dy;
        const index = tileIndex(floor, x, y);
        if (index !== undefined && tileDefinition(floor.tiles[index]!).walkable && !occupied.has(`${x}:${y}`)) {
          position = { x, y };
        }
      }
    }
    expect(position).toBeDefined();
    const merchantActor = {
      ...heroActor, actorId: 'actor.merchant.observed', contentId: 'npc.travelling-lampwright',
      playerControlled: false, ...position!, disposition: 'neutral' as const, behaviorId: null,
      awareActorIds: [], conditions: [], equipment: emptyEquipment(),
      populationId: 'population.merchant.observed', populationRoleId: null,
      populationPresentation: { name: 'Travelling Lampwright', glyph: 'L', color: '#ffd166', leader: false },
    };
    const stock = {
      itemId: 'item.merchant.observed.stock', contentId: 'item.travel-ration', quantity: 1, condition: 100,
      enchantment: null, identified: true, charges: null, fuel: null, enabled: null,
      location: { type: 'merchant-stock', populationId: merchantActor.populationId } as const,
    };
    const population = {
      populationId: merchantActor.populationId, encounterId: 'encounter.travelling-lampwright',
      floorId: merchantActor.floorId, createdAt: 0, livingMemberIds: [merchantActor.actorId],
      formerMemberIds: [], model: 'merchant' as const, actorId: merchantActor.actorId,
      npcId: 'npc.travelling-lampwright', factionId: faction.id, rolledLifetime: 3000, departureAt: 3000,
      emittedWarningThresholds: [], initialStockItemIds: [stock.itemId], stockItemIds: [stock.itemId],
      services: [{ serviceId: 'merchant-service.identify' as const, basePrice: 10, remainingUses: 1,
        tierIds: ['neutral', 'trusted'] }],
      lifecycle: 'available' as const, provoked: false, aggressionPenaltyApplied: false,
      deathPenaltyApplied: false, stockLossResolved: false, commerceBonusApplied: false,
    };
    return {
      ...base,
      actors: [...base.actors, merchantActor]
        .sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0),
      items: [...base.items, stock]
        .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0),
      populations: [...base.populations, population]
        .sort((left, right) => left.populationId < right.populationId ? -1 : left.populationId > right.populationId ? 1 : 0),
      encounterDecisions: base.encounterDecisions.map((decision) =>
        decision.encounterId === population.encounterId
          ? { ...decision, eligible: true, reachedEligibleDepth: true, encountered: false,
            instancesCreated: decision.instancesCreated + 1 }
          : decision),
    };
  }

  it('materializes the authored starting reputation exactly once on first legitimate observation', () => {
    const run = merchantObservationRun();
    expect(run.reputations.some((entry) => entry.factionId === faction.id)).toBe(false);

    const wait: GameCommand = { type: 'wait', commandId: 'command.observe-merchant', expectedRevision: run.revision };
    const observed = resolveCommand(run, wait, { content });

    expect(observed.result.status).toBe('applied');
    expect(observed.state.encounterDecisions.find((decision) =>
      decision.encounterId === 'encounter.travelling-lampwright')?.encountered).toBe(true);
    expect(observed.state.reputations).toEqual([{ factionId: faction.id, value: faction.startingReputation }]);

    const adjusted: ActiveRun = { ...observed.state, reputations: observed.state.reputations.map((entry) =>
      entry.factionId === faction.id ? { ...entry, value: 123 } : entry) };
    const second: GameCommand = { type: 'wait', commandId: 'command.observe-merchant-again',
      expectedRevision: adjusted.revision };
    const reObserved = resolveCommand(adjusted, second, { content });

    expect(reObserved.result.status).toBe('applied');
    expect(reObserved.state.reputations).toEqual([{ factionId: faction.id, value: 123 }]);
  });

  it('rejects a persisted state that observed a merchant without materializing its reputation', () => {
    const run = merchantObservationRun();
    const corrupted: ActiveRun = { ...run, encounterDecisions: run.encounterDecisions.map((decision) =>
      decision.encounterId === 'encounter.travelling-lampwright' ? { ...decision, encountered: true } : decision) };
    expect(() => validateContentBoundRun(corrupted, content)).toThrow(/reputation was never materialized/);
    expect(() => validateContentBoundRun({ ...corrupted,
      reputations: [{ factionId: faction.id, value: faction.startingReputation }] }, content)).not.toThrow();
  });
});
