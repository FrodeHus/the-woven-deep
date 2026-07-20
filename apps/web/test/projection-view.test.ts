import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createGameplayDemoRun, createNewRun, DEFAULT_GUEST_HERO, heroActor, heroPerception,
  projectGameplayState, refreshKnowledge, resolveCommand, validateActiveRun,
  type ActiveRun, type FloorSnapshot, type GameplayProjection, type MerchantPopulation,
} from '@woven-deep/engine';
import {
  actorsOf, featuresOf, groundItemsOf, heroOf, houseOf, ownedItemOf, slotsOf, tradeOf,
} from '../src/session/projection-view.js';

// The single web-side cast (`projection-view.ts`'s `view()`) claims the loose engine projection
// matches the view-model interfaces. These tests project a REAL run from the real content pack and
// assert each accessor reads the fields the engine actually emits, so the cast cannot silently
// drift from reality.

const SEED = [11, 22, 33, 44] as const;

let pack: CompiledContentPack;
let town: GameplayProjection;
let dungeon: GameplayProjection;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  town = projectGameplayState({ state: createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }), content: pack });
  dungeon = projectGameplayState({ state: createGameplayDemoRun(pack).run, content: pack });
});

describe('heroOf', () => {
  it('reads the hero view-model fields the engine projects', () => {
    const hero = heroOf(town);
    expect(typeof hero.actorId).toBe('string');
    expect(typeof hero.name).toBe('string');
    expect(typeof hero.x).toBe('number');
    expect(typeof hero.y).toBe('number');
    expect(typeof hero.health).toBe('number');
    expect(typeof hero.maxHealth).toBe('number');
    expect(typeof hero.sightRadius).toBe('number');
    expect(typeof hero.backpackCapacity).toBe('number');
    expect(typeof hero.hungerStage).toBe('string');
    expect(typeof hero.attributes.might).toBe('number');
    expect(typeof hero.derived.maxHealth.value).toBe('number');
    expect(typeof hero.derived.maxHealth.formula).toBe('object');
    expect(Array.isArray(hero.conditions)).toBe(true);
    expect(Array.isArray(hero.knownAppearanceIds)).toBe(true);
    expect(Object.keys(hero.equipment)).toContain('main-hand');
  });

  it('reads owned-item fields off the backpack', () => {
    const item = heroOf(town).backpack[0];
    expect(item).toBeDefined();
    expect(typeof item!.itemId).toBe('string');
    expect(typeof item!.name).toBe('string');
    expect(typeof item!.category).toBe('string');
    expect(typeof item!.quantity).toBe('number');
    expect(typeof item!.identified).toBe('boolean');
    expect(typeof item!.condition).toBe('number');
    // `fuel`/`enabled` are always present on an owned item (null when not a light source).
    expect(item!.fuel === null || typeof item!.fuel === 'number').toBe(true);
    expect(item!.enabled === null || typeof item!.enabled === 'boolean').toBe(true);
  });
});

describe('ownedItemOf', () => {
  it('finds a backpack item by id', () => {
    const hero = heroOf(town);
    const first = hero.backpack[0]!;
    expect(ownedItemOf(hero, first.itemId)?.itemId).toBe(first.itemId);
    expect(ownedItemOf(hero, 'item.does-not-exist')).toBeUndefined();
  });
});

describe('actorsOf', () => {
  it('reads the merchant actor view-model fields', () => {
    const merchant = actorsOf(town).find((actor) => typeof actor.factionName === 'string');
    expect(merchant).toBeDefined();
    expect(typeof merchant!.actorId).toBe('string');
    expect(merchant!.contentId === null || typeof merchant!.contentId === 'string').toBe(true);
    expect(typeof merchant!.x).toBe('number');
    expect(typeof merchant!.y).toBe('number');
    expect(typeof merchant!.health).toBe('number');
    expect(typeof merchant!.maxHealth).toBe('number');
    expect(typeof merchant!.healthPresentation.band).toBe('string');
    expect(typeof merchant!.disposition).toBe('string');
    expect(typeof merchant!.factionName).toBe('string');
    expect(typeof merchant!.reputationTier).toBe('string');
    expect(typeof merchant!.tradeAvailable).toBe('boolean');
  });
});

