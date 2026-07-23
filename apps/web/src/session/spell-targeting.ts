import {
  burstCells,
  coneCells,
  lineCells,
  tileDefinition,
  type ObservableFloorProjection,
  type OpaqueId,
  type Point,
} from '@woven-deep/engine';
import type { CastableSpellView } from './projection-view.js';
import { chebyshev, type ActorView, type HeroView } from './projection-view.js';

/**
 * The client-side mirror of the engine's authoritative `validateTarget` (`packages/engine/src/
 * targeting.ts`). It is a REIMPLEMENTATION, not a reuse, of that function -- `validateTarget` takes
 * engine-internal state the guest projection deliberately does not expose (a raw `ActorState`, the
 * full un-fogged `FloorSnapshot.tiles`, the raw visibility bitfield, and the raw illumination
 * intensity array): the projection instead collapses visibility + illumination into each
 * `ObservableCell.knowledge`/`intensity` pair precisely so spoiler-sensitive engine internals never
 * reach the client. So this recomputes the same three rules (Chebyshev range, visible + lit, clear
 * line of sight) from what the projection DOES expose. This is advisory only: the engine
 * independently re-validates on `cast` dispatch (`command-builder.ts` -> `{type:'cast'}`), so any
 * drift here can only ever make the client UI overly conservative or permissive about which cells it
 * highlights/lets the player click -- never bypass the real rule.
 */

/** One valid cast target: the cell to pass as `CastCommand.target`, the actor occupying it (when
 * the spell is `target.actor`), and the cells the cast would actually affect. For an AoE spell
 * (`target.burst`/`line`/`cone`) `affected` is the shared-geometry footprint at that aim cell (fed
 * fogged-projection callbacks); for a single-target spell it is just `[cell]`. */
export interface TargetCandidate {
  readonly cell: Point;
  readonly actorId?: OpaqueId;
  readonly affected: readonly Point[];
}

export interface ValidTargeting {
  readonly candidates: readonly TargetCandidate[];
}

export interface ComputeValidTargetsInput {
  readonly spell: Pick<CastableSpellView, 'range' | 'targetingId'>;
  readonly floor: ObservableFloorProjection;
  readonly hero: Pick<HeroView, 'x' | 'y' | 'actorId'>;
  readonly actors: readonly ActorView[];
}

function cellAt(
  floor: ObservableFloorProjection,
  x: number,
  y: number,
): ObservableFloorProjection['cells'][number] | undefined {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return undefined;
  return floor.cells[y * floor.width + x];
}

/** A cell is a legal target only when it is currently `visible` -- the projection only ever marks a
 * cell `visible` when BOTH the visibility bitfield and the illumination intensity agreed it should
 * be (see `projectFloor`), which is exactly the engine's own "visible AND lit" test. */
function cellIsVisible(floor: ObservableFloorProjection, point: Point): boolean {
  return cellAt(floor, point.x, point.y)?.knowledge === 'visible';
}

/** Bresenham line from `from` to `to`, EXCLUSIVE of `from` and inclusive of `to` -- a byte-for-byte
 * port of the private `line()` in `packages/engine/src/targeting.ts`, kept in lockstep with it by
 * `spell-targeting.test.ts`'s parity cases (mirroring `targeting.test.ts`). */
