import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EquipmentSlot, OpaqueId } from '@woven-deep/engine';
import { effectLabel } from '../labels.js';
import { useSessionCtx } from '../providers.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { Button } from '../components/button.js';
import { cn } from '../lib/cn.js';

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

/** Plain-ASCII glyph per category -- traditional roguelike shorthand, purely presentational (no
 * content-pack lookup: an unidentified item's projection omits `contentId` entirely, so a glyph
 * derived from `category` alone is the only one guaranteed to always be available). */
const CATEGORY_GLYPH: Readonly<Record<ProjectedItemCategory, string>> = {
  weapon: ')', ammunition: '↑', armor: '[', shield: '[', light: '~', fuel: '~',
  food: '%', potion: '!', scroll: '?', ring: '=', misc: '*',
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

/** The subset of `projection.hero`'s widened `Record<string, unknown>` shape this overlay actually
 * reads -- mirrors `CharacterSheetOverlay`'s cast discipline. */
interface ProjectedHeroLike {
  readonly backpack: readonly ProjectedItemLike[];
  readonly equipment: Readonly<Record<string, ProjectedItemLike | null>>;
}

interface MenuEntry {
  readonly item: ProjectedItemLike;
  /** `true` for a currently-equipped item: its detail action becomes "unequip" rather than
   * "equip" -- identical contract to the pre-existing `BackpackMenu`/`InventoryOverlay`. */
  readonly equipped: boolean;
  readonly slot?: string;
}

/** The nine real equipment slots the engine's `EquipmentSlot` union defines
 * (`packages/engine/src/actor-model.ts`), in a fixed, sensible presentation order -- never
 * invented ("weapon/armor/shield/light/ring/amulet" is loose brief shorthand for these). */
const SLOT_ORDER: readonly EquipmentSlot[] = [
  'main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring',
];

const SLOT_LABEL: Readonly<Record<EquipmentSlot, string>> = {
  'main-hand': 'Main hand', 'off-hand': 'Off hand', body: 'Body', head: 'Head', hands: 'Hands',
  feet: 'Feet', neck: 'Neck', 'left-ring': 'Left ring', 'right-ring': 'Right ring',
};

/**
 * Everything the overlay can act on, in the exact pre-existing order: the hero's backpack stacks
 * first (the pinned e2e walks act on "the first backpack item"), then each equipped item in
 * `hero.equipment`'s own key order -- byte-for-byte the same ordering the pre-`ListDetail`
 * `InventoryOverlay` produced, since that ordering is load-bearing for the pinned 5A/5C e2e walks
 * (they never invoke the filter/sort additions, so they must see this exact default order).
 */
function allMenuEntries(hero: ProjectedHeroLike): readonly MenuEntry[] {
  const backpack = hero.backpack.map((item) => ({ item, equipped: false }));
  const equipped = Object.entries(hero.equipment)
    .filter((entry): entry is [string, ProjectedItemLike] => entry[1] !== null)
    .map(([slot, item]) => ({ item, equipped: true, slot }));
  return [...backpack, ...equipped];
}

function matchesFilter(item: ProjectedItemLike, filter: CategoryFilter): boolean {
  return filter === 'all' || bucketFor(item.category) === filter;
}

/** Stable, locale-free (plain codepoint) name comparison -- `localeCompare` is deliberately never
 * used here, so sort order can never depend on the guest's browser locale. */
function byNameStable(left: MenuEntry, right: MenuEntry): number {
  if (left.item.name < right.item.name) return -1;
  if (left.item.name > right.item.name) return 1;
  return 0;
}

function visibleEntries(
  hero: ProjectedHeroLike, filter: CategoryFilter, sortByName: boolean,
): readonly MenuEntry[] {
  const filtered = allMenuEntries(hero).filter((entry) => matchesFilter(entry.item, filter));
  if (!sortByName) return filtered;
  // `Array#sort` in every JS engine this project targets is a stable sort (ES2019+), so ties (two
  // items sharing a name) keep their original backpack-then-equipped relative order.
  return [...filtered].sort(byNameStable);
}

function toListItem(entry: MenuEntry): ListDetailItem {
  return {
    id: entry.item.itemId,
    glyph: CATEGORY_GLYPH[entry.item.category],
    label: entry.item.name,
    quantity: entry.item.quantity,
    ...(entry.equipped ? { badge: 'EQ' } : {}),
  };
}

function ActionButton({ label, chord, onClick }: Readonly<{ label: string; chord: string; onClick: () => void }>): JSX.Element {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      {`${label} (${chord})`}
    </Button>
  );
}