describe('featuresOf', () => {
  it('reads a projected door feature view-model', () => {
    const door = featuresOf(dungeon).find((feature) => feature.type === 'door');
    expect(door).toBeDefined();
    expect(typeof door!.featureId).toBe('string');
    expect(typeof door!.x).toBe('number');
    expect(typeof door!.y).toBe('number');
    expect(typeof door!.state).toBe('string');
  });
});

describe('groundItemsOf', () => {
  it('returns positioned ground items', () => {
    const items = groundItemsOf(dungeon);
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(typeof item.itemId).toBe('string');
      expect(typeof item.x).toBe('number');
      expect(typeof item.y).toBe('number');
    }
  });
});

describe('slotsOf', () => {
  it('exposes the town placement slots, including the house door', () => {
    const slots = slotsOf(town);
    expect(slots.some((slot) => slot.tags.includes('house-door'))).toBe(true);
    for (const slot of slots) {
      expect(typeof slot.slotId).toBe('string');
      expect(typeof slot.x).toBe('number');
      expect(typeof slot.y).toBe('number');
    }
  });
});

describe('houseOf', () => {
  it('reads the house view-model', () => {
    const house = houseOf(town);
    expect(typeof house.capacity).toBe('number');
    expect(typeof house.upgradesPurchased).toBe('number');
    expect(Array.isArray(house.items)).toBe(true);
  });
});

describe('tradeOf', () => {
  it('is undefined with no active trade session', () => {
    expect(tradeOf(town)).toBeUndefined();
  });

  it('reads a stock item view-model fields off an opened trade', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const armorer = run.populations.find((population): population is MerchantPopulation =>
      population.model === 'merchant' && population.encounterId === 'encounter.town-armorer')!;
    const merchantActor = run.actors.find((actor) => actor.actorId === armorer.actorId)!;
    const moved = teleportHero(run, adjacentFreeCell(run, merchantActor));
    const opened = resolveCommand(moved, {
      type: 'trade-open', commandId: 'command.trade-open', expectedRevision: moved.revision,
      merchantActorId: merchantActor.actorId,
    }, { content: pack });
    if (opened.result.status !== 'applied') throw new Error(`test setup failure: trade-open was not applied (${JSON.stringify(opened.result)})`);

    const projection = projectGameplayState({ state: opened.state, content: pack });
    const trade = tradeOf(projection);
    expect(trade).toBeDefined();
    const entry = trade!.stock[0];
    expect(entry).toBeDefined();
    expect(typeof entry!.item.itemId).toBe('string');
    expect(typeof entry!.item.name).toBe('string');
    expect(typeof entry!.item.category).toBe('string');
    expect(typeof entry!.quantity).toBe('number');
    expect(typeof entry!.unitPrice).toBe('number');
  });
});

function townFloor(run: ActiveRun): FloorSnapshot {
  return run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
}

/** Mirrors the identical helper in `trade-close-escape.test.tsx`/`trade-screen.test.tsx`: teleports
 * the hero and refreshes the active floor's knowledge in place, since `trade-open` requires the
 * merchant to be visible. */
function teleportHero(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  const moved: ActiveRun = {
    ...run,
    actors: run.actors.map((actor) => actor.actorId === hero.actorId ? { ...actor, ...position } : actor),
  };
  const floor = townFloor(moved);
  const movedHero = heroActor(moved);
  const knowledge = refreshKnowledge({
    floor, hero: heroPerception(moved.hero, movedHero),
    actors: new Map(moved.actors.filter((actor) => actor.floorId === floor.floorId).map((actor) => [actor.actorId, actor] as const)),
  }).knowledge;
  return validateActiveRun({
    ...moved,
    floors: moved.floors.map((candidate) => candidate.floorId === floor.floorId ? { ...candidate, knowledge } : candidate),
  });
}

/** Stands the hero directly beside (Chebyshev distance 1 from) the given point. */
function adjacentFreeCell(run: ActiveRun, target: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  const floor = townFloor(run);
  const occupied = new Set(run.actors.filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
    .map((actor) => `${actor.x}:${actor.y}`));
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`test setup failure: cannot stand adjacent to ${target.x}:${target.y}`);
}
