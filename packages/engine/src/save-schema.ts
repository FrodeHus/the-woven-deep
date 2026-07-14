import { z } from 'zod';
import { validateKnowledgePacking } from './knowledge.js';
import { tileIndex, type ActiveRun, type Direction } from './model.js';
import { SaveLoadError } from './save-error.js';
import { movementBlockReason, tileDefinition } from './terrain.js';
import { ENGINE_GAME_VERSION, RECENT_COMMAND_LIMIT, RNG_STREAM_NAMES, SAVE_SCHEMA_VERSION } from './versions.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const heroName = z.string().refine((name) => [...name].length >= 1 && [...name].length <= 40 && name.normalize('NFC') === name && !/[\p{Cc}\p{Cf}]/u.test(name));
const safeNonNegative = z.number().int().safe().nonnegative();
const uint8 = z.number().int().min(0).max(255);
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const uint32Tuple = z.tuple([uint32, uint32, uint32, uint32]);
const uint32State = uint32Tuple.refine((state) => state.some((word) => word !== 0), 'state must not be all zero');
const point = z.strictObject({ x: safeNonNegative, y: safeNonNegative });
const direction = z.enum(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);
const equipmentSlot = z.enum(['main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring']);
const positiveQuantity = z.number().int().safe().positive();
const moveCommand = z.strictObject({ type: z.literal('move'), commandId: identifier, expectedRevision: safeNonNegative, direction });
const waitCommand = z.strictObject({ type: z.literal('wait'), commandId: identifier, expectedRevision: safeNonNegative });
const commandBase = { commandId: identifier, expectedRevision: safeNonNegative } as const;
const command = z.discriminatedUnion('type', [
  moveCommand, waitCommand,
  z.strictObject({ ...commandBase, type: z.literal('attack'), targetActorId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('fire'), itemId: identifier, target: point }),
  z.strictObject({ ...commandBase, type: z.literal('cast'), spellId: identifier, target: point.nullable() }),
  z.strictObject({ ...commandBase, type: z.literal('throw-item'), itemId: identifier, quantity: positiveQuantity, target: point }),
  z.strictObject({ ...commandBase, type: z.literal('use-item'), itemId: identifier, target: point.nullable() }),
  z.strictObject({ ...commandBase, type: z.literal('equip'), itemId: identifier, slot: equipmentSlot }),
  z.strictObject({ ...commandBase, type: z.literal('unequip'), slot: equipmentSlot }),
  z.strictObject({ ...commandBase, type: z.literal('pickup'), itemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('drop'), itemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('split-stack'), itemId: identifier, quantity: positiveQuantity, newItemId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('refuel'), itemId: identifier, fuelItemId: identifier, quantity: positiveQuantity }),
  z.strictObject({ ...commandBase, type: z.literal('toggle-light'), itemId: identifier, enabled: z.boolean() }),
  z.strictObject({ ...commandBase, type: z.literal('open-door'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('close-door'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('search') }),
  z.strictObject({ ...commandBase, type: z.literal('disarm'), featureId: identifier }),
  z.strictObject({ ...commandBase, type: z.literal('rest'), until: z.enum(['healed', 'interrupted']),
    maximumDuration: positiveQuantity }),
]);
const movedEvent = z.strictObject({ type: z.literal('hero.moved'), eventId: identifier, heroId: identifier, from: point, to: point });
const waitedEvent = z.strictObject({ type: z.literal('hero.waited'), eventId: identifier, heroId: identifier, x: safeNonNegative, y: safeNonNegative });
const blockReason = z.enum([
  'blocked.bounds', 'blocked.wall', 'blocked.door', 'blocked.pillar', 'blocked.void',
  'blocked.corner', 'blocked.actor', 'action.unavailable', 'inventory.full', 'item.missing',
  'item.unavailable', 'item.quantity', 'item.incompatible', 'item.id-conflict',
  'target.not_visible', 'target.out_of_range', 'target.blocked', 'target.invalid',
]);
const invalidEvent = z.strictObject({ type: z.literal('action.invalid'), eventId: identifier, commandId: identifier, reason: blockReason });
const attackBase = { eventId: identifier, actorId: identifier, targetActorId: identifier,
  naturalRoll: z.number().int().min(1).max(20), total: z.number().int().safe(), defense: z.number().int().safe() } as const;
const attackMissedEvent = z.strictObject({ ...attackBase, type: z.literal('attack.missed') });
const attackHitEvent = z.strictObject({
  ...attackBase, type: z.literal('attack.hit'), critical: z.boolean(), rolledDice: positiveQuantity,
  rolledDamage: safeNonNegative, effectiveDamage: safeNonNegative,
  damageType: z.enum(['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane']),
});
const actorDamagedEvent = z.strictObject({ type: z.literal('actor.damaged'), eventId: identifier,
  actorId: identifier, sourceActorId: identifier, amount: safeNonNegative, health: safeNonNegative });
const actorDiedEvent = z.strictObject({ type: z.literal('actor.died'), eventId: identifier,
  actorId: identifier, contentId: identifier, killerActorId: identifier });
const actorHealedEvent = z.strictObject({ type: z.literal('actor.healed'), eventId: identifier,
  actorId: identifier, sourceActorId: identifier, amount: safeNonNegative, health: safeNonNegative });
const conditionAppliedEvent = z.strictObject({ type: z.literal('condition.applied'), eventId: identifier,
  actorId: identifier, sourceActorId: identifier, conditionId: identifier, stacks: positiveQuantity, expiresAt: safeNonNegative.nullable() });
const conditionRemovedEvent = z.strictObject({ type: z.enum(['condition.removed', 'condition.expired']),
  eventId: identifier, actorId: identifier, conditionId: identifier });
const actorForcedMoveEvent = z.strictObject({ type: z.literal('actor.forced-move'), eventId: identifier,
  actorId: identifier, from: point, to: point });
const reactionTriggeredEvent = z.strictObject({ type: z.literal('reaction.triggered'), eventId: identifier,
  actorId: identifier, targetActorId: identifier });
const relationshipChangedEvent = z.strictObject({ type: z.literal('relationship.changed'), eventId: identifier,
  actorId: identifier, targetActorId: identifier, relationship: z.enum(['friendly', 'neutral', 'hostile']) });
const actorTurnStartedEvent = z.strictObject({ type: z.literal('actor.turn.started'), eventId: identifier,
  actorId: identifier });
const actorTurnCompletedEvent = z.strictObject({ type: z.literal('actor.turn.completed'), eventId: identifier,
  actorId: identifier, actionType: z.enum([
    'move', 'wait', 'bump-attack', 'pickup', 'drop', 'split-stack', 'fire', 'throw-item', 'use-item', 'equip', 'unequip',
    'toggle-light', 'refuel',
  ]) });
const actorMovedEvent = z.strictObject({ type: z.literal('actor.moved'), eventId: identifier,
  actorId: identifier, from: point, to: point });
const itemPickedUpEvent = z.strictObject({ type: z.literal('item.picked-up'), eventId: identifier,
  actorId: identifier, itemId: identifier, quantity: positiveQuantity });
const itemDroppedEvent = z.strictObject({ type: z.literal('item.dropped'), eventId: identifier,
  actorId: identifier, itemId: identifier, quantity: positiveQuantity });
const itemStackSplitEvent = z.strictObject({ type: z.literal('item.stack-split'), eventId: identifier,
  actorId: identifier, itemId: identifier, newItemId: identifier, quantity: positiveQuantity });
const itemConsumedEvent = z.strictObject({ type: z.literal('item.consumed'), eventId: identifier,
  actorId: identifier, itemId: identifier, quantity: positiveQuantity });
const itemThrownEvent = z.strictObject({ type: z.literal('item.thrown'), eventId: identifier,
  actorId: identifier, itemId: identifier, quantity: positiveQuantity, to: point });
const itemUsedEvent = z.strictObject({ type: z.literal('item.used'), eventId: identifier,
  actorId: identifier, itemId: identifier, targetActorId: identifier });
const itemEquippedEvent = z.strictObject({ type: z.literal('item.equipped'), eventId: identifier,
  actorId: identifier, itemId: identifier, slot: equipmentSlot });
const itemUnequippedEvent = z.strictObject({ type: z.literal('item.unequipped'), eventId: identifier,
  actorId: identifier, itemId: identifier, slot: equipmentSlot });
const itemLightToggledEvent = z.strictObject({ type: z.literal('item.light-toggled'), eventId: identifier,
  actorId: identifier, itemId: identifier, enabled: z.boolean() });
const itemRefueledEvent = z.strictObject({ type: z.literal('item.refueled'), eventId: identifier,
  actorId: identifier, itemId: identifier, fuelItemId: identifier, quantity: positiveQuantity, fuel: safeNonNegative });
const identificationAppearanceRevealedEvent = z.strictObject({ type: z.literal('identification.appearance-revealed'),
  eventId: identifier, appearanceId: identifier, contentId: identifier });
const itemIdentifiedEvent = z.strictObject({ type: z.literal('item.identified'), eventId: identifier, itemId: identifier });
const hungerStageChangedEvent = z.strictObject({ type: z.literal('hunger.stage-changed'), eventId: identifier,
  actorId: identifier, previousStage: z.enum(['sated', 'hungry', 'weak', 'starving']),
  stage: z.enum(['sated', 'hungry', 'weak', 'starving']), reserve: safeNonNegative });
const hungerRestoredEvent = z.strictObject({ type: z.literal('hunger.restored'), eventId: identifier,
  actorId: identifier, amount: safeNonNegative, reserve: safeNonNegative });
const fuelWarningEvent = z.strictObject({ type: z.literal('fuel.warning'), eventId: identifier,
  itemId: identifier, threshold: safeNonNegative, fuel: safeNonNegative });
const itemLightExtinguishedEvent = z.strictObject({ type: z.literal('item.light-extinguished'),
  eventId: identifier, itemId: identifier });
const doorOpenedEvent = z.strictObject({ type: z.literal('door.opened'), eventId: identifier,
  actorId: identifier, featureId: identifier });
const doorClosedEvent = z.strictObject({ type: z.literal('door.closed'), eventId: identifier,
  actorId: identifier, featureId: identifier });
const featureRevealedEvent = z.strictObject({ type: z.literal('feature.revealed'), eventId: identifier,
  actorId: identifier, featureId: identifier });
const featureSearchedEvent = z.strictObject({ type: z.literal('feature.searched'), eventId: identifier,
  actorId: identifier });
const trapTriggeredEvent = z.strictObject({ type: z.literal('trap.triggered'), eventId: identifier,
  actorId: identifier, featureId: identifier });
const trapDisarmedEvent = z.strictObject({ type: z.literal('trap.disarmed'), eventId: identifier,
  actorId: identifier, featureId: identifier });
const trapDisarmFailedEvent = z.strictObject({ type: z.literal('trap.disarm-failed'), eventId: identifier,
  actorId: identifier, featureId: identifier });
const itemDamagedEvent = z.strictObject({ type: z.literal('item.damaged'), eventId: identifier,
  actorId: identifier, itemId: identifier, amount: safeNonNegative, condition: safeNonNegative });
const actorIntentChangedEvent = z.strictObject({ type: z.literal('actor.intent-changed'), eventId: identifier,
  actorId: identifier, intent: z.enum(['approach', 'attack', 'hold', 'regroup', 'flee', 'protect', 'spawn', 'phase-change']),
  presentation: z.enum(['intent.approach', 'intent.attack', 'intent.hold', 'intent.regroup', 'intent.flee',
    'intent.protect', 'intent.spawn', 'intent.phase-change']),
  targetCategory: z.enum(['hero', 'leader', 'source', 'position']).nullable() });
const groupAwarenessSharedEvent = z.strictObject({ type: z.literal('group.awareness-shared'), eventId: identifier,
  populationId: identifier, actorId: identifier, targetActorId: identifier, floorId: identifier,
  x: safeNonNegative, y: safeNonNegative, observedAt: safeNonNegative, observerActorId: identifier });
const groupLeaderDefeatedEvent = z.strictObject({ type: z.literal('group.leader-defeated'), eventId: identifier,
  populationId: identifier, actorId: identifier });
const groupOutcomeAppliedEvent = z.strictObject({ type: z.literal('group.outcome-applied'), eventId: identifier,
  populationId: identifier, actorId: identifier,
  response: z.enum(['weaken', 'panic', 'disband', 'surrender', 'frenzy', 'collapse']),
  individualRewards: z.boolean(), collapsedMemberCount: safeNonNegative });
const soundHeardEvent = z.strictObject({ type: z.literal('sound.heard'),
  category: z.enum(['combat', 'movement', 'mechanism']),
  direction: z.enum(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'here']),
  distanceBand: z.enum(['near', 'medium', 'far']) });
const heroDamagedPublicEvent = z.strictObject({ type: z.literal('hero.damaged'), amount: safeNonNegative,
  damageType: z.enum(['physical', 'fire', 'cold', 'lightning', 'poison', 'arcane']) });
const restCompletedEvent = z.strictObject({ type: z.literal('rest.completed'), eventId: identifier,
  stopReason: z.enum(['full-health', 'maximum-duration', 'visible-danger', 'aware-hostile', 'damage',
    'meaningful-sound', 'hunger-warning', 'fuel-warning', 'condition-change', 'decision-required', 'hero-death']),
  elapsed: safeNonNegative, effectiveHealing: safeNonNegative });
const event = z.discriminatedUnion('type', [
  movedEvent, waitedEvent, invalidEvent, attackMissedEvent, attackHitEvent, actorDamagedEvent,
  actorDiedEvent, actorHealedEvent, conditionAppliedEvent, conditionRemovedEvent, actorForcedMoveEvent,
  reactionTriggeredEvent, relationshipChangedEvent, actorTurnStartedEvent, actorTurnCompletedEvent, actorMovedEvent,
  itemPickedUpEvent, itemDroppedEvent, itemStackSplitEvent,
  itemConsumedEvent,
  itemThrownEvent,
  itemUsedEvent,
  itemEquippedEvent, itemUnequippedEvent,
  itemLightToggledEvent, itemRefueledEvent,
  identificationAppearanceRevealedEvent, itemIdentifiedEvent,
  hungerStageChangedEvent, hungerRestoredEvent, fuelWarningEvent, itemLightExtinguishedEvent,
  doorOpenedEvent, doorClosedEvent,
  featureRevealedEvent, featureSearchedEvent, trapTriggeredEvent, trapDisarmedEvent, trapDisarmFailedEvent,
  itemDamagedEvent, actorIntentChangedEvent, groupAwarenessSharedEvent, groupLeaderDefeatedEvent,
  groupOutcomeAppliedEvent,
  soundHeardEvent, heroDamagedPublicEvent, restCompletedEvent,
]);
const appliedResult = z.strictObject({ status: z.literal('applied'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative });
const invalidResult = z.strictObject({ status: z.literal('invalid'), commandId: identifier, revision: safeNonNegative, turn: safeNonNegative, reason: blockReason });
const processedResult = z.discriminatedUnion('status', [appliedResult, invalidResult]);
const recorded = z.strictObject({
  command,
  result: processedResult,
  events: z.array(event).readonly(),
  publicEvents: z.array(event).readonly(),
});
const entity = z.strictObject({ entityId: identifier, x: safeNonNegative, y: safeNonNegative });
const color = z.tuple([uint8, uint8, uint8]);
const ambient = z.strictObject({ color, strength: uint8 });
const knowledge = z.strictObject({ exploredWords: z.array(uint32).readonly(), rememberedTerrainWords: z.array(uint32).readonly() });
const fixturePresentation = z.strictObject({
  glyph: z.string().refine((glyph) => [...glyph].length === 1, 'glyph must be one Unicode glyph'),
  token: identifier,
});
const fixedLocation = z.strictObject({ type: z.literal('fixed'), x: safeNonNegative, y: safeNonNegative });
const actorLocation = z.strictObject({ type: z.literal('actor'), actorId: identifier });
const light = z.strictObject({
  lightId: identifier,
  location: z.discriminatedUnion('type', [fixedLocation, actorLocation]),
  color,
  radius: z.number().int().safe().min(1).max(32),
  strength: z.number().int().safe().min(1).max(255),
  enabled: z.boolean(),
  falloff: z.literal('linear'),
  vaultPlacementId: identifier.nullable(),
  presentation: fixturePresentation.nullable(),
});
const vault = z.strictObject({
  placementId: identifier, vaultId: identifier, x: safeNonNegative, y: safeNonNegative,
  width: z.number().int().safe().positive(), height: z.number().int().safe().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  reflected: z.boolean(), entrances: z.array(point).readonly(),
});
const slot = z.strictObject({
  slotId: identifier, vaultPlacementId: identifier,
  kind: z.enum(['monster', 'item', 'trap', 'npc', 'fixture', 'objective']),
  required: z.boolean(), tags: z.array(z.string()).readonly(), x: safeNonNegative, y: safeNonNegative,
});
const tile = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const floor = z.strictObject({
  floorId: identifier, seed: uint32Tuple, generatorVersion: z.union([z.literal(1), z.literal(2)]),
  width: z.number().int().min(1).max(512), height: z.number().int().min(1).max(512),
  depth: z.number().int().min(0).max(10_000), tiles: z.array(tile).readonly(), entities: z.array(entity).readonly(),
  themeId: identifier, ambient, knowledge, lights: z.array(light).readonly(), stairUp: point.nullable(), stairDown: point.nullable(),
  vaults: z.array(vault).readonly(), placementSlots: z.array(slot).readonly(),
});
const nullableIdentifier = identifier.nullable();
const attributes = z.strictObject({
  might: safeNonNegative,
  agility: safeNonNegative,
  vitality: safeNonNegative,
  wits: safeNonNegative,
  resolve: safeNonNegative,
});
const condition = z.strictObject({
  conditionId: identifier,
  sourceActorId: nullableIdentifier,
  appliedAt: safeNonNegative,
  expiresAt: safeNonNegative.nullable(),
  stacks: z.number().int().safe().positive(),
});
const equipment = z.strictObject({
  'main-hand': nullableIdentifier,
  'off-hand': nullableIdentifier,
  body: nullableIdentifier,
  head: nullableIdentifier,
  hands: nullableIdentifier,
  feet: nullableIdentifier,
  neck: nullableIdentifier,
  'left-ring': nullableIdentifier,
  'right-ring': nullableIdentifier,
});
const populationIntent = z.enum(['approach', 'attack', 'hold', 'regroup', 'flee', 'protect', 'spawn', 'phase-change']);
const actorGoal = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('actor'), targetActorId: identifier }),
  z.strictObject({ type: z.literal('cell'), floorId: identifier, x: safeNonNegative, y: safeNonNegative }),
  z.strictObject({ type: z.literal('formation'), populationId: identifier, roleId: z.string().min(1).max(80), x: safeNonNegative, y: safeNonNegative }),
]);
const lastKnownTarget = z.strictObject({
  targetActorId: identifier, floorId: identifier, x: safeNonNegative, y: safeNonNegative,
  observedAt: safeNonNegative, source: z.enum(['sight', 'sound', 'group']), observerActorId: identifier,
});
const investigation = z.strictObject({
  floorId: identifier, x: safeNonNegative, y: safeNonNegative, startedAt: safeNonNegative,
  expiresAt: safeNonNegative.nullable(),
});
const actorBehaviorState = z.strictObject({
  intent: populationIntent,
  goal: actorGoal.nullable(),
  lastKnownTargets: z.array(lastKnownTarget).readonly(),
  investigation: investigation.nullable(),
});
const populationPresentation = z.strictObject({
  name: heroName,
  glyph: z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  leader: z.boolean(),
});
const actor = z.strictObject({
  actorId: identifier,
  contentId: identifier,
  playerControlled: z.boolean(),
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  attributes,
  health: safeNonNegative,
  maxHealth: safeNonNegative,
  energy: z.number().int().safe(),
  speed: z.number().int().safe().positive(),
  reactionReady: z.boolean(),
  disposition: z.enum(['friendly', 'neutral', 'hostile']),
  awareActorIds: z.array(identifier).readonly(),
  conditions: z.array(condition).readonly(),
  equipment,
  behaviorId: nullableIdentifier,
  behaviorState: actorBehaviorState,
  populationId: nullableIdentifier,
  populationRoleId: z.string().min(1).max(80).nullable(),
  populationPresentation: populationPresentation.nullable(),
});
const itemLocation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('backpack'), actorId: identifier }),
  z.strictObject({ type: z.literal('equipped'), actorId: identifier, slot: z.enum(['main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring']) }),
  z.strictObject({ type: z.literal('floor'), floorId: identifier, x: safeNonNegative, y: safeNonNegative }),
]);
const enchantment = z.strictObject({
  enchantmentId: identifier,
  modifiers: z.record(z.string(), z.number().int().safe()).readonly(),
});
const item = z.strictObject({
  itemId: identifier,
  contentId: identifier,
  quantity: z.number().int().safe().positive(),
  condition: safeNonNegative,
  enchantment: enchantment.nullable(),
  identified: z.boolean(),
  charges: safeNonNegative.nullable(),
  fuel: safeNonNegative.nullable(),
  enabled: z.boolean().nullable(),
  location: itemLocation,
});
const discovery = z.strictObject({
  discoveredByActorIds: z.array(identifier).readonly(),
  progressByActorId: z.record(identifier, safeNonNegative).readonly(),
  attemptedContextKeys: z.array(z.string().min(1).max(256)).readonly(),
});
const featureBase = {
  featureId: identifier,
  floorId: identifier,
  x: safeNonNegative,
  y: safeNonNegative,
  contentId: nullableIdentifier,
  coverTileId: tile,
} as const;
const feature = z.discriminatedUnion('type', [
  z.strictObject({ ...featureBase, type: z.literal('door'), state: z.enum(['open', 'closed', 'locked']) }),
  z.strictObject({ ...featureBase, type: z.literal('trap'), state: z.enum(['armed', 'disabled', 'spent']), discoveryDifficulty: safeNonNegative, discovery }),
  z.strictObject({ ...featureBase, type: z.literal('secret'), state: z.enum(['hidden', 'revealed']), discoveryDifficulty: safeNonNegative, discovery }),
]);
const relationship = z.strictObject({
  leftActorId: identifier,
  rightActorId: identifier,
  relationship: z.enum(['friendly', 'neutral', 'hostile']),
});
const survival = z.strictObject({
  hungerReserve: safeNonNegative,
  hungerStage: z.enum(['sated', 'hungry', 'weak', 'starving']),
  nextStarvationAt: safeNonNegative.nullable(),
  emittedHungerWarnings: z.array(z.enum(['sated', 'hungry', 'weak', 'starving'])).readonly(),
  emittedFuelWarnings: z.array(identifier).readonly(),
});
const identification = z.strictObject({
  appearanceByContentId: z.record(identifier, identifier).readonly(),
  knownAppearanceIds: z.array(identifier).readonly(),
});
const hero = z.strictObject({ actorId: identifier, name: heroName, sightRadius: safeNonNegative, backpackCapacity: safeNonNegative });
const probability = z.number().finite().min(0).max(1);
const encounterDecision = z.strictObject({
  encounterId: identifier, baseProbability: probability, protectionBonus: probability,
  effectiveProbability: probability, eligible: z.boolean(), reachedEligibleDepth: z.boolean(),
  encountered: z.boolean(), instancesCreated: safeNonNegative,
});
const populationBase = {
  populationId: identifier, encounterId: identifier, floorId: identifier, createdAt: safeNonNegative,
  livingMemberIds: z.array(identifier).readonly(), formerMemberIds: z.array(identifier).readonly(),
} as const;
const roleMembership = z.strictObject({ actorId: identifier, roleId: z.string().min(1).max(80) });
const population = z.discriminatedUnion('model', [
  z.strictObject({ ...populationBase, model: z.literal('individual') }),
  z.strictObject({ ...populationBase, model: z.literal('group'), leaderActorId: nullableIdentifier,
    bonusActive: z.boolean(), roleMembership: z.array(roleMembership).readonly(),
    sharedKnowledge: z.array(lastKnownTarget).readonly(), leaderResponseApplied: z.boolean() }),
  z.strictObject({ ...populationBase, model: z.literal('swarm'), sourceActorId: identifier,
    nextSpawnAt: safeNonNegative, spawnedCount: safeNonNegative, peakLivingSize: safeNonNegative,
    shutdownState: z.enum(['stop', 'flee', 'decay', 'frenzy']).nullable() }),
  z.strictObject({ ...populationBase, model: z.literal('boss'), actorId: identifier,
    currentPhaseId: z.string().min(1).max(80).nullable(), crossedPhaseIds: z.array(z.string().min(1).max(80)).readonly(),
    lastFloorExitAt: safeNonNegative.nullable(), rewardCreated: z.boolean(),
    recoveryHistory: z.array(z.strictObject({ at: safeNonNegative, amount: safeNonNegative })).readonly() }),
  z.strictObject({ ...populationBase, model: z.literal('champion'), actorId: identifier,
    hallRecordId: identifier, rank: z.literal(1), defeated: z.boolean(), rewardCreated: z.boolean() }),
  z.strictObject({ ...populationBase, model: z.literal('echo'), actorId: identifier,
    hallRecordId: identifier, rank: z.number().int().min(2).max(10), defeated: z.boolean(), lootCreated: z.boolean() }),
]);
const heirloom = z.strictObject({
  contentId: identifier, sourceItemId: nullableIdentifier,
  enchantment: z.strictObject({ enchantmentId: identifier,
    modifiers: z.record(z.string(), z.number().int().safe()).readonly() }).nullable(),
  condition: safeNonNegative, charges: safeNonNegative.nullable(), fuel: safeNonNegative.nullable(),
  qualityRank: safeNonNegative, displayName: heroName,
  glyph: z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), originatingHallRecordId: identifier,
});
const fallenStanding = z.strictObject({
  rank: z.number().int().min(1).max(10), hallRecordId: identifier, heroName, portraitGlyph: z.string().refine((value) => [...value].length === 1),
  classTags: z.array(z.string().min(1).max(80)).readonly(), attributes,
  equippedItemContentIds: z.array(identifier).readonly(), signatureAbilityIds: z.array(identifier).readonly(),
  deathDepth: z.number().int().safe().positive(), sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/), heirloom,
});
const fallenDecision = z.strictObject({
  hallRecordId: identifier, rank: z.number().int().min(1).max(10), role: z.enum(['champion', 'echo']),
  gateRoll: uint32.nullable(), retained: z.boolean(), encountered: z.boolean(), defeated: z.boolean(),
});
const rngEntries = Object.fromEntries(RNG_STREAM_NAMES.map((name) => [name, uint32State]));
const directionOffsets: Readonly<Record<Direction, Readonly<{ x: number; y: number }>>> = {
  northwest: { x: -1, y: -1 }, north: { x: 0, y: -1 }, northeast: { x: 1, y: -1 },
  west: { x: -1, y: 0 }, east: { x: 1, y: 0 },
  southwest: { x: -1, y: 1 }, south: { x: 0, y: 1 }, southeast: { x: 1, y: 1 },
};

