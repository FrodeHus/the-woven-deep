import type { BalanceContentEntry, CompiledContentPack } from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import { movementAction } from './movement.js';
import { actorHasConditionTrait } from './conditions.js';
import type {
  ActiveRun, DecisionRequiredResult, GameCommand, InvalidActionReason, OpaqueId, Point,
} from './model.js';

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

export interface BumpAttackAction {
  readonly type: 'bump-attack';
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly cost: number;
}

export type GameAction = MoveAction | WaitAction | BumpAttackAction;
export type ActionResolverRegistry = Readonly<Partial<Record<GameAction['type'], true>>>;
export const ACTION_RESOLVER_REGISTRY: ActionResolverRegistry = Object.freeze({
  move: true, wait: true, 'bump-attack': true,
});

export interface InvalidActionValidation {
  readonly status: 'invalid';
  readonly reason: InvalidActionReason;
}

export type PlayerActionValidation = GameAction | InvalidActionValidation | DecisionRequiredResult;

export function balanceEntry(content: CompiledContentPack): BalanceContentEntry {
  const entries = content.entries.filter((entry): entry is BalanceContentEntry => entry.kind === 'balance');
  if (entries.length !== 1) throw new Error(`internal invariant: expected one balance entry; found ${entries.length}`);
  return entries[0]!;
}

export function actionCostFor(entry: BalanceContentEntry, actionId: string): number {
  const cost = entry.actionCosts[actionId] ?? entry.normalActionCost;
  if (!Number.isSafeInteger(cost) || cost < 0) throw new Error(`internal invariant: invalid action cost ${actionId}`);
  return cost;
}

export function validatePlayerAction(input: Readonly<{
  state: ActiveRun;
  command: GameCommand;
  context: ResolutionContext;
}>): PlayerActionValidation {
  if (input.context.content.hash !== input.state.contentHash) {
    throw new Error(`internal invariant: content hash ${input.context.content.hash} does not match run ${input.state.contentHash}`);
  }
  const actor = heroActor(input.state);
  const rules = balanceEntry(input.context.content);
  if (actorHasConditionTrait(actor, 'condition-trait.incapacitated', input.context.content)) {
    return { status: 'invalid', reason: 'action.unavailable' };
  }
  if (input.command.type === 'wait') {
    return { type: 'wait', actorId: actor.actorId, cost: actionCostFor(rules, 'action.wait') };
  }
  if (input.command.type === 'move') {
    if (actorHasConditionTrait(actor, 'condition-trait.prevents-movement', input.context.content)) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    const floor = input.state.floors.find((candidate) => candidate.floorId === actor.floorId);
    if (!floor) throw new Error(`internal invariant: active floor ${actor.floorId} is missing`);
    const movement = movementAction({
      actor, floor, actors: input.state.actors, features: input.state.features,
      relationships: input.state.relationships, direction: input.command.direction,
      cost: actionCostFor(rules, 'action.move'),
    });
    if (movement.status === 'invalid') return movement;
    if (movement.status === 'decision_required') {
      return {
        status: 'decision_required', commandId: input.command.commandId, revision: input.state.revision,
        turn: input.state.turn, decision: movement.decision,
      };
    }
    const action: GameAction = movement.status === 'move'
      ? { type: 'move', actorId: actor.actorId, to: movement.to, cost: movement.cost }
      : { type: 'bump-attack', actorId: actor.actorId, targetActorId: movement.targetActorId, cost: movement.cost };
    return ACTION_RESOLVER_REGISTRY[action.type] ? action : { status: 'invalid', reason: 'action.unavailable' };
  }
  if (input.command.type === 'attack') {
    const targetActorId = input.command.targetActorId;
    const target = input.state.actors.find((candidate) => candidate.actorId === targetActorId);
    if (!target || target.health === 0 || target.floorId !== actor.floorId
      || Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) !== 1) {
      return { status: 'invalid', reason: 'action.unavailable' };
    }
    return {
      type: 'bump-attack', actorId: actor.actorId, targetActorId: target.actorId,
      cost: actionCostFor(rules, 'action.attack'),
    };
  }
  return { status: 'invalid', reason: 'action.unavailable' };
}
