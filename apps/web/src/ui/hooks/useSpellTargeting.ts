import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Point } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, chebyshev, heroOf } from '../../session/projection-view.js';
import type { RunSession } from '../../session/run-session.js';
import {
  affectedFootprint,
  aimInRange,
  computeValidTargets,
  type TargetCandidate,
} from '../../session/spell-targeting.js';

function cellKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function isAoeTargetingId(targetingId: string | undefined): boolean {
  return (
    targetingId === 'target.burst' || targetingId === 'target.line' || targetingId === 'target.cone'
  );
}

export interface UseSpellTargetingResult {
  /** The spell id being targeted, or `null` when targeting is inactive. */
  readonly activeSpellId: string | null;
  /** Every currently-valid target (single-target spells only -- AoE spells aim with the free
   * reticle instead of a finite candidate list; see `TargetCandidate.affected` for the future-AoE
   * hook). Empty while inactive, or while active but nothing is currently targetable. */
  readonly candidates: readonly TargetCandidate[];
  /** The live AoE footprint (or the single-target candidate cell) at the current reticle, as
   * `"x,y"` keys -- what the map overlay/click-router check membership against. */
  readonly validCells: ReadonlySet<string>;
  /** Alias of `validCells` (T4 naming) -- the footprint at the reticle. */
  readonly affectedCells: ReadonlySet<string>;
  /** Actor ids currently standing on a footprint cell -- drives the affected-actor highlight. */
  readonly affectedActorIds: ReadonlySet<string>;
  /** The reticle's current cell -- free-movable (arrow keys/mouse hover) for AoE spells, the
   * arrow-cycled candidate for single-target spells. `null` when there is nothing to target.
   * Confirmed by Enter (`confirmReticle`). */
  readonly reticle: Point | null;
  /** Whether the current reticle can be confirmed: in range (AoE spells accept empty-ground aims
   * -- the server re-validates) or a legal single-target cell. */
  readonly canConfirm: boolean;
  /** Enters targeting mode for `spellId` (called by the Spells panel / command palette). */
  readonly begin: (spellId: string) => void;
  /** Exits targeting mode without dispatching anything (Escape / right-click). */
  readonly cancel: () => void;
  /** Casts at `point` if it is a legal aim for the active spell, then exits targeting; a no-op
   * (targeting stays active) if `point` is not currently valid -- an invalid click is simply
   * ignored rather than cancelling the whole mode, so a slightly mis-aimed click doesn't cost the
   * player their spell selection. Returns whether it cast. */
  readonly confirmAt: (point: Point) => boolean;
  /** Casts at the current reticle cell (Enter), if any. Returns whether it cast. */
  readonly confirmReticle: () => boolean;
  /** Single-target only: moves the reticle to the next (`1`) or previous (`-1`) candidate,
   * wrapping around. Cycles through `candidates` in their list order -- not spatial direction --
   * which keeps the keyboard path simple; with at most a handful of hostiles in view at once this
   * reads fine in practice. A no-op for AoE spells. */
  readonly moveReticle: (step: 1 | -1) => void;
  /** AoE only: moves the free reticle by `(dx, dy)`, clamped to the spell's Chebyshev range from
   * the hero and to the floor bounds. A no-op for single-target spells. */
  readonly moveReticleBy: (dx: number, dy: number) => void;
  /** AoE only: sets the free reticle directly (mouse hover), clamped to range. A no-op for
   * single-target spells. */
  readonly setReticle: (point: Point) => void;
}

/**
 * Client-only spell-targeting state machine (Task 10, extended by Task 4 with a free-cursor AoE
 * mode). Entered via `begin(spellId)` from the Spells panel or command palette; exited via
 * `cancel()` (Escape/right-click) or by confirming a cast (`confirmAt`/`confirmReticle`), which
 * dispatches the `cast` `PlayerIntent` (Task 9's `command-builder` maps it to
 * `{type:'cast', spellId, target}`) and then exits.
 *
 * Single-target spells (`target.self`/`target.actor`) keep the original candidate-cycling reticle:
 * `candidates` is recomputed from the LATEST projection every render via the pure
 * `computeValidTargets`, and arrows step through them. AoE spells (`target.burst`/`line`/`cone`)
 * instead drive a FREE reticle -- a `Point` moved by arrow keys or mouse hover, clamped to the
 * spell's range and the floor bounds -- and the live footprint at that reticle comes from
 * `affectedFootprint`. Either way the engine independently re-validates on dispatch; nothing here
 * is authoritative.
 */
