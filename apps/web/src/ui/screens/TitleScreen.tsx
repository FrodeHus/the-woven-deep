import type { JSX } from 'react';
import { decodeActiveRun } from '@woven-deep/engine';
import type { AccountState } from '../../session/account.js';
import { SAVE_KEY, type SessionStorageLike } from '../../session/storage.js';
import type { OverlayId } from '../overlays/registry.js';
import { useListNavigation } from './roving-focus.js';
import { cn } from '../lib/cn.js';

export interface TitleScreenProps {
  readonly storage: SessionStorageLike;
  readonly onEnterTheDeep: () => void;
  readonly onContinue: () => void;
  readonly onHall: () => void;
  /** Opens one of the global-scope overlays (Codex / Settings / Help) directly from the title
   * menu -- optional so every pre-existing caller (which never offered these entries) keeps
   * working unchanged; when omitted, the three menu options simply aren't rendered. */
  readonly onOpenOverlay?: (overlay: OverlayId) => void;
  /** The signed-in identity (or `GUEST_ACCOUNT`) -- gates the "Sign in with email"/"Sign out"
   * menu entries and, when signed in, the email line shown above the menu. */
  readonly account: AccountState;
  /** Navigates to the `signin` screen. Offered only while `account.status === 'guest'`. */
  readonly onSignIn: () => void;
  /** Signs the current session out. Offered only while `account.status === 'signed-in'`, in
   * place of (never alongside) "Sign in with email". */
  readonly onSignOut: () => void;
}

/**
 * Whether Continue should be offered: only when storage holds a save AND that save decodes
 * cleanly through the real engine codec. A corrupt or schema-incompatible save must NOT surface
 * Continue — `GuestSession` would discard it anyway (with a save-discarded notice) once
 * constructed, but the title screen shouldn't invite the player into that path in the first
 * place. Probed fresh on every render so a save that appears between renders (there is no such
 * path today, but the check is cheap) is picked up.
 */
function canContinue(storage: SessionStorageLike): boolean {
  const raw = storage.get(SAVE_KEY);
  if (raw === null) return false;
  try {
    decodeActiveRun(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The guest's landing screen inside `/play`: a keyboard-first menu of "Enter the Deep" (starts
 * chargen), "Continue" (resumes a decodable save — omitted otherwise), and "Hall of Records"
 * (always offered; its content is wired up in a later task). Reuses the same roving-focus
 * listbox convention as the chargen wizard's option lists.
 */
export function TitleScreen({
  storage,
  onEnterTheDeep,
  onContinue,
  onHall,
  onOpenOverlay,
  account,
  onSignIn,
  onSignOut,
}: TitleScreenProps): JSX.Element {
  const signedIn = account.status === 'signed-in';
  const options: readonly {
    readonly key: string;
    readonly label: string;
    readonly onSelect: () => void;
  }[] = [
    { key: 'enter', label: 'Enter the Deep', onSelect: onEnterTheDeep },
    ...(canContinue(storage) ? [{ key: 'continue', label: 'Continue', onSelect: onContinue }] : []),
    { key: 'hall', label: 'Hall of Records', onSelect: onHall },
    ...(onOpenOverlay
      ? [
          { key: 'codex', label: 'Codex', onSelect: () => onOpenOverlay('codex') },
          { key: 'settings', label: 'Settings', onSelect: () => onOpenOverlay('settings') },
          { key: 'help', label: 'Help', onSelect: () => onOpenOverlay('help') },
        ]
      : []),
    ...(signedIn
      ? [{ key: 'sign-out', label: 'Sign out', onSelect: onSignOut }]
      : [{ key: 'sign-in', label: 'Sign in with email', onSelect: onSignIn }]),
  ];
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(options.length);

  return (
    <section aria-label="Title" className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <p className="text-xs uppercase tracking-widest text-muted">The Woven Deep</p>
      <h1 className="framed-title font-serif text-4xl text-accent-strong">The Woven Deep</h1>
      {signedIn && <p className="text-sm text-muted">Signed in as {account.email}</p>}
      <div
        role="listbox"
        aria-label="Title menu"
        className="flex max-w-xs flex-col gap-1.5"
        onKeyDown={handleArrowKeys}
      >
        {options.map((option, index) => (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            ref={registerItem(index)}
            className={cn(
              'rounded-md border border-line bg-surface px-3.5 py-2.5 text-left text-sm text-fg hover:bg-raised',
              index === selectedIndex &&
                'outline outline-2 outline-accent outline-offset-2 border-accent',
            )}
            onClick={option.onSelect}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
