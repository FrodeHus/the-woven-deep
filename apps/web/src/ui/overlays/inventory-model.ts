import type { CompiledContentPack } from '@woven-deep/content';
import { type HeroView, type OwnedItemView } from '../../session/projection-view.js';
import { itemById } from '../../session/pack-queries.js';

/** The real item-category vocabulary the content model/engine projection actually emits (see
 * `packages/content/src/model.ts`'s `ItemCategory`) -- never invented. */
export type ProjectedItemCategory =
  | 'weapon' | 'ammunition' | 'armor' | 'shield' | 'light' | 'fuel' | 'food' | 'potion' | 'scroll' | 'ring' | 'misc';

/** The five buckets the overlay's category filter cycles through, plus `all`. Grouped from the
 * real vocabulary above by rough kind, not invented categories: weapon/ammunition (things you
 * fight with), armor/shield (things you wear to block), food/potion/scroll (things consumed),
 * light/fuel (light-source management), ring/misc (everything left over). */
export type CategoryFilter = 'all' | 'weapons' | 'armor' | 'consumables' | 'light' | 'other';

export const CATEGORY_FILTER_ORDER: readonly CategoryFilter[] =
  ['all', 'weapons', 'armor', 'consumables', 'light', 'other'];

export const CATEGORY_FILTER_LABEL: Readonly<Record<CategoryFilter, string>> = {
  all: 'All', weapons: 'Weapons', armor: 'Armor', consumables: 'Consumables', light: 'Light', other: 'Other',
};

/** Plain-ASCII glyph per category -- traditional roguelike shorthand, purely presentational (no
 * content-pack lookup: an unidentified item's projection omits `contentId` entirely, so a glyph
 * derived from `category` alone is the only one guaranteed to always be available). */
export const CATEGORY_GLYPH: Readonly<Record<ProjectedItemCategory, string>> = {
  weapon: ')', ammunition: '↑', armor: '[', shield: '[', light: '~', fuel: '~',
  food: '%', potion: '!', scroll: '?', ring: '=', misc: '*',
};

export function bucketFor(category: ProjectedItemCategory): Exclude<CategoryFilter, 'all'> {
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

/** The hero-owned item shape this overlay reads, re-exported from the projection boundary so
 * `CharacterSheetOverlay` and this overlay's tests keep a single shared name. */
export type ProjectedItemLike = OwnedItemView;

export interface MenuEntry {
  readonly item: ProjectedItemLike;
  /** `true` for a currently-equipped item: its detail action is "unequip" rather than "equip". */
  readonly equipped: boolean;
  readonly slot?: string;
}

/**
 * Everything the overlay can act on, in a fixed order: the hero's backpack stacks first (the
 * pinned e2e walks act on "the first backpack item"), then each equipped item in
 * `hero.equipment`'s own key order -- that ordering is load-bearing for the pinned 5A/5C e2e walks
 * (they never invoke the filter/sort additions, so they must see this exact default order).
 */
export function allMenuEntries(hero: HeroView): readonly MenuEntry[] {
  const backpack = hero.backpack.map((item) => ({ item, equipped: false }));
  const equipped = Object.entries(hero.equipment)
    .filter((entry): entry is [string, ProjectedItemLike] => entry[1] !== null)
    .map(([slot, item]) => ({ item, equipped: true, slot }));
  return [...backpack, ...equipped];
}

export function matchesFilter(item: ProjectedItemLike, filter: CategoryFilter): boolean {
  return filter === 'all' || bucketFor(item.category) === filter;
}

/** Stable, locale-free (plain codepoint) name comparison -- `localeCompare` is deliberately never
 * used here, so sort order can never depend on the guest's browser locale. */
export function byNameStable(left: MenuEntry, right: MenuEntry): number {
  if (left.item.name < right.item.name) return -1;
  if (left.item.name > right.item.name) return 1;
  return 0;
}

export function visibleEntries(
  hero: HeroView, filter: CategoryFilter, sortByName: boolean,
): readonly MenuEntry[] {
  const filtered = allMenuEntries(hero).filter((entry) => matchesFilter(entry.item, filter));
  if (!sortByName) return filtered;
  // `Array#sort` in every JS engine this project targets is a stable sort (ES2019+), so ties (two
  // items sharing a name) keep their original backpack-then-equipped relative order.
  return [...filtered].sort(byNameStable);
}

/**
 * The currently-equipped light (if any) that `fuelItem` can refuel: matches when the fuel item's
 * content-pack `tags` intersect the light's `light.fuelTags` (see `content/items/lamp-oil.yaml`'s
 * `lamp-oil` tag and `content/items/brass-lantern.yaml`'s `light.fuelTags: [lamp-oil]`). Returns
 * the first matching equipped light in `hero.equipment`'s own key order -- mirrors
 * `allMenuEntries`'s equipped-item ordering; the content pack never equips two lights that share
 * a fuel tag, so "first match" is unambiguous in practice.
 */
export function equippedLightMatchingFuel(
  pack: CompiledContentPack, hero: HeroView, fuelItem: ProjectedItemLike,
): ProjectedItemLike | undefined {
  if (fuelItem.contentId === undefined) return undefined;
  const fuelEntry = itemById(pack, fuelItem.contentId);
  if (!fuelEntry) return undefined;
  const fuelTags = fuelEntry.tags;
  return Object.values(hero.equipment)
    .filter((item): item is ProjectedItemLike => item !== null && item.category === 'light' && item.contentId !== undefined)
    .find((item) => {
      if (item.contentId === undefined) return false;
      const lightEntry = itemById(pack, item.contentId);
      return lightEntry !== undefined && lightEntry.light !== null
        && lightEntry.light.fuelTags.some((tag) => fuelTags.includes(tag));
    });
}
