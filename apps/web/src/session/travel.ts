import {
  findPath,
  type Direction,
  type GameplayProjection,
  type Point,
  type PublicEvent,
} from '@woven-deep/engine';
import { groundItemUnderHero, type AutoPickupPolicy } from './auto-pickup.js';
import type { PlayerIntent } from './intents.js';
import { actorsOf, featuresOf, groundItemsOf, heroOf } from './projection-view.js';

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
 * How a cell reads to travel: `unknown` (never discovered -- travel refuses it and the hover cursor
 * shows nothing), `navigable` (travel may route across or end on it), or `blocked` (discovered, but
 * terrain or an engaged lock stops the hero).
 */
export type CellNavigability = 'unknown' | 'navigable' | 'blocked';

/** A door or chest whose lock is engaged at `(x, y)`. Mirrors `command-builder.ts`'s
 * `lockedFeatureAt`: a bump into one is refused outright, never auto-opened, so travel must treat
 * the cell as blocked even though its terrain token is passable. */
function lockedFeatureAt(projection: GameplayProjection, x: number, y: number): boolean {
  return featuresOf(projection).some(
    (feature) =>
      (feature.type === 'door' || feature.type === 'chest') &&
      feature.state === 'locked' &&
      feature.x === x &&
      feature.y === y,
  );
}

/**
 * The single source of truth for "can the hero travel here", shared by `computeTravelPath` (which
 * additionally rejects cells occupied by a bystander) and the playfield's hover cursor, so the
 * outline the player sees and the path the click walks can never disagree.
 *
 * Floors and stairs are navigable; a CLOSED (unlocked) door is navigable because the ordinary `move`
 * intent bump-opens it (`command-builder.ts`); a LOCKED door/chest, a wall, a pillar and void are
 * blocked; a never-discovered cell is `unknown`. Actor occupancy is deliberately NOT folded in --
 * it is a per-path concern (a hostile's own cell stays a legal destination), not a property of the
 * cell's navigability.
 */
export function cellNavigability(projection: GameplayProjection, cell: Point): CellNavigability {
  const observed = cellToken(projection.floor, cell.x, cell.y);
  if (!observed || observed.knowledge === 'unknown') return 'unknown';
  if (observed.token === undefined || !PASSABLE_TOKENS.has(observed.token)) return 'blocked';
  return lockedFeatureAt(projection, cell.x, cell.y) ? 'blocked' : 'navigable';
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
    if (cellNavigability(projection, { x, y }) !== 'navigable') return false;
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

/** Which walk is in flight. `travel` is the click-to-travel walk (minimal interruptions, unchanged
 * behavior); `explore` re-plans a frontier path every step; `stairs` walks a fixed path to a
 * discovered stair. Explore and stairs share the classic stop set and auto-pickup. */
export type TravelMode = 'travel' | 'explore' | 'stairs';

/** Why an auto-walk stopped, in the player's terms -- the caller turns this into a log line. */
export type StopReason =
  | 'hero-damaged'
  | 'hostile-appeared'
  | 'item-spotted'
  | 'stair-found'
  | 'feature-revealed'
  | 'hunger'
  | 'light'
  | 'sound'
  | 'action-invalid';

/** A pure interruption rule, evaluated against the latest authoritative projection and the events
 * the most recent dispatch produced, BEFORE each step is taken. */
export type StopPredicate = (
  input: Readonly<{ projection: GameplayProjection; lastEvents: readonly PublicEvent[] }>,
) => StopReason | null;

function hostileActorIds(projection: GameplayProjection): ReadonlySet<string> {
  return new Set(
    actorsOf(projection)
      .filter((actor) => actor.disposition === 'hostile')
      .map((actor) => actor.actorId),
  );
}

/**
 * The two interruptions EVERY mode honors, baselined against the projection the walk began from:
 * the hero lost health this turn, or a hostile that was not already visible has appeared. This is
 * click-to-travel's complete stop set.
 */
export function baseStopPredicate(start: GameplayProjection): StopPredicate {
  const startHealth = heroOf(start).health;
  const startHostileIds = hostileActorIds(start);
  return ({ projection }) => {
    if (heroOf(projection).health < startHealth) return 'hero-damaged';
    for (const id of hostileActorIds(projection)) {
      if (!startHostileIds.has(id)) return 'hostile-appeared';
    }
    return null;
  };
}

function discoveredStairKeys(projection: GameplayProjection): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const cell of projection.floor.cells) {
    if (cell.knowledge !== 'unknown' && cell.token === 'terrain.stair')
      keys.add(`${cell.x},${cell.y}`);
  }
  return keys;
}

function reasonForEvent(event: PublicEvent): StopReason | null {
  switch (event.type) {
    case 'feature.revealed':
      return 'feature-revealed';
    case 'hunger.stage-changed':
      return 'hunger';
    case 'fuel.warning':
    case 'item.light-extinguished':
      return 'light';
    case 'sound.heard':
      return 'sound';
    case 'action.invalid':
      return 'action-invalid';
    default:
      return null;
  }
}

/**
 * The classic roguelike stop set for auto-explore and stairs-travel: the base rules plus anything
 * that changes what the player would want to do next -- a new item worth deciding about, a stair
 * leaving the unknown, a revealed feature, worsening hunger, a failing light, a sound, or a
 * rejected action. Items the `autoPickup` policy would sweep up never count as "new" (the walk
 * takes them and carries on), which is what keeps gold from halting every explore.
 *
 * The modal condition from the design (`pendingDecision`/`trade`/`conclusion`/`houseOpen`) needs no
 * rule here: `PlayScreen` already composes `isModalActive` and passes it as `useAutoTravel`'s
 * `disabled`, which clears the walk outright.
 */
