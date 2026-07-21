import { useEffect, useRef, useState, type JSX } from 'react';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import {
  heroOf,
  houseOf,
  type HouseView,
  type OwnedItemView,
} from '../../session/projection-view.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { LedgerList, type LedgerRow } from '../components/LedgerList.js';
import { CATEGORY_GLYPH } from '../overlays/inventory-model.js';

type FocusedList = 'backpack' | 'house';

function backpackItems(snapshot: SessionSnapshot): readonly OwnedItemView[] {
  return heroOf(snapshot.projection).backpack;
}

function houseState(snapshot: SessionSnapshot): HouseView {
  return houseOf(snapshot.projection);
}

function toRows(items: readonly OwnedItemView[]): readonly LedgerRow[] {
  return items.map((item) => ({
    id: item.itemId,
    glyph: CATEGORY_GLYPH[item.category],
    name: item.name,
    quantity: item.quantity,
  }));
}

export interface HouseScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onClose: () => void;
}

/**
 * The hero's house, laid out as the mockup's two-sided ledger: the guest's BACKPACK on the left, the
 * STRONG CHEST on the right, both lists visible at once with the focused side highlighted. Enter
 * transfers the selected item's full stack across (deposit from the backpack, withdraw from the
 * chest). Deposits/withdrawals dispatch `house-transfer` intents through the normal command path --
 * this screen never validates capacity itself (`house.full`/backpack-capacity rejections come back
 * as log lines from the engine, same as every other command), it only renders the capacity readout
 * honestly from the projection. Drag-across (shown in the mockup) is intentionally not implemented --
 * the engine has no drag transfer, only the click/keyboard `house-transfer` command -- so only the
 * click-and-keyboard path is offered.
 *
 * Framed by the shared `Dialog` primitive, which owns focus trapping and Escape-dismissal (routed
 * back through `onClose` via `onOpenChange`). The Tab/Arrow/Enter list-navigation is driven by a
 * capture-phase `window` keydown listener rather than DOM focus + a component's own arrow handling:
 * `Dialog`'s enter transition briefly renders its popup `hidden` (for the CSS transition-in to
 * register a "before" state), during which nothing inside it is focusable, so a mount-time `.focus()`
 * call races that transition. The capture-phase listener sidesteps the race entirely (the same
 * mechanism the `Dialog` primitive itself uses for Escape) and its `stopPropagation()` keeps a
 * swallowed Tab from reaching anything else. This screen drives each column's `selectedIndex`
 * externally; clicking a row or its action button still transfers normally.
 */
export function HouseScreen({ snapshot, onDispatch, onClose }: HouseScreenProps): JSX.Element {
  const backpack = backpackItems(snapshot);
  const house = houseState(snapshot);
  const [focusedList, setFocusedList] = useState<FocusedList>('backpack');
  const [backpackIndex, setBackpackIndex] = useState(0);
  const [houseIndex, setHouseIndex] = useState(0);

  const activeItems = focusedList === 'backpack' ? backpack : house.items;
  const activeIndex = focusedList === 'backpack' ? backpackIndex : houseIndex;

  const transfer = (list: FocusedList, index: number): void => {
    const items = list === 'backpack' ? backpack : house.items;
    const selected = items[index];
    if (!selected) return;
    onDispatch({
      type: 'house-transfer',
      action: list === 'backpack' ? 'deposit' : 'withdraw',
      itemId: selected.itemId,
      quantity: 1,
    });
  };

  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      setFocusedList((list) => (list === 'backpack' ? 'house' : 'backpack'));
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (activeItems.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const setIndex = focusedList === 'backpack' ? setBackpackIndex : setHouseIndex;
      setIndex((index) => (index + delta + activeItems.length) % activeItems.length);
      return;
    }
    if (event.key === 'Enter') {
      if (activeItems.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      transfer(focusedList, activeIndex);
    }
    // Escape is deliberately left unhandled: it bubbles to the `Dialog` primitive's own
    // Escape-dismissal (document-level), which calls `onOpenChange(false)` -> `onClose` exactly
    // once. That dismiss listener stops the native event there, so `PlayScreen`'s window-level key
    // dispatcher never sees it and can't dispatch a second close.
  };

  // Capture phase: runs before the event reaches any focused descendant (or `document`'s own
  // Escape-dismiss listener), so it works regardless of where DOM focus currently is.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => keyHandlerRef.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="text-center sm:text-center">
          <span aria-hidden="true" className="text-subtle">
            ─── ❦ ───
          </span>
          <DialogTitle className="text-center">Your House</DialogTitle>
        </DialogHeader>
        <p className="text-center font-mono text-xs text-subtle">
          <span>{`House (${house.items.length}/${house.capacity})`}</span>
          <span> · what the Deep cannot take</span>
        </p>
        <div className="grid h-[min(60vh,28rem)] grid-cols-2 border-y border-line">
          <LedgerList
            listLabel="Backpack"
            heading="Backpack"
            headingHint="· enter deposits"
            rows={toRows(backpack)}
            selectedIndex={backpackIndex}
            active={focusedList === 'backpack'}
            onSelect={(index) => {
              setFocusedList('backpack');
              setBackpackIndex(index);
            }}
            onAct={(index) => {
              setFocusedList('backpack');
              transfer('backpack', index);
            }}
            actionLabel="stow ▸"
            actionClassName="border-accent text-accent-strong hover:bg-accent hover:text-deep"
            emptyText="Backpack is empty."
          />
          <div className="flex min-h-0 flex-col border-l border-line">
            <LedgerList
              listLabel="House"
              heading="Strong chest"
              headingHint="· enter withdraws"
              rows={toRows(house.items)}
              selectedIndex={houseIndex}
              active={focusedList === 'house'}
              onSelect={(index) => {
                setFocusedList('house');
                setHouseIndex(index);
              }}
              onAct={(index) => {
                setFocusedList('house');
                transfer('house', index);
              }}
              actionLabel="◂ take"
              actionClassName="border-good text-good hover:bg-good hover:text-deep"
              emptyText="The chest sits empty."
            />
          </div>
        </div>
        <p className="text-center font-mono text-xs text-subtle">
          tab switch side · ↑↓ browse · enter transfer · esc close
        </p>
      </DialogContent>
    </Dialog>
  );
}
