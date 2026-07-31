import { describe, expect, it, vi } from 'vitest';
import type { GameplayProjection, Point, PublicEvent } from '@woven-deep/engine';
import type { PlayerIntent } from '../src/session/intents.js';
import type { GroundItemView } from '../src/session/projection-view.js';
import {
  advanceTravel,
  baseStopPredicate,
  beginTravel,
  classicStopPredicate,
} from '../src/session/travel.js';
import type { AutoPickupPolicy } from '../src/session/auto-pickup.js';

const WIDTH = 12;
const HEIGHT = 8;

interface Actor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
}

function makeProjection(input: {
  hero: Point & { health?: number };
  actors?: readonly Actor[];
  groundItems?: readonly Partial<GroundItemView>[];
  stairs?: readonly Point[];
  unknownCells?: readonly Point[];
}): GameplayProjection {
  const stairSet = new Set((input.stairs ?? []).map((p) => `${p.x},${p.y}`));
  const unknownSet = new Set((input.unknownCells ?? []).map((p) => `${p.x},${p.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const stair = stairSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: unknownSet.has(`${x},${y}`) ? ('unknown' as const) : ('visible' as const),
        tileId: 1,
        glyph: stair ? '>' : '.',
        token: stair ? 'terrain.stair' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: {
      x: input.hero.x,
      y: input.hero.y,
      health: input.hero.health ?? 20,
      backpack: [],
      backpackCapacity: 10,
    },
    actors: input.actors ?? [],
    groundItems: (input.groundItems ?? []).map((item) => ({
      itemId: 'item.a',
      name: 'Thing',
      category: 'misc',
      quantity: 1,
      identified: true,
      x: 0,
      y: 0,
      ...item,
    })),
    features: [],
  } as unknown as GameplayProjection;
}

const takeNothing: AutoPickupPolicy = () => false;
const takeEverything: AutoPickupPolicy = () => true;

function stopWith(
  start: GameplayProjection,
  projection: GameplayProjection,
  lastEvents: readonly PublicEvent[] = [],
  autoPickup: AutoPickupPolicy = takeNothing,
): ReturnType<ReturnType<typeof classicStopPredicate>> {
  return classicStopPredicate({ start, autoPickup })({ projection, lastEvents });
}

describe('baseStopPredicate', () => {
  it('stops on lost health and on a hostile that was not already visible', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const predicate = baseStopPredicate(start);
    expect(predicate({ projection: start, lastEvents: [] })).toBeNull();
    expect(
      predicate({
        projection: makeProjection({ hero: { x: 5, y: 5, health: 19 } }),
        lastEvents: [],
      }),
    ).toBe('hero-damaged');
    expect(
      predicate({
        projection: makeProjection({
          hero: { x: 5, y: 5 },
          actors: [{ actorId: 'rat', x: 7, y: 5, disposition: 'hostile', health: 4 }],
        }),
        lastEvents: [],
      }),
    ).toBe('hostile-appeared');
  });
});

describe('classicStopPredicate', () => {
  it('stops when a ground item the policy declines comes into view', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const spotted = makeProjection({
      hero: { x: 5, y: 5 },
      groundItems: [{ itemId: 'item.sword', category: 'weapon', x: 7, y: 5 }],
    });
    expect(stopWith(start, spotted)).toBe('item-spotted');
  });

  it('does NOT stop for an item the auto-pickup policy would take', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const spotted = makeProjection({
      hero: { x: 5, y: 5 },
      groundItems: [{ itemId: 'item.gold', category: 'currency', x: 7, y: 5 }],
    });
    expect(stopWith(start, spotted, [], takeEverything)).toBeNull();
  });

  it('stops when a stair leaves the unknown', () => {
    const start = makeProjection({
      hero: { x: 5, y: 5 },
      stairs: [{ x: 9, y: 5 }],
      unknownCells: [{ x: 9, y: 5 }],
    });
    const revealed = makeProjection({ hero: { x: 5, y: 5 }, stairs: [{ x: 9, y: 5 }] });
    expect(stopWith(start, revealed)).toBe('stair-found');
  });

  it('maps each interrupting event to its reason', () => {
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const cases: readonly (readonly [PublicEvent, string])[] = [
      [{ type: 'feature.revealed' } as PublicEvent, 'feature-revealed'],
      [{ type: 'hunger.stage-changed', stage: 'hungry' } as unknown as PublicEvent, 'hunger'],
      [{ type: 'fuel.warning', fuel: 5 } as unknown as PublicEvent, 'light'],
      [{ type: 'item.light-extinguished' } as PublicEvent, 'light'],
      [
        { type: 'sound.heard', category: 'combat', direction: 'north' } as unknown as PublicEvent,
        'sound',
      ],
      [
        { type: 'action.invalid', reason: 'blocked.door' } as unknown as PublicEvent,
        'action-invalid',
      ],
    ];
    for (const [event, reason] of cases) {
      expect(stopWith(start, start, [event])).toBe(reason);
    }
  });
});

describe('advanceTravel with the generalized stepper', () => {
  it('holds the cursor across an auto-pickup turn and then resumes the walk', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const gold: Partial<GroundItemView> = { itemId: 'item.gold', category: 'currency', x: 6, y: 5 };
    const start = makeProjection({ hero: { x: 5, y: 5 }, groundItems: [gold] });
    const travel = beginTravel(
      start,
      {
        steps: [
          { x: 6, y: 5 },
          { x: 7, y: 5 },
        ],
        onArrive: null,
      },
      { mode: 'stairs', autoPickup: takeEverything, stopWhen: () => null },
    );

    // Step one: an ordinary move east onto the gold.
    const first = advanceTravel({ projection: start, travel, dispatch });
    expect(first.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', direction: 'east' });

    // Arrived on the gold: the next turn is a pickup, and the cursor must NOT advance for it.
    const onGold = makeProjection({ hero: { x: 6, y: 5 }, groundItems: [gold] });
    const second = advanceTravel({
      projection: onGold,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(second.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'pickup' });

    // The gold is gone and the hero has not moved: the walk resumes with the SECOND step.
    const afterPickup = makeProjection({ hero: { x: 6, y: 5 } });
    const third = advanceTravel({
      projection: afterPickup,
      travel: (second as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(third.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', direction: 'east' });
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('stops rather than looping when the pickup it dispatched left the item on the floor', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const potion: Partial<GroundItemView> = {
      itemId: 'item.potion',
      category: 'potion',
      x: 5,
      y: 5,
    };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, groundItems: [potion] });
    const travel = beginTravel(
      projection,
      { steps: [{ x: 6, y: 5 }], onArrive: null },
      { mode: 'stairs', autoPickup: takeEverything, stopWhen: () => null },
    );
    const first = advanceTravel({ projection, travel, dispatch });
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'pickup' });
    const second = advanceTravel({
      projection,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(second).toEqual({ status: 'stopped', reason: 'blocked' });
  });

  it('reports the engine reason, not the silent blocked, when the refused step emitted action.invalid', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const travel = beginTravel(
      start,
      { steps: [{ x: 6, y: 5 }], onArrive: null },
      { mode: 'explore', stopWhen: classicStopPredicate({ start, autoPickup: takeNothing }) },
    );
    const first = advanceTravel({ projection: start, travel, dispatch });
    // The move was refused: the hero did not reach the awaited cell AND the engine said why.
    const outcome = advanceTravel({
      projection: start,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
      lastEvents: [{ type: 'action.invalid', reason: 'blocked.door' } as unknown as PublicEvent],
    });
    expect(outcome).toEqual({ status: 'stopped', reason: 'action-invalid' });
  });

  it('reports hero-damaged when the ambush that cost the step also drew blood', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const travel = beginTravel(start, { steps: [{ x: 6, y: 5 }], onArrive: null });
    const first = advanceTravel({ projection: start, travel, dispatch });
    const hurt = makeProjection({ hero: { x: 5, y: 5, health: 14 } });
    expect(
      advanceTravel({
        projection: hurt,
        travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
        dispatch,
      }),
    ).toEqual({ status: 'stopped', reason: 'hero-damaged' });
  });

  it('still falls back to blocked when nothing explains the desync', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const travel = beginTravel(start, { steps: [{ x: 6, y: 5 }], onArrive: null });
    const first = advanceTravel({ projection: start, travel, dispatch });
    expect(
      advanceTravel({
        projection: start,
        travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
        dispatch,
      }),
    ).toEqual({ status: 'stopped', reason: 'blocked' });
  });

  it('re-plans every step in explore mode and reports arrival when the planner runs dry', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const projection = makeProjection({ hero: { x: 5, y: 5 } });
    const replan = vi
      .fn<(input: GameplayProjection) => readonly Point[] | null>()
      .mockReturnValueOnce([{ x: 6, y: 5 }])
      .mockReturnValueOnce(null);
    const travel = beginTravel(
      projection,
      { steps: [], onArrive: null },
      { mode: 'explore', replan, stopWhen: () => null },
    );
    const first = advanceTravel({ projection, travel, dispatch });
    expect(first.status).toBe('stepping');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', direction: 'east' });

    const moved = makeProjection({ hero: { x: 6, y: 5 } });
    const second = advanceTravel({
      projection: moved,
      travel: (first as { travel: ReturnType<typeof beginTravel> }).travel,
      dispatch,
    });
    expect(second).toEqual({ status: 'arrived' });
    expect(replan).toHaveBeenCalledTimes(2);
  });
});
