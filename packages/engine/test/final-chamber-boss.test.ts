import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  concludeRunOnHeroDeath,
  createNewRun,
  decodeActiveRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  encodeActiveRun,
  FINAL_CHAMBER_DEPTH,
  HEART_BOSS_ENCOUNTER_ID,
  heroActor,
  isHeartBossActive,
  isHeartBossDefeated,
  resolveCommand,
  validateActiveRun,
  type ActiveRun,
  type BossPopulation,
  type GameCommand,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [7, 14, 21, 28] as const;
const context = () => ({ content: pack });

function teleportHeroTo(run: ActiveRun, position: Readonly<{ x: number; y: number }>): ActiveRun {
  const hero = heroActor(run);
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: position.x, y: position.y } : actor,
    ),
  });
}

function descendToDepth19(run: ActiveRun): ActiveRun {
  let state = run;
  while (true) {
    const activeFloor = state.floors.find((floor) => floor.floorId === state.activeFloorId);
    if (activeFloor === undefined) throw new Error('test setup failure: active floor missing');
    if (activeFloor.depth >= 19) return state;
    const stairDown = activeFloor.stairDown;
    if (stairDown === null) throw new Error('test setup failure: floor has no stair-down');
    const onStairs = teleportHeroTo(state, stairDown);
    state = descendToNextFloor(onStairs, { content: pack }).state;
  }
}

// Reaching the Chamber walks 20 real floor transitions (~10s), so cache the deterministic
// result and reuse it: the run is immutable and every test derives new state functionally,
// never mutating this base. Without the cache each test re-descends and the file runs long
// enough to outlast Vitest's 60s worker-RPC heartbeat on a 2-core CI runner.
let cachedChamberRun: ActiveRun | undefined;
function inChamberRun(): ActiveRun {
  if (cachedChamberRun !== undefined) return cachedChamberRun;
  const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  const atDepth19 = descendToDepth19(fresh);
  const activeFloor = atDepth19.floors.find((floor) => floor.floorId === atDepth19.activeFloorId)!;
  const stairDown = activeFloor.stairDown!;
  const onStairs = teleportHeroTo(atDepth19, stairDown);
  cachedChamberRun = descendToNextFloor(onStairs, { content: pack }).state;
  return cachedChamberRun;
}

function turnAway(revision: number): GameCommand {
  return {
    type: 'final-chamber-choice',
    commandId: 'command.turn-away',
    expectedRevision: revision,
    choice: 'turn-away',
  };
}

function wait(revision: number): GameCommand {
  return { type: 'wait', commandId: `command.wait.${revision}`, expectedRevision: revision };
}

/** Runs `turn-away` on the Chamber run and returns the post-activation state (boss injected). */
let cachedActivatedRun: ActiveRun | undefined;
function activatedRun(): ActiveRun {
  if (cachedActivatedRun !== undefined) return cachedActivatedRun;
  const run = inChamberRun();
  const resolution = resolveCommand(run, turnAway(run.revision), context());
  expect(resolution.result).toMatchObject({ status: 'applied' });
  cachedActivatedRun = resolution.state;
  return cachedActivatedRun;
}

function heartBoss(run: ActiveRun): BossPopulation {
  const population = run.populations.find(
    (candidate): candidate is BossPopulation =>
      candidate.model === 'boss' && candidate.encounterId === HEART_BOSS_ENCOUNTER_ID,
  );
  if (!population) throw new Error('test failure: heart boss population missing');
  return population;
}

function withActorHealth(run: ActiveRun, actorId: string, health: number): ActiveRun {
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === actorId
        ? { ...actor, health, maxHealth: Math.max(actor.maxHealth, health) }
        : actor,
    ),
  };
}

/** Kills the heart-boss actor and reconciles its population membership, as combat would. */
function slayHeartBoss(run: ActiveRun): ActiveRun {
  const boss = heartBoss(run);
  const damaged = withActorHealth(run, boss.actorId, 0);
  return {
    ...damaged,
    populations: damaged.populations.map((population) =>
      population.populationId === boss.populationId
        ? {
            ...population,
            livingMemberIds: [],
            formerMemberIds: [boss.actorId],
          }
        : population,
    ),
  };
}

