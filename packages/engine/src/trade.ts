import type {
  CompiledContentPack, ItemContentEntry, MerchantEncounterContentEntry, NpcFactionContentEntry,
} from '@woven-deep/content';
import { heroActor, heroPerception, type ActorState } from './actor-model.js';
import { actorHasConditionTrait } from './conditions.js';
import {
  changeReputation, factionReputation, guaranteedUniqueItemIds, merchantAcceptsItem,
  quoteMerchantPurchase, quoteMerchantSale, reputationTier,
} from './commerce.js';
import { itemLightSources } from './equipment.js';
import { featureTiles } from './features.js';
import { depositIntoBackpack } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import {
  tileIndex,
  type ActiveRun, type DomainEvent, type GameCommand, type InvalidActionReason, type OpaqueId,
  type TradeBuyCommand, type TradeCloseReason, type TradeCommand, type TradeSellCommand,
} from './model.js';
import { isPerceivedCell, refreshKnowledge } from './perception.js';
import { compareCodeUnits } from './stable-json.js';
import { relationshipBetween } from './reactions.js';

export type TradeValidation = Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: InvalidActionReason }>;

export function isTradeCommand(command: GameCommand): command is TradeCommand {
  return command.type === 'trade-open' || command.type === 'trade-buy'
    || command.type === 'trade-sell' || command.type === 'trade-close';
}

function itemDefinition(content: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item') {
    throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  }
  return entry;
}

function merchantEncounter(content: CompiledContentPack, encounterId: OpaqueId): MerchantEncounterContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== 'merchant') {
    throw new Error(`internal invariant: merchant encounter ${encounterId} does not exist`);
  }
  return entry;
}

function merchantFaction(content: CompiledContentPack, factionId: OpaqueId): NpcFactionContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === factionId);
  if (!entry || entry.kind !== 'npc-faction') {
    throw new Error(`internal invariant: merchant faction ${factionId} does not exist`);
  }
  return entry;
}

function merchantPerceived(state: ActiveRun, content: CompiledContentPack, hero: ActorState, merchant: ActorState): boolean {
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const positions = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const candidate of state.actors) if (candidate.floorId === floor.floorId) positions.set(candidate.actorId, candidate);
  const effectiveFloor = { ...floor, tiles: featureTiles(state, floor.floorId) };
  const perception = refreshKnowledge({
    floor: effectiveFloor, hero: heroPerception(state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }),
  });
  const index = tileIndex(floor, merchant.x, merchant.y);
  return index !== undefined && isPerceivedCell(perception.visibilityWords, perception.illumination, index);
}

interface MerchantSession {
  readonly population: MerchantPopulation;
  readonly actor: ActorState;
  readonly encounter: MerchantEncounterContentEntry;
  readonly faction: NpcFactionContentEntry;
  readonly tier: ReturnType<typeof reputationTier>;
}

type MerchantSessionResult =
  | Readonly<{ ok: true; session: MerchantSession }>
  | Readonly<{ ok: false; reason: InvalidActionReason; close: TradeCloseReason }>;

/** Shared open/normalization invariant: living, available, not-due, nonhostile, adjacent, and perceived. */
function merchantSession(
  state: ActiveRun, content: CompiledContentPack, merchantActorId: OpaqueId,
): MerchantSessionResult {
  const hero = heroActor(state);
  const population = state.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.actorId === merchantActorId);
  const actor = state.actors.find((candidate) => candidate.actorId === merchantActorId);
  if (!population || !actor || actor.populationId !== population.populationId) {
    return { ok: false, reason: 'merchant.unavailable', close: 'unavailable' };
  }
  if (actor.health <= 0 || population.lifecycle === 'dead') {
    return { ok: false, reason: 'merchant.unavailable', close: 'death' };
  }
  if (population.lifecycle === 'departed') {
    return { ok: false, reason: 'merchant.unavailable', close: 'departure' };
  }
  if (population.lifecycle !== 'available') {
    return { ok: false, reason: 'merchant.unavailable', close: 'aggression' };
  }
  if (population.departureAt <= state.worldTime) {
    return { ok: false, reason: 'merchant.unavailable', close: 'departure' };
  }
  if (relationshipBetween(state, hero.actorId, actor.actorId) === 'hostile') {
    return { ok: false, reason: 'merchant.unavailable', close: 'aggression' };
  }
  if (population.floorId !== state.activeFloorId || actor.floorId !== hero.floorId
    || Math.max(Math.abs(actor.x - hero.x), Math.abs(actor.y - hero.y)) !== 1) {
    return { ok: false, reason: 'merchant.out-of-range', close: 'unavailable' };
  }
  if (!merchantPerceived(state, content, hero, actor)) {
    return { ok: false, reason: 'merchant.out-of-range', close: 'unavailable' };
  }
  const encounter = merchantEncounter(content, population.encounterId);
  const faction = merchantFaction(content, population.factionId);
  const tier = reputationTier(factionReputation(state, faction), faction);
  if (!tier.acceptsTrade) return { ok: false, reason: 'merchant.refuses', close: 'unavailable' };
  return { ok: true, session: { population, actor, encounter, faction, tier } };
}

