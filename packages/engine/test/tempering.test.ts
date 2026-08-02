import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  grantTemperingMilestones,
  heroActor,
  validateActiveRun,
  type ActiveRun,
  type HeroTemperingState,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [11, 22, 33, 44] as const;

function zeroSpent(): HeroTemperingState['spent'] {
  return { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 };
}

/** A run whose only interesting fact is its milestone high-water mark. `grantTemperingMilestones`
 * reads `metrics.deepestDepth` and `hero.tempering` and nothing else, so this is the whole world
 * the unit cases need. */
function runAtDepth(depth: number): ActiveRun {
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  return { ...run, metrics: { ...run.metrics, deepestDepth: depth } };
}

function withTempering(run: ActiveRun, tempering: HeroTemperingState): ActiveRun {
  return { ...run, hero: { ...run.hero, tempering } };
}

function teleportHeroTo(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  });
}

/** Walks the real transition path down to `depth` and leaves the hero on that floor's stair-down,
 * ready for one more descent. */
function runOnStairDownAtDepth(depth: number): ActiveRun {
  let run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  for (let step = 0; step < depth; step += 1) {
    const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
    run = descendToNextFloor(teleportHeroTo(run, activeFloor.stairDown!), { content: pack }).state;
  }
  const arrived = run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
  return teleportHeroTo(run, arrived.stairDown!);
}

