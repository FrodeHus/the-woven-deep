import type { RngStreamName } from './versions.js';
import type { FloorKnowledge } from './knowledge.js';
import type { AmbientLight, LightSource } from './light-model.js';
import type { ActorState, RelationshipOverride } from './actor-model.js';
import type { DungeonFeature } from './feature-model.js';
import type { IdentificationState, ItemInstance } from './item-model.js';
import type { SurvivalState } from './survival-model.js';
import type {
  EncounterRunDecision,
  FallenHeroRunDecision,
  FallenHeroStandingSnapshot,
  PopulationInstance,
} from './population-model.js';
import type { ActiveTrade, FactionReputation } from './merchant-model.js';
import type { RunConclusion } from './run-conclusion.js';
import type { RunMetrics } from './run-metrics.js';
import type { DerivedStatModifier } from './attributes.js';
import type { GameCommand } from './commands-model.js';
import type { DomainEvent, InvalidActionEvent, PublicEvent } from './events-model.js';

export * from './commands-model.js';
export * from './events-model.js';

export type OpaqueId = string;
export type Uint32State = readonly [number, number, number, number];
export type RngStreams = Readonly<Record<RngStreamName, Uint32State>>;
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Direction =
  'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
export interface Point {
  readonly x: number;
  readonly y: number;
}

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
  readonly kind: 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective' | 'door' | 'chest';
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
  readonly currency: number;
  readonly classTags: readonly string[];
  readonly statModifiers: DerivedStatModifier;
}

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
  readonly publicEvents: readonly PublicEvent[];
}

export interface HouseState {
  readonly capacity: number;
  readonly upgradesPurchased: number;
}

export interface ActiveRun {
  readonly schemaVersion: 8;
  readonly gameVersion: '0.1.0';
  readonly contentHash: string;
  readonly runId: OpaqueId;
  readonly runSeed: Uint32State;
  readonly rng: RngStreams;
  readonly revision: number;
  readonly turn: number;
  readonly worldTime: number;
  readonly hero: HeroState;
  readonly reputations: readonly FactionReputation[];
  readonly activeTrade: ActiveTrade | null;
  readonly actors: readonly ActorState[];
  readonly items: readonly ItemInstance[];
  readonly features: readonly DungeonFeature[];
  readonly relationships: readonly RelationshipOverride[];
  readonly survival: SurvivalState;
  readonly identification: IdentificationState;
  readonly activeFloorId: OpaqueId;
  readonly activeFloorEnteredAt: number;
  readonly floors: readonly FloorSnapshot[];
  readonly recentCommands: readonly RecordedCommand[];
  readonly encounterDecisions: readonly EncounterRunDecision[];
  readonly populations: readonly PopulationInstance[];
  readonly fallenHeroStandings: readonly FallenHeroStandingSnapshot[];
  readonly fallenHeroDecisions: readonly FallenHeroRunDecision[];
  readonly conqueredChampionRecordIds: readonly OpaqueId[];
  readonly metrics: RunMetrics;
  readonly conclusion: RunConclusion | null;
  readonly house: HouseState;
  readonly restockedMilestones: readonly number[];
}

export interface CommandResolution {
  readonly state: ActiveRun;
  readonly result: CommandResult;
  readonly events: readonly PublicEvent[];
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
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= floor.width ||
    y >= floor.height
  ) {
    return undefined;
  }
  return y * floor.width + x;
}
