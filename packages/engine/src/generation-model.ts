import type { AmbientLight } from './light-model.js';
import type { OpaqueId, TileId, Uint32State } from './model.js';

export interface FloorSeedAllocation {
  readonly floorSeed: Uint32State;
  readonly nextGenerationState: Uint32State;
}

export interface GenerationTheme {
  readonly themeId: OpaqueId;
  readonly maskWords: readonly number[];
  readonly ambient: AmbientLight;
  readonly minimumRooms: number;
  readonly minimumStairDistance: number;
}

export const CLASSIC_THEME_ID = 'theme.classic';

export interface ClassicThemeSettings {
  readonly ambient: AmbientLight;
  readonly minimumRooms?: number;
  readonly minimumStairDistance?: number;
}

export type GenerationRejectionCode =
  | 'topology.empty'
  | 'topology.outside-mask'
  | 'topology.room-budget'
  | 'topology.invalid-geometry'
  | 'vault.required-unavailable'
  | 'vault.no-valid-placement'
  | 'stairs.no-valid-pair'
  | 'connectivity.disconnected';

export class GenerationError extends Error {
  readonly code: 'generation.invalid-request' | 'generation.invalid-theme' | 'generation.fallback-invariant';

  constructor(code: GenerationError['code'], message: string) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
  }
}

export interface RoomBounds {
  readonly roomId: OpaqueId;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CorridorRecord {
  readonly corridorId: OpaqueId;
  readonly start: Readonly<{ x: number; y: number }>;
  readonly end: Readonly<{ x: number; y: number }>;
}

export interface GenerationReport {
  readonly generatorVersion: 2;
  readonly attempt: number | null;
  readonly fallback: boolean;
  readonly roomCount: number;
  readonly corridorCount: number;
  readonly vaults: readonly Readonly<{ vaultId: OpaqueId; rotation: 0 | 90 | 180 | 270; reflected: boolean }>[];
  readonly stairUp: Readonly<{ x: number; y: number }>;
  readonly stairDown: Readonly<{ x: number; y: number }>;
  readonly stairDistance: number;
  readonly traversableCellCount: number;
  readonly connected: true;
  readonly rejectionCounts: Readonly<Partial<Record<GenerationRejectionCode, number>>>;
}

export interface TopologyDraft {
  readonly floorId: OpaqueId;
  readonly floorSeed: Uint32State;
  readonly depth: number;
  readonly themeId: OpaqueId;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly rooms: readonly RoomBounds[];
  readonly corridors: readonly CorridorRecord[];
  readonly stairUp: Readonly<{ x: number; y: number }>;
  readonly stairDown: Readonly<{ x: number; y: number }>;
  readonly vaultState: Uint32State;
  readonly report: GenerationReport;
}

export type TopologyAttemptResult =
  | { readonly ok: true; readonly draft: TopologyDraft }
  | { readonly ok: false; readonly code: GenerationRejectionCode };

export type TopologyFactory = (request: GenerateTopologyRequest, attempt: number) => TopologyAttemptResult;

export interface GenerateTopologyRequest {
  readonly floorId: OpaqueId;
  readonly floorSeed: Uint32State;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly theme: GenerationTheme;
  readonly attemptLimit?: number;
  readonly topologyFactory?: TopologyFactory;
}
