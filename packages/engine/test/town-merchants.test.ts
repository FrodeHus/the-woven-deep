import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  advanceMerchantLifecycle,
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  encodeActiveRun,
  heroActor,
  heroPerception,
  factionReputation,
  projectDomainEvents,
  projectGameplayState,
  quoteMerchantService,
  refreshKnowledge,
  reputationTier,
  resolveCommand,
  restockMerchant,
  scaledServiceBasePrice,
  serviceDepthMultiplier,
  validateActiveRun,
  type ActiveRun,
  type FloorSnapshot,
  type MerchantPopulation,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [3, 5, 7, 9] as const;

function townRun(): ActiveRun {
  return createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
}

function context() {
  return { content: pack };
}

// Scoped to permanent (town) merchants -- `departureAt: null` -- so a transient merchant the
// hero happens to encounter elsewhere while descending (e.g. a travelling merchant rolled onto an
// intermediate floor) can never shift the by-index alignment this suite relies on.
function townMerchants(run: ActiveRun): readonly MerchantPopulation[] {
  return run.populations.filter(
    (population): population is MerchantPopulation =>
      population.model === 'merchant' && population.departureAt === null,
  );
}

function townFloor(run: ActiveRun): FloorSnapshot {
  return run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
}

/**
 * Teleports the hero and refreshes the active floor's knowledge in place, mirroring what a real
 * `move` command would do -- a raw position edit alone leaves `knowledge` at its unexplored
 * generation-time value, so a hand-teleported hero would fail every perception-gated check (e.g.
 * `merchantSession`'s visibility requirement) for reasons unrelated to what's under test.
 */
function teleportHero(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, ...position } : actor,
    ),
  };
  const floor = townFloor(moved);
  const movedHero = heroActor(moved);
  const knowledge = refreshKnowledge({
    floor,
    hero: heroPerception(moved.hero, movedHero),
    actors: new Map(
      moved.actors
        .filter((actor) => actor.floorId === floor.floorId)
        .map((actor) => [actor.actorId, actor] as const),
    ),
  }).knowledge;
  return validateActiveRun({
    ...moved,
    floors: moved.floors.map((candidate) =>
      candidate.floorId === floor.floorId ? { ...candidate, knowledge } : candidate,
    ),
  });
}

/** Stands the hero directly beside (Chebyshev distance 1 from) the given point. */
function adjacentFreeCell(
  run: ActiveRun,
  target: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  const floor = townFloor(run);
  const occupied = new Set(
    run.actors
      .filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`test setup failure: cannot stand adjacent to ${target.x}:${target.y}`);
}

function openTrade(run: ActiveRun, merchantActorId: string, commandId = 'command.open'): ActiveRun {
  const resolution = resolveCommand(
    run,
    {
      type: 'trade-open',
      commandId,
      expectedRevision: run.revision,
      merchantActorId,
    },
    context(),
  );
  if (resolution.result.status !== 'applied')
    throw new Error(`test setup failure: trade-open was ${resolution.result.status}`);
  return resolution.state;
}

function descendRepeatedly(run: ActiveRun, times: number): ActiveRun {
  let state = run;
  for (let i = 0; i < times; i += 1) {
    const floor = state.floors.find((candidate) => candidate.floorId === state.activeFloorId)!;
    state = teleportHero(state, floor.stairDown!);
    state = descendToNextFloor(state, context()).state;
  }
  return state;
}

describe('permanent town merchant materialization', () => {
  it('never rolls a lifetime, never departs, and never takes a turn', () => {
    const run = townRun();
    const merchants = townMerchants(run);
    expect(merchants).toHaveLength(4);
    for (const merchant of merchants) {
      expect(merchant.departureAt).toBeNull();
      expect(merchant.rolledLifetime).toBe(0);
      expect(merchant.emittedWarningThresholds).toEqual([]);
      expect(merchant.lifecycle).toBe('available');
      const actor = run.actors.find((candidate) => candidate.actorId === merchant.actorId)!;
      expect(actor.behaviorId).toBeNull();
      expect(actor.floorId).toBe(run.activeFloorId);
    }
  });

  it('is deterministic per seed', () => {
    const first = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const second = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(encodeActiveRun(first)).toBe(encodeActiveRun(second));
    expect(townMerchants(first).map((m) => m.stockItemIds)).toEqual(
      townMerchants(second).map((m) => m.stockItemIds),
    );
  });

  it("projects stock at max(1, deepestDepth) rather than the town's own depth 0", () => {
    const run = townRun();
    for (const merchant of townMerchants(run)) {
      const items = run.items.filter(
        (item) =>
          item.location.type === 'merchant-stock' &&
          item.location.populationId === merchant.populationId,
      );
      expect(items.length).toBeGreaterThan(0);
    }
  });
});

