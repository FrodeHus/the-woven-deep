import { useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { MerchantServiceId } from '@woven-deep/content';
import { useDialogFocusTrap } from '../overlays/focus-trap.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import { useListNavigation } from './roving-focus.js';

interface ProjectedItemRef {
  readonly itemId: OpaqueId;
  readonly name: string;
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

type FocusedList = 'buy' | 'sell' | 'services';

const LIST_ORDER: readonly FocusedList[] = ['buy', 'sell', 'services'];

export interface TradeScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
  readonly onClose: () => void;
}

/**
 * The merchant trade dialog: three keyboard lists (buy from stock, sell from the backpack,
 * purchase a service) with Tab switching focus between them, following the same dialog/focus-trap
 * and roving-selection conventions as `HouseScreen`/`BackpackMenu`. Every price, stock quantity,
 * and offer comes straight from `projection.trade` -- this screen never computes a price itself,
 * it only dispatches the intent and lets the engine's rejection (insufficient funds, stock
 * unavailable, capacity, ...) come back as the usual log line. Renders nothing if the session
 * projection has no active trade (defensive: `PlayScreen` only mounts this while `projection.trade`
 * is set, but an in-flight Esc/close can race a session update that clears it).
 */
export function TradeScreen({ snapshot, onDispatch, onClose }: TradeScreenProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const session = trade(snapshot);
  const [focusedList, setFocusedList] = useState<FocusedList>('buy');

  const buyNav = useListNavigation(session?.stock.length ?? 0);
  const sellNav = useListNavigation(session?.saleOffers.length ?? 0);
  const serviceNav = useListNavigation(session?.services.length ?? 0);

  useDialogFocusTrap(containerRef);

  if (!session) return null;

  const navFor = (list: FocusedList) => (list === 'buy' ? buyNav : list === 'sell' ? sellNav : serviceNav);

  const buyRows: readonly (readonly [string, () => void])[] = session.stock.map((entry) => [
    `${entry.item.name} (${entry.quantity}) — ${entry.unitPrice}g`,
    () => onDispatch({ type: 'trade-buy', itemId: entry.item.itemId, quantity: 1 }),
  ]);
  const sellRows: readonly (readonly [string, () => void])[] = session.saleOffers.map((entry) => [
    `${backpackItemName(snapshot, entry.itemId)} (${entry.quantity}) — ${entry.unitPrice}g`,
    () => onDispatch({ type: 'trade-sell', itemId: entry.itemId, quantity: 1 }),
  ]);
  const serviceRows: readonly (readonly [string, () => void])[] = session.services.map((entry) => [
    `${entry.serviceId} (${entry.remainingUses} left) — ${entry.unitPrice}g`,
    () => onDispatch({
      type: 'trade-service', serviceId: entry.serviceId, targetItemId: entry.targetItemIds[0] ?? null,
    }),
  ]);
  const rowsFor = (list: FocusedList): readonly (readonly [string, () => void])[] =>
    (list === 'buy' ? buyRows : list === 'sell' ? sellRows : serviceRows);

  const execute = (): void => {
    const rows = rowsFor(focusedList);
    const selected = rows[navFor(focusedList).selectedIndex];
    selected?.[1]();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Stop the native keydown from bubbling to `PlayScreen`'s window-level key dispatcher: that
      // listener also routes Escape for open overlays (it has to, for the `pendingDecision` prompt,
      // which owns no keydown handler of its own) and would otherwise dispatch a second
      // `trade-close` against the now-stale (trade already closed) projection, surfacing as a
      // spurious "There is no open trade session." log line on every ordinary Escape-close.
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      setFocusedList((list) => LIST_ORDER[(LIST_ORDER.indexOf(list) + 1) % LIST_ORDER.length]!);
      return;
    }
    if (navFor(focusedList).handleArrowKeys(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      execute();
    }
  };

  const listBox = (list: FocusedList, label: string, rows: readonly (readonly [string, () => void])[]): JSX.Element => {
    const nav = navFor(list);
    return (
      <div className={list === focusedList ? 'trade-column trade-column--focused' : 'trade-column'}>
        <h3>{label}</h3>
        {rows.length === 0 && <p className="placeholder">Nothing here.</p>}
        {rows.length > 0 && (
          <ul role="listbox" aria-label={label} className="trade-item-list">
            {rows.map(([text], index) => (
              <li key={`${list}-${index}-${text}`} role="option" aria-selected={list === focusedList && index === nav.selectedIndex}>
                <button
                  type="button"
                  ref={nav.registerItem(index)}
                  className={list === focusedList && index === nav.selectedIndex
                    ? 'trade-item trade-item--selected' : 'trade-item'}
                  onClick={() => { setFocusedList(list); nav.setSelectedIndex(index); }}
                  onDoubleClick={() => {
                    setFocusedList(list);
                    nav.setSelectedIndex(index);
                    rows[index]![1]();
                  }}
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Trade"
      className="trade-screen"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <h2>{session.merchantName}</h2>
      <p className="trade-reputation">{session.reputationTier}</p>
      <p className="trade-currency">{`${session.currency}g`}</p>
      <div className="trade-columns">
        {listBox('buy', 'Buy', buyRows)}
        {listBox('sell', 'Sell', sellRows)}
        {listBox('services', 'Services', serviceRows)}
      </div>
      <p className="trade-hints">↑↓ select · Tab switch list · Enter trade · Esc close</p>
    </div>
  );
}
