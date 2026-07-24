import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { CompiledContentPack, MerchantServiceId } from '@woven-deep/content';
import { itemById, spellEntries } from '@woven-deep/session-core';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import { heroOf, ownedItemOf, tradeOf, type TradeView } from '../../session/projection-view.js';
import { aoeBadge } from '../../session/spell-detail.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/dialog.js';
import { LedgerCenter, LedgerList, type LedgerRow } from '../components/LedgerList.js';
import { cn } from '../lib/cn.js';
import { usePack } from '../providers.js';

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
  return (
    heroOf(snapshot.projection).backpack.find((item) => item.itemId === itemId)?.name ?? itemId
  );
}

/** Identify targets can be backpacked OR equipped (see `identifyTargetIds` in
 * `packages/engine/src/projection.ts`), so -- unlike `backpackItemName` above, which only ever
 * looks at sale offers -- this checks both `hero.backpack` and `hero.equipment` for the owned
 * item's projected name/glyph. Falls back to the raw id if neither owns it (should not happen). */
function ownedItemRef(snapshot: SessionSnapshot, itemId: OpaqueId): ProjectedItemRef {
  return ownedItemOf(heroOf(snapshot.projection), itemId) ?? { itemId, name: itemId };
}

/** The small "learns X" / "casts X (...)" affordance for a tome/scroll row in the merchant's stock,
 * so the player can tell what a spell item does without opening it first. A scroll's content entry
 * carries a directly-castable `spellId` (see `scroll-targeting.ts`'s `scrollAimSpell`, which this
 * duplicates only the id-resolution half of -- that helper narrows to aim-requiring targeting only,
 * which is too narrow a signal for a shop badge); a tome instead LEARNS a spell via an
 * `effect.spell.learn` effect carrying the spellId in its parameters (see
 * `content/items/fireball-tome.yaml`). Returns `undefined` for a non-spell item (nothing to badge). */
function spellBadge(
  pack: CompiledContentPack,
  contentId: OpaqueId | undefined,
): string | undefined {
  if (contentId === undefined) return undefined;
  const entry = itemById(pack, contentId);
  if (!entry) return undefined;
  const learnEffect = entry.effects.find((effect) => effect.effectId === 'effect.spell.learn');
  const learnSpellId = learnEffect?.parameters.spellId;
  const spellId = entry.spellId ?? (typeof learnSpellId === 'string' ? learnSpellId : undefined);
  if (typeof spellId !== 'string') return undefined;
  const spell = spellEntries(pack).find((candidate) => candidate.id === spellId);
  if (!spell) return undefined;
  if (typeof learnSpellId === 'string') return `learns ${spell.name}`;
  const shape = aoeBadge(spell.aoe);
  return shape ? `casts ${spell.name} (${shape})` : `casts ${spell.name}`;
}

type FocusedList = 'buy' | 'sell' | 'services';

const LIST_ORDER: readonly FocusedList[] = ['buy', 'sell', 'services'];
const LIST_LABEL: Readonly<Record<FocusedList, string>> = {
  buy: 'Buy',
  sell: 'Sell',
  services: 'Services',
};
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
  readonly name: string;
  readonly quantity?: number;
  readonly price: string;
  readonly badge?: string;
  readonly run: () => void;
}

/** Seats DOM focus so `handleKeyDown` receives keys. While the picker is open, focus goes to the
 * container itself and `handleKeyDown` drives the picker directly (passing `null`). Otherwise focus
 * goes to the active side's listbox so the container's `onKeyDown` catches its bubbled keys, falling
 * back to the container when that side is empty (no listbox). Returns the focused element (shared by
 * the focus effect and `initialFocus`). */
