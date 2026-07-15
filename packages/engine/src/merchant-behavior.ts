import type {
  CompiledContentPack, MerchantEncounterContentEntry, NpcContentEntry, NpcFactionContentEntry,
} from '@woven-deep/content';
import { actionCostFor, balanceEntry, type GameAction } from './actions.js';
import { actorById, type ActorState } from './actor-model.js';
import { changeReputation } from './commerce.js';
import { itemLightSources } from './equipment.js';
import { featureTiles } from './features.js';
import type { ItemInstance } from './item-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import type { ActiveRun, DomainEvent, OpaqueId, Point } from './model.js';
import { findPath, selectPathStep } from './pathfinding.js';
import { refreshKnowledge } from './perception.js';
import { updatePopulationIntent } from './population-intent.js';
import {
  mergeLastKnownTargets, soundTargetObservation, visibleTargetObservations,
} from './population-perception.js';
import { rollDie } from './random.js';
import { relationshipBetween, setRelationship } from './reactions.js';
import { compareCodeUnits } from './stable-json.js';
import { closeTrade } from './trade.js';
import { movementBlockReason } from './terrain.js';

export const MERCHANT_BEHAVIOR_ID = 'npc-behavior.travelling-merchant';

const BPS_DIVISOR = 10_000;

function npcDefinition(content: CompiledContentPack, contentId: OpaqueId): NpcContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'npc') {
    throw new Error(`internal invariant: npc definition ${contentId} does not exist`);
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

function merchantByPopulationId(state: ActiveRun, populationId: OpaqueId): MerchantPopulation | undefined {
  return state.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.populationId === populationId);
}

function merchantByActorId(state: ActiveRun, actorId: OpaqueId): MerchantPopulation | undefined {
  return state.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.actorId === actorId);
}

function replaceMerchantPopulation(
  state: ActiveRun, population: MerchantPopulation,
): readonly ActiveRun['populations'][number][] {
  return state.populations.map((candidate) =>
    candidate.populationId === population.populationId ? population : candidate);
}

function withActor(state: ActiveRun, actor: ActorState): ActiveRun {
  return { ...state, actors: state.actors.map((candidate) => candidate.actorId === actor.actorId ? actor : candidate) };
}

