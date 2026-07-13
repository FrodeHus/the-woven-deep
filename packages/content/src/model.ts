export const CONTENT_SCHEMA_VERSION = 1 as const;

export type ContentId = string;
export type ContentKind = 'monster' | 'item' | 'vault';
export type VaultTerrainName = 'wall' | 'floor' | 'closed-door' | 'pillar' | 'stair-up' | 'stair-down' | 'void';
export type VaultPlacementKind = 'monster' | 'item' | 'trap' | 'npc' | 'fixture' | 'objective';
export type VaultRotation = 0 | 90 | 180 | 270;
export type VaultRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface BaseContentEntry {
  readonly id: ContentId;
  readonly kind: ContentKind;
  readonly name: string;
  readonly glyph: string;
  readonly color: string;
  readonly tags: readonly string[];
}

export interface MonsterContentEntry extends BaseContentEntry {
  readonly kind: 'monster';
  readonly ai: string;
  readonly runAppearanceChance: number;
  readonly stats: {
    readonly health: number;
    readonly attack: number;
    readonly defense: number;
  };
}

export interface ItemContentEntry extends BaseContentEntry {
  readonly kind: 'item';
  readonly effect: string;
  readonly price: number;
}

export interface VaultPlacementSlot {
  readonly id: string;
  readonly kind: VaultPlacementKind;
  readonly required: boolean;
  readonly tags: readonly string[];
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

export interface VaultContentEntry {
  readonly kind: 'vault';
  readonly id: ContentId;
  readonly name: string;
  readonly tags: readonly string[];
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

export type ContentEntry = MonsterContentEntry | ItemContentEntry | VaultContentEntry;

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
}
