import type { OpaqueId, Direction, Point } from './model.js';
import type { InvalidActionReason } from './commands-model.js';
import type { EquipmentSlot } from './actor-model.js';
import type {
  AchievementCriteriaId,
  CompletionType,
  DamageType,
  LeaderDeathResponse,
  MerchantServiceId,
} from '@woven-deep/content';
import type { HungerStage } from './survival-model.js';
import type { PopulationInstance, PopulationIntent } from './population-model.js';
import type { RunConclusionCause } from './run-conclusion.js';

export interface HeroMovedEvent {
  readonly type: 'hero.moved';
  readonly eventId: OpaqueId;
  readonly heroId: OpaqueId;
  readonly from: Readonly<{ x: number; y: number }>;
  readonly to: Readonly<{ x: number; y: number }>;
}

export interface HeroWaitedEvent {
  readonly type: 'hero.waited';
  readonly eventId: OpaqueId;
  readonly heroId: OpaqueId;
  readonly x: number;
  readonly y: number;
}

export interface InvalidActionEvent {
  readonly type: 'action.invalid';
  readonly eventId: OpaqueId;
  readonly commandId: OpaqueId;
  readonly reason: InvalidActionReason;
}

export interface AttackMissedEvent {
  readonly type: 'attack.missed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly naturalRoll: number;
  readonly total: number;
  readonly defense: number;
}
export interface AttackHitEvent {
  readonly type: 'attack.hit';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly naturalRoll: number;
  readonly total: number;
  readonly defense: number;
  readonly critical: boolean;
  readonly rolledDice: number;
  readonly rolledDamage: number;
  readonly effectiveDamage: number;
  readonly damageType: DamageType;
}
export interface ActorDamagedEvent {
  readonly type: 'actor.damaged';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly amount: number;
  readonly health: number;
}
export interface ActorDiedEvent {
  readonly type: 'actor.died';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly killerActorId: OpaqueId;
}
export interface ActorHealedEvent {
  readonly type: 'actor.healed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly amount: number;
  readonly health: number;
}
export interface LootDroppedEvent {
  readonly type: 'loot.dropped';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly itemIds: readonly OpaqueId[];
}
export interface ConditionAppliedEvent {
  readonly type: 'condition.applied';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly conditionId: OpaqueId;
  readonly stacks: number;
  readonly expiresAt: number | null;
}
export interface ConditionRemovedEvent {
  readonly type: 'condition.removed' | 'condition.expired';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly conditionId: OpaqueId;
}
export interface ActorForcedMoveEvent {
  readonly type: 'actor.forced-move';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly from: Point;
  readonly to: Point;
}
export interface ReactionTriggeredEvent {
  readonly type: 'reaction.triggered';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
}
export interface RelationshipChangedEvent {
  readonly type: 'relationship.changed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly relationship: 'friendly' | 'neutral' | 'hostile';
}
export interface ActorTurnStartedEvent {
  readonly type: 'actor.turn.started';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
}
export interface ActorTurnCompletedEvent {
  readonly type: 'actor.turn.completed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly actionType:
    | 'move'
    | 'wait'
    | 'bump-attack'
    | 'pickup'
    | 'drop'
    | 'split-stack'
    | 'fire'
    | 'throw-item'
    | 'use-item'
    | 'equip'
    | 'unequip'
    | 'toggle-light'
    | 'refuel'
    | 'open-door'
    | 'close-door'
    | 'search'
    | 'disarm'
    | 'pick-lock'
    | 'swarm-spawn';
}
export interface ActorMovedEvent {
  readonly type: 'actor.moved';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly from: Point;
  readonly to: Point;
}
export interface ItemPickedUpEvent {
  readonly type: 'item.picked-up';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface ItemDroppedEvent {
  readonly type: 'item.dropped';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface ItemStackSplitEvent {
  readonly type: 'item.stack-split';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly newItemId: OpaqueId;
  readonly quantity: number;
}
export interface ItemConsumedEvent {
  readonly type: 'item.consumed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
}
export interface ItemThrownEvent {
  readonly type: 'item.thrown';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly to: Point;
}
export interface ItemUsedEvent {
  readonly type: 'item.used';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly targetActorId: OpaqueId;
}
export interface ItemEquippedEvent {
  readonly type: 'item.equipped';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly slot: EquipmentSlot;
}
export interface ItemUnequippedEvent {
  readonly type: 'item.unequipped';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly slot: EquipmentSlot;
}
export interface ItemLightToggledEvent {
  readonly type: 'item.light-toggled';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly enabled: boolean;
}
export interface ItemRefueledEvent {
  readonly type: 'item.refueled';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly fuelItemId: OpaqueId;
  readonly quantity: number;
  readonly fuel: number;
}
export interface IdentificationAppearanceRevealedEvent {
  readonly type: 'identification.appearance-revealed';
  readonly eventId: OpaqueId;
  readonly appearanceId: OpaqueId;
  readonly contentId: OpaqueId;
}
export interface ItemIdentifiedEvent {
  readonly type: 'item.identified';
  readonly eventId: OpaqueId;
  readonly itemId: OpaqueId;
}
export interface HungerStageChangedEvent {
  readonly type: 'hunger.stage-changed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly previousStage: HungerStage;
  readonly stage: HungerStage;
  readonly reserve: number;
}
export interface HungerRestoredEvent {
  readonly type: 'hunger.restored';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly amount: number;
  readonly reserve: number;
}
export interface FuelWarningEvent {
  readonly type: 'fuel.warning';
  readonly eventId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly threshold: number;
  readonly fuel: number;
}
export interface ItemLightExtinguishedEvent {
  readonly type: 'item.light-extinguished';
  readonly eventId: OpaqueId;
  readonly itemId: OpaqueId;
}
export interface ItemDamagedEvent {
  readonly type: 'item.damaged';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly amount: number;
  readonly condition: number;
}
export interface DoorStateChangedEvent {
  readonly type: 'door.opened' | 'door.closed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
}
export interface FeatureRevealedEvent {
  readonly type: 'feature.revealed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
}
export interface FeatureSearchEvent {
  readonly type: 'feature.searched';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
}
export interface TrapStateEvent {
  readonly type: 'trap.triggered' | 'trap.disarmed' | 'trap.disarm-failed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
}
export interface LockOutcomeEvent {
  readonly type: 'lock.picked' | 'lock.pick-failed' | 'door.unlocked' | 'chest.jammed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly featureId: OpaqueId;
}
export interface ActorIntentChangedEvent {
  readonly type: 'actor.intent-changed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly intent: PopulationIntent;
  readonly presentation: `intent.${PopulationIntent}`;
  readonly targetCategory: 'hero' | 'leader' | 'source' | 'position' | null;
}
export interface PopulationCreatedEvent {
  readonly type: 'population.created';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly model: PopulationInstance['model'];
  readonly actorIds: readonly OpaqueId[];
}
export interface PopulationEncounteredEvent {
  readonly type: 'population.encountered';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly actorId: OpaqueId;
}
export interface PopulationPlacementSkippedEvent {
  readonly type: 'population.placement-skipped';
  readonly eventId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly reason: 'no-eligible-encounter' | 'no-valid-placement' | 'required-route-blocked';
}
export interface GroupAwarenessSharedEvent {
  readonly type: 'group.awareness-shared';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly floorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly observedAt: number;
  readonly observerActorId: OpaqueId;
}
export interface GroupLeaderCreatedEvent {
  readonly type: 'group.leader-created';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly roleId: string;
}
export interface GroupLeaderDefeatedEvent {
  readonly type: 'group.leader-defeated';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
}
export interface GroupOutcomeAppliedEvent {
  readonly type: 'group.outcome-applied';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly response: LeaderDeathResponse;
  readonly individualRewards: boolean;
  readonly collapsedMemberCount: number;
}
export interface SwarmMembersCreatedEvent {
  readonly type: 'swarm.members-created';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly actorIds: readonly OpaqueId[];
  readonly quantity: number;
}
export interface SwarmCapReachedEvent {
  readonly type: 'swarm.cap-reached';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly level: 'source' | 'encounter' | 'floor';
}
export interface SwarmSourceDestroyedEvent {
  readonly type: 'swarm.source-destroyed';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly response: 'stop' | 'flee' | 'decay' | 'frenzy';
}
export interface BossEncounteredEvent {
  readonly type: 'boss.encountered';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly encounterId: OpaqueId;
}
export interface BossPhaseChangedEvent {
  readonly type: 'boss.phase-changed';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly phaseId: string;
}
export interface BossRecoveredEvent {
  readonly type: 'boss.recovered';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly amount: number;
  readonly health: number;
}
export interface BossDefeatedEvent {
  readonly type: 'boss.defeated';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly encounterId: OpaqueId;
}
export interface BossRewardCreatedEvent {
  readonly type: 'boss.reward-created';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly uniqueItemId: OpaqueId;
  readonly itemIds: readonly OpaqueId[];
}
export interface ChampionDefeatedEvent {
  readonly type: 'champion.defeated';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: 1;
}
export interface ChampionEncounteredEvent {
  readonly type: 'champion.encountered';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: 1;
}
export interface ChampionHeirloomCreatedEvent {
  readonly type: 'champion.heirloom-created';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: 1;
  readonly itemId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly originatingHallRecordId: OpaqueId;
  readonly displayName: string;
  readonly glyph: string;
  readonly color: string;
  readonly fallback: boolean;
}
export interface EchoDefeatedEvent {
  readonly type: 'echo.defeated';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: number;
}
export interface EchoEncounteredEvent {
  readonly type: 'echo.encountered';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: number;
}
export interface EchoLootCreatedEvent {
  readonly type: 'echo.loot-created';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly hallRecordId: OpaqueId;
  readonly rank: number;
  readonly itemIds: readonly OpaqueId[];
}
export type PopulationDomainEvent =
  | PopulationCreatedEvent
  | PopulationEncounteredEvent
  | PopulationPlacementSkippedEvent
  | ActorIntentChangedEvent
  | GroupAwarenessSharedEvent
  | GroupLeaderCreatedEvent
  | GroupLeaderDefeatedEvent
  | GroupOutcomeAppliedEvent
  | SwarmMembersCreatedEvent
  | SwarmCapReachedEvent
  | SwarmSourceDestroyedEvent
  | BossEncounteredEvent
  | BossPhaseChangedEvent
  | BossRecoveredEvent
  | BossDefeatedEvent
  | BossRewardCreatedEvent
  | ChampionEncounteredEvent
  | ChampionDefeatedEvent
  | ChampionHeirloomCreatedEvent
  | EchoEncounteredEvent
  | EchoDefeatedEvent
  | EchoLootCreatedEvent;
export interface SoundHeardEvent {
  readonly type: 'sound.heard';
  readonly category: 'combat' | 'movement' | 'mechanism';
  readonly direction:
    | 'north'
    | 'northeast'
    | 'east'
    | 'southeast'
    | 'south'
    | 'southwest'
    | 'west'
    | 'northwest'
    | 'here';
  readonly distanceBand: 'near' | 'medium' | 'far';
}
export interface HeroDamagedPublicEvent {
  readonly type: 'hero.damaged';
  readonly amount: number;
  readonly damageType: DamageType;
}
export interface CombatObservedPublicEvent {
  readonly type: 'combat.observed';
  readonly eventId: OpaqueId;
  readonly outcome: 'hit' | 'missed';
  readonly attackerActorId: OpaqueId;
  readonly targetActorId: OpaqueId;
  readonly attackerName?: string;
  readonly targetName?: string;
}
export interface ActorMovementObservedPublicEvent {
  readonly type: 'actor.movement-observed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly direction: Direction;
  readonly visibility: 'entered' | 'left';
}
export interface ActorDamageObservedPublicEvent {
  readonly type: 'actor.damage-observed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly amount: number;
  readonly health: number;
}
export interface ActorDeathObservedPublicEvent {
  readonly type: 'actor.death-observed';
  readonly eventId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly displayName?: string;
}
export interface PopulationNoticePublicEvent {
  readonly type: 'population.notice';
  readonly eventId: OpaqueId;
  readonly category:
    | 'created'
    | 'encountered'
    | 'leader-created'
    | 'leader-defeated'
    | 'group-outcome'
    | 'swarm-growth'
    | 'swarm-cap'
    | 'source-destroyed'
    | 'boss-encountered'
    | 'boss-phase'
    | 'boss-recovery'
    | 'boss-defeated'
    | 'boss-reward'
    | 'champion-encountered'
    | 'champion-defeated'
    | 'champion-heirloom'
    | 'echo-encountered'
    | 'echo-defeated'
    | 'echo-loot'
    | 'merchant-departure-warning'
    | 'merchant-departed'
    | 'merchant-provoked'
    | 'merchant-stock-dropped'
    | 'merchant-died'
    | 'merchant-restocked';
  readonly actorId: OpaqueId | null;
  readonly presentation: string;
  readonly displayName?: string;
}
export interface ReputationChangedEvent {
  readonly type: 'reputation.changed';
  readonly eventId: OpaqueId;
  readonly factionId: OpaqueId;
  readonly previous: number;
  readonly delta: number;
  readonly value: number;
  readonly reason: 'commerce' | 'aggression' | 'death';
}
export interface TradeOpenedEvent {
  readonly type: 'trade.opened';
  readonly eventId: OpaqueId;
  readonly merchantPopulationId: OpaqueId;
  readonly merchantActorId: OpaqueId;
}
export interface TradeBoughtEvent {
  readonly type: 'trade.bought';
  readonly eventId: OpaqueId;
  readonly merchantPopulationId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
  readonly currency: number;
}
export interface TradeSoldEvent {
  readonly type: 'trade.sold';
  readonly eventId: OpaqueId;
  readonly merchantPopulationId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly contentId: OpaqueId;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
  readonly currency: number;
}
export interface TradeServicePurchasedEvent {
  readonly type: 'trade.service-purchased';
  readonly eventId: OpaqueId;
  readonly merchantPopulationId: OpaqueId;
  readonly serviceId: MerchantServiceId;
  /** `null` for a service with no single target item (e.g. a strongbox purchase). */
  readonly targetItemId: OpaqueId | null;
  readonly price: number;
  readonly currency: number;
  readonly remainingUses: number;
}
export type TradeCloseReason = 'player' | 'aggression' | 'death' | 'unavailable' | 'departure';
export interface TradeClosedEvent {
  readonly type: 'trade.closed';
  readonly eventId: OpaqueId;
  readonly merchantPopulationId: OpaqueId;
  readonly reason: TradeCloseReason;
  readonly completedCommerce: boolean;
}
export type TradeDomainEvent =
  | TradeOpenedEvent
  | TradeBoughtEvent
  | TradeSoldEvent
  | TradeServicePurchasedEvent
  | TradeClosedEvent;
export interface MerchantDepartureWarningEvent {
  readonly type: 'merchant.departure-warning';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly threshold: number;
  readonly remaining: number;
}
export interface MerchantDepartedEvent {
  readonly type: 'merchant.departed';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly stockItemIds: readonly OpaqueId[];
}
export interface MerchantProvokedEvent {
  readonly type: 'merchant.provoked';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly sourceActorId: OpaqueId;
  readonly response: 'flee' | 'self-defense';
}
export interface MerchantStockDroppedEvent {
  readonly type: 'merchant.stock-dropped';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly itemIds: readonly OpaqueId[];
  readonly units: number;
}
export interface MerchantDiedEvent {
  readonly type: 'merchant.died';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly killerActorId: OpaqueId;
  readonly destroyedStockItemIds: readonly OpaqueId[];
}
export interface MerchantRestockedEvent {
  readonly type: 'merchant.restocked';
  readonly eventId: OpaqueId;
  readonly populationId: OpaqueId;
  readonly actorId: OpaqueId;
  readonly stockItemIds: readonly OpaqueId[];
}
export type MerchantLifecycleDomainEvent =
  | MerchantDepartureWarningEvent
  | MerchantDepartedEvent
  | MerchantProvokedEvent
  | MerchantStockDroppedEvent
  | MerchantDiedEvent
  | MerchantRestockedEvent;
export interface RestCompletedEvent {
  readonly type: 'rest.completed';
  readonly eventId: OpaqueId;
  readonly stopReason:
    | 'full-health'
    | 'maximum-duration'
    | 'visible-danger'
    | 'aware-hostile'
    | 'damage'
    | 'meaningful-sound'
    | 'hunger-warning'
    | 'fuel-warning'
    | 'condition-change'
    | 'decision-required'
    | 'hero-death';
  readonly elapsed: number;
  readonly effectiveHealing: number;
}

export interface RunConcludedEvent {
  readonly type: 'run.concluded';
  readonly eventId: OpaqueId;
  readonly completionType: CompletionType;
  readonly cause: RunConclusionCause;
}
export interface RunFinalizedEvent {
  readonly type: 'run.finalized';
  readonly eventId: OpaqueId;
  readonly recordId: OpaqueId;
  readonly completionType: CompletionType;
  readonly scoreTotal: number;
}
export interface AchievementGrantedEvent {
  readonly type: 'achievement.granted';
  readonly eventId: OpaqueId;
  readonly achievementId: OpaqueId;
  readonly criteriaId: AchievementCriteriaId;
  readonly name: string;
}
export type RunRecordDomainEvent = RunConcludedEvent | RunFinalizedEvent | AchievementGrantedEvent;

export type DomainEvent =
  | HeroMovedEvent
  | HeroWaitedEvent
  | InvalidActionEvent
  | AttackMissedEvent
  | AttackHitEvent
  | ActorDamagedEvent
  | ActorDiedEvent
  | ActorHealedEvent
  | LootDroppedEvent
  | ConditionAppliedEvent
  | ConditionRemovedEvent
  | ActorForcedMoveEvent
  | ReactionTriggeredEvent
  | RelationshipChangedEvent
  | ActorTurnStartedEvent
  | ActorTurnCompletedEvent
  | ActorMovedEvent
  | ItemPickedUpEvent
  | ItemDroppedEvent
  | ItemStackSplitEvent
  | ItemConsumedEvent
  | ItemThrownEvent
  | ItemUsedEvent
  | ItemEquippedEvent
  | ItemUnequippedEvent
  | ItemLightToggledEvent
  | ItemRefueledEvent
  | IdentificationAppearanceRevealedEvent
  | ItemIdentifiedEvent
  | HungerStageChangedEvent
  | HungerRestoredEvent
  | FuelWarningEvent
  | ItemLightExtinguishedEvent
  | ItemDamagedEvent
  | DoorStateChangedEvent
  | FeatureRevealedEvent
  | FeatureSearchEvent
  | TrapStateEvent
  | LockOutcomeEvent
  | PopulationDomainEvent
  | ReputationChangedEvent
  | TradeDomainEvent
  | MerchantLifecycleDomainEvent
  | RestCompletedEvent
  | RunRecordDomainEvent;

export type PublicEvent =
  | Exclude<
      DomainEvent,
      AttackMissedEvent | AttackHitEvent | PopulationDomainEvent | MerchantLifecycleDomainEvent
    >
  | ActorIntentChangedEvent
  | SoundHeardEvent
  | HeroDamagedPublicEvent
  | CombatObservedPublicEvent
  | ActorMovementObservedPublicEvent
  | ActorDamageObservedPublicEvent
  | ActorDeathObservedPublicEvent
  | PopulationNoticePublicEvent;
