import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  decodeActiveRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  encodeActiveRun,
  grantTemperingMilestones,
  heroActor,
  resolveCommand,
  resolveTemper,
  validateActiveRun,
  validateContentBoundRun,
  type ActiveRun,
  type GameCommand,
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

describe('resolveTemper', () => {
  const ATTRIBUTES = ['might', 'agility', 'vitality', 'wits', 'resolve'] as const;

  /** A fresh run with `banked` points and nothing spent. Its stored maxima are already the derived
   * ones (`createNewRun` builds them from the formulas), so every rescale case below starts honest. */
  function heroWithBankedPoints(banked: number): ActiveRun {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    return withTempering(run, { banked, spent: zeroSpent() });
  }

  function withHeroActor(run: ActiveRun, patch: Partial<ReturnType<typeof heroActor>>): ActiveRun {
    const hero = heroActor(run);
    return {
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === hero.actorId ? { ...actor, ...patch } : actor,
      ),
    };
  }

  function withAttributes(
    run: ActiveRun,
    attributes: Partial<Record<(typeof ATTRIBUTES)[number], number>>,
  ): ActiveRun {
    const hero = heroActor(run);
    return withHeroActor(run, { attributes: { ...hero.attributes, ...attributes } });
  }

  function temperCommand(
    attribute: (typeof ATTRIBUTES)[number],
    expectedRevision = 0,
  ): GameCommand {
    return { type: 'temper', commandId: 'command.temper', expectedRevision, attribute };
  }

  const baseAttributes = () => heroActor(heroWithBankedPoints(0)).attributes;
  const baseMaxHealth = () => heroActor(heroWithBankedPoints(0)).maxHealth;
  const baseMaxWeave = () => heroActor(heroWithBankedPoints(0)).maxWeave;

  it('spends a banked point and raises the attribute', () => {
    const { state, events } = resolveTemper({
      state: heroWithBankedPoints(1),
      content: pack,
      attribute: 'vitality',
      eventId: 'e1',
    });
    expect(heroActor(state).attributes.vitality).toBe(baseAttributes().vitality + 1);
    expect(state.hero.tempering).toEqual({ banked: 0, spent: { ...zeroSpent(), vitality: 1 } });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'hero.tempered', attribute: 'vitality', remaining: 0 }),
    );
  });

  it('conserves banked + spent across every spend', () => {
    // The binding acceptance criterion: a spend is a TRANSFER. Nothing is refunded, reset, or
    // minted -- the total a run has ever earned is invariant under tempering.
    const total = (state: ActiveRun) =>
      state.hero.tempering.banked +
      Object.values(state.hero.tempering.spent).reduce((sum, spent) => sum + spent, 0);
    let state = heroWithBankedPoints(3);
    const before = total(state);
    for (const attribute of ['might', 'vitality', 'wits'] as const) {
      state = resolveTemper({ state, content: pack, attribute, eventId: `e.${attribute}` }).state;
      expect(total(state)).toBe(before);
    }
    expect(state.hero.tempering).toEqual({
      banked: 0,
      spent: { ...zeroSpent(), might: 1, vitality: 1, wits: 1 },
    });
  });

  it('recomputes the maxima from the formulas', () => {
    const { state } = resolveTemper({
      state: heroWithBankedPoints(1),
      content: pack,
      attribute: 'vitality',
      eventId: 'e1',
    });
    expect(heroActor(state).maxHealth).toBe(baseMaxHealth() + 1);
  });

  it('scales weave the same way', () => {
    const { state } = resolveTemper({
      state: heroWithBankedPoints(1),
      content: pack,
      attribute: 'wits',
      eventId: 'e1',
    });
    expect(heroActor(state).maxWeave).toBe(baseMaxWeave() + 1);
  });

  it('keeps a full-health hero at full health', () => {
    const full = heroWithBankedPoints(1);
    expect(heroActor(full).health).toBe(heroActor(full).maxHealth);
    const { state } = resolveTemper({
      state: full,
      content: pack,
      attribute: 'vitality',
      eventId: 'e1',
    });
    expect(heroActor(state).health).toBe(heroActor(state).maxHealth);
  });

  it('scales a wounded hero proportionally', () => {
    // health 10 / max 20 -> max 21 -> floor(10 * 21 / 20) = 10
    const wounded = withHeroActor(withAttributes(heroWithBankedPoints(1), { vitality: 10 }), {
      health: 10,
      maxHealth: 20,
      weave: 7,
      maxWeave: 14,
    });
    const { state } = resolveTemper({
      state: wounded,
      content: pack,
      attribute: 'vitality',
      eventId: 'e1',
    });
    expect(heroActor(state).maxHealth).toBe(21);
    expect(heroActor(state).health).toBe(10);
  });

  it('never drops a living hero below 1 health', () => {
    const barely = withHeroActor(heroWithBankedPoints(1), { health: 1 });
    const { state } = resolveTemper({
      state: barely,
      content: pack,
      attribute: 'vitality',
      eventId: 'e1',
    });
    expect(heroActor(state).health).toBeGreaterThanOrEqual(1);
  });

  it('consumes no randomness and no turn', () => {
    const before = heroWithBankedPoints(1);
    const { state } = resolveTemper({
      state: before,
      content: pack,
      attribute: 'might',
      eventId: 'e1',
    });
    expect(state.rng).toEqual(before.rng);
    expect(state.turn).toBe(before.turn);
    expect(state.worldTime).toBe(before.worldTime);
    expect(heroActor(state).energy).toBe(heroActor(before).energy);
  });

  it('applies through resolveCommand as a revision-only command', () => {
    const before = heroWithBankedPoints(1);
    const resolved = resolveCommand(before, temperCommand('vitality'), { content: pack });
    expect(resolved.result).toMatchObject({
      status: 'applied',
      revision: before.revision + 1,
      turn: before.turn,
    });
    expect(resolved.state.rng).toEqual(before.rng);
    expect(resolved.state.worldTime).toBe(before.worldTime);
    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: 'hero.tempered', attribute: 'vitality' }),
    );
  });

  it('rejects a temper with no banked point', () => {
    const resolved = resolveCommand(heroWithBankedPoints(0), temperCommand('might'), {
      content: pack,
    });
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'temper.unavailable' });
  });

  it('rejects a temper on a capped attribute while alternatives exist', () => {
    const capped = withAttributes(heroWithBankedPoints(1), { might: 30 });
    const resolved = resolveCommand(capped, temperCommand('might'), { content: pack });
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'temper.capped' });
    // The alternative is still open, so the point is not stranded.
    expect(
      resolveCommand(capped, temperCommand('agility'), { content: pack }).result,
    ).toMatchObject({ status: 'applied' });
  });

  it('holds points forever when every attribute is capped', () => {
    const state = withAttributes(heroWithBankedPoints(2), {
      might: 30,
      agility: 30,
      vitality: 30,
      wits: 30,
      resolve: 30,
    });
    for (const attribute of ATTRIBUTES) {
      expect(
        resolveCommand(state, temperCommand(attribute), { content: pack }).result,
      ).toMatchObject({ status: 'invalid', reason: 'temper.capped' });
    }
    expect(state.hero.tempering.banked).toBe(2);
  });

  it('rejects a temper on a concluded run', () => {
    const concluded: ActiveRun = {
      ...heroWithBankedPoints(1),
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 0, worldTime: 0 },
        concludedAtRevision: 0,
        finalized: false,
      },
    };
    expect(
      resolveCommand(concluded, temperCommand('might'), { content: pack }).result,
    ).toMatchObject({ reason: 'run.concluded' });
  });

  it('persists a rejected temper without throwing', () => {
    const rejected = resolveCommand(heroWithBankedPoints(0), temperCommand('might'), {
      content: pack,
    });
    const encoded = encodeActiveRun(rejected.state);
    expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
  });

  it('persists a temper rejected as capped without throwing', () => {
    const rejected = resolveCommand(
      withAttributes(heroWithBankedPoints(1), { might: 30 }),
      temperCommand('might'),
      { content: pack },
    );
    expect(rejected.result).toMatchObject({ reason: 'temper.capped' });
    const encoded = encodeActiveRun(rejected.state);
    expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
  });

  it('round-trips an applied temper', () => {
    const applied = resolveCommand(heroWithBankedPoints(1), temperCommand('vitality'), {
      content: pack,
    });
    expect(applied.result).toMatchObject({ status: 'applied' });
    const encoded = encodeActiveRun(applied.state);
    expect(encodeActiveRun(decodeActiveRun(encoded, pack))).toBe(encoded);
  });

  it('refuses to persist an attribute raised past the cap', () => {
    // The content-bound half of the derived-base invariant: the cap is authored, so only the
    // content-bound tier can police it.
    const overCap = withAttributes(heroWithBankedPoints(0), { might: 31 });
    expect(() => validateContentBoundRun(overCap, pack)).toThrow(/attribute/i);
  });

  it('refuses to persist more spent than the attribute can account for', () => {
    const forged = withTempering(heroWithBankedPoints(0), {
      banked: 0,
      spent: { ...zeroSpent(), might: 11 },
    });
    expect(() => validateContentBoundRun(forged, pack)).toThrow(/attribute|spent/i);
  });
});
