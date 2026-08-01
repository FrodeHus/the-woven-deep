import type { CompiledContentPack } from '@woven-deep/content';
import type { OfferAction } from './action-types.js';
import {
  scrubActorReferences,
  scrubPopulationReferences,
  scrubRecordedCommands,
} from './actor-removal.js';
import { fallenChampionTemplate } from './haunt-need.js';
import {
  hauntDropItemIdPrefix,
  hauntDropSnapshots,
  materializeDeathInventory,
} from './haunt-rewards.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import type { ChampionPopulation, EchoPopulation } from './population-model.js';
import { setRelationship } from './reactions.js';
import { compareCodeUnits } from './stable-json.js';

function hauntPopulation(state: ActiveRun, actorId: OpaqueId): ChampionPopulation | EchoPopulation {
  const actor = state.actors.find((candidate) => candidate.actorId === actorId);
  const population = state.populations.find(
    (candidate) => candidate.populationId === actor?.populationId,
  );
  if (!population || (population.model !== 'champion' && population.model !== 'echo')) {
    throw new Error(`internal invariant: actor ${actorId} is not a haunt`);
  }
  return population;
}

/**
 * Resolves an accepted offering. Pure and RANDOMNESS-FREE: the offered item is consumed, the
 * hero<->haunt relationship is overridden to `neutral`, the haunt's actor is removed and every
 * reference to it scrubbed, its whole death inventory materializes on its cell, and its decision
 * is marked `appeased` (never `defeated` -- there is no conquest here).
 *
 * An Echo surrenders the same WHOLE set a Champion does. The one-piece rule is what a haunt gives
 * up when it is put down; an offering buys back everything it was holding, which is the entire
 * point of the trade being worth making. Content-bound validation keys the owed set on `appeased`
 * for exactly this reason.
 */
export function resolveOffer(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    action: OfferAction;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { action } = input;
  const population = hauntPopulation(input.state, action.targetActorId);
  const actor = input.state.actors.find((candidate) => candidate.actorId === action.targetActorId);
  const standing = input.state.fallenHeroStandings.find(
    (candidate) => candidate.hallRecordId === population.hallRecordId,
  );
  if (!actor || !standing) {
    throw new Error(
      `internal invariant: haunt population ${population.populationId} is incomplete`,
    );
  }
  const offering = input.state.items.find((item) => item.itemId === action.itemId);
  if (!offering) {
    throw new Error(`internal invariant: offered item ${action.itemId} does not exist`);
  }
  if (!Number.isSafeInteger(offering.quantity) || offering.quantity < 1) {
    throw new RangeError(`offered item ${action.itemId} has an invalid quantity`);
  }

  // The offering goes with the dead: one unit of the stack, never the whole pile.
  let state: ActiveRun = {
    ...input.state,
    items: input.state.items.flatMap((item) =>
      item.itemId === action.itemId
        ? item.quantity > 1
          ? [{ ...item, quantity: item.quantity - 1 }]
          : []
        : [item],
    ),
  };

  // The surrendered-actor hook `reactions.ts` documents: for as long as the haunt is still an
  // actor, the pair reads `neutral` regardless of its hostile disposition. The removal below drops
  // the override again -- a row naming a removed actor fails save validation -- so within this
  // resolution the call is a formality. It stays because the fade and the truce are two separate
  // facts, and a future change that lets a haunt linger a few turns before fading needs the truce
  // to outlive this function.
  state = setRelationship(state, action.actorId, action.targetActorId, 'neutral');

  const itemIdPrefix = hauntDropItemIdPrefix(population.populationId);
  const pieces = materializeDeathInventory({
    content: input.content,
    snapshots: hauntDropSnapshots(standing).snapshots,
    equippedItemContentIds: standing.equippedItemContentIds,
    fallbackItemId: fallenChampionTemplate(input.content).fallbackItemId,
    // The singleton guard: an artifact this run already holds an instance of degrades to the
    // fallback relic rather than being minted a second time.
    existingItems: state.items,
    itemIdPrefix,
    floorId: population.floorId,
    x: actor.x,
    y: actor.y,
  });
  for (const piece of pieces) {
    if (state.items.some((item) => item.itemId === piece.item.itemId)) {
      throw new Error(`Haunt drop ${piece.item.itemId} exists without reward state`);
    }
  }

  state = {
    ...state,
    items: [...state.items, ...pieces.map((piece) => piece.item)].sort((left, right) =>
      compareCodeUnits(left.itemId, right.itemId),
    ),
    actors: state.actors
      .filter((candidate) => candidate.actorId !== action.targetActorId)
      .map((candidate) => scrubActorReferences(candidate, action.targetActorId)),
    // The relationship override is dropped with the actor: it did its work the moment the haunt
    // stopped being a combatant, and a dangling override would fail save validation.
    relationships: state.relationships.filter(
      (relationship) =>
        relationship.leftActorId !== action.targetActorId &&
        relationship.rightActorId !== action.targetActorId,
    ),
    populations: state.populations.map((candidate) =>
      candidate.populationId === population.populationId
        ? {
            ...population,
            livingMemberIds: [],
            formerMemberIds: [action.targetActorId],
            // The reward latch is set even though nothing was DEFEATED: the inventory has already
            // been surrendered, so the defeat-reward path must never fire for this haunt again.
            ...(population.model === 'champion' ? { rewardCreated: true } : { lootCreated: true }),
          }
        : scrubPopulationReferences(candidate, action.targetActorId),
    ),
    recentCommands: scrubRecordedCommands(state.recentCommands, action.targetActorId),
    fallenHeroDecisions: state.fallenHeroDecisions.map((decision) =>
      decision.hallRecordId === population.hallRecordId
        ? { ...decision, encountered: true, appeased: true }
        : decision,
    ),
  };

  return {
    state,
    events: [
      {
        type: 'haunt.appeased',
        eventId: input.eventId,
        actorId: action.targetActorId,
        hallRecordId: population.hallRecordId,
        role: population.model,
        offeredItemId: action.itemId,
        itemIds: pieces.map((piece) => piece.item.itemId),
      },
    ],
  };
}
