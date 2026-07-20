import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { MerchantServiceId } from '@woven-deep/content';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import {
  heroOf, ownedItemOf, tradeOf, type TradeView,
} from '../../session/projection-view.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { Button } from '../components/button.js';
import { Tabs, TabsList, TabsTrigger } from '../components/tabs.js';

/** The minimal owned-item shape the trade rows read -- an owned item's projection, or a bare
 * `{ itemId, name }` fallback when the offer's item is no longer in the hero's own projection. */
interface ProjectedItemRef {
  readonly itemId: OpaqueId;
  readonly name: string;
  readonly glyph?: string;
}

function trade(snapshot: SessionSnapshot): TradeView | undefined {
  return tradeOf(snapshot.projection);
}

/** Sale offers only carry an `itemId` (see `ObservableTradeProjection.saleOffers`), so the
 * sellable name comes from the hero's own backpack projection, same lookup `command-builder.ts`'s
 * `ownedItem` performs. Falls back to the raw id if the backpack projection is ever out of sync
 * with the offer list (should not happen, but a fallback beats a blank row). */
function backpackItemName(snapshot: SessionSnapshot, itemId: OpaqueId): string {
  return heroOf(snapshot.projection).backpack.find((item) => item.itemId === itemId)?.name ?? itemId;
}

/** Identify targets can be backpacked OR equipped (see `identifyTargetIds` in
 * `packages/engine/src/projection.ts`), so -- unlike `backpackItemName` above, which only ever
 * looks at sale offers -- this checks both `hero.backpack` and `hero.equipment` for the owned
 * item's projected name/glyph. Falls back to the raw id if neither owns it (should not happen). */
function ownedItemRef(snapshot: SessionSnapshot, itemId: OpaqueId): ProjectedItemRef {
  return ownedItemOf(heroOf(snapshot.projection), itemId) ?? { itemId, name: itemId };
}

type FocusedList = 'buy' | 'sell' | 'services';

const LIST_ORDER: readonly FocusedList[] = ['buy', 'sell', 'services'];
const LIST_LABEL: Readonly<Record<FocusedList, string>> = { buy: 'Buy', sell: 'Sell', services: 'Services' };
const PICKER_LABEL = 'Identify target';

/** `MerchantServiceId` is a closed, hardcoded union (`packages/content/src/model.ts`) rather than a
 * dynamically registered content entry, so there is no pack lookup that resolves it to a display
 * name -- this is the one place that mapping lives, and every service row reads its label from
 * here instead of ever rendering the raw `merchant-service.<id>` string. */
const SERVICE_LABEL: Readonly<Record<MerchantServiceId, string>> = {
  'merchant-service.identify': 'Identify',
  'merchant-service.strongbox': 'Strongbox',
};

interface TradeRow {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
}

/** Seats DOM focus so `handleKeyDown` receives keys. While the picker is open, focus goes to the
 * container itself and `handleKeyDown` drives the picker directly -- moving focus onto the picker's
 * own listbox instead would race the `Dialog`'s focus manager. Otherwise focus goes to the active
 * tab's `ListDetail` listbox so the primitive owns its arrows, falling back to the container when
 * that list is empty. Returns the focused element (shared by the focus effect and `initialFocus`). */
function focusActiveList(container: HTMLElement, pickerOpen: boolean): HTMLElement {
  const listbox = pickerOpen
    ? null
    : container.querySelector<HTMLElement>(`[role="listbox"]:not([aria-label="${PICKER_LABEL}"])`);
  const target = listbox ?? container;
  target.focus();
  return target;
}

export interface TradeScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onClose: () => void;
}