function line(from: Point, to: Point): readonly Point[] {
  const points: Point[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (x !== to.x || y !== to.y) {
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
    points.push({ x, y });
  }
  return points;
}

/**
 * Whether the straight line from `from` to `to` is unobstructed, mirroring the engine's own
 * Bresenham LoS check (`validatePoint` in `targeting.ts`): every cell strictly between the two
 * endpoints must be a non-opaque tile. A path cell the client has never observed (no `tileId` --
 * i.e. still `unknown`) is treated as BLOCKING rather than passable: this is the conservative
 * choice for an advisory preview (it can only ever under-highlight, never let the player click
 * somewhere the engine would reject), and in practice a target the projection already reports
 * `visible` almost always has its whole line of sight already explored too.
 */
function hasLineOfSight(floor: ObservableFloorProjection, from: Point, to: Point): boolean {
  const path = line(from, to);
  return !path.slice(0, -1).some((point) => {
    const cell = cellAt(floor, point.x, point.y);
    if (cell === undefined || cell.tileId === undefined) return true;
    return tileDefinition(cell.tileId).opaque;
  });
}

function inRangeVisibleAndClear(
  input: Readonly<{ floor: ObservableFloorProjection; hero: Point; range: number; point: Point }>,
): boolean {
  const { floor, hero, range, point } = input;
  if (chebyshev(point, hero) > range) return false;
  if (!cellIsVisible(floor, point)) return false;
  return hasLineOfSight(floor, hero, point);
}

/** Whether `aim` is within Chebyshev `range` of the hero. The free-cursor targeting mode clamps to
 * this; the shared geometry itself does not range-check the aim cell (burst is anchored AT the aim). */
export function aimInRange(hero: Pick<Point, 'x' | 'y'>, aim: Point, range: number): boolean {
  return chebyshev(aim, hero) <= range;
}

/** Opacity for the client's fogged projection, matching the engine callback contract: an
 * out-of-bounds or never-observed (`tileId` undefined) cell reads as OPAQUE, so `lineCells` stops
 * conservatively at the fog edge (advisory: it can only under-reach, never over-reach). */
function projectionIsOpaque(floor: ObservableFloorProjection, point: Point): boolean {
  const cell = cellAt(floor, point.x, point.y);
  if (cell === undefined || cell.tileId === undefined) return true;
  return tileDefinition(cell.tileId).opaque;
}

function projectionInBounds(floor: ObservableFloorProjection, point: Point): boolean {
  return cellAt(floor, point.x, point.y) !== undefined;
}

/**
 * The cells a cast of `spell` aimed at `aim` would affect right now, from what the projection
 * exposes. Advisory only (the engine re-validates on dispatch). Single-target ids return `[aim]`
 * when the aim is a legal single-target cell (in range, visible, clear LoS), else `[]`. AoE ids
 * return the shared-geometry footprint when the aim is in range + visible, else `[]`.
 */
export function affectedFootprint(
  input: Readonly<{
    spell: Pick<CastableSpellView, 'range' | 'targetingId' | 'aoe'>;
    floor: ObservableFloorProjection;
    hero: Pick<HeroView, 'x' | 'y'>;
    aim: Point;
  }>,
): readonly Point[] {
  const { spell, floor, hero, aim } = input;
  const origin: Point = { x: hero.x, y: hero.y };

  if (spell.targetingId === 'target.self') {
    return [{ x: origin.x, y: origin.y }];
  }

  if (
    spell.aoe !== undefined &&
    (spell.targetingId === 'target.burst' ||
      spell.targetingId === 'target.line' ||
      spell.targetingId === 'target.cone')
  ) {
    if (!aimInRange(origin, aim, spell.range)) return [];
    if (!cellIsVisible(floor, aim)) return [];
    if (spell.targetingId === 'target.burst') {
      return burstCells(aim, spell.aoe.radius, { inBounds: (p) => projectionInBounds(floor, p) });
    }
    if (spell.targetingId === 'target.line') {
      return lineCells(origin, aim, spell.aoe.radius, {
        isOpaque: (p) => projectionIsOpaque(floor, p),
      });
    }
    return coneCells(origin, aim, spell.aoe.radius, {
      inBounds: (p) => projectionInBounds(floor, p),
    });
  }

  // Single-target actor/cell: the aim itself is the footprint, when it's a legal target cell.
  return inRangeVisibleAndClear({ floor, hero: origin, range: spell.range, point: aim })
    ? [{ x: aim.x, y: aim.y }]
    : [];
}

/**
 * Computes every currently-valid target cell for a spell's targeting rule, given only what the
 * guest projection exposes: `target.self` always yields the caster's own cell; `target.actor`
 * yields every hostile actor's cell that is in range, visible+lit, and has clear line of sight from
 * the hero. Burst/line/cone are aimed with the free cursor via `affectedFootprint`, not enumerated
 * here: there is no finite candidate set to cycle for an area spell.
 */
export function computeValidTargets(input: ComputeValidTargetsInput): ValidTargeting {
  const { spell, floor, hero, actors } = input;
  const origin: Point = { x: hero.x, y: hero.y };

  if (spell.targetingId === 'target.self') {
    return { candidates: [{ cell: origin, actorId: hero.actorId, affected: [origin] }] };
  }

  if (spell.targetingId === 'target.actor') {
    const candidates: TargetCandidate[] = [];
    for (const actor of actors) {
      if (actor.disposition !== 'hostile') continue;
      const cell: Point = { x: actor.x, y: actor.y };
      if (!inRangeVisibleAndClear({ floor, hero: origin, range: spell.range, point: cell }))
        continue;
      candidates.push({ cell, actorId: actor.actorId, affected: [cell] });
    }
    return { candidates };
  }

  // Burst/line/cone are aimed with the free cursor via `affectedFootprint`, not enumerated here:
  // there is no finite candidate set to cycle for an area spell. `useSpellTargeting` drives the
  // reticle directly for those.
  return { candidates: [] };
}
