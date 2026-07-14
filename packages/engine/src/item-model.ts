import type { EquipmentSlot } from './actor-model.js';
import type { OpaqueId } from './model.js';

export type ItemLocation =
  | Readonly<{ type: 'backpack'; actorId: OpaqueId }>
  | Readonly<{ type: 'equipped'; actorId: OpaqueId; slot: EquipmentSlot }>
  | Readonly<{ type: 'floor'; floorId: OpaqueId; x: number; y: number }>;

export interface ItemEnchantmentState {
  readonly enchantmentId: OpaqueId;
  readonly modifiers: Readonly<Record<string, number>>;
}

export interface HeirloomItemMetadata {
  readonly displayName: string;
  readonly glyph: string;
  readonly color: string;
  readonly originatingHallRecordId: OpaqueId;
}

export interface ItemInstance {
  readonly itemId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly quantity: number;
  readonly condition: number;
  readonly enchantment: ItemEnchantmentState | null;
  readonly identified: boolean;
  readonly charges: number | null;
  readonly fuel: number | null;
  readonly enabled: boolean | null;
  readonly location: ItemLocation;
  readonly heirloom?: HeirloomItemMetadata;
}

export interface IdentificationState {
  readonly appearanceByContentId: Readonly<Record<OpaqueId, OpaqueId>>;
  readonly knownAppearanceIds: readonly OpaqueId[];
}
