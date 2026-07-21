import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  FINAL_CHAMBER_DEPTH,
  heroActor,
  resolveCommand,
  tabletFragmentIds,
  validateActiveRun,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
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

/** Descends the given run all the way from its current floor to depth 19, teleporting the hero
 * onto each new floor's stair-down so it never needs to actually walk there. */
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

function inChamberRun(): ActiveRun {
  const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  const atDepth19 = descendToDepth19(fresh);
  const activeFloor = atDepth19.floors.find((floor) => floor.floorId === atDepth19.activeFloorId)!;
  const stairDown = activeFloor.stairDown!;
  const onStairs = teleportHeroTo(atDepth19, stairDown);
  return descendToNextFloor(onStairs, { content: pack }).state;
}

function fragment(contentId: string, hero: ActiveRun['hero']): ItemInstance {
  return {
    itemId: `${contentId}.instance`,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: hero.actorId },
  };
}

function withAllFragments(run: ActiveRun): ActiveRun {
  const fragmentIds = tabletFragmentIds(pack);
  return {
    ...run,
    items: [...run.items, ...fragmentIds.map((id) => fragment(id, run.hero))],
  };
}

function choiceCommand(
  choice: 'become-heart' | 'turn-away' | 'break-cycle',
  expectedRevision: number,
): GameCommand {
  return {
    type: 'final-chamber-choice',
    commandId: `command.${choice}`,
    expectedRevision,
    choice,
  };
}

describe('final-chamber-choice', () => {
  it('become-heart on the Chamber floor concludes the run with became-heart, then the run is read-only', () => {
    const run = inChamberRun();
    const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
    expect(activeFloor.depth).toBe(FINAL_CHAMBER_DEPTH);

    const resolution = resolveCommand(run, choiceCommand('become-heart', 0), context());

    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.state.conclusion).toMatchObject({
      completionType: 'became-heart',
      cause: { killerContentId: null, depth: FINAL_CHAMBER_DEPTH },
      finalized: false,
    });
    expect(resolution.events.map((event) => event.type)).toContain('run.concluded');

    const revisionBefore = resolution.state.revision;
    const after = resolveCommand(
      resolution.state,
      choiceCommand('turn-away', revisionBefore),
      context(),
    );
    expect(after.result).toMatchObject({ status: 'invalid', reason: 'run.concluded' });
  });

  it('break-cycle with the full fragment set concludes the run with broke-cycle', () => {
    const run = withAllFragments(inChamberRun());

    const resolution = resolveCommand(run, choiceCommand('break-cycle', 0), context());

    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.state.conclusion).toMatchObject({
      completionType: 'broke-cycle',
      cause: { killerContentId: null, depth: FINAL_CHAMBER_DEPTH },
      finalized: false,
    });
  });

  it('break-cycle without the full fragment set is rejected, and the run stays unconcluded', () => {
    const run = inChamberRun();

    const resolution = resolveCommand(run, choiceCommand('break-cycle', 0), context());

    expect(resolution.result).toMatchObject({
      status: 'invalid',
      reason: 'final-chamber.fragments-required',
    });
    expect(resolution.state.conclusion).toBeNull();
  });

  it('rejects any choice made off the Final Chamber floor', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const activeFloor = run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
    expect(activeFloor.depth).not.toBe(FINAL_CHAMBER_DEPTH);

    const resolution = resolveCommand(run, choiceCommand('become-heart', 0), context());

    expect(resolution.result).toMatchObject({
      status: 'invalid',
      reason: 'final-chamber.unavailable',
    });
    expect(resolution.state.conclusion).toBeNull();
  });

  it('rejects any choice after the run has already concluded', () => {
    const run = inChamberRun();
    const concluded = resolveCommand(run, choiceCommand('become-heart', 0), context());
    const revisionBefore = concluded.state.revision;

    const resolution = resolveCommand(
      concluded.state,
      choiceCommand('break-cycle', revisionBefore),
      context(),
    );

    expect(resolution.result).toMatchObject({
      status: 'invalid',
      reason: 'run.concluded',
      revision: revisionBefore,
    });
  });

  it('consumes no randomness: rng bytes are unchanged by the choice', () => {
    const run = inChamberRun();
    const rngBefore = run.rng;

    const resolution = resolveCommand(run, choiceCommand('become-heart', 0), context());

    expect(resolution.state.rng).toEqual(rngBefore);
  });

  it('turn-away does not conclude the run (the boss is Task 4)', () => {
    const run = inChamberRun();

    const resolution = resolveCommand(run, choiceCommand('turn-away', 0), context());

    expect(resolution.result).toMatchObject({ status: 'applied' });
    expect(resolution.state.conclusion).toBeNull();
  });
});
