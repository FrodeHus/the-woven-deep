import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { GameplayProjection, Point } from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { MinimapPanel } from '../src/ui/panels/MinimapPanel.js';

const WIDTH = 12;
const HEIGHT = 8;

interface Actor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly disposition: string;
  readonly health: number;
}

/** A grid of visible floor with optional walls, locked doors, actors and never-discovered cells. */
function makeProjection(input: {
  hero: Point;
  walls?: readonly Point[];
  unknownCells?: readonly Point[];
  lockedDoors?: readonly Point[];
  actors?: readonly Actor[];
}): GameplayProjection {
  const wallSet = new Set((input.walls ?? []).map((p) => `${p.x},${p.y}`));
  const unknownSet = new Set((input.unknownCells ?? []).map((p) => `${p.x},${p.y}`));
  const doorSet = new Set((input.lockedDoors ?? []).map((p) => `${p.x},${p.y}`));
  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const wall = wallSet.has(`${x},${y}`);
      const door = doorSet.has(`${x},${y}`);
      cells.push({
        index: y * WIDTH + x,
        x,
        y,
        knowledge: unknownSet.has(`${x},${y}`) ? ('unknown' as const) : ('visible' as const),
        tileId: wall ? 0 : 1,
        glyph: wall ? '#' : door ? '+' : '.',
        token: wall ? 'terrain.wall' : door ? 'terrain.door' : 'terrain.floor',
        intensity: 255,
      });
    }
  }
  return {
    floor: { floorId: 'floor.test', depth: 1, town: false, width: WIDTH, height: HEIGHT, cells },
    hero: { x: input.hero.x, y: input.hero.y, health: 20, backpack: [], backpackCapacity: 10 },
    actors: input.actors ?? [],
    groundItems: [],
    features: (input.lockedDoors ?? []).map((p, index) => ({
      featureId: `feature.door.${index}`,
      type: 'door',
      state: 'locked',
      x: p.x,
      y: p.y,
    })),
  } as unknown as GameplayProjection;
}

function snapshotWithUnknownAt(cell: Point): SessionSnapshot {
  const projection = makeProjection({ hero: { x: 5, y: 4 }, unknownCells: [cell] });
  // `heroLightIsOut` blanks the minimap outside town unless some equipment slot is `enabled`.
  const lit = {
    ...projection,
    hero: { ...projection.hero, equipment: { offHand: { itemId: 'item.torch', enabled: true } } },
  };
  return { projection: lit } as unknown as SessionSnapshot;
}

describe('MinimapPanel click-to-travel', () => {
  it('clicking a known cell asks auto-travel to walk there; unknown cells are inert', () => {
    const onTravelTo = vi.fn();
    const { container } = render(
      <MinimapPanel snapshot={snapshotWithUnknownAt({ x: 3, y: 2 })} onTravelTo={onTravelTo} />,
    );
    const known = container.querySelector('[data-cell="5,4"]');
    expect(known).not.toBeNull();
    fireEvent.click(known!);
    expect(onTravelTo).toHaveBeenCalledWith({ x: 5, y: 4 });

    expect(container.querySelector('[data-cell="3,2"]')).toBeNull();
  });
});
