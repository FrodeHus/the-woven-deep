import { useEffect, useRef, useState, type Dispatch, type JSX, type SetStateAction } from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { MerchantServiceId } from '@woven-deep/content';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { Button } from '../components/button.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/tabs.js';

interface ProjectedItemRef {
  readonly itemId: OpaqueId;
  readonly name: string;
  readonly glyph?: string;
}

interface ProjectedStockEntry {
  readonly item: ProjectedItemRef;
  readonly quantity: number;
  readonly unitPrice: number;
}

interface ProjectedSaleOffer {
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly unitPrice: number;
}

interface ProjectedServiceOffer {
  readonly serviceId: MerchantServiceId;
  readonly unitPrice: number;
  readonly remainingUses: number;
  readonly targetItemIds: readonly OpaqueId[];
}

interface ProjectedTrade {
  readonly merchantName: string;
  readonly reputationTier: string;
  readonly currency: number;
  readonly stock: readonly ProjectedStockEntry[];
  readonly saleOffers: readonly ProjectedSaleOffer[];
  readonly services: readonly ProjectedServiceOffer[];
}

function trade(snapshot: SessionSnapshot): ProjectedTrade | undefined {
  return snapshot.projection.trade as unknown as ProjectedTrade | undefined;
}

/** Sale offers only carry an `itemId` (see `ObservableTradeProjection.saleOffers`), so the
 * sellable name comes from the hero's own backpack projection, same lookup `command-builder.ts`'s
 * `ownedItem` performs. Falls back to the raw id if the backpack projection is ever out of sync
 * with the offer list (should not happen, but a fallback beats a blank row). */
function backpackItemName(snapshot: SessionSnapshot, itemId: OpaqueId): string {
  const owner = snapshot.projection.hero as unknown as { backpack: readonly ProjectedItemRef[] };
  return owner.backpack.find((item) => item.itemId === itemId)?.name ?? itemId;
}

/** Identify targets can be backpacked OR equipped (see `identifyTargetIds` in
 * `packages/engine/src/projection.ts`), so -- unlike `backpackItemName` above, which only ever
 * looks at sale offers -- this checks both `hero.backpack` and `hero.equipment` for the owned
 * item's projected name/glyph. Falls back to the raw id if neither owns it (should not happen). */
function ownedItemRef(snapshot: SessionSnapshot, itemId: OpaqueId): ProjectedItemRef {
  const owner = snapshot.projection.hero as unknown as {
    backpack: readonly ProjectedItemRef[];
    equipment: Readonly<Record<string, ProjectedItemRef | null>>;
  };
  return owner.backpack.find((item) => item.itemId === itemId)
    ?? Object.values(owner.equipment).find((item): item is ProjectedItemRef => item !== null && item.itemId === itemId)
    ?? { itemId, name: itemId };
}

type FocusedList = 'buy' | 'sell' | 'services';

const LIST_ORDER: readonly FocusedList[] = ['buy', 'sell', 'services'];
const LIST_LABEL: Readonly<Record<FocusedList, string>> = { buy: 'Buy', sell: 'Sell', services: 'Services' };

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
 * `Tabs` is controlled by `focusedList` rather than left to its own uncontrolled `defaultValue`: the
 * SAME state also indexes which list a keyboard Tab/Arrow/Enter should act on, so both the visible
 * tab and the keyboard target always agree.
 *
 * Framed by the shared `Dialog` primitive, which owns focus trapping and (for the ordinary,
 * no-picker case) Escape-dismissal, routed back through `onClose` via `onOpenChange`. The Tab/Enter/
 * Arrow list-navigation contract, and the identify-target picker's own nested Escape, are driven by
 * a capture-phase `window` keydown listener rather than DOM focus + `ListDetail`'s (or `Tabs`'s) own
 * built-in arrow handling: `Dialog`'s enter transition briefly renders its popup `hidden` (so the CSS
 * transition-in has a "before" state to register), during which nothing inside it is focusable, so a
 * mount-time `.focus()` call races that transition. A capture-phase listener sidesteps the race
 * (the same mechanism `Dialog` itself uses for Escape, via a `document`-level listener) and lets
 * this screen intercept a picker-closing Escape BEFORE it ever reaches that listener -- calling
 * `stopPropagation()` there stops the native event from bubbling any further, so a picker-closing
 * Escape only closes the picker, never the whole trade dialog. Since that listener runs in the
 * capture phase, it also stops a swallowed Tab/Arrow/Enter from ever reaching `Tabs`'s own built-in
 * keyboard handling on the tab buttons, so the two never fight over the same keypress; clicking a
 * `TabsTrigger` still switches lists normally via `onValueChange`.
 */
