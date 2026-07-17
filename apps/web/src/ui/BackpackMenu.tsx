import {
  useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { SessionSnapshot } from '../session/guest-session.js';
import type { PlayerIntent } from '../session/intents.js';

interface ProjectedBackpackItem {
  readonly itemId: OpaqueId;
  readonly name: string;
}

interface MenuItem {
  readonly itemId: OpaqueId;
  readonly name: string;
  /** `true` for a currently-equipped item: it renders with an "(equipped)" suffix and `e`
   * unequips it (moving it into the backpack) rather than equipping. */
  readonly equipped: boolean;
}

/**
 * Everything the menu can act on: the hero's backpack stacks first (so the pinned e2e walks that
 * act on "the first backpack item" are unaffected), then each equipped item. Listing equipped gear
 * here is the only keyboard path to `unequip` -- required to move starting gear into the backpack
 * before it can be sold to a merchant (merchant sale accepts backpack-located items only).
 */
function menuItems(snapshot: SessionSnapshot): readonly MenuItem[] {
  const heroData = snapshot.projection.hero as unknown as {
    backpack: readonly ProjectedBackpackItem[];
    equipment: Readonly<Record<string, ProjectedBackpackItem | null>>;
  };
  const backpack = heroData.backpack.map((item) => ({ itemId: item.itemId, name: item.name, equipped: false }));
  const equipped = Object.values(heroData.equipment)
    .filter((item): item is ProjectedBackpackItem => item !== null)
    .map((item) => ({ itemId: item.itemId, name: item.name, equipped: true }));
  return [...backpack, ...equipped];
}

function focusableElements(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => !element.hasAttribute('disabled'));
}

/**
 * Hand-rolled focus trap shared by any modal dialog in the guest UI (the backpack menu and the
 * confirm-aggression decision prompt): focuses the dialog's first focusable element on mount,
 * wraps Tab/Shift+Tab at the edges so focus never escapes to the page behind it, and restores
 * focus to whatever had it beforehand once the dialog closes or unmounts.
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

export interface BackpackMenuProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onClose: () => void;
}

/**
 * The guest's backpack, opened with `i` (see `KeyRouter`). A `role="dialog"` with a focus trap: a
 * keyboard list of items (up/down to move the selection) with single-letter action hints —
 * `e`quip, `u`se, `d`rop, toggle-`l`ight — applied to whichever item is currently selected.
 * Escape closes it directly (rather than relying on the global router) so the dialog behaves
 * correctly in isolation, e.g. under test.
 */
export function BackpackMenu({ snapshot, onDispatch, onClose }: BackpackMenuProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const items = menuItems(snapshot);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useDialogFocusTrap(containerRef);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.focus();
  }, [selectedIndex]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Stop the native keydown from bubbling to `PlayScreen`'s window-level key dispatcher, which
      // also routes Escape for open overlays -- see the identical fix (and its rationale) in
      // `TradeScreen`. Harmless here today (`setBackpackOpen(false)` twice is a no-op) but the same
      // dual-dispatch shape, so it's fixed the same way for consistency.
      event.stopPropagation();
      onClose();
      return;
    }
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + items.length) % items.length);
      return;
    }
    const selected = items[selectedIndex];
    if (!selected) return;
    const key = event.key.toLowerCase();
    if (key === 'e') {
      onDispatch({ type: 'backpack', action: selected.equipped ? 'unequip' : 'equip', itemId: selected.itemId });
    } else if (key === 'u') onDispatch({ type: 'backpack', action: 'use', itemId: selected.itemId });
    else if (key === 'd') onDispatch({ type: 'backpack', action: 'drop', itemId: selected.itemId });
    else if (key === 'l') onDispatch({ type: 'backpack', action: 'toggle-light', itemId: selected.itemId });
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Backpack"
      className="backpack-menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <h2>Backpack</h2>
      {items.length === 0 && <p className="placeholder">Your backpack is empty.</p>}
      {items.length > 0 && (
        <ul role="listbox" aria-label="Backpack items" className="backpack-item-list">
          {items.map((item, index) => (
            <li key={item.itemId} role="option" aria-selected={index === selectedIndex}>
              <button
                type="button"
                ref={(element) => { itemRefs.current[index] = element; }}
                className={index === selectedIndex ? 'backpack-item backpack-item--selected' : 'backpack-item'}
                onClick={() => setSelectedIndex(index)}
              >
                {item.equipped ? `${item.name} (equipped)` : item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="backpack-hints">↑↓ select · e (un)equip · u use · d drop · l toggle light · Esc close</p>
    </div>
  );
}