function focusActiveList(container: HTMLElement, activeLabel: string | null): HTMLElement {
  const listbox =
    activeLabel === null
      ? null
      : container.querySelector<HTMLElement>(`[role="listbox"][aria-label="${activeLabel}"]`);
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
 * The merchant trade dialog, laid out as the mockup's "ledger of exchange": the merchant's STOCK on
 * the left (buy), the merchant's identity + purse + services in the center, the guest's PACK on the
 * right (sell) -- all three visible at once, with the focused side highlighted. Every price, stock
 * quantity, and offer comes straight from `projection.trade`; this screen never computes a price
 * itself, it only dispatches the intent and lets the engine's rejection (insufficient funds, stock
 * unavailable, capacity, ...) come back as the usual log line. Renders nothing if the projection has
 * no active trade (defensive: `PlayScreen` only mounts this while `projection.trade` is set, but an
 * in-flight Esc/close can race a session update that clears it). Drag-across (shown in the mockup) is
 * intentionally not implemented -- the engine only supports the discrete `trade-buy`/`trade-sell`/
 * `trade-service` commands -- so buying/selling is by click or keyboard, not drag.
 *
 * `focusedList` names the side a keyboard Tab/Arrow/Enter acts on, and drives the highlight so the
 * visible active side and the keyboard target always agree. DOM focus is seated on the active side's
 * listbox (on open via `initialFocus`, and on every side-switch via a focus effect), so its bubbled
 * ArrowUp/ArrowDown/Enter/Tab reach this screen's own container `onKeyDown`. `stopPropagation()`
 * keeps those from escaping the dialog.
 *
 * A service with eligible targets (e.g. identify) opens an inline nested picker (a listbox at the
 * foot of the ledger) instead of dispatching immediately. While the picker is open, focus rests on
 * the container and its `onKeyDown` drives the picker's Arrow/Enter directly. Escape is owned by the
 * `Dialog` primitive: it fires `onOpenChange(false)` (reason `escape-key`) and stops the native event
 * before `PlayScreen`'s window-level dispatcher sees it, so this screen routes that single close
 * through `onOpenChange` -- closing the picker first when it is open, otherwise the whole dialog.
 */
