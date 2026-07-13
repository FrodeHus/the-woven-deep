import type { RngStreamName } from './versions.js';
import type { FloorKnowledge } from './knowledge.js';
import type { AmbientLight, LightSource } from './light-model.js';
import type { ActorState, EquipmentSlot, RelationshipOverride } from './actor-model.js';
import type { DungeonFeature } from './feature-model.js';
import type { IdentificationState, ItemInstance } from './item-model.js';
import type { HungerStage, SurvivalState } from './survival-model.js';
import type { DamageType } from '@woven-deep/content';

export type OpaqueId = string;
export type Uint32State = readonly [number, number, number, number];
export type RngStreams = Readonly<Record<RngStreamName, Uint32State>>;
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Direction = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
export interface Point { readonly x: number; readonly y: number }

export interface FloorEntityPosition {
  readonly entityId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface FloorSnapshot {
  readonly floorId: OpaqueId;
  readonly seed: Uint32State;
  readonly generatorVersion: 1 | 2;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly tiles: readonly TileId[];
  readonly entities: readonly FloorEntityPosition[];
  readonly themeId: OpaqueId;
  readonly ambient: AmbientLight;
  readonly knowledge: FloorKnowledge;
  readonly lights: readonly LightSource[];
  readonly stairUp: Readonly<{ x: number; y: number }> | null;
  readonly stairDown: Readonly<{ x: number; y: number }> | null;
  readonly vaults: readonly VaultPlacement[];
  readonly placementSlots: readonly FloorPlacementSlot[];
}

export interface VaultPlacement {
  readonly placementId: OpaqueId;
  readonly vaultId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly reflected: boolean;
  readonly entrances: readonly Readonly<{ x: number; y: number }>[];
}

export interface FloorPlacementSlot {
  readonly slotId: OpaqueId;
  readonly vaultPlacementId: OpaqueId;
  readonly kind: 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective';
  readonly required: boolean;
  readonly tags: readonly string[];
  readonly x: number;
  readonly y: number;
}

export interface HeroState {
  readonly actorId: OpaqueId;
  readonly name: string;
  readonly sightRadius: number;
  readonly backpackCapacity: number;
}

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

export interface AttackCommand extends CommandEnvelope { readonly type: 'attack'; readonly targetActorId: OpaqueId }
export interface FireCommand extends CommandEnvelope { readonly type: 'fire'; readonly itemId: OpaqueId; readonly target: Point }
export interface CastCommand extends CommandEnvelope { readonly type: 'cast'; readonly spellId: OpaqueId; readonly target: Point | null }
export interface ThrowItemCommand extends CommandEnvelope {
  readonly type: 'throw-item'; readonly itemId: OpaqueId; readonly quantity: number; readonly target: Point;
}
export interface UseItemCommand extends CommandEnvelope { readonly type: 'use-item'; readonly itemId: OpaqueId; readonly target: Point | null }
export interface EquipCommand extends CommandEnvelope { readonly type: 'equip'; readonly itemId: OpaqueId; readonly slot: EquipmentSlot }
export interface UnequipCommand extends CommandEnvelope { readonly type: 'unequip'; readonly slot: EquipmentSlot }
export interface PickupCommand extends CommandEnvelope { readonly type: 'pickup'; readonly itemId: OpaqueId; readonly quantity: number }
export interface DropCommand extends CommandEnvelope { readonly type: 'drop'; readonly itemId: OpaqueId; readonly quantity: number }
export interface SplitStackCommand extends CommandEnvelope {
  readonly type: 'split-stack'; readonly itemId: OpaqueId; readonly quantity: number; readonly newItemId: OpaqueId;
}
export interface RefuelCommand extends CommandEnvelope { readonly type: 'refuel'; readonly itemId: OpaqueId; readonly fuelItemId: OpaqueId; readonly quantity: number }
export interface ToggleLightCommand extends CommandEnvelope { readonly type: 'toggle-light'; readonly itemId: OpaqueId; readonly enabled: boolean }
export interface OpenDoorCommand extends CommandEnvelope { readonly type: 'open-door'; readonly featureId: OpaqueId }
export interface CloseDoorCommand extends CommandEnvelope { readonly type: 'close-door'; readonly featureId: OpaqueId }
export interface SearchCommand extends CommandEnvelope { readonly type: 'search' }
export interface DisarmCommand extends CommandEnvelope { readonly type: 'disarm'; readonly featureId: OpaqueId }
export interface RestCommand extends CommandEnvelope { readonly type: 'rest'; readonly until: 'healed' | 'interrupted' }

export type GameCommand = MoveCommand | WaitCommand | AttackCommand | FireCommand | CastCommand | ThrowItemCommand
  | UseItemCommand | EquipCommand | UnequipCommand | PickupCommand | DropCommand | SplitStackCommand | RefuelCommand
  | ToggleLightCommand | OpenDoorCommand | CloseDoorCommand | SearchCommand | DisarmCommand | RestCommand;

export type MovementInvalidReason = 'blocked.bounds' | 'blocked.wall' | 'blocked.door' | 'blocked.pillar'
  | 'blocked.void' | 'blocked.corner' | 'blocked.actor';
export type InvalidActionReason = MovementInvalidReason | 'action.unavailable' | 'inventory.full'
  | 'item.missing' | 'item.unavailable' | 'item.quantity' | 'item.incompatible' | 'item.id-conflict'
  | 'target.not_visible' | 'target.out_of_range' | 'target.blocked' | 'target.invalid';

export interface HeroMovedEvent {
  readonly type: 'hero.moved';
  readonly eventId: OpaqueId;
  readonly heroId: OpaqueId;
  readonly from: Readonly<{ x: number; y: number }>;
  readonly to: Readonly<{ x: number; y: number }>;
}

export interface HeroWaitedEvent {
  readonly type: 'hero.waited';
  readonly eventId: OpaqueId;
  readonly heroId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface InvalidActionEvent {
  readonly type: 'action.invalid';
  readonly eventId: OpaqueId;
  readonly commandId: OpaqueId;
  readonly reason: InvalidActionReason;
}

export interface AttackMissedEvent {
  readonly type: 'attack.missed'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId; readonly naturalRoll: number; readonly total: number; readonly defense: number;
}
export interface AttackHitEvent {
  readonly type: 'attack.hit'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId; readonly naturalRoll: number; readonly total: number; readonly defense: number;
  readonly critical: boolean; readonly rolledDice: number; readonly rolledDamage: number;
  readonly effectiveDamage: number; readonly damageType: DamageType;
}
export interface ActorDamagedEvent {
  readonly type: 'actor.damaged'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId; readonly amount: number; readonly health: number;
}
export interface ActorDiedEvent {
  readonly type: 'actor.died'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly contentId: OpaqueId; readonly killerActorId: OpaqueId;
}
export interface ActorHealedEvent {
  readonly type: 'actor.healed'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId; readonly amount: number; readonly health: number;
}
export interface ConditionAppliedEvent {
  readonly type: 'condition.applied'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId; readonly conditionId: OpaqueId; readonly stacks: number; readonly expiresAt: number | null;
}
export interface ConditionRemovedEvent {
  readonly type: 'condition.removed' | 'condition.expired'; readonly eventId: OpaqueId;
  readonly actorId: OpaqueId; readonly conditionId: OpaqueId;
}
export interface ActorForcedMoveEvent {
  readonly type: 'actor.forced-move'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly from: Point; readonly to: Point;
}
export interface ReactionTriggeredEvent {
  readonly type: 'reaction.triggered'; readonly eventId: OpaqueId;
  readonly actorId: OpaqueId; readonly targetActorId: OpaqueId;
}
export interface RelationshipChangedEvent {
  readonly type: 'relationship.changed'; readonly eventId: OpaqueId;
  readonly actorId: OpaqueId; readonly targetActorId: OpaqueId; readonly relationship: 'friendly' | 'neutral' | 'hostile';
}
export interface ActorTurnStartedEvent {
  readonly type: 'actor.turn.started'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
}
export interface ActorTurnCompletedEvent {
  readonly type: 'actor.turn.completed'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly actionType: 'move' | 'wait' | 'bump-attack' | 'pickup' | 'drop' | 'split-stack'
    | 'fire' | 'throw-item' | 'use-item' | 'equip' | 'unequip' | 'toggle-light' | 'refuel'
    | 'open-door' | 'close-door' | 'search' | 'disarm';
}
export interface ActorMovedEvent {
  readonly type: 'actor.moved'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly from: Point; readonly to: Point;
}
export interface ItemPickedUpEvent {
  readonly type: 'item.picked-up'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly quantity: number;
}
export interface ItemDroppedEvent {
  readonly type: 'item.dropped'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly quantity: number;
}
export interface ItemStackSplitEvent {
  readonly type: 'item.stack-split'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly newItemId: OpaqueId; readonly quantity: number;
}
export interface ItemConsumedEvent {
  readonly type: 'item.consumed'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly quantity: number;
}
export interface ItemThrownEvent {
  readonly type: 'item.thrown'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly quantity: number; readonly to: Point;
}
export interface ItemUsedEvent {
  readonly type: 'item.used'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly targetActorId: OpaqueId;
}
export interface ItemEquippedEvent {
  readonly type: 'item.equipped'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly slot: EquipmentSlot;
}
export interface ItemUnequippedEvent {
  readonly type: 'item.unequipped'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly slot: EquipmentSlot;
}
export interface ItemLightToggledEvent {
  readonly type: 'item.light-toggled'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly enabled: boolean;
}
export interface ItemRefueledEvent {
  readonly type: 'item.refueled'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly fuelItemId: OpaqueId; readonly quantity: number; readonly fuel: number;
}
export interface IdentificationAppearanceRevealedEvent {
  readonly type: 'identification.appearance-revealed'; readonly eventId: OpaqueId;
  readonly appearanceId: OpaqueId; readonly contentId: OpaqueId;
}
export interface ItemIdentifiedEvent {
  readonly type: 'item.identified'; readonly eventId: OpaqueId; readonly itemId: OpaqueId;
}
export interface HungerStageChangedEvent {
  readonly type: 'hunger.stage-changed'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly previousStage: HungerStage; readonly stage: HungerStage; readonly reserve: number;
}
export interface HungerRestoredEvent {
  readonly type: 'hunger.restored'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly amount: number; readonly reserve: number;
}
export interface FuelWarningEvent {
  readonly type: 'fuel.warning'; readonly eventId: OpaqueId; readonly itemId: OpaqueId;
  readonly threshold: number; readonly fuel: number;
}
export interface ItemLightExtinguishedEvent {
  readonly type: 'item.light-extinguished'; readonly eventId: OpaqueId; readonly itemId: OpaqueId;
}
export interface ItemDamagedEvent {
  readonly type: 'item.damaged'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly itemId: OpaqueId; readonly amount: number; readonly condition: number;
}
export interface DoorStateChangedEvent {
  readonly type: 'door.opened' | 'door.closed'; readonly eventId: OpaqueId;
  readonly actorId: OpaqueId; readonly featureId: OpaqueId;
}
export interface FeatureRevealedEvent {
  readonly type: 'feature.revealed'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
}
export interface FeatureSearchEvent {
  readonly type: 'feature.searched'; readonly eventId: OpaqueId; readonly actorId: OpaqueId;
}
export interface TrapStateEvent {
  readonly type: 'trap.triggered' | 'trap.disarmed' | 'trap.disarm-failed'; readonly eventId: OpaqueId;
  readonly actorId: OpaqueId; readonly featureId: OpaqueId;
}

export type DomainEvent = HeroMovedEvent | HeroWaitedEvent | InvalidActionEvent | AttackMissedEvent
  | AttackHitEvent | ActorDamagedEvent | ActorDiedEvent | ActorHealedEvent | ConditionAppliedEvent
  | ConditionRemovedEvent | ActorForcedMoveEvent | ReactionTriggeredEvent | RelationshipChangedEvent
  | ActorTurnStartedEvent | ActorTurnCompletedEvent | ActorMovedEvent | ItemPickedUpEvent | ItemDroppedEvent
  | ItemStackSplitEvent | ItemConsumedEvent | ItemThrownEvent | ItemUsedEvent | ItemEquippedEvent
  | ItemUnequippedEvent | ItemLightToggledEvent | ItemRefueledEvent
  | IdentificationAppearanceRevealedEvent | ItemIdentifiedEvent
  | HungerStageChangedEvent | HungerRestoredEvent | FuelWarningEvent | ItemLightExtinguishedEvent
  | ItemDamagedEvent | DoorStateChangedEvent | FeatureRevealedEvent | FeatureSearchEvent | TrapStateEvent;

export interface AppliedCommandResult {
  readonly status: 'applied';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
}

export interface InvalidCommandResult {
  readonly status: 'invalid';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly reason: InvalidActionEvent['reason'];
}

export interface ConfirmAggressionDecision {
  readonly type: 'confirm-aggression';
  readonly targetActorId: OpaqueId;
}

export type PublicDecision = ConfirmAggressionDecision;

export interface DecisionRequiredResult {
  readonly status: 'decision_required';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly decision: PublicDecision;
}

export interface RejectedCommandResult {
  readonly status: 'rejected';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly reason: 'stale_revision' | 'command_id_conflict';
}

export type ProcessedCommandResult = AppliedCommandResult | InvalidCommandResult;
export type CommandResult = ProcessedCommandResult | RejectedCommandResult | DecisionRequiredResult;

export interface RecordedCommand {
  readonly command: GameCommand;
  readonly result: ProcessedCommandResult;
  readonly events: readonly DomainEvent[];
  readonly publicEvents: readonly DomainEvent[];
}

export interface ActiveRun {
  readonly schemaVersion: 3;
  readonly gameVersion: '0.1.0';
  readonly contentHash: string;
  readonly runId: OpaqueId;
  readonly runSeed: Uint32State;
  readonly rng: RngStreams;
  readonly revision: number;
  readonly turn: number;
  readonly worldTime: number;
  readonly hero: HeroState;
  readonly actors: readonly ActorState[];
  readonly items: readonly ItemInstance[];
  readonly features: readonly DungeonFeature[];
  readonly relationships: readonly RelationshipOverride[];
  readonly survival: SurvivalState;
  readonly identification: IdentificationState;
  readonly activeFloorId: OpaqueId;
  readonly floors: readonly FloorSnapshot[];
  readonly recentCommands: readonly RecordedCommand[];
}

export interface CommandResolution {
  readonly state: ActiveRun;
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}

const OPAQUE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export function assertOpaqueId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw new TypeError(`${label} must be a lowercase opaque identifier`);
  }
}

export function tileIndex(
  floor: Pick<FloorSnapshot, 'width' | 'height'>,
  x: number,
  y: number,
): number | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= floor.width || y >= floor.height) {
    return undefined;
  }
  return y * floor.width + x;
}
