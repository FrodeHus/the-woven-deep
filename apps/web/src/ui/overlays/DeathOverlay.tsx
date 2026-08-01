import { useRef, type JSX } from 'react';
import { useDialogFocusTrap } from './focus-trap.js';

export interface DeathOverlayProps {
  /** Called exactly once, whether acknowledged by clicking anywhere on the overlay or pressing
   * Enter -- guarded internally so a stray double-fire (both handlers landing near-simultaneously,
   * or a held/repeated Enter) never invokes it twice. */
  readonly onAcknowledge: () => void;
  /** Wanderer only. When present the overlay offers two actions -- Rise again (default focus) and
   * Accept death -- instead of the single click/Enter acknowledgment. */
  readonly onRise?: () => void;
}

/**
 * The full-bleed death beat shown the instant a run concludes by hero death, before the
 * conclusion screen. `GameRoot` still finalizes the run (the Hall write) immediately in its
 * conclusion effect exactly as for any other completion; this overlay only gates the *navigation*
 * to the conclusion screen behind the player's acknowledgment, so the death always gets its own
 * beat instead of cutting straight to the ledger.
 *
 * In Wanderer (`onRise` given) the beat becomes a choice instead: the run is NOT finalized yet,
 * and the player picks between rising at the floor's mouth and letting the death stand. Nothing
 * else about the overlay changes.
 *
 * Reuses `useDialogFocusTrap` (the same hand-rolled trap `DecisionPrompt` uses) purely for its
 * focus-on-mount/restore-on-unmount behavior -- there is nothing tabbable inside, so the trap's
 * Tab-wrapping never has anything to do.
 */
export function DeathOverlay({ onAcknowledge, onRise }: DeathOverlayProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(containerRef);
  const acknowledgedRef = useRef(false);

  function acknowledge(): void {
    if (acknowledgedRef.current) return;
    acknowledgedRef.current = true;
    onAcknowledge();
  }

  function rise(): void {
    if (acknowledgedRef.current || !onRise) return;
    acknowledgedRef.current = true;
    onRise();
  }

  // With two actions offered, the death is a decision: the container's own click/Enter
  // acknowledgment is dropped entirely, so a stray background click can never end the run behind
  // the player's back. Classic (no `onRise`) keeps the single acknowledge unchanged.
  return (
    <div
      ref={containerRef}
      role="alertdialog"
      aria-label="The Deep takes you"
      tabIndex={-1}
      onClick={onRise ? undefined : acknowledge}
      onKeyDown={
        onRise
          ? undefined
          : (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                acknowledge();
              }
            }
      }
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/70 text-center ${
        onRise ? '' : 'cursor-pointer'
      }`}
    >
      <p className="animate-pulse font-serif text-4xl tracking-[0.35em] text-danger">
        THE DEEP TAKES YOU
      </p>
      {onRise ? (
        <div className="flex items-center gap-4">
          <button
            type="button"
            autoFocus
            onClick={rise}
            className="border border-accent bg-raised px-4 py-2 font-mono text-accent-strong hover:bg-accent hover:text-deep"
          >
            Rise again
          </button>
          <button
            type="button"
            onClick={acknowledge}
            className="border border-line bg-raised px-4 py-2 font-mono text-muted hover:text-fg"
          >
            Accept death
          </button>
        </div>
      ) : (
        <p className="font-mono text-sm text-muted">
          the Weave remembers · press enter or click to continue
        </p>
      )}
    </div>
  );
}