export function TradeScreen({
  snapshot,
  onDispatch,
  onClose,
}: TradeScreenProps): JSX.Element | null {
  const session = trade(snapshot);
  const pack = usePack();
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

  const pickerService =
    pickerServiceId === null
      ? null
      : (session?.services.find((entry) => entry.serviceId === pickerServiceId) ?? null);

  const rows = useMemo((): Readonly<Record<FocusedList, readonly TradeRow[]>> => {
    if (!session) return { buy: [], sell: [], services: [] };
    return {
      buy: session.stock.map((entry) => {
        const badge = spellBadge(pack, entry.item.contentId);
        return {
          id: entry.item.itemId,
          name: entry.item.name,
          quantity: entry.quantity,
          price: `${entry.unitPrice}g`,
          ...(badge ? { badge } : {}),
          run: () => onDispatch({ type: 'trade-buy', itemId: entry.item.itemId, quantity: 1 }),
        };
      }),
      sell: session.saleOffers.map((entry) => ({
        id: entry.itemId,
        name: backpackItemName(snapshot, entry.itemId),
        quantity: entry.quantity,
        price: `${entry.unitPrice}g`,
        run: () => onDispatch({ type: 'trade-sell', itemId: entry.itemId, quantity: 1 }),
      })),
      services: session.services.map((entry) => ({
        id: entry.serviceId,
        name: `${SERVICE_LABEL[entry.serviceId]} (${entry.remainingUses} left)`,
        price: `${entry.unitPrice}g`,
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
  }, [session, snapshot, onDispatch, pack]);

  const activeRows = rows[focusedList];

  // Keeps DOM focus on whichever listbox owns keyboard selection: the container while the picker is
  // open (so its `onKeyDown` drives the picker), otherwise the active side's listbox. Runs on first
  // open, on every side-switch / picker transition, and whenever the active side's row count changes
  // -- a dispatch (e.g. selling the last offer) can empty the side and unmount its listbox without a
  // switch, so `activeRows.length` is a dependency. The container is the fallback when the active
  // side is empty (no listbox), so Enter/Tab still reach `handleKeyDown`.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    focusActiveList(root, pickerServiceId !== null ? null : LIST_LABEL[focusedList]);
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
        // Side-switching does not apply to the target picker.
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
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (activeRows.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((index) => (index + delta + activeRows.length) % activeRows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      activeRows[selectedIndex]?.run();
    }
  }

  if (!session) return null;

  const buildLedger = (
    list: FocusedList,
    heading: string,
    headingHint: string,
    actionLabel: string,
    actionClassName: string,
    priceClassName: string,
    emptyText: string,
  ): JSX.Element => {
    const listRows: readonly LedgerRow[] = rows[list].map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.quantity !== undefined ? { quantity: row.quantity } : {}),
      price: row.price,
      ...(row.badge ? { badge: row.badge } : {}),
    }));
    return (
      <LedgerList
        listLabel={LIST_LABEL[list]}
        heading={heading}
        headingHint={headingHint}
        rows={listRows}
        selectedIndex={list === focusedList ? selectedIndex : -1}
        active={list === focusedList}
        onSelect={(index) => {
          setFocusedList(list);
          setSelectedIndex(index);
        }}
        onAct={(index) => rows[list][index]?.run()}
        actionLabel={actionLabel}
        actionClassName={actionClassName}
        priceClassName={priceClassName}
        emptyText={emptyText}
      />
    );
  };

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
        className="sm:max-w-4xl"
        // `Dialog` mounts its popup contents behind an enter transition, so a mount-time `.focus()`
        // effect runs before the container exists; the popup's own post-enter `initialFocus` hook is
        // the transition-aware place to seat focus on the active listbox for the first open.
        initialFocus={() =>
          containerRef.current
            ? focusActiveList(
                containerRef.current,
                pickerServiceIdRef.current !== null ? null : LIST_LABEL[focusedList],
              )
            : false
        }
      >
        <DialogHeader className="text-center sm:text-center">
          <span aria-hidden="true" className="text-subtle">
            ─── ❦ ───
          </span>
          <DialogTitle className="text-center">Trade</DialogTitle>
        </DialogHeader>
        <div
          ref={containerRef}
          tabIndex={-1}
          className="flex flex-col gap-3 outline-none"
          onKeyDown={handleKeyDown}
        >
          <div className="grid h-[min(60vh,30rem)] grid-cols-[1fr_13rem_1fr] border-y border-line">
            {buildLedger(
              'buy',
              "Merchant's stock",
              '· enter buys',
              'buy',
              'border-accent text-accent-strong hover:bg-accent hover:text-deep',
              'text-accent-strong',
              'Sold out.',
            )}
            <LedgerCenter>
              <div
                aria-hidden="true"
                className="grid size-16 place-items-center border border-double border-accent bg-raised font-serif text-3xl text-accent-strong"
              >
                ❦
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="font-serif text-base text-fg-strong">{session.merchantName}</p>
                <p className="text-xs uppercase tracking-[0.1em] text-subtle">
                  {session.reputationTier}
                </p>
              </div>
              <div className="w-full border-y border-dotted border-subtle py-2">
                <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
                  Your purse
                </p>
                <p className="font-mono text-lg text-accent-strong">
                  <span aria-hidden="true">⛁ </span>
                  <span>{`${session.currency}g`}</span>
                </p>
              </div>
              {rows.services.length > 0 && (
                <div className="w-full">
                  {buildLedger(
                    'services',
                    'Services',
                    '',
                    'use',
                    'border-cool text-cool hover:bg-cool hover:text-deep',
                    'text-cool',
                    'No services offered.',
                  )}
                </div>
              )}
              <div className="mt-auto font-mono text-[0.625rem] leading-relaxed text-subtle">
                tab switch side · ↑↓ browse
                <br />
                enter trade · esc leave
              </div>
            </LedgerCenter>
            {buildLedger(
              'sell',
              'Your pack',
              '· enter sells',
              'sell',
              'border-good text-good hover:bg-good hover:text-deep',
              'text-good',
              'Nothing to sell.',
            )}
          </div>
          {pickerService && (
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-cool">
                ✦ Identify which?{' '}
                <span className="normal-case text-subtle">· ↑↓ enter · esc back</span>
              </p>
              <div role="listbox" aria-label={PICKER_LABEL} className="flex flex-wrap gap-2">
                {pickerService.targetItemIds.map((itemId, index) => {
                  const ref = ownedItemRef(snapshot, itemId);
                  const selected = index === pickerIndex;
                  return (
                    <button
                      key={itemId}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onDispatch({
                          type: 'trade-service',
                          serviceId: pickerService.serviceId,
                          targetItemId: itemId,
                        });
                        setPickerServiceId(null);
                      }}
                      className={cn(
                        'cursor-pointer border bg-raised px-2.5 py-1 font-mono text-sm text-fg',
                        selected ? 'border-cool' : 'border-line hover:border-cool',
                      )}
                    >
                      {ref.glyph ? `${ref.glyph} ${ref.name}` : ref.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
