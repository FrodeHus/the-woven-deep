export const CONTENT_SCHEMA_VERSION = 1 as const;

export type ContentId = string;
export type ContentKind = 'monster' | 'item';

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

export type ContentEntry = MonsterContentEntry | ItemContentEntry;

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
}
