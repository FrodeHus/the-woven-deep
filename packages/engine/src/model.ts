import type { RngStreamName } from './versions.js';
import type { FloorKnowledge } from './knowledge.js';
import type { AmbientLight, LightSource } from './light-model.js';
import type { ActorState, EquipmentSlot, RelationshipOverride } from './actor-model.js';
import type { DungeonFeature } from './feature-model.js';
import type { IdentificationState, ItemInstance } from './item-model.js';
import type { SurvivalState } from './survival-model.js';

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
export interface ThrowItemCommand extends CommandEnvelope { readonly type: 'throw-item'; readonly itemId: OpaqueId; readonly target: Point }
export interface UseItemCommand extends CommandEnvelope { readonly type: 'use-item'; readonly itemId: OpaqueId; readonly target: Point | null }
export interface EquipCommand extends CommandEnvelope { readonly type: 'equip'; readonly itemId: OpaqueId; readonly slot: EquipmentSlot }
export interface UnequipCommand extends CommandEnvelope { readonly type: 'unequip'; readonly slot: EquipmentSlot }
export interface PickupCommand extends CommandEnvelope { readonly type: 'pickup'; readonly itemId: OpaqueId; readonly quantity: number }
export interface DropCommand extends CommandEnvelope { readonly type: 'drop'; readonly itemId: OpaqueId; readonly quantity: number }
export interface SplitStackCommand extends CommandEnvelope { readonly type: 'split-stack'; readonly itemId: OpaqueId; readonly quantity: number }
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
export type InvalidActionReason = MovementInvalidReason | 'action.unavailable';

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

export type DomainEvent = HeroMovedEvent | HeroWaitedEvent | InvalidActionEvent;

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
