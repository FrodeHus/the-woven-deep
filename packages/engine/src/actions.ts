import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import { entryById } from './content-index.js';
import { directionDelta, movementAction } from './movement.js';
import { actorHasConditionTrait } from './conditions.js';
import { dropItem, pickupItem, splitStack } from './inventory.js';
import { validateTarget } from './targeting.js';
import { resolveEffectSequence, resolveEffectSweep } from './effects.js';
import { heroCasterAptitude, spellLearnTarget } from './caster.js';
import { parseEffectParameters } from './parameter-contracts.js';
import { equipItem, refuelItem, toggleItemLight, unequipItem } from './equipment.js';
import { artifactById } from './commerce.js';
import { closeDoor, openDoor } from './features.js';
import { isTownFloorActive } from './town-floor.js';
import type { ActorState } from './actor-model.js';
import type {
  ActiveRun,
  Direction,
  GameCommand,
  MovementInvalidReason,
  OpaqueId,
} from './model.js';
import { isDispatchableActionType } from './action-dispatch.js';
import type { GameAction, PlayerActionValidation, ResolutionContext } from './action-types.js';
import { actionCostFor, balanceEntry } from './balance.js';
import { targetContext } from './target-context.js';

export type {
  ResolutionContext,
  MoveAction,
  WaitAction,
  SwarmSpawnAction,
  BumpAttackAction,
  PickupAction,
  DropAction,
  SplitStackAction,
  FireAction,
  ThrowItemAction,
  UseItemAction,
  CastAction,
  EquipAction,
  UnequipAction,
  ToggleLightAction,
  RefuelAction,
  DoorAction,
  SearchAction,
  FinalChamberChoiceAction,
  DisarmAction,
  PickLockAction,
  RestAction,
  GameAction,
  InvalidActionValidation,
  PlayerActionValidation,
} from './action-types.js';

export { balanceEntry, actionCostFor } from './balance.js';

function itemEntry(
  content: CompiledContentPack,
  contentId: OpaqueId,
): ItemContentEntry | undefined {
  const entry = entryById(content, contentId);
  return entry?.kind === 'item' ? entry : undefined;
}

export { targetContext };

/**
 * Bump-to-open: a hero move whose target cell holds a closed door resolves as opening that door
 * rather than as a rejected move. The engine decides this so the behavior no longer depends on the
 * client having the door in its projection (an unlit or undiscovered cell sends a raw `move`).
 * Locked doors keep their `blocked.door-locked` rejection, and only the hero reaches this path --
 * non-hero movement is re-validated by `movementAction` inside the dispatcher, which still blocks.
 */
function bumpedClosedDoor(
  state: ActiveRun,
  actor: ActorState,
  direction: Direction,
  reason: MovementInvalidReason,
): OpaqueId | undefined {
  if (reason !== 'blocked.door') return undefined;
  const delta = directionDelta(direction);
  const target = { x: actor.x + delta.x, y: actor.y + delta.y };
  const door = state.features.find(
    (candidate) =>
      candidate.type === 'door' &&
      candidate.state === 'closed' &&
      candidate.floorId === actor.floorId &&
      candidate.x === target.x &&
      candidate.y === target.y,
  );
  if (!door) return undefined;
  // Mirror the explicit command's guard so a door the transition would refuse keeps the
  // movement rejection instead of producing an action the dispatcher cannot apply.
  return openDoor({ run: state, actorId: actor.actorId, featureId: door.featureId }).ok
    ? door.featureId
    : undefined;
}

