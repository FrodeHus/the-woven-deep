import { useRef, type JSX } from 'react';
import { useDialogFocusTrap } from './focus-trap.js';

export interface DeathOverlayProps {
  /** Called exactly once, whether acknowledged by clicking anywhere on the overlay or pressing
   * Enter -- guarded internally so a stray double-fire (both handlers landing near-simultaneously,
   * or a held/repeated Enter) never invokes it twice. */
  readonly onAcknowledge: () => void;
}

/**
 * The full-bleed death beat shown the instant a run concludes by hero death, before the
 * conclusion screen. `GameRoot` still finalizes the run (the Hall write) immediately in its
 * conclusion effect exactly as for any other completion; this overlay only gates the *navigation*
 * to the conclusion screen behind the player's acknowledgment, so the death always gets its own
 * beat instead of cutting straight to the ledger.
 *
 * Reuses `useDialogFocusTrap` (the same hand-rolled trap `DecisionPrompt` uses) purely for its
 * focus-on-mount/restore-on-unmount behavior -- there is nothing tabbable inside, so the trap's
 * Tab-wrapping never has anything to do.
 */
export function DeathOverlay({ onAcknowledge }: DeathOverlayProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(containerRef);
  const acknowledgedRef = useRef(false);

  function acknowledge(): void {
    if (acknowledgedRef.current) return;
    acknowledgedRef.current = true;
    onAcknowledge();
  }

  return (
    <div
      ref={containerRef}
      role="alertdialog"
      aria-label="The Deep takes you"
      tabIndex={-1}
      onClick={acknowledge}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          acknowledge();
        }
      }}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 bg-black/70 text-center"
    >
      <p className="animate-pulse font-serif text-4xl tracking-[0.35em] text-danger">
        THE DEEP TAKES YOU
      </p>
      <p className="font-mono text-sm text-muted">
        the Weave remembers · press enter or click to continue
      </p>
    </div>
  );
}
