import type { InvalidActionEvent, TileId } from './model.js';

export type TerrainName = 'wall' | 'floor' | 'closed-door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';
export type TerrainToken = 'terrain.wall' | 'terrain.floor' | 'terrain.door' | 'terrain.pillar' | 'terrain.stair' | 'terrain.void';

export interface TileDefinition {
  readonly id: TileId;
  readonly name: TerrainName;
  readonly glyph: string;
  readonly walkable: boolean;
  readonly potentiallyTraversable: boolean;
  readonly opaque: boolean;
  readonly token: TerrainToken;
}

export const TILE_DEFINITIONS: readonly TileDefinition[] = [
  { id: 0, name: 'wall', glyph: '#', walkable: false, potentiallyTraversable: false, opaque: true, token: 'terrain.wall' },
  { id: 1, name: 'floor', glyph: '.', walkable: true, potentiallyTraversable: true, opaque: false, token: 'terrain.floor' },
  { id: 2, name: 'closed-door', glyph: '+', walkable: false, potentiallyTraversable: true, opaque: true, token: 'terrain.door' },
  { id: 3, name: 'pillar', glyph: 'O', walkable: false, potentiallyTraversable: false, opaque: true, token: 'terrain.pillar' },
  { id: 4, name: 'stair-up', glyph: '<', walkable: true, potentiallyTraversable: true, opaque: false, token: 'terrain.stair' },
  { id: 5, name: 'stair-down', glyph: '>', walkable: true, potentiallyTraversable: true, opaque: false, token: 'terrain.stair' },
  { id: 6, name: 'void', glyph: ' ', walkable: false, potentiallyTraversable: false, opaque: true, token: 'terrain.void' },
] as const;

export function tileDefinition(tileId: TileId): TileDefinition {
  const definition = TILE_DEFINITIONS[tileId];
  if (!definition || definition.id !== tileId) throw new Error(`internal invariant: unknown tile ${tileId}`);
  return definition;
}

export function movementBlockReason(tileId: TileId): InvalidActionEvent['reason'] | undefined {
  if (tileDefinition(tileId).walkable) return undefined;
  if (tileId === 2) return 'blocked.door';
  if (tileId === 3) return 'blocked.pillar';
  if (tileId === 6) return 'blocked.void';
  return 'blocked.wall';
}
