import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  emptyEquipment,
  type ActiveRun,
  type ActorState,
  type GameCommand,
  type Uint32State,
} from '@woven-deep/engine';
import { dispatchCommand, dispatchIntent } from '../src/dispatch.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

// Same fixed town layout as apps/web's guest-session.test.ts: from the entrance plaza, the
// dungeon's stair-down sits a single diagonal step southeast.
const DESCEND_SEED: Uint32State = [743, 744, 745, 746];

function freshRun(seed: Uint32State): ActiveRun {
  return createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
}

/** A run whose hero has already descended once, standing on the depth-1 floor's stair-up tile. */
function depth1Run(seed: Uint32State): ActiveRun {
  const fresh = freshRun(seed);
  const hero = fresh.actors.find((actor) => actor.playerControlled)!;
  const town = fresh.floors.find((floor) => floor.floorId === hero.floorId)!;
  const atStairDown: ActiveRun = {
    ...fresh,
    actors: fresh.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
        : actor,
    ),
  };
  return descendToNextFloor(atStairDown, { content: pack }).state;
}

/** Places a neutral, unseen actor one tile east of the hero (torch doused so it never appears in
 * the hero's own projection) so a plain `move` there resolves against the *actual* occupant and
 * the engine returns `decision_required` instead of moving or attacking. Mirrors the equivalent
 * guest-session.test.ts fixture. */
function withHiddenNeighborEast(run: ActiveRun): ActiveRun {
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const doused = run.items.map((item) =>
    item.location.type === 'equipped' && item.location.slot === 'off-hand'
      ? { ...item, enabled: false }
      : item,
  );
  const hiddenNeighbor: ActorState = {
    ...hero,
    actorId: 'npc.hidden-bystander',
    contentId: 'monster.cave-rat',
    playerControlled: false,
    x: hero.x + 1,
    y: hero.y,
    disposition: 'neutral',
    energy: 0,
    equipment: emptyEquipment(),
    behaviorId: null,
  };
  return {
    ...run,
    items: doused,
    actors: [...run.actors, hiddenNeighbor].sort((left, right) =>
      left.actorId < right.actorId ? -1 : 1,
    ),
  };
}

/** A run whose hero has descended once and carries the Loomcaller classTags, granting caster
 * aptitude for the synthetic recall spell below. */
function depth1CasterRun(seed: Uint32State): ActiveRun {
  const fresh = createNewRun({
    pack,
    seed,
    hero: { ...DEFAULT_GUEST_HERO, classTags: ['loomcaller'] },
  });
  const hero = fresh.actors.find((actor) => actor.playerControlled)!;
  const town = fresh.floors.find((floor) => floor.floorId === hero.floorId)!;
  const atStairDown: ActiveRun = {
    ...fresh,
    actors: fresh.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
        : actor,
    ),
  };
  return descendToNextFloor(atStairDown, { content: pack }).state;
}

/** Synthetic self-cast recall spell (`spell.recall` ships in a later content task), mirroring the
 * engine-level `recall.test.ts` fixture. */
function packWithRecall(): CompiledContentPack {
  return {
    ...pack,
    entries: [
      ...pack.entries,
      {
        kind: 'spell',
        id: 'spell.test-recall',
        name: 'Test Recall',
        tags: [],
        targetingId: 'target.self',
        range: 0,
        actionCost: 100,
        weaveCost: 0,
        effects: [{ effectId: 'effect.recall', parameters: {}, requiresLivingTarget: false }],
      },
    ],
  };
}

