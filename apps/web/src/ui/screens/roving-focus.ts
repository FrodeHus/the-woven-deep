import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Shared arrow-key/focus bookkeeping for a keyboard-first option list, following the same
 * roving-focus convention `BackpackMenu` uses: a `selectedIndex` that moves with ArrowUp/ArrowDown
 * (wrapping at the ends) and an effect that calls `.focus()` on whichever ref is current whenever
 * the index changes. Callers register each option's DOM node via `registerItem(index)` as a ref
 * callback and forward keydown events to `handleArrowKeys`, which returns `true` when it consumed
 * the key (so callers know not to fall through to their own key handling for that event).
 */
export function useListNavigation(length: number): {
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
  readonly registerItem: (index: number) => (element: HTMLElement | null) => void;
  readonly handleArrowKeys: (event: ReactKeyboardEvent) => boolean;
} {
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [selectedIndex, setSelectedIndexState] = useState(0);

  useEffect(() => {
    if (selectedIndex >= length && length > 0) setSelectedIndexState(length - 1);
  }, [length, selectedIndex]);

  // Refocus the current option whenever the selection moves OR the list itself changes. The
  // `length` dependency matters when an action removes the focused option (e.g. selling the
  // selected offer): the surviving option slides into the same index, so `selectedIndex` does not
  // change, but focus would otherwise be stranded on the now-removed node and the dialog would stop
  // receiving keys. Re-running on `length` restores focus to the option now at `selectedIndex`.
  useEffect(() => {
    itemRefs.current[selectedIndex]?.focus();
  }, [selectedIndex, length]);

  const setSelectedIndex = (index: number): void => setSelectedIndexState(index);

  const registerItem = (index: number) => (element: HTMLElement | null): void => {
    itemRefs.current[index] = element;
  };

  const handleArrowKeys = (event: ReactKeyboardEvent): boolean => {
    if (length === 0) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndexState((index) => (index + 1) % length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndexState((index) => (index - 1 + length) % length);
      return true;
    }
    return false;
  };

  return { selectedIndex, setSelectedIndex, registerItem, handleArrowKeys };
}