function chebyshev(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

interface ThreatPosition {
  readonly actorId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

/**
 * Known hostile threats: living actors with a hostile relationship that the merchant either
 * currently perceives or remembers (direct damage plants a remembered observation). Positions
 * come from sight when aware, otherwise from the freshest memory on the merchant's floor.
 */
function knownThreats(state: ActiveRun, actor: ActorState): readonly ThreatPosition[] {
  const memories = new Map(actor.behaviorState.lastKnownTargets
    .filter((memory) => memory.floorId === actor.floorId)
    .map((memory) => [memory.targetActorId, memory] as const));
  const threats: ThreatPosition[] = [];
  for (const candidate of state.actors) {
    if (candidate.actorId === actor.actorId || candidate.health <= 0) continue;
    if (relationshipBetween(state, actor.actorId, candidate.actorId) !== 'hostile') continue;
    if (actor.awareActorIds.includes(candidate.actorId) && candidate.floorId === actor.floorId) {
      threats.push({ actorId: candidate.actorId, x: candidate.x, y: candidate.y });
      continue;
    }
    const memory = memories.get(candidate.actorId);
    if (memory) threats.push({ actorId: candidate.actorId, x: memory.x, y: memory.y });
  }
  return threats.sort((left, right) => compareCodeUnits(left.actorId, right.actorId));
}

function belowSelfPreservation(npc: NpcContentEntry, actor: ActorState): boolean {
  return actor.health * BPS_DIVISOR < npc.selfPreservationThresholdBps * actor.maxHealth;
}

type MerchantMode = 'hold' | 'flee' | 'defend';

function merchantMode(input: Readonly<{
  population: MerchantPopulation;
  encounter: MerchantEncounterContentEntry;
  npc: NpcContentEntry;
  actor: ActorState;
  threats: readonly ThreatPosition[];
}>): MerchantMode {
  if (input.threats.length === 0) return 'hold';
  if (input.population.lifecycle === 'fleeing') return 'flee';
  if (belowSelfPreservation(input.npc, input.actor)) return 'flee';
  const response = input.population.lifecycle === 'defending'
    ? 'self-defense' : input.encounter.definition.aggressionResponse;
  return response === 'self-defense' ? 'defend' : 'flee';
}

function selectDefenseTarget(actor: ActorState, threats: readonly ThreatPosition[]): ThreatPosition {
  const savedGoal = actor.behaviorState.goal;
  const saved = savedGoal?.type === 'actor'
    ? threats.find((threat) => threat.actorId === savedGoal.targetActorId) : undefined;
  if (saved) return saved;
  return [...threats].sort((left, right) => chebyshev(actor, left) - chebyshev(actor, right)
    || compareCodeUnits(left.actorId, right.actorId))[0]!;
}

/**
 * Updates the merchant's perception, threat memory, and saved intent before its scheduled turn.
 * Awareness spans every perceived actor; only hostile observations enter threat memory, so a
 * neutral bystander never becomes something the merchant flees from.
 */
export function prepareMerchantTurn(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; actorId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const population = merchantByActorId(input.state, actor.actorId);
  if (!population) throw new Error(`internal invariant: merchant population for ${input.actorId} does not exist`);
  const npc = npcDefinition(input.content, actor.contentId);
  const encounter = merchantEncounter(input.content, population.encounterId);
  const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${actor.floorId} does not exist`);
  const positions = new Map<string, Readonly<Point>>(floor.entities.map((entity) => [entity.entityId, entity] as const));
  const floorActors = input.state.actors.filter((candidate) => candidate.floorId === floor.floorId && candidate.health > 0);
  for (const candidate of floorActors) positions.set(candidate.actorId, candidate);
  const perception = refreshKnowledge({
    floor: { ...floor, tiles: featureTiles(input.state, floor.floorId) },
    hero: { heroId: actor.actorId, x: actor.x, y: actor.y, sightRadius: npc.perception },
    actors: positions,
    additionalLights: itemLightSources({ run: input.state, content: input.content, floorId: floor.floorId }),
  });
  const observations = visibleTargetObservations({
    observerActorId: actor.actorId, floorId: floor.floorId, width: floor.width,
    visibilityWords: perception.visibilityWords, illuminationIntensity: perception.illumination.intensity,
    observedAt: input.state.worldTime, actors: floorActors,
  });
  const awareActorIds = observations.map((observation) => observation.targetActorId).sort(compareCodeUnits);
  const hostileObservations = observations.filter((observation) =>
    relationshipBetween(input.state, actor.actorId, observation.targetActorId) === 'hostile');
  const lastKnownTargets = hostileObservations.length === 0 ? actor.behaviorState.lastKnownTargets
    : mergeLastKnownTargets(actor.behaviorState.lastKnownTargets, hostileObservations);
  const observed: ActorState = {
    ...actor, awareActorIds,
    behaviorState: { ...actor.behaviorState, lastKnownTargets },
  };
  const threats = knownThreats(input.state, observed);
  const mode = merchantMode({ population, encounter, npc, actor: observed, threats });
  const target = mode === 'defend' ? selectDefenseTarget(observed, threats) : undefined;
  const goal = target === undefined ? null : { type: 'actor' as const, targetActorId: target.actorId };
  const intent = mode === 'hold' ? 'hold' : mode === 'flee' ? 'flee'
    : chebyshev(observed, target!) === 1 ? 'attack' : 'approach';
  const updated = updatePopulationIntent({
    eventId: input.eventId, actorId: actor.actorId,
    state: { ...observed.behaviorState, goal }, intent,
    targetCategory: goal === null ? null : goal.targetActorId === input.state.hero.actorId ? 'hero' : null,
  });
  return {
    state: withActor(input.state, { ...observed, behaviorState: updated.state }),
    events: updated.event ? [updated.event] : [],
  };
}

/**
 * Resolves the merchant's scheduled turn: hold when no hostile threat is known; under the
 * authored self-defense response (or the provoked defending lifecycle) approach and attack the
 * nearest known hostile threat; otherwise — and always below the authored self-preservation
 * threshold — flee along the candidate step with the greatest Chebyshev distance from threats.
 */
export function merchantBehaviorAction(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; actorId: OpaqueId;
}>): GameAction {
  const actor = actorById(input.state, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const population = merchantByActorId(input.state, actor.actorId);
  if (!population) throw new Error(`internal invariant: merchant population for ${input.actorId} does not exist`);
  const rules = balanceEntry(input.content);
  const wait: GameAction = { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  const npc = npcDefinition(input.content, actor.contentId);
  const encounter = merchantEncounter(input.content, population.encounterId);
  const threats = knownThreats(input.state, actor);
  const mode = merchantMode({ population, encounter, npc, actor, threats });
  if (mode === 'hold') return wait;
  const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
  if (!floor) throw new Error(`internal invariant: actor floor ${actor.floorId} does not exist`);
  const tiles = featureTiles(input.state, floor.floorId);
  const occupied = new Set(input.state.actors.filter((candidate) => candidate.actorId !== actor.actorId
    && candidate.floorId === actor.floorId && candidate.health > 0)
    .map((candidate) => `${candidate.x}:${candidate.y}`));
  const passable = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < floor.width && y < floor.height
    && movementBlockReason(tiles[y * floor.width + x]!) === undefined;
  if (mode === 'defend') {
    const target = selectDefenseTarget(actor, threats);
    const live = actorById(input.state, target.actorId);
    const destination = live !== undefined && live.floorId === actor.floorId
      && actor.awareActorIds.includes(target.actorId) ? { x: live.x, y: live.y } : { x: target.x, y: target.y };
    if (chebyshev(actor, destination) === 1) {
      return {
        type: 'bump-attack', actorId: actor.actorId, targetActorId: target.actorId,
        cost: actionCostFor(rules, 'action.attack'),
      };
    }
    const path = findPath({
      width: floor.width, height: floor.height, topology: 8,
      origin: { x: actor.x, y: actor.y }, destination,
      isPassable: (x, y) => passable(x, y)
        && ((x === destination.x && y === destination.y) || !occupied.has(`${x}:${y}`)),
    });
    const selected = selectPathStep(path);
    if (selected.status === 'move') {
      return { type: 'move', actorId: actor.actorId, to: selected.step, cost: actionCostFor(rules, 'action.move') };
    }
    return wait;
  }
  // Flee: score every valid candidate step (including standing still) by its distance from the
  // nearest threat; the greatest distance wins, tie-broken by stable cell order.
  const candidates: Point[] = [{ x: actor.x, y: actor.y }];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = actor.x + dx;
      const y = actor.y + dy;
      if (!passable(x, y) || occupied.has(`${x}:${y}`)) continue;
      if (dx !== 0 && dy !== 0 && !passable(actor.x + dx, actor.y) && !passable(actor.x, actor.y + dy)) continue;
      candidates.push({ x, y });
    }
  }
  candidates.sort((left, right) => (left.y * floor.width + left.x) - (right.y * floor.width + right.x));
  let best = { x: actor.x, y: actor.y };
  let bestScore = Math.min(...threats.map((threat) => chebyshev({ x: actor.x, y: actor.y }, threat)));
  for (const candidate of candidates) {
    const score = Math.min(...threats.map((threat) => chebyshev(candidate, threat)));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best.x === actor.x && best.y === actor.y) return wait;
  return { type: 'move', actorId: actor.actorId, to: best, cost: actionCostFor(rules, 'action.move') };
}

function rememberThreat(state: ActiveRun, merchant: MerchantPopulation, sourceActorId: OpaqueId): ActiveRun {
  const actor = actorById(state, merchant.actorId);
  const source = actorById(state, sourceActorId);
  if (!actor || !source || sourceActorId === merchant.actorId) return state;
  return withActor(state, {
    ...actor,
    behaviorState: {
      ...actor.behaviorState,
      lastKnownTargets: mergeLastKnownTargets(actor.behaviorState.lastKnownTargets, [soundTargetObservation({
        observerActorId: actor.actorId, targetActorId: sourceActorId,
        floorId: source.floorId, x: source.x, y: source.y, observedAt: state.worldTime,
      })]),
    },
  });
}

/**
 * One-time hero provocation. Closes an active trade with the aggression reason, applies the
 * authored aggression reputation delta exactly once, makes the source hostile, switches the
 * lifecycle to the authored response, and resolves the deterministic one-time stock loss:
 * `ceil(totalUnits * stockDropFraction)` units chosen by a merchant-runtime permutation, split
 * under `item.<populationId>.drop.<sequence>` identifiers, dropped at the merchant cell.
 */
export function provokeMerchant(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack;
  merchantPopulationId: OpaqueId; sourceActorId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const population = merchantByPopulationId(input.state, input.merchantPopulationId);
  if (!population) throw new Error(`internal invariant: merchant population ${input.merchantPopulationId} does not exist`);
  if (population.provoked || population.lifecycle === 'dead' || population.lifecycle === 'departed') {
    return { state: input.state, events: [] };
  }
  const actor = actorById(input.state, population.actorId);
  if (!actor) throw new Error(`internal invariant: merchant actor ${population.actorId} does not exist`);
  const encounter = merchantEncounter(input.content, population.encounterId);
  const faction = merchantFaction(input.content, population.factionId);
  let state = input.state;
  const events: DomainEvent[] = [];
  if (state.activeTrade?.merchantPopulationId === population.populationId) {
    const closed = closeTrade({ state, content: input.content, eventId: input.eventId, reason: 'aggression' });
    state = closed.state;
    events.push(...closed.events);
  }
  const changed = changeReputation({
    run: state, faction, delta: encounter.definition.aggressionReputationDelta,
    reason: 'aggression', eventId: input.eventId,
  });
  state = changed.state;
  events.push(changed.event);
  if (input.sourceActorId !== population.actorId
    && relationshipBetween(state, input.sourceActorId, population.actorId) !== 'hostile') {
    state = setRelationship(state, input.sourceActorId, population.actorId, 'hostile');
    events.push({
      type: 'relationship.changed', eventId: input.eventId, actorId: input.sourceActorId,
      targetActorId: population.actorId, relationship: 'hostile',
    });
  }
  state = rememberThreat(state, population, input.sourceActorId);
  const response = encounter.definition.aggressionResponse;
  events.push({
    type: 'merchant.provoked', eventId: input.eventId, populationId: population.populationId,
    actorId: population.actorId, sourceActorId: input.sourceActorId, response,
  });

  const stockItems = state.items
    .filter((candidate) => candidate.location.type === 'merchant-stock'
      && candidate.location.populationId === population.populationId)
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
  const totalUnits = stockItems.reduce((total, candidate) => total + candidate.quantity, 0);
  const fraction = encounter.definition.stockDropFraction;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError(`merchant stock drop fraction ${fraction} is outside [0, 1]`);
  }
  const dropCount = Math.min(totalUnits, Math.ceil(totalUnits * fraction));
  let runtimeState = state.rng['merchant-runtime'];
  const droppedPerItem = new Map<OpaqueId, number>();
  if (dropCount >= totalUnits) {
    for (const candidate of stockItems) droppedPerItem.set(candidate.itemId, candidate.quantity);
  } else if (dropCount > 0) {
    // Deterministic permutation of the flattened unit list from the merchant-runtime stream.
    const order = Array.from({ length: totalUnits }, (_, index) => index);
    for (let index = totalUnits - 1; index > 0; index -= 1) {
      const roll = rollDie(runtimeState, index + 1);
      runtimeState = roll.state;
      const swap = roll.value - 1;
      const held = order[index]!;
      order[index] = order[swap]!;
      order[swap] = held;
    }
    const selected = new Set(order.slice(0, dropCount));
    let cursor = 0;
    for (const candidate of stockItems) {
      let count = 0;
      for (let unit = 0; unit < candidate.quantity; unit += 1) {
        if (selected.has(cursor + unit)) count += 1;
      }
      cursor += candidate.quantity;
      if (count > 0) droppedPerItem.set(candidate.itemId, count);
    }
  }
  const dropLocation = { type: 'floor' as const, floorId: actor.floorId, x: actor.x, y: actor.y };
  const droppedItemIds: OpaqueId[] = [];
  let sequence = 0;
  const items: ItemInstance[] = [];
  for (const candidate of state.items) {
    const dropped = droppedPerItem.get(candidate.itemId);
    if (dropped === undefined || candidate.location.type !== 'merchant-stock'
      || candidate.location.populationId !== population.populationId) {
      items.push(candidate);
      continue;
    }
    if (dropped >= candidate.quantity) {
      items.push({ ...candidate, location: dropLocation });
      droppedItemIds.push(candidate.itemId);
      continue;
    }
    sequence += 1;
    const dropId = `item.${population.populationId}.drop.${String(sequence).padStart(6, '0')}`;
    items.push({ ...candidate, quantity: candidate.quantity - dropped });
    items.push({ ...candidate, itemId: dropId, quantity: dropped, location: dropLocation });
    droppedItemIds.push(dropId);
  }
  items.sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
  droppedItemIds.sort(compareCodeUnits);
  const stockItemIds = items
    .filter((candidate) => candidate.location.type === 'merchant-stock'
      && candidate.location.populationId === population.populationId)
    .map((candidate) => candidate.itemId)
    .sort(compareCodeUnits);
  const provoked: MerchantPopulation = {
    ...population, provoked: true, aggressionPenaltyApplied: true, stockLossResolved: true,
    lifecycle: response === 'self-defense' ? 'defending' : 'fleeing',
    stockItemIds,
  };
  state = {
    ...state,
    items,
    rng: { ...state.rng, 'merchant-runtime': runtimeState },
    populations: replaceMerchantPopulation(state, provoked),
  };
  events.push({
    type: 'merchant.stock-dropped', eventId: input.eventId, populationId: population.populationId,
    actorId: population.actorId, itemIds: droppedItemIds, units: dropCount,
  });
  return { state, events };
}

/**
 * Death consequences: closes an active trade with the death reason, applies the authored death
 * reputation delta at most once and only when the hero is credited as killer, destroys every
 * held stock item (never dropped), moves the actor to former membership, and marks the
 * population dead.
 */
export function resolveMerchantDeath(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack;
  merchantPopulationId: OpaqueId; killerActorId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const population = merchantByPopulationId(input.state, input.merchantPopulationId);
  if (!population) throw new Error(`internal invariant: merchant population ${input.merchantPopulationId} does not exist`);
  if (population.lifecycle === 'dead' || population.lifecycle === 'departed') {
    return { state: input.state, events: [] };
  }
  let state = input.state;
  const events: DomainEvent[] = [];
  if (state.activeTrade?.merchantPopulationId === population.populationId) {
    const closed = closeTrade({ state, content: input.content, eventId: input.eventId, reason: 'death' });
    state = closed.state;
    events.push(...closed.events);
  }
  if (input.killerActorId === state.hero.actorId && !population.deathPenaltyApplied) {
    const encounter = merchantEncounter(input.content, population.encounterId);
    const faction = merchantFaction(input.content, population.factionId);
    const changed = changeReputation({
      run: state, faction, delta: encounter.definition.deathReputationDelta,
      reason: 'death', eventId: input.eventId,
    });
    state = changed.state;
    events.push(changed.event);
  }
  const destroyedStockItemIds = state.items
    .filter((candidate) => candidate.location.type === 'merchant-stock'
      && candidate.location.populationId === population.populationId)
    .map((candidate) => candidate.itemId)
    .sort(compareCodeUnits);
  const dead: MerchantPopulation = {
    ...population, lifecycle: 'dead', livingMemberIds: [], formerMemberIds: [population.actorId],
    stockItemIds: [], deathPenaltyApplied: true, stockLossResolved: true,
  };
  state = {
    ...state,
    items: state.items.filter((candidate) => !(candidate.location.type === 'merchant-stock'
      && candidate.location.populationId === population.populationId)),
    populations: replaceMerchantPopulation(state, dead),
  };
  events.push({
    type: 'merchant.died', eventId: input.eventId, populationId: population.populationId,
    actorId: population.actorId, killerActorId: input.killerActorId, destroyedStockItemIds,
  });
  return { state, events };
}

/**
 * Post-action boundary: scans resolved combat events for merchant consequences. The first
 * hero-sourced damage to an unprovoked merchant provokes it (covering ranged and effect
 * damage; explicit adjacent attacks provoke before resolution). Monster-sourced damage makes
 * the attacker a remembered hostile threat with NO hero reputation or stock consequence.
 * A merchant death resolves its one-time death consequences.
 */
export function resolveMerchantCombatOutcomes(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack;
  events: readonly DomainEvent[]; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  let state = input.state;
  const events: DomainEvent[] = [];
  for (const event of input.events) {
    if (event.type === 'actor.damaged') {
      const population = merchantByActorId(state, event.actorId);
      if (!population || population.lifecycle === 'dead' || population.lifecycle === 'departed') continue;
      if (event.sourceActorId === population.actorId) continue;
      if (event.sourceActorId === state.hero.actorId) {
        if (population.provoked) continue;
        const provoked = provokeMerchant({
          state, content: input.content, merchantPopulationId: population.populationId,
          sourceActorId: event.sourceActorId, eventId: input.eventId,
        });
        state = provoked.state;
        events.push(...provoked.events);
        continue;
      }
      if (actorById(state, event.sourceActorId) === undefined) continue;
      if (relationshipBetween(state, event.sourceActorId, population.actorId) !== 'hostile') {
        state = setRelationship(state, event.sourceActorId, population.actorId, 'hostile');
        events.push({
          type: 'relationship.changed', eventId: input.eventId, actorId: event.sourceActorId,
          targetActorId: population.actorId, relationship: 'hostile',
        });
      }
      state = rememberThreat(state, population, event.sourceActorId);
    } else if (event.type === 'actor.died') {
      const population = merchantByActorId(state, event.actorId);
      if (!population || population.lifecycle === 'dead' || population.lifecycle === 'departed') continue;
      const death = resolveMerchantDeath({
        state, content: input.content, merchantPopulationId: population.populationId,
        killerActorId: event.killerActorId, eventId: input.eventId,
      });
      state = death.state;
      events.push(...death.events);
    }
  }
  return { state, events };
}