export function useSpellTargeting(
  session: RunSession,
  snapshot: SessionSnapshot,
): UseSpellTargetingResult {
  const { projection } = snapshot;
  const [activeSpellId, setActiveSpellId] = useState<string | null>(null);
  const [reticleIndex, setReticleIndex] = useState(0);
  const [freeReticle, setFreeReticle] = useState<Point | null>(null);

  const hero = heroOf(projection);
  const spell = activeSpellId
    ? (hero.castableSpells ?? []).find((candidate) => candidate.spellId === activeSpellId)
    : undefined;
  const isAoe = isAoeTargetingId(spell?.targetingId);

  const candidates = useMemo<readonly TargetCandidate[]>(() => {
    if (!spell || isAoe) return [];
    return computeValidTargets({
      spell,
      floor: projection.floor,
      hero,
      actors: actorsOf(projection),
    }).candidates;
  }, [spell, isAoe, projection, hero]);

  // Single-target reticle: the arrow-cycled candidate. AoE reticle: the free cell (clamped).
  const reticle: Point | null = isAoe
    ? freeReticle
    : candidates.length === 0
      ? null
      : candidates[((reticleIndex % candidates.length) + candidates.length) % candidates.length]!
          .cell;

  const affected = useMemo<readonly Point[]>(() => {
    if (!spell || reticle === null) return [];
    return affectedFootprint({ spell, floor: projection.floor, hero, aim: reticle });
  }, [spell, projection.floor, hero, reticle]);

  const validCells = useMemo(() => new Set(affected.map(cellKey)), [affected]);

  const affectedActorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const actor of actorsOf(projection)) {
      if (validCells.has(cellKey(actor))) ids.add(actor.actorId);
    }
    return ids;
  }, [projection, validCells]);

  const canConfirm =
    reticle !== null &&
    (isAoe ? aimInRange(hero, reticle, spell?.range ?? 0) : validCells.size > 0);

  const begin = useCallback(
    (spellId: string): void => {
      setActiveSpellId(spellId);
      setReticleIndex(0);
      const next = (hero.castableSpells ?? []).find((candidate) => candidate.spellId === spellId);
      setFreeReticle(isAoeTargetingId(next?.targetingId) ? { x: hero.x, y: hero.y } : null);
    },
    [hero],
  );

  const cancel = useCallback((): void => {
    setActiveSpellId(null);
    setFreeReticle(null);
  }, []);

  const dispatchCast = useCallback(
    (point: Point): void => {
      if (!activeSpellId) return;
      session.dispatch({ type: 'cast', spellId: activeSpellId, target: point });
      setActiveSpellId(null);
      setFreeReticle(null);
    },
    [activeSpellId, session],
  );

  const confirmAt = useCallback(
    (point: Point): boolean => {
      if (!activeSpellId) return false;
      if (isAoe) {
        if (!aimInRange(hero, point, spell?.range ?? 0)) return false;
        dispatchCast(point);
        return true;
      }
      if (!validCells.has(cellKey(point))) return false;
      dispatchCast(point);
      return true;
    },
    [activeSpellId, isAoe, hero, spell, dispatchCast, validCells],
  );

  const confirmReticle = useCallback((): boolean => {
    if (!activeSpellId || reticle === null || !canConfirm) return false;
    dispatchCast(reticle);
    return true;
  }, [activeSpellId, reticle, canConfirm, dispatchCast]);

  const moveReticle = useCallback(
    (step: 1 | -1): void => {
      if (isAoe) return;
      setReticleIndex((index) => index + step);
    },
    [isAoe],
  );

  const moveReticleBy = useCallback(
    (dx: number, dy: number): void => {
      if (!isAoe) return;
      setFreeReticle((current) => {
        const base = current ?? { x: hero.x, y: hero.y };
        const next = { x: base.x + dx, y: base.y + dy };
        const range = spell?.range ?? 0;
        if (chebyshev(next, hero) > range) return current;
        if (
          next.x < 0 ||
          next.y < 0 ||
          next.x >= projection.floor.width ||
          next.y >= projection.floor.height
        )
          return current;
        return next;
      });
    },
    [isAoe, hero, spell, projection.floor.width, projection.floor.height],
  );

  const setReticle = useCallback(
    (point: Point): void => {
      if (!isAoe) return;
      if (chebyshev(point, hero) > (spell?.range ?? 0)) return;
      setFreeReticle(point);
    },
    [isAoe, hero, spell],
  );

  // The keyboard reticle: arrows move/cycle, Enter confirms, Escape cancels. Attached only while
  // targeting is active, so it never competes with the ordinary movement/action keydown listener
  // (`usePlayKeyDispatcher`, which `PlayScreen` widens to treat targeting as a modal state so
  // arrows/Enter/etc. never reach it while this listener owns them).
  useEffect(() => {
    if (!activeSpellId) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Escape':
          cancel();
          return;
        case 'Enter':
          confirmReticle();
          return;
        case 'ArrowRight':
          if (isAoe) moveReticleBy(1, 0);
          else moveReticle(1);
          return;
        case 'ArrowLeft':
          if (isAoe) moveReticleBy(-1, 0);
          else moveReticle(-1);
          return;
        case 'ArrowDown':
          if (isAoe) moveReticleBy(0, 1);
          else moveReticle(1);
          return;
        case 'ArrowUp':
          if (isAoe) moveReticleBy(0, -1);
          else moveReticle(-1);
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSpellId, isAoe, cancel, confirmReticle, moveReticle, moveReticleBy]);

  return {
    activeSpellId,
    candidates,
    validCells,
    affectedCells: validCells,
    affectedActorIds,
    reticle,
    canConfirm,
    begin,
    cancel,
    confirmAt,
    confirmReticle,
    moveReticle,
    moveReticleBy,
    setReticle,
  };
}
