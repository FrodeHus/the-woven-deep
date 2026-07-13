import type { RngStreamName } from './versions.js';

export type OpaqueId = string;
export type Uint32State = readonly [number, number, number, number];
export type RngStreams = Readonly<Record<RngStreamName, Uint32State>>;
export type TileId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Direction = 'north' | 'south' | 'east' | 'west';

export interface FloorEntityPosition {
  readonly entityId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface FloorSnapshot {
  readonly floorId: OpaqueId;
  readonly seed: Uint32State;
  readonly generatorVersion: 1;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly tiles: readonly TileId[];
  readonly entities: readonly FloorEntityPosition[];
}

export interface HeroState {
  readonly heroId: OpaqueId;
  readonly name: string;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
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

export type GameCommand = MoveCommand | WaitCommand;

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
  readonly reason: 'blocked.bounds' | 'blocked.wall' | 'blocked.door' | 'blocked.pillar' | 'blocked.void';
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

export interface RejectedCommandResult {
  readonly status: 'rejected';
  readonly commandId: OpaqueId;
  readonly revision: number;
  readonly turn: number;
  readonly reason: 'stale_revision' | 'command_id_conflict';
}

export type ProcessedCommandResult = AppliedCommandResult | InvalidCommandResult;
export type CommandResult = ProcessedCommandResult | RejectedCommandResult;

export interface RecordedCommand {
  readonly command: GameCommand;
  readonly result: ProcessedCommandResult;
  readonly events: readonly DomainEvent[];
}

export interface ActiveRun {
  readonly schemaVersion: 1;
  readonly gameVersion: '0.1.0';
  readonly contentHash: string;
  readonly runId: OpaqueId;
  readonly runSeed: Uint32State;
  readonly rng: RngStreams;
  readonly revision: number;
  readonly turn: number;
  readonly hero: HeroState;
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
