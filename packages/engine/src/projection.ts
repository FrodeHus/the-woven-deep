import type {
  CompiledContentPack, CompletionType, ItemContentEntry, MerchantEncounterContentEntry,
} from '@woven-deep/content';
import { heroActor, heroPerception } from './actor-model.js';
import { deriveActorStats } from './attributes.js';
import { balanceEntry } from './actions.js';
import {
  factionReputation, guaranteedUniqueItemIds, merchantAcceptsItem,
  quoteMerchantPurchase, quoteMerchantSale, quoteMerchantService, reputationTier,
} from './commerce.js';
import { conditionDefinition, conditionModifiers } from './conditions.js';
import { equipmentModifiers, itemLightSources } from './equipment.js';
import { featureTiles, projectFeature } from './features.js';
import { projectItem } from './identification.js';
import { isExplored, rememberedTile, validateKnowledgePacking } from './knowledge.js';
import type { IlluminationField, RgbColor } from './light-model.js';
import { computeIllumination } from './lighting.js';
import type { MerchantPopulation } from './merchant-model.js';
import { assertOpaqueId, tileIndex, type ActiveRun, type OpaqueId, type PublicDecision, type TileId } from './model.js';
import type { RecordedHeirloomSnapshot } from './population-model.js';
import { refreshKnowledge, type PerceptionFloor, type PerceptionHero } from './perception.js';
import { relationshipBetween } from './reactions.js';
import type { RunConclusion } from './run-conclusion.js';
import type { RunMetrics } from './run-metrics.js';
import { deriveHallRecordId, type AchievementGrant, type HallRecord } from './run-records-model.js';
import type { ScoreBreakdown } from './score-run.js';
import { compareCodeUnits } from './stable-json.js';
import { hungerModifiers } from './survival.js';
import { tileDefinition } from './terrain.js';
import { activeTradeValidIgnoringDeparture, merchantFaction } from './trade.js';
import { computeFieldOfView, isVisible } from './visibility.js';

export type KnowledgeState = 'unknown' | 'remembered' | 'visible';

export interface ObservableCell {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly knowledge: KnowledgeState;
  readonly tileId?: TileId;
  readonly glyph?: string;
  readonly token?: string;
  readonly intensity: number;
  readonly tint?: RgbColor;
  readonly previewIntensity?: number;
  readonly fixture?: Readonly<{
    lightId: OpaqueId;
    glyph: string;
    token: OpaqueId;
  }>;
}

export interface ObservableFloorProjection {
  readonly floorId: OpaqueId;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly ObservableCell[];
}

export interface LightPreview {
  readonly color: RgbColor;
  readonly radius: number;
  readonly strength: number;
  readonly falloff: 'linear';
}

export interface ProjectFloorInput {
  readonly floor: PerceptionFloor;
  readonly hero: PerceptionHero;
  readonly visibilityWords: readonly number[];
  readonly illumination: IlluminationField;
  readonly preview?: LightPreview;
}

interface FixturePresentation {
  readonly lightId: OpaqueId;
  readonly glyph: string;
  readonly token: OpaqueId;
}

const UNSIGNED_32_BIT_MAX = 0xffff_ffff;

function assertByte(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) {
    throw new RangeError(`${label} must be an integer from 0 through 255`);
  }
}

