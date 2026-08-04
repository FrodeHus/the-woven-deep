import type {
  CompiledContentPack,
  FallenChampionTemplateContentEntry,
  ItemContentEntry,
  MerchantEncounterContentEntry,
} from '@woven-deep/content';
import type { BaseAttributes, EquipmentSlot } from './actor-model.js';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { balanceEntry } from './actions.js';
import { createFallenHeroRunDecisions } from './champion.js';
import { artifactItemIds, guaranteedUniqueItemIds } from './commerce.js';
import { deriveActorStats, type DerivedStatModifier } from './attributes.js';
import type { ClassicThemeSettings } from './generation-model.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import { validateRequiredFloorLootTables } from './loot-placement.js';
import { materializeMerchant } from './merchant-stock.js';
import type { ActiveRun, OpaqueId, Point, RunMode, Uint32State } from './model.js';
import { createEncounterRunDecisions } from './population-gates.js';
import type { FallenHeroStandingSnapshot } from './population-model.js';
import { deriveRngStreams, isNonZeroState, rollDie } from './random.js';
import { encodeRunSeed } from './run-records-model.js';
import { emptyRunMetrics } from './run-metrics.js';
import { validateActiveRun } from './save-schema.js';
import { compareCodeUnits } from './stable-json.js';
import { generateTownFloor, TOWN_FLOOR_ID } from './town-floor.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

interface TownMerchantSpec {
  readonly populationId: OpaqueId;
  readonly encounterId: OpaqueId;
  readonly position: Point;
}

function townMerchantSpecs(
  town: ReturnType<typeof generateTownFloor>,
): readonly TownMerchantSpec[] {
  return [
    {
      populationId: 'population.town-provisioner',
      encounterId: 'encounter.town-provisioner',
      position: town.merchantSlots.provisioner,
    },
    {
      populationId: 'population.town-armorer',
      encounterId: 'encounter.town-armorer',
      position: town.merchantSlots.arms,
    },
    {
      populationId: 'population.town-curios-dealer',
      encounterId: 'encounter.town-curios-dealer',
      position: town.merchantSlots.curios,
    },
    {
      populationId: 'population.town-spellvendor',
      encounterId: 'encounter.town-spellvendor',
      position: town.merchantSlots.spellvendor,
    },
  ];
}

function townMerchantEncounter(
  pack: CompiledContentPack,
  encounterId: OpaqueId,
): MerchantEncounterContentEntry {
  const entry = pack.entries.find((candidate) => candidate.id === encounterId);
  if (
    !entry ||
    entry.kind !== 'encounter' ||
    entry.model !== 'merchant' ||
    !entry.definition.permanent
  ) {
    throw new Error(`createNewRun requires a permanent town merchant encounter ${encounterId}`);
  }
  return entry;
}

// Dungeon generation settings. The authored town floor doesn't use them; `descendToNextFloor`
// generates every floor below the town at this width/height/theme so the whole run stays on one
// generation profile. 160x50 (with a raised room floor) is the
// larger-dungeon baseline: `createClassicTheme` caps width at 160 and height at 100, so this sits
// at the width ceiling with headroom on height.
export const NEW_RUN_FLOOR_WIDTH = 160;
export const NEW_RUN_FLOOR_HEIGHT = 50;
export const NEW_RUN_FLOOR_THEME_SETTINGS: ClassicThemeSettings = {
  ambient: { color: [19, 23, 31], strength: 7 },
  minimumRooms: 14,
};

export interface NewRunHeroItem {
  readonly contentId: OpaqueId;
  readonly slot: EquipmentSlot;
  readonly enabled?: boolean;
}

export interface NewRunBackpackItem {
  readonly contentId: OpaqueId;
  readonly quantity?: number;
}

export interface NewRunHero {
  readonly name: string;
  readonly attributes: BaseAttributes;
  readonly equipped: readonly NewRunHeroItem[];
  readonly backpack: readonly NewRunBackpackItem[];
  readonly classTags: readonly string[];
  readonly statModifiers: DerivedStatModifier;
  readonly knownSpellIds?: readonly OpaqueId[];
}

export const DEFAULT_GUEST_HERO: NewRunHero = {
  name: 'Wayfarer',
  attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
  equipped: [
    { contentId: 'item.iron-sword', slot: 'main-hand' },
    { contentId: 'item.leather-armor', slot: 'body' },
    { contentId: 'item.pitch-torch', slot: 'off-hand', enabled: true },
  ],
  backpack: [{ contentId: 'item.travel-ration', quantity: 3 }],
  classTags: ['wayfarer'],
  statModifiers: {},
};

