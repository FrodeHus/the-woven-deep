import type { BaseContentEntry, MerchantServiceId } from './common.js';

export interface ReputationTierDefinition {
  readonly tierId: string; readonly name: string; readonly minimum: number; readonly maximum: number;
  readonly purchasePriceBps: number; readonly salePriceBps: number; readonly acceptsTrade: boolean;
  readonly serviceIds: readonly MerchantServiceId[];
}

export interface NpcFactionContentEntry extends BaseContentEntry {
  readonly kind: 'npc-faction'; readonly minimumReputation: number; readonly maximumReputation: number;
  readonly startingReputation: number; readonly tiers: readonly ReputationTierDefinition[];
}