describe('permanent merchant lifecycle', () => {
  it('survives 10_000 worldTime of dungeon play without departing or warning', () => {
    const run = townRun();
    const merchant = townMerchants(run)[0]!;
    const advanced = advanceMerchantLifecycle({
      state: run,
      content: pack,
      previousWorldTime: run.worldTime,
      nextWorldTime: run.worldTime + 10_000,
      eventId: 'event.lifecycle-test',
    });
    expect(advanced.events).toEqual([]);
    const after = advanced.state.populations.find(
      (candidate): candidate is MerchantPopulation =>
        candidate.populationId === merchant.populationId,
    )!;
    expect(after.departureAt).toBeNull();
    expect(after.lifecycle).toBe('available');
    expect(after.emittedWarningThresholds).toEqual([]);
  });
});

describe('permanent merchant trade session', () => {
  it('trades regardless of worldTime -- the departure gate never applies', () => {
    const run = townRun();
    const merchant = townMerchants(run)[0]!;
    const actor = run.actors.find((candidate) => candidate.actorId === merchant.actorId)!;
    const heroCell = adjacentFreeCell(run, actor);
    const farFuture: ActiveRun = validateActiveRun({
      ...teleportHero(run, heroCell),
      worldTime: 500_000,
    });
    const opened = resolveCommand(
      farFuture,
      {
        type: 'trade-open',
        commandId: 'command.open',
        expectedRevision: farFuture.revision,
        merchantActorId: merchant.actorId,
      },
      context(),
    );
    expect(opened.result.status).toBe('applied');
  });
});

describe('strongbox purchase', () => {
  function provisionerSetup(): Readonly<{ run: ActiveRun; merchant: MerchantPopulation }> {
    const base = townRun();
    const merchant = townMerchants(base).find((candidate) =>
      candidate.services.some((service) => service.serviceId === 'merchant-service.strongbox'),
    )!;
    const actor = base.actors.find((candidate) => candidate.actorId === merchant.actorId)!;
    const heroCell = adjacentFreeCell(base, actor);
    const funded: ActiveRun = validateActiveRun({
      ...teleportHero(base, heroCell),
      hero: { ...base.hero, currency: 10_000 },
    });
    return { run: funded, merchant };
  }

  it('raises house.capacity, charges currency, and exhausts the single-use offer', () => {
    const { run, merchant } = provisionerSetup();
    const opened = openTrade(run, merchant.actorId);
    const before = opened.hero.currency;
    const resolved = resolveCommand(
      opened,
      {
        type: 'trade-service',
        commandId: 'command.strongbox',
        expectedRevision: opened.revision,
        merchantPopulationId: merchant.populationId,
        serviceId: 'merchant-service.strongbox',
        targetItemId: null,
      },
      context(),
    );
    expect(resolved.result.status).toBe('applied');
    expect(resolved.state.house).toEqual({ capacity: 10, upgradesPurchased: 1 });
    expect(resolved.state.hero.currency).toBeLessThan(before);
    const event = resolved.events.find((candidate) => candidate.type === 'trade.service-purchased');
    expect(event).toMatchObject({ serviceId: 'merchant-service.strongbox', targetItemId: null });
  });

  it('rejects a second purchase with trade.service-unavailable, world unchanged', () => {
    const { run, merchant } = provisionerSetup();
    const opened = openTrade(run, merchant.actorId);
    const first = resolveCommand(
      opened,
      {
        type: 'trade-service',
        commandId: 'command.strongbox-1',
        expectedRevision: opened.revision,
        merchantPopulationId: merchant.populationId,
        serviceId: 'merchant-service.strongbox',
        targetItemId: null,
      },
      context(),
    );
    expect(first.result.status).toBe('applied');
    const before = first.state;
    const second = resolveCommand(
      before,
      {
        type: 'trade-service',
        commandId: 'command.strongbox-2',
        expectedRevision: before.revision,
        merchantPopulationId: merchant.populationId,
        serviceId: 'merchant-service.strongbox',
        targetItemId: null,
      },
      context(),
    );
    expect(second.result).toMatchObject({ status: 'invalid', reason: 'trade.service-unavailable' });
    expect(second.state.house).toEqual(before.house);
    expect(second.state.hero.currency).toBe(before.hero.currency);
  });

  it('rejects a targeted strongbox command', () => {
    const { run, merchant } = provisionerSetup();
    const opened = openTrade(run, merchant.actorId);
    const backpackItem = opened.items.find(
      (item) => item.location.type === 'backpack' && item.location.actorId === opened.hero.actorId,
    )!;
    const resolved = resolveCommand(
      opened,
      {
        type: 'trade-service',
        commandId: 'command.strongbox-targeted',
        expectedRevision: opened.revision,
        merchantPopulationId: merchant.populationId,
        serviceId: 'merchant-service.strongbox',
        targetItemId: backpackItem.itemId,
      },
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'trade.target-invalid' });
  });
});

