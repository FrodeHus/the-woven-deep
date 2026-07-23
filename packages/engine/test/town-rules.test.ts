import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  heroActor,
  resolveCommand,
  type ActiveRun,
  type GameCommand,
  type ResolutionContext,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [7, 14, 21, 28] as const;

function townRun(): ActiveRun {
  return createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
}

function context(): ResolutionContext {
  return { content: pack };
}

describe('town step contract', () => {
  it('lets the hero wait 50 consecutive times without ever stalling, worldTime frozen throughout', () => {
    let state = townRun();
    expect(state.floors[0]?.depth).toBe(0);
    const initialWorldTime = state.worldTime;
    const initialSurvival = state.survival;
    const initialItems = state.items;

    for (let index = 0; index < 50; index += 1) {
      const command: GameCommand = {
        type: 'wait',
        commandId: `command.town-wait-${index}`,
        expectedRevision: state.revision,
      };
      const resolution = resolveCommand(state, command, context());
      expect(resolution.result.status).toBe('applied');
      state = resolution.state;
      expect(state.worldTime).toBe(initialWorldTime);
    }

    expect(state.turn).toBe(50);
    expect(state.revision).toBe(50);
    // Hunger reserve/fuel are byte-identical: nothing time-based ever advanced.
    expect(state.survival).toEqual(initialSurvival);
    expect(state.items).toEqual(initialItems);
    // The hero is always ready again immediately: never a stall via the scheduler's normal path.
    expect(heroActor(state).energy).toBeGreaterThanOrEqual(100);
  });

  it('rejects attack, fire, cast, and throw-item in town with town.truce, leaving every RNG stream untouched', () => {
    let state = townRun();
    const hero = heroActor(state);
    const rngBefore = state.rng;
    const revisionBefore = state.revision;
    const turnBefore = state.turn;
    const commands: readonly GameCommand[] = [
      {
        type: 'attack',
        commandId: 'command.town-attack',
        expectedRevision: state.revision,
        targetActorId: hero.actorId,
      },
      {
        type: 'fire',
        commandId: 'command.town-fire',
        expectedRevision: state.revision,
        itemId: 'item.hunting-bow',
        target: { x: hero.x, y: hero.y },
      },
      {
        type: 'cast',
        commandId: 'command.town-cast',
        expectedRevision: state.revision,
        spellId: 'spell.ember-bolt',
        target: { x: hero.x, y: hero.y },
      },
      {
        type: 'throw-item',
        commandId: 'command.town-throw',
        expectedRevision: state.revision,
        itemId: 'item.pitch-torch',
        quantity: 1,
        target: { x: hero.x, y: hero.y },
      },
    ];

    for (const command of commands) {
      const resolution = resolveCommand(state, command, context());
      expect(resolution.result).toMatchObject({
        status: 'invalid',
        reason: 'town.truce',
        revision: revisionBefore,
        turn: turnBefore,
      });
      expect(resolution.events.at(-1)).toMatchObject({
        type: 'action.invalid',
        reason: 'town.truce',
      });
      expect(resolution.state.revision).toBe(revisionBefore);
      expect(resolution.state.turn).toBe(turnBefore);
      expect(resolution.state.rng).toEqual(rngBefore);
      expect(resolution.state.worldTime).toBe(state.worldTime);
      state = resolution.state;
    }
  });

  it('rejects rest in town with town.rest, leaving every RNG stream untouched', () => {
    const state = townRun();
    const rngBefore = state.rng;
    const command: GameCommand = {
      type: 'rest',
      commandId: 'command.town-rest',
      expectedRevision: state.revision,
      until: 'healed',
      maximumDuration: 500,
    };

    const resolution = resolveCommand(state, command, context());
    expect(resolution.result).toMatchObject({
      status: 'invalid',
      reason: 'town.rest',
      revision: state.revision,
      turn: state.turn,
    });
    expect(resolution.events.at(-1)).toMatchObject({ type: 'action.invalid', reason: 'town.rest' });
    expect(resolution.state.rng).toEqual(rngBefore);
    expect(resolution.state.worldTime).toBe(state.worldTime);
  });

  it('never schedules a non-hero actor while the hero is in town', () => {
    const state = townRun();
    // The town starts with the hero plus the four permanent shopkeepers; the town-step
    // contract's scheduler invariant depends on every one of them carrying `behaviorId: null`,
    // so none of them can ever be selected for a turn.
    const townActors = state.actors.filter(
      (actor) => actor.actorId !== state.hero.actorId && actor.floorId === state.activeFloorId,
    );
    expect(townActors).toHaveLength(4);
    expect(townActors.every((actor) => actor.behaviorId === null)).toBe(true);
  });
});
