import { describe, expect, it } from 'vitest';
import {
  computeFieldOfView,
  createDemoRun,
  stableJson,
  validateTarget,
  type ActorState,
  type TileId,
} from '../src/index.js';

function fixture(input: Readonly<{ hidden?: boolean; wall?: boolean; range?: number }> = {}) {
  const run = createDemoRun();
  const source = { ...run.actors[0]!, x: 1, y: 1 };
  const target: ActorState = {
    ...source, actorId: 'monster.hidden', contentId: 'monster.hidden', playerControlled: false,
    x: 4, disposition: 'hostile',
  };
  const tiles = Array<TileId>(21).fill(1);
  if (input.wall) tiles[1 * 7 + 3] = 0;
  const floor = { ...run.floors[0]!, width: 7, height: 3, tiles };
  const visibilityWords = input.hidden ? [0] : computeFieldOfView({
    width: floor.width, height: floor.height, tiles, origin: source, radius: 10,
  });
  return {
    targetingId: 'target.actor' as const,
    sourceActor: source,
    targetActorId: target.actorId,
    target: null,
    floor,
    actors: [source, target],
    visibilityWords,
    illumination: { intensity: Array<number>(tiles.length).fill(1) },
    range: input.range ?? 5,
  };
}

describe('target validation', () => {
  it('accepts a visible unobstructed line target', () => {
    expect(validateTarget(fixture())).toEqual({
      ok: true,
      cells: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
      targetActorId: 'monster.hidden',
    });
  });

  it('does not return a hidden actor ID in an invalid public reason', () => {
    const result = validateTarget(fixture({ hidden: true }));
    expect(result).toEqual({ ok: false, reason: 'target.not_visible' });
    expect(stableJson(result)).not.toContain('monster.hidden');
  });

  it('does not allow targeting an actor in absolute darkness', () => {
    const input = fixture();
    const intensity = [...input.illumination.intensity];
    intensity[1 * input.floor.width + 4] = 0;
    expect(validateTarget({ ...input, illumination: { intensity } })).toEqual({
      ok: false, reason: 'target.not_visible',
    });
  });

  it('rejects blocked and out-of-range targets with public reasons', () => {
    expect(validateTarget({
      ...fixture({ wall: true }), targetingId: 'target.line', targetActorId: null,
      target: { x: 4, y: 1 }, visibilityWords: [0xffff_ffff],
    })).toEqual({ ok: false, reason: 'target.blocked' });
    expect(validateTarget(fixture({ range: 2 }))).toEqual({ ok: false, reason: 'target.out_of_range' });
  });

  it('supports self and visible cell targeting', () => {
    const input = fixture();
    expect(validateTarget({ ...input, targetingId: 'target.self', targetActorId: null })).toEqual({
      ok: true, cells: [{ x: 1, y: 1 }], targetActorId: 'hero.demo',
    });
    expect(validateTarget({ ...input, targetingId: 'target.cell', targetActorId: null, target: { x: 2, y: 1 } })).toEqual({
      ok: true, cells: [{ x: 2, y: 1 }],
    });
  });
});