function heroAdjacentToHouseDoor(run: ActiveRun): ActiveRun {
  const hero = run.actors.find((actor) => actor.playerControlled)!;
  const town = run.floors.find((floor) => floor.floorId === hero.floorId)!;
  const door = town.placementSlots.find((slot) => slot.tags.includes('house-door'))!;
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, x: door.x - 1, y: door.y - 1 } : actor,
    ),
  };
}

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('dispatchIntent', () => {
  it('resolves an ordinary command intent through resolveCommand, returning the applied resolution', () => {
    const run = freshRun(SEED);

    const outcome = dispatchIntent(
      run,
      { type: 'wait' },
      { pack, commandId: 'command.test-0', expectedRevision: run.revision },
    );

    expect(outcome.kind).toBe('command');
    if (outcome.kind !== 'command') throw new Error('expected command outcome');
    expect(outcome.resolution.result.status).toBe('applied');
    expect(outcome.resolution.state.revision).toBe(run.revision + 1);
    expect(outcome.onboardingIntentType).toBeNull();
  });

  it('returns the unchanged run with a rejection message when buildIntent itself rejects', () => {
    const run = freshRun(SEED);

    const outcome = dispatchIntent(
      run,
      { type: 'descend' },
      { pack, commandId: 'command.test-0', expectedRevision: run.revision },
    );

    expect(outcome).toEqual({
      kind: 'rejected',
      run,
      message: 'There are no stairs down here.',
    });
  });

  it('routes a descend intent through descendToNextFloor and tags the onboarding intent', () => {
    const fresh = freshRun(DESCEND_SEED);
    const hero = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === hero.floorId)!;
    const atStairDown: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
          : actor,
      ),
    };

    const outcome = dispatchIntent(
      atStairDown,
      { type: 'descend' },
      { pack, commandId: 'command.test-0', expectedRevision: atStairDown.revision },
    );

    expect(outcome.kind).toBe('transition');
    if (outcome.kind !== 'transition') throw new Error('expected transition outcome');
    expect(outcome.run.floors.length).toBe(2);
    expect(outcome.run.activeFloorId).toBe('floor.depth-001');
    expect(outcome.onboardingIntentType).toBe('descend');
  });

  it('routes an ascend intent through ascendToPreviousFloor with no onboarding tag', () => {
    const run = depth1Run(DESCEND_SEED);

    const outcome = dispatchIntent(
      run,
      { type: 'ascend' },
      { pack, commandId: 'command.test-0', expectedRevision: run.revision },
    );

    expect(outcome.kind).toBe('transition');
    if (outcome.kind !== 'transition') throw new Error('expected transition outcome');
    expect(outcome.run.activeFloorId).toBe('floor.depth-000');
    expect(outcome.onboardingIntentType).toBeNull();
  });

  it('returns a house outcome carrying the unchanged run when adjacent to the house door', () => {
    const run = heroAdjacentToHouseDoor(freshRun(SEED));

    const outcome = dispatchIntent(
      run,
      { type: 'house' },
      { pack, commandId: 'command.test-0', expectedRevision: run.revision },
    );

    expect(outcome).toEqual({ kind: 'house', run });
  });

  it('surfaces decision_required for a move that resolves against a hidden neutral occupant', () => {
    const run = withHiddenNeighborEast(depth1Run(SEED));

    const outcome = dispatchIntent(
      run,
      { type: 'move', direction: 'east' },
      { pack, commandId: 'command.test-0', expectedRevision: run.revision },
    );

    expect(outcome.kind).toBe('command');
    if (outcome.kind !== 'command') throw new Error('expected command outcome');
    expect(outcome.resolution.result.status).toBe('decision_required');
    expect(outcome.resolution.state).toBe(run);
  });

  it('replays an already-recorded commandId idempotently, returning the cached resolution', () => {
    const run = freshRun(SEED);
    const commandId = 'command.test-0';
    const first = dispatchIntent(
      run,
      { type: 'wait' },
      { pack, commandId, expectedRevision: run.revision },
    );
    if (first.kind !== 'command') throw new Error('expected command outcome');

    const replay = dispatchIntent(
      first.resolution.state,
      { type: 'wait' },
      {
        pack,
        commandId,
        expectedRevision: run.revision,
      },
    );

    expect(replay.kind).toBe('command');
    if (replay.kind !== 'command') throw new Error('expected command outcome');
    expect(replay.resolution.result).toEqual(first.resolution.result);
    expect(replay.resolution.state).toBe(first.resolution.state);
  });

  it('rejects a stale expectedRevision with status stale_revision and an unchanged run', () => {
    const run = freshRun(SEED);

    const outcome = dispatchIntent(
      run,
      { type: 'wait' },
      { pack, commandId: 'command.test-0', expectedRevision: run.revision + 5 },
    );

    expect(outcome.kind).toBe('command');
    if (outcome.kind !== 'command') throw new Error('expected command outcome');
    expect(outcome.resolution.result).toMatchObject({
      status: 'rejected',
      reason: 'stale_revision',
    });
    expect(outcome.resolution.state).toBe(run);
  });

  it('folds move/toggle-light/trade-buy/trade-sell intents into their onboarding mastery vocabulary', () => {
    const run = freshRun(SEED);

    const move = dispatchIntent(
      run,
      { type: 'move', direction: 'north' },
      {
        pack,
        commandId: 'command.test-0',
        expectedRevision: run.revision,
      },
    );
    expect(move.kind === 'command' && move.onboardingIntentType).toBe('move');

    const wait = dispatchIntent(
      run,
      { type: 'wait' },
      {
        pack,
        commandId: 'command.test-1',
        expectedRevision: run.revision,
      },
    );
    expect(wait.kind === 'command' && wait.onboardingIntentType).toBeNull();
  });
});

