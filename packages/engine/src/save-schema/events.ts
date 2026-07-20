import { z } from 'zod';
import { ACHIEVEMENT_CRITERIA_IDS } from '@woven-deep/content';
import {
  blockReason,
  completionType,
  direction,
  equipmentSlot,
  heroName,
  identifier,
  merchantServiceId,
  point,
  positiveQuantity,
  runConclusionCause,
  safeNonNegative,
} from './primitives.js';
import { command } from './commands.js';

export const movedEvent = z.strictObject({
  type: z.literal('hero.moved'),
  eventId: identifier,
  heroId: identifier,
  from: point,
  to: point,
});
export const waitedEvent = z.strictObject({
  type: z.literal('hero.waited'),
  eventId: identifier,
  heroId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
});
export const invalidEvent = z.strictObject({
  type: z.literal('action.invalid'),
  eventId: identifier,
  commandId: identifier,
  reason: blockReason,
});
export const attackBase = {
  eventId: identifier,
  actorId: identifier,
  targetActorId: identifier,
  naturalRoll: z.number().int().min(1).max(20),
  total: z.number().int().safe(),
  defense: z.number().int().safe(),
} as const;
export const attackMissedEvent = z.strictObject({
  ...attackBase,
  type: z.literal('attack.missed'),
});
export const attackHitEvent = z.strictObject({
  ...attackBase,
  type: z.literal('attack.hit'),
  critical: z.boolean(),
  rolledDice: positiveQuantity,
  rolledDamage: safeNonNegative,
  effectiveDamage: safeNonNegative,
  damageType: z.enum(['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane']),
});
export const actorDamagedEvent = z.strictObject({
  type: z.literal('actor.damaged'),
  eventId: identifier,
  actorId: identifier,
  sourceActorId: identifier,
  amount: safeNonNegative,
  health: safeNonNegative,
});
export const actorDiedEvent = z.strictObject({
  type: z.literal('actor.died'),
  eventId: identifier,
  actorId: identifier,
  contentId: identifier,
  killerActorId: identifier,
});
export const actorHealedEvent = z.strictObject({
  type: z.literal('actor.healed'),
  eventId: identifier,
  actorId: identifier,
  sourceActorId: identifier,
  amount: safeNonNegative,
  health: safeNonNegative,
});
export const lootDroppedEvent = z.strictObject({
  type: z.literal('loot.dropped'),
  eventId: identifier,
  actorId: identifier,
  contentId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  itemIds: z.array(identifier),
});
export const conditionAppliedEvent = z.strictObject({
  type: z.literal('condition.applied'),
  eventId: identifier,
  actorId: identifier,
  sourceActorId: identifier,
  conditionId: identifier,
  stacks: positiveQuantity,
  expiresAt: safeNonNegative.nullable(),
});
export const conditionRemovedEvent = z.strictObject({
  type: z.enum(['condition.removed', 'condition.expired']),
  eventId: identifier,
  actorId: identifier,
  conditionId: identifier,
});
export const actorForcedMoveEvent = z.strictObject({
  type: z.literal('actor.forced-move'),
  eventId: identifier,
  actorId: identifier,
  from: point,
  to: point,
});
export const reactionTriggeredEvent = z.strictObject({
  type: z.literal('reaction.triggered'),
  eventId: identifier,
  actorId: identifier,
  targetActorId: identifier,
});
export const relationshipChangedEvent = z.strictObject({
  type: z.literal('relationship.changed'),
  eventId: identifier,
  actorId: identifier,
  targetActorId: identifier,
  relationship: z.enum(['friendly', 'neutral', 'hostile']),
});
export const actorTurnStartedEvent = z.strictObject({
  type: z.literal('actor.turn.started'),
  eventId: identifier,
  actorId: identifier,
});
export const actorTurnCompletedEvent = z.strictObject({
  type: z.literal('actor.turn.completed'),
  eventId: identifier,
  actorId: identifier,
  actionType: z.enum([
    'move',
    'wait',
    'bump-attack',
    'pickup',
    'drop',
    'split-stack',
    'fire',
    'throw-item',
    'use-item',
    'equip',
    'unequip',
    'toggle-light',
    'refuel',
    'open-door',
    'close-door',
    'search',
    'disarm',
    'swarm-spawn',
  ]),
});
export const actorMovedEvent = z.strictObject({
  type: z.literal('actor.moved'),
  eventId: identifier,
  actorId: identifier,
  from: point,
  to: point,
});
export const itemPickedUpEvent = z.strictObject({
  type: z.literal('item.picked-up'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  quantity: positiveQuantity,
});
export const itemDroppedEvent = z.strictObject({
  type: z.literal('item.dropped'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  quantity: positiveQuantity,
});
export const itemStackSplitEvent = z.strictObject({
  type: z.literal('item.stack-split'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  newItemId: identifier,
  quantity: positiveQuantity,
});
export const itemConsumedEvent = z.strictObject({
  type: z.literal('item.consumed'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  quantity: positiveQuantity,
});
export const itemThrownEvent = z.strictObject({
  type: z.literal('item.thrown'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  quantity: positiveQuantity,
  to: point,
});
export const itemUsedEvent = z.strictObject({
  type: z.literal('item.used'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  targetActorId: identifier,
});
export const itemEquippedEvent = z.strictObject({
  type: z.literal('item.equipped'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  slot: equipmentSlot,
});
export const itemUnequippedEvent = z.strictObject({
  type: z.literal('item.unequipped'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  slot: equipmentSlot,
});
export const itemLightToggledEvent = z.strictObject({
  type: z.literal('item.light-toggled'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  enabled: z.boolean(),
});
export const itemRefueledEvent = z.strictObject({
  type: z.literal('item.refueled'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  fuelItemId: identifier,
  quantity: positiveQuantity,
  fuel: safeNonNegative,
});
export const identificationAppearanceRevealedEvent = z.strictObject({
  type: z.literal('identification.appearance-revealed'),
  eventId: identifier,
  appearanceId: identifier,
  contentId: identifier,
});
export const itemIdentifiedEvent = z.strictObject({
  type: z.literal('item.identified'),
  eventId: identifier,
  itemId: identifier,
});
export const hungerStageChangedEvent = z.strictObject({
  type: z.literal('hunger.stage-changed'),
  eventId: identifier,
  actorId: identifier,
  previousStage: z.enum(['sated', 'hungry', 'weak', 'starving']),
  stage: z.enum(['sated', 'hungry', 'weak', 'starving']),
  reserve: safeNonNegative,
});
export const hungerRestoredEvent = z.strictObject({
  type: z.literal('hunger.restored'),
  eventId: identifier,
  actorId: identifier,
  amount: safeNonNegative,
  reserve: safeNonNegative,
});
export const fuelWarningEvent = z.strictObject({
  type: z.literal('fuel.warning'),
  eventId: identifier,
  itemId: identifier,
  threshold: safeNonNegative,
  fuel: safeNonNegative,
});
export const itemLightExtinguishedEvent = z.strictObject({
  type: z.literal('item.light-extinguished'),
  eventId: identifier,
  itemId: identifier,
});
export const doorOpenedEvent = z.strictObject({
  type: z.literal('door.opened'),
  eventId: identifier,
  actorId: identifier,
  featureId: identifier,
});
export const doorClosedEvent = z.strictObject({
  type: z.literal('door.closed'),
  eventId: identifier,
  actorId: identifier,
  featureId: identifier,
});
export const featureRevealedEvent = z.strictObject({
  type: z.literal('feature.revealed'),
  eventId: identifier,
  actorId: identifier,
  featureId: identifier,
});
export const featureSearchedEvent = z.strictObject({
  type: z.literal('feature.searched'),
  eventId: identifier,
  actorId: identifier,
});
export const trapTriggeredEvent = z.strictObject({
  type: z.literal('trap.triggered'),
  eventId: identifier,
  actorId: identifier,
  featureId: identifier,
});
export const trapDisarmedEvent = z.strictObject({
  type: z.literal('trap.disarmed'),
  eventId: identifier,
  actorId: identifier,
  featureId: identifier,
});
export const trapDisarmFailedEvent = z.strictObject({
  type: z.literal('trap.disarm-failed'),
  eventId: identifier,
  actorId: identifier,
  featureId: identifier,
});
export const itemDamagedEvent = z.strictObject({
  type: z.literal('item.damaged'),
  eventId: identifier,
  actorId: identifier,
  itemId: identifier,
  amount: safeNonNegative,
  condition: safeNonNegative,
});
export const actorIntentChangedEvent = z.strictObject({
  type: z.literal('actor.intent-changed'),
  eventId: identifier,
  actorId: identifier,
  intent: z.enum([
    'approach',
    'attack',
    'hold',
    'regroup',
    'flee',
    'protect',
    'spawn',
    'phase-change',
  ]),
  presentation: z.enum([
    'intent.approach',
    'intent.attack',
    'intent.hold',
    'intent.regroup',
    'intent.flee',
    'intent.protect',
    'intent.spawn',
    'intent.phase-change',
  ]),
  targetCategory: z.enum(['hero', 'leader', 'source', 'position']).nullable(),
});
export const populationCreatedEvent = z.strictObject({
  type: z.literal('population.created'),
  eventId: identifier,
  populationId: identifier,
  encounterId: identifier,
  floorId: identifier,
  model: z.enum(['individual', 'group', 'swarm', 'boss', 'champion', 'echo', 'merchant']),
  actorIds: z.array(identifier).readonly(),
});
export const populationEncounteredEvent = z.strictObject({
  type: z.literal('population.encountered'),
  eventId: identifier,
  populationId: identifier,
  encounterId: identifier,
  actorId: identifier,
});
export const populationPlacementSkippedEvent = z.strictObject({
  type: z.literal('population.placement-skipped'),
  eventId: identifier,
  encounterId: identifier,
  floorId: identifier,
  reason: z.enum(['no-eligible-encounter', 'no-valid-placement', 'required-route-blocked']),
});
export const groupAwarenessSharedEvent = z.strictObject({
  type: z.literal('group.awareness-shared'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  targetActorId: identifier,
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  observedAt: safeNonNegative,
  observerActorId: identifier,
});
export const groupLeaderCreatedEvent = z.strictObject({
  type: z.literal('group.leader-created'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  roleId: z.string().min(1).max(80),
});
export const groupLeaderDefeatedEvent = z.strictObject({
  type: z.literal('group.leader-defeated'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
});
export const groupOutcomeAppliedEvent = z.strictObject({
  type: z.literal('group.outcome-applied'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  response: z.enum(['weaken', 'panic', 'disband', 'surrender', 'frenzy', 'collapse']),
  individualRewards: z.boolean(),
  collapsedMemberCount: safeNonNegative,
});
export const swarmMembersCreatedEvent = z.strictObject({
  type: z.literal('swarm.members-created'),
  eventId: identifier,
  populationId: identifier,
  sourceActorId: identifier,
  actorIds: z.array(identifier).readonly(),
  quantity: safeNonNegative,
});
export const swarmCapReachedEvent = z.strictObject({
  type: z.literal('swarm.cap-reached'),
  eventId: identifier,
  populationId: identifier,
  sourceActorId: identifier,
  level: z.enum(['source', 'encounter', 'floor']),
});
export const swarmSourceDestroyedEvent = z.strictObject({
  type: z.literal('swarm.source-destroyed'),
  eventId: identifier,
  populationId: identifier,
  sourceActorId: identifier,
  response: z.enum(['stop', 'flee', 'decay', 'frenzy']),
});
export const bossEncounteredEvent = z.strictObject({
  type: z.literal('boss.encountered'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  encounterId: identifier,
});
export const bossPhaseChangedEvent = z.strictObject({
  type: z.literal('boss.phase-changed'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  encounterId: identifier,
  phaseId: z.string().min(1).max(80),
});
export const bossRecoveredEvent = z.strictObject({
  type: z.literal('boss.recovered'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  encounterId: identifier,
  amount: safeNonNegative,
  health: safeNonNegative,
});
export const bossDefeatedEvent = z.strictObject({
  type: z.literal('boss.defeated'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  encounterId: identifier,
});
export const bossRewardCreatedEvent = z.strictObject({
  type: z.literal('boss.reward-created'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  encounterId: identifier,
  uniqueItemId: identifier,
  itemIds: z.array(identifier).readonly(),
});
export const championEncounteredEvent = z.strictObject({
  type: z.literal('champion.encountered'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  hallRecordId: identifier,
  rank: z.literal(1),
});
export const championDefeatedEvent = z.strictObject({
  type: z.literal('champion.defeated'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  hallRecordId: identifier,
  rank: z.literal(1),
});
export const championHeirloomCreatedEvent = z.strictObject({
  type: z.literal('champion.heirloom-created'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  hallRecordId: identifier,
  rank: z.literal(1),
  itemId: identifier,
  contentId: identifier,
  originatingHallRecordId: identifier,
  displayName: heroName,
  glyph: z.string().refine((value) => [...value].length === 1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fallback: z.boolean(),
});
export const echoEncounteredEvent = z.strictObject({
  type: z.literal('echo.encountered'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  hallRecordId: identifier,
  rank: z.number().int().min(2).max(10),
});
export const echoDefeatedEvent = z.strictObject({
  type: z.literal('echo.defeated'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  hallRecordId: identifier,
  rank: z.number().int().min(2).max(10),
});
export const echoLootCreatedEvent = z.strictObject({
  type: z.literal('echo.loot-created'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  hallRecordId: identifier,
  rank: z.number().int().min(2).max(10),
  itemIds: z.array(identifier).readonly(),
});
export const soundHeardEvent = z.strictObject({
  type: z.literal('sound.heard'),
  category: z.enum(['combat', 'movement', 'mechanism']),
  direction: z.enum([
    'north',
    'northeast',
    'east',
    'southeast',
    'south',
    'southwest',
    'west',
    'northwest',
    'here',
  ]),
  distanceBand: z.enum(['near', 'medium', 'far']),
});
export const heroDamagedPublicEvent = z.strictObject({
  type: z.literal('hero.damaged'),
  amount: safeNonNegative,
  damageType: z.enum(['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane']),
});
export const combatObservedPublicEvent = z.strictObject({
  type: z.literal('combat.observed'),
  eventId: identifier,
  outcome: z.enum(['hit', 'missed']),
  attackerActorId: identifier,
  targetActorId: identifier,
  attackerName: z.string().min(1).max(120).optional(),
  targetName: z.string().min(1).max(120).optional(),
});
export const actorMovementObservedPublicEvent = z.strictObject({
  type: z.literal('actor.movement-observed'),
  eventId: identifier,
  actorId: identifier,
  direction,
  visibility: z.enum(['entered', 'left']),
});
export const actorDamageObservedPublicEvent = z.strictObject({
  type: z.literal('actor.damage-observed'),
  eventId: identifier,
  actorId: identifier,
  amount: safeNonNegative,
  health: safeNonNegative,
});
export const actorDeathObservedPublicEvent = z.strictObject({
  type: z.literal('actor.death-observed'),
  eventId: identifier,
  actorId: identifier,
  contentId: identifier,
  displayName: z.string().min(1).max(120).optional(),
});
export const populationNoticePublicEvent = z.strictObject({
  type: z.literal('population.notice'),
  eventId: identifier,
  category: z.enum([
    'created',
    'encountered',
    'leader-created',
    'leader-defeated',
    'group-outcome',
    'swarm-growth',
    'swarm-cap',
    'source-destroyed',
    'boss-encountered',
    'boss-phase',
    'boss-recovery',
    'boss-defeated',
    'boss-reward',
    'champion-encountered',
    'champion-defeated',
    'champion-heirloom',
    'echo-encountered',
    'echo-defeated',
    'echo-loot',
    'merchant-departure-warning',
    'merchant-departed',
    'merchant-provoked',
    'merchant-stock-dropped',
    'merchant-died',
    'merchant-restocked',
  ]),
  actorId: identifier.nullable(),
  presentation: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120).optional(),
});
export const reputationChangedEvent = z.strictObject({
  type: z.literal('reputation.changed'),
  eventId: identifier,
  factionId: identifier,
  previous: z.number().int().safe(),
  delta: z.number().int().safe(),
  value: z.number().int().safe(),
  reason: z.enum(['commerce', 'aggression', 'death']),
});
export const tradeOpenedEvent = z.strictObject({
  type: z.literal('trade.opened'),
  eventId: identifier,
  merchantPopulationId: identifier,
  merchantActorId: identifier,
});
export const tradeCommerceFields = {
  eventId: identifier,
  merchantPopulationId: identifier,
  itemId: identifier,
  contentId: identifier,
  quantity: positiveQuantity,
  unitPrice: safeNonNegative,
  total: safeNonNegative,
  currency: safeNonNegative,
} as const;
export const tradeBoughtEvent = z.strictObject({
  type: z.literal('trade.bought'),
  ...tradeCommerceFields,
});
export const tradeSoldEvent = z.strictObject({
  type: z.literal('trade.sold'),
  ...tradeCommerceFields,
});
export const tradeServicePurchasedEvent = z.strictObject({
  type: z.literal('trade.service-purchased'),
  eventId: identifier,
  merchantPopulationId: identifier,
  serviceId: merchantServiceId,
  targetItemId: identifier.nullable(),
  price: safeNonNegative,
  currency: safeNonNegative,
  remainingUses: safeNonNegative,
});
export const tradeClosedEvent = z.strictObject({
  type: z.literal('trade.closed'),
  eventId: identifier,
  merchantPopulationId: identifier,
  reason: z.enum(['player', 'aggression', 'death', 'unavailable', 'departure']),
  completedCommerce: z.boolean(),
});
export const merchantDepartureWarningEvent = z.strictObject({
  type: z.literal('merchant.departure-warning'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  threshold: safeNonNegative,
  remaining: safeNonNegative,
});
export const merchantDepartedEvent = z.strictObject({
  type: z.literal('merchant.departed'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  stockItemIds: z.array(identifier).readonly(),
});
export const merchantProvokedEvent = z.strictObject({
  type: z.literal('merchant.provoked'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  sourceActorId: identifier,
  response: z.enum(['flee', 'self-defense']),
});
export const merchantStockDroppedEvent = z.strictObject({
  type: z.literal('merchant.stock-dropped'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  itemIds: z.array(identifier).readonly(),
  units: safeNonNegative,
});
export const merchantDiedEvent = z.strictObject({
  type: z.literal('merchant.died'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  killerActorId: identifier,
  destroyedStockItemIds: z.array(identifier).readonly(),
});
export const merchantRestockedEvent = z.strictObject({
  type: z.literal('merchant.restocked'),
  eventId: identifier,
  populationId: identifier,
  actorId: identifier,
  stockItemIds: z.array(identifier).readonly(),
});
export const restCompletedEvent = z.strictObject({
  type: z.literal('rest.completed'),
  eventId: identifier,
  stopReason: z.enum([
    'full-health',
    'maximum-duration',
    'visible-danger',
    'aware-hostile',
    'damage',
    'meaningful-sound',
    'hunger-warning',
    'fuel-warning',
    'condition-change',
    'decision-required',
    'hero-death',
  ]),
  elapsed: safeNonNegative,
  effectiveHealing: safeNonNegative,
});
export const runConcludedEvent = z.strictObject({
  type: z.literal('run.concluded'),
  eventId: identifier,
  completionType,
  cause: runConclusionCause,
});
export const runFinalizedEvent = z.strictObject({
  type: z.literal('run.finalized'),
  eventId: identifier,
  recordId: identifier,
  completionType,
  scoreTotal: safeNonNegative,
});
export const achievementGrantedEvent = z.strictObject({
  type: z.literal('achievement.granted'),
  eventId: identifier,
  achievementId: identifier,
  criteriaId: z.enum(ACHIEVEMENT_CRITERIA_IDS),
  name: heroName,
});
export const eventOptions = [
  movedEvent,
  waitedEvent,
  invalidEvent,
  attackMissedEvent,
  attackHitEvent,
  actorDamagedEvent,
  actorDiedEvent,
  actorHealedEvent,
  lootDroppedEvent,
  conditionAppliedEvent,
  conditionRemovedEvent,
  actorForcedMoveEvent,
  reactionTriggeredEvent,
  relationshipChangedEvent,
  actorTurnStartedEvent,
  actorTurnCompletedEvent,
  actorMovedEvent,
  itemPickedUpEvent,
  itemDroppedEvent,
  itemStackSplitEvent,
  itemConsumedEvent,
  itemThrownEvent,
  itemUsedEvent,
  itemEquippedEvent,
  itemUnequippedEvent,
  itemLightToggledEvent,
  itemRefueledEvent,
  identificationAppearanceRevealedEvent,
  itemIdentifiedEvent,
  hungerStageChangedEvent,
  hungerRestoredEvent,
  fuelWarningEvent,
  itemLightExtinguishedEvent,
  doorOpenedEvent,
  doorClosedEvent,
  featureRevealedEvent,
  featureSearchedEvent,
  trapTriggeredEvent,
  trapDisarmedEvent,
  trapDisarmFailedEvent,
  itemDamagedEvent,
  actorIntentChangedEvent,
  populationEncounteredEvent,
  populationPlacementSkippedEvent,
  groupAwarenessSharedEvent,
  groupLeaderCreatedEvent,
  groupLeaderDefeatedEvent,
  groupOutcomeAppliedEvent,
  swarmMembersCreatedEvent,
  swarmCapReachedEvent,
  swarmSourceDestroyedEvent,
  bossEncounteredEvent,
  bossPhaseChangedEvent,
  bossRecoveredEvent,
  bossDefeatedEvent,
  bossRewardCreatedEvent,
  championEncounteredEvent,
  championDefeatedEvent,
  championHeirloomCreatedEvent,
  echoEncounteredEvent,
  echoDefeatedEvent,
  echoLootCreatedEvent,
  soundHeardEvent,
  heroDamagedPublicEvent,
  combatObservedPublicEvent,
  actorMovementObservedPublicEvent,
  actorDamageObservedPublicEvent,
  actorDeathObservedPublicEvent,
  populationNoticePublicEvent,
  restCompletedEvent,
] as const;
export const event = z.discriminatedUnion('type', [
  ...eventOptions,
  populationCreatedEvent,
  reputationChangedEvent,
  tradeOpenedEvent,
  tradeBoughtEvent,
  tradeSoldEvent,
  tradeServicePurchasedEvent,
  tradeClosedEvent,
  merchantDepartureWarningEvent,
  merchantDepartedEvent,
  merchantProvokedEvent,
  merchantStockDroppedEvent,
  merchantDiedEvent,
  merchantRestockedEvent,
  runConcludedEvent,
  runFinalizedEvent,
  achievementGrantedEvent,
]);
export const hiddenPublicEventTypes = new Set([
  'attack.hit',
  'attack.missed',
  'population.created',
  'population.encountered',
  'population.placement-skipped',
  'group.awareness-shared',
  'group.leader-created',
  'group.leader-defeated',
  'group.outcome-applied',
  'swarm.members-created',
  'swarm.cap-reached',
  'swarm.source-destroyed',
  'boss.encountered',
  'boss.phase-changed',
  'boss.recovered',
  'boss.defeated',
  'boss.reward-created',
  'champion.encountered',
  'champion.defeated',
  'champion.heirloom-created',
  'echo.encountered',
  'echo.defeated',
  'echo.loot-created',
  'merchant.departure-warning',
  'merchant.departed',
  'merchant.provoked',
  'merchant.stock-dropped',
  'merchant.died',
  'merchant.restocked',
]);
export const publicOnlyEventTypes = new Set([
  'sound.heard',
  'hero.damaged',
  'combat.observed',
  'actor.movement-observed',
  'actor.damage-observed',
  'actor.death-observed',
  'population.notice',
]);
export const authoritativeEvent = event.refine(
  (value) => !publicOnlyEventTypes.has(value.type),
  'public projection event cannot be stored as authoritative',
);
export const publicEvent = event.refine(
  (value) => !hiddenPublicEventTypes.has(value.type),
  'authoritative or roll-bearing event must be projected before public storage',
);
export const appliedResult = z.strictObject({
  status: z.literal('applied'),
  commandId: identifier,
  revision: safeNonNegative,
  turn: safeNonNegative,
});
export const invalidResult = z.strictObject({
  status: z.literal('invalid'),
  commandId: identifier,
  revision: safeNonNegative,
  turn: safeNonNegative,
  reason: blockReason,
});
export const processedResult = z.discriminatedUnion('status', [appliedResult, invalidResult]);
export const recorded = z.strictObject({
  command,
  result: processedResult,
  events: z.array(authoritativeEvent).readonly(),
  publicEvents: z.array(publicEvent).readonly(),
});

import type {
  AchievementGrantedEvent,
  ActorDamagedEvent,
  ActorDamageObservedPublicEvent,
  ActorDeathObservedPublicEvent,
  ActorDiedEvent,
  ActorForcedMoveEvent,
  ActorHealedEvent,
  ActorIntentChangedEvent,
  ActorMovedEvent,
  ActorMovementObservedPublicEvent,
  ActorTurnCompletedEvent,
  ActorTurnStartedEvent,
  AttackHitEvent,
  AttackMissedEvent,
  BossDefeatedEvent,
  BossEncounteredEvent,
  BossPhaseChangedEvent,
  BossRecoveredEvent,
  BossRewardCreatedEvent,
  ChampionDefeatedEvent,
  ChampionEncounteredEvent,
  ChampionHeirloomCreatedEvent,
  CombatObservedPublicEvent,
  ConditionAppliedEvent,
  ConditionRemovedEvent,
  EchoDefeatedEvent,
  EchoEncounteredEvent,
  EchoLootCreatedEvent,
  FeatureRevealedEvent,
  FeatureSearchEvent,
  FuelWarningEvent,
  GroupAwarenessSharedEvent,
  GroupLeaderCreatedEvent,
  GroupLeaderDefeatedEvent,
  GroupOutcomeAppliedEvent,
  HeroDamagedPublicEvent,
  HeroMovedEvent,
  HeroWaitedEvent,
  HungerRestoredEvent,
  HungerStageChangedEvent,
  IdentificationAppearanceRevealedEvent,
  InvalidActionEvent,
  ItemConsumedEvent,
  ItemDamagedEvent,
  ItemDroppedEvent,
  ItemEquippedEvent,
  ItemIdentifiedEvent,
  ItemLightExtinguishedEvent,
  ItemLightToggledEvent,
  ItemPickedUpEvent,
  ItemRefueledEvent,
  ItemStackSplitEvent,
  ItemThrownEvent,
  ItemUnequippedEvent,
  ItemUsedEvent,
  LootDroppedEvent,
  MerchantDepartedEvent,
  MerchantDepartureWarningEvent,
  MerchantDiedEvent,
  MerchantProvokedEvent,
  MerchantRestockedEvent,
  MerchantStockDroppedEvent,
  PopulationCreatedEvent,
  PopulationEncounteredEvent,
  PopulationNoticePublicEvent,
  PopulationPlacementSkippedEvent,
  ProcessedCommandResult,
  ReactionTriggeredEvent,
  RelationshipChangedEvent,
  ReputationChangedEvent,
  RestCompletedEvent,
  RunConcludedEvent,
  RunFinalizedEvent,
  SoundHeardEvent,
  SwarmCapReachedEvent,
  SwarmMembersCreatedEvent,
  SwarmSourceDestroyedEvent,
  TradeBoughtEvent,
  TradeClosedEvent,
  TradeOpenedEvent,
  TradeServicePurchasedEvent,
  TradeSoldEvent,
} from '../model.js';
import type { Expect, SchemaMatches } from './drift.js';
// The `event` union is a deliberately broader storage superset: it carries both
// authoritative and public events, and splits grouped interfaces such as
// `DoorStateChangedEvent`/`TrapStateEvent` into one member per type literal. It
// therefore cannot be bound structurally to `DomainEvent` as a whole — the same
// mismatch that forces `validateSemantics` to cast its result to `ActiveRun`.
// Individual event shapes that are 1:1 with their interface are bound instead.
type _ProcessedResultDrift = Expect<
  SchemaMatches<z.infer<typeof processedResult>, ProcessedCommandResult>
>;
type _HeroMovedDrift = Expect<SchemaMatches<z.infer<typeof movedEvent>, HeroMovedEvent>>;
type _InvalidActionDrift = Expect<SchemaMatches<z.infer<typeof invalidEvent>, InvalidActionEvent>>;
type _AttackHitDrift = Expect<SchemaMatches<z.infer<typeof attackHitEvent>, AttackHitEvent>>;
type _TradeBoughtDrift = Expect<SchemaMatches<z.infer<typeof tradeBoughtEvent>, TradeBoughtEvent>>;
type _RunConcludedDrift = Expect<
  SchemaMatches<z.infer<typeof runConcludedEvent>, RunConcludedEvent>
>;
type _HeroWaitedDrift = Expect<SchemaMatches<z.infer<typeof waitedEvent>, HeroWaitedEvent>>;
type _AttackMissedDrift = Expect<
  SchemaMatches<z.infer<typeof attackMissedEvent>, AttackMissedEvent>
>;
type _ActorDamagedDrift = Expect<
  SchemaMatches<z.infer<typeof actorDamagedEvent>, ActorDamagedEvent>
>;
type _ActorDiedDrift = Expect<SchemaMatches<z.infer<typeof actorDiedEvent>, ActorDiedEvent>>;
type _ActorHealedDrift = Expect<SchemaMatches<z.infer<typeof actorHealedEvent>, ActorHealedEvent>>;
type _LootDroppedDrift = Expect<SchemaMatches<z.infer<typeof lootDroppedEvent>, LootDroppedEvent>>;
type _ConditionAppliedDrift = Expect<
  SchemaMatches<z.infer<typeof conditionAppliedEvent>, ConditionAppliedEvent>
>;
type _ConditionRemovedDrift = Expect<
  SchemaMatches<z.infer<typeof conditionRemovedEvent>, ConditionRemovedEvent>
>;
type _ActorForcedMoveDrift = Expect<
  SchemaMatches<z.infer<typeof actorForcedMoveEvent>, ActorForcedMoveEvent>
>;
type _ReactionTriggeredDrift = Expect<
  SchemaMatches<z.infer<typeof reactionTriggeredEvent>, ReactionTriggeredEvent>
>;
type _RelationshipChangedDrift = Expect<
  SchemaMatches<z.infer<typeof relationshipChangedEvent>, RelationshipChangedEvent>
>;
type _ActorTurnStartedDrift = Expect<
  SchemaMatches<z.infer<typeof actorTurnStartedEvent>, ActorTurnStartedEvent>
>;
type _ActorTurnCompletedDrift = Expect<
  SchemaMatches<z.infer<typeof actorTurnCompletedEvent>, ActorTurnCompletedEvent>
>;
type _ActorMovedDrift = Expect<SchemaMatches<z.infer<typeof actorMovedEvent>, ActorMovedEvent>>;
type _ItemPickedUpDrift = Expect<
  SchemaMatches<z.infer<typeof itemPickedUpEvent>, ItemPickedUpEvent>
>;
type _ItemDroppedDrift = Expect<SchemaMatches<z.infer<typeof itemDroppedEvent>, ItemDroppedEvent>>;
type _ItemStackSplitDrift = Expect<
  SchemaMatches<z.infer<typeof itemStackSplitEvent>, ItemStackSplitEvent>
>;
type _ItemConsumedDrift = Expect<
  SchemaMatches<z.infer<typeof itemConsumedEvent>, ItemConsumedEvent>
>;
type _ItemThrownDrift = Expect<SchemaMatches<z.infer<typeof itemThrownEvent>, ItemThrownEvent>>;
type _ItemUsedDrift = Expect<SchemaMatches<z.infer<typeof itemUsedEvent>, ItemUsedEvent>>;
type _ItemEquippedDrift = Expect<
  SchemaMatches<z.infer<typeof itemEquippedEvent>, ItemEquippedEvent>
>;
type _ItemUnequippedDrift = Expect<
  SchemaMatches<z.infer<typeof itemUnequippedEvent>, ItemUnequippedEvent>
>;
type _ItemLightToggledDrift = Expect<
  SchemaMatches<z.infer<typeof itemLightToggledEvent>, ItemLightToggledEvent>
>;
type _ItemRefueledDrift = Expect<
  SchemaMatches<z.infer<typeof itemRefueledEvent>, ItemRefueledEvent>
>;
type _IdentificationAppearanceRevealedDrift = Expect<
  SchemaMatches<
    z.infer<typeof identificationAppearanceRevealedEvent>,
    IdentificationAppearanceRevealedEvent
  >
>;
type _ItemIdentifiedDrift = Expect<
  SchemaMatches<z.infer<typeof itemIdentifiedEvent>, ItemIdentifiedEvent>
>;
type _HungerStageChangedDrift = Expect<
  SchemaMatches<z.infer<typeof hungerStageChangedEvent>, HungerStageChangedEvent>
>;
type _HungerRestoredDrift = Expect<
  SchemaMatches<z.infer<typeof hungerRestoredEvent>, HungerRestoredEvent>
>;
type _FuelWarningDrift = Expect<SchemaMatches<z.infer<typeof fuelWarningEvent>, FuelWarningEvent>>;
type _ItemLightExtinguishedDrift = Expect<
  SchemaMatches<z.infer<typeof itemLightExtinguishedEvent>, ItemLightExtinguishedEvent>
>;
type _FeatureRevealedDrift = Expect<
  SchemaMatches<z.infer<typeof featureRevealedEvent>, FeatureRevealedEvent>
>;
type _FeatureSearchDrift = Expect<
  SchemaMatches<z.infer<typeof featureSearchedEvent>, FeatureSearchEvent>
>;
type _ItemDamagedDrift = Expect<SchemaMatches<z.infer<typeof itemDamagedEvent>, ItemDamagedEvent>>;
type _ActorIntentChangedDrift = Expect<
  SchemaMatches<z.infer<typeof actorIntentChangedEvent>, ActorIntentChangedEvent>
>;
type _PopulationCreatedDrift = Expect<
  SchemaMatches<z.infer<typeof populationCreatedEvent>, PopulationCreatedEvent>
>;
type _PopulationEncounteredDrift = Expect<
  SchemaMatches<z.infer<typeof populationEncounteredEvent>, PopulationEncounteredEvent>
>;
type _PopulationPlacementSkippedDrift = Expect<
  SchemaMatches<z.infer<typeof populationPlacementSkippedEvent>, PopulationPlacementSkippedEvent>
>;
type _GroupAwarenessSharedDrift = Expect<
  SchemaMatches<z.infer<typeof groupAwarenessSharedEvent>, GroupAwarenessSharedEvent>
>;
type _GroupLeaderCreatedDrift = Expect<
  SchemaMatches<z.infer<typeof groupLeaderCreatedEvent>, GroupLeaderCreatedEvent>
>;
type _GroupLeaderDefeatedDrift = Expect<
  SchemaMatches<z.infer<typeof groupLeaderDefeatedEvent>, GroupLeaderDefeatedEvent>
>;
type _GroupOutcomeAppliedDrift = Expect<
  SchemaMatches<z.infer<typeof groupOutcomeAppliedEvent>, GroupOutcomeAppliedEvent>
>;
type _SwarmMembersCreatedDrift = Expect<
  SchemaMatches<z.infer<typeof swarmMembersCreatedEvent>, SwarmMembersCreatedEvent>
>;
type _SwarmCapReachedDrift = Expect<
  SchemaMatches<z.infer<typeof swarmCapReachedEvent>, SwarmCapReachedEvent>
>;
type _SwarmSourceDestroyedDrift = Expect<
  SchemaMatches<z.infer<typeof swarmSourceDestroyedEvent>, SwarmSourceDestroyedEvent>
>;
type _BossEncounteredDrift = Expect<
  SchemaMatches<z.infer<typeof bossEncounteredEvent>, BossEncounteredEvent>
>;
type _BossPhaseChangedDrift = Expect<
  SchemaMatches<z.infer<typeof bossPhaseChangedEvent>, BossPhaseChangedEvent>
>;
type _BossRecoveredDrift = Expect<
  SchemaMatches<z.infer<typeof bossRecoveredEvent>, BossRecoveredEvent>
>;
type _BossDefeatedDrift = Expect<
  SchemaMatches<z.infer<typeof bossDefeatedEvent>, BossDefeatedEvent>
>;
type _BossRewardCreatedDrift = Expect<
  SchemaMatches<z.infer<typeof bossRewardCreatedEvent>, BossRewardCreatedEvent>
>;
type _ChampionEncounteredDrift = Expect<
  SchemaMatches<z.infer<typeof championEncounteredEvent>, ChampionEncounteredEvent>
>;
type _ChampionDefeatedDrift = Expect<
  SchemaMatches<z.infer<typeof championDefeatedEvent>, ChampionDefeatedEvent>
>;
type _ChampionHeirloomCreatedDrift = Expect<
  SchemaMatches<z.infer<typeof championHeirloomCreatedEvent>, ChampionHeirloomCreatedEvent>
>;
type _EchoEncounteredDrift = Expect<
  SchemaMatches<z.infer<typeof echoEncounteredEvent>, EchoEncounteredEvent>
>;
type _EchoDefeatedDrift = Expect<
  SchemaMatches<z.infer<typeof echoDefeatedEvent>, EchoDefeatedEvent>
>;
type _EchoLootCreatedDrift = Expect<
  SchemaMatches<z.infer<typeof echoLootCreatedEvent>, EchoLootCreatedEvent>
>;
type _SoundHeardDrift = Expect<SchemaMatches<z.infer<typeof soundHeardEvent>, SoundHeardEvent>>;
type _HeroDamagedPublicDrift = Expect<
  SchemaMatches<z.infer<typeof heroDamagedPublicEvent>, HeroDamagedPublicEvent>
>;
type _CombatObservedPublicDrift = Expect<
  SchemaMatches<z.infer<typeof combatObservedPublicEvent>, CombatObservedPublicEvent>
>;
type _ActorMovementObservedPublicDrift = Expect<
  SchemaMatches<z.infer<typeof actorMovementObservedPublicEvent>, ActorMovementObservedPublicEvent>
>;
type _ActorDamageObservedPublicDrift = Expect<
  SchemaMatches<z.infer<typeof actorDamageObservedPublicEvent>, ActorDamageObservedPublicEvent>
>;
type _ActorDeathObservedPublicDrift = Expect<
  SchemaMatches<z.infer<typeof actorDeathObservedPublicEvent>, ActorDeathObservedPublicEvent>
>;
type _PopulationNoticePublicDrift = Expect<
  SchemaMatches<z.infer<typeof populationNoticePublicEvent>, PopulationNoticePublicEvent>
>;
type _ReputationChangedDrift = Expect<
  SchemaMatches<z.infer<typeof reputationChangedEvent>, ReputationChangedEvent>
>;
type _TradeOpenedDrift = Expect<SchemaMatches<z.infer<typeof tradeOpenedEvent>, TradeOpenedEvent>>;
type _TradeSoldDrift = Expect<SchemaMatches<z.infer<typeof tradeSoldEvent>, TradeSoldEvent>>;
type _TradeServicePurchasedDrift = Expect<
  SchemaMatches<z.infer<typeof tradeServicePurchasedEvent>, TradeServicePurchasedEvent>
>;
type _TradeClosedDrift = Expect<SchemaMatches<z.infer<typeof tradeClosedEvent>, TradeClosedEvent>>;
type _MerchantDepartureWarningDrift = Expect<
  SchemaMatches<z.infer<typeof merchantDepartureWarningEvent>, MerchantDepartureWarningEvent>
>;
type _MerchantDepartedDrift = Expect<
  SchemaMatches<z.infer<typeof merchantDepartedEvent>, MerchantDepartedEvent>
>;
type _MerchantProvokedDrift = Expect<
  SchemaMatches<z.infer<typeof merchantProvokedEvent>, MerchantProvokedEvent>
>;
type _MerchantStockDroppedDrift = Expect<
  SchemaMatches<z.infer<typeof merchantStockDroppedEvent>, MerchantStockDroppedEvent>
>;
type _MerchantDiedDrift = Expect<
  SchemaMatches<z.infer<typeof merchantDiedEvent>, MerchantDiedEvent>
>;
type _MerchantRestockedDrift = Expect<
  SchemaMatches<z.infer<typeof merchantRestockedEvent>, MerchantRestockedEvent>
>;
type _RestCompletedDrift = Expect<
  SchemaMatches<z.infer<typeof restCompletedEvent>, RestCompletedEvent>
>;
type _RunFinalizedDrift = Expect<
  SchemaMatches<z.infer<typeof runFinalizedEvent>, RunFinalizedEvent>
>;
type _AchievementGrantedDrift = Expect<
  SchemaMatches<z.infer<typeof achievementGrantedEvent>, AchievementGrantedEvent>
>;
