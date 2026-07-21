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
      className="wd-rise-in fixed bottom-40 left-1/2 z-[45] flex w-160 max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-4 border border-double border-danger bg-surface p-4 font-mono shadow-[0_16px_60px_rgba(0,0,0,0.65)]"
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
      <div
        aria-hidden="true"
        className="grid size-16 flex-none place-items-center border border-danger bg-raised font-serif text-3xl text-danger"
      >
        ⚔
      </div>
      <div className="flex-1">
        <div className="mb-1 font-serif text-[0.9375rem] text-fg-strong">A wary moment</div>
        <p className="mb-3 font-serif text-sm italic leading-snug text-fg">
          “Attack this target?”
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => answer(true)}
            className="cursor-pointer border border-danger bg-raised px-3 py-1.5 font-mono text-xs text-danger-fg hover:bg-danger hover:text-deep"
          >
            Yes <span className="opacity-60">[y]</span>
          </button>
          <button
            type="button"
            onClick={() => answer(false)}
            className="cursor-pointer border border-line bg-raised px-3 py-1.5 font-mono text-xs text-muted hover:border-muted hover:text-fg"
          >
            No <span className="opacity-60">[n]</span>
          </button>
        </div>
      </div>
    </div>
  );
}
