import type { ObservableCell } from '@woven-deep/engine';

/** Engine terrain tokens this pass reasons about (`TILE_DEFINITIONS`, `packages/engine/src/terrain.ts`). */
const DOOR_TOKEN = 'terrain.door';
const WALL_TOKEN = 'terrain.wall';

/** Terrain a passage can run through: what the hero walks along to reach a doorway. A pillar or a
 * wall is masonry, not passage, so neither votes for an axis. */
function isPassageToken(token: string | undefined): boolean {
  return token === 'terrain.floor' || token === 'terrain.stair';
}

/** A cell lookup by grid coordinate -- the one shape both `withImpliedDoorFrames` (built off its
 * own `byIndex` array) and `IsoRenderer` (built off its `cellByKey` map) already have lying around,
 * so `doorWallAxis` takes this rather than a `cells`/`width`/`height` triple: no caller needs to
 * rebuild an index it already has just to ask this one question. */
export type CellAt = (x: number, y: number) => ObservableCell | undefined;

/**
 * The axis the wall a door at `(x, y)` is embedded in runs along, derived from which axis has
 * known passage (floor/stair) beside the door -- the exact same vote `withImpliedDoorFrames`
 * already made internally before this was extracted. `'horizontal'` means the wall runs along the
 * grid x-axis (the door's passage runs north-south, flanked by wall to the west/east);
 * `'vertical'` means the wall runs along the grid y-axis (passage runs east-west, flanked north/
 * south). Returns `null` when ambiguous -- passage on both axes, or on neither (an undiscovered or
 * mid-corridor door) -- since there is then no single wall line to reason about.
 *
 * Consumed by `IsoRenderer` to decide whether to mirror a door's leaf sprite so a door in a wall
 * running one screen diagonal doesn't render identically to one running the other.
 */
export function doorWallAxis(
  cellAt: CellAt,
  x: number,
  y: number,
): 'horizontal' | 'vertical' | null {
  const knownPassage = (px: number, py: number): boolean => isPassageToken(cellAt(px, py)?.token);
  const vertical = knownPassage(x, y - 1) || knownPassage(x, y + 1);
  const horizontal = knownPassage(x - 1, y) || knownPassage(x + 1, y);
  // Passage on both axes (or on neither) leaves no single perpendicular wall line to report.
  if (vertical === horizontal) return null;
  return vertical ? 'horizontal' : 'vertical';
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

  const implied = new Map<number, ObservableCell>();

  for (const door of cells) {
    if (door.token !== DOOR_TOKEN || door.knowledge === 'unknown') continue;

    const axis = doorWallAxis(cellAt, door.x, door.y);
    if (axis === null) continue;

    const flanks: readonly (readonly [number, number])[] =
      axis === 'horizontal'
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
