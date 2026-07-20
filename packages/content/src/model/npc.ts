import type {
  BaseAttributeDefinition,
  ContentId,
  DamageType,
  DiceDefinition,
  PresentedContentEntry,
} from './common.js';

export interface NpcContentEntry extends PresentedContentEntry {
  readonly kind: 'npc';
  readonly factionId: ContentId;
  readonly attributes: BaseAttributeDefinition;
  readonly health: number;
  readonly speed: number;
  readonly perception: number;
  readonly accuracy: number;
  readonly defense: number;
  readonly damage: DiceDefinition;
  readonly armor: number;
  readonly resistances: Readonly<Record<DamageType, number>>;
  readonly disposition: 'neutral';
  readonly behaviorId: 'npc-behavior.travelling-merchant';
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly selfPreservationThresholdBps: number;
}