describe('grantTemperingMilestones', () => {
  it('banks a point the first time a milestone depth is reached', () => {
    const { state, events } = grantTemperingMilestones({
      state: runAtDepth(3),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    });
    expect(state.hero.tempering.banked).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'hero.tempering-banked', depth: 3, banked: 1 }),
    );
  });

  it('does not bank again for the same depth', () => {
    const first = grantTemperingMilestones({
      state: runAtDepth(3),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    });
    const second = grantTemperingMilestones({
      state: first.state,
      content: pack,
      previousDeepestDepth: 3,
      eventId: 'e2',
    });
    expect(second.state.hero.tempering.banked).toBe(1);
    expect(second.events).toEqual([]);
  });

  it('banks several points when several milestones are crossed at once', () => {
    const { state, events } = grantTemperingMilestones({
      state: runAtDepth(7),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    });
    expect(state.hero.tempering.banked).toBe(2); // depths 3 and 6
    expect(events).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({ type: 'hero.tempering-banked', depth: 3, banked: 1 }),
      expect.objectContaining({ type: 'hero.tempering-banked', depth: 6, banked: 2 }),
    ]);
  });

  it('gives every event of a multi-milestone crossing its own eventId', () => {
    const { events } = grantTemperingMilestones({
      state: runAtDepth(7),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    });
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
  });

  it('banks nothing between milestones', () => {
    // The honest between-milestones state: the run crossed 3 (and banked it) and has since walked
    // down to 5. Stepping 4 -> 5 owes nothing.
    const crossedThree = grantTemperingMilestones({
      state: runAtDepth(3),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e0',
    }).state;
    const { state, events } = grantTemperingMilestones({
      state: { ...crossedThree, metrics: { ...crossedThree.metrics, deepestDepth: 5 } },
      content: pack,
      previousDeepestDepth: 4,
      eventId: 'e1',
    });
    expect(state.hero.tempering.banked).toBe(1);
    expect(events).toEqual([]);
  });

  it('back-fills a deep run that never earned its milestones (the legacy-save case)', () => {
    // Depth is the only fact: a state at depth 5 with nothing earned -- which is exactly what the
    // v16 -> v17 migration produces for a resumed legacy run -- is owed its depth-3 point, and the
    // next floor entry grants it. Pinned because it is a real consequence of deriving rather than
    // storing crossings, not an accident.
    const { state, events } = grantTemperingMilestones({
      state: runAtDepth(5),
      content: pack,
      previousDeepestDepth: 4,
      eventId: 'e1',
    });
    expect(state.hero.tempering.banked).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({ type: 'hero.tempering-banked', depth: 3, banked: 1 }),
    ]);
  });

  it('counts already-spent points as earned, so a spent milestone never re-banks', () => {
    const spentAtThree = withTempering(runAtDepth(3), {
      banked: 0,
      spent: { ...zeroSpent(), might: 1 },
    });
    const { state } = grantTemperingMilestones({
      state: spentAtThree,
      content: pack,
      previousDeepestDepth: 3,
      eventId: 'e1',
    });
    expect(state.hero.tempering.banked).toBe(0);
  });

  it('is idempotent under re-derivation: running it twice over the same facts changes nothing', () => {
    const once = grantTemperingMilestones({
      state: runAtDepth(7),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    });
    const twice = grantTemperingMilestones({
      state: once.state,
      content: pack,
      previousDeepestDepth: 7,
      eventId: 'e2',
    });
    expect(twice.state).toEqual(once.state);
    expect(twice.events).toEqual([]);
  });

  it('re-grants after a Wanderer rewind, because the rewind restores the earned total too', () => {
    // A checkpoint blob rewinds `deepestDepth` AND the hero's tempering together. Re-crossing the
    // same depth genuinely re-earns the point -- deliberate spec semantics, pinned here so a future
    // "optimization" to a crossed-depth set cannot silently change it.
    const crossed = grantTemperingMilestones({
      state: runAtDepth(3),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    }).state;
    expect(crossed.hero.tempering.banked).toBe(1);

    // The checkpoint blob restores BOTH halves: the mark drops back to 1 and the point goes with it.
    const rewound = withTempering(
      { ...crossed, metrics: { ...crossed.metrics, deepestDepth: 1 } },
      { banked: 0, spent: zeroSpent() },
    );
    // Granting against the rewound run itself owes nothing -- depth 1 has genuinely reached no
    // milestone. (Asserted on the rewound state, not on a state that re-raises the mark in the same
    // expression, or this case would collapse into the back-fill case above.)
    const atRewind = grantTemperingMilestones({
      state: rewound,
      content: pack,
      previousDeepestDepth: 3,
      eventId: 'e2',
    });
    expect(atRewind.state.hero.tempering.banked).toBe(0);
    expect(atRewind.events).toEqual([]);

    // Walking back down to 3 re-earns the point. A stored crossed-depth set would remember depth 3
    // and refuse to re-grant here, so this assertion is what pins the derived semantics.
    const reCrossed = grantTemperingMilestones({
      state: { ...atRewind.state, metrics: { ...atRewind.state.metrics, deepestDepth: 3 } },
      content: pack,
      previousDeepestDepth: 1,
      eventId: 'e3',
    });
    expect(reCrossed.state.hero.tempering.banked).toBe(1);
    expect(reCrossed.events).toEqual([
      expect.objectContaining({ type: 'hero.tempering-banked', depth: 3, banked: 1 }),
    ]);
  });

  it('consumes no randomness', () => {
    const before = runAtDepth(3);
    expect(
      grantTemperingMilestones({
        state: before,
        content: pack,
        previousDeepestDepth: 2,
        eventId: 'e1',
      }).state.rng,
    ).toEqual(before.rng);
  });

  it('leaves the spent history untouched', () => {
    const spent = { ...zeroSpent(), vitality: 1 };
    const { state } = grantTemperingMilestones({
      state: withTempering(runAtDepth(6), { banked: 0, spent }),
      content: pack,
      previousDeepestDepth: 2,
      eventId: 'e1',
    });
    // Depths 3 and 6 are reached, one point is already spent, so exactly one is owed.
    expect(state.hero.tempering).toEqual({ banked: 1, spent });
  });

  it('banks on a real descent through the transition path', () => {
    const transition = descendToNextFloor(runOnStairDownAtDepth(2), { content: pack });
    expect(transition.state.metrics.deepestDepth).toBe(3);
    expect(transition.state.hero.tempering.banked).toBe(1);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: 'hero.tempering-banked', depth: 3 }),
    );
  });

  it('banks nothing on a descent that crosses no milestone', () => {
    const transition = descendToNextFloor(runOnStairDownAtDepth(1), { content: pack });
    expect(transition.state.metrics.deepestDepth).toBe(2);
    expect(transition.state.hero.tempering.banked).toBe(0);
    expect(transition.events.some((event) => event.type === 'hero.tempering-banked')).toBe(false);
  });
});
