import { findPath, type Direction, type GameplayProjection, type Point } from '@woven-deep/engine';
import type { PlayerIntent } from './intents.js';
import { actorsOf, groundItemsOf, heroOf } from './projection-view.js';

/**
 * Client-side auto-travel: turning a clicked floor cell into the SAME stream of one-step `move`
 * (and `pickup`) `PlayerIntent`s a keyboard player would issue, one per turn. Nothing here
 * fabricates movement -- every step is a real intent the engine validates -- so a click produces a
 * command stream indistinguishable from manual play (no determinism concern). The React loop that
 * paces one step per authoritative projection lives in `ui/hooks/useAutoTravel.ts`; this module is
 * the framework-free planning + single-step advance it drives.
 */

/** Terrain a travel path may route across. Floors and stairs are walkable outright; a closed door is
 * only *potentially* traversable -- the path may end/step there, where the ordinary `move` intent
 * auto-opens it (see `command-builder.ts`), and the advance loop then stops because opening a door
 * does not move the hero onto it. Walls/pillars/void are never traversable. */
const PASSABLE_TOKENS: ReadonlySet<string> = new Set([
  'terrain.floor',
  'terrain.stair',
  'terrain.door',
]);

const STEP_DIRECTIONS: ReadonlyMap<string, Direction> = new Map([
  ['0,-1', 'north'],
  ['1,-1', 'northeast'],
  ['1,0', 'east'],
  ['1,1', 'southeast'],
  ['0,1', 'south'],
  ['-1,1', 'southwest'],
  ['-1,0', 'west'],
  ['-1,-1', 'northwest'],
]);

/** The single king-move `Direction` from `from` to an orthogonally/diagonally adjacent `to`, or
 * `null` when they are the same cell or more than one step apart on either axis. Path steps are
 * always adjacent, so this only ever returns `null` on a degenerate (already-arrived) step. */
export function directionBetween(from: Point, to: Point): Direction | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (Math.abs(to.x - from.x) > 1 || Math.abs(to.y - from.y) > 1) return null;
  return STEP_DIRECTIONS.get(`${dx},${dy}`) ?? null;
}

function cellToken(
  floor: GameplayProjection['floor'],
  x: number,
  y: number,
): { readonly knowledge: string; readonly token?: string } | undefined {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return undefined;
  return floor.cells[y * floor.width + x];
}

/**
 * A path from the hero to `destination` across currently-known passable terrain (topology 8), or
 * `null` when none exists. Cells occupied by a perceived actor are impassable so auto-travel never
 * blunders into a bystander -- except `allowActorAt` (the clicked hostile's own cell), which stays
 * passable so the path can end on it and the terminal move resolves to an attack.
 */
export function computeTravelPath(
  input: Readonly<{
    projection: GameplayProjection;
    destination: Point;
    allowActorAt?: Point;
  }>,
): readonly Point[] | null {
  const { projection, destination, allowActorAt } = input;
  const { floor } = projection;
  const hero = heroOf(projection);
  const occupied = new Set(actorsOf(projection).map((actor) => `${actor.x},${actor.y}`));
  const isPassable = (x: number, y: number): boolean => {
    const cell = cellToken(floor, x, y);
    if (!cell || cell.knowledge === 'unknown') return false;
    if (cell.token === undefined || !PASSABLE_TOKENS.has(cell.token)) return false;
    if (allowActorAt && allowActorAt.x === x && allowActorAt.y === y) return true;
    return !occupied.has(`${x},${y}`);
  };
  return findPath({
    width: floor.width,
    height: floor.height,
    topology: 8,
    origin: { x: hero.x, y: hero.y },
    destination,
    isPassable,
  });
}

/** What a resolved click asks auto-travel to do: walk `steps` (each an adjacent cell to move onto,
 * possibly empty when the target is the hero's own cell), then optionally act on arrival. A hostile
 * target's final step is the hostile's cell, where the terminal `move` auto-converts to an attack;
 * `onArrive: 'pickup'` fires a `pickup` intent once the hero stands on the destination. */
export interface TravelPlan {
  readonly steps: readonly Point[];
  readonly onArrive: 'pickup' | null;
}

