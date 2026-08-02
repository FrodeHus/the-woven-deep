import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  findPath,
  FINAL_CHAMBER_DEPTH,
  heroActor,
  tileDefinition,
  validateActiveRun,
  type ActiveRun,
  type DungeonFeature,
  type FloorSnapshot,
  type Point,
  type Uint32State,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/**
 * Each seed generates a whole twenty-floor descent (topology, vaults, population, loot), which
 * costs around five seconds locally and roughly twelve on CI's two-core runner. Three keeps the
 * whole FILE near thirty-six seconds there: vitest's worker heartbeat tolerates ~60s of blocked
 * synchronous work per file in practice (a five-seed run totalled 60.4s on CI and tripped the
 * "onTaskUpdate" timeout even though every case passed), so the budget is the file, not the case.
 * Three seeds still cross every depth band and both milestone-boss vault depths.
 */
const SEED_COUNT = 3;

/**
 * Seeds are derived from one authored constant by a fixed affine step rather than drawn: the suite
 * must select the same runs on every machine and every rerun, and `Math.random` is barred from the
 * engine's tests as much as from its source.
 */
function runSeed(index: number): Uint32State {
  return [
    (0x10cc_f4ee ^ (index * 0x9e37_79b9)) >>> 0,
    (0x5eed_0001 + index * 0x0100_0193) >>> 0,
    (0xdead_beef ^ (index * 0x85eb_ca6b)) >>> 0,
    (0x0000_0d00 + index + 1) >>> 0,
  ];
}

const DOOR_TILE_ID = 2;

/**
 * A cell the hero can cross with nothing but their own two hands: no key, no lockpick, no lucky
 * search roll. Closed doors and closed chests are passable (both open on a plain bump/interact),
 * `locked` doors and chests are walls, and an undiscovered secret is a wall because finding it is
 * a roll the hero may never win.
 *
 * A door *tile* with no feature hanging on it is treated as passable here on purpose: the bare-tile
 * case is its own structural invariant (see the door-feature validation in `save-schema`), and
 * folding it into this suite would report a bare tile as a lock failure.
 */
function lockFreePassable(floor: FloorSnapshot, features: ReadonlyMap<number, DungeonFeature>) {
  return (x: number, y: number): boolean => {
    const index = y * floor.width + x;
    const feature = features.get(index);
    if (feature !== undefined) {
      if (feature.type === 'door') return feature.state !== 'locked';
      if (feature.type === 'chest') return feature.state !== 'locked';
      if (feature.type === 'secret') return feature.state === 'revealed';
      return true;
    }
    const tile = floor.tiles[index];
    if (tile === undefined) return false;
    return tileDefinition(tile).walkable || tile === DOOR_TILE_ID;
  };
}

function featuresByIndex(
  run: ActiveRun,
  floor: FloorSnapshot,
): ReadonlyMap<number, DungeonFeature> {
  const map = new Map<number, DungeonFeature>();
  for (const feature of run.features) {
    if (feature.floorId !== floor.floorId) continue;
    map.set(feature.y * floor.width + feature.x, feature);
  }
  return map;
}

/**
 * Four-way topology on purpose: floor generation validates connectivity four-way
 * (`analyzeConnectivity`), and a four-way route is the stricter claim -- it implies the eight-way
 * route the hero actually walks.
 */
function lockFreeRoute(run: ActiveRun, floor: FloorSnapshot, from: Point, to: Point) {
  return findPath({
    width: floor.width,
    height: floor.height,
    topology: 4,
    origin: from,
    destination: to,
    isPassable: lockFreePassable(floor, featuresByIndex(run, floor)),
  });
}

/** The Heart is the deepest floor's objective; the Chamber has no stair down to aim at. */
function objective(floor: FloorSnapshot): Point {
  if (floor.depth === FINAL_CHAMBER_DEPTH) {
    const heart = floor.placementSlots.find((slot) => slot.tags.includes('heart'));
    if (heart === undefined) throw new Error('final chamber floor has no heart marker slot');
    return { x: heart.x, y: heart.y };
  }
  const stairDown = floor.stairDown;
  if (stairDown === null) throw new Error(`floor ${floor.floorId} has no stair-down`);
  return stairDown;
}

function activeFloor(run: ActiveRun): FloorSnapshot {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (floor === undefined) throw new Error(`active floor ${run.activeFloorId} is missing`);
  return floor;
}