function itemContentEntry(pack: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = pack.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item') {
    throw new Error(`createNewRun requires item content ${contentId}`);
  }
  return entry;
}

// Discriminated by location, not just contentId: a kit can (and one bundled kit does, e.g. the
// lamplighter's torchbearer spare torch) equip an item while also carrying another copy of the
// same contentId in the backpack, and a background's extraItems can duplicate a kit's backpack
// contentId too. Suffixing only the contentId would collide and violate the save schema's
// strictly-increasing/unique itemId invariant.
function heroEquippedItemId(contentId: OpaqueId, slot: EquipmentSlot): OpaqueId {
  return `item.hero.equipped.${slot}.${contentId.slice('item.'.length)}`;
}

function heroBackpackItemId(contentId: OpaqueId, index: number): OpaqueId {
  return `item.hero.backpack.${index}.${contentId.slice('item.'.length)}`;
}

function instantiateHeroItem(
  definition: ItemContentEntry,
  itemId: OpaqueId,
  location: ItemInstance['location'],
  overrides: Partial<Pick<ItemInstance, 'quantity' | 'enchantment' | 'fuel' | 'enabled'>> = {},
): ItemInstance {
  const light = definition.light;
  return {
    itemId,
    contentId: definition.id,
    quantity: overrides.quantity ?? 1,
    condition: 100,
    enchantment: overrides.enchantment ?? null,
    identified: definition.identification.mode === 'known',
    charges: null,
    // `fuel`/`enabled` overrides only apply to light items — content-bound validation rejects a
    // non-light item carrying either. The content schema keeps kit `enabled` optional and content
    // validation rejects it on non-light kit lines, so validated packs can never deliver one here;
    // this light-gating is defense-in-depth for hand-built `NewRunHero` inputs that bypass
    // content validation.
    fuel: light ? (overrides.fuel ?? light.fuelCapacity) : null,
    enabled: light ? (overrides.enabled ?? false) : null,
    location,
  };
}

/**
 * The player's cross-run history, supplied by the host from its repositories. Omitting it creates
 * a history-free run: no Hall standings, no conquered champions, and no artifact offer -- the
 * guest path, byte-identical to a run created before records existed.
 */
export interface NewRunRecordsInput {
  /**
   * The Hall's top standings, at most ten and contiguously ranked from 1 (`validateActiveRun`
   * rejects anything else). A `RunRecordRepository.standings(limit)` result already satisfies
   * both — it is the only intended source.
   */
  readonly standings: readonly FallenHeroStandingSnapshot[];
  /** Artifact ids the player has not secured yet. Any order; ids the pack does not define as
   * artifacts are dropped, and the survivors are de-duplicated and sorted here. */
  readonly undiscoveredArtifactIds: readonly OpaqueId[];
  /**
   * Hall record ids whose champion this player has already put down — they stay conquered rather
   * than being re-raised. Must be SORTED and UNIQUE (`validateActiveRun` throws otherwise);
   * `RunRecordRepository.lifetime().conqueredChampionRecordIds` is maintained that way.
   */
  readonly conqueredChampionRecordIds: readonly OpaqueId[];
  /**
   * Ancient Tablet fragment content ids the player has banked in earlier runs. Must be SORTED and
   * UNIQUE (`validateActiveRun` throws otherwise);
   * `RunRecordRepository.lifetime().collectedFragmentIds` is maintained that way.
   */
  readonly collectedFragmentIds: readonly OpaqueId[];
}

function championTemplate(pack: CompiledContentPack): FallenChampionTemplateContentEntry {
  const entry = pack.entries.find(
    (candidate): candidate is FallenChampionTemplateContentEntry =>
      candidate.kind === 'fallen-champion-template',
  );
  if (!entry)
    throw new Error('createNewRun requires a fallen-champion-template for Hall standings');
  return entry;
}

/**
 * The artifacts this run may offer in a deep vault: undiscovered ids the pack actually defines as
 * artifacts, minus every boss `uniqueItemId` (those are earned off their boss, never vault-rolled).
 */
function vaultArtifactPool(
  pack: CompiledContentPack,
  undiscovered: readonly OpaqueId[],
): readonly OpaqueId[] {
  const bossUniques = guaranteedUniqueItemIds(pack);
  return undiscovered.filter((artifactId) => !bossUniques.has(artifactId));
}

