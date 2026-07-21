import {
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
 * the spell is `target.actor`), and the cells the cast would actually affect. `affected` is always
 * `[cell]` today (no AoE spell/targeting exists yet) but is its own field so an area-effect spell
 * can later populate more than one cell here without changing this shape. */
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

/**
 * Computes every currently-valid target cell for a spell's targeting rule, given only what the
 * guest projection exposes: `target.self` always yields the caster's own cell; `target.actor`
 * yields every hostile actor's cell that is in range, visible+lit, and has clear line of sight from
 * the hero. `target.cell`/`target.line` have no content spell using them yet (see the design doc's
 * "out of scope" section), so they yield no candidates -- there is nothing to enumerate a reticle
 * over without a concrete clicked point, and no such flow exists today.
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

  return { candidates: [] };
}
