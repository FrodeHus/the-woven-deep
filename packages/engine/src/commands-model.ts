import type { OpaqueId, Direction, Point } from './model.js';
import type { EquipmentSlot } from './actor-model.js';
import type { MerchantServiceId } from '@woven-deep/content';

export interface CommandEnvelope {
  readonly commandId: OpaqueId;
  readonly expectedRevision: number;
}

export interface MoveCommand extends CommandEnvelope {
  readonly type: 'move';
  readonly direction: Direction;
}

export interface WaitCommand extends CommandEnvelope {
  readonly type: 'wait';
}

export interface AttackCommand extends CommandEnvelope {
  readonly type: 'attack';
  readonly targetActorId: OpaqueId;
}
export interface FireCommand extends CommandEnvelope {
  readonly type: 'fire';
  readonly itemId: OpaqueId;
  readonly target: Point;
}
export interface CastCommand extends CommandEnvelope {
  readonly type: 'cast';
  readonly spellId: OpaqueId;
  readonly target: Point | null;
}
export interface ThrowItemCommand extends CommandEnvelope {
  readonly type: 'throw-item';
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly target: Point;
}
export interface UseItemCommand extends CommandEnvelope {
  readonly type: 'use-item';
  readonly itemId: OpaqueId;
  readonly target: Point | null;
}
export interface EquipCommand extends CommandEnvelope {
  readonly type: 'equip';
  readonly itemId: OpaqueId;
  readonly slot: EquipmentSlot;
}
export interface UnequipCommand extends CommandEnvelope {
  readonly type: 'unequip';
  readonly slot: EquipmentSlot;
}
export interface PickupCommand extends CommandEnvelope {
  readonly type: 'pickup';
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface DropCommand extends CommandEnvelope {
  readonly type: 'drop';
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface SplitStackCommand extends CommandEnvelope {
  readonly type: 'split-stack';
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly newItemId: OpaqueId;
}
export interface RefuelCommand extends CommandEnvelope {
  readonly type: 'refuel';
  readonly itemId: OpaqueId;
  readonly fuelItemId: OpaqueId;
  readonly quantity: number;
}
export interface ToggleLightCommand extends CommandEnvelope {
  readonly type: 'toggle-light';
  readonly itemId: OpaqueId;
  readonly enabled: boolean;
}
export interface OpenDoorCommand extends CommandEnvelope {
  readonly type: 'open-door';
  readonly featureId: OpaqueId;
}
export interface CloseDoorCommand extends CommandEnvelope {
  readonly type: 'close-door';
  readonly featureId: OpaqueId;
}
export interface SearchCommand extends CommandEnvelope {
  readonly type: 'search';
}
export interface FinalChamberChoiceCommand extends CommandEnvelope {
  readonly type: 'final-chamber-choice';
  readonly choice: 'become-heart' | 'turn-away' | 'break-cycle';
}
export interface DisarmCommand extends CommandEnvelope {
  readonly type: 'disarm';
  readonly featureId: OpaqueId;
}
export interface PickLockCommand extends CommandEnvelope {
  readonly type: 'pick-lock';
  readonly featureId: OpaqueId;
}
export interface RestCommand extends CommandEnvelope {
  readonly type: 'rest';
  readonly until: 'healed' | 'interrupted';
  readonly maximumDuration: number;
}

export interface TradeOpenCommand extends CommandEnvelope {
  readonly type: 'trade-open';
  readonly merchantActorId: OpaqueId;
}
export interface TradeBuyCommand extends CommandEnvelope {
  readonly type: 'trade-buy';
  readonly merchantPopulationId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface TradeSellCommand extends CommandEnvelope {
  readonly type: 'trade-sell';
  readonly merchantPopulationId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface TradeServiceCommand extends CommandEnvelope {
  readonly type: 'trade-service';
  readonly merchantPopulationId: OpaqueId;
  readonly serviceId: MerchantServiceId;
  /** `null` for a service that has no single target item (e.g. a strongbox transaction). */
  readonly targetItemId: OpaqueId | null;
}
export interface TradeCloseCommand extends CommandEnvelope {
  readonly type: 'trade-close';
  readonly merchantPopulationId: OpaqueId;
}

export type TradeCommand =
  TradeOpenCommand | TradeBuyCommand | TradeSellCommand | TradeServiceCommand | TradeCloseCommand;

export interface HouseDepositCommand extends CommandEnvelope {
  readonly type: 'house-deposit';
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface HouseWithdrawCommand extends CommandEnvelope {
  readonly type: 'house-withdraw';
  readonly itemId: OpaqueId;
  readonly quantity: number;
}

export type HouseCommand = HouseDepositCommand | HouseWithdrawCommand;

export type GameCommand =
  | MoveCommand
  | WaitCommand
  | AttackCommand
  | FireCommand
  | CastCommand
  | ThrowItemCommand
  | UseItemCommand
  | EquipCommand
  | UnequipCommand
  | PickupCommand
  | DropCommand
  | SplitStackCommand
  | RefuelCommand
  | ToggleLightCommand
  | OpenDoorCommand
  | CloseDoorCommand
  | SearchCommand
  | DisarmCommand
  | PickLockCommand
  | RestCommand
  | TradeCommand
  | HouseCommand
  | FinalChamberChoiceCommand;

export type MovementInvalidReason =
  | 'blocked.bounds'
  | 'blocked.wall'
  | 'blocked.door'
  | 'blocked.chest'
  | 'blocked.pillar'
  | 'blocked.void'
  | 'blocked.corner'
  | 'blocked.actor';
export type TradeInvalidReason =
  | 'trade.active'
  | 'trade.required'
  | 'merchant.unavailable'
  | 'merchant.out-of-range'
  | 'merchant.refuses'
  | 'trade.merchant-mismatch'
  | 'trade.insufficient-funds'
  | 'trade.stock-unavailable'
  | 'trade.item-unacceptable'
  | 'trade.capacity'
  | 'trade.service-unavailable'
  | 'trade.target-invalid';
export type TownInvalidReason = 'town.truce' | 'town.rest' | 'house.full';
export type DoorInvalidReason =
  | 'door.missing'
  | 'door.not-adjacent'
  | 'door.locked'
  | 'door.already-open'
  | 'door.already-closed'
  | 'door.occupied';
export type InvalidActionReason =
  | MovementInvalidReason
  | TradeInvalidReason
  | TownInvalidReason
  | DoorInvalidReason
  | 'action.unavailable'
  | 'inventory.full'
  | 'item.missing'
  | 'item.unavailable'
  | 'item.quantity'
  | 'item.incompatible'
  | 'item.id-conflict'
  | 'target.not_visible'
  | 'target.out_of_range'
  | 'target.blocked'
  | 'target.invalid'
  | 'cast.insufficient-weave'
  | 'run.concluded'
  | 'final-chamber.unavailable'
  | 'final-chamber.fragments-required'
  | 'final-chamber.boss-active';