export function classicStopPredicate(
  input: Readonly<{ start: GameplayProjection; autoPickup: AutoPickupPolicy }>,
): StopPredicate {
  const { start, autoPickup } = input;
  const base = baseStopPredicate(start);
  const startItemIds = new Set(groundItemsOf(start).map((item) => item.itemId));
  const startStairKeys = discoveredStairKeys(start);
  return ({ projection, lastEvents }) => {
    const baseReason = base({ projection, lastEvents });
    if (baseReason !== null) return baseReason;
    for (const item of groundItemsOf(projection)) {
      if (startItemIds.has(item.itemId)) continue;
      if (autoPickup(projection, item)) continue;
      return 'item-spotted';
    }
    for (const key of discoveredStairKeys(projection)) {
      if (!startStairKeys.has(key)) return 'stair-found';
    }
    for (const event of lastEvents) {
      const reason = reasonForEvent(event);
      if (reason !== null) return reason;
    }
    return null;
  };
}

/** A travel in flight: the plan plus the cursor into `steps`, the cell the last dispatched move is
 * expected to land the hero on (`awaiting`), the interruption rule, the optional per-step re-planner
 * (explore), the optional auto-pickup policy, and `pendingPickup` -- the itemId of a pickup
 * dispatched last turn, which tells the stepper the hero is NOT expected to have moved. */
export interface ActiveTravel {
  readonly steps: readonly Point[];
  readonly cursor: number;
  readonly awaiting: Point | null;
  readonly onArrive: 'pickup' | null;
  readonly mode: TravelMode;
  readonly stopWhen: StopPredicate;
  readonly replan: ((projection: GameplayProjection) => readonly Point[] | null) | null;
  readonly autoPickup: AutoPickupPolicy | null;
  readonly pendingPickup: string | null;
}

export interface BeginTravelOptions {
  readonly mode?: TravelMode;
  readonly stopWhen?: StopPredicate;
  readonly autoPickup?: AutoPickupPolicy;
  /** Explore's frontier planner, injected rather than imported so `travel.ts` never depends on
   * `explore.ts` (which depends on `cellNavigability` here). */
  readonly replan?: (projection: GameplayProjection) => readonly Point[] | null;
}

export function beginTravel(
  projection: GameplayProjection,
  plan: TravelPlan,
  options: BeginTravelOptions = {},
): ActiveTravel {
  return {
    steps: plan.steps,
    cursor: 0,
    awaiting: null,
    onArrive: plan.onArrive,
    mode: options.mode ?? 'travel',
    stopWhen: options.stopWhen ?? baseStopPredicate(projection),
    replan: options.replan ?? null,
    autoPickup: options.autoPickup ?? null,
    pendingPickup: null,
  };
}

/** What one call to `advanceTravel` did: dispatched an intent and handed back the next travel
 * state; stopped for a reportable reason (or `'blocked'`, which is the silent "the projection did
 * not confirm the step" case); or finished. */
export type AdvanceOutcome =
  | Readonly<{ status: 'stepping'; travel: ActiveTravel }>
  | Readonly<{ status: 'stopped'; reason: StopReason | 'blocked' }>
  | Readonly<{ status: 'arrived' }>;

/**
 * Advances an in-flight travel by exactly one step against the latest authoritative `projection`,
 * dispatching at most one intent. It stays in sync with the engine by only ever advancing the
 * cursor once the projection confirms the previous move landed the hero on `awaiting` -- except
 * after a pickup turn, where the hero is not expected to have moved at all and the cursor holds.
 * If the pickup did not actually clear the item, the walk stops rather than dispatching it forever.
 */
export function advanceTravel(
  input: Readonly<{
    projection: GameplayProjection;
    travel: ActiveTravel;
    dispatch: (intent: PlayerIntent) => void;
    lastEvents?: readonly PublicEvent[];
  }>,
): AdvanceOutcome {
  const { projection, travel, dispatch, lastEvents = [] } = input;
  const hero = heroOf(projection);

  let cursor = travel.cursor;
  if (travel.pendingPickup !== null) {
    const still = groundItemUnderHero(projection);
    if (still?.itemId === travel.pendingPickup) return { status: 'stopped', reason: 'blocked' };
  } else if (travel.awaiting !== null) {
    if (hero.x === travel.awaiting.x && hero.y === travel.awaiting.y) cursor += 1;
    else return { status: 'stopped', reason: 'blocked' };
  }

  const stop = travel.stopWhen({ projection, lastEvents });
  if (stop !== null) return { status: 'stopped', reason: stop };

  if (travel.autoPickup !== null) {
    const item = groundItemUnderHero(projection);
    if (item && travel.autoPickup(projection, item)) {
      dispatch({ type: 'pickup' });
      return {
        status: 'stepping',
        travel: { ...travel, cursor, awaiting: null, pendingPickup: item.itemId },
      };
    }
  }

  let steps = travel.steps;
  if (travel.replan !== null) {
    const replanned = travel.replan(projection);
    if (replanned === null || replanned.length === 0) return { status: 'arrived' };
    steps = replanned;
    cursor = 0;
  }

  if (cursor >= steps.length) {
    if (travel.onArrive === 'pickup') dispatch({ type: 'pickup' });
    return { status: 'arrived' };
  }

  const next = steps[cursor]!;
  const direction = directionBetween(hero, next);
  if (direction === null) return { status: 'stopped', reason: 'blocked' };
  dispatch({ type: 'move', direction });
  return {
    status: 'stepping',
    travel: { ...travel, steps, cursor, awaiting: next, pendingPickup: null },
  };
}
