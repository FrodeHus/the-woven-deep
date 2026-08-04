import type {
  ArtifactDefinition,
  CompiledContentPack,
  ItemContentEntry,
  MerchantEncounterContentEntry,
  NpcFactionContentEntry,
  ReputationTierDefinition,
} from '@woven-deep/content';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId, ReputationChangedEvent } from './model.js';
import { compareCodeUnits } from './stable-json.js';

const BPS_DIVISOR = 10_000;
const REJECTED_TRADE_TAGS: readonly string[] = [
  'heirloom',
  'quest',
  'objective',
  'nontransferable',
];

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
    checkedProduct(input.basePrice, input.merchantBps, 'purchase quote'),
    input.factionBps,
    'purchase quote',
  );
  return product === 0 ? 0 : Math.max(1, integerQuotient(product, BPS_DIVISOR * BPS_DIVISOR, 'up'));
}

export function quoteMerchantSale(input: PriceQuoteInput): number {
  assertPriceComponent(input.basePrice, 'sale base price');
  assertPriceComponent(input.merchantBps, 'sale merchant basis points');
  assertPriceComponent(input.factionBps, 'sale faction basis points');
  const product = checkedProduct(
    checkedProduct(input.basePrice, input.merchantBps, 'sale quote'),
    input.factionBps,
    'sale quote',
  );
  return integerQuotient(product, BPS_DIVISOR * BPS_DIVISOR, 'down');
}

export function quoteMerchantService(
  input: Readonly<{ basePrice: number; factionBps: number }>,
): number {
  assertPriceComponent(input.basePrice, 'service base price');
  assertPriceComponent(input.factionBps, 'service faction basis points');
  const product = checkedProduct(input.basePrice, input.factionBps, 'service quote');
  return product === 0 ? 0 : Math.max(1, integerQuotient(product, BPS_DIVISOR, 'up'));
}

/**
 * Scales a merchant service's authored base price by a positive integer multiplier -- e.g. the
 * enchant service's doubled price for a re-enchant -- checked against safe-integer overflow
 * before the faction-tier quote (`quoteMerchantService`) is ever applied to the result.
 */
export function scaledServiceBasePrice(basePrice: number, multiplier: number): number {
  assertPriceComponent(basePrice, 'service base price');
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
    throw new RangeError('service price multiplier must be a positive safe integer');
  }
  return checkedProduct(basePrice, multiplier, 'service price multiplier');
}

/**
 * The service-price step the run has reached: one, plus one per restock milestone already fired.
 * The town charges more for the same work the deeper the hero has proven willing to go, which is
 * the run's one repeatable gold sink.
 *
 * It reads `restockedMilestones` rather than `metrics.deepestDepth` on purpose: that is the same
 * saved state `applyMerchantRestocks` writes when it widens the stock pool and re-arms the service
 * uses, so all three land on the same beat and stay tunable from `balance.restockMilestones`
 * alone. It is pure arithmetic over existing state -- no RNG, no new field in either schema.
 */
export function serviceDepthMultiplier(run: ActiveRun): number {
  const steps = run.restockedMilestones.length;
  if (!Number.isSafeInteger(steps) || steps < 0) {
    throw new RangeError('restocked milestone count must be a non-negative safe integer');
  }
  return steps + 1;
}

