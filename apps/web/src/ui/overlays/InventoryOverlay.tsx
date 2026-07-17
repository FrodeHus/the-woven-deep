import {
  useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { OpaqueId } from '@woven-deep/engine';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import { effectLabel } from '../labels.js';

/** The real item-category vocabulary the content model/engine projection actually emits (see
 * `packages/content/src/model.ts`'s `ItemCategory`) -- never invented. */
type ProjectedItemCategory =
  | 'weapon' | 'ammunition' | 'armor' | 'shield' | 'light' | 'fuel' | 'food' | 'potion' | 'scroll' | 'ring' | 'misc';

/** The five buckets the overlay's category filter cycles through, plus `all`. Grouped from the
 * real vocabulary above by rough kind, not invented categories: weapon/ammunition (things you
 * fight with), armor/shield (things you wear to block), food/potion/scroll (things consumed),
 * light/fuel (light-source management), ring/misc (everything left over). */
export type CategoryFilter = 'all' | 'weapons' | 'armor' | 'consumables' | 'light' | 'other';

export const CATEGORY_FILTER_ORDER: readonly CategoryFilter[] =
  ['all', 'weapons', 'armor', 'consumables', 'light', 'other'];

const CATEGORY_FILTER_LABEL: Readonly<Record<CategoryFilter, string>> = {
  all: 'All', weapons: 'Weapons', armor: 'Armor', consumables: 'Consumables', light: 'Light', other: 'Other',
};

function bucketFor(category: ProjectedItemCategory): Exclude<CategoryFilter, 'all'> {
  switch (category) {
    case 'weapon':
    case 'ammunition':
      return 'weapons';
    case 'armor':
    case 'shield':
      return 'armor';
    case 'food':
    case 'potion':
    case 'scroll':
      return 'consumables';
    case 'light':
    case 'fuel':
      return 'light';
    case 'ring':
    case 'misc':
      return 'other';
  }
}

/** The shape `projectedOwnedItem` (packages/engine/src/projection.ts) actually emits for a
 * hero-owned item -- widened slightly (every field optional except the ones every branch always
 * carries) since an UNIDENTIFIED item's projection omits `contentId`/`effects`/`enchantment`
 * entirely (see `projectItem` in `identification.ts`) rather than nulling them out. Never add a
 * field here that the engine doesn't actually project (no lore/description -- the content model
 * has none, see the plan's Global Constraints). */
export interface ProjectedItemLike {
  readonly itemId: OpaqueId;
  readonly contentId?: OpaqueId;
  readonly name: string;
  readonly category: ProjectedItemCategory;
  readonly quantity: number;
  readonly identified: boolean;
  readonly effects?: readonly Readonly<{ effectId: string; parameters: Readonly<Record<string, unknown>> }>[];
  readonly enchantment?: Readonly<{ enchantmentId: OpaqueId; modifiers: Readonly<Record<string, number>> }>;
  readonly unknownProperties?: boolean;
  readonly condition: number;
  readonly charges?: number | null;
  readonly fuel: number | null;
  readonly enabled: boolean | null;
}

interface MenuItem {
  readonly item: ProjectedItemLike;
  /** `true` for a currently-equipped item: it renders with an "(equipped)" suffix and `e`
   * unequips it (moving it into the backpack) rather than equipping -- identical contract to the
   * pre-existing `BackpackMenu`. */
  readonly equipped: boolean;
  readonly slot?: string;
}

/**
 * Everything the overlay can act on, in the exact pre-existing order: the hero's backpack stacks
 * first (the pinned e2e walks act on "the first backpack item"), then each equipped item in
 * `hero.equipment`'s own key order -- byte-for-byte the same ordering `BackpackMenu`'s `menuItems`
 * produced, since that ordering is load-bearing for the pinned 5A/5C e2e walks (they never invoke
 * the filter/sort additions, so they must see this exact default order).
 */
function allMenuItems(snapshot: SessionSnapshot): readonly MenuItem[] {
  const heroData = snapshot.projection.hero as unknown as {
    backpack: readonly ProjectedItemLike[];
    equipment: Readonly<Record<string, ProjectedItemLike | null>>;
  };
  const backpack = heroData.backpack.map((item) => ({ item, equipped: false }));
  const equipped = Object.entries(heroData.equipment)
    .filter((entry): entry is [string, ProjectedItemLike] => entry[1] !== null)
    .map(([slot, item]) => ({ item, equipped: true, slot }));
  return [...backpack, ...equipped];
}

function matchesFilter(item: ProjectedItemLike, filter: CategoryFilter): boolean {
  return filter === 'all' || bucketFor(item.category) === filter;
}

/** Stable, locale-free (plain codepoint) name comparison -- `localeCompare` is deliberately never
 * used here, so sort order can never depend on the guest's browser locale. */
function byNameStable(left: MenuItem, right: MenuItem): number {
  if (left.item.name < right.item.name) return -1;
  if (left.item.name > right.item.name) return 1;
  return 0;
}

function visibleItems(
  snapshot: SessionSnapshot, filter: CategoryFilter, sortByName: boolean,
): readonly MenuItem[] {
  const filtered = allMenuItems(snapshot).filter((entry) => matchesFilter(entry.item, filter));
  if (!sortByName) return filtered;
  // `Array#sort` in every JS engine this project targets is a stable sort (ES2019+), so ties (two
  // items sharing a name) keep their original backpack-then-equipped relative order.
  return [...filtered].sort(byNameStable);
}

function DetailPane({ entry }: Readonly<{ entry: MenuItem | undefined }>): JSX.Element {
  if (!entry) return <p className="inventory-detail placeholder">Nothing selected.</p>;
  const { item, equipped, slot } = entry;
  const unidentified = item.contentId === undefined;

  return (
    <dl className="inventory-detail" aria-label="Item details">
      <dt>Name</dt>
      <dd>{item.name}</dd>

      <dt>Category</dt>
      <dd>{item.category}</dd>

      <dt>Quantity</dt>
      <dd>{item.quantity}</dd>

      <dt>Identification</dt>
      <dd>{unidentified ? 'Unidentified' : 'Identified'}</dd>

      {equipped && (
        <>
          <dt>Equipped</dt>
          <dd>{slot}</dd>
        </>
      )}

      {!unidentified && item.effects && item.effects.length > 0 && (
        <>
          <dt>Effects</dt>
          <dd>
            <ul className="inventory-detail-effects">
              {item.effects.map((effect) => (
                <li key={effect.effectId}>{effectLabel(effect.effectId, effect.parameters)}</li>
              ))}
            </ul>
          </dd>
        </>
      )}

      {item.enchantment && (
        <>
          <dt>Enchantment</dt>
          <dd>
            <ul className="inventory-detail-enchantment">
              {Object.entries(item.enchantment.modifiers).map(([stat, amount]) => (
                <li key={stat}>{`${stat}: ${amount >= 0 ? '+' : ''}${amount}`}</li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {item.unknownProperties && (
        <>
          <dt>Enchantment</dt>
          <dd>Unknown properties</dd>
        </>
      )}

      {item.charges != null && (
        <>
          <dt>Charges</dt>
          <dd>{item.charges}</dd>
        </>
      )}
      {item.fuel != null && (
        <>
          <dt>Fuel</dt>
          <dd>{item.fuel}</dd>
        </>
      )}
      {item.enabled !== null && (
        <>
          <dt>Light</dt>
          <dd>{item.enabled ? 'Lit' : 'Unlit'}</dd>
        </>
      )}

      <dt>Condition</dt>
      <dd>{item.condition}</dd>
    </dl>
  );
}

export interface InventoryOverlayProps {
  readonly snapshot: SessionSnapshot;
  readonly onDispatch: (intent: PlayerIntent) => void;
}

/**
 * The guest's backpack, absorbed from the pre-existing standalone `BackpackMenu` into the
 * registry-overlay infrastructure (Task 5). Byte-for-byte preserves `BackpackMenu`'s key contract
 * -- ArrowUp/Down select, `e` (un)equip, `u` use, `d` drop, `l` toggle-light -- since the pinned
 * 5A/5C e2e walks drive these exact keys; Escape is deliberately NOT handled here (unlike the old
 * `BackpackMenu`), since the shared `OverlayScaffold` this now renders inside already owns
 * Escape-close for every registry overlay.
 *
 * New on top of that contract: `f` cycles the category filter (all/weapons/armor/consumables/
 * light/other) and `s` toggles a stable, locale-free name sort -- deliberately NOT bound to `Tab`
 * (the brief's suggested key) because `Tab` is already load-bearing here for the dialog's own
 * focus-trap navigation between item buttons (see `useDialogFocusTrap`/the migrated compatibility
 * tests, which assert bare Tab moves focus, unchanged from `BackpackMenu`) -- overloading it for
 * filter-cycling would break that pinned contract. Neither `f` nor `s` collides with anything: the
 * global keymap never reaches this dialog (`routeKey` swallows every non-Escape key while an
 * overlay is open), and neither letter is one of the existing action-key hints.
 */
export function InventoryOverlay({ snapshot, onDispatch }: InventoryOverlayProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [sortByName, setSortByName] = useState(false);
  // A raw positional index -- deliberately NOT tracked by item identity (contrast an itemId-based
  // "selection follows the item" scheme). This reproduces `BackpackMenu`'s exact pre-existing
  // semantics: a backpack action (e.g. unequip) can reshuffle which item occupies a given index
  // (an unequipped item moves from the equipped section into the backpack section, ahead of
  // still-equipped items) WITHOUT moving the selection cursor -- the cursor stays on the index,
  // now pointing at whatever item slid into it. The pinned 5C town-loop e2e walk's unequip-two-
  // items sequence (ArrowDown x3 to the armor slot, `e`, ArrowUp, `e` again for the sword) depends
  // on this exact reindexing behavior: it is NOT "select the sword," it is "select whatever is now
  // one slot back from where armor was."
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = visibleItems(snapshot, filter, sortByName);

  // Skips the very first (mount) run: the shared `OverlayScaffold` this renders inside already
  // focuses the first focusable element (the first item button, here) on mount via its own
  // `useDialogFocusTrap` -- and that same hook is what captures "whatever had focus before the
  // dialog opened" so it can be restored on close. Since `OverlayScaffold` is this component's
  // PARENT, its mount effect fires AFTER this one (React fires child effects before parent effects
  // on mount) -- if this effect also moved focus on mount, it would steal focus to the item button
  // BEFORE the trap captures `previouslyFocused`, corrupting that capture (the trap would restore
  // focus to the item button on close, not to whatever the guest was focused on beforehand). This
  // effect only needs to move focus in response to a LATER change (arrow-key navigation, a filter
  // cycle) -- ordering against the trap's own one-time mount capture doesn't matter for those.
  const isMountRef = useRef(true);
  useEffect(() => {
    if (isMountRef.current) {
      isMountRef.current = false;
      return;
    }
    itemRefs.current[selectedIndex]?.focus();
    // `filter` is also a dependency (not just `selectedIndex`): a filter change can swap out which
    // item occupies a given index entirely (unmounting the previously-focused button) while
    // `selectedIndex` itself happens to stay numerically the same -- without `filter` here, React
    // wouldn't consider the dependency changed and would skip re-focusing, leaving focus stranded
    // on a removed element.
  }, [selectedIndex, filter]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'f') {
      event.preventDefault();
      const nextIndex = (CATEGORY_FILTER_ORDER.indexOf(filter) + 1) % CATEGORY_FILTER_ORDER.length;
      setFilter(CATEGORY_FILTER_ORDER[nextIndex]!);
      setSelectedIndex(0);
      return;
    }
    if (event.key === 's') {
      event.preventDefault();
      setSortByName((value) => !value);
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
      onDispatch({ type: 'backpack', action: selected.equipped ? 'unequip' : 'equip', itemId: selected.item.itemId });
    } else if (key === 'u') onDispatch({ type: 'backpack', action: 'use', itemId: selected.item.itemId });
    else if (key === 'd') onDispatch({ type: 'backpack', action: 'drop', itemId: selected.item.itemId });
    else if (key === 'l') onDispatch({ type: 'backpack', action: 'toggle-light', itemId: selected.item.itemId });
  };

  return (
    <div ref={containerRef} className="inventory-overlay" onKeyDown={handleKeyDown}>
      <p className="inventory-filter">{`Filter: ${CATEGORY_FILTER_LABEL[filter]}`}</p>
      {items.length === 0 && <p className="placeholder">Your backpack is empty.</p>}
      {items.length > 0 && (
        <ul role="listbox" aria-label="Backpack items" className="backpack-item-list">
          {items.map((entry, index) => (
            <li key={entry.item.itemId} role="option" aria-selected={index === selectedIndex}>
              <button
                type="button"
                ref={(element) => { itemRefs.current[index] = element; }}
                className={index === selectedIndex ? 'backpack-item backpack-item--selected' : 'backpack-item'}
                onClick={() => setSelectedIndex(index)}
              >
                {entry.equipped ? `${entry.item.name} (equipped)` : entry.item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <DetailPane entry={items[selectedIndex]} />
      <p className="backpack-hints">
        ↑↓ select · e (un)equip · u use · d drop · l toggle light · f filter · s sort · Esc close
      </p>
    </div>
  );
}