/**
 * The merchant trade dialog: one full-width `ListDetail` list at a time (buy from stock, sell from
 * the backpack, purchase a service), switched via the shared `Tabs` primitive (Base UI, the same
 * convention `MapJournalOverlay`/`CodexOverlay` use) so item rows always render at full dialog width
 * instead of splitting the pane three ways. Every price, stock quantity, and offer comes straight
 * from `projection.trade` -- this screen never computes a price itself, it only dispatches the
 * intent and lets the engine's rejection (insufficient funds, stock unavailable, capacity, ...) come
 * back as the usual log line. Renders nothing if the session projection has no active trade
 * (defensive: `PlayScreen` only mounts this while `projection.trade` is set, but an in-flight
 * Esc/close can race a session update that clears it).
 *
 * `Tabs` is controlled by `focusedList`, which also names the list a keyboard Tab/Enter acts on so
 * the visible tab and the keyboard target always agree. DOM focus drives selection: the active
 * list's `ListDetail` listbox is focused (on open via the `Dialog` popup's `initialFocus`, and on
 * every tab-switch via a focus effect), so `ListDetail` owns that list's ArrowUp/ArrowDown/Home/End.
 * Enter (act on the selected row) and Tab (advance to the next list) are layered on top by an
 * `onKeyDown` on this screen's own container -- they fire only while focus is inside it, and
 * `stopPropagation()` keeps them from reaching `Tabs`'s tab-button keyboard handling. Clicking a
 * `TabsTrigger` still switches lists via `onValueChange`.
 *
 * A service with eligible targets (e.g. identify) opens an inline nested `ListDetail` picker instead
 * of dispatching immediately. While the picker is open, focus rests on the container and its
 * `onKeyDown` drives the picker's Arrow/Enter directly (Tab is swallowed), so the picker never has to
 * win a focus move away from the active list against the `Dialog`'s focus manager. Escape is owned by
 * the `Dialog` primitive: it fires `onOpenChange(false)` (reason `escape-key`) and stops the native
 * event before `PlayScreen`'s window-level dispatcher ever sees it, so this screen routes that single
 * close through `onOpenChange` -- closing the picker first when it is open, otherwise the whole dialog
 * via `onClose`.
 */
