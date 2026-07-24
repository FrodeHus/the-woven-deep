import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { heroOf } from '../../session/projection-view.js';
import type { CastableSpellView } from '../../session/projection-view.js';
import { scrollAimSpell } from '../../session/scroll-targeting.js';
import { usePack, useSessionCtx } from '../providers.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { cn } from '../lib/cn.js';
import { useItemActionKeys } from '../hooks/useItemActionKeys.js';
import { DetailPane } from './DetailPane.js';
import { EquipmentSlots } from './EquipmentSlots.js';
import {
  CATEGORY_FILTER_LABEL,
  CATEGORY_FILTER_ORDER,
  CATEGORY_GLYPH,
  equippedLightMatchingFuel,
  visibleEntries,
  type CategoryFilter,
  type MenuEntry,
} from './inventory-model.js';

type ScrollSpellDescriptor = Pick<
  CastableSpellView,
  'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'
>;

export interface InventoryOverlayProps {
  /** Enters the shared spell-targeting mode for a targeted scroll (`useSpellTargeting.beginScroll`)
   * instead of dispatching `use` immediately -- called with the item's own id and the aim-requiring
   * spell descriptor `scrollAimSpell` resolved from its `spellId`. Optional so every pre-existing
   * caller/test (none of which stock a targeted scroll) keeps compiling unchanged; without it,
   * using ANY item stays fire-and-forget exactly as before. */
  readonly onBeginScrollTargeting?:
    ((itemId: string, spell: ScrollSpellDescriptor) => void) | undefined;
  /** Closes the overlay -- called right before `onBeginScrollTargeting` so the targeting reticle
   * takes over the map pane instead of sitting behind the inventory Sheet. Optional for the same
   * pre-existing-caller reason as `onBeginScrollTargeting`; both are provided together in practice
   * (`OverlayHost`'s `inventory` case forwards `onClose` as `onCloseOverlay`). */
  readonly onCloseOverlay?: (() => void) | undefined;
}

export {
  CATEGORY_FILTER_ORDER,
  type CategoryFilter,
  type ProjectedItemLike,
} from './inventory-model.js';

function toListItem(entry: MenuEntry): ListDetailItem {
  return {
    id: entry.item.itemId,
    glyph: CATEGORY_GLYPH[entry.item.category],
    label: entry.item.name,
    quantity: entry.item.quantity,
    ...(entry.equipped ? { badge: 'EQ' } : {}),
  };
}

/**
 * The guest's backpack, built on the shared `ListDetail` component as the "structure 1"
 * drawer exemplar -- an equipped-gear slot grid, a scrollable pack list, and a detail pane with
 * contextual action buttons, all inside the `OverlayHost`'s right `Sheet`. Reads directly from
 * `useSessionCtx()` rather than taking props, since inventory is play-scope (a session is always
 * present while this overlay can open) -- guards to rendering nothing if that invariant is ever
 * violated.
 *
 * The key contract, byte-for-byte: `e` (un)equips the selected item, `u`
 * uses it, `d` drops it, `l` toggles its light, `f` cycles the category filter, `s` toggles a
 * stable name sort -- bound via `onKeyDown` on the drawer's own container (not `window`), so they
 * fire only while focus is inside the drawer. `ListDetail` owns arrow/Home/End selection and
 * listbox semantics; this component only owns the action keys layered on top of that selection.
 */
