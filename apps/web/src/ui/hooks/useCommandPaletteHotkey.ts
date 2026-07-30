import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * The ⌘K command palette is a UI-only concern (the discovery surface over the same
 * intents/overlays the keymap already routes to), so it stays a separate window listener from
 * `createKeyDispatcher` rather than another routed `ActionId` -- guarded to fire only when nothing
 * else modal is already active, exactly like that dispatcher's own guard.
 */
export function useCommandPaletteHotkey(
  isModalActive: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The guard is a plain dependency rather than a ref read inside the listener: the listener is
  // re-attached whenever modal activity flips (a handful of times per run), which is cheaper than it
  // sounds and keeps the handler a pure function of the current render's props.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isModalActive) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModalActive]);

  return [paletteOpen, setPaletteOpen];
}
