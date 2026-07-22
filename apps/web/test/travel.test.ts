import { describe, expect, it, vi } from 'vitest';
import type { GameplayProjection, Point } from '@woven-deep/engine';
import type { PlayerIntent } from '../src/session/intents.js';
import {
  advanceTravel,
  beginTravel,
  computeTravelPath,
  directionBetween,
  resolveClick,
  type TravelPlan,
} from '../src/session/travel.js';
import { buildIntent } from '@woven-deep/session-core';

const WIDTH = 12;
const HEIGHT = 8;

interface Actor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
}

interface Item {
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly identified: boolean;
}

/** A minimal open floor of visible passable cells with optional walls at the given coordinates. */
function makeProjection(input: {
  hero: Point & { health?: number };
  actors?: readonly Actor[];
  groundItems?: readonly Item[];
  walls?: readonly Point[];
}): GameplayProjection {
  const wallSet = new Set((input.walls ?? []).map((point) => `${point.x},${point.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const wall = wallSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: 'visible' as const,
        tileId: wall ? 0 : 1,
        glyph: wall ? '#' : '.',
        token: wall ? 'terrain.wall' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: { actorId: 'hero', x: input.hero.x, y: input.hero.y, health: input.hero.health ?? 10 },
    actors: input.actors ?? [],
    groundItems: input.groundItems ?? [],
  } as unknown as GameplayProjection;
}

describe('directionBetween', () => {
  it('maps each adjacent delta to a king-move direction', () => {
    const from = { x: 5, y: 5 };
    expect(directionBetween(from, { x: 5, y: 4 })).toBe('north');
    expect(directionBetween(from, { x: 6, y: 4 })).toBe('northeast');
    expect(directionBetween(from, { x: 6, y: 5 })).toBe('east');
    expect(directionBetween(from, { x: 6, y: 6 })).toBe('southeast');
    expect(directionBetween(from, { x: 5, y: 6 })).toBe('south');
    expect(directionBetween(from, { x: 4, y: 6 })).toBe('southwest');
    expect(directionBetween(from, { x: 4, y: 5 })).toBe('west');
    expect(directionBetween(from, { x: 4, y: 4 })).toBe('northwest');
  });

  it('returns null for the same cell or a non-adjacent target', () => {
    expect(directionBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    expect(directionBetween({ x: 5, y: 5 }, { x: 8, y: 5 })).toBeNull();
  });
});

describe('computeTravelPath', () => {
  it('routes across open floor and refuses cells blocked by a bystander actor', () => {
    const bystander: Actor = { actorId: 'a', x: 6, y: 5, disposition: 'neutral', health: 5 };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, actors: [bystander] });
    const path = computeTravelPath({ projection, destination: { x: 7, y: 5 } });
    expect(path).not.toBeNull();
    expect(path!.some((step) => step.x === 6 && step.y === 5)).toBe(false);
  });

  it('returns null when the destination is unreachable', () => {
    const projection = makeProjection({
      hero: { x: 1, y: 1 },
      walls: [
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 3, y: 4 },
        { x: 3, y: 5 },
        { x: 3, y: 6 },
        { x: 3, y: 7 },
      ],
    });
    expect(computeTravelPath({ projection, destination: { x: 6, y: 4 } })).toBeNull();
  });
});

describe('resolveClick', () => {
  it('plans a single move onto an adjacent empty floor cell', () => {
    const projection = makeProjection({ hero: { x: 5, y: 5 } });
    const plan = resolveClick(projection, { x: 6, y: 5 });
    expect(plan).toEqual<TravelPlan>({ steps: [{ x: 6, y: 5 }], onArrive: null });
  });

  it('plans a multi-step walk to a distant reachable cell', () => {
    const projection = makeProjection({ hero: { x: 5, y: 5 } });
    const plan = resolveClick(projection, { x: 8, y: 5 });
    expect(plan?.steps.length).toBe(3);
    expect(plan?.steps.at(-1)).toEqual({ x: 8, y: 5 });
    expect(plan?.onArrive).toBeNull();
  });

  it('plans a walk ending on a hostile cell (the terminal move becomes an attack)', () => {
    const hostile: Actor = { actorId: 'rat', x: 8, y: 5, disposition: 'hostile', health: 4 };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, actors: [hostile] });
    const plan = resolveClick(projection, { x: 8, y: 5 });
    expect(plan?.steps.at(-1)).toEqual({ x: 8, y: 5 });
    expect(plan?.onArrive).toBeNull();
  });

  it('does not plan travel to a non-hostile actor', () => {
    const npc: Actor = { actorId: 'npc', x: 6, y: 5, disposition: 'neutral', health: 5 };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, actors: [npc] });
    expect(resolveClick(projection, { x: 6, y: 5 })).toBeNull();
  });

  it('plans a pickup on arrival when the target cell holds a floor item', () => {
    const item: Item = {
      itemId: 'i1',
      x: 7,
      y: 5,
      name: 'Iron sword',
      category: 'weapon',
      quantity: 1,
      identified: true,
    };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, groundItems: [item] });
    const plan = resolveClick(projection, { x: 7, y: 5 });
    expect(plan?.onArrive).toBe('pickup');
    expect(plan?.steps.at(-1)).toEqual({ x: 7, y: 5 });
  });

  it('picks up immediately (no steps) when clicking the item on the hero own cell', () => {
    const item: Item = {
      itemId: 'i1',
      x: 5,
      y: 5,
      name: 'Iron sword',
      category: 'weapon',
      quantity: 1,
      identified: true,
    };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, groundItems: [item] });
    expect(resolveClick(projection, { x: 5, y: 5 })).toEqual<TravelPlan>({
      steps: [],
      onArrive: 'pickup',
    });
  });

  it('returns null for the hero own empty cell', () => {
    const projection = makeProjection({ hero: { x: 5, y: 5 } });
    expect(resolveClick(projection, { x: 5, y: 5 })).toBeNull();
  });
});

describe('advanceTravel', () => {
  it('dispatches the first move toward the next step and awaits it', () => {
    const projection = makeProjection({ hero: { x: 5, y: 5 } });
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const plan: TravelPlan = { steps: [{ x: 6, y: 5 }], onArrive: null };
    const next = advanceTravel({ projection, travel: beginTravel(projection, plan), dispatch });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'move', direction: 'east' });
    expect(next?.awaiting).toEqual({ x: 6, y: 5 });
  });

  it('advances the cursor only once the projection confirms the hero reached the awaited cell', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const plan: TravelPlan = {
      steps: [
        { x: 6, y: 5 },
        { x: 7, y: 5 },
      ],
      onArrive: null,
    };
    const afterFirst = advanceTravel({
      projection: start,
      travel: beginTravel(start, plan),
      dispatch,
    })!;
    const moved = makeProjection({ hero: { x: 6, y: 5 } });
    const afterSecond = advanceTravel({ projection: moved, travel: afterFirst, dispatch });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'move', direction: 'east' });
    expect(afterSecond?.awaiting).toEqual({ x: 7, y: 5 });
  });

  it('stops (returns null) when the awaited step did not move the hero (blocked)', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const plan: TravelPlan = {
      steps: [
        { x: 6, y: 5 },
        { x: 7, y: 5 },
      ],
      onArrive: null,
    };
    const afterFirst = advanceTravel({
      projection: start,
      travel: beginTravel(start, plan),
      dispatch,
    })!;
    // Hero did NOT advance (e.g. a hostile struck, or a door merely opened).
    const stuck = makeProjection({ hero: { x: 5, y: 5 } });
    expect(advanceTravel({ projection: stuck, travel: afterFirst, dispatch })).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('interrupts when the hero lost health this turn', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5, health: 10 } });
    const plan: TravelPlan = {
      steps: [
        { x: 6, y: 5 },
        { x: 7, y: 5 },
      ],
      onArrive: null,
    };
    const afterFirst = advanceTravel({
      projection: start,
      travel: beginTravel(start, plan),
      dispatch,
    })!;
    const hurt = makeProjection({ hero: { x: 6, y: 5, health: 7 } });
    expect(advanceTravel({ projection: hurt, travel: afterFirst, dispatch })).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('interrupts when a hostile not visible at the start appears', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const plan: TravelPlan = {
      steps: [
        { x: 6, y: 5 },
        { x: 7, y: 5 },
      ],
      onArrive: null,
    };
    const afterFirst = advanceTravel({
      projection: start,
      travel: beginTravel(start, plan),
      dispatch,
    })!;
    const ambush = makeProjection({
      hero: { x: 6, y: 5 },
      actors: [{ actorId: 'rat', x: 8, y: 5, disposition: 'hostile', health: 4 }],
    });
    expect(advanceTravel({ projection: ambush, travel: afterFirst, dispatch })).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('fires the pickup intent on arrival at the destination', () => {
    const dispatch = vi.fn<(intent: PlayerIntent) => void>();
    const start = makeProjection({ hero: { x: 5, y: 5 } });
    const plan: TravelPlan = { steps: [{ x: 6, y: 5 }], onArrive: 'pickup' };
    const afterFirst = advanceTravel({
      projection: start,
      travel: beginTravel(start, plan),
      dispatch,
    })!;
    const arrived = makeProjection({ hero: { x: 6, y: 5 } });
    expect(advanceTravel({ projection: arrived, travel: afterFirst, dispatch })).toBeNull();
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'pickup' });
  });
});

describe('click-hostile grounding: the terminal move resolves to an attack command', () => {
  it("a move into a hostile's cell builds an `attack` command targeting it", () => {
    const hostile: Actor = {
      actorId: 'monster.rat',
      x: 6,
      y: 5,
      disposition: 'hostile',
      health: 4,
    };
    const projection = makeProjection({ hero: { x: 5, y: 5 }, actors: [hostile] });
    // The step auto-travel dispatches for a hostile click is a plain `move` toward it (east) --
    // the command builder is what converts that into an attack, exactly as manual play does.
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection,
      commandId: 'command.test',
      expectedRevision: 0,
    });
    expect(built.kind).toBe('command');
    expect(built).toMatchObject({
      kind: 'command',
      command: { type: 'attack', targetActorId: 'monster.rat' },
    });
  });
});
