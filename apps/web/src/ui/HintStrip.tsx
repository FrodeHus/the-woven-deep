import type { JSX } from 'react';
import type { HintDefinition } from '../session/onboarding.js';
import { chordKey, type ResolvedKeymap } from '../session/settings.js';

export interface HintStripProps {
  /** The currently active hint (`onboarding.ts`'s `activeHint`), or `null` to render nothing. */
  readonly hint: HintDefinition | null;
  readonly keymap: ResolvedKeymap;
}

/**
 * The contextual onboarding hint strip: `role="note"` (never `alert`/`status` -- a live region
 * would interrupt the guest, which this must never do), no focusable control and no `autoFocus`
 * of any kind, so mounting it never steals focus from wherever it already was. Dismissal is
 * entirely keyboard-driven via the rebindable `dismiss-hint` action (`PlayScreen`'s key
 * dispatcher calls `GuestSession.dismissOnboardingHint`, which folds the dismissal into
 * `OnboardingState` and republishes -- this component only ever reflects whatever hint that
 * produces, it never mutates anything itself). Renders nothing at all -- not even an empty
 * container -- when there's no active hint.
 */
export function HintStrip({ hint, keymap }: HintStripProps): JSX.Element | null {
  if (!hint) return null;
  const dismissChord = chordKey(keymap.byAction['dismiss-hint']);
  return (
    <div className="hint-strip" role="note">
      <p className="hint-strip-copy">{hint.copy(keymap)}</p>
      <span className="hint-strip-dismiss">{`(${dismissChord} to dismiss)`}</span>
    </div>
  );
}