export function TradeScreen({ snapshot, onDispatch, onClose }: TradeScreenProps): JSX.Element | null {
  const session = trade(snapshot);
  const [focusedList, setFocusedList] = useState<FocusedList>('buy');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Set only for services whose `targetItemIds` is non-empty (e.g. identify): opening the picker
  // replaces the immediate dispatch with an inline target list. A service with no eligible
  // targets (or the targetless strongbox) never touches this state.
  const [pickerServiceId, setPickerServiceId] = useState<MerchantServiceId | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // `onOpenChange` reads the picker state through a ref so the `Dialog`'s Escape close always sees
  // the current value regardless of when Base UI captured the handler.
  const pickerServiceIdRef = useRef<MerchantServiceId | null>(pickerServiceId);
  pickerServiceIdRef.current = pickerServiceId;

  const pickerService = pickerServiceId === null
    ? null
    : (session?.services.find((entry) => entry.serviceId === pickerServiceId) ?? null);

  const rows = useMemo((): Readonly<Record<FocusedList, readonly TradeRow[]>> => {
    if (!session) return { buy: [], sell: [], services: [] };
    return {
      buy: session.stock.map((entry) => ({
        id: entry.item.itemId,
        label: `${entry.item.name} (${entry.quantity}) — ${entry.unitPrice}g`,
        run: () => onDispatch({ type: 'trade-buy', itemId: entry.item.itemId, quantity: 1 }),
      })),
      sell: session.saleOffers.map((entry) => ({
        id: entry.itemId,
        label: `${backpackItemName(snapshot, entry.itemId)} (${entry.quantity}) — ${entry.unitPrice}g`,
        run: () => onDispatch({ type: 'trade-sell', itemId: entry.itemId, quantity: 1 }),
      })),
      services: session.services.map((entry) => ({
        id: entry.serviceId,
        label: `${SERVICE_LABEL[entry.serviceId]} (${entry.remainingUses} left) — ${entry.unitPrice}g`,
        // A service with eligible targets (e.g. identify) opens the inline picker instead of guessing
        // which item the player meant; a targetless service (e.g. the strongbox) dispatches straight
        // through.
        run: () => {
          if (entry.targetItemIds.length > 0) {
            setPickerIndex(0);
            setPickerServiceId(entry.serviceId);
          } else {
            onDispatch({ type: 'trade-service', serviceId: entry.serviceId, targetItemId: null });
          }
        },
      })),
    };
  }, [session, snapshot, onDispatch]);

  const activeRows = rows[focusedList];

  // Keeps DOM focus on whichever listbox owns keyboard selection: the picker's while it is open,
  // otherwise the active tab's. Runs on first open, on every tab-switch / picker transition, and
  // whenever the active list's row count changes -- a dispatch (e.g. selling the last offer) can
  // empty the list and unmount its listbox without a tab-switch, so `activeRows.length` is also a
  // dependency. The container itself is the fallback when the active list is empty (no listbox to
  // focus), so Enter and Tab still reach `handleKeyDown` instead of stranding focus on a tab button.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    focusActiveList(root, pickerServiceId !== null);
    if (activeRows.length > 0) {
      setSelectedIndex((index) => Math.max(0, Math.min(index, activeRows.length - 1)));
    }
  }, [focusedList, pickerServiceId, activeRows.length]);

  function switchList(next: FocusedList): void {
    setFocusedList(next);
    setSelectedIndex(0);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (pickerServiceId) {
      const targets = pickerService?.targetItemIds ?? [];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (targets.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setPickerIndex((index) => (index + delta + targets.length) % targets.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const targetItemId = targets[pickerIndex];
        if (targetItemId) {
          onDispatch({ type: 'trade-service', serviceId: pickerServiceId, targetItemId });
        }
        setPickerServiceId(null);
      } else if (event.key === 'Tab') {
        // List-switching does not apply to the target picker.
        event.preventDefault();
        event.stopPropagation();
      }
      // Escape falls through to the `Dialog` primitive, which routes it back to `onOpenChange`.
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      switchList(LIST_ORDER[(LIST_ORDER.indexOf(focusedList) + 1) % LIST_ORDER.length]!);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      activeRows[selectedIndex]?.run();
    }
  }

  if (!session) return null;

  const toListItems = (list: readonly TradeRow[]): readonly ListDetailItem[] =>
    list.map((row) => ({ id: row.id, label: row.label }));

  const actionLabel = focusedList === 'buy' ? 'Buy' : focusedList === 'sell' ? 'Sell' : 'Use';

  return (
    <Dialog
      open
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) return;
        // The `Dialog` collapses every dismissal (Escape, backdrop, close button) into a single
        // close signal. Only an Escape while the picker is open should peel off the picker instead
        // of the whole dialog -- every other dismissal closes the trade.
        if (eventDetails.reason === 'escape-key' && pickerServiceIdRef.current) {
          setPickerServiceId(null);
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        // `Dialog` mounts its popup contents behind an enter transition, so a mount-time `.focus()`
        // effect runs before the container exists; the popup's own post-enter `initialFocus` hook is
        // the transition-aware place to seat focus on the active listbox for the first open.
        initialFocus={() => (containerRef.current ? focusActiveList(containerRef.current, pickerServiceIdRef.current !== null) : false)}
      >
        <DialogHeader>
          <DialogTitle>Trade</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-strong">{session.merchantName}</p>
        <p className="text-sm text-muted">{session.reputationTier}</p>
        <p className="text-sm font-mono text-fg">{`${session.currency}g`}</p>
        <div ref={containerRef} tabIndex={-1} className="flex flex-col gap-2 outline-none" onKeyDown={handleKeyDown}>
          <Tabs value={focusedList} onValueChange={(value) => switchList(value as FocusedList)}>
            <TabsList aria-label="Trade lists">
              {LIST_ORDER.map((list) => <TabsTrigger key={list} value={list}>{LIST_LABEL[list]}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {/* One list panel for the active tab, rendered outside `Tabs` so its `ListDetail` listbox
            * is a single persistent DOM node whose items change as the tab switches -- keyboard focus
            * never has to survive a listbox unmount/remount (which would race the `Dialog`'s focus
            * trap). An empty list drops the listbox entirely and shows the placeholder instead. */}
          <div className="flex flex-col gap-1">
            {activeRows.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
            {activeRows.length > 0 && (
              <ListDetail
                listLabel={LIST_LABEL[focusedList]}
                items={toListItems(activeRows)}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                renderDetail={(item) => (
                  item
                    ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => activeRows.find((row) => row.id === item.id)?.run()}
                      >
                        {actionLabel}
                      </Button>
                    )
                    : <p className="text-sm text-muted">Nothing selected.</p>
                )}
              />
            )}
          </div>
          {pickerService && (
            <div className="flex flex-col gap-1 rounded-md border border-line p-2">
              <h3 className="text-sm font-semibold text-fg-strong">Identify which item?</h3>
              <ListDetail
                listLabel={PICKER_LABEL}
                items={pickerService.targetItemIds.map((itemId) => {
                  const ref = ownedItemRef(snapshot, itemId);
                  return { id: itemId, label: ref.name, ...(ref.glyph ? { glyph: ref.glyph } : {}) };
                })}
                selectedIndex={pickerIndex}
                onSelect={setPickerIndex}
                renderDetail={(item) => (
                  item
                    ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onDispatch({ type: 'trade-service', serviceId: pickerService.serviceId, targetItemId: item.id });
                          setPickerServiceId(null);
                        }}
                      >
                        Identify
                      </Button>
                    )
                    : <p className="text-sm text-muted">Nothing selected.</p>
                )}
              />
              <p className="text-xs text-muted">↑↓ select · Enter identify · Esc back</p>
            </div>
          )}
          <p className="text-xs text-muted">↑↓ select · Tab switch list · Enter trade · Esc close</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