describe('final-chamber refused branch: the Heart boss', () => {
  it('turn-away injects a live, hostile heart-boss actor and does not conclude', () => {
    const run = inChamberRun();
    expect(isHeartBossActive(run)).toBe(false);

    const resolution = resolveCommand(run, turnAway(run.revision), context());

    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.state.conclusion).toBeNull();

    const boss = heartBoss(resolution.state);
    const bossActor = resolution.state.actors.find((actor) => actor.actorId === boss.actorId);
    expect(bossActor).toBeDefined();
    expect(bossActor!.health).toBeGreaterThan(0);
    expect(bossActor!.disposition).toBe('hostile');
    expect(bossActor!.playerControlled).toBe(false);
    expect(bossActor!.floorId).toBe(resolution.state.activeFloorId);
    expect(isHeartBossActive(resolution.state)).toBe(true);
    expect(resolution.events.map((event) => event.type)).toContain('population.notice');
  });

  it('rejects a second Chamber choice once the Heart boss is active', () => {
    const active = activatedRun();
    const resolution = resolveCommand(
      active,
      {
        type: 'final-chamber-choice',
        commandId: 'command.turn-away-2',
        expectedRevision: active.revision,
        choice: 'turn-away',
      },
      context(),
    );
    expect(resolution.result).toMatchObject({
      status: 'invalid',
      reason: 'final-chamber.boss-active',
    });
    expect(resolution.state.conclusion).toBeNull();
  });

  it('defeating the Heart boss concludes the run with refused', () => {
    const active = activatedRun();
    const slain = validateActiveRun(slayHeartBoss(active));
    expect(isHeartBossDefeated(slain)).toBe(true);

    const resolution = resolveCommand(slain, wait(slain.revision), context());

    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.state.conclusion).toMatchObject({
      completionType: 'refused',
      cause: { killerContentId: null, depth: FINAL_CHAMBER_DEPTH },
      finalized: false,
    });
    expect(resolution.events.map((event) => event.type)).toContain('run.concluded');
  });

  it('a hero reduced to zero health while the Heart boss is active is forced to became-heart', () => {
    const active = activatedRun();
    const dyingHero = {
      ...active,
      actors: active.actors.map((actor) =>
        actor.actorId === active.hero.actorId ? { ...actor, health: 0 } : actor,
      ),
    };
    expect(isHeartBossActive(dyingHero)).toBe(true);

    const concluded = concludeRunOnHeroDeath({
      state: dyingHero,
      content: pack,
      events: [],
      revision: dyingHero.revision + 1,
      turn: dyingHero.turn + 1,
      eventId: 'event.forced-heart',
    });

    expect(concluded.state.conclusion).toMatchObject({
      completionType: 'became-heart',
      cause: { killerContentId: null, depth: FINAL_CHAMBER_DEPTH },
    });
  });

  it('an ordinary hero death with no Heart boss still concludes died (override strictly scoped)', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(isHeartBossActive(run)).toBe(false);
    const dyingHero = {
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === run.hero.actorId ? { ...actor, health: 0 } : actor,
      ),
    };

    const concluded = concludeRunOnHeroDeath({
      state: dyingHero,
      content: pack,
      events: [],
      revision: dyingHero.revision + 1,
      turn: dyingHero.turn + 1,
      eventId: 'event.ordinary-death',
    });

    expect(concluded.state.conclusion).toMatchObject({ completionType: 'died' });
  });

  it('the override needs a LIVE boss: a hero dying after the boss is slain still concludes died', () => {
    const active = activatedRun();
    const slain = slayHeartBoss(active);
    const dyingHero = {
      ...slain,
      actors: slain.actors.map((actor) =>
        actor.actorId === slain.hero.actorId ? { ...actor, health: 0 } : actor,
      ),
    };
    expect(isHeartBossActive(dyingHero)).toBe(false);

    const concluded = concludeRunOnHeroDeath({
      state: dyingHero,
      content: pack,
      events: [],
      revision: dyingHero.revision + 1,
      turn: dyingHero.turn + 1,
      eventId: 'event.post-defeat-death',
    });

    expect(concluded.state.conclusion).toMatchObject({ completionType: 'died' });
  });

  it('a mid-fight run and a post-refused run survive a save round-trip', () => {
    const active = activatedRun();
    const midFight = decodeActiveRun(encodeActiveRun(active));
    expect(isHeartBossActive(midFight)).toBe(true);
    expect(heartBoss(midFight).actorId).toBe(heartBoss(active).actorId);

    const slain = validateActiveRun(slayHeartBoss(active));
    const refused = resolveCommand(slain, wait(slain.revision), context()).state;
    expect(refused.conclusion?.completionType).toBe('refused');

    const roundTripped = decodeActiveRun(encodeActiveRun(refused));
    expect(roundTripped.conclusion?.completionType).toBe('refused');
    expect(roundTripped).toEqual(refused);
  });
});
