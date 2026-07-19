import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { heroOf } from '../../session/projection-view.js';
import { usePack, useSessionCtx } from '../providers.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { Button } from '../components/button.js';
import { DetailPane } from './DetailPane.js';
import { EquipmentSlots } from './EquipmentSlots.js';
import {
  CATEGORY_FILTER_LABEL, CATEGORY_FILTER_ORDER, CATEGORY_GLYPH,
  equippedLightMatchingFuel, visibleEntries,
  type CategoryFilter, type MenuEntry, type ProjectedItemLike,
} from './inventory-model.js';

export { CATEGORY_FILTER_ORDER, type CategoryFilter, type ProjectedItemLike } from './inventory-model.js';

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
 * Preserves the pre-existing key contract byte-for-byte: `e` (un)equips the selected item, `u`
 * uses it, `d` drops it, `l` toggles its light, `f` cycles the category filter, `s` toggles a
 * stable name sort -- bound via `onKeyDown` on the drawer's own container (not `window`), so they
 * fire only while focus is inside the drawer. `ListDetail` owns arrow/Home/End selection and
 * listbox semantics; this component only owns the action keys layered on top of that selection.
 */
export function InventoryOverlay(): JSX.Element | null {
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

  if (!sessionCtx) return null;
  const { session, snapshot } = sessionCtx;
  const hero = heroOf(snapshot.projection);

  const entries = visibleEntries(hero, filter, sortByName);
  const selected = entries[selectedIndex];
  const refuelTarget = selected ? equippedLightMatchingFuel(pack, hero, selected.item) : undefined;

  function dispatchAction(action: 'equip' | 'unequip' | 'use' | 'drop' | 'toggle-light'): void {
    if (!selected) return;
    session.dispatch({ type: 'backpack', action, itemId: selected.item.itemId });
  }

  function dispatchRefuel(): void {
    if (!selected || !refuelTarget) return;
    session.dispatch({ type: 'refuel', fuelItemId: selected.item.itemId, targetItemId: refuelTarget.itemId });
  }

  function cycleFilter(): void {
    const nextIndex = (CATEGORY_FILTER_ORDER.indexOf(filter) + 1) % CATEGORY_FILTER_ORDER.length;
    setFilter(CATEGORY_FILTER_ORDER[nextIndex]!);
    setSelectedIndex(0);
  }

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
    if (!selected) return;
    const key = event.key.toLowerCase();
    if (key === 'e') dispatchAction(selected.equipped ? 'unequip' : 'equip');
    else if (key === 'u') dispatchAction('use');
    else if (key === 'd') dispatchAction('drop');
    else if (key === 'l') dispatchAction('toggle-light');
    else if (key === 'r' && refuelTarget) dispatchRefuel();
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <ListDetail
        listLabel="Backpack items"
        items={entries.map(toListItem)}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        slots={<EquipmentSlots equipment={hero.equipment} />}
        toolbar={(
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cycleFilter}
            >
              {`Filter: ${CATEGORY_FILTER_LABEL[filter]} (f)`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSortByName((value) => !value)}
            >
              {sortByName ? 'Sort: Name (s)' : 'Sort: Default (s)'}
            </Button>
          </>
        )}
        renderDetail={() => (
          <DetailPane
            entry={selected}
            refuelTarget={refuelTarget}
            onEquip={() => dispatchAction(selected?.equipped ? 'unequip' : 'equip')}
            onUse={() => dispatchAction('use')}
            onDrop={() => dispatchAction('drop')}
            onToggleLight={() => dispatchAction('toggle-light')}
            onRefuel={dispatchRefuel}
          />
        )}
      />
      {entries.length === 0 && <p className="text-muted">Your backpack is empty.</p>}
    </div>
  );
}
