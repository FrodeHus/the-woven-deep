import type { OpaqueId, TileId } from './model.js';

export interface DiscoveryState {
  readonly discoveredByActorIds: readonly OpaqueId[];
  readonly progressByActorId: Readonly<Record<OpaqueId, number>>;
  readonly attemptedContextKeys: readonly string[];
}

interface FeatureBase {
  readonly featureId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly contentId: OpaqueId | null;
  readonly coverTileId: TileId;
}

export interface LockData {
  readonly difficulty: number;
  readonly keyContentId: string | null;
}

export interface DoorFeature extends FeatureBase {
  readonly type: 'door';
  readonly state: 'open' | 'closed' | 'locked';
  readonly lock?: LockData;
}

export interface ChestFeature extends FeatureBase {
  readonly type: 'chest';
  readonly state: 'locked' | 'closed' | 'looted' | 'jammed';
  readonly lock: LockData | null;
  readonly lootTableId: string | null;
  readonly lootContentId: string | null;
}

export interface TrapFeature extends FeatureBase {
  readonly type: 'trap';
  readonly state: 'armed' | 'disabled' | 'spent';
  readonly discoveryDifficulty: number;
  readonly discovery: DiscoveryState;
}

export interface SecretFeature extends FeatureBase {
  readonly type: 'secret';
  readonly state: 'hidden' | 'revealed';
  readonly discoveryDifficulty: number;
  readonly discovery: DiscoveryState;
}

export type DungeonFeature = DoorFeature | TrapFeature | SecretFeature | ChestFeature;