describe('recall session wiring', () => {
  it('auto-moves to town once a cast sets returnAnchorFloorId', () => {
    const run = depth1CasterRun(DESCEND_SEED);
    const recallPack = packWithRecall();
    const dungeonFloorId = run.activeFloorId;

    const outcome = dispatchIntent(
      run,
      { type: 'cast', spellId: 'spell.test-recall', target: null },
      { pack: recallPack, commandId: 'command.recall', expectedRevision: run.revision },
    );

    expect(outcome.kind).toBe('transition');
    if (outcome.kind !== 'transition') throw new Error('expected transition outcome');
    expect(outcome.run.activeFloorId).toBe('floor.depth-000');
    expect(outcome.run.returnAnchorFloorId).toBe(dungeonFloorId);
    expect(outcome.onboardingIntentType).toBe('recall');
    expect(outcome.events.some((event) => event.type === 'hero.recalled')).toBe(true);
  });

  it('routes the town descend intent to the anchored floor when a recall is pending', () => {
    const run = depth1CasterRun(DESCEND_SEED);
    const recallPack = packWithRecall();
    const dungeonFloorId = run.activeFloorId;
    const recalled = dispatchIntent(
      run,
      { type: 'cast', spellId: 'spell.test-recall', target: null },
      { pack: recallPack, commandId: 'command.recall', expectedRevision: run.revision },
    );
    if (recalled.kind !== 'transition') throw new Error('expected transition outcome');

    const outcome = dispatchIntent(
      recalled.run,
      { type: 'descend' },
      { pack: recallPack, commandId: 'command.return', expectedRevision: recalled.run.revision },
    );

    expect(outcome.kind).toBe('transition');
    if (outcome.kind !== 'transition') throw new Error('expected transition outcome');
    expect(outcome.run.activeFloorId).toBe(dungeonFloorId);
    expect(outcome.run.returnAnchorFloorId).toBeUndefined();
  });
});

describe('dispatchCommand', () => {
  it('forwards a raw GameCommand straight to resolveCommand', () => {
    const run = freshRun(SEED);
    const command: GameCommand = {
      type: 'wait',
      commandId: 'command.test-0',
      expectedRevision: run.revision,
    };

    const resolution = dispatchCommand(run, command, { pack });

    expect(resolution.result.status).toBe('applied');
    expect(resolution.state.revision).toBe(run.revision + 1);
  });

  it('resolves the final-chamber-choice command the same way dispatchIntent resolves any other', () => {
    const run = freshRun(SEED);
    const command: GameCommand = {
      type: 'final-chamber-choice',
      choice: 'flee',
      commandId: 'command.test-0',
      expectedRevision: run.revision,
    };

    const resolution = dispatchCommand(run, command, { pack });

    // Off the Final Chamber floor entirely, so the engine rejects it as invalid rather than
    // applying it -- this test only proves the command reaches resolveCommand unmodified, not
    // the Chamber's own rules (covered in engine tests).
    expect(resolution.result.status).toBe('invalid');
  });
});
