import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { itemById } from './pack-queries.js';
import { groundItemsOf, heroOf, type GroundItemView } from './projection-view.js';

/**
 * Which ground items auto-explore may sweep up without asking. Gold is pure upside (it credits
 * `hero.currency` and costs no backpack slot), and the five consumable categories are the ones a
 * player would take every time -- everything else (weapons, armor, rings, artifacts, anything
 * unidentified enough to be interesting) is left alone, and the stepper's new-item stop rule halts
 * the walk so the player decides in person.
 */

/** Exactly the spec's consumable set, drawn from content's `ITEM_CATEGORIES`. */
export const AUTO_PICKUP_CONSUMABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'food',
  'potion',
  'scroll',
  'ammunition',
  'fuel',
]);

/** Would auto-travel take `item` if the hero stood on it right now? Pure: the projection supplies
 * backpack occupancy, the closure supplies the pack and the player's setting. */
export type AutoPickupPolicy = (projection: GameplayProjection, item: GroundItemView) => boolean;

/** A named artifact is never swept up automatically -- a singleton with provenance is exactly the
 * kind of find the player should be standing still for. An unidentified item carries no
 * `contentId`, so it can never be resolved to an artifact; it is also never in an auto-picked
 * category unless it is plain currency, which is never an artifact in practice. */
function isArtifact(pack: CompiledContentPack, item: GroundItemView): boolean {
  if (item.contentId === undefined) return false;
  return itemById(pack, item.contentId)?.artifact != null;
}

export function createAutoPickupPolicy(
  input: Readonly<{ pack: CompiledContentPack; allowConsumables: boolean }>,
): AutoPickupPolicy {
  const { pack, allowConsumables } = input;
  return (projection, item) => {
    if (isArtifact(pack, item)) return false;
    if (item.category === 'currency') return true;
    if (!allowConsumables) return false;
    if (!AUTO_PICKUP_CONSUMABLE_CATEGORIES.has(item.category)) return false;
    const hero = heroOf(projection);
    return hero.backpack.length < hero.backpackCapacity;
  };
}

/** The ground item the hero is standing on, if any -- the one cell auto-pickup ever considers. */
export function groundItemUnderHero(projection: GameplayProjection): GroundItemView | undefined {
  const hero = heroOf(projection);
  return groundItemsOf(projection).find((item) => item.x === hero.x && item.y === hero.y);
}