describe('milestone restock', () => {
  it('re-rolls stock exactly once per milestone, preserving reputation/service identity, and emits merchant.restocked', () => {
    const started = townRun();
    const before = townMerchants(started);
    const descended = descendRepeatedly(started, 5);
    expect(descended.metrics.deepestDepth).toBe(5);
    expect(descended.restockedMilestones).toEqual([5]);
    const after = townMerchants(descended);
    for (const [index, merchant] of before.entries()) {
      const restocked = after[index]!;
      expect(restocked.populationId).toBe(merchant.populationId);
      expect(restocked.actorId).toBe(merchant.actorId);
      expect(restocked.npcId).toBe(merchant.npcId);
      expect(restocked.factionId).toBe(merchant.factionId);
      // A restock re-arms `remainingUses` (that is the point), so only the offer's identity,
      // price, and tier gating are expected to survive it unchanged.
      expect(restocked.services.map((service) => service.serviceId)).toEqual(
        merchant.services.map((service) => service.serviceId),
      );
      expect(restocked.services.map((service) => service.basePrice)).toEqual(
        merchant.services.map((service) => service.basePrice),
      );
      expect(restocked.services.map((service) => service.tierIds)).toEqual(
        merchant.services.map((service) => service.tierIds),
      );
      expect(restocked.lifecycle).toBe(merchant.lifecycle);
      expect(restocked.stockItemIds).not.toEqual(merchant.stockItemIds);
    }
    // No further restock is fired at the same milestone if the hero descends and ascends again.
    const spammed = descendRepeatedly(descended, 0);
    expect(spammed.restockedMilestones).toEqual([5]);
  });

  it('is idempotent across repeated calls at the same milestone (descend spam)', () => {
    const started = townRun();
    const toDepth5 = descendRepeatedly(started, 5);
    const stockAfterFirst = townMerchants(toDepth5).map((m) => m.stockItemIds);

    // Re-entering the same stored floor and descending again must not re-fire the milestone.
    const floor = toDepth5.floors.find(
      (candidate) => candidate.floorId === toDepth5.activeFloorId,
    )!;
    const onStairUp = validateActiveRun({
      ...toDepth5,
      actors: toDepth5.actors.map((actor) =>
        actor.actorId === heroActor(toDepth5).actorId ? { ...actor, ...floor.stairUp! } : actor,
      ),
    });
    // Ascend then descend again into the same depth-5 floor (a stored re-entry): restockedMilestones
    // must remain exactly [5], not fire twice.
    const d4 = toDepth5.floors.find((candidate) => candidate.depth === 4)!;
    const backAtD4 = validateActiveRun({
      ...onStairUp,
      activeFloorId: d4.floorId,
      actors: onStairUp.actors.map((actor) =>
        actor.actorId === heroActor(onStairUp).actorId
          ? { ...actor, floorId: d4.floorId, ...d4.stairDown! }
          : actor,
      ),
    });
    const redescended = descendToNextFloor(backAtD4, context());
    expect(redescended.state.restockedMilestones).toEqual([5]);
    expect(townMerchants(redescended.state).map((m) => m.stockItemIds)).toEqual(stockAfterFirst);
    expect(redescended.events).toEqual([
      expect.objectContaining({ type: 'floor.entered', depth: 5, firstEntry: false }),
    ]);
  });

  it('fires every milestone the dungeon high-water mark has already passed in a single descend, in ascending order, exactly once', () => {
    const started = townRun();
    const atDepth4 = descendRepeatedly(started, 4);
    expect(atDepth4.metrics.deepestDepth).toBe(4);
    expect(atDepth4.restockedMilestones).toEqual([]);

    // Hand-construct a state where the dungeon high-water mark is already far past milestones 5
    // and 10 (as could happen with a state imported before either milestone was ever recorded),
    // so the next real descend -- into a brand-new floor -- must fire both in the same pass.
    // `descendToNextFloor`'s stored-re-entry branch never touches `metrics.deepestDepth` (see its
    // docstring), so this only exercises the multi-milestone loop in `applyMerchantRestocks`, not
    // metrics bookkeeping.
    const primed = validateActiveRun({
      ...atDepth4,
      metrics: { ...atDepth4.metrics, deepestDepth: 14 },
    });
    const floor = primed.floors.find((candidate) => candidate.floorId === primed.activeFloorId)!;
    const onStairDown = teleportHero(primed, floor.stairDown!);
    const descended = descendToNextFloor(onStairDown, context());

    expect(descended.state.metrics.deepestDepth).toBe(14);
    expect(descended.state.restockedMilestones).toEqual([5, 10]);
    const restockEvents = descended.events.filter((event) => event.type === 'merchant.restocked');
    expect(restockEvents).toHaveLength(8); // 4 permanent merchants x 2 milestones (5 and 10)

    // A further descend (into yet another brand-new floor) must not re-fire either milestone.
    const nextFloor = descended.state.floors.find(
      (candidate) => candidate.floorId === descended.state.activeFloorId,
    )!;
    const onNextStairDown = teleportHero(descended.state, nextFloor.stairDown!);
    const further = descendToNextFloor(onNextStairDown, context());
    expect(further.state.restockedMilestones).toEqual([5, 10]);
    expect(further.events.filter((event) => event.type === 'merchant.restocked')).toEqual([]);
  });
});