function assertFactionBounds(faction: NpcFactionContentEntry): void {
  if (
    !Number.isSafeInteger(faction.minimumReputation) ||
    !Number.isSafeInteger(faction.maximumReputation) ||
    !Number.isSafeInteger(faction.startingReputation) ||
    faction.minimumReputation > faction.maximumReputation ||
    faction.startingReputation < faction.minimumReputation ||
    faction.startingReputation > faction.maximumReputation
  ) {
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

export function ensureFactionReputation(
  run: ActiveRun,
  faction: NpcFactionContentEntry,
): ActiveRun {
  assertFactionBounds(faction);
  if (run.reputations.some((entry) => entry.factionId === faction.id)) return run;
  const reputations = sortedReputations([
    ...run.reputations,
    { factionId: faction.id, value: faction.startingReputation },
  ]);
  return { ...run, reputations };
}

export function reputationTier(
  value: number,
  faction: NpcFactionContentEntry,
): ReputationTierDefinition {
  const tier = faction.tiers.find(
    (candidate) => value >= candidate.minimum && value <= candidate.maximum,
  );
  if (!tier) throw new RangeError(`faction ${faction.id} has no reputation tier covering ${value}`);
  return tier;
}

export function changeReputation(
  input: Readonly<{
    run: ActiveRun;
    faction: NpcFactionContentEntry;
    delta: number;
    reason: 'commerce' | 'aggression' | 'death' | 'dialogue';
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; event: ReputationChangedEvent }> {
  assertFactionBounds(input.faction);
  if (!Number.isSafeInteger(input.delta)) {
    throw new RangeError('reputation delta must be a safe integer');
  }
  const previous = factionReputation(input.run, input.faction);
  if (!Number.isSafeInteger(previous + input.delta)) {
    throw new RangeError('reputation change exceeds safe integer arithmetic');
  }
  const value = Math.min(
    input.faction.maximumReputation,
    Math.max(input.faction.minimumReputation, previous + input.delta),
  );
  const reputations = sortedReputations([
    ...input.run.reputations.filter((entry) => entry.factionId !== input.faction.id),
    { factionId: input.faction.id, value },
  ]);
  return {
    state: { ...input.run, reputations },
    event: {
      type: 'reputation.changed',
      eventId: input.eventId,
      factionId: input.faction.id,
      previous,
      delta: input.delta,
      value,
      reason: input.reason,
    },
  };
}

/** Item ids that boss encounters guarantee as unique rewards; merchants must never trade them. */
export function guaranteedUniqueItemIds(content: CompiledContentPack): ReadonlySet<OpaqueId> {
  return new Set(
    content.entries.flatMap((entry) =>
      entry.kind === 'encounter' && entry.model === 'boss' ? [entry.definition.uniqueItemId] : [],
    ),
  );
}

interface ArtifactIndex {
  readonly ids: ReadonlySet<OpaqueId>;
  readonly byId: ReadonlyMap<OpaqueId, ArtifactDefinition>;
}

// Both lookups below sit on hot per-command paths (`validateContentBoundRun`, `consumeFuel`'s
// per-item loop), so the pack scan runs once per pack object rather than per call. Keyed by pack
// identity: packs are immutable once compiled, so the derived index can never go stale, and a
// WeakMap keeps the cache invisible to determinism (pure function of the pack) and to memory.
const artifactIndexCache = new WeakMap<CompiledContentPack, ArtifactIndex>();

function artifactIndex(content: CompiledContentPack): ArtifactIndex {
  const cached = artifactIndexCache.get(content);
  if (cached) return cached;
  const byId = new Map<OpaqueId, ArtifactDefinition>();
  for (const entry of content.entries) {
    if (entry.kind === 'item' && entry.artifact !== null) {
      byId.set(entry.id, entry.artifact);
    }
  }
  const index: ArtifactIndex = { ids: new Set(byId.keys()), byId };
  artifactIndexCache.set(content, index);
  return index;
}

/** Content IDs of items carrying an `artifact` block. */
export function artifactItemIds(content: CompiledContentPack): ReadonlySet<OpaqueId> {
  return artifactIndex(content).ids;
}

/** The `artifact` definition for a content ID, or null when the item is not an artifact. */
export function artifactById(
  content: CompiledContentPack,
  contentId: OpaqueId,
): ArtifactDefinition | null {
  return artifactIndex(content).byId.get(contentId) ?? null;
}

/**
 * The content ID a defeated boss actually drops as its guaranteed unique, or `null` when the drop
 * is withheld. A boss relic that is a legendary artifact is a singleton in circulation: it exists
 * once per profile, so the boss may only mint it while it is still undiscovered. Once some hero
 * has found it, the relic lives in the Hall's ledger -- carried, or waiting on the champion who
 * died holding it -- and the boss drops its enhanced loot alone. Non-artifact uniques are never
 * gated: they are per-run rewards, not circulating objects.
 */
export function bossUniqueDropId(
  content: CompiledContentPack,
  run: Readonly<{ artifactsUndiscovered: readonly OpaqueId[] }>,
  uniqueItemId: OpaqueId,
): OpaqueId | null {
  if (!artifactItemIds(content).has(uniqueItemId)) return uniqueItemId;
  return run.artifactsUndiscovered.includes(uniqueItemId) ? uniqueItemId : null;
}

export function merchantAcceptsItem(
  item: ItemInstance,
  definition: ItemContentEntry,
  encounter: MerchantEncounterContentEntry,
  uniqueItemIds: ReadonlySet<OpaqueId>,
): boolean {
  if (item.contentId !== definition.id) {
    throw new Error(
      `internal invariant: item ${item.itemId} definition ${definition.id} does not match ${item.contentId}`,
    );
  }
  return (
    item.location.type === 'backpack' &&
    // A piece a haunt surrendered never leaves the run through a counter -- and never through an
    // offering either (see the heirloom guard in `validatePlayerAction`'s `offer` arm): the save
    // tier requires every owed piece to keep existing for as long as its haunt population does.
    item.heirloom === undefined &&
    // An unrevealed curse is invisible to merchant and hero alike -- that invisibility is the
    // gamble the identify service exists to resolve. Once revealed, the merchant refuses it same
    // as it would refuse anything else no reasonable buyer would take unseen.
    item.curse?.revealed !== true &&
    // A legendary artifact is a singleton the Hall tracks by hand: it leaves the run only through
    // the hero's death or escape, never across a counter. Selling one would also hand it to a
    // merchant whose stock is deleted outright when the merchant dies or departs -- the artifact
    // would be gone from circulation with no stint recorded, which the spec forbids.
    definition.artifact === null &&
    Number.isSafeInteger(definition.price) &&
    definition.price > 0 &&
    encounter.definition.acceptedCategories.includes(definition.category) &&
    !definition.tags.some((tag) => REJECTED_TRADE_TAGS.includes(tag)) &&
    !uniqueItemIds.has(definition.id)
  );
}
