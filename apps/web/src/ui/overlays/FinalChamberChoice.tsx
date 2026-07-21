import { useRef, type JSX } from 'react';
import type { HeartLineageRecord } from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { useDialogFocusTrap } from './focus-trap.js';

interface FinalChamberChoiceProps {
  readonly snapshot: SessionSnapshot;
  readonly session: GuestSession;
  /** The predecessor bound Heart, from the guest's lineage store (`repository.currentHeart()`) --
   * `null` when no earlier hero has ever chosen `became-heart` in this browser, in which case an
   * authored, nameless fallback identity is shown instead. */
  readonly currentHeart: HeartLineageRecord | null;
}

/** Renders the bound Heart's identity: the predecessor hero's name and (first) class tag when the
 * lineage store has one, or an authored nameless ancestral Heart when it doesn't. */
function heartIdentity(currentHeart: HeartLineageRecord | null): string {
  if (currentHeart === null) return 'a nameless ancestral Heart, bound long before memory';
  const classTag = currentHeart.classTags[0];
  return classTag ? `${currentHeart.heroName}, ${classTag}` : currentHeart.heroName;
}

/** The Final Chamber choice overlay: reuses the same dialog primitives as `DecisionPrompt` (focus
 * trap, `role="dialog"`), but is never dismissible -- reaching the Chamber is a deliberate
 * conclusion, so there is no "decline" affordance, only the three (or two) endings themselves.
 * Presence is driven entirely by `snapshot.pendingFinalChamberChoice` (`guest-session.ts`); a plain
 * move onto the Heart's cell never itself produces this state or dispatches a choice -- only a
 * click/keypress on one of these buttons calls `session.chooseFinalChamber`. */
export function FinalChamberChoice({
  snapshot,
  session,
  currentHeart,
}: FinalChamberChoiceProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(containerRef);
  const pending = snapshot.pendingFinalChamberChoice;
  if (!pending) return null;

  const choose = (choice: 'become-heart' | 'turn-away' | 'break-cycle'): void =>
    session.chooseFinalChamber(choice);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="The Final Chamber"
      className="final-chamber-choice"
      tabIndex={-1}
    >
      <p>Bound at the chamber&rsquo;s center is {heartIdentity(currentHeart)}.</p>
      <button type="button" onClick={() => choose('become-heart')}>
        Become the Heart
      </button>
      <button type="button" onClick={() => choose('turn-away')}>
        Turn away
      </button>
      {pending.canBreakCycle && (
        <button type="button" onClick={() => choose('break-cycle')}>
          Assemble the tablet &amp; free the Heart
        </button>
      )}
    </div>
  );
}
