import type { ObservableCell } from '@woven-deep/engine';

/** Engine terrain tokens this pass reasons about (`TILE_DEFINITIONS`, `packages/engine/src/terrain.ts`). */
const DOOR_TOKEN = 'terrain.door';
const WALL_TOKEN = 'terrain.wall';

/** Terrain a passage can run through: what the hero walks along to reach a doorway. A pillar or a
 * wall is masonry, not passage, so neither votes for an axis. */
function isPassageToken(token: string | undefined): boolean {
  return token === 'terrain.floor' || token === 'terrain.stair';
}

/**
 * Fills in the wall mass a discovered door implies but the hero has not discovered yet.
 *
 * A door is masonry standing IN a wall line: it always has passage on one axis and wall on the
 * other. Seen down a corridor, the doorway lights up while the cells either side of it are still
 * `unknown` -- and the renderer draws nothing for an unknown cell, so the arch stands alone in the
 * dark like a stage prop. This pass replaces those two undiscovered flank cells with synthetic wall
 * cells carrying the DOOR's own knowledge tier, intensity and tint, so the frame is lit and fogged
 * exactly as the door is and no cell reads as better known than the door that implies it.
 *
 * Presentation only: the projection is untouched and the synthetic cells never reach the engine.
 * Nothing is invented beyond the frame -- the passage axis must be unambiguous (known passage on
 * exactly one axis), and a flank the hero has actually discovered always keeps its real terrain.
 *
 * Pure and order-preserving: returns the input array itself when there is nothing to imply, so the
 * bake key and the identity checks downstream stay cheap.
 */
export function withImpliedDoorFrames(
  cells: readonly ObservableCell[],
  width: number,
  height: number,
): readonly ObservableCell[] {
  const byIndex: (ObservableCell | undefined)[] = Array.from(
    { length: width * height },
    (): ObservableCell | undefined => undefined,
  );
  for (const cell of cells) byIndex[cell.y * width + cell.x] = cell;

  const cellAt = (x: number, y: number): ObservableCell | undefined => {
    if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
    return byIndex[y * width + x];
  };
  const knownPassage = (x: number, y: number): boolean => {
    const neighbour = cellAt(x, y);
    return neighbour !== undefined && isPassageToken(neighbour.token);
  };

  const implied = new Map<number, ObservableCell>();

  for (const door of cells) {
    if (door.token !== DOOR_TOKEN || door.knowledge === 'unknown') continue;

    const vertical = knownPassage(door.x, door.y - 1) || knownPassage(door.x, door.y + 1);
    const horizontal = knownPassage(door.x - 1, door.y) || knownPassage(door.x + 1, door.y);
    // Passage on both axes (or on neither) leaves no single perpendicular to frame.
    if (vertical === horizontal) continue;

    const flanks: readonly (readonly [number, number])[] = vertical
      ? [
          [door.x - 1, door.y],
          [door.x + 1, door.y],
        ]
      : [
          [door.x, door.y - 1],
          [door.x, door.y + 1],
        ];

    for (const [fx, fy] of flanks) {
      const flank = cellAt(fx, fy);
      if (flank === undefined || flank.knowledge !== 'unknown') continue;
      const frame: ObservableCell = {
        index: flank.index,
        x: flank.x,
        y: flank.y,
        knowledge: door.knowledge,
        token: WALL_TOKEN,
        intensity: door.intensity,
        ...(door.tint === undefined ? {} : { tint: door.tint }),
      };
      implied.set(flank.index, frame);
    }
  }

  if (implied.size === 0) return cells;
  return cells.map((cell) => implied.get(cell.index) ?? cell);
}