function DetailPane({
  entry, onEquip, onUse, onDrop, onToggleLight,
}: Readonly<{
  entry: MenuEntry | undefined;
  onEquip: () => void;
  onUse: () => void;
  onDrop: () => void;
  onToggleLight: () => void;
}>): JSX.Element {
  if (!entry) return <p className="text-muted">Nothing selected.</p>;
  const { item, equipped, slot } = entry;
  const unidentified = item.contentId === undefined;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-fg-strong">{item.name}</h3>
        <p className="text-sm text-muted">{`${item.category} · ${unidentified ? 'Unidentified' : 'Identified'} · Condition ${item.condition}`}</p>
      </div>

      {equipped && <p className="text-sm">{`Equipped: ${slot}`}</p>}

      {!unidentified && item.effects && item.effects.length > 0 && (
        <div>
          <p className="text-sm font-medium">Effects</p>
          <ul className="text-sm text-muted">
            {item.effects.map((effect) => (
              <li key={effect.effectId}>{effectLabel(effect.effectId, effect.parameters)}</li>
            ))}
          </ul>
        </div>
      )}

      {item.enchantment && (
        <div>
          <p className="text-sm font-medium">Enchantment</p>
          <ul className="text-sm text-muted">
            {Object.entries(item.enchantment.modifiers).map(([stat, amount]) => (
              <li key={stat}>{`${stat}: ${amount >= 0 ? '+' : ''}${amount}`}</li>
            ))}
          </ul>
        </div>
      )}
      {item.unknownProperties && <p className="text-sm">Unknown properties</p>}

      {item.charges != null && <p className="text-sm">{`Charges: ${item.charges}`}</p>}
      {item.fuel != null && <p className="text-sm">{`Fuel: ${item.fuel}`}</p>}
      {item.enabled !== null && <p className="text-sm">{item.enabled ? 'Lit' : 'Unlit'}</p>}

      <div className="flex flex-wrap gap-2">
        <ActionButton label={equipped ? 'Unequip' : 'Equip'} chord="e" onClick={onEquip} />
        <ActionButton label="Use" chord="u" onClick={onUse} />
        <ActionButton label="Drop" chord="d" onClick={onDrop} />
        {item.category === 'light' && <ActionButton label="Toggle light" chord="l" onClick={onToggleLight} />}
      </div>
    </div>
  );
}

function EquipmentSlots({ equipment }: Readonly<{ equipment: Readonly<Record<string, ProjectedItemLike | null>> }>): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-line bg-surface p-2 text-xs">
      {SLOT_ORDER.map((slot) => {
        const item = equipment[slot] ?? null;
        return (
          <div key={slot} className={cn('flex flex-col gap-0.5 rounded-sm px-1 py-0.5', item && 'bg-raised')}>
            <span className="text-muted">{SLOT_LABEL[slot]}</span>
            <span className="font-mono text-fg">
              {item ? `${CATEGORY_GLYPH[item.category]} ${item.name}` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The guest's backpack, rebuilt (Task 7) on the shared `ListDetail` component as the "structure 1"
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
  const hero = snapshot.projection.hero as unknown as ProjectedHeroLike;

  const entries = visibleEntries(hero, filter, sortByName);
  const selected = entries[selectedIndex];

  function dispatchAction(action: 'equip' | 'unequip' | 'use' | 'drop' | 'toggle-light'): void {
    if (!selected) return;
    session.dispatch({ type: 'backpack', action, itemId: selected.item.itemId });
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
            onEquip={() => dispatchAction(selected?.equipped ? 'unequip' : 'equip')}
            onUse={() => dispatchAction('use')}
            onDrop={() => dispatchAction('drop')}
            onToggleLight={() => dispatchAction('toggle-light')}
          />
        )}
      />
      {entries.length === 0 && <p className="text-muted">Your backpack is empty.</p>}
    </div>
  );
}
