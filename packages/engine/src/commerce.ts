import type {
  CompiledContentPack, ItemContentEntry, MerchantEncounterContentEntry,
  NpcFactionContentEntry, ReputationTierDefinition,
} from '@woven-deep/content';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId, ReputationChangedEvent } from './model.js';
import { compareCodeUnits } from './stable-json.js';

const BPS_DIVISOR = 10_000;
const REJECTED_TRADE_TAGS: readonly string[] = ['heirloom', 'quest', 'objective', 'nontransferable'];

export interface PriceQuoteInput {
  readonly basePrice: number;
  readonly merchantBps: number;
  readonly factionBps: number;
}

function assertPriceComponent(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function checkedProduct(left: number, right: number, label: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`${label} exceeds safe integer arithmetic`);
  }
  return product;
}

/** Exact integer division via quotient/remainder; never routes through fractional floats. */
function integerQuotient(numerator: number, divisor: number, rounding: 'up' | 'down'): number {
  const remainder = numerator % divisor;
  const quotient = (numerator - remainder) / divisor;
  return rounding === 'up' && remainder > 0 ? quotient + 1 : quotient;
}

export function quoteMerchantPurchase(input: PriceQuoteInput): number {
  assertPriceComponent(input.basePrice, 'purchase base price');
  assertPriceComponent(input.merchantBps, 'purchase merchant basis points');
  assertPriceComponent(input.factionBps, 'purchase faction basis points');
  const product = checkedProduct(
    checkedProduct(input.basePrice, input.merchantBps, 'purchase quote'), input.factionBps, 'purchase quote');
  return product === 0 ? 0 : Math.max(1, integerQuotient(product, BPS_DIVISOR * BPS_DIVISOR, 'up'));
}

export function quoteMerchantSale(input: PriceQuoteInput): number {
  assertPriceComponent(input.basePrice, 'sale base price');
  assertPriceComponent(input.merchantBps, 'sale merchant basis points');
  assertPriceComponent(input.factionBps, 'sale faction basis points');
  const product = checkedProduct(
    checkedProduct(input.basePrice, input.merchantBps, 'sale quote'), input.factionBps, 'sale quote');
  return integerQuotient(product, BPS_DIVISOR * BPS_DIVISOR, 'down');
}

export function quoteMerchantService(input: Readonly<{ basePrice: number; factionBps: number }>): number {
  assertPriceComponent(input.basePrice, 'service base price');
  assertPriceComponent(input.factionBps, 'service faction basis points');
  const product = checkedProduct(input.basePrice, input.factionBps, 'service quote');
  return product === 0 ? 0 : Math.max(1, integerQuotient(product, BPS_DIVISOR, 'up'));
}

function assertFactionBounds(faction: NpcFactionContentEntry): void {
  if (!Number.isSafeInteger(faction.minimumReputation) || !Number.isSafeInteger(faction.maximumReputation)
    || !Number.isSafeInteger(faction.startingReputation)
    || faction.minimumReputation > faction.maximumReputation
    || faction.startingReputation < faction.minimumReputation
    || faction.startingReputation > faction.maximumReputation) {
    throw new RangeError(`faction ${faction.id} reputation bounds are invalid`);
  }
}

function sortedReputations(
  reputations: readonly ActiveRun['reputations'][number][],
): readonly ActiveRun['reputations'][number][] {
  return [...reputations].sort((left, right) => compareCodeUnits(left.factionId, right.factionId));
}

export function factionReputation(run: ActiveRun, faction: NpcFactionContentEntry): number {
  assertFactionBounds(faction);
  const record = run.reputations.find((entry) => entry.factionId === faction.id);
  return record === undefined ? faction.startingReputation : record.value;
}

export function ensureFactionReputation(run: ActiveRun, faction: NpcFactionContentEntry): ActiveRun {
  assertFactionBounds(faction);
  if (run.reputations.some((entry) => entry.factionId === faction.id)) return run;
  const reputations = sortedReputations([...run.reputations,
    { factionId: faction.id, value: faction.startingReputation }]);
  return { ...run, reputations };
}

export function reputationTier(value: number, faction: NpcFactionContentEntry): ReputationTierDefinition {
  const tier = faction.tiers.find((candidate) => value >= candidate.minimum && value <= candidate.maximum);
  if (!tier) throw new RangeError(`faction ${faction.id} has no reputation tier covering ${value}`);
  return tier;
}

export function changeReputation(input: Readonly<{
  run: ActiveRun;
  faction: NpcFactionContentEntry;
  delta: number;
  reason: 'commerce' | 'aggression' | 'death';
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; event: ReputationChangedEvent }> {
  assertFactionBounds(input.faction);
  if (!Number.isSafeInteger(input.delta)) {
    throw new RangeError('reputation delta must be a safe integer');
  }
  const previous = factionReputation(input.run, input.faction);
  if (!Number.isSafeInteger(previous + input.delta)) {
    throw new RangeError('reputation change exceeds safe integer arithmetic');
  }
  const value = Math.min(input.faction.maximumReputation,
    Math.max(input.faction.minimumReputation, previous + input.delta));
  const reputations = sortedReputations([
    ...input.run.reputations.filter((entry) => entry.factionId !== input.faction.id),
    { factionId: input.faction.id, value },
  ]);
  return {
    state: { ...input.run, reputations },
    event: { type: 'reputation.changed', eventId: input.eventId, factionId: input.faction.id,
      previous, delta: input.delta, value, reason: input.reason },
  };
}

/** Item ids that boss encounters guarantee as unique rewards; merchants must never trade them. */
export function guaranteedUniqueItemIds(content: CompiledContentPack): ReadonlySet<OpaqueId> {
  return new Set(content.entries.flatMap((entry) =>
    entry.kind === 'encounter' && entry.model === 'boss' ? [entry.definition.uniqueItemId] : []));
}

export function merchantAcceptsItem(
  item: ItemInstance,
  definition: ItemContentEntry,
  encounter: MerchantEncounterContentEntry,
  uniqueItemIds: ReadonlySet<OpaqueId>,
): boolean {
  if (item.contentId !== definition.id) {
    throw new Error(`internal invariant: item ${item.itemId} definition ${definition.id} does not match ${item.contentId}`);
  }
  return item.location.type === 'backpack'
    && item.heirloom === undefined
    && Number.isSafeInteger(definition.price) && definition.price > 0
    && encounter.definition.acceptedCategories.includes(definition.category)
    && !definition.tags.some((tag) => REJECTED_TRADE_TAGS.includes(tag))
    && !uniqueItemIds.has(definition.id);
}
