import type { GameplayProjection, Point } from '@woven-deep/engine';
import { heroOf } from './projection-view.js';

/**
 * Finding the stairs the hero has actually seen. Both stair tiles share the `terrain.stair` token,
 * so the glyph is what separates down (`>`) from up (`<`) -- the same rule the minimap's stair
 * markers and the playfield's stair glow already use.
 */

export type StairDirection = 'down' | 'up';

function glyphFor(direction: StairDirection): '>' | '<' {
  return direction === 'down' ? '>' : '<';
}

/** Is the hero standing on a stair leading `direction`? When true, the `>`/`<` key means today's
 * ordinary `descend`/`ascend` intent, not travel. */
export function stairUnderHero(projection: GameplayProjection, direction: StairDirection): boolean {
  const hero = heroOf(projection);
  const { floor } = projection;
  const cell = floor.cells[hero.y * floor.width + hero.x];
  if (!cell || cell.knowledge === 'unknown' || cell.token !== 'terrain.stair') return false;
  return cell.glyph === glyphFor(direction);
}

/** The discovered stair of that direction nearest the hero (Chebyshev distance, ties broken by
 * row-major cell order so the choice is deterministic), or `null` when none has been found. */
export function findDiscoveredStair(
  projection: GameplayProjection,
  direction: StairDirection,
): Point | null {
  const hero = heroOf(projection);
  const glyph = glyphFor(direction);
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of projection.floor.cells) {
    if (cell.knowledge === 'unknown' || cell.token !== 'terrain.stair' || cell.glyph !== glyph)
      continue;
    const distance = Math.max(Math.abs(cell.x - hero.x), Math.abs(cell.y - hero.y));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: cell.x, y: cell.y };
    }
  }
  return best;
}
