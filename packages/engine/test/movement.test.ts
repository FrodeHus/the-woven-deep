import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  directionDelta,
  movementAction,
  type Direction,
  type TileId,
} from '../src/index.js';

function fixture(
  direction: Direction,
  options: Readonly<{
    tiles?: readonly TileId[];
    targetDisposition?: 'friendly' | 'neutral' | 'hostile';
  }> = {},
) {
  const run = createDemoRun();
  const actor = { ...run.actors[0]!, x: 1, y: 1 };
  const floor = {
    ...run.floors[0]!,
    width: 3,
    height: 3,
    tiles: options.tiles ?? Array<TileId>(9).fill(1),
  };
  const target = options.targetDisposition
    ? {
        ...actor,
        actorId: 'monster.target',
        contentId: 'monster.target',
        playerControlled: false,
        x: 2,
        disposition: options.targetDisposition,
      }
    : undefined;
  return {
    actor,
    floor,
    actors: target ? [actor, target] : [actor],
    features: [],
    relationships: [],
    direction,
    cost: 100,
  } as const;
}

describe('movement classification', () => {
  it.each([
    ['northwest', -1, -1],
    ['north', 0, -1],
    ['northeast', 1, -1],
    ['west', -1, 0],
    ['east', 1, 0],
    ['southwest', -1, 1],
    ['south', 0, 1],
    ['southeast', 1, 1],
  ] as const)('maps %s to its delta', (direction, x, y) => {
    expect(directionDelta(direction)).toEqual({ x, y });
  });

  it('rejects a diagonal between blocking side cells', () => {
    const tiles = [1, 1, 1, 1, 1, 0, 1, 0, 1] as const;
    expect(movementAction(fixture('southeast', { tiles }))).toEqual({
      status: 'invalid',
      reason: 'blocked.corner',
    });
  });

  it('classifies hostile, friendly, and neutral occupied destinations', () => {
    expect(movementAction(fixture('east', { targetDisposition: 'hostile' }))).toEqual({
      status: 'bump-attack',
      targetActorId: 'monster.target',
      cost: 100,
    });
    expect(movementAction(fixture('east', { targetDisposition: 'friendly' }))).toEqual({
      status: 'invalid',
      reason: 'blocked.actor',
    });
    expect(movementAction(fixture('east', { targetDisposition: 'neutral' }))).toEqual({
      status: 'decision_required',
      decision: { type: 'confirm-aggression', targetActorId: 'monster.target' },
    });
  });

  it('uses a prior hostility relationship over an NPC default disposition', () => {
    const input = fixture('east', { targetDisposition: 'neutral' });
    expect(
      movementAction({
        ...input,
        relationships: [
          { leftActorId: 'hero.demo', rightActorId: 'monster.target', relationship: 'hostile' },
        ],
      }),
    ).toEqual({ status: 'bump-attack', targetActorId: 'monster.target', cost: 100 });
  });

  it('uses mutable door state instead of treating every door cover tile as closed', () => {
    const input = fixture('east', { tiles: [1, 1, 1, 1, 1, 2, 1, 1, 1] });
    expect(
      movementAction({
        ...input,
        features: [
          {
            featureId: 'door.test',
            type: 'door',
            floorId: input.floor.floorId,
            x: 2,
            y: 1,
            contentId: null,
            coverTileId: 2,
            state: 'open',
          },
        ],
      }),
    ).toEqual({ status: 'move', to: { x: 2, y: 1 }, cost: 100 });
  });
});