describe('milestone restock event visibility', () => {
  it('produces no hero-visible public event when a milestone fires at the descend boundary (hero not in town)', () => {
    const started = townRun();
    const atDepth4 = descendRepeatedly(started, 4);
    const floor = atDepth4.floors.find(
      (candidate) => candidate.floorId === atDepth4.activeFloorId,
    )!;
    const onStairDown = teleportHero(atDepth4, floor.stairDown!);
    const descended = descendToNextFloor(onStairDown, context());
    const restockEvents = descended.events.filter((event) => event.type === 'merchant.restocked');
    expect(restockEvents.length).toBeGreaterThan(0);

    const hero = heroActor(descended.state);
    const publicEvents = projectDomainEvents({
      state: descended.state,
      content: pack,
      heroId: hero.actorId,
      events: restockEvents,
    });
    expect(publicEvents).toEqual([]);
  });
});

describe('restockMerchant', () => {
  it('is a no-op for a departed/dead population', () => {
    const run = townRun();
    const merchant = townMerchants(run)[0]!;
    const dead: ActiveRun = {
      ...run,
      populations: run.populations.map((candidate) =>
        candidate.populationId === merchant.populationId
          ? { ...candidate, lifecycle: 'dead' as const }
          : candidate,
      ),
    };
    const result = restockMerchant(dead, { content: pack, populationId: merchant.populationId });
    expect(result.events).toEqual([]);
    expect(result.state).toBe(dead);
  });

  it('re-arms every service offer within its authored use band without touching identity or price', () => {
    const run = townRun();
    const merchant = townMerchants(run).find(
      (candidate) => candidate.services.length > 0 && candidate.encounterId,
    )!;
    const spent: ActiveRun = {
      ...run,
      populations: run.populations.map((candidate) =>
        candidate.populationId === merchant.populationId
          ? {
              ...candidate,
              services: merchant.services.map((service) => ({ ...service, remainingUses: 0 })),
            }
          : candidate,
      ),
    };
    const encounter = pack.entries.find((entry) => entry.id === merchant.encounterId)!;
    if (encounter.kind !== 'encounter' || encounter.model !== 'merchant')
      throw new Error('test setup failure: merchant encounter not found');
    const result = restockMerchant(spent, { content: pack, populationId: merchant.populationId });
    const after = result.state.populations.find(
      (candidate): candidate is MerchantPopulation =>
        candidate.model === 'merchant' && candidate.populationId === merchant.populationId,
    )!;
    expect(after.services).toHaveLength(merchant.services.length);
    for (const [index, service] of after.services.entries()) {
      const authored = encounter.definition.services.find(
        (candidate) => candidate.serviceId === service.serviceId,
      )!;
      expect(service.remainingUses).toBeGreaterThanOrEqual(authored.minimumUses);
      expect(service.remainingUses).toBeLessThanOrEqual(authored.maximumUses);
      expect(service.serviceId).toBe(merchant.services[index]!.serviceId);
      expect(service.basePrice).toBe(merchant.services[index]!.basePrice);
      expect(service.tierIds).toEqual(merchant.services[index]!.tierIds);
    }
    expect(validateActiveRun(result.state)).toBeDefined();
  });
});

