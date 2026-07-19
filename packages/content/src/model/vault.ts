import type { BaseContentEntry, ContentId } from './common.js';

export type VaultTerrainName = 'wall' | 'floor' | 'closed-door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';
export type VaultPlacementKind = 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective';
export type VaultRotation = 0 | 90 | 180 | 270;
export type VaultRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface VaultPlacementSlot {
  readonly id: string;
  readonly kind: VaultPlacementKind;
  readonly required: boolean;
  readonly tags: readonly string[];
  readonly lootTableId: ContentId | null;
  readonly contentId: ContentId | null;
}

export interface VaultLightFixture {
  readonly idSuffix: string;
  readonly glyph: string;
  readonly presentationToken: string;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly strength: number;
  readonly enabled: boolean;
}

export interface VaultLegendEntry {
  readonly terrain: VaultTerrainName;
  readonly entrance: boolean;
  readonly light: VaultLightFixture | null;
  readonly slot: VaultPlacementSlot | null;
}

export interface VaultContentEntry extends BaseContentEntry {
  readonly kind: 'vault';
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly rarity: VaultRarity;
  readonly weight: number;
  readonly maxPerFloor: number;
  readonly margin: number;
  readonly transforms: {
    readonly rotations: readonly VaultRotation[];
    readonly reflectHorizontal: boolean;
  };
  readonly layout: readonly string[];
  readonly legend: Readonly<Record<string, VaultLegendEntry>>;
  readonly entranceCount: number;
  readonly requiredSlotIds: readonly string[];
}
