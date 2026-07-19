import { useEffect, useRef, useState, type JSX } from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { Button } from '../components/button.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/tabs.js';

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

const LIST_LABEL: Readonly<Record<FocusedList, string>> = { backpack: 'Backpack', house: 'House' };
const LIST_ORDER: readonly FocusedList[] = ['backpack', 'house'];

export interface HouseScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onClose: () => void;
}

/**
 * The hero's house: one full-width `ListDetail` list at a time (backpack, house), switched via the
 * shared `Tabs` primitive (Base UI, the same convention `MapJournalOverlay`/`CodexOverlay` use) so
 * item rows always render at full dialog width instead of splitting the pane two ways. Enter
 * transfers the selected item's full stack across. Deposits/withdrawals dispatch `house-transfer`
 * intents through the normal command path -- this screen never validates capacity itself
 * (`house.full`/backpack-capacity rejections come back as log lines from the engine, same as every
 * other command), it only renders the capacity readout honestly from the projection.
 *
 * `Tabs` is controlled by `focusedList` rather than left to its own uncontrolled `defaultValue`: the
 * SAME state also indexes which list a keyboard Tab/Arrow/Enter should act on, so both the visible
 * tab and the keyboard target always agree.
 *
 * Framed by the shared `Dialog` primitive, which owns focus trapping and Escape-dismissal (routed
 * back through `onClose` via `onOpenChange`). The Tab/Enter list-navigation contract is deliberately
 * NOT wired through DOM focus + `ListDetail`'s (or `Tabs`'s) own built-in arrow handling: `Dialog`'s
 * enter transition briefly renders its popup `hidden` (for the CSS transition-in to register a
 * "before" state), during which nothing inside it is focusable, so a mount-time `.focus()` call
 * races that transition. A capture-phase `window` keydown listener sidesteps the race entirely (the
 * same mechanism the `Dialog` primitive itself uses for Escape, via a `document`-level listener) --
 * `ListDetail` still owns the visual list/detail rendering and listbox semantics, this screen just
 * drives its `selectedIndex` externally instead of relying on which element has DOM focus; that same
 * capture-phase `stopPropagation()` keeps a swallowed Tab from ever reaching `Tabs`'s own built-in
 * keyboard handling on the tab buttons, so the two never fight over the same keypress -- clicking a
 * `TabsTrigger` still switches lists normally via `onValueChange`.
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

  const toListItems = (items: readonly ProjectedItem[]): readonly ListDetailItem[] =>
    items.map((item) => ({ id: item.itemId, label: item.name }));

  const listPanel = (list: FocusedList, items: readonly ProjectedItem[], selectedIndex: number, onSelect: (index: number) => void): JSX.Element => (
    <div className="flex flex-col gap-1">
      {items.length === 0 && <p className="text-sm text-muted">Empty.</p>}
      {items.length > 0 && (
        <ListDetail
          listLabel={LIST_LABEL[list]}
          items={toListItems(items)}
          selectedIndex={selectedIndex}
          onSelect={(index) => {
            setFocusedList(list);
            onSelect(index);
          }}
          renderDetail={(item) => (
            item
              ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setFocusedList(list); transfer(list, items.findIndex((entry) => entry.itemId === item.id)); }}
                >
                  {list === 'backpack' ? 'Deposit' : 'Withdraw'}
                </Button>
              )
              : <p className="text-sm text-muted">Nothing selected.</p>
          )}
        />
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>House</DialogTitle>
        </DialogHeader>
        <p className="text-sm font-mono text-muted">{`House (${house.items.length}/${house.capacity})`}</p>
        <Tabs value={focusedList} onValueChange={(value) => setFocusedList(value as FocusedList)}>
          <TabsList aria-label="House lists">
            {LIST_ORDER.map((list) => <TabsTrigger key={list} value={list}>{LIST_LABEL[list]}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="backpack">
            {listPanel('backpack', backpack, backpackIndex, setBackpackIndex)}
          </TabsContent>
          <TabsContent value="house">
            {listPanel('house', house.items, houseIndex, setHouseIndex)}
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted">↑↓ select · Tab switch list · Enter transfer · Esc close</p>
      </DialogContent>
    </Dialog>
  );
}
