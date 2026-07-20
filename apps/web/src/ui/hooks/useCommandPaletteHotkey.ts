import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

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
  const isModalActiveRef = useRef(isModalActive);
  isModalActiveRef.current = isModalActive;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isModalActiveRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return [paletteOpen, setPaletteOpen];
}