export function InventoryOverlay({
  onBeginScrollTargeting,
  onCloseOverlay,
}: Readonly<InventoryOverlayProps> = {}): JSX.Element | null {
  const sessionCtx = useSessionCtx();
  const pack = usePack();
  const containerRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [sortByName, setSortByName] = useState(false);
  // A raw positional index -- deliberately NOT tracked by item identity. An action (e.g. unequip)
  // can reshuffle which item occupies a given index without moving the selection cursor -- see the
  // pre-`ListDetail` `InventoryOverlay`'s doc comment for the full rationale; that semantics is
  // preserved unchanged here.
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Moves focus onto `ListDetail`'s own listbox on mount, so the action keys (which fire off the
  // container's `onKeyDown`, and thus require focus to be somewhere inside it) work immediately
  // without an extra Tab press -- mirrors the pre-`ListDetail` overlay's own mount-focus behavior.
  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }, []);

  const hero = sessionCtx ? heroOf(sessionCtx.snapshot.projection) : undefined;
  const entries = hero ? visibleEntries(hero, filter, sortByName) : [];
  const selected = entries[selectedIndex];
  const refuelTarget =
    hero && selected ? equippedLightMatchingFuel(pack, hero, selected.item) : undefined;

  function dispatchAction(action: 'equip' | 'unequip' | 'drop' | 'toggle-light'): void {
    if (!selected || !sessionCtx) return;
    sessionCtx.session.dispatch({ type: 'backpack', action, itemId: selected.item.itemId });
  }

  /**
   * Using an item whose content entry names a spellId targeting an actor or an area routes through
   * the SAME free-cursor targeting mode as casting from the Spells panel (see
   * `useSpellTargeting.beginScroll`, generalized in Task 6) -- the overlay closes and the aim
   * reticle takes over the map pane, and confirming dispatches `use`+`target` rather than firing
   * immediately. Every other item (self-target scrolls, potions, food, tomes) stays fire-and-forget,
   * exactly as before.
   */
  function applyUse(entry: MenuEntry): void {
    if (!sessionCtx) return;
    const aimed = scrollAimSpell(pack, entry.item.contentId);
    if (aimed && onBeginScrollTargeting) {
      onCloseOverlay?.();
      onBeginScrollTargeting(entry.item.itemId, aimed);
      return;
    }
    sessionCtx.session.dispatch({ type: 'backpack', action: 'use', itemId: entry.item.itemId });
  }

  function dispatchRefuel(): void {
    if (!selected || !refuelTarget || !sessionCtx) return;
    sessionCtx.session.dispatch({
      type: 'refuel',
      fuelItemId: selected.item.itemId,
      targetItemId: refuelTarget.itemId,
    });
  }

  function cycleFilter(): void {
    const nextIndex = (CATEGORY_FILTER_ORDER.indexOf(filter) + 1) % CATEGORY_FILTER_ORDER.length;
    setFilter(CATEGORY_FILTER_ORDER[nextIndex]!);
    setSelectedIndex(0);
  }

  function selectFilter(next: CategoryFilter): void {
    setFilter(next);
    setSelectedIndex(0);
  }

  // Called unconditionally so hook order stays stable across renders (an empty session yields no
  // selection); the returned handler is a no-op until an item is selected.
  const handleItemActionKey = useItemActionKeys<MenuEntry>(selected, {
    e: (entry) => dispatchAction(entry.equipped ? 'unequip' : 'equip'),
    u: (entry) => applyUse(entry),
    d: () => dispatchAction('drop'),
    l: () => dispatchAction('toggle-light'),
    r: () => dispatchRefuel(),
  });

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'f') {
      event.preventDefault();
      cycleFilter();
      return;
    }
    if (event.key === 's') {
      event.preventDefault();
      setSortByName((value) => !value);
      return;
    }
    handleItemActionKey(event);
  }

  if (!hero) return null;

  return (
    <div ref={containerRef} className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      <ListDetail
        listLabel="Backpack items"
        items={entries.map(toListItem)}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        slots={
          <section aria-labelledby="inventory-equipped-heading" className="flex flex-col gap-2">
            <h3
              id="inventory-equipped-heading"
              className="flex items-center gap-2 text-[0.625rem] uppercase tracking-[0.14em] text-subtle"
            >
              <span aria-hidden="true">·&nbsp;─</span>
              Equipped
              <span aria-hidden="true">─&nbsp;·</span>
            </h3>
            <EquipmentSlots equipment={hero.equipment} />
          </section>
        }
        toolbar={CATEGORY_FILTER_ORDER.map((option) => {
          const active = option === filter;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => selectFilter(option)}
              className={cn(
                'cursor-pointer border px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.08em]',
                active
                  ? 'border-accent bg-accent text-deep'
                  : 'border-line bg-surface text-muted hover:border-accent hover:text-fg',
              )}
            >
              {CATEGORY_FILTER_LABEL[option]}
            </button>
          );
        })}
        renderDetail={() => (
          <DetailPane
            entry={selected}
            refuelTarget={refuelTarget}
            pack={pack}
            onEquip={() => dispatchAction(selected?.equipped ? 'unequip' : 'equip')}
            onUse={() => selected && applyUse(selected)}
            onDrop={() => dispatchAction('drop')}
            onToggleLight={() => dispatchAction('toggle-light')}
            onRefuel={dispatchRefuel}
          />
        )}
      />
      {entries.length === 0 && <p className="text-muted">Your pack is empty.</p>}
      <p className="mt-1 border-t border-line pt-2 font-mono text-[0.6875rem] text-subtle">
        ↑↓ browse · e equip · u use · d drop · l light · f filter
      </p>
    </div>
  );
}
