import type { CompiledContentPack } from '@woven-deep/content';
import type { EquipmentSlot } from './actor-model.js';
import type { DecisionRequiredResult, InvalidActionReason, OpaqueId, Point } from './model.js';

/**
 * `GameAction` and friends split out of `actions.ts` so `action-dispatch.ts` can reference them
 * without importing `actions.ts` itself (which imports `action-dispatch.ts`'s
 * `isDispatchableActionType`) -- that back-edge is what used to make the two files, and everything
 * `action-dispatch.ts` calls into (`combat-profile.ts`, `merchant-behavior.ts`, `stats.ts`,
 * `swarm-behavior.ts`), a runtime circular dependency cluster. `actions.ts` re-exports every type
 * here so its own existing exports are unchanged.
 */

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
  readonly aimTarget?: Point;
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
export interface OfferAction {
  readonly type: 'offer';
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly cost: number;
}
export interface OpenChestAction {
  readonly type: 'open-chest';
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
  | OpenChestAction
  | OfferAction
  | RestAction
  | FinalChamberChoiceAction;

export interface InvalidActionValidation {
  readonly status: 'invalid';
  readonly reason: InvalidActionReason;
}

export type PlayerActionValidation = GameAction | InvalidActionValidation | DecisionRequiredResult;
