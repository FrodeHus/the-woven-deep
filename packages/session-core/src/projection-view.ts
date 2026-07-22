import type {
  CastableSpellView,
  DerivedStatFormula,
  DerivedStatName,
  GameplayProjection,
  ObservableTradeProjection,
  OpaqueId,
  TileId,
} from '@woven-deep/engine';
import type { CompiledContentPack, ItemCategory } from '@woven-deep/content';
import { itemById } from './pack-queries.js';

/**
 * The single typed boundary over the engine's gameplay projection. The engine projects
 * `hero`/`actors`/`features`/`groundItems`/`house` (and each trade stock item) as loose
 * `Readonly<Record<string, unknown>>` so that spoiler-conditional fields can be present or absent
 * per actor/item. Consumers reach every projection surface through this one typed boundary rather
 * than re-narrowing the loose record themselves. This module owns the view-model interfaces and the
 * ONE cast that maps the loose projection onto them; `projection-view.test.ts` pins these interfaces
 * to the shape a real projection actually emits, so the single cast cannot silently drift.
 */

export type AttributeName = 'might' | 'agility' | 'vitality' | 'wits' | 'resolve';

export interface ItemEffectView {
  readonly effectId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ItemEnchantmentView {
  readonly enchantmentId: OpaqueId;
  readonly modifiers: Readonly<Record<string, number>>;
}

/** The base shape `projectItem` (`packages/engine/src/identification.ts`) emits. An unidentified
 * item omits `contentId`/`effects`/`enchantment` entirely and carries `appearanceId` instead, so
 * everything past the always-present core is optional. */
export interface ItemView {
  readonly itemId: OpaqueId;
  readonly name: string;
  readonly glyph?: string;
  readonly color?: string;
  readonly category: ItemCategory;
  readonly quantity: number;
  readonly identified: boolean;
  readonly appearanceId?: string;
  readonly contentId?: OpaqueId;
  readonly effects?: readonly ItemEffectView[];
  readonly enchantment?: ItemEnchantmentView;
  readonly unknownProperties?: boolean;
  readonly provenance?: Readonly<{ originatingHallRecordId: OpaqueId }>;
}

/** A hero-owned item (`projectedOwnedItem`): the base item plus its instance condition/fuel/enabled,
 * and `charges` only when the item is identified (`contentId` present). */
export interface OwnedItemView extends ItemView {
  readonly condition: number;
  readonly charges?: number | null;
  readonly fuel: number | null;
  readonly enabled: boolean | null;
}

/** A ground item: the base item plus the floor coordinates the projector attaches. */
export interface GroundItemView extends ItemView {
  readonly x: number;
  readonly y: number;
}

export interface ConditionView {
  readonly conditionId: string;
  readonly name: string;
  readonly color: string;
  readonly stacks: number;
  readonly remaining: number | null;
}

export interface DerivedStatView {
  readonly value: number;
  readonly formula: DerivedStatFormula;
}

export interface HeroView {
  readonly actorId: OpaqueId;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly attributes: Readonly<Record<AttributeName, number>>;
  readonly derived: Readonly<Record<DerivedStatName, DerivedStatView>>;
  readonly health: number;
  readonly maxHealth: number;
  readonly weave: number;
  readonly maxWeave: number;
  readonly sightRadius: number;
  readonly hungerStage: string;
  readonly conditions: readonly ConditionView[];
  readonly equipment: Readonly<Record<string, OwnedItemView | null>>;
  readonly backpack: readonly OwnedItemView[];
  readonly backpackCapacity: number;
  readonly knownAppearanceIds: readonly string[];
  readonly castableSpells?: readonly CastableSpellView[];
}

export type { CastableSpellView };

export interface ActorHealthPresentation {
  readonly current: number;
  readonly maximum: number;
  readonly band: string;
}

/** A perceived non-hero actor. The core fields are always present; the rest are the
 * spoiler-conditional presentation blocks the projector spreads only for the matching population
 * model (swarm source / boss / merchant / champion-echo / group leader / visible intent). */
export interface ActorView {
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId | null;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly healthPresentation: ActorHealthPresentation;
  readonly disposition: string;
  readonly name?: string;
  readonly glyph?: string;
  readonly color?: string;
  readonly equipmentContentIds?: readonly OpaqueId[];
  readonly abilityIds?: readonly OpaqueId[];
  readonly source?: boolean;
  readonly sourceState?: string;
  readonly growthWarning?: string;
  readonly bossPhase?: OpaqueId;
  readonly factionName?: string;
  readonly reputationTier?: string;
  readonly tradeAvailable?: boolean;
  readonly departureWarning?: number;
  readonly intent?: string;
  readonly intentPresentation?: string;
  readonly leadershipRole?: OpaqueId | null;
}

/** A perceived feature (`projectFeature`). Doors and discovered features carry `featureId`/`state`;
 * the only variant without a real `featureId` is an undiscovered secret's `terrain-cover` (which
 * instead carries `tileId`), and no consumer reads `featureId` on that variant. */
export interface FeatureView {
  readonly featureId: OpaqueId;
  readonly type: string;
  readonly state?: string;
  readonly tileId?: TileId;
  readonly x: number;
  readonly y: number;
}

export interface HouseView {
  readonly capacity: number;
  readonly upgradesPurchased: number;
  readonly items: readonly OwnedItemView[];
}

export interface TradeStockEntry {
  readonly item: ItemView;
  readonly quantity: number;
  readonly unitPrice: number;
}

export type TradeView = Omit<ObservableTradeProjection, 'stock'> & {
  readonly stock: readonly TradeStockEntry[];
};

type ProjectionView = Omit<
  GameplayProjection,
  'hero' | 'actors' | 'features' | 'groundItems' | 'house' | 'trade'
> & {
  readonly hero: HeroView;
  readonly actors: readonly ActorView[];
  readonly features: readonly FeatureView[];
  readonly groundItems: readonly GroundItemView[];
  readonly house: HouseView;
  readonly trade?: TradeView;
};

// The one reviewed cast in the web client. Everything below reads typed fields off the result.
function view(projection: GameplayProjection): ProjectionView {
  return projection as unknown as ProjectionView;
}

export function heroOf(projection: GameplayProjection): HeroView {
  return view(projection).hero;
}

export function actorsOf(projection: GameplayProjection): readonly ActorView[] {
  return view(projection).actors;
}

export function featuresOf(projection: GameplayProjection): readonly FeatureView[] {
  return view(projection).features;
}

export function groundItemsOf(projection: GameplayProjection): readonly GroundItemView[] {
  return view(projection).groundItems;
}

export function houseOf(projection: GameplayProjection): HouseView {
  return view(projection).house;
}

export function tradeOf(projection: GameplayProjection): TradeView | undefined {
  return view(projection).trade;
}

/** The active floor's authored placement slots -- already typed by the engine
 * (`ObservablePlacementSlot`), exposed here so consumers reach every projection surface through one
 * module. */
export function slotsOf(projection: GameplayProjection): GameplayProjection['slots'] {
  return projection.slots;
}

/** The hero-owned item with the given id, found in the backpack first, then equipment. */
export function ownedItemOf(hero: HeroView, itemId: OpaqueId): OwnedItemView | undefined {
  return (
    hero.backpack.find((item) => item.itemId === itemId) ??
    Object.values(hero.equipment).find(
      (item): item is OwnedItemView => item !== null && item.itemId === itemId,
    )
  );
}

/** The Chebyshev (king-move) distance between two grid positions. */
export function chebyshev(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The perceived merchant actors. A merchant carries `factionName` only via `visibleMerchantState`
 * (the engine's `projection.ts`), so its presence -- rather than any population-model tag lost in
 * translation -- is the honest signal that an actor is a merchant. */
export function merchantActors(projection: GameplayProjection): readonly ActorView[] {
  return actorsOf(projection).filter((actor) => typeof actor.factionName === 'string');
}

/** The merchant actor the hero is Chebyshev-adjacent to (but not standing on), if any. When more
 * than one merchant is adjacent, the nearest by actor-id ordering wins; the town's authored
 * merchant stalls never place two merchants close enough for this to matter in practice. */
export function adjacentMerchant(projection: GameplayProjection): ActorView | undefined {
  const origin = heroOf(projection);
  return merchantActors(projection)
    .filter((actor) => chebyshev(actor, origin) === 1)
    .sort((left, right) => (left.actorId < right.actorId ? -1 : 1))[0];
}

/** Whether a trade session could be opened right now: some merchant actor is Chebyshev-adjacent to
 * the hero with `tradeAvailable` not explicitly `false`. */
export function tradeIsAvailable(projection: GameplayProjection): boolean {
  const hero = heroOf(projection);
  return merchantActors(projection).some(
    (merchant) => chebyshev(hero, merchant) === 1 && merchant.tradeAvailable !== false,
  );
}

/** The locked door/chest the hero is Chebyshev-adjacent to (but not standing on), if any --
 * mirrors `adjacentMerchant`'s adjacency rule. Feeds both `command-builder.ts` (which resolves a
 * `pick-lock` intent's `featureId` from this) and any UI affordance offering the action. When more
 * than one locked feature is adjacent, the nearest by feature-id ordering wins, exactly like
 * `adjacentMerchant`. */
export function adjacentLockedFeature(projection: GameplayProjection): FeatureView | undefined {
  const origin = heroOf(projection);
  return featuresOf(projection)
    .filter(
      (feature) =>
        (feature.type === 'door' || feature.type === 'chest') &&
        feature.state === 'locked' &&
        chebyshev(feature, origin) === 1,
    )
    .sort((left, right) => (left.featureId < right.featureId ? -1 : 1))[0];
}

/** Every item the hero currently holds, backpack and equipped alike -- the pool `heroHoldsTag`
 * searches for a lockpick or a key. */
function heroHeldItems(hero: HeroView): readonly OwnedItemView[] {
  return [
    ...hero.backpack,
    ...Object.values(hero.equipment).filter((item): item is OwnedItemView => item !== null),
  ];
}

/** Whether the hero holds at least one identified item whose content entry carries `tag` (e.g.
 * `'lockpick'` or `'key'`). The projection never exposes a lock's exact `keyContentId`, so this is
 * necessarily a best-effort signal for the UI to offer/label the pick-lock action -- the engine
 * itself independently re-validates the exact key/lockpick match before resolving the attempt. */
function heroHoldsTag(hero: HeroView, pack: CompiledContentPack, tag: string): boolean {
  return heroHeldItems(hero).some(
    (item) => item.contentId !== undefined && itemById(pack, item.contentId)?.tags.includes(tag),
  );
}

/** Whether the hero holds anything that could plausibly open a lock right now: a lockpick, or a
 * key (only actual keys carry the `key` tag; the engine still checks the exact door/key match). */
export function heroCanAttemptPick(hero: HeroView, pack: CompiledContentPack): boolean {
  return heroHoldsTag(hero, pack, 'lockpick') || heroHoldsTag(hero, pack, 'key');
}
