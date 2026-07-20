import { useRef, type JSX } from 'react';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { useDialogFocusTrap } from './focus-trap.js';

interface DecisionPromptProps {
  readonly snapshot: SessionSnapshot;
  readonly session: GuestSession;
}

/** The confirm-aggression prompt: reuses the same dialog primitives as `BackpackMenu` (focus trap,
 * `role="dialog"`), answering with `y`/`n` (or Escape, which declines non-destructively). */
export function DecisionPrompt({ snapshot, session }: DecisionPromptProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(containerRef);
  const decision = snapshot.pendingDecision;
  if (!decision) return null;

  const answer = (confirmed: boolean): void => session.answerDecision(confirmed);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm attack"
      className="decision-prompt"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          answer(false);
          return;
        }
        if (event.key === 'y' || event.key === 'Y') {
          event.preventDefault();
          answer(true);
          return;
        }
        if (event.key === 'n' || event.key === 'N') {
          event.preventDefault();
          answer(false);
        }
      }}
    >
      <p>Attack this target?</p>
      <button type="button" onClick={() => answer(true)}>
        Yes (y)
      </button>
      <button type="button" onClick={() => answer(false)}>
        No (n)
      </button>
    </div>
  );
}