function teleportHeroTo(run: ActiveRun, position: Point): ActiveRun {
  const hero = heroActor(run);
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  });
}

function lockedFeaturesOn(run: ActiveRun, floor: FloorSnapshot): readonly DungeonFeature[] {
  return run.features.filter(
    (feature) =>
      feature.floorId === floor.floorId &&
      (feature.type === 'door' || feature.type === 'chest') &&
      feature.state === 'locked',
  );
}

function diagnostic(
  seed: Uint32State,
  floor: FloorSnapshot,
  from: Point,
  to: Point,
  run: ActiveRun,
): string {
  const locks = lockedFeaturesOn(run, floor)
    .map((feature) => `${feature.type}@${feature.x},${feature.y}`)
    .join(' ');
  return (
    `seed [${seed.join(', ')}] depth ${floor.depth} (${floor.floorId}): ` +
    `no lock-free route from arrival ${from.x},${from.y} to objective ${to.x},${to.y}. ` +
    `Locked features on this floor: ${locks.length === 0 ? '(none)' : locks}`
  );
}

describe('every floor of a run descends without a key or a lockpick', () => {
  const seeds = Array.from({ length: SEED_COUNT }, (_, index) => runSeed(index));

  it.each(seeds.map((seed, index) => [index, seed] as const))(
    'seed %i reaches the Heart through unlocked ground alone',
    (_index, seed) => {
      let state = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
      let depthsChecked = 0;
      let locksSeen = 0;

      for (;;) {
        const floor = activeFloor(state);
        const hero = heroActor(state);
        const arrival: Point = { x: hero.x, y: hero.y };
        const target = objective(floor);

        const route = lockFreeRoute(state, floor, arrival, target);
        expect(route, diagnostic(seed, floor, arrival, target, state)).not.toBeNull();
        depthsChecked += 1;
        locksSeen += lockedFeaturesOn(state, floor).length;

        if (floor.depth === FINAL_CHAMBER_DEPTH) break;
        state = descendToNextFloor(teleportHeroTo(state, target), { content: pack }).state;
      }

      // Town through the Chamber: depth 0..20 inclusive.
      expect(depthsChecked).toBe(FINAL_CHAMBER_DEPTH + 1);
      // Non-vacuity: the run really does hand out locks. A pack (or a regression) that stopped
      // locking anything at all would satisfy the reachability claim for the wrong reason, and the
      // suite would silently stop guarding the rule it exists to guard.
      expect(locksSeen).toBeGreaterThan(0);
    },
  );

  // Task 12 (hero-power-curve) regression pin: this whole file already re-runs the no-hard-gates
  // proof against a save-schema-v17 run (`createNewRun` now carries `hero.tempering` and every
  // item can carry an `enchantment`) -- named explicitly here so the pin is traceable to the
  // feature that motivated it, and pinned against a fresh, wholly untouched hero: no milestone
  // point spent, nothing enchanted, exactly the starting shape every earlier no-hard-gates run in
  // this file already assumed.
  it('keeps every descent reachable with no tempering spent and no enchantment', () => {
    const seed = seeds[0]!;
    let state = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
    expect(Object.values(state.hero.tempering.spent).every((spent) => spent === 0)).toBe(true);
    expect(state.hero.tempering.banked).toBe(0);
    expect(state.items.some((item) => item.enchantment !== null)).toBe(false);

    for (;;) {
      const floor = activeFloor(state);
      const hero = heroActor(state);
      const arrival: Point = { x: hero.x, y: hero.y };
      const target = objective(floor);

      const route = lockFreeRoute(state, floor, arrival, target);
      expect(route, diagnostic(seed, floor, arrival, target, state)).not.toBeNull();

      if (floor.depth === FINAL_CHAMBER_DEPTH) break;
      state = descendToNextFloor(teleportHeroTo(state, target), { content: pack }).state;
    }

    // Tempering milestones bank on the way down (the seed crosses depth 3 at minimum) but nothing
    // here ever spends one, and nothing here ever enchants -- the descent stays lock-free either
    // way, which is the actual claim: reachability never depends on either system.
    expect(state.hero.tempering.banked).toBeGreaterThan(0);
    expect(Object.values(state.hero.tempering.spent).every((spent) => spent === 0)).toBe(true);
    expect(state.items.some((item) => item.enchantment !== null)).toBe(false);
  });
});