export function validatePlayerAction(
  input: Readonly<{
    state: ActiveRun;
    command: GameCommand;
    context: ResolutionContext;
  }>,
): PlayerActionValidation {
  if (input.context.content.hash !== input.state.contentHash) {
    throw new Error(
      `internal invariant: content hash ${input.context.content.hash} does not match run ${input.state.contentHash}`,
    );
  }
  const actor = heroActor(input.state);
  const rules = balanceEntry(input.context.content);
  if (actorHasConditionTrait(actor, 'condition-trait.incapacitated', input.context.content)) {
    return { status: 'invalid', reason: 'action.unavailable' };
  }
  if (
    input.command.type === 'trade-open' ||
    input.command.type === 'trade-buy' ||
    input.command.type === 'trade-sell' ||
    input.command.type === 'trade-close'
  ) {
    // Trade commands are modal and revision-only; the reducer dispatches them before this
    // world-step action path, so reaching here means the command cannot become a GameAction.
    return { status: 'invalid', reason: 'action.unavailable' };
  }
  if (input.command.type === 'wait') {
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  }
  if (input.command.type === 'rest') {
    if (
      !Number.isSafeInteger(input.command.maximumDuration) ||
      input.command.maximumDuration <= 0 ||
      input.command.maximumDuration > rules.restMaximumDuration
    ) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'rest',
      actorId: actor.actorId,
      until: input.command.until,
      maximumDuration: input.command.maximumDuration,
      cost: actionCostFor(rules, 'action.wait'),
    };
  }
  if (input.command.type === 'move') {
    if (actorHasConditionTrait(actor, 'condition-trait.prevents-movement', input.context.content)) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
    if (!floor) throw new Error(`internal invariant: active floor ${actor.floorId} is missing`);
    const movement = movementAction({
      actor,
      floor,
      actors: input.state.actors,
      features: input.state.features,
      relationships: input.state.relationships,
      direction: input.command.direction,
      cost: actionCostFor(rules, 'action.move'),
    });
    if (movement.status === 'invalid') {
      const bumped = bumpedClosedDoor(input.state, actor, input.command.direction, movement.reason);
      if (!bumped) return movement;
      return {
        type: 'open-door',
        actorId: actor.actorId,
        featureId: bumped,
        cost: actionCostFor(rules, 'action.open-door'),
      };
    }
    if (movement.status === 'decision_required') {
      return {
        status: 'decision_required',
        commandId: input.command.commandId,
        revision: input.state.revision,
        turn: input.state.turn,
        decision: movement.decision,
      };
    }
    const action: GameAction =
      movement.status === 'move'
        ? { type: 'move', actorId: actor.actorId, to: movement.to, cost: movement.cost }
        : {
            type: 'bump-attack',
            actorId: actor.actorId,
            targetActorId: movement.targetActorId,
            cost: movement.cost,
          };
    return isDispatchableActionType(action.type)
      ? action
      : { status: 'invalid', reason: 'action.unavailable' };
  }
  if (input.command.type === 'attack') {
    const targetActorId = input.command.targetActorId;
    const target = input.state.actors.find((candidate) => candidate.actorId === targetActorId);
    if (
      !target ||
      target.health === 0 ||
      target.floorId !== actor.floorId ||
      Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) !== 1
    ) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'bump-attack',
      actorId: actor.actorId,
      targetActorId: target.actorId,
      cost: actionCostFor(rules, 'action.attack'),
    };
  }
  if (input.command.type === 'pickup') {
    const transition = pickupItem({
      run: input.state,
      content: input.context.content,
      actorId: actor.actorId,
      itemId: input.command.itemId,
      quantity: input.command.quantity,
      newItemId: input.command.commandId,
    });
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    return {
      type: 'pickup',
      actorId: actor.actorId,
      itemId: input.command.itemId,
      quantity: input.command.quantity,
      newItemId: input.command.commandId,
      cost: actionCostFor(rules, 'action.pickup'),
    };
  }
  if (input.command.type === 'drop') {
    const transition = dropItem({
      run: input.state,
      actorId: actor.actorId,
      itemId: input.command.itemId,
      quantity: input.command.quantity,
      newItemId: input.command.commandId,
    });
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    return {
      type: 'drop',
      actorId: actor.actorId,
      itemId: input.command.itemId,
      quantity: input.command.quantity,
      newItemId: input.command.commandId,
      cost: actionCostFor(rules, 'action.drop'),
    };
  }
  if (input.command.type === 'split-stack') {
    const transition = splitStack({
      run: input.state,
      content: input.context.content,
      actorId: actor.actorId,
      itemId: input.command.itemId,
      quantity: input.command.quantity,
      newItemId: input.command.newItemId,
    });
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    return {
      type: 'split-stack',
      actorId: actor.actorId,
      itemId: input.command.itemId,
      quantity: input.command.quantity,
      newItemId: input.command.newItemId,
      cost: actionCostFor(rules, 'action.split-stack'),
    };
  }
  if (input.command.type === 'fire') {
    const command = input.command;
    const weapon = input.state.items.find((item) => item.itemId === command.itemId);
    const definition = weapon ? itemEntry(input.context.content, weapon.contentId) : undefined;
    if (
      !weapon ||
      weapon.location.type !== 'equipped' ||
      weapon.location.actorId !== actor.actorId ||
      !definition?.combat?.damage ||
      !definition.combat.ammunitionTag
    ) {
      return { status: 'invalid', reason: 'item.unavailable' };
    }
    const ammoTag = definition.combat.ammunitionTag;
    const ammunition = input.state.items
      .filter(
        (item) => item.location.type === 'backpack' && item.location.actorId === actor.actorId,
      )
      .filter((item) => {
        const candidate = itemEntry(input.context.content, item.contentId);
        return candidate?.category === 'ammunition' && candidate.tags.includes(ammoTag);
      })
      .sort((left, right) =>
        left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
      )[0];
    if (!ammunition) return { status: 'invalid', reason: 'item.missing' };
    const targetActor = input.state.actors.find(
      (candidate) =>
        candidate.floorId === actor.floorId &&
        candidate.health > 0 &&
        candidate.x === command.target.x &&
        candidate.y === command.target.y,
    );
    if (!targetActor) return { status: 'invalid', reason: 'target.invalid' };
    const perception = targetContext(input.state, actor, input.context.content);
    const target = validateTarget({
      targetingId: 'target.line',
      sourceActor: actor,
      targetActorId: targetActor.actorId,
      target: command.target,
      floor: perception.floor,
      actors: input.state.actors,
      visibilityWords: perception.visibilityWords,
      illumination: perception.illumination,
      range: definition.combat.range,
    });
    if (!target.ok) return { status: 'invalid', reason: target.reason };
    return {
      type: 'fire',
      actorId: actor.actorId,
      weaponItemId: weapon.itemId,
      ammunitionItemId: ammunition.itemId,
      targetActorId: targetActor.actorId,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'throw-item') {
    const command = input.command;
    const source = input.state.items.find((item) => item.itemId === command.itemId);
    if (
      !source ||
      source.location.type !== 'backpack' ||
      source.location.actorId !== actor.actorId
    ) {
      return { status: 'invalid', reason: 'item.unavailable' };
    }
    const transition = dropItem({
      run: input.state,
      actorId: actor.actorId,
      itemId: source.itemId,
      quantity: command.quantity,
      newItemId: command.commandId,
    });
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    const definition = itemEntry(input.context.content, source.contentId);
    if (!definition) return { status: 'invalid', reason: 'item.missing' };
    const perception = targetContext(input.state, actor, input.context.content);
    const target = validateTarget({
      targetingId: 'target.cell',
      sourceActor: actor,
      targetActorId: null,
      target: command.target,
      floor: perception.floor,
      actors: input.state.actors,
      visibilityWords: perception.visibilityWords,
      illumination: perception.illumination,
      range: definition.combat?.range ?? 5,
    });
    if (!target.ok) return { status: 'invalid', reason: target.reason };
    const consumes = definition.effects.filter(
      (effect) => effect.effectId === 'effect.item.consume',
    );
    if (consumes.length > 0) {
      if (
        consumes.length !== 1 ||
        parseEffectParameters(consumes[0]!, 'effect.item.consume').quantity !== command.quantity
      ) {
        return { status: 'invalid', reason: 'item.quantity' };
      }
      const targetActor = input.state.actors.find(
        (candidate) =>
          candidate.floorId === actor.floorId &&
          candidate.health > 0 &&
          candidate.x === command.target.x &&
          candidate.y === command.target.y,
      );
      if (!targetActor) return { status: 'invalid', reason: 'target.invalid' };
      try {
        resolveEffectSequence({
          effects: definition.effects,
          actors: input.state.actors,
          items: input.state.items,
          content: input.context.content,
          sourceActorId: actor.actorId,
          sourceItemId: source.itemId,
          targetActorId: targetActor.actorId,
          effectsState: input.state.rng.effects,
          survival: input.state.survival,
          survivalActorId: input.state.hero.actorId,
          worldTime: input.state.worldTime,
          eventId: command.commandId,
          forceMoveDirection: {
            x: Math.sign(targetActor.x - actor.x),
            y: Math.sign(targetActor.y - actor.y),
          },
          operations: {},
        });
      } catch {
        return { status: 'invalid', reason: 'action.unavailable' };
      }
    }
    return {
      type: 'throw-item',
      actorId: actor.actorId,
      itemId: source.itemId,
      quantity: command.quantity,
      newItemId: command.commandId,
      target: command.target,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'use-item') {
    const command = input.command;
    const source = input.state.items.find((item) => item.itemId === command.itemId);
    const definition = source ? itemEntry(input.context.content, source.contentId) : undefined;
    if (
      !source ||
      source.location.type !== 'backpack' ||
      source.location.actorId !== actor.actorId ||
      !definition ||
      definition.effects.length === 0
    ) {
      return { status: 'invalid', reason: 'item.unavailable' };
    }
    const consumption = definition.effects
      .filter((effect) => effect.effectId === 'effect.item.consume')
      .reduce(
        (total, effect) => total + parseEffectParameters(effect, 'effect.item.consume').quantity,
        0,
      );
    if (!Number.isSafeInteger(consumption) || consumption > source.quantity) {
      return { status: 'invalid', reason: 'item.quantity' };
    }
    // A tome (an item carrying effect.spell.learn) gates on caster aptitude and the already-known
    // spell before any effect applies, so a rejected learn consumes neither the tome nor RNG.
    const learnSpellId = spellLearnTarget(definition.effects);
    if (learnSpellId !== undefined) {
      if (!heroCasterAptitude(input.context.content, input.state.hero)) {
        return { status: 'invalid', reason: 'learn.no-aptitude' };
      }
      if ((input.state.hero.knownSpellIds ?? []).includes(learnSpellId)) {
        return { status: 'invalid', reason: 'learn.already-known' };
      }
    }
    // A scroll (an item carrying spellId but no learn effect) resolves the referenced spell's
    // own targeting/effects instead of the item's target.actor combat targeting, with no Weave
    // cost and no caster-aptitude gate: any class can read a scroll.
    const scrollSpellId = learnSpellId === undefined ? definition.spellId : undefined;
    if (scrollSpellId !== undefined) {
      const spell = entryById(input.context.content, scrollSpellId);
      if (!spell || spell.kind !== 'spell')
        return { status: 'invalid', reason: 'action.unavailable' };
      const perception = targetContext(input.state, actor, input.context.content);
      if (spell.aoe !== undefined) {
        if (command.target === null) return { status: 'invalid', reason: 'target.invalid' };
        const area = validateTarget({
          targetingId: spell.targetingId,
          sourceActor: actor,
          targetActorId: null,
          target: command.target,
          floor: perception.floor,
          actors: input.state.actors,
          visibilityWords: perception.visibilityWords,
          illumination: perception.illumination,
          range: spell.range,
          aoe: spell.aoe,
        });
        if (!area.ok) return { status: 'invalid', reason: area.reason };
        const cellKeys = new Set(area.cells.map((cell) => `${cell.x},${cell.y}`));
        const targetActorIds = input.state.actors
          .filter(
            (entry) =>
              entry.floorId === actor.floorId &&
              entry.health > 0 &&
              entry.actorId !== actor.actorId &&
              cellKeys.has(`${entry.x},${entry.y}`),
          )
          .map((entry) => entry.actorId);
        try {
          // Speculative resolve only: this dry-run must not mutate ActiveRun state or RNG. The
          // commit-time sweep in action-dispatch.ts re-derives the same cells from aimTarget and
          // performs the real mutation.
          resolveEffectSweep({
            effects: spell.effects,
            actors: input.state.actors,
            items: input.state.items,
            content: input.context.content,
            sourceActorId: actor.actorId,
            casterActorId: actor.actorId,
            includeCaster: false,
            targetActorIds,
            effectsState: input.state.rng.effects,
            survival: input.state.survival,
            survivalActorId: input.state.hero.actorId,
            worldTime: input.state.worldTime,
            eventId: command.commandId,
            forceMoveDirection: { x: 1, y: 0 },
            operations: {},
          });
        } catch {
          return { status: 'invalid', reason: 'action.unavailable' };
        }
        return {
          type: 'use-item',
          actorId: actor.actorId,
          itemId: source.itemId,
          targetActorId: actor.actorId,
          cost: definition.actionCost,
          aimTarget: command.target,
        };
      }
      const candidate =
        spell.targetingId === 'target.self'
          ? actor
          : input.state.actors.find(
              (entry) =>
                command.target !== null &&
                entry.floorId === actor.floorId &&
                entry.health > 0 &&
                entry.x === command.target.x &&
                entry.y === command.target.y,
            );
      if (!candidate) return { status: 'invalid', reason: 'target.invalid' };
      const target = validateTarget({
        targetingId: spell.targetingId,
        sourceActor: actor,
        targetActorId: candidate.actorId,
        target: command.target,
        floor: perception.floor,
        actors: input.state.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: spell.range,
      });
      if (!target.ok) return { status: 'invalid', reason: target.reason };
      try {
        resolveEffectSequence({
          effects: spell.effects,
          actors: input.state.actors,
          items: input.state.items,
          content: input.context.content,
          sourceActorId: actor.actorId,
          targetActorId: candidate.actorId,
          effectsState: input.state.rng.effects,
          survival: input.state.survival,
          survivalActorId: input.state.hero.actorId,
          worldTime: input.state.worldTime,
          eventId: command.commandId,
          forceMoveDirection:
            candidate.actorId === actor.actorId
              ? { x: 1, y: 0 }
              : {
                  x: Math.sign(candidate.x - actor.x),
                  y: Math.sign(candidate.y - actor.y),
                },
          operations: {},
        });
      } catch {
        return { status: 'invalid', reason: 'action.unavailable' };
      }
      return {
        type: 'use-item',
        actorId: actor.actorId,
        itemId: source.itemId,
        targetActorId: candidate.actorId,
        cost: definition.actionCost,
      };
    }
    let targetActor = actor;
    if (command.target !== null) {
      const candidate = input.state.actors.find(
        (entry) =>
          entry.floorId === actor.floorId &&
          entry.health > 0 &&
          entry.x === command.target!.x &&
          entry.y === command.target!.y,
      );
      if (!candidate) return { status: 'invalid', reason: 'target.invalid' };
      const perception = targetContext(input.state, actor, input.context.content);
      const target = validateTarget({
        targetingId: 'target.actor',
        sourceActor: actor,
        targetActorId: candidate.actorId,
        target: command.target,
        floor: perception.floor,
        actors: input.state.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: definition.combat?.range ?? 5,
      });
      if (!target.ok) return { status: 'invalid', reason: target.reason };
      targetActor = candidate;
    }
    try {
      resolveEffectSequence({
        effects: definition.effects,
        actors: input.state.actors,
        items: input.state.items,
        content: input.context.content,
        sourceActorId: actor.actorId,
        sourceItemId: source.itemId,
        targetActorId: targetActor.actorId,
        effectsState: input.state.rng.effects,
        survival: input.state.survival,
        survivalActorId: input.state.hero.actorId,
        worldTime: input.state.worldTime,
        eventId: command.commandId,
        forceMoveDirection:
          targetActor.actorId === actor.actorId
            ? { x: 1, y: 0 }
            : {
                x: Math.sign(targetActor.x - actor.x),
                y: Math.sign(targetActor.y - actor.y),
              },
        operations: {},
      });
    } catch {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'use-item',
      actorId: actor.actorId,
      itemId: source.itemId,
      targetActorId: targetActor.actorId,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'cast') {
    const command = input.command;
    const definition = entryById(input.context.content, command.spellId);
    if (!definition || definition.kind !== 'spell') {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    // The Weave gate runs before target resolution: an underpowered cast is rejected without
    // consuming randomness or advancing the world, like the town-truce and concluded rejections.
    if (actor.weave < definition.weaveCost) {
      return { status: 'invalid', reason: 'cast.insufficient-weave' };
    }
    // The aptitude gate runs after the Weave gate but still before any target resolution or RNG:
    // an invalid cast must mutate neither state nor RNG.
    if (
      !heroCasterAptitude(input.context.content, input.state.hero) &&
      actor.actorId === input.state.hero.actorId
    ) {
      return { status: 'invalid', reason: 'cast.no-aptitude' };
    }
    // Defense-in-depth: `resolveCommand`'s town-truce gate already rejects every `cast` in town
    // (with reason `town.truce`) before this function ever runs, so this branch is unreachable
    // through the normal command path. It exists so a recall spell is still rejected correctly if
    // this function is ever called directly, or if the truce gate's command-type list changes.
    if (
      definition.effects.some((effect) => effect.effectId === 'effect.recall') &&
      isTownFloorActive(input.state)
    ) {
      return { status: 'invalid', reason: 'recall.already-town' };
    }
    if (definition.aoe !== undefined) {
      if (command.target === null) return { status: 'invalid', reason: 'target.invalid' };
      const perception = targetContext(input.state, actor, input.context.content);
      const area = validateTarget({
        targetingId: definition.targetingId,
        sourceActor: actor,
        targetActorId: null,
        target: command.target,
        floor: perception.floor,
        actors: input.state.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: definition.range,
        aoe: definition.aoe,
      });
      if (!area.ok) return { status: 'invalid', reason: area.reason };
      const cellKeys = new Set(area.cells.map((cell) => `${cell.x},${cell.y}`));
      const targetActorIds = input.state.actors
        .filter(
          (entry) =>
            entry.floorId === actor.floorId &&
            entry.health > 0 &&
            entry.actorId !== actor.actorId &&
            cellKeys.has(`${entry.x},${entry.y}`),
        )
        .map((entry) => entry.actorId);
      try {
        // Speculative resolve only: this dry-run must not mutate ActiveRun state or RNG. The
        // commit-time sweep in action-dispatch.ts re-derives the same cells from aimTarget and
        // performs the real mutation.
        resolveEffectSweep({
          effects: definition.effects,
          actors: input.state.actors,
          items: input.state.items,
          content: input.context.content,
          sourceActorId: actor.actorId,
          casterActorId: actor.actorId,
          includeCaster: false,
          targetActorIds,
          effectsState: input.state.rng.effects,
          survival: input.state.survival,
          survivalActorId: input.state.hero.actorId,
          worldTime: input.state.worldTime,
          eventId: command.commandId,
          forceMoveDirection: { x: 1, y: 0 },
          operations: {},
        });
      } catch {
        return { status: 'invalid', reason: 'action.unavailable' };
      }
      return {
        type: 'cast',
        actorId: actor.actorId,
        spellId: definition.id,
        targetActorId: actor.actorId,
        weaveCost: definition.weaveCost,
        cost: definition.actionCost,
        aimTarget: command.target,
      };
    }
    const candidate =
      definition.targetingId === 'target.self'
        ? actor
        : input.state.actors.find(
            (entry) =>
              command.target !== null &&
              entry.floorId === actor.floorId &&
              entry.health > 0 &&
              entry.x === command.target.x &&
              entry.y === command.target.y,
          );
    if (!candidate) return { status: 'invalid', reason: 'target.invalid' };
    const perception = targetContext(input.state, actor, input.context.content);
    const target = validateTarget({
      targetingId: definition.targetingId,
      sourceActor: actor,
      targetActorId: candidate.actorId,
      target: command.target,
      floor: perception.floor,
      actors: input.state.actors,
      visibilityWords: perception.visibilityWords,
      illumination: perception.illumination,
      range: definition.range,
    });
    if (!target.ok) return { status: 'invalid', reason: target.reason };
    try {
      resolveEffectSequence({
        effects: definition.effects,
        actors: input.state.actors,
        items: input.state.items,
        content: input.context.content,
        sourceActorId: actor.actorId,
        targetActorId: candidate.actorId,
        effectsState: input.state.rng.effects,
        survival: input.state.survival,
        survivalActorId: input.state.hero.actorId,
        worldTime: input.state.worldTime,
        eventId: command.commandId,
        forceMoveDirection:
          candidate.actorId === actor.actorId
            ? { x: 1, y: 0 }
            : {
                x: Math.sign(candidate.x - actor.x),
                y: Math.sign(candidate.y - actor.y),
              },
        operations: {},
      });
    } catch {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'cast',
      actorId: actor.actorId,
      spellId: definition.id,
      targetActorId: candidate.actorId,
      weaveCost: definition.weaveCost,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'equip') {
    const command = input.command;
    const transition = equipItem({
      run: input.state,
      content: input.context.content,
      actorId: actor.actorId,
      itemId: command.itemId,
      slot: command.slot,
    });
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    const definition = itemEntry(
      input.context.content,
      input.state.items.find((item) => item.itemId === command.itemId)!.contentId,
    )!;
    return {
      type: 'equip',
      actorId: actor.actorId,
      itemId: command.itemId,
      slot: command.slot,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'unequip') {
    const itemId = actor.equipment[input.command.slot];
    const transition = unequipItem({
      run: input.state,
      actorId: actor.actorId,
      slot: input.command.slot,
    });
    if (!transition.ok || !itemId)
      return { status: 'invalid', reason: transition.ok ? 'item.unavailable' : transition.reason };
    const definition = itemEntry(
      input.context.content,
      input.state.items.find((item) => item.itemId === itemId)!.contentId,
    )!;
    return {
      type: 'unequip',
      actorId: actor.actorId,
      itemId,
      slot: input.command.slot,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'toggle-light') {
    const command = input.command;
    const transition = toggleItemLight({
      run: input.state,
      content: input.context.content,
      actorId: actor.actorId,
      itemId: command.itemId,
      enabled: command.enabled,
    });
    // Ownership and reach are judged first: a light the hero does not hold is unavailable, never
    // inextinguishable. An inextinguishable artifact the hero does hold refuses to be hidden once
    // it burns; lighting one stays legal, since heirloom materialization hands it over doused.
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    const held = input.state.items.find((item) => item.itemId === command.itemId);
    if (
      !command.enabled &&
      held?.enabled === true &&
      artifactById(input.context.content, held.contentId)?.light?.inextinguishable === true
    ) {
      return { status: 'invalid', reason: 'light.inextinguishable' };
    }
    const definition = itemEntry(
      input.context.content,
      input.state.items.find((item) => item.itemId === command.itemId)!.contentId,
    )!;
    return {
      type: 'toggle-light',
      actorId: actor.actorId,
      itemId: command.itemId,
      enabled: command.enabled,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'refuel') {
    const command = input.command;
    const transition = refuelItem({
      run: input.state,
      content: input.context.content,
      actorId: actor.actorId,
      itemId: command.itemId,
      fuelItemId: command.fuelItemId,
      quantity: command.quantity,
    });
    if (!transition.ok || transition.quantity === undefined) {
      return { status: 'invalid', reason: transition.ok ? 'item.unavailable' : transition.reason };
    }
    const definition = itemEntry(
      input.context.content,
      input.state.items.find((item) => item.itemId === command.itemId)!.contentId,
    )!;
    return {
      type: 'refuel',
      actorId: actor.actorId,
      itemId: command.itemId,
      fuelItemId: command.fuelItemId,
      quantity: transition.quantity,
      cost: definition.actionCost,
    };
  }
  if (input.command.type === 'open-door' || input.command.type === 'close-door') {
    const transition =
      input.command.type === 'open-door'
        ? openDoor({ run: input.state, actorId: actor.actorId, featureId: input.command.featureId })
        : closeDoor({
            run: input.state,
            actorId: actor.actorId,
            featureId: input.command.featureId,
          });
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
    return {
      type: input.command.type,
      actorId: actor.actorId,
      featureId: input.command.featureId,
      cost: actionCostFor(rules, `action.${input.command.type}`),
    };
  }
  if (input.command.type === 'search') {
    return { type: 'search', actorId: actor.actorId, cost: actionCostFor(rules, 'action.search') };
  }
  if (input.command.type === 'final-chamber-choice') {
    // The Chamber-floor and fragment-set gates run earlier in the reducer (mirroring the
    // town-truce guard), so reaching here means the choice is already known to be legal.
    return {
      type: 'final-chamber-choice',
      actorId: actor.actorId,
      choice: input.command.choice,
      cost: actionCostFor(rules, 'action.final-chamber-choice'),
    };
  }
  if (input.command.type === 'disarm') {
    const featureId = input.command.featureId;
    const feature = input.state.features.find((candidate) => candidate.featureId === featureId);
    if (
      !feature ||
      feature.type !== 'trap' ||
      feature.state !== 'armed' ||
      !feature.discovery.discoveredByActorIds.includes(actor.actorId) ||
      feature.floorId !== actor.floorId ||
      Math.max(Math.abs(feature.x - actor.x), Math.abs(feature.y - actor.y)) !== 1
    ) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'disarm',
      actorId: actor.actorId,
      featureId: feature.featureId,
      cost: actionCostFor(rules, 'action.disarm'),
    };
  }
  if (input.command.type === 'pick-lock') {
    const featureId = input.command.featureId;
    const feature = input.state.features.find((candidate) => candidate.featureId === featureId);
    if (
      !feature ||
      (feature.type !== 'door' && feature.type !== 'chest') ||
      feature.state !== 'locked' ||
      feature.floorId !== actor.floorId ||
      Math.max(Math.abs(feature.x - actor.x), Math.abs(feature.y - actor.y)) !== 1
    ) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    const lock = feature.lock;
    if (!lock) return { status: 'invalid', reason: 'action.unavailable' };
    const held = input.state.items.filter(
      (item) =>
        (item.location.type === 'backpack' || item.location.type === 'equipped') &&
        item.location.actorId === actor.actorId,
    );
    const holdsLockpick = held.some((item) => {
      const entry = entryById(input.context.content, item.contentId);
      return entry?.kind === 'item' && entry.tags.includes('lockpick');
    });
    const holdsKey =
      feature.type === 'door' &&
      lock.keyContentId !== null &&
      held.some((item) => item.contentId === lock.keyContentId);
    if (!holdsLockpick && !holdsKey) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'pick-lock',
      actorId: actor.actorId,
      featureId: feature.featureId,
      cost: actionCostFor(rules, 'action.pick-lock'),
    };
  }
  return { status: 'invalid', reason: 'action.unavailable' };
}