const activeRunSchema = z.strictObject({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION), gameVersion: z.literal(ENGINE_GAME_VERSION),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), runId: identifier, runSeed: uint32Tuple,
  rng: z.strictObject(rngEntries as Record<(typeof RNG_STREAM_NAMES)[number], typeof uint32State>),
  revision: safeNonNegative, turn: safeNonNegative, worldTime: safeNonNegative,
  hero, actors: z.array(actor).min(1).readonly(), items: z.array(item).readonly(), features: z.array(feature).readonly(),
  relationships: z.array(relationship).readonly(), survival, identification,
  activeFloorId: identifier,
  floors: z.array(floor).min(1).readonly(), recentCommands: z.array(recorded).max(RECENT_COMMAND_LIMIT).readonly(),
  encounterDecisions: z.array(encounterDecision).readonly(), populations: z.array(population).readonly(),
  fallenHeroStandings: z.array(fallenStanding).max(10).readonly(),
  fallenHeroDecisions: z.array(fallenDecision).max(10).readonly(),
  conqueredChampionRecordIds: z.array(identifier).readonly(),
});

function fail(path: string, reason: string): never {
  throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${reason}`);
}

type SavedFloor = z.infer<typeof floor>;

function cell(floorValue: SavedFloor, x: number, y: number, path: string): number {
  const index = tileIndex(floorValue, x, y);
  if (index === undefined) fail(path, 'position is outside its floor');
  return index;
}

function ensureWalkable(floorValue: SavedFloor, x: number, y: number, path: string): void {
  const index = cell(floorValue, x, y, path);
  if (!tileDefinition(floorValue.tiles[index]!).walkable) fail(path, 'position is not on walkable terrain');
}

function ensureActorWalkable(
  floorValue: SavedFloor,
  features: readonly z.infer<typeof feature>[],
  x: number,
  y: number,
  path: string,
): void {
  const index = cell(floorValue, x, y, path);
  if (tileDefinition(floorValue.tiles[index]!).walkable) return;
  const walkableFeature = features.some((candidate) => (
    (candidate.type === 'door' && candidate.state === 'open')
    || (candidate.type === 'secret' && candidate.state === 'revealed')
  ) && candidate.floorId === floorValue.floorId && candidate.x === x && candidate.y === y);
  if (!walkableFeature) fail(path, 'position is not on walkable terrain');
}

function validateOrderedIds(values: readonly string[], path: string, noun: string, idField?: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) fail(`${path}.${index}${idField ? `.${idField}` : ''}`, `${noun} identifiers must be unique and strictly increasing`);
  }
}

function overlaps(left: z.infer<typeof vault>, right: z.infer<typeof vault>): boolean {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}

interface GlobalIds {
  readonly entities: Set<string>;
  readonly lights: Set<string>;
  readonly vaultPlacements: Set<string>;
  readonly slots: Set<string>;
}

function validateFloor(floorValue: SavedFloor, floorIndex: number, globalIds: GlobalIds): void {
  const base = `floors.${floorIndex}`;
  const cellCount = floorValue.width * floorValue.height;
  if (floorValue.tiles.length !== cellCount) fail(`${base}.tiles`, 'tile length does not match dimensions');
  try { validateKnowledgePacking(floorValue.knowledge, cellCount); }
  catch (cause) { fail(`${base}.knowledge`, cause instanceof Error ? cause.message : 'invalid knowledge packing'); }

  validateOrderedIds(floorValue.entities.map((entry) => entry.entityId), `${base}.entities`, 'entity', 'entityId');
  for (const [entityIndex, entityValue] of floorValue.entities.entries()) {
    if (globalIds.entities.has(entityValue.entityId)) fail(`${base}.entities.${entityIndex}.entityId`, 'entity identifier is duplicated');
    globalIds.entities.add(entityValue.entityId);
    ensureWalkable(floorValue, entityValue.x, entityValue.y, `${base}.entities.${entityIndex}`);
  }

  const stairs = [[floorValue.stairUp, 4, 'stairUp'], [floorValue.stairDown, 5, 'stairDown']] as const;
  for (const [position, expectedTile, name] of stairs) {
    const matchingTiles = floorValue.tiles.reduce<number[]>((indexes, tileValue, index) => {
      if (tileValue === expectedTile) indexes.push(index);
      return indexes;
    }, []);
    if (position === null) {
      if (matchingTiles.length !== 0) fail(`${base}.${name}`, `${name} metadata is required for its terrain tile`);
      continue;
    }
    if (floorValue.tiles[cell(floorValue, position.x, position.y, `${base}.${name}`)] !== expectedTile) {
      fail(`${base}.${name}`, `${name} must match its terrain tile`);
    }
    if (matchingTiles.length !== 1) fail(`${base}.${name}`, `${name} must identify the only matching terrain tile`);
  }
  if (floorValue.stairUp && floorValue.stairDown && floorValue.stairUp.x === floorValue.stairDown.x && floorValue.stairUp.y === floorValue.stairDown.y) {
    fail(`${base}.stairDown`, 'stair positions must be distinct');
  }

  validateOrderedIds(floorValue.vaults.map((entry) => entry.placementId), `${base}.vaults`, 'vault placement', 'placementId');
  const placements = new Map(floorValue.vaults.map((entry) => [entry.placementId, entry]));
  for (const [vaultIndex, placement] of floorValue.vaults.entries()) {
    const path = `${base}.vaults.${vaultIndex}`;
    if (globalIds.vaultPlacements.has(placement.placementId)) fail(`${path}.placementId`, 'vault placement identifier is duplicated');
    globalIds.vaultPlacements.add(placement.placementId);
    if (placement.x + placement.width > floorValue.width || placement.y + placement.height > floorValue.height) fail(path, 'vault placement is outside its floor');
    for (let otherIndex = 0; otherIndex < vaultIndex; otherIndex += 1) {
      if (overlaps(floorValue.vaults[otherIndex]!, placement)) fail(path, 'vault placements overlap');
    }
    const entranceCells = new Set<number>();
    for (const [entranceIndex, entrance] of placement.entrances.entries()) {
      const entrancePath = `${path}.entrances.${entranceIndex}`;
      if (entrance.x < placement.x || entrance.x >= placement.x + placement.width || entrance.y < placement.y || entrance.y >= placement.y + placement.height) fail(entrancePath, 'entrance is outside its vault placement');
      const index = cell(floorValue, entrance.x, entrance.y, entrancePath);
      if (!tileDefinition(floorValue.tiles[index]!).potentiallyTraversable) fail(entrancePath, 'entrance is not on traversable terrain');
      if (entranceCells.has(index)) fail(entrancePath, 'entrance position is duplicated');
      entranceCells.add(index);
    }
  }

  validateOrderedIds(floorValue.placementSlots.map((entry) => entry.slotId), `${base}.placementSlots`, 'slot', 'slotId');
  for (const [slotIndex, placementSlot] of floorValue.placementSlots.entries()) {
    const path = `${base}.placementSlots.${slotIndex}`;
    if (globalIds.slots.has(placementSlot.slotId)) fail(`${path}.slotId`, 'slot identifier is duplicated');
    globalIds.slots.add(placementSlot.slotId);
    const owner = placements.get(placementSlot.vaultPlacementId);
    if (!owner) fail(`${path}.vaultPlacementId`, 'slot owner does not exist');
    if (placementSlot.x < owner.x || placementSlot.x >= owner.x + owner.width || placementSlot.y < owner.y || placementSlot.y >= owner.y + owner.height) fail(path, 'slot is outside its vault placement');
    const index = cell(floorValue, placementSlot.x, placementSlot.y, path);
    if (floorValue.tiles[index] === 6) fail(path, 'slot cannot occupy void terrain');
  }

  validateOrderedIds(floorValue.lights.map((entry) => entry.lightId), `${base}.lights`, 'light', 'lightId');
  const presentedCells = new Set<number>();
  for (const [lightIndex, source] of floorValue.lights.entries()) {
    const path = `${base}.lights.${lightIndex}`;
    if (globalIds.lights.has(source.lightId)) fail(`${path}.lightId`, 'light identifier is duplicated');
    globalIds.lights.add(source.lightId);
    if (source.location.type === 'actor') {
      if (source.vaultPlacementId !== null || source.presentation !== null) fail(path, 'actor-attached lights cannot have vault ownership or fixture presentation');
      continue;
    }
    const index = cell(floorValue, source.location.x, source.location.y, `${path}.location`);
    if (floorValue.tiles[index] === 6) fail(`${path}.location`, 'fixed light cannot occupy void terrain');
    if (source.vaultPlacementId !== null) {
      const owner = placements.get(source.vaultPlacementId);
      if (!owner) fail(`${path}.vaultPlacementId`, 'light owner does not exist');
      if (source.presentation === null) fail(`${path}.presentation`, 'vault-owned light requires fixture presentation');
      if (source.location.x < owner.x || source.location.x >= owner.x + owner.width
        || source.location.y < owner.y || source.location.y >= owner.y + owner.height) {
        fail(`${path}.location`, 'vault-owned light is outside its vault placement');
      }
    }
    if (source.presentation !== null) {
      if (presentedCells.has(index)) fail(`${path}.location`, 'presented fixed lights cannot share a cell');
      presentedCells.add(index);
    }
  }
}

function validateSemantics(run: z.infer<typeof activeRunSchema>): ActiveRun {
  const floorIds = new Set<string>();
  const globalIds: GlobalIds = {
    entities: new Set<string>(), lights: new Set<string>(), vaultPlacements: new Set<string>(), slots: new Set<string>(),
  };
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    const previousFloor = run.floors[floorIndex - 1];
    if (previousFloor && previousFloor.floorId >= floorValue.floorId) fail(`floors.${floorIndex}.floorId`, 'floor identifiers must be strictly increasing');
    if (floorIds.has(floorValue.floorId)) fail(`floors.${floorIndex}.floorId`, 'floor identifier is duplicated');
    floorIds.add(floorValue.floorId);
    validateFloor(floorValue, floorIndex, globalIds);
  }
  const activeFloor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (!activeFloor) fail('activeFloorId', 'active floor does not exist');

  validateOrderedIds(run.actors.map((entry) => entry.actorId), 'actors', 'actor', 'actorId');
  const actors = new Map(run.actors.map((entry) => [entry.actorId, entry]));
  const occupiedCells = new Set<string>();
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    const path = `actors.${actorIndex}`;
    const actorFloor = run.floors.find((candidate) => candidate.floorId === actorValue.floorId);
    if (!actorFloor) fail(`${path}.floorId`, 'actor floor does not exist');
    ensureActorWalkable(actorFloor, run.features, actorValue.x, actorValue.y, path);
    if (actorValue.health > actorValue.maxHealth) fail(`${path}.health`, 'health exceeds maximum health');
    validateOrderedIds(actorValue.awareActorIds, `${path}.awareActorIds`, 'aware actor');
    for (const [awareIndex, awareActorId] of actorValue.awareActorIds.entries()) {
      if (awareActorId === actorValue.actorId) fail(`${path}.awareActorIds.${awareIndex}`, 'actor cannot be aware of itself');
      if (!actors.has(awareActorId)) fail(`${path}.awareActorIds.${awareIndex}`, 'aware actor does not exist');
    }
    validateOrderedIds(actorValue.conditions.map((entry) => entry.conditionId), `${path}.conditions`, 'condition', 'conditionId');
    for (const [conditionIndex, conditionValue] of actorValue.conditions.entries()) {
      if (conditionValue.sourceActorId !== null && !actors.has(conditionValue.sourceActorId)) {
        fail(`${path}.conditions.${conditionIndex}.sourceActorId`, 'condition source actor does not exist');
      }
      if (conditionValue.expiresAt !== null && conditionValue.expiresAt < conditionValue.appliedAt) {
        fail(`${path}.conditions.${conditionIndex}.expiresAt`, 'condition cannot expire before it was applied');
      }
    }
    if (actorValue.health > 0) {
      const occupiedKey = `${actorValue.floorId}:${actorValue.x}:${actorValue.y}`;
      if (occupiedCells.has(occupiedKey)) fail(path, 'living actors cannot share a cell');
      occupiedCells.add(occupiedKey);
    }
  }

  validateOrderedIds(run.encounterDecisions.map((entry) => entry.encounterId),
    'encounterDecisions', 'encounter decision', 'encounterId');
  const encounterDecisions = new Map(run.encounterDecisions.map((entry) => [entry.encounterId, entry]));
  for (const [index, decision] of run.encounterDecisions.entries()) {
    if (decision.effectiveProbability < decision.baseProbability
      || decision.effectiveProbability > decision.baseProbability + decision.protectionBonus) {
      fail(`encounterDecisions.${index}.effectiveProbability`, 'effective probability is inconsistent');
    }
    if (decision.encountered && !decision.reachedEligibleDepth) {
      fail(`encounterDecisions.${index}.encountered`, 'encountered decision must have reached eligible depth');
    }
    if (decision.encountered && !decision.eligible) {
      fail(`encounterDecisions.${index}.encountered`, 'an ineligible encounter cannot be encountered');
    }
    if (!decision.eligible && decision.instancesCreated !== 0) {
      fail(`encounterDecisions.${index}.instancesCreated`, 'an ineligible encounter cannot create instances');
    }
  }

  validateOrderedIds(run.populations.map((entry) => entry.populationId),
    'populations', 'population', 'populationId');
  const populations = new Map(run.populations.map((entry) => [entry.populationId, entry]));
  const validateMemories = (memories: readonly z.infer<typeof lastKnownTarget>[], path: string): void => {
    validateOrderedIds(memories.map((entry) => entry.targetActorId), path, 'last-known target', 'targetActorId');
    for (const memory of memories) {
      if (!actors.has(memory.targetActorId) || !actors.has(memory.observerActorId)) {
        fail(path, 'memory actor reference does not exist');
      }
      const memoryFloor = run.floors.find((entry) => entry.floorId === memory.floorId);
      if (!memoryFloor) fail(path, 'memory floor does not exist');
      cell(memoryFloor, memory.x, memory.y, path);
    }
  };
  for (const [index, populationValue] of run.populations.entries()) {
    const path = `populations.${index}`;
    if (!floorIds.has(populationValue.floorId)) fail(`${path}.floorId`, 'population floor does not exist');
    if (populationValue.model !== 'champion' && populationValue.model !== 'echo'
      && !encounterDecisions.has(populationValue.encounterId)) {
      fail(`${path}.encounterId`, 'population encounter decision does not exist');
    }
    validateOrderedIds(populationValue.livingMemberIds, `${path}.livingMemberIds`, 'living member');
    validateOrderedIds(populationValue.formerMemberIds, `${path}.formerMemberIds`, 'former member');
    const memberIds = new Set([...populationValue.livingMemberIds, ...populationValue.formerMemberIds]);
    if (memberIds.size !== populationValue.livingMemberIds.length + populationValue.formerMemberIds.length) {
      fail(`${path}.formerMemberIds`, 'living and former member sets overlap');
    }
    for (const actorId of populationValue.livingMemberIds) {
      const member = actors.get(actorId);
      if (!member || member.health <= 0) fail(`${path}.livingMemberIds`, 'living population member does not exist or is dead');
      if (member.populationId !== populationValue.populationId) fail(`${path}.livingMemberIds`, 'population membership disagrees with actor');
    }
    if (populationValue.model === 'group') {
      validateOrderedIds(populationValue.roleMembership.map((entry) => entry.actorId), `${path}.roleMembership`, 'role member', 'actorId');
      const roles = new Map(populationValue.roleMembership.map((entry) => [entry.actorId, entry.roleId]));
      for (const [roleIndex, role] of populationValue.roleMembership.entries()) {
        const member = actors.get(role.actorId);
        if (!memberIds.has(role.actorId) || !member || member.populationRoleId !== role.roleId) {
          fail(`${path}.roleMembership.${roleIndex}`, 'group role membership disagrees with its actor');
        }
      }
      for (const actorId of populationValue.livingMemberIds) {
        if (!roles.has(actorId)) fail(`${path}.roleMembership`, 'every living group member requires a role');
      }
      if (populationValue.leaderActorId !== null && !memberIds.has(populationValue.leaderActorId)) {
        fail(`${path}.leaderActorId`, 'group leader must belong to the population');
      }
      const leaderLiving = populationValue.leaderActorId !== null
        && populationValue.livingMemberIds.includes(populationValue.leaderActorId);
      if (populationValue.bonusActive !== leaderLiving) {
        fail(`${path}.bonusActive`, 'group bonus must be active exactly while its leader lives');
      }
      const leaderDefeated = populationValue.leaderActorId !== null
        && populationValue.formerMemberIds.includes(populationValue.leaderActorId);
      if (populationValue.leaderResponseApplied !== leaderDefeated) {
        fail(`${path}.leaderResponseApplied`, 'leader response state disagrees with leader membership');
      }
      validateMemories(populationValue.sharedKnowledge, `${path}.sharedKnowledge`);
    } else if (populationValue.model === 'swarm') {
      if (!memberIds.has(populationValue.sourceActorId)) fail(`${path}.sourceActorId`, 'swarm source must belong to the population');
      const sourceLiving = populationValue.livingMemberIds.includes(populationValue.sourceActorId);
      if ((populationValue.shutdownState === null) !== sourceLiving) {
        fail(`${path}.shutdownState`, 'swarm shutdown state must begin when its source is destroyed');
      }
      if (populationValue.peakLivingSize < populationValue.livingMemberIds.length) fail(`${path}.peakLivingSize`, 'peak living size is below current size');
    } else if (populationValue.model === 'boss' || populationValue.model === 'champion' || populationValue.model === 'echo') {
      if (!memberIds.has(populationValue.actorId)) fail(`${path}.actorId`, 'primary actor must belong to its population');
      if ('defeated' in populationValue && populationValue.defeated !== populationValue.formerMemberIds.includes(populationValue.actorId)) {
        fail(`${path}.defeated`, 'fallen-hero defeat state disagrees with primary actor membership');
      }
      if (populationValue.model === 'champion' && populationValue.rewardCreated && !populationValue.defeated) {
        fail(`${path}.rewardCreated`, 'Champion reward cannot exist before defeat');
      }
      if (populationValue.model === 'echo' && populationValue.lootCreated && !populationValue.defeated) {
        fail(`${path}.lootCreated`, 'Echo loot cannot exist before defeat');
      }
      if (populationValue.model === 'boss') {
        const crossed = new Set(populationValue.crossedPhaseIds);
        if (crossed.size !== populationValue.crossedPhaseIds.length) fail(`${path}.crossedPhaseIds`, 'boss phase is duplicated');
        if (populationValue.currentPhaseId !== null && !crossed.has(populationValue.currentPhaseId)) {
          fail(`${path}.currentPhaseId`, 'current boss phase has not been crossed');
        }
        if (populationValue.rewardCreated && populationValue.livingMemberIds.includes(populationValue.actorId)) {
          fail(`${path}.rewardCreated`, 'boss reward cannot exist while the boss lives');
        }
        for (let recoveryIndex = 1; recoveryIndex < populationValue.recoveryHistory.length; recoveryIndex += 1) {
          if (populationValue.recoveryHistory[recoveryIndex - 1]!.at >= populationValue.recoveryHistory[recoveryIndex]!.at) {
            fail(`${path}.recoveryHistory.${recoveryIndex}.at`, 'boss recovery history must be strictly chronological');
          }
        }
      }
    }
  }
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    if (actorValue.populationId === null) {
      if (actorValue.populationRoleId !== null) fail(`actors.${actorIndex}.populationRoleId`, 'actor without population cannot have a role');
    } else {
      const owner = populations.get(actorValue.populationId);
      if (!owner || ![...owner.livingMemberIds, ...owner.formerMemberIds].includes(actorValue.actorId)) {
        fail(`actors.${actorIndex}.populationId`, 'actor population membership does not resolve in both directions');
      }
      if (owner.model !== 'group' && owner.model !== 'swarm' && actorValue.populationRoleId !== null) {
        fail(`actors.${actorIndex}.populationRoleId`, 'only group and swarm members can have population roles');
      }
    }
    validateMemories(actorValue.behaviorState.lastKnownTargets, `actors.${actorIndex}.behaviorState.lastKnownTargets`);
    const goal = actorValue.behaviorState.goal;
    if (goal?.type === 'actor' && !actors.has(goal.targetActorId)) {
      fail(`actors.${actorIndex}.behaviorState.goal.targetActorId`, 'goal target actor does not exist');
    }
    if (goal?.type === 'cell') {
      const goalFloor = run.floors.find((entry) => entry.floorId === goal.floorId);
      if (!goalFloor) fail(`actors.${actorIndex}.behaviorState.goal.floorId`, 'goal floor does not exist');
      cell(goalFloor, goal.x, goal.y, `actors.${actorIndex}.behaviorState.goal`);
    }
    if (goal?.type === 'formation') {
      const goalPopulation = populations.get(goal.populationId);
      if (!goalPopulation || goalPopulation.model !== 'group' || actorValue.populationId !== goal.populationId) {
        fail(`actors.${actorIndex}.behaviorState.goal.populationId`, 'formation goal must reference the actor group');
      }
      if (actorValue.populationRoleId !== goal.roleId) {
        fail(`actors.${actorIndex}.behaviorState.goal.roleId`, 'formation goal role disagrees with the actor role');
      }
      const goalFloor = run.floors.find((entry) => entry.floorId === actorValue.floorId)!;
      cell(goalFloor, goal.x, goal.y, `actors.${actorIndex}.behaviorState.goal`);
    }
    const investigationValue = actorValue.behaviorState.investigation;
    if (investigationValue !== null) {
      const investigationFloor = run.floors.find((entry) => entry.floorId === investigationValue.floorId);
      if (!investigationFloor) fail(`actors.${actorIndex}.behaviorState.investigation.floorId`, 'investigation floor does not exist');
      cell(investigationFloor, investigationValue.x, investigationValue.y, `actors.${actorIndex}.behaviorState.investigation`);
      if (investigationValue.expiresAt !== null && investigationValue.expiresAt < investigationValue.startedAt) {
        fail(`actors.${actorIndex}.behaviorState.investigation.expiresAt`, 'investigation cannot expire before it starts');
      }
    }
  }

  const standingRecordIds = new Set<string>();
  for (let index = 0; index < run.fallenHeroStandings.length; index += 1) {
    const standing = run.fallenHeroStandings[index]!;
    if (standing.rank !== index + 1) fail(`fallenHeroStandings.${index}.rank`, 'standing ranks must be contiguous from 1');
    if (standingRecordIds.has(standing.hallRecordId)) fail(`fallenHeroStandings.${index}.hallRecordId`, 'Hall record is duplicated');
    standingRecordIds.add(standing.hallRecordId);
    if (standing.heirloom.originatingHallRecordId !== standing.hallRecordId) {
      fail(`fallenHeroStandings.${index}.heirloom.originatingHallRecordId`, 'heirloom provenance must match its Hall record');
    }
    validateOrderedIds(standing.classTags, `fallenHeroStandings.${index}.classTags`, 'class tag');
    validateOrderedIds(standing.equippedItemContentIds, `fallenHeroStandings.${index}.equippedItemContentIds`, 'equipped item');
    validateOrderedIds(standing.signatureAbilityIds, `fallenHeroStandings.${index}.signatureAbilityIds`, 'signature ability');
  }
  validateOrderedIds(run.conqueredChampionRecordIds, 'conqueredChampionRecordIds', 'conquered Champion record');
  for (let index = 0; index < run.fallenHeroDecisions.length; index += 1) {
    const decision = run.fallenHeroDecisions[index]!;
    if (decision.rank !== index + 1) fail(`fallenHeroDecisions.${index}.rank`, 'fallen-hero decisions must follow standing rank order');
    const standing = run.fallenHeroStandings.find((entry) => entry.hallRecordId === decision.hallRecordId);
    if (!standing || standing.rank !== decision.rank) fail(`fallenHeroDecisions.${index}.hallRecordId`, 'fallen-hero decision has no matching standing');
    if ((decision.rank === 1) !== (decision.role === 'champion')) fail(`fallenHeroDecisions.${index}.role`, 'rank 1 must be Champion and lower ranks must be Echoes');
    if ((decision.role === 'champion') !== (decision.gateRoll === null)) fail(`fallenHeroDecisions.${index}.gateRoll`, 'Champion has no gate roll and Echoes require one');
    if (decision.encountered && !decision.retained) fail(`fallenHeroDecisions.${index}.encountered`, 'only a retained fallen hero can be encountered');
    if (decision.defeated && !decision.encountered) fail(`fallenHeroDecisions.${index}.defeated`, 'a fallen hero must be encountered before defeat');
  }
  if (run.fallenHeroDecisions.length !== run.fallenHeroStandings.length) {
    fail('fallenHeroDecisions', 'every standing requires exactly one run decision');
  }

  const savedHeroActor = actors.get(run.hero.actorId);
  if (!savedHeroActor || !savedHeroActor.playerControlled) fail('hero.actorId', 'hero must reference one player-controlled actor');
  if (savedHeroActor.floorId !== run.activeFloorId) fail('hero.actorId', 'hero actor must occupy the active floor');

  validateOrderedIds(run.items.map((entry) => entry.itemId), 'items', 'item', 'itemId');
  const items = new Map(run.items.map((entry) => [entry.itemId, entry]));
  for (const [itemIndex, itemValue] of run.items.entries()) {
    const path = `items.${itemIndex}`;
    const location = itemValue.location;
    if (location.type === 'floor') {
      const itemFloor = run.floors.find((candidate) => candidate.floorId === location.floorId);
      if (!itemFloor) fail(`${path}.location.floorId`, 'item floor does not exist');
      ensureWalkable(itemFloor, location.x, location.y, `${path}.location`);
      continue;
    }
    const owner = actors.get(location.actorId);
    if (!owner) fail(`${path}.location.actorId`, 'item owner does not exist');
    if (location.type === 'equipped' && owner.equipment[location.slot] !== itemValue.itemId) {
      fail(`${path}.location.slot`, 'equipped item is not referenced by its actor slot');
    }
  }
  for (const [actorIndex, actorValue] of run.actors.entries()) {
    for (const [slotName, itemId] of Object.entries(actorValue.equipment)) {
      if (itemId === null) continue;
      const itemValue = items.get(itemId);
      if (!itemValue) fail(`actors.${actorIndex}.equipment.${slotName}`, 'equipped item does not exist');
      if (itemValue.location.type !== 'equipped' || itemValue.location.actorId !== actorValue.actorId || itemValue.location.slot !== slotName) {
        fail(`actors.${actorIndex}.equipment.${slotName}`, 'equipment reference disagrees with item location');
      }
    }
  }

  validateOrderedIds(run.features.map((entry) => entry.featureId), 'features', 'feature', 'featureId');
  for (const [featureIndex, featureValue] of run.features.entries()) {
    const path = `features.${featureIndex}`;
    const featureFloor = run.floors.find((candidate) => candidate.floorId === featureValue.floorId);
    if (!featureFloor) fail(`${path}.floorId`, 'feature floor does not exist');
    const featureCell = cell(featureFloor, featureValue.x, featureValue.y, path);
    if (featureValue.type === 'door' && featureFloor.tiles[featureCell] !== featureValue.coverTileId) {
      fail(`${path}.coverTileId`, 'door cover tile does not match its floor terrain');
    }
    if (featureValue.type !== 'door') {
      validateOrderedIds(featureValue.discovery.discoveredByActorIds, `${path}.discovery.discoveredByActorIds`, 'discovering actor');
      validateOrderedIds(featureValue.discovery.attemptedContextKeys, `${path}.discovery.attemptedContextKeys`, 'discovery context');
      for (const actorId of featureValue.discovery.discoveredByActorIds) {
        if (!actors.has(actorId)) fail(`${path}.discovery.discoveredByActorIds`, 'discovering actor does not exist');
      }
      for (const actorId of Object.keys(featureValue.discovery.progressByActorId)) {
        if (!actors.has(actorId)) fail(`${path}.discovery.progressByActorId.${actorId}`, 'progress actor does not exist');
      }
    }
  }

  let previousRelationshipKey = '';
  for (const [relationshipIndex, relationshipValue] of run.relationships.entries()) {
    const path = `relationships.${relationshipIndex}`;
    if (relationshipValue.leftActorId >= relationshipValue.rightActorId) fail(`${path}.rightActorId`, 'relationship actor identifiers must be a strictly increasing pair');
    if (!actors.has(relationshipValue.leftActorId) || !actors.has(relationshipValue.rightActorId)) fail(path, 'relationship actor does not exist');
    const key = `${relationshipValue.leftActorId}\u0000${relationshipValue.rightActorId}`;
    if (key <= previousRelationshipKey) fail(path, 'relationship pairs must be unique and strictly increasing');
    previousRelationshipKey = key;
  }

  validateOrderedIds(Object.keys(run.identification.appearanceByContentId), 'identification.appearanceByContentId', 'content');
  validateOrderedIds(run.identification.knownAppearanceIds, 'identification.knownAppearanceIds', 'appearance');
  const hungerStageOrder = ['hungry', 'weak', 'starving'] as const;
  let previousHungerWarning = -1;
  for (const [index, warning] of run.survival.emittedHungerWarnings.entries()) {
    const position = hungerStageOrder.indexOf(warning as (typeof hungerStageOrder)[number]);
    if (position <= previousHungerWarning) {
      fail(`survival.emittedHungerWarnings.${index}`, 'hunger warnings must be unique and in deterioration order');
    }
    previousHungerWarning = position;
  }
  validateOrderedIds(run.survival.emittedFuelWarnings, 'survival.emittedFuelWarnings', 'fuel warning');
  for (const [floorIndex, floorValue] of run.floors.entries()) {
    for (const [lightIndex, source] of floorValue.lights.entries()) {
      const actorId = source.location.type === 'actor' ? source.location.actorId : undefined;
      const attachedActor = actorId === undefined ? undefined : actors.get(actorId);
      if (attachedActor && attachedActor.floorId === floorValue.floorId) continue;
      if (actorId !== undefined && !floorValue.entities.some((entry) => entry.entityId === actorId)) {
        fail(`floors.${floorIndex}.lights.${lightIndex}.location.actorId`, 'attached actor does not exist on this floor');
      }
    }
  }
  if (run.turn !== run.revision) fail('turn', 'turn and revision must match in schema v4');

  const commandIds = new Set<string>();
  let previousRevision = 0;
  for (const [index, recordValue] of run.recentCommands.entries()) {
    const path = `recentCommands.${index}`;
    for (const [eventIndex, savedEvent] of recordValue.events.entries()) {
      if (savedEvent.type === 'actor.intent-changed') {
        if (!actors.has(savedEvent.actorId)) fail(`${path}.events.${eventIndex}.actorId`, 'intent actor does not exist');
        if (savedEvent.presentation !== `intent.${savedEvent.intent}`) {
          fail(`${path}.events.${eventIndex}.presentation`, 'intent presentation disagrees with intent');
        }
      }
    }
    if (commandIds.has(recordValue.command.commandId)) fail(`${path}.command.commandId`, 'command identifier is duplicated');
    commandIds.add(recordValue.command.commandId);
    if (recordValue.command.commandId !== recordValue.result.commandId) fail(`${path}.result.commandId`, 'result does not match command');
    if (recordValue.events.length === 0) fail(`${path}.events`, 'processed commands require at least one event');
    if (recordValue.events.some((entry) => !('eventId' in entry) || entry.eventId !== recordValue.command.commandId)) fail(`${path}.events`, 'event identifier does not match command');
    if (recordValue.publicEvents.some((entry) => 'eventId' in entry && entry.eventId !== recordValue.command.commandId)) fail(`${path}.publicEvents`, 'public event identifier does not match command');
    const attackTargetActorId = recordValue.command.type === 'attack' ? recordValue.command.targetActorId : undefined;
    const commandItemId = 'itemId' in recordValue.command ? recordValue.command.itemId : undefined;
    const splitNewItemId = recordValue.command.type === 'split-stack' ? recordValue.command.newItemId : undefined;
    const commandQuantity = 'quantity' in recordValue.command ? recordValue.command.quantity : undefined;
    const commandSlot = 'slot' in recordValue.command ? recordValue.command.slot : undefined;
    const commandEnabled = recordValue.command.type === 'toggle-light' ? recordValue.command.enabled : undefined;
    const commandFuelItemId = recordValue.command.type === 'refuel' ? recordValue.command.fuelItemId : undefined;
    const commandFeatureId = 'featureId' in recordValue.command ? recordValue.command.featureId : undefined;
    const eventValue = recordValue.result.status === 'invalid'
      ? recordValue.events.find((entry) => entry.type === 'action.invalid')
      : recordValue.command.type === 'wait'
        ? recordValue.events.find((entry) => entry.type === 'hero.waited')
      : recordValue.command.type === 'move'
          ? recordValue.events.find((entry) => entry.type === 'hero.moved')
            ?? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => entry.type === 'reaction.triggered' && entry.targetActorId === run.hero.actorId)
          : recordValue.command.type === 'attack'
            ? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
              && entry.actorId === run.hero.actorId && entry.targetActorId === attackTargetActorId)
            : recordValue.command.type === 'pickup'
              ? recordValue.events.find((entry) => entry.type === 'item.picked-up'
                && entry.actorId === run.hero.actorId && entry.itemId === commandItemId)
              : recordValue.command.type === 'drop'
                ? recordValue.events.find((entry) => entry.type === 'item.dropped'
                  && entry.actorId === run.hero.actorId && entry.itemId === commandItemId)
                : recordValue.command.type === 'split-stack'
                  ? recordValue.events.find((entry) => entry.type === 'item.stack-split'
                    && entry.actorId === run.hero.actorId && entry.itemId === commandItemId
                    && entry.newItemId === splitNewItemId)
                  : recordValue.command.type === 'fire'
                    ? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
                      && entry.actorId === run.hero.actorId)
                    : recordValue.command.type === 'throw-item'
                      ? recordValue.events.find((entry) => entry.type === 'item.thrown'
                        && entry.actorId === run.hero.actorId && entry.quantity === commandQuantity)
                      : recordValue.command.type === 'use-item'
                        ? recordValue.events.find((entry) => entry.type === 'item.used'
                          && entry.actorId === run.hero.actorId && entry.itemId === commandItemId)
                        : recordValue.command.type === 'equip'
                          ? recordValue.events.find((entry) => entry.type === 'item.equipped'
                            && entry.actorId === run.hero.actorId && entry.itemId === commandItemId
                            && entry.slot === commandSlot)
                          : recordValue.command.type === 'unequip'
                            ? recordValue.events.find((entry) => entry.type === 'item.unequipped'
                              && entry.actorId === run.hero.actorId && entry.slot === commandSlot)
                            : recordValue.command.type === 'toggle-light'
                              ? recordValue.events.find((entry) => entry.type === 'item.light-toggled'
                                && entry.actorId === run.hero.actorId && entry.itemId === commandItemId
                                && entry.enabled === commandEnabled)
                              : recordValue.command.type === 'refuel'
                                ? recordValue.events.find((entry) => entry.type === 'item.refueled'
                                  && entry.actorId === run.hero.actorId && entry.itemId === commandItemId
                                  && entry.fuelItemId === commandFuelItemId)
                                : recordValue.command.type === 'open-door'
                                  ? recordValue.events.find((entry) => entry.type === 'door.opened'
                                    && entry.actorId === run.hero.actorId && entry.featureId === commandFeatureId)
                                  : recordValue.command.type === 'close-door'
                                    ? recordValue.events.find((entry) => entry.type === 'door.closed'
                                      && entry.actorId === run.hero.actorId && entry.featureId === commandFeatureId)
                                    : recordValue.command.type === 'search'
                                      ? recordValue.events.find((entry) => entry.type === 'feature.searched'
                                        && entry.actorId === run.hero.actorId)
                                      : recordValue.command.type === 'disarm'
                                        ? recordValue.events.find((entry) => (entry.type === 'trap.disarmed'
                                          || entry.type === 'trap.triggered' || entry.type === 'trap.disarm-failed')
                                          && entry.actorId === run.hero.actorId && entry.featureId === commandFeatureId)
                                        : recordValue.command.type === 'rest'
                                          ? recordValue.events.find((entry) => entry.type === 'rest.completed')
          : undefined;
    if (!eventValue) fail(`${path}.events`, 'processed result has no matching event');
    if (recordValue.result.status === 'invalid') {
      if (eventValue.type !== 'action.invalid' || eventValue.commandId !== recordValue.command.commandId || eventValue.reason !== recordValue.result.reason) fail(`${path}.events.0`, 'invalid result and event are inconsistent');
    } else if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.heroId !== run.hero.actorId) fail(`${path}.events.0`, 'wait result and event are inconsistent');
      ensureActorWalkable(activeFloor, run.features, eventValue.x, eventValue.y, `${path}.events.0`);
    } else if (recordValue.command.type === 'move' && eventValue.type === 'hero.moved' && eventValue.heroId === run.hero.actorId) {
      ensureActorWalkable(activeFloor, run.features, eventValue.from.x, eventValue.from.y, `${path}.events.0.from`);
      ensureActorWalkable(activeFloor, run.features, eventValue.to.x, eventValue.to.y, `${path}.events.0.to`);
    } else if (recordValue.command.type === 'move' && eventValue.type === 'reaction.triggered'
      && eventValue.targetActorId === run.hero.actorId) {
      // A reaction may kill or immobilize the hero before the attempted move completes.
    } else if ((recordValue.command.type === 'move' || recordValue.command.type === 'attack')
      && (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed')
      && eventValue.actorId === run.hero.actorId) {
      if (recordValue.command.type === 'attack' && eventValue.targetActorId !== recordValue.command.targetActorId) {
        fail(`${path}.events`, 'attack target and event are inconsistent');
      }
    } else if ((recordValue.command.type === 'pickup' && eventValue.type === 'item.picked-up')
      || (recordValue.command.type === 'drop' && eventValue.type === 'item.dropped')
      || (recordValue.command.type === 'split-stack' && eventValue.type === 'item.stack-split')) {
      if (eventValue.quantity !== recordValue.command.quantity) fail(`${path}.events`, 'item quantity and event are inconsistent');
    } else if (recordValue.command.type === 'fire'
      && (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed')
      && eventValue.actorId === run.hero.actorId) {
      // Ammunition consumption is separately recorded before the attack event.
    } else if (recordValue.command.type === 'throw-item' && eventValue.type === 'item.thrown'
      && eventValue.actorId === run.hero.actorId && eventValue.quantity === recordValue.command.quantity) {
      ensureActorWalkable(activeFloor, run.features, eventValue.to.x, eventValue.to.y, `${path}.events.0.to`);
    } else if (recordValue.command.type === 'use-item' && eventValue.type === 'item.used'
      && eventValue.actorId === run.hero.actorId && eventValue.itemId === recordValue.command.itemId) {
      // The item's authored effects determine whether and how much quantity is consumed.
    } else if ((recordValue.command.type === 'equip' && eventValue.type === 'item.equipped')
      || (recordValue.command.type === 'unequip' && eventValue.type === 'item.unequipped')) {
      if (eventValue.actorId !== run.hero.actorId || eventValue.slot !== recordValue.command.slot) {
        fail(`${path}.events`, 'equipment command and event are inconsistent');
      }
    } else if (recordValue.command.type === 'toggle-light' && eventValue.type === 'item.light-toggled'
      && eventValue.actorId === run.hero.actorId && eventValue.itemId === recordValue.command.itemId
      && eventValue.enabled === recordValue.command.enabled) {
      // Item state carries the resulting enabled flag.
    } else if (recordValue.command.type === 'refuel' && eventValue.type === 'item.refueled'
      && eventValue.actorId === run.hero.actorId && eventValue.itemId === recordValue.command.itemId
      && eventValue.fuelItemId === recordValue.command.fuelItemId) {
      if (eventValue.quantity > recordValue.command.quantity) fail(`${path}.events`, 'refuel event exceeds requested quantity');
    } else if (((recordValue.command.type === 'open-door' && eventValue.type === 'door.opened')
      || (recordValue.command.type === 'close-door' && eventValue.type === 'door.closed'))
      && eventValue.actorId === run.hero.actorId && eventValue.featureId === recordValue.command.featureId) {
      // Feature state carries the resulting door geometry.
    } else if (recordValue.command.type === 'search' && eventValue.type === 'feature.searched'
      && eventValue.actorId === run.hero.actorId) {
      // Discovery progress is stored on affected features.
    } else if (recordValue.command.type === 'disarm'
      && (eventValue.type === 'trap.disarmed' || eventValue.type === 'trap.triggered'
        || eventValue.type === 'trap.disarm-failed')
      && eventValue.actorId === run.hero.actorId && eventValue.featureId === recordValue.command.featureId) {
      // Trap state and the effects random stream store the outcome.
    } else if (recordValue.command.type === 'rest' && eventValue.type === 'rest.completed') {
      if (eventValue.elapsed > recordValue.command.maximumDuration) {
        fail(`${path}.events`, 'rest event exceeds requested maximum duration');
      }
    } else fail(`${path}.events`, 'applied command and event are inconsistent');
    if (recordValue.result.revision < previousRevision || recordValue.result.revision > run.revision) fail(`${path}.result.revision`, 'record revisions are not monotonic');
    if (recordValue.result.turn > run.turn) fail(`${path}.result.turn`, 'record turn exceeds current turn');
    if (recordValue.result.turn !== recordValue.result.revision) fail(`${path}.result.turn`, 'result turn and revision must match in schema v4');
    if (recordValue.result.status === 'applied' && recordValue.result.revision !== recordValue.command.expectedRevision + 1) fail(`${path}.result.revision`, 'applied revision is inconsistent');
    if (recordValue.result.status === 'invalid' && recordValue.result.revision !== recordValue.command.expectedRevision) fail(`${path}.result.revision`, 'invalid revision is inconsistent');
    const previousRecord = run.recentCommands[index - 1];
    if (previousRecord && recordValue.command.expectedRevision !== previousRecord.result.revision) fail(`${path}.command.expectedRevision`, 'command revision does not follow the preceding result');
    previousRevision = recordValue.result.revision;
  }
  const finalRecord = run.recentCommands.at(-1);
  if (finalRecord) {
    const finalIndex = run.recentCommands.length - 1;
    if (finalRecord.result.revision !== run.revision) fail(`recentCommands.${finalIndex}.result.revision`, 'final result does not match current revision');
    if (finalRecord.result.turn !== run.turn) fail(`recentCommands.${finalIndex}.result.turn`, 'final result does not match current turn');
  }
  let knownPosition = { x: savedHeroActor.x, y: savedHeroActor.y };
  for (let index = run.recentCommands.length - 1; index >= 0; index -= 1) {
    const recordValue = run.recentCommands[index]!;
    const eventValue = recordValue.result.status === 'invalid'
      ? recordValue.events.find((entry) => entry.type === 'action.invalid')!
      : recordValue.command.type === 'wait'
        ? recordValue.events.find((entry) => entry.type === 'hero.waited')!
        : recordValue.command.type === 'move'
          ? recordValue.events.find((entry) => entry.type === 'hero.moved')
            ?? recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => entry.type === 'reaction.triggered' && entry.targetActorId === run.hero.actorId)!
          : recordValue.events.find((entry) => (entry.type === 'attack.hit' || entry.type === 'attack.missed')
            && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => (entry.type === 'item.picked-up' || entry.type === 'item.dropped'
              || entry.type === 'item.stack-split' || entry.type === 'item.thrown' || entry.type === 'item.used')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => (entry.type === 'item.equipped' || entry.type === 'item.unequipped')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => (entry.type === 'item.light-toggled' || entry.type === 'item.refueled')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => (entry.type === 'door.opened' || entry.type === 'door.closed')
              && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => entry.type === 'feature.searched' && entry.actorId === run.hero.actorId)
            ?? recordValue.events.find((entry) => (entry.type === 'trap.disarmed' || entry.type === 'trap.triggered'
              || entry.type === 'trap.disarm-failed') && entry.actorId === run.hero.actorId)!;
    const path = `recentCommands.${index}`;
    if (recordValue.result.status === 'invalid') {
      if (recordValue.command.type !== 'move') {
        const inventoryCommand = recordValue.command.type === 'pickup' || recordValue.command.type === 'drop'
          || recordValue.command.type === 'split-stack' || recordValue.command.type === 'equip'
          || recordValue.command.type === 'unequip' || recordValue.command.type === 'refuel'
          || recordValue.command.type === 'toggle-light';
        const inventoryReason = recordValue.result.reason === 'inventory.full'
          || recordValue.result.reason.startsWith('item.');
        const targetReason = recordValue.result.reason.startsWith('target.');
        const targetingCommand = recordValue.command.type === 'fire' || recordValue.command.type === 'cast'
          || recordValue.command.type === 'throw-item' || recordValue.command.type === 'use-item';
        if (inventoryReason && !inventoryCommand) {
          if (!inventoryCommand && recordValue.command.type !== 'fire' && recordValue.command.type !== 'throw-item'
            && recordValue.command.type !== 'use-item') {
            fail(`${path}.result.reason`, 'inventory reasons require an item command');
          }
        }
        if (targetReason && !targetingCommand) fail(`${path}.result.reason`, 'target reason requires a targeting command');
        if (!inventoryReason && !targetReason && recordValue.result.reason !== 'action.unavailable') {
          fail(`${path}.result.reason`, 'non-movement command reason is inconsistent');
        }
        continue;
      }
      if (recordValue.result.reason === 'action.unavailable') continue;
      if (['blocked.bounds', 'blocked.wall', 'blocked.door', 'blocked.pillar', 'blocked.void'].includes(recordValue.result.reason)) {
        const offset = directionOffsets[recordValue.command.direction];
        const attempted = { x: knownPosition.x + offset.x, y: knownPosition.y + offset.y };
        const attemptedIndex = tileIndex(activeFloor, attempted.x, attempted.y);
        const actualReason = attemptedIndex === undefined ? 'blocked.bounds' : movementBlockReason(activeFloor.tiles[attemptedIndex]!);
        if (recordValue.result.reason !== actualReason) fail(`${path}.result.reason`, 'invalid reason does not match the active floor');
      }
      continue;
    }
    if (recordValue.command.type === 'wait') {
      if (eventValue.type !== 'hero.waited' || eventValue.x !== knownPosition.x || eventValue.y !== knownPosition.y) fail(`${path}.events.0`, 'wait position does not match the retained position chain');
      continue;
    }
    if (recordValue.command.type === 'attack' || recordValue.command.type === 'pickup'
      || recordValue.command.type === 'drop' || recordValue.command.type === 'split-stack'
      || recordValue.command.type === 'fire' || recordValue.command.type === 'throw-item'
      || recordValue.command.type === 'use-item' || recordValue.command.type === 'equip'
      || recordValue.command.type === 'unequip' || recordValue.command.type === 'toggle-light'
      || recordValue.command.type === 'refuel' || recordValue.command.type === 'open-door'
      || recordValue.command.type === 'close-door' || recordValue.command.type === 'search'
      || recordValue.command.type === 'disarm' || recordValue.command.type === 'rest') continue;
    if (recordValue.command.type !== 'move') fail(`${path}.events`, 'move result and event are inconsistent');
    if (eventValue.type === 'attack.hit' || eventValue.type === 'attack.missed' || eventValue.type === 'reaction.triggered') continue;
    if (eventValue.type !== 'hero.moved') fail(`${path}.events`, 'move result and event are inconsistent');
    if (eventValue.to.x !== knownPosition.x || eventValue.to.y !== knownPosition.y) fail(`${path}.events.0.to`, 'move destination does not match the retained position chain');
    const offset = directionOffsets[recordValue.command.direction];
    if (eventValue.to.x !== eventValue.from.x + offset.x || eventValue.to.y !== eventValue.from.y + offset.y) fail(`${path}.events.0.to`, 'move does not match its command direction');
    knownPosition = eventValue.from;
  }
  return run as ActiveRun;
}

export function validateActiveRun(input: unknown): ActiveRun {
  const parsed = activeRunSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.join('.') || '$';
    throw new SaveLoadError('invalid_save', path, `Invalid save at ${path}: ${issue.message}`);
  }
  return validateSemantics(parsed.data);
}