function validateColor(value: unknown, label: string): asserts value is RgbColor {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must contain exactly three channels`);
  for (let channel = 0; channel < 3; channel += 1) assertByte(value[channel], `${label} channel ${channel}`);
}

function validateChannel(channel: readonly number[], cellCount: number, label: string): void {
  if (!Array.isArray(channel) || channel.length !== cellCount) {
    throw new RangeError(`${label} length must be ${cellCount}`);
  }
  for (let index = 0; index < cellCount; index += 1) assertByte(channel[index], `${label} ${index}`);
}

function validateVisibility(words: readonly number[], cellCount: number): void {
  const expectedLength = Math.ceil(cellCount / 32);
  if (!Array.isArray(words) || words.length !== expectedLength) {
    throw new RangeError(`visibility word length must be ${expectedLength}`);
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!Number.isInteger(word) || (word as number) < 0 || (word as number) > UNSIGNED_32_BIT_MAX) {
      throw new TypeError(`visibility word ${index} must be an unsigned 32-bit integer`);
    }
  }
  const usedBits = cellCount % 32;
  if (usedBits !== 0 && ((words[words.length - 1]! >>> usedBits) !== 0)) {
    throw new TypeError('visibility word padding must be zero');
  }
}

function validateDerivedFields(input: ProjectFloorInput, expectedVisibility: readonly number[], cellCount: number): void {
  validateVisibility(input.visibilityWords, cellCount);
  for (let index = 0; index < expectedVisibility.length; index += 1) {
    if (input.visibilityWords[index] !== expectedVisibility[index]) {
      throw new TypeError('visibility words must match the hero field of view');
    }
  }
  validateChannel(input.illumination.red, cellCount, 'red');
  validateChannel(input.illumination.green, cellCount, 'green');
  validateChannel(input.illumination.blue, cellCount, 'blue');
  validateChannel(input.illumination.intensity, cellCount, 'intensity');
  for (let index = 0; index < cellCount; index += 1) {
    const expectedIntensity = Math.max(
      input.illumination.red[index]!,
      input.illumination.green[index]!,
      input.illumination.blue[index]!,
    );
    if (input.illumination.intensity[index] !== expectedIntensity) {
      throw new TypeError(`intensity ${index} must equal the maximum RGB channel`);
    }
  }
}

function validateRefreshedKnowledge(input: ProjectFloorInput, cellCount: number): void {
  for (let index = 0; index < cellCount; index += 1) {
    const currentlyVisible = isVisible(input.visibilityWords, index) && input.illumination.intensity[index]! > 0;
    if (!currentlyVisible) continue;
    if (!isExplored(input.floor.knowledge, index)
      || rememberedTile(input.floor.knowledge, index) !== input.floor.tiles[index]) {
      throw new TypeError(`visible cell ${index} must agree with refreshed knowledge`);
    }
  }
}

function collectFixtures(floor: PerceptionFloor): ReadonlyMap<number, FixturePresentation> {
  const presented = floor.lights
    .filter((light) => light.location.type === 'fixed' && light.presentation !== null)
    .slice()
    .sort((left, right) => left.lightId < right.lightId ? -1 : left.lightId > right.lightId ? 1 : 0);
  const fixtures = new Map<number, FixturePresentation>();

  for (const light of presented) {
    assertOpaqueId(light.lightId, 'fixture lightId');
    if (light.location.type !== 'fixed' || light.presentation === null) continue;
    const { x, y } = light.location;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || x < 0 || x >= floor.width || y < 0 || y >= floor.height) {
      throw new RangeError(`fixture ${light.lightId} location must be within the floor`);
    }
    if (typeof light.presentation.glyph !== 'string' || [...light.presentation.glyph].length !== 1) {
      throw new TypeError(`fixture ${light.lightId} glyph must be one Unicode glyph`);
    }
    assertOpaqueId(light.presentation.token, `fixture ${light.lightId} token`);
    const index = y * floor.width + x;
    if (fixtures.has(index)) throw new TypeError(`presented fixtures collide at cell ${index}`);
    fixtures.set(index, {
      lightId: light.lightId,
      glyph: light.presentation.glyph,
      token: light.presentation.token,
    });
  }
  return fixtures;
}

function computePreview(input: ProjectFloorInput): readonly number[] | undefined {
  if (input.preview === undefined) return undefined;
  validateColor(input.preview.color, 'preview color');
  const cellCount = input.floor.width * input.floor.height;
  const previewTiles: TileId[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const currentlyVisible = isVisible(input.visibilityWords, index) && input.illumination.intensity[index]! > 0;
    if (currentlyVisible) {
      previewTiles.push(input.floor.tiles[index]!);
      continue;
    }
    if (isExplored(input.floor.knowledge, index)) {
      const tileId = rememberedTile(input.floor.knowledge, index);
      if (tileId === undefined) throw new TypeError(`explored cell ${index} must have remembered terrain`);
      previewTiles.push(tileId);
      continue;
    }
    previewTiles.push(0);
  }
  const field = computeIllumination({
    width: input.floor.width,
    height: input.floor.height,
    tiles: previewTiles,
    ambient: { color: [0, 0, 0], strength: 0 },
    lights: [{
      lightId: 'preview.light',
      location: { type: 'fixed', x: input.hero.x, y: input.hero.y },
      color: input.preview.color,
      radius: input.preview.radius,
      strength: input.preview.strength,
      enabled: true,
      falloff: input.preview.falloff,
      vaultPlacementId: null,
      presentation: null,
    }],
    actors: new Map(),
  });
  return field.intensity;
}

export function projectFloor(input: ProjectFloorInput): ObservableFloorProjection {
  assertOpaqueId(input.floor.floorId, 'floorId');
  assertOpaqueId(input.hero.heroId, 'heroId');
  const cellCount = input.floor.width * input.floor.height;

  const expectedVisibility = computeFieldOfView({
    width: input.floor.width,
    height: input.floor.height,
    tiles: input.floor.tiles,
    origin: { x: input.hero.x, y: input.hero.y },
    radius: input.hero.sightRadius,
  });
  validateKnowledgePacking(input.floor.knowledge, cellCount);
  // RGB channels are the trusted refreshKnowledge output; projection can verify
  // their structure and derived intensities but cannot resolve actor lights itself.
  validateDerivedFields(input, expectedVisibility, cellCount);
  validateRefreshedKnowledge(input, cellCount);
  const fixtures = collectFixtures(input.floor);
  const previewIntensity = computePreview(input);
  const cells: ObservableCell[] = [];

  for (let index = 0; index < cellCount; index += 1) {
    const x = index % input.floor.width;
    const y = Math.floor(index / input.floor.width);
    const currentlyVisible = isVisible(input.visibilityWords, index) && input.illumination.intensity[index]! > 0;
    const explored = isExplored(input.floor.knowledge, index);

    if (!currentlyVisible && !explored) {
      cells.push({ index, x, y, knowledge: 'unknown', intensity: 0 });
      continue;
    }

    if (!currentlyVisible) {
      const tileId = rememberedTile(input.floor.knowledge, index)!;
      const terrain = tileDefinition(tileId);
      const cell: ObservableCell = {
        index, x, y, knowledge: 'remembered', tileId,
        glyph: terrain.glyph, token: terrain.token, intensity: 24,
      };
      const preview = previewIntensity?.[index];
      cells.push(preview !== undefined && preview > 0 ? { ...cell, previewIntensity: preview } : cell);
      continue;
    }

    const tileId = input.floor.tiles[index]!;
    const terrain = tileDefinition(tileId);
    const tint: RgbColor = [
      input.illumination.red[index]!,
      input.illumination.green[index]!,
      input.illumination.blue[index]!,
    ];
    const cell: ObservableCell = {
      index, x, y, knowledge: 'visible', tileId,
      glyph: terrain.glyph, token: terrain.token,
      intensity: input.illumination.intensity[index]!, tint,
    };
    const preview = previewIntensity?.[index];
    const withPreview: ObservableCell = preview !== undefined && preview > 0
      ? { ...cell, previewIntensity: preview }
      : cell;
    const fixture = fixtures.get(index);
    cells.push(fixture === undefined ? withPreview : {
      ...withPreview,
      fixture: { lightId: fixture.lightId, glyph: fixture.glyph, token: fixture.token },
    });
  }

  return { floorId: input.floor.floorId, width: input.floor.width, height: input.floor.height, cells };
}

export interface ObservableTradeProjection {
  readonly merchantPopulationId: OpaqueId;
  readonly merchantActorId: OpaqueId;
  readonly merchantName: string;
  readonly factionName: string;
  readonly reputationTier: string;
  readonly currency: number;
  readonly stock: readonly Readonly<{ item: Readonly<Record<string, unknown>>; quantity: number; unitPrice: number }>[];
  readonly saleOffers: readonly Readonly<{ itemId: OpaqueId; quantity: number; unitPrice: number }>[];
  readonly services: readonly Readonly<{
    serviceId: 'merchant-service.identify'; unitPrice: number; remainingUses: number;
    targetItemIds: readonly OpaqueId[];
  }>[];
}

export interface GameplayProjection {
  readonly floor: ObservableFloorProjection;
  readonly hero: Readonly<Record<string, unknown>>;
  readonly actors: readonly Readonly<Record<string, unknown>>[];
  readonly features: readonly Readonly<Record<string, unknown>>[];
  readonly groundItems: readonly Readonly<Record<string, unknown>>[];
  readonly actions: readonly Readonly<{ type: string; cost: number }>[];
  readonly trade?: ObservableTradeProjection;
  readonly metrics: RunMetrics;
  readonly conclusion: Readonly<{ completionType: CompletionType; cause: RunConclusion['cause'] }> | null;
}

/**
 * Projects a concluded run's story for its controlling hero: the run is over, so the completion
 * type, cause, and metrics snapshot are always safe to expose. Once the host supplies the
 * `finalizeRun` output — its `record` — the full score breakdown, heirloom, and granted
 * achievements join the projection; the record's `recordId` must match this run's own derived
 * identifier, else the caller has attached the wrong hero's Hall record and the projection throws
 * rather than leak it. Returns `null` while the run is still in progress.
 */
export function projectRunConclusion(input: Readonly<{
  run: ActiveRun;
  record: HallRecord | null;
  achievements: readonly AchievementGrant[];
}>): RunConclusionProjection | null {
  const { run, record, achievements } = input;
  const { conclusion } = run;
  if (conclusion === null) return null;
  if (record !== null) {
    const expectedRecordId = deriveHallRecordId(run.runSeed, run.contentHash);
    if (record.recordId !== expectedRecordId) {
      throw new Error(`run conclusion record provenance mismatch: expected ${expectedRecordId}, got ${record.recordId}`);
    }
  }
  return {
    completionType: conclusion.completionType,
    cause: conclusion.cause,
    metrics: run.metrics,
    finalized: record !== null,
    score: record?.score ?? null,
    heirloom: record?.heirloom ?? null,
    achievements,
  };
}

export interface RunConclusionProjection {
  readonly completionType: CompletionType;
  readonly cause: RunConclusion['cause'];
  readonly metrics: RunMetrics;
  readonly finalized: boolean;
  readonly score: ScoreBreakdown | null;
  readonly heirloom: RecordedHeirloomSnapshot | null;
  readonly achievements: readonly AchievementGrant[];
}

/**
 * Qualitative merchant extension for a visible merchant actor: faction name, reputation tier,
 * trade availability, and only the most urgent already-emitted departure warning. The exact
 * `departureAt` deadline never influences anything beyond the availability boolean.
 */
function visibleMerchantState(
  state: ActiveRun, content: CompiledContentPack, population: MerchantPopulation,
): Readonly<Record<string, unknown>> {
  const faction = merchantFaction(content, population.factionId);
  const tier = reputationTier(factionReputation(state, faction), faction);
  const urgentWarning = population.emittedWarningThresholds.length === 0
    ? undefined : Math.min(...population.emittedWarningThresholds);
  return {
    factionName: faction.name,
    reputationTier: tier.tierId,
    tradeAvailable: population.lifecycle === 'available' && tier.acceptsTrade
      && population.departureAt > state.worldTime,
    ...(urgentWarning === undefined ? {} : { departureWarning: urgentWarning }),
  };
}

/**
 * Exact modal commerce projection, derived only while the active trade session invariant still
 * holds (the same probe the merchant lifecycle uses to defer a due departure). Every item is
 * routed through `projectItem`, so unidentified stock stays appearance-only, and all lists are
 * sorted by code-unit identifier.
 */
function projectActiveTrade(
  state: ActiveRun, content: CompiledContentPack,
): ObservableTradeProjection | undefined {
  const trade = state.activeTrade;
  if (trade === null || !activeTradeValidIgnoringDeparture(state, content)) return undefined;
  const population = state.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.populationId === trade.merchantPopulationId);
  const actor = state.actors.find((candidate) => candidate.actorId === trade.merchantActorId);
  const encounterEntry = population === undefined ? undefined
    : content.entries.find((candidate) => candidate.id === population.encounterId);
  const encounter: MerchantEncounterContentEntry | undefined =
    encounterEntry?.kind === 'encounter' && encounterEntry.model === 'merchant' ? encounterEntry : undefined;
  if (!population || !actor || !encounter) return undefined;
  const faction = merchantFaction(content, population.factionId);
  const tier = reputationTier(factionReputation(state, faction), faction);
  const hero = heroActor(state);
  const itemEntry = (contentId: OpaqueId): ItemContentEntry | undefined => {
    const entry = content.entries.find((candidate) => candidate.id === contentId);
    return entry?.kind === 'item' ? entry : undefined;
  };
  const stock = [...population.stockItemIds]
    .sort(compareCodeUnits)
    .flatMap((itemId) => {
      const item = state.items.find((candidate) => candidate.itemId === itemId);
      const definition = item === undefined ? undefined : itemEntry(item.contentId);
      if (!item || !definition) return [];
      return [{
        item: projectItem({ run: state, content, itemId }),
        quantity: item.quantity,
        unitPrice: quoteMerchantPurchase({ basePrice: definition.price,
          merchantBps: encounter.definition.merchantSaleBps, factionBps: tier.purchasePriceBps }),
      }];
    });
  const uniqueItemIds = guaranteedUniqueItemIds(content);
  const saleOffers = state.items
    .filter((item) => item.location.type === 'backpack' && item.location.actorId === hero.actorId)
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId))
    .flatMap((item) => {
      const definition = itemEntry(item.contentId);
      if (!definition || !merchantAcceptsItem(item, definition, encounter, uniqueItemIds)) return [];
      return [{
        itemId: item.itemId,
        quantity: item.quantity,
        unitPrice: quoteMerchantSale({ basePrice: definition.price,
          merchantBps: encounter.definition.merchantPurchaseBps, factionBps: tier.salePriceBps }),
      }];
    });
  const identifyTargetIds = state.items
    .filter((item) => (item.location.type === 'backpack' || item.location.type === 'equipped')
      && item.location.actorId === hero.actorId)
    .filter((item) => {
      const definition = itemEntry(item.contentId);
      if (!definition) return false;
      const appearanceId = state.identification.appearanceByContentId[item.contentId];
      const appearanceUnknown = definition.identification.mode === 'shuffled' && appearanceId !== undefined
        && !state.identification.knownAppearanceIds.includes(appearanceId);
      return !item.identified || appearanceUnknown;
    })
    .map((item) => item.itemId)
    .sort(compareCodeUnits);
  const services = [...population.services]
    .filter((service) => tier.serviceIds.includes(service.serviceId)
      && service.tierIds.includes(tier.tierId))
    .sort((left, right) => compareCodeUnits(left.serviceId, right.serviceId))
    .map((service) => ({
      serviceId: service.serviceId,
      unitPrice: quoteMerchantService({ basePrice: service.basePrice, factionBps: tier.purchasePriceBps }),
      remainingUses: service.remainingUses,
      targetItemIds: identifyTargetIds,
    }));
  return {
    merchantPopulationId: population.populationId,
    merchantActorId: actor.actorId,
    merchantName: actor.populationPresentation?.name ?? faction.name,
    factionName: faction.name,
    reputationTier: tier.tierId,
    currency: state.hero.currency,
    stock, saleOffers, services,
  };
}

function projectionPerception(state: ActiveRun, content: CompiledContentPack) {
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const effectiveFloor = { ...floor, tiles: featureTiles(state, floor.floorId) };
  const positions = new Map<string, Readonly<{ x: number; y: number }>>(
    floor.entities.map((entity) => [entity.entityId, entity] as const),
  );
  for (const actor of state.actors) if (actor.floorId === floor.floorId) positions.set(actor.actorId, actor);
  const perception = refreshKnowledge({
    floor: effectiveFloor, hero: heroPerception(state.hero, hero), actors: positions,
    additionalLights: itemLightSources({ run: state, content, floorId: floor.floorId }),
  });
  return { hero, floor: { ...effectiveFloor, knowledge: perception.knowledge }, ...perception };
}

function visiblyOccupied(input: ReturnType<typeof projectionPerception>, x: number, y: number): boolean {
  const index = tileIndex(input.floor, x, y);
  return index !== undefined && isVisible(input.visibilityWords, index)
    && input.illumination.intensity[index]! > 0;
}

function projectedOwnedItem(state: ActiveRun, content: CompiledContentPack, itemId: OpaqueId) {
  const item = state.items.find((candidate) => candidate.itemId === itemId)!;
  const projected = projectItem({ run: state, content, itemId });
  return { ...projected, condition: item.condition,
    ...('contentId' in projected ? { charges: item.charges } : {}), fuel: item.fuel, enabled: item.enabled };
}

export function projectGameplayState(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
}>): GameplayProjection {
  const observed = projectionPerception(input.state, input.content);
  const { hero } = observed;
  const rules = balanceEntry(input.content);
  const derived = deriveActorStats({
    attributes: hero.attributes, formulas: rules.formulas,
    equipmentModifiers: equipmentModifiers({ run: input.state, content: input.content, actorId: hero.actorId })
      .map((source) => source.modifiers),
    conditionModifiers: [
      ...conditionModifiers(hero, input.content),
      hungerModifiers({ stage: input.state.survival.hungerStage, balance: rules }),
    ],
    heroModifiers: [input.state.hero.statModifiers],
  });
  const backpack = input.state.items
    .filter((item) => item.location.type === 'backpack' && item.location.actorId === hero.actorId)
    .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0)
    .map((item) => projectedOwnedItem(input.state, input.content, item.itemId));
  const equipment = Object.fromEntries(Object.entries(hero.equipment).map(([slot, itemId]) => [
    slot, itemId === null ? null : projectedOwnedItem(input.state, input.content, itemId),
  ]));
  const conditions = hero.conditions.map((condition) => {
    const definition = conditionDefinition(input.content, condition.conditionId);
    return { conditionId: definition.id, name: definition.name, color: definition.color,
      stacks: condition.stacks, expiresAt: condition.expiresAt };
  });
  const actors = input.state.actors.filter((actor) => actor.actorId !== hero.actorId
    && actor.floorId === hero.floorId && actor.health > 0 && visiblyOccupied(observed, actor.x, actor.y))
    .sort((left, right) => left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0)
    .map((actor) => {
      const definition = input.content.entries.find((entry) => entry.id === actor.contentId);
      const population = input.state.populations.find((candidate) => candidate.populationId === actor.populationId);
      const encounter = population === undefined ? undefined : input.content.entries.find((entry) =>
        entry.kind === 'encounter' && entry.id === population.encounterId);
      const presentation = actor.populationPresentation ?? (definition?.kind === 'monster'
        ? { name: definition.name, glyph: definition.glyph, color: definition.color } : {});
      const healthRatio = actor.maxHealth === 0 ? 0 : actor.health / actor.maxHealth;
      const healthBand = healthRatio >= 0.75 ? 'healthy' : healthRatio >= 0.4 ? 'wounded' : 'critical';
      const sourceState = population?.model === 'swarm' && population.sourceActorId === actor.actorId
        ? { source: true, sourceState: population.shutdownState === null ? 'active' : population.shutdownState,
          growthWarning: population.shutdownState === null ? 'may-spawn' : 'contained' }
        : {};
      const bossState = population?.model === 'boss'
        ? { bossPhase: population.currentPhaseId }
        : {};
      const merchantState = population?.model === 'merchant'
        ? visibleMerchantState(input.state, input.content, population)
        : {};
      return { actorId: actor.actorId, contentId: actor.contentId, ...presentation,
        ...((population?.model === 'champion' || population?.model === 'echo') ? {
          equipmentContentIds: population.equipmentContentIds,
          abilityIds: population.abilityIds,
        } : {}),
        ...sourceState, ...bossState, ...merchantState,
        x: actor.x, y: actor.y, health: actor.health, maxHealth: actor.maxHealth,
        healthPresentation: { current: actor.health, maximum: actor.maxHealth, band: healthBand },
        disposition: relationshipBetween(input.state, hero.actorId, actor.actorId),
        ...((encounter?.kind === 'encounter' && encounter.intentPresentation.visible) ? {
          intent: actor.behaviorState.intent,
          intentPresentation: `intent.${actor.behaviorState.intent}`,
        } : {}),
        ...(population?.model === 'group' && population.leaderActorId === actor.actorId
          ? { leadershipRole: actor.populationRoleId } : {}),
      };
    });
  const features = input.state.features.filter((feature) => feature.floorId === hero.floorId
    && visiblyOccupied(observed, feature.x, feature.y))
    .sort((left, right) => left.featureId < right.featureId ? -1 : left.featureId > right.featureId ? 1 : 0)
    .map((feature) => projectFeature(feature, hero.actorId)).filter((feature) => feature !== undefined);
  const groundItems = input.state.items.filter((item) => item.location.type === 'floor'
    && item.location.floorId === hero.floorId && visiblyOccupied(observed, item.location.x, item.location.y))
    .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0)
    .map((item) => ({ ...projectItem({ run: input.state, content: input.content, itemId: item.itemId }),
      x: item.location.type === 'floor' ? item.location.x : 0,
      y: item.location.type === 'floor' ? item.location.y : 0 }));
  const trade = projectActiveTrade(input.state, input.content);
  return {
    ...(trade === undefined ? {} : { trade }),
    floor: projectFloor({ floor: observed.floor, hero: heroPerception(input.state.hero, hero),
      visibilityWords: observed.visibilityWords, illumination: observed.illumination }),
    hero: {
      actorId: hero.actorId, name: input.state.hero.name, x: hero.x, y: hero.y,
      attributes: { ...hero.attributes },
      derived: Object.fromEntries(Object.entries(derived).map(([name, value]) => [name, {
        value, formula: { ...(rules.formulas[name] ?? {}) },
      }])),
      health: hero.health, maxHealth: hero.maxHealth, sightRadius: input.state.hero.sightRadius,
      hungerStage: input.state.survival.hungerStage, conditions, equipment, backpack,
      backpackCapacity: input.state.hero.backpackCapacity,
      knownAppearanceIds: [...input.state.identification.knownAppearanceIds],
    },
    actors, features, groundItems,
    actions: ['move', 'wait', 'attack', 'pickup', 'use-item', 'equip', 'rest'].map((type) => ({
      type, cost: type === 'rest' ? rules.actionCosts['action.wait'] ?? rules.normalActionCost
        : rules.actionCosts[`action.${type}`] ?? rules.normalActionCost,
    })),
    metrics: input.state.metrics,
    conclusion: input.state.conclusion === null ? null : {
      completionType: input.state.conclusion.completionType,
      cause: input.state.conclusion.cause,
    },
  };
}

export function projectDecision(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  decision: PublicDecision;
}>): PublicDecision | undefined {
  if (input.decision.type === 'confirm-aggression') {
    const observed = projectionPerception(input.state, input.content);
    const target = input.state.actors.find((actor) => actor.actorId === input.decision.targetActorId);
    if (!target || target.floorId !== observed.hero.floorId || !visiblyOccupied(observed, target.x, target.y)) return undefined;
    return { type: 'confirm-aggression', targetActorId: target.actorId };
  }
  return undefined;
}