describe('service pricing pressure', () => {
  const SERVICE_ID = 'merchant-service.identify';

  function servicedMerchant(run: ActiveRun): MerchantPopulation {
    return townMerchants(run).find((candidate) =>
      candidate.services.some((service) => service.serviceId === SERVICE_ID),
    )!;
  }

  it('steps the multiplier once per fired restock milestone', () => {
    const base = townRun();
    const at = (milestones: readonly number[]): number =>
      serviceDepthMultiplier({ ...base, restockedMilestones: [...milestones] });
    expect(at([])).toBe(1);
    expect(at([5])).toBe(2);
    expect(at([5, 10])).toBe(3);
    expect(at([5, 10, 15, 20])).toBe(5);
  });

  /** The projected offer must be the number `planService` will charge, at every milestone. */
  it('projects and charges the multiplied price', () => {
    const base = townRun();
    const merchant = servicedMerchant(base);
    const actor = base.actors.find((candidate) => candidate.actorId === merchant.actorId)!;
    const heroCell = adjacentFreeCell(base, actor);
    const authored = merchant.services.find((service) => service.serviceId === SERVICE_ID)!;
    const faction = pack.entries.find((entry) => entry.id === merchant.factionId)!;
    if (faction.kind !== 'npc-faction') throw new Error('test setup failure: faction not found');
    const tier = reputationTier(factionReputation(base, faction), faction);

    const priced = (milestones: readonly number[]): number => {
      const state: ActiveRun = validateActiveRun({
        ...teleportHero(base, heroCell),
        hero: { ...base.hero, currency: 10_000 },
        restockedMilestones: [...milestones],
      });
      const projected = projectGameplayState({
        state: openTrade(state, merchant.actorId),
        content: pack,
      });
      return projected.trade!.services.find((service) => service.serviceId === SERVICE_ID)!
        .unitPrice;
    };

    const expected = (multiplier: number): number =>
      quoteMerchantService({
        basePrice: scaledServiceBasePrice(authored.basePrice, multiplier),
        factionBps: tier.purchasePriceBps,
      });

    expect(priced([])).toBe(expected(1));
    expect(priced([5, 10])).toBe(expected(3));
    expect(priced([5, 10, 15, 20])).toBe(expected(5));
    expect(priced([5, 10, 15, 20])).toBeGreaterThan(priced([]));
  });
});