/**
 * Resolves a clicked floor cell to a `TravelPlan`, or `null` when the click means nothing actionable
 * (an unreachable cell, the hero's own empty cell, or a non-hostile actor -- travelling to talk/trade
 * is not part of the grounded intent set). Every plan maps onto existing `PlayerIntent`s: `move`
 * (which the command builder already auto-converts into an attack on a hostile and an open on a
 * closed door) and `pickup`.
 */
export function resolveClick(projection: GameplayProjection, cell: Point): TravelPlan | null {
  const hero = heroOf(projection);

  if (cell.x === hero.x && cell.y === hero.y) {
    const here = groundItemsOf(projection).find((item) => item.x === hero.x && item.y === hero.y);
    return here ? { steps: [], onArrive: 'pickup' } : null;
  }

  const actor = actorsOf(projection).find(
    (candidate) => candidate.x === cell.x && candidate.y === cell.y,
  );
  if (actor) {
    if (actor.disposition !== 'hostile') return null;
    const path = computeTravelPath({ projection, destination: cell, allowActorAt: cell });
    return path ? { steps: path, onArrive: null } : null;
  }

  const item = groundItemsOf(projection).find(
    (candidate) => candidate.x === cell.x && candidate.y === cell.y,
  );
  const path = computeTravelPath({ projection, destination: cell });
  if (path === null) return null;
  return { steps: path, onArrive: item ? 'pickup' : null };
}

/** A travel in flight: the plan plus the cursor into `steps`, the cell the last dispatched move is
 * expected to land the hero on (`awaiting`), and the baselines the interruption rules compare
 * against (hero health, and which hostiles were already visible when travel began). */
export interface ActiveTravel {
  readonly steps: readonly Point[];
  readonly cursor: number;
  readonly awaiting: Point | null;
  readonly onArrive: 'pickup' | null;
  readonly startHealth: number;
  readonly startHostileIds: ReadonlySet<string>;
}

function hostileActorIds(projection: GameplayProjection): ReadonlySet<string> {
  return new Set(
    actorsOf(projection)
      .filter((actor) => actor.disposition === 'hostile')
      .map((actor) => actor.actorId),
  );
}

export function beginTravel(projection: GameplayProjection, plan: TravelPlan): ActiveTravel {
  return {
    steps: plan.steps,
    cursor: 0,
    awaiting: null,
    onArrive: plan.onArrive,
    startHealth: heroOf(projection).health,
    startHostileIds: hostileActorIds(projection),
  };
}

/**
 * Advances an in-flight travel by exactly one step against the latest authoritative `projection`,
 * dispatching at most one intent, and returns the next `ActiveTravel` -- or `null` when travel is
 * finished or must stop. It stays in sync with the engine by only ever advancing the cursor once the
 * projection confirms the previous move landed the hero on `awaiting`; if it did not (blocked, a
 * closed door that merely opened, or a hostile the move struck instead), travel stops. It also stops
 * on the grounded interruptions: the hero lost health this turn, or a hostile that was not already
 * visible when travel began has appeared.
 */
export function advanceTravel(
  input: Readonly<{
    projection: GameplayProjection;
    travel: ActiveTravel;
    dispatch: (intent: PlayerIntent) => void;
  }>,
): ActiveTravel | null {
  const { projection, travel, dispatch } = input;
  const hero = heroOf(projection);

  let cursor = travel.cursor;
  if (travel.awaiting !== null) {
    if (hero.x === travel.awaiting.x && hero.y === travel.awaiting.y) cursor += 1;
    else return null;
  }

  if (hero.health < travel.startHealth) return null;
  for (const id of hostileActorIds(projection)) {
    if (!travel.startHostileIds.has(id)) return null;
  }

  if (cursor >= travel.steps.length) {
    if (travel.onArrive === 'pickup') dispatch({ type: 'pickup' });
    return null;
  }

  const next = travel.steps[cursor]!;
  const direction = directionBetween(hero, next);
  if (direction === null) return null;
  dispatch({ type: 'move', direction });
  return { ...travel, cursor, awaiting: next };
}