function activeSession(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack;
  command: Readonly<{ merchantPopulationId: OpaqueId }>;
}>): Readonly<{ ok: true; session: MerchantSession }> | Readonly<{ ok: false; reason: InvalidActionReason }> {
  const trade = input.state.activeTrade;
  if (trade === null) return { ok: false, reason: 'trade.required' };
  if (input.command.merchantPopulationId !== trade.merchantPopulationId) {
    return { ok: false, reason: 'trade.merchant-mismatch' };
  }
  const session = merchantSession(input.state, input.content, trade.merchantActorId);
  return session.ok ? session : { ok: false, reason: session.reason };
}

function positiveQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

interface TransactionPlan {
  readonly source: ItemInstance;
  readonly definition: ItemContentEntry;
  readonly unitPrice: number;
  readonly total: number;
  readonly currency: number;
  readonly items: readonly ItemInstance[];
  readonly stockItemIds: readonly OpaqueId[];
}

type PlanResult = Readonly<{ ok: true; plan: TransactionPlan }>
  | Readonly<{ ok: false; reason: InvalidActionReason }>;

function safeTotal(unitPrice: number, quantity: number): number | undefined {
  const total = unitPrice * quantity;
  return Number.isSafeInteger(total) ? total : undefined;
}

function planBuy(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; command: TradeBuyCommand; session: MerchantSession;
}>): PlanResult {
  const { state, content, command, session } = input;
  if (!positiveQuantity(command.quantity)) return { ok: false, reason: 'item.quantity' };
  const source = state.items.find((candidate) => candidate.itemId === command.itemId);
  if (!source || source.location.type !== 'merchant-stock'
    || source.location.populationId !== session.population.populationId
    || !session.population.stockItemIds.includes(source.itemId)) {
    return { ok: false, reason: 'trade.stock-unavailable' };
  }
  if (command.quantity > source.quantity) return { ok: false, reason: 'item.quantity' };
  const definition = itemDefinition(content, source.contentId);
  let unitPrice: number;
  try {
    unitPrice = quoteMerchantPurchase({
      basePrice: definition.price, merchantBps: session.encounter.definition.merchantSaleBps,
      factionBps: session.tier.purchasePriceBps,
    });
  } catch {
    return { ok: false, reason: 'trade.insufficient-funds' };
  }
  const total = safeTotal(unitPrice, command.quantity);
  if (total === undefined || state.hero.currency < total) {
    return { ok: false, reason: 'trade.insufficient-funds' };
  }
  const hero = heroActor(state);
  const deposit = depositIntoBackpack({
    run: state, content, actorId: hero.actorId, sourceItemId: source.itemId,
    quantity: command.quantity, newItemId: command.commandId,
  });
  if (!deposit.ok) {
    return { ok: false, reason: deposit.reason === 'inventory.full' ? 'trade.capacity' : deposit.reason };
  }
  const remainsInStock = deposit.items.some((candidate) => candidate.itemId === source.itemId
    && candidate.location.type === 'merchant-stock');
  const stockItemIds = remainsInStock ? session.population.stockItemIds
    : session.population.stockItemIds.filter((candidate) => candidate !== source.itemId);
  return {
    ok: true,
    plan: {
      source, definition, unitPrice, total, currency: state.hero.currency - total,
      items: deposit.items, stockItemIds,
    },
  };
}

