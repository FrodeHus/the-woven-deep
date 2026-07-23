import type {
  BalanceContentEntry,
  CompiledContentPack,
  ItemContentEntry,
} from '@woven-deep/content';
import { heroActor, type EquipmentSlot } from './actor-model.js';
import { entryById } from './content-index.js';
import { movementAction } from './movement.js';
import { actorHasConditionTrait } from './conditions.js';
import { dropItem, pickupItem, splitStack } from './inventory.js';
import { floorPerception } from './run-perception.js';
import { validateTarget } from './targeting.js';
import { resolveEffectSequence, resolveEffectSweep } from './effects.js';
import { heroCasterAptitude } from './caster.js';
import { parseEffectParameters } from './parameter-contracts.js';
import { equipItem, refuelItem, toggleItemLight, unequipItem } from './equipment.js';
import { closeDoor, openDoor } from './features.js';
import type {
  ActiveRun,
  DecisionRequiredResult,
  GameCommand,
  InvalidActionReason,
  OpaqueId,
  Point,
} from './model.js';
import { isDispatchableActionType } from './action-dispatch.js';

export interface ResolutionContext {
  readonly content: CompiledContentPack;
}

export interface MoveAction {
  readonly type: 'move';
  readonly actorId: OpaqueId;
  readonly to: Point;
  readonly cost: number;
}

export interface WaitAction {
  readonly type: 'wait';
  readonly actorId: OpaqueId;
  readonly cost: number;
}
export interface SwarmSpawnAction {
  readonly type: 'swarm-spawn';
  readonly actorId: OpaqueId;
  readonly cost: number;
}

export interface BumpAttackAction {
  readonly type: 'bump-attack';
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly cost: number;
}
export interface PickupAction {
  readonly type: 'pickup';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly newItemId: OpaqueId;
  readonly cost: number;
}
export interface DropAction {
  readonly type: 'drop';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly newItemId: OpaqueId;
  readonly cost: number;
}
export interface SplitStackAction {
  readonly type: 'split-stack';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly newItemId: OpaqueId;
  readonly cost: number;
}
export interface FireAction {
  readonly type: 'fire';
  readonly actorId: OpaqueId;
  readonly weaponItemId: OpaqueId;
  readonly ammunitionItemId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly cost: number;
}
export interface ThrowItemAction {
  readonly type: 'throw-item';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly newItemId: OpaqueId;
  readonly target: Point;
  readonly cost: number;
}
export interface UseItemAction {
  readonly type: 'use-item';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly cost: number;
}
export interface CastAction {
  readonly type: 'cast';
  readonly actorId: OpaqueId;
  readonly spellId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly weaveCost: number;
  readonly cost: number;
  readonly aimTarget?: Point;
}
export interface EquipAction {
  readonly type: 'equip';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly slot: EquipmentSlot;
  readonly cost: number;
}
export interface UnequipAction {
  readonly type: 'unequip';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly slot: EquipmentSlot;
  readonly cost: number;
}
export interface ToggleLightAction {
  readonly type: 'toggle-light';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly enabled: boolean;
  readonly cost: number;
}
export interface RefuelAction {
  readonly type: 'refuel';
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly fuelItemId: OpaqueId;
  readonly quantity: number;
  readonly cost: number;
}
export type DoorAction =
  | Readonly<{ type: 'open-door'; actorId: OpaqueId; featureId: OpaqueId; cost: number }>
  | Readonly<{ type: 'close-door'; actorId: OpaqueId; featureId: OpaqueId; cost: number }>;
export interface SearchAction {
  readonly type: 'search';
  readonly actorId: OpaqueId;
  readonly cost: number;
}
export interface FinalChamberChoiceAction {
  readonly type: 'final-chamber-choice';
  readonly actorId: OpaqueId;
  readonly choice: 'become-heart' | 'turn-away' | 'break-cycle';
  readonly cost: number;
}
export interface DisarmAction {
  readonly type: 'disarm';
  readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
  readonly cost: number;
}
export interface PickLockAction {
  readonly type: 'pick-lock';
  readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
  readonly cost: number;
}
export interface RestAction {
  readonly type: 'rest';
  readonly actorId: OpaqueId;
  readonly until: 'healed' | 'interrupted';
  readonly maximumDuration: number;
  readonly cost: number;
}

export type GameAction =
  | MoveAction
  | WaitAction
  | SwarmSpawnAction
  | BumpAttackAction
  | PickupAction
  | DropAction
  | SplitStackAction
  | FireAction
  | ThrowItemAction
  | UseItemAction
  | CastAction
  | EquipAction
  | UnequipAction
  | ToggleLightAction
  | RefuelAction
  | DoorAction
  | SearchAction
  | DisarmAction
  | PickLockAction
  | RestAction
  | FinalChamberChoiceAction;

export interface InvalidActionValidation {
  readonly status: 'invalid';
  readonly reason: InvalidActionReason;
}

export type PlayerActionValidation = GameAction | InvalidActionValidation | DecisionRequiredResult;

export function balanceEntry(content: CompiledContentPack): BalanceContentEntry {
  const entries = content.entries.filter(
    (entry): entry is BalanceContentEntry => entry.kind === 'balance',
  );
  if (entries.length !== 1)
    throw new Error(`internal invariant: expected one balance entry; found ${entries.length}`);
  return entries[0]!;
}

export function actionCostFor(entry: BalanceContentEntry, actionId: string): number {
  const cost = entry.actionCosts[actionId] ?? entry.normalActionCost;
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error(`internal invariant: invalid action cost ${actionId}`);
  return cost;
}

function itemEntry(
  content: CompiledContentPack,
  contentId: OpaqueId,
): ItemContentEntry | undefined {
  const entry = entryById(content, contentId);
  return entry?.kind === 'item' ? entry : undefined;
}

export function targetContext(
  state: ActiveRun,
  actor: ReturnType<typeof heroActor>,
  content: CompiledContentPack,
) {
  const perception = floorPerception({ state, content, actorId: actor.actorId });
  return {
    floor: perception.floor,
    knowledge: perception.knowledge,
    visibilityWords: perception.visibilityWords,
    illumination: perception.illumination,
  };
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
    if (movement.status === 'invalid') return movement;
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
    if (!transition.ok) return { status: 'invalid', reason: transition.reason };
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
