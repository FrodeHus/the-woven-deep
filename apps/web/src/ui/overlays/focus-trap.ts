import { useEffect, type RefObject } from 'react';

function focusableElements(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => !element.hasAttribute('disabled'));
}

/**
 * Hand-rolled focus trap shared by every modal dialog in the guest UI (the backpack menu, the
 * confirm-aggression decision prompt, trade/house screens, and every registry overlay): focuses
 * the dialog's first focusable element on mount, wraps Tab/Shift+Tab at the edges so focus never
 * escapes to the page behind it, and restores focus to whatever had it beforehand once the dialog
 * closes or unmounts.
 *
 * Originally defined in the now-deleted `BackpackMenu.tsx` (absorbed into `InventoryOverlay.tsx`
 * by Task 5); its remaining consumers (`DecisionPrompt` in `PlayScreen.tsx`, `HouseScreen`,
 * `TradeScreen`) import it from here directly. The registry overlays themselves now get their
 * focus trapping from the `Sheet`/`Dialog` primitives in `OverlayHost.tsx`, not from here.
 */
export function useDialogFocusTrap(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial = focusableElements(container)[0] ?? container;
    initial.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const items = focusableElements(container);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [containerRef]);
}