function planSell(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; command: TradeSellCommand; session: MerchantSession;
}>): PlanResult {
  const { state, content, command, session } = input;
  if (!positiveQuantity(command.quantity)) return { ok: false, reason: 'item.quantity' };
  const source = state.items.find((candidate) => candidate.itemId === command.itemId);
  if (!source) return { ok: false, reason: 'item.missing' };
  const hero = heroActor(state);
  const definition = itemDefinition(content, source.contentId);
  // merchantAcceptsItem requires a backpack location but not whose backpack it is; the trade
  // boundary must additionally scope acceptance to the hero's own backpack.
  const heroOwned = source.location.type === 'backpack' && source.location.actorId === hero.actorId;
  if (!heroOwned || !merchantAcceptsItem(source, definition, session.encounter, guaranteedUniqueItemIds(content))) {
    return { ok: false, reason: 'trade.item-unacceptable' };
  }
  if (command.quantity > source.quantity) return { ok: false, reason: 'item.quantity' };
  let unitPrice: number;
  try {
    unitPrice = quoteMerchantSale({
      basePrice: definition.price, merchantBps: session.encounter.definition.merchantPurchaseBps,
      factionBps: session.tier.salePriceBps,
    });
  } catch {
    return { ok: false, reason: 'trade.insufficient-funds' };
  }
  const total = safeTotal(unitPrice, command.quantity);
  if (total === undefined || !Number.isSafeInteger(state.hero.currency + total)) {
    return { ok: false, reason: 'trade.insufficient-funds' };
  }
  const partial = command.quantity < source.quantity;
  const soldId = partial ? command.commandId : source.itemId;
  if (partial && state.items.some((candidate) => candidate.itemId === soldId)) {
    return { ok: false, reason: 'item.id-conflict' };
  }
  const sold: ItemInstance = {
    ...source, itemId: soldId, quantity: command.quantity,
    location: { type: 'merchant-stock', populationId: session.population.populationId },
  };
  const items = state.items.map((candidate) => candidate.itemId === source.itemId
    ? (partial ? { ...source, quantity: source.quantity - command.quantity } : sold) : candidate);
  if (partial) items.push(sold);
  items.sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
  const stockItemIds = [...session.population.stockItemIds, soldId]
    .sort((left, right) => compareCodeUnits(left, right));
  return {
    ok: true,
    plan: {
      source, definition, unitPrice, total, currency: state.hero.currency + total,
      items, stockItemIds,
    },
  };
}

function planned(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; command: TradeCommand;
}>): PlanResult | Readonly<{ ok: false; reason: InvalidActionReason }> | null {
  if (input.command.type !== 'trade-buy' && input.command.type !== 'trade-sell') return null;
  const session = activeSession({ state: input.state, content: input.content, command: input.command });
  if (!session.ok) return session;
  return input.command.type === 'trade-buy'
    ? planBuy({ state: input.state, content: input.content, command: input.command, session: session.session })
    : planSell({ state: input.state, content: input.content, command: input.command, session: session.session });
}

/** Closed preflight; a successful validation carries no mutation and consumes no randomness. */
export function validateTradeCommand(input: Readonly<{
  state: ActiveRun; command: TradeCommand; content: CompiledContentPack;
}>): TradeValidation {
  const hero = heroActor(input.state);
  if (actorHasConditionTrait(hero, 'condition-trait.incapacitated', input.content)) {
    return { ok: false, reason: 'action.unavailable' };
  }
  if (input.command.type === 'trade-open') {
    if (input.state.activeTrade !== null) return { ok: false, reason: 'trade.active' };
    const session = merchantSession(input.state, input.content, input.command.merchantActorId);
    return session.ok ? { ok: true } : { ok: false, reason: session.reason };
  }
  if (input.command.type === 'trade-close') {
    const session = activeSession({ state: input.state, content: input.content, command: input.command });
    return session.ok ? { ok: true } : { ok: false, reason: session.reason };
  }
  const plan = planned({ state: input.state, content: input.content, command: input.command });
  return plan === null || plan.ok ? { ok: true } : { ok: false, reason: plan.reason };
}

function replaceMerchantPopulation(
  state: ActiveRun, population: MerchantPopulation,
): readonly ActiveRun['populations'][number][] {
  return state.populations.map((candidate) =>
    candidate.populationId === population.populationId ? population : candidate);
}

