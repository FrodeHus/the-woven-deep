import { useEffect, type RefObject } from 'react';
import type { GameplayProjection } from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import type { ResolvedKeymap } from '../../session/settings.js';
import { createKeyDispatcher, type OverlayActionId } from '../KeyRouter.js';
import type { OverlayId } from '../overlays/registry.js';

export interface PlayKeyDispatcherParams {
  readonly session: GuestSession;
  readonly overlay: OverlayId | null;
  readonly houseOpen: SessionSnapshot['houseOpen'];
  readonly trade: GameplayProjection['trade'];
  readonly pendingDecision: SessionSnapshot['pendingDecision'];
  readonly onOpenOverlay: (overlay: OverlayActionId) => void;
  readonly onCloseOverlay: () => void;
  readonly keymap: ResolvedKeymap;
  readonly activeHintRef: RefObject<string | null>;
}

/**
 * The single global keydown listener: `createKeyDispatcher` translates keys to intents via the
 * pure `routeKey` and forwards them to the session, rate-limiting OS key auto-repeat so it
 * can't outpace what the player can perceive (see `KeyRouter.ts`'s input-flood guard).
 */
export function usePlayKeyDispatcher({
  session,
  overlay,
  houseOpen,
  trade,
  pendingDecision,
  onOpenOverlay,
  onCloseOverlay,
  keymap,
  activeHintRef,
}: PlayKeyDispatcherParams): void {
  useEffect(() => {
    const dispatcher = createKeyDispatcher(
      {
        dispatch: (intent) => session.dispatch(intent),
        openOverlay: (overlayActionId) => {
          // Two of the six overlay-open actions are their own onboarding milestones --
          // "inspection"/"inventory" mastery is a one-time open, which never goes through
          // `session.dispatch` at all (opening an overlay is client-side UI state, not a
          // `PlayerIntent`), so it's folded in right here instead.
          if (overlayActionId === 'character-sheet')
            session.recordOnboardingIntent('open-character-sheet');
          else if (overlayActionId === 'inventory')
            session.recordOnboardingIntent('open-inventory');
          onOpenOverlay(overlayActionId);
        },
        dismissHint: () => {
          const id = activeHintRef.current;
          if (id) session.dismissOnboardingHint(id);
        },
        closeOverlay: () => {
          // `inventory` is a registry overlay like every other one, so this first branch already
          // covers it.
          if (overlay !== null) {
            onCloseOverlay();
            return;
          }
          if (houseOpen) session.setHouseOpen(false);
          // Unlike the house overlay (a pure client-side toggle), an open trade session is engine
          // state (`projection.trade`): closing it means dispatching `trade-close`, not flipping a
          // local flag -- the screen unmounts once the resulting projection clears `trade`.
          else if (trade) session.dispatch({ type: 'trade-close' });
          else if (pendingDecision) session.answerDecision(false);
        },
      },
      () => overlay !== null || houseOpen || trade !== undefined || pendingDecision !== null,
      () => keymap,
    );
    window.addEventListener('keydown', dispatcher);
    return () => window.removeEventListener('keydown', dispatcher);
  }, [session, houseOpen, trade, pendingDecision, overlay, onOpenOverlay, onCloseOverlay, keymap]);
}
