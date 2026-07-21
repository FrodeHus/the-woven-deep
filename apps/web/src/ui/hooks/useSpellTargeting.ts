import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Point } from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, heroOf } from '../../session/projection-view.js';
import { computeValidTargets, type TargetCandidate } from '../../session/spell-targeting.js';

function cellKey(point: Point): string {
  return `${point.x},${point.y}`;
}

export interface UseSpellTargetingResult {
  /** The spell id being targeted, or `null` when targeting is inactive. */
  readonly activeSpellId: string | null;
  /** Every currently-valid target (single-cell today; see `TargetCandidate.affected` for the
   * future-AoE hook). Empty while inactive, or while active but nothing is currently targetable. */
  readonly candidates: readonly TargetCandidate[];
  /** `candidates`, as a lookup set of `"x,y"` keys -- what the map overlay/click-router check
   * membership against. */
  readonly validCells: ReadonlySet<string>;
  /** The keyboard reticle's current cell -- the first (then arrow-cycled) candidate, or `null`
   * when there is nothing to target. Confirmed by Enter (`confirmReticle`). */
  readonly reticle: Point | null;
  /** Enters targeting mode for `spellId` (called by the Spells panel / command palette). */
  readonly begin: (spellId: string) => void;
  /** Exits targeting mode without dispatching anything (Escape / right-click). */
  readonly cancel: () => void;
  /** Casts at `point` if it is one of `candidates`' cells, then exits targeting; a no-op (targeting
   * stays active) if `point` is not currently valid -- an invalid click is simply ignored rather
   * than cancelling the whole mode, so a slightly mis-aimed click doesn't cost the player their
   * spell selection. Returns whether it cast. */
  readonly confirmAt: (point: Point) => boolean;
  /** Casts at the current reticle cell (Enter), if any. Returns whether it cast. */
  readonly confirmReticle: () => boolean;
  /** Moves the reticle to the next (`1`) or previous (`-1`) candidate, wrapping around. Cycles
   * through `candidates` in their list order -- not spatial direction -- which keeps the keyboard
   * path simple; with at most a handful of hostiles in view at once this reads fine in practice. */
  readonly moveReticle: (step: 1 | -1) => void;
}

/**
 * Client-only spell-targeting state machine (Task 10). Entered via `begin(spellId)` from the Spells
 * panel or command palette; exited via `cancel()` (Escape/right-click) or by confirming a cast
 * (`confirmAt`/`confirmReticle`), which dispatches the `cast` `PlayerIntent` (Task 9's
 * `command-builder` maps it to `{type:'cast', spellId, target}`) and then exits. Valid targets are
 * recomputed from the LATEST projection every render via the pure `computeValidTargets` -- so a
 * moving hostile, a light going out, or the hero stepping around a corner all update the highlighted
 * set live, exactly like every other projection-driven view in this app. The engine independently
 * re-validates on dispatch; nothing here is authoritative.
 */
export function useSpellTargeting(
  session: GuestSession,
  snapshot: SessionSnapshot,
): UseSpellTargetingResult {
  const { projection } = snapshot;
  const [activeSpellId, setActiveSpellId] = useState<string | null>(null);
  const [reticleIndex, setReticleIndex] = useState(0);

  const hero = heroOf(projection);
  const spell = activeSpellId
    ? (hero.castableSpells ?? []).find((candidate) => candidate.spellId === activeSpellId)
    : undefined;

  const candidates = useMemo<readonly TargetCandidate[]>(() => {
    if (!spell) return [];
    return computeValidTargets({
      spell,
      floor: projection.floor,
      hero,
      actors: actorsOf(projection),
    }).candidates;
  }, [spell, projection, hero]);

  const validCells = useMemo(
    () => new Set(candidates.map((candidate) => cellKey(candidate.cell))),
    [candidates],
  );

  const reticle =
    candidates.length === 0
      ? null
      : candidates[((reticleIndex % candidates.length) + candidates.length) % candidates.length]!
          .cell;

  const begin = useCallback((spellId: string): void => {
    setActiveSpellId(spellId);
    setReticleIndex(0);
  }, []);

  const cancel = useCallback((): void => {
    setActiveSpellId(null);
  }, []);

  const dispatchCast = useCallback(
    (point: Point): void => {
      if (!activeSpellId) return;
      session.dispatch({ type: 'cast', spellId: activeSpellId, target: point });
      setActiveSpellId(null);
    },
    [activeSpellId, session],
  );

  const confirmAt = useCallback(
    (point: Point): boolean => {
      if (!activeSpellId || !validCells.has(cellKey(point))) return false;
      dispatchCast(point);
      return true;
    },
    [activeSpellId, dispatchCast, validCells],
  );

  const confirmReticle = useCallback((): boolean => {
    if (!activeSpellId || reticle === null) return false;
    dispatchCast(reticle);
    return true;
  }, [activeSpellId, dispatchCast, reticle]);

  const moveReticle = useCallback((step: 1 | -1): void => {
    setReticleIndex((index) => index + step);
  }, []);

  // The keyboard reticle: arrows cycle candidates, Enter confirms, Escape cancels. Attached only
  // while targeting is active, so it never competes with the ordinary movement/action keydown
  // listener (`usePlayKeyDispatcher`, which `PlayScreen` widens to treat targeting as a modal state
  // so arrows/Enter/etc. never reach it while this listener owns them).
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
        case 'ArrowDown':
          moveReticle(1);
          return;
        case 'ArrowLeft':
        case 'ArrowUp':
          moveReticle(-1);
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSpellId, cancel, confirmReticle, moveReticle]);

  return {
    activeSpellId,
    candidates,
    validCells,
    reticle,
    begin,
    cancel,
    confirmAt,
    confirmReticle,
    moveReticle,
  };
}
