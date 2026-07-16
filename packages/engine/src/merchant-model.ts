import type { MerchantServiceId } from '@woven-deep/content';
import type { OpaqueId } from './model.js';
import type { PopulationBase } from './population-model.js';

export interface FactionReputation {
  readonly factionId: OpaqueId;
  readonly value: number;
}

export interface ActiveTrade {
  readonly merchantPopulationId: OpaqueId;
  readonly merchantActorId: OpaqueId;
  readonly openedByCommandId: OpaqueId;
  readonly openedAtRevision: number;
  readonly completedCommerce: boolean;
}

export interface MerchantServiceState {
  readonly serviceId: MerchantServiceId;
  readonly basePrice: number;
  readonly remainingUses: number;
  readonly tierIds: readonly string[];
}

export interface MerchantPopulation extends PopulationBase {
  readonly model: 'merchant';
  readonly actorId: OpaqueId;
  readonly npcId: OpaqueId;
  readonly factionId: OpaqueId;
  readonly rolledLifetime: number;
  /** `null` for a permanent (town) merchant, which never departs. */
  readonly departureAt: number | null;
  readonly emittedWarningThresholds: readonly number[];
  readonly initialStockItemIds: readonly OpaqueId[];
  readonly stockItemIds: readonly OpaqueId[];
  readonly services: readonly MerchantServiceState[];
  readonly lifecycle: 'available' | 'fleeing' | 'defending' | 'departed' | 'dead';
  readonly provoked: boolean;
  readonly aggressionPenaltyApplied: boolean;
  readonly deathPenaltyApplied: boolean;
  readonly stockLossResolved: boolean;
  readonly commerceBonusApplied: boolean;
}