export function createNewRun(
  input: Readonly<{
    pack: CompiledContentPack;
    seed: Uint32State;
    hero: NewRunHero;
    records?: NewRunRecordsInput;
    mode?: RunMode;
  }>,
): ActiveRun {
  const { pack, seed, hero, records, mode } = input;
  if (!isNonZeroState(seed)) throw new RangeError('run seed must not be all zero');
  // Pack-only preflight, run once here rather than per command: a pack missing one of the
  // engine-required floor loot tables must fail at run creation, not on the first descent.
  validateRequiredFloorLootTables(pack);
  const balance = balanceEntry(pack);
  const heroStats = deriveActorStats({
    attributes: hero.attributes,
    formulas: balance.formulas,
    weaveRegenAmount: balance.weaveRegenAmount,
    equipmentModifiers: [],
    conditionModifiers: [],
    heroModifiers: [hero.statModifiers],
  });
  const maxHealth = heroStats.maxHealth;
  const maxWeave = heroStats.maxWeave;

  const runId = `run.guest.${encodeRunSeed(seed)}`;
  const rng = deriveRngStreams(seed);

  const identified = allocateIdentificationMap({ content: pack, rng });
  const encounters = pack.entries.filter((entry) => entry.kind === 'encounter');
  const gates = createEncounterRunDecisions({
    encounters,
    protectionBonuses: [],
    state: identified.rng['population-gates'],
  });
  // Hall standings ride the same `population-gates` stream the encounter gates just advanced, in
  // that order. With no standings the call is skipped entirely: it would consume nothing, but a
  // pack without a champion template must still be able to create a history-free run.
  const standings = records?.standings ?? [];
  const fallenHeroes =
    standings.length > 0
      ? createFallenHeroRunDecisions({
          standings,
          conqueredChampionRecordIds: records!.conqueredChampionRecordIds,
          template: championTemplate(pack),
          state: gates.state,
        })
      : { decisions: [], state: gates.state };

  const artifactIds = artifactItemIds(pack);
  const artifactsUndiscovered = [...new Set(records?.undiscoveredArtifactIds ?? [])]
    .filter((artifactId) => artifactIds.has(artifactId))
    .sort(compareCodeUnits);

  // The artifact offer is the first (and at creation the only) consumer of `run-records`: one
  // percentile roll for whether this run offers a vault artifact, and on success one uniform roll
  // over the pool. An empty pool consumes no randomness at all, so a player who has secured every
  // artifact draws the same stream as one whose host supplied no records.
  const offerPool = vaultArtifactPool(pack, artifactsUndiscovered);
  let runRecordsState = identified.rng['run-records'];
  let offeredArtifact: OpaqueId | null = null;
  if (offerPool.length > 0) {
    const offerRoll = rollDie(runRecordsState, 100);
    runRecordsState = offerRoll.state;
    if (offerRoll.value <= balance.generation.artifactOfferPercent) {
      const pick = rollDie(runRecordsState, offerPool.length);
      runRecordsState = pick.state;
      offeredArtifact = offerPool[pick.value - 1]!;
    }
  }

  const initializedRng = {
    ...identified.rng,
    'population-gates': fallenHeroes.state,
    'run-records': runRecordsState,
  };

  // The town is authored, not generated: it consumes no randomness, so the RNG streams above stay
  // untouched at their post-identification/post-gates values -- no floor-seed allocation happens.
  const town = generateTownFloor(pack);

  const heroActorId: OpaqueId = 'hero.guest';
  let equipment = emptyEquipment();
  const equippedItems: ItemInstance[] = [];
  for (const equippedEntry of hero.equipped) {
    const definition = itemContentEntry(pack, equippedEntry.contentId);
    if (!definition.equipment) {
      throw new Error(`createNewRun requires equippable item content ${equippedEntry.contentId}`);
    }
    const itemId = heroEquippedItemId(equippedEntry.contentId, equippedEntry.slot);
    equipment = { ...equipment, [equippedEntry.slot]: itemId };
    equippedItems.push(
      instantiateHeroItem(
        definition,
        itemId,
        { type: 'equipped', actorId: heroActorId, slot: equippedEntry.slot },
        equippedEntry.enabled === undefined ? {} : { enabled: equippedEntry.enabled },
      ),
    );
  }

  const backpackItems: ItemInstance[] = hero.backpack.map((backpackEntry, index) => {
    const definition = itemContentEntry(pack, backpackEntry.contentId);
    const itemId = heroBackpackItemId(backpackEntry.contentId, index);
    return instantiateHeroItem(
      definition,
      itemId,
      { type: 'backpack', actorId: heroActorId },
      backpackEntry.quantity === undefined ? {} : { quantity: backpackEntry.quantity },
    );
  });

  const items = [...equippedItems, ...backpackItems].sort((left, right) =>
    left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
  );

  const heroActorState: ActorState = {
    actorId: heroActorId,
    contentId: 'hero.adventurer',
    playerControlled: true,
    floorId: TOWN_FLOOR_ID,
    x: town.entrancePlaza.x,
    y: town.entrancePlaza.y,
    attributes: hero.attributes,
    health: maxHealth,
    maxHealth,
    weave: maxWeave,
    maxWeave,
    energy: 100,
    speed: 100,
    reactionReady: true,
    disposition: 'friendly',
    awareActorIds: [],
    conditions: [],
    equipment,
    behaviorId: null,
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
  };

  const skeleton: ActiveRun = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: ENGINE_GAME_VERSION,
    contentHash: pack.hash,
    mode: mode ?? 'classic',
    runId,
    runSeed: seed,
    rng: initializedRng,
    revision: 0,
    turn: 0,
    worldTime: 0,
    hero: {
      actorId: heroActorId,
      name: hero.name,
      sightRadius: 12,
      backpackCapacity: 12,
      currency: balance.startingCurrency,
      classTags: hero.classTags,
      statModifiers: hero.statModifiers,
      tempering: {
        banked: 0,
        spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
      },
      ...(hero.knownSpellIds && hero.knownSpellIds.length > 0
        ? { knownSpellIds: hero.knownSpellIds }
        : {}),
    },
    reputations: [],
    activeTrade: null,
    actors: [heroActorState],
    items,
    features: [],
    relationships: [],
    survival: {
      hungerReserve: balance.hungerMaximum,
      hungerStage: 'sated',
      nextStarvationAt: null,
      starvationTicks: 0,
      emittedHungerWarnings: [],
      emittedFuelWarnings: [],
    },
    identification: identified.identification,
    activeFloorId: TOWN_FLOOR_ID,
    activeFloorEnteredAt: 0,
    floors: [town.floor],
    recentCommands: [],
    encounterDecisions: gates.decisions,
    populations: [],
    fallenHeroStandings: standings,
    fallenHeroDecisions: fallenHeroes.decisions,
    conqueredChampionRecordIds: records?.conqueredChampionRecordIds ?? [],
    collectedFragmentIds: records?.collectedFragmentIds ?? [],
    offeredArtifact,
    artifactsUndiscovered,
    // The town never counts toward floorsEntered/deepestDepth: those track dungeon progress, and
    // the hero starts in town without ever "entering" it via a transition.
    metrics: emptyRunMetrics(),
    conclusion: null,
    house: { capacity: balance.house.baseCapacity, upgradesPurchased: 0 },
    restockedMilestones: [],
  };

  // Town shopkeepers are permanent merchants, materialized here (deterministically, in a fixed
  // order) rather than through population placement: their stock is projected against the run's
  // dungeon high-water mark (max(1, deepestDepth) === 1 for a fresh run), not the town's own
  // depth 0. Each materialization consumes further `merchant-stock` RNG state in order.
  let withMerchants: ActiveRun = skeleton;
  for (const spec of townMerchantSpecs(town)) {
    const encounter = townMerchantEncounter(pack, spec.encounterId);
    const materialized = materializeMerchant({
      run: withMerchants,
      content: pack,
      encounter,
      populationId: spec.populationId,
      floorId: TOWN_FLOOR_ID,
      position: spec.position,
    });
    withMerchants = {
      ...withMerchants,
      rng: { ...withMerchants.rng, 'merchant-stock': materialized.nextMerchantStockState },
      actors: [...withMerchants.actors, materialized.actor].sort((left, right) =>
        compareCodeUnits(left.actorId, right.actorId),
      ),
      items: [...withMerchants.items, ...materialized.items].sort((left, right) =>
        compareCodeUnits(left.itemId, right.itemId),
      ),
      populations: [...withMerchants.populations, materialized.population].sort((left, right) =>
        compareCodeUnits(left.populationId, right.populationId),
      ),
      // Town merchants bypass ordinary population placement, so their encounter decision's
      // instance count (content-bound validated against `run.populations`) is bumped here.
      encounterDecisions: withMerchants.encounterDecisions.map((decision) =>
        decision.encounterId === spec.encounterId
          ? { ...decision, instancesCreated: decision.instancesCreated + 1 }
          : decision,
      ),
    };
  }

  return validateActiveRun(withMerchants);
}
