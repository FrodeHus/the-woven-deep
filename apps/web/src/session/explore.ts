import type { GameplayProjection, Point } from '@woven-deep/engine';
import { actorsOf, heroOf } from './projection-view.js';
import { cellNavigability } from './travel.js';

/**
 * Client-side auto-explore planning: a breadth-first search from the hero to the nearest FRONTIER
 * cell -- a navigable cell with at least one 8-neighbour the hero has never discovered. Walking
 * there is what actually grows the map, so "explore" is just repeated travel to the closest edge of
 * the known world. The stepper re-plans this every step (knowledge expands as the hero walks, so a
 * cached path is wrong more often than it is right); an 8 000-cell BFS per turn is negligible.
 */

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Does `(x, y)` touch a never-discovered cell? Off-grid neighbours are the map edge, not unknown
 * ground, so they never make a cell a frontier. */
function touchesUnknown(projection: GameplayProjection, x: number, y: number): boolean {
  const { floor } = projection;
  for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
    if (floor.cells[ny * floor.width + nx]!.knowledge === 'unknown') return true;
  }
  return false;
}

/**
 * The path (origin excluded, exactly like `computeTravelPath`) from the hero to the nearest
 * reachable frontier cell, or `null` when the floor holds no frontier the hero can walk to -- which
 * the caller reports as "You have explored this floor."
 *
 * Navigability is `cellNavigability`, verbatim: known terrain, passable token, no engaged lock. A
 * cell occupied by a perceived actor is impassable (auto-explore never blunders into anyone), and
 * the hero's own cell is never a target -- a zero-length path cannot be walked.
 */
export function computeExplorePath(projection: GameplayProjection): readonly Point[] | null {
  const { floor } = projection;
  const hero = heroOf(projection);
  const occupied = new Set(actorsOf(projection).map((actor) => `${actor.x},${actor.y}`));
  const size = floor.width * floor.height;
  const origin = hero.y * floor.width + hero.x;

  const previous = new Int32Array(size).fill(-1);
  const seen = new Uint8Array(size);
  seen[origin] = 1;

  // Layer-by-layer BFS: the first frontier reached is the nearest by step count, and neighbour
  // order is fixed, so the choice among equidistant frontiers is deterministic.
  let frontierQueue: number[] = [origin];
  while (frontierQueue.length > 0) {
    const next: number[] = [];
    for (const index of frontierQueue) {
      const x = index % floor.width;
      const y = (index - x) / floor.width;
      if (index !== origin && touchesUnknown(projection, x, y)) {
        const path: Point[] = [];
        let cursor = index;
        while (cursor !== origin) {
          const cx = cursor % floor.width;
          path.push({ x: cx, y: (cursor - cx) / floor.width });
          cursor = previous[cursor]!;
        }
        return path.reverse();
      }
      for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
        const neighbour = ny * floor.width + nx;
        if (seen[neighbour] === 1) continue;
        if (cellNavigability(projection, { x: nx, y: ny }) !== 'navigable') continue;
        if (occupied.has(`${nx},${ny}`)) continue;
        seen[neighbour] = 1;
        previous[neighbour] = index;
        next.push(neighbour);
      }
    }
    frontierQueue = next;
  }
  return null;
}
