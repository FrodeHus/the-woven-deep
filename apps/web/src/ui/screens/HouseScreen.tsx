import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import { useDialogFocusTrap } from '../BackpackMenu.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';

interface ProjectedItem {
  readonly itemId: OpaqueId;
  readonly name: string;
}

type FocusedList = 'backpack' | 'house';

function backpackItems(snapshot: SessionSnapshot): readonly ProjectedItem[] {
  return (snapshot.projection.hero as unknown as { backpack: readonly ProjectedItem[] }).backpack;
}

function houseState(snapshot: SessionSnapshot): Readonly<{ capacity: number; items: readonly ProjectedItem[] }> {
  return snapshot.projection.house as unknown as Readonly<{ capacity: number; items: readonly ProjectedItem[] }>;
}

export interface HouseScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onClose: () => void;
}

/**
 * The hero's house: two keyboard lists (backpack, house) with Tab switching focus between them
 * and Enter transferring the selected item's full stack across, following the same dialog/focus
 * trap and roving-selection conventions as `BackpackMenu`. Deposits/withdrawals dispatch
 * `house-transfer` intents through the normal command path -- this screen never validates
 * capacity itself (`house.full`/backpack-capacity rejections come back as log lines from the
 * engine, same as every other command), it only renders the capacity readout honestly from the
 * projection.
 */
export function HouseScreen({ snapshot, onDispatch, onClose }: HouseScreenProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<FocusedList, (HTMLButtonElement | null)[]>>({ backpack: [], house: [] });
  const backpack = backpackItems(snapshot);
  const house = houseState(snapshot);
  const [focusedList, setFocusedList] = useState<FocusedList>('backpack');
  const [backpackIndex, setBackpackIndex] = useState(0);
  const [houseIndex, setHouseIndex] = useState(0);

  useDialogFocusTrap(containerRef);

  const activeItems = focusedList === 'backpack' ? backpack : house.items;
  const activeIndex = focusedList === 'backpack' ? backpackIndex : houseIndex;
  const setActiveIndex = focusedList === 'backpack' ? setBackpackIndex : setHouseIndex;

  useEffect(() => {
    itemRefs.current[focusedList][activeIndex]?.focus();
  }, [focusedList, activeIndex]);

  const transfer = (): void => {
    const selected = activeItems[activeIndex];
    if (!selected) return;
    onDispatch({
      type: 'house-transfer',
      action: focusedList === 'backpack' ? 'deposit' : 'withdraw',
      itemId: selected.itemId,
      quantity: 1,
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Stop the native keydown from bubbling to `PlayScreen`'s window-level key dispatcher, which
      // also routes Escape for open overlays -- see the identical fix (and its rationale) in
      // `TradeScreen`. Harmless here today (`setHouseOpen(false)` twice is a no-op) but the same
      // dual-dispatch shape, so it's fixed the same way for consistency.
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      setFocusedList((list) => (list === 'backpack' ? 'house' : 'backpack'));
      return;
    }
    if (activeItems.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % activeItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + activeItems.length) % activeItems.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      transfer();
    }
  };

  const listBox = (list: FocusedList, items: readonly ProjectedItem[], label: string): JSX.Element => (
    <div className={list === focusedList ? 'house-column house-column--focused' : 'house-column'}>
      <h3>{label}</h3>
      {items.length === 0 && <p className="placeholder">Empty.</p>}
      {items.length > 0 && (
        <ul role="listbox" aria-label={label} className="house-item-list">
          {items.map((item, index) => (
            <li key={item.itemId} role="option" aria-selected={list === focusedList && index === (list === 'backpack' ? backpackIndex : houseIndex)}>
              <button
                type="button"
                ref={(element) => { itemRefs.current[list][index] = element; }}
                className={list === focusedList && index === (list === 'backpack' ? backpackIndex : houseIndex)
                  ? 'house-item house-item--selected' : 'house-item'}
                onClick={() => {
                  setFocusedList(list);
                  (list === 'backpack' ? setBackpackIndex : setHouseIndex)(index);
                }}
                onDoubleClick={() => {
                  setFocusedList(list);
                  (list === 'backpack' ? setBackpackIndex : setHouseIndex)(index);
                  transfer();
                }}
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="House"
      className="house-screen"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <h2>House</h2>
      <p className="house-capacity">{`House (${house.items.length}/${house.capacity})`}</p>
      <div className="house-columns">
        {listBox('backpack', backpack, 'Backpack')}
        {listBox('house', house.items, 'House')}
      </div>
      <p className="house-hints">↑↓ select · Tab switch list · Enter transfer · Esc close</p>
    </div>
  );
}