export function TradeScreen({ snapshot, onDispatch, onClose }: TradeScreenProps): JSX.Element | null {
  const session = trade(snapshot);
  const [focusedList, setFocusedList] = useState<FocusedList>('buy');
  const [buyIndex, setBuyIndex] = useState(0);
  const [sellIndex, setSellIndex] = useState(0);
  const [servicesIndex, setServicesIndex] = useState(0);
  // Set only for services whose `targetItemIds` is non-empty (e.g. identify): opening the picker
  // replaces the immediate dispatch with an inline target list. A service with no eligible
  // targets (or the targetless strongbox) never touches this state.
  const [pickerServiceId, setPickerServiceId] = useState<MerchantServiceId | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);

  const pickerService = pickerServiceId === null
    ? null
    : (session?.services.find((entry) => entry.serviceId === pickerServiceId) ?? null);

  const indexFor = (list: FocusedList): number => (list === 'buy' ? buyIndex : list === 'sell' ? sellIndex : servicesIndex);
  const setIndexFor = (list: FocusedList): Dispatch<SetStateAction<number>> => (
    list === 'buy' ? setBuyIndex : list === 'sell' ? setSellIndex : setServicesIndex
  );

  const buyRows: readonly TradeRow[] = session ? session.stock.map((entry) => ({
    id: entry.item.itemId,
    label: `${entry.item.name} (${entry.quantity}) — ${entry.unitPrice}g`,
    run: () => onDispatch({ type: 'trade-buy', itemId: entry.item.itemId, quantity: 1 }),
  })) : [];
  const sellRows: readonly TradeRow[] = session ? session.saleOffers.map((entry) => ({
    id: entry.itemId,
    label: `${backpackItemName(snapshot, entry.itemId)} (${entry.quantity}) — ${entry.unitPrice}g`,
    run: () => onDispatch({ type: 'trade-sell', itemId: entry.itemId, quantity: 1 }),
  })) : [];
  const serviceRows: readonly TradeRow[] = session ? session.services.map((entry) => ({
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
  })) : [];
  const rowsFor = (list: FocusedList): readonly TradeRow[] => (list === 'buy' ? buyRows : list === 'sell' ? sellRows : serviceRows);

  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (!session) return;
    if (event.key === 'Escape') {
      if (pickerService) {
        event.preventDefault();
        event.stopPropagation();
        setPickerServiceId(null);
      }
      // Plain Escape (no picker open) is deliberately left unhandled: it bubbles to the `Dialog`
      // primitive's own Escape-dismissal, which calls `onOpenChange(false)` -> `onClose` exactly
      // once, and stops the native event there before `PlayScreen`'s window-level key dispatcher
      // ever sees it.
      return;
    }
    if (pickerService) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const targets = pickerService.targetItemIds;
        if (targets.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setPickerIndex((index) => (index + delta + targets.length) % targets.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const targetItemId = pickerService.targetItemIds[pickerIndex];
        if (targetItemId) {
          onDispatch({ type: 'trade-service', serviceId: pickerService.serviceId, targetItemId });
        }
        setPickerServiceId(null);
        return;
      }
      // Swallow every other key (notably Tab) while the picker is open: list-switching doesn't
      // apply to a target picker.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      setFocusedList((list) => LIST_ORDER[(LIST_ORDER.indexOf(list) + 1) % LIST_ORDER.length]!);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = rowsFor(focusedList);
      if (rows.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setIndexFor(focusedList)((index) => (index + delta + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      rowsFor(focusedList)[indexFor(focusedList)]?.run();
    }
  };

  // Capture phase: runs before the event reaches any focused descendant (or `document`'s own
  // Escape-dismiss listener), so it works regardless of where DOM focus currently is -- see the
  // rationale in this component's own doc comment.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => keyHandlerRef.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  if (!session) return null;

  const toListItems = (rows: readonly TradeRow[]): readonly ListDetailItem[] =>
    rows.map((row) => ({ id: row.id, label: row.label }));

  const listPanel = (list: FocusedList, rows: readonly TradeRow[]): JSX.Element => (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
      {rows.length > 0 && (
        <ListDetail
          listLabel={LIST_LABEL[list]}
          items={toListItems(rows)}
          selectedIndex={indexFor(list)}
          onSelect={(index) => {
            setFocusedList(list);
            setIndexFor(list)(index);
          }}
          renderDetail={(item) => (
            item
              ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFocusedList(list);
                    rows.find((row) => row.id === item.id)?.run();
                  }}
                >
                  {list === 'buy' ? 'Buy' : list === 'sell' ? 'Sell' : 'Use'}
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
          <DialogTitle>Trade</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-strong">{session.merchantName}</p>
        <p className="text-sm text-muted">{session.reputationTier}</p>
        <p className="text-sm font-mono text-fg">{`${session.currency}g`}</p>
        <Tabs value={focusedList} onValueChange={(value) => setFocusedList(value as FocusedList)}>
          <TabsList aria-label="Trade lists">
            {LIST_ORDER.map((list) => <TabsTrigger key={list} value={list}>{LIST_LABEL[list]}</TabsTrigger>)}
          </TabsList>
          {LIST_ORDER.map((list) => (
            <TabsContent key={list} value={list}>
              {listPanel(list, rowsFor(list))}
            </TabsContent>
          ))}
        </Tabs>
        {pickerService && (
          <div className="flex flex-col gap-1 rounded-md border border-line p-2">
            <h3 className="text-sm font-semibold text-fg-strong">Identify which item?</h3>
            <ListDetail
              listLabel="Identify target"
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
      </DialogContent>
    </Dialog>
  );
}