/**
 * Closes the active trade session. The commerce reputation delta is granted only on an explicit
 * player close after completed commerce, and at most once per merchant (`commerceBonusApplied`).
 */
export function closeTrade(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
  reason: TradeCloseReason;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const trade = input.state.activeTrade;
  if (trade === null) throw new Error('internal invariant: closeTrade requires an active trade');
  const population = input.state.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.populationId === trade.merchantPopulationId);
  const closed: DomainEvent = {
    type: 'trade.closed', eventId: input.eventId, merchantPopulationId: trade.merchantPopulationId,
    reason: input.reason, completedCommerce: trade.completedCommerce,
  };
  const base: ActiveRun = { ...input.state, activeTrade: null };
  if (input.reason !== 'player' || !trade.completedCommerce
    || population === undefined || population.commerceBonusApplied) {
    return { state: base, events: [closed] };
  }
  const encounter = merchantEncounter(input.content, population.encounterId);
  const faction = merchantFaction(input.content, population.factionId);
  const changed = changeReputation({
    run: base, faction, delta: encounter.definition.commerceReputationDelta,
    reason: 'commerce', eventId: input.eventId,
  });
  return {
    state: {
      ...changed.state,
      populations: replaceMerchantPopulation(changed.state, { ...population, commerceBonusApplied: true }),
    },
    events: [closed, changed.event],
  };
}

/**
 * Normalizes the modal session: when the merchant no longer satisfies the session invariant
 * (ownership, floor, adjacency, visibility, liveness, lifecycle, or relationship), the trade is
 * closed without any commerce bonus. A valid or absent session returns the same state untouched.
 */
export function closeTradeIfInvalid(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const trade = input.state.activeTrade;
  if (trade === null) return { state: input.state, events: [] };
  const session = merchantSession(input.state, input.content, trade.merchantActorId);
  if (session.ok && session.session.population.populationId === trade.merchantPopulationId) {
    return { state: input.state, events: [] };
  }
  return closeTrade({
    state: input.state, content: input.content, eventId: input.eventId,
    reason: session.ok ? 'unavailable' : session.close,
  });
}

/** Applies a validated trade command; the caller (reducer) advances the revision only. */
export function resolveTradeCommand(input: Readonly<{
  state: ActiveRun; command: TradeCommand; content: CompiledContentPack;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { state, command, content } = input;
  if (command.type === 'trade-open') {
    const session = merchantSession(state, content, command.merchantActorId);
    if (!session.ok) throw new Error('internal invariant: trade-open was not validated');
    return {
      state: {
        ...state,
        activeTrade: {
          merchantPopulationId: session.session.population.populationId,
          merchantActorId: session.session.actor.actorId,
          openedByCommandId: command.commandId,
          openedAtRevision: state.revision + 1,
          completedCommerce: false,
        },
      },
      events: [{
        type: 'trade.opened', eventId: command.commandId,
        merchantPopulationId: session.session.population.populationId,
        merchantActorId: session.session.actor.actorId,
      }],
    };
  }
  if (command.type === 'trade-close') {
    return closeTrade({ state, content, eventId: command.commandId, reason: 'player' });
  }
  const plan = planned({ state, content, command });
  if (plan === null || !plan.ok) throw new Error(`internal invariant: ${command.type} was not validated`);
  const trade = state.activeTrade;
  if (trade === null) throw new Error(`internal invariant: ${command.type} requires an active trade`);
  const population = state.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.populationId === trade.merchantPopulationId)!;
  const next: ActiveRun = {
    ...state,
    hero: { ...state.hero, currency: plan.plan.currency },
    items: plan.plan.items,
    populations: replaceMerchantPopulation(state, { ...population, stockItemIds: plan.plan.stockItemIds }),
    activeTrade: { ...trade, completedCommerce: true },
  };
  const commerce = {
    eventId: command.commandId,
    merchantPopulationId: trade.merchantPopulationId,
    itemId: command.itemId,
    contentId: plan.plan.definition.id,
    quantity: command.quantity,
    unitPrice: plan.plan.unitPrice,
    total: plan.plan.total,
    currency: plan.plan.currency,
  } as const;
  return {
    state: next,
    events: [command.type === 'trade-buy'
      ? { type: 'trade.bought', ...commerce }
      : { type: 'trade.sold', ...commerce }],
  };
}
