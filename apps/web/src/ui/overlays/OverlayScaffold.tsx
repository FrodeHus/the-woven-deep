import { useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useDialogFocusTrap } from './focus-trap.js';

export interface OverlayScaffoldProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** `overlay-${id}` -- a stable, id-derived test hook (see `PlayScreen`/`App`'s overlay host). */
  readonly testId: string;
}

/**
 * The shared modal frame for every registry overlay: `role="dialog"`, a focus trap
 * (`useDialogFocusTrap`), and an Escape handler that closes it directly. `stopPropagation` here is
 * the same 5C Task 7b discipline `TradeScreen`/`BackpackMenu` already use: without it, this
 * component's own `onClose()` call closes the overlay, and the SAME native keydown then bubbles to
 * `PlayScreen`'s window-level key dispatcher, which also treats an open overlay as
 * Escape-closeable and would dispatch a second, now-stale close.
 */
export function OverlayScaffold({ title, onClose, children, testId }: Readonly<OverlayScaffoldProps>): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(containerRef);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className="overlay-scaffold"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <h2>{title}</h2>
      {children}
      <p className="overlay-hints">Esc close</p>
    </div>
  );
}
