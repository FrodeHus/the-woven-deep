import type { JSX } from 'react';
import type { HintDefinition } from '../../session/onboarding.js';
import { chordKey, type ResolvedKeymap } from '../../session/settings.js';

export interface HintFloatProps {
  /** The currently active hint (`onboarding.ts`'s `activeHint`), or `null` to render nothing. */
  readonly hint: HintDefinition | null;
  readonly keymap: ResolvedKeymap;
}

/**
 * The contextual onboarding hint, floated centered above the action bar: muted mono copy on a
 * translucent dark panel, with the dismiss chord shown alongside. `role="note"` (never
 * alert/status -- a live region would interrupt the guest) and no focusable control, so mounting it
 * never steals focus. Dismissal is keyboard-driven via the rebindable `dismiss-hint` action
 * (`PlayScreen`'s key dispatcher folds it into `OnboardingState` and republishes); this component
 * only reflects whatever hint that produces. Renders nothing at all when there is no active hint --
 * which is also the case whenever onboarding is off, since `activeHint` then yields `null`.
 */
export function HintFloat({ hint, keymap }: HintFloatProps): JSX.Element | null {
  if (!hint) return null;
  const dismissChord = chordKey(keymap.byAction['dismiss-hint']);
  return (
    <div
      role="note"
      className="pointer-events-auto flex items-center gap-3 rounded-md border border-line bg-deep/70 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur-sm"
    >
      <span className="hint-float-copy">{hint.copy(keymap)}</span>
      <span className="hint-float-dismiss text-subtle">{`(${dismissChord} to dismiss)`}</span>
    </div>
  );
}
