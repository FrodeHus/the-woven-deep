import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import type { BaseAttributes, EquipmentSlot } from './actor-model.js';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { balanceEntry } from './actions.js';
import { deriveActorStats, type DerivedStatModifier } from './attributes.js';
import type { ClassicThemeSettings } from './generation-model.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId, Uint32State } from './model.js';
import { createEncounterRunDecisions } from './population-gates.js';
import { deriveRngStreams, isNonZeroState } from './random.js';
import { encodeRunSeed } from './run-records-model.js';
import { emptyRunMetrics } from './run-metrics.js';
import { validateActiveRun } from './save-schema.js';
import { generateTownFloor, TOWN_FLOOR_ID } from './town-floor.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

// Dungeon generation settings (Task 5 changes these values); the town start below no longer uses
// them directly, but `descendToNextFloor` still generates every floor below the town at this
// width/height/theme so the whole run stays on one generation profile.
export const NEW_RUN_FLOOR_WIDTH = 80;
export const NEW_RUN_FLOOR_HEIGHT = 25;
export const NEW_RUN_FLOOR_THEME_SETTINGS: ClassicThemeSettings = {
  ambient: { color: [19, 23, 31], strength: 7 },
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

export function createNewRun(input: Readonly<{
  pack: CompiledContentPack;
  seed: Uint32State;
  hero: NewRunHero;
}>): ActiveRun {
  const { pack, seed, hero } = input;
  if (!isNonZeroState(seed)) throw new RangeError('run seed must not be all zero');
  const balance = balanceEntry(pack);
  const maxHealth = deriveActorStats({
    attributes: hero.attributes, formulas: balance.formulas,
    equipmentModifiers: [], conditionModifiers: [], heroModifiers: [hero.statModifiers],
  }).maxHealth;

  const runId = `run.guest.${encodeRunSeed(seed)}`;
  const rng = deriveRngStreams(seed);

  const identified = allocateIdentificationMap({ content: pack, rng });
  const encounters = pack.entries.filter((entry) => entry.kind === 'encounter');
  const gates = createEncounterRunDecisions({
    encounters,
    protectionBonuses: [],
    state: identified.rng['population-gates'],
  });
  const initializedRng = { ...identified.rng, 'population-gates': gates.state };

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
    equippedItems.push(instantiateHeroItem(
      definition,
      itemId,
      { type: 'equipped', actorId: heroActorId, slot: equippedEntry.slot },
      equippedEntry.enabled === undefined ? {} : { enabled: equippedEntry.enabled },
    ));
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

  const items = [...equippedItems, ...backpackItems]
    .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);

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
      currency: 0,
      classTags: hero.classTags,
      statModifiers: hero.statModifiers,
    },
    reputations: [],
    activeTrade: null,
    actors: [heroActorState],
    items,
    features: [],
    relationships: [],
    survival: {
      hungerReserve: 10_000,
      hungerStage: 'sated',
      nextStarvationAt: null,
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
    fallenHeroStandings: [],
    fallenHeroDecisions: [],
    conqueredChampionRecordIds: [],
    // The town never counts toward floorsEntered/deepestDepth: those track dungeon progress, and
    // the hero starts in town without ever "entering" it via a transition.
    metrics: emptyRunMetrics(),
    conclusion: null,
    house: { capacity: balance.house.baseCapacity, upgradesPurchased: 0 },
    restockedMilestones: [],
  };

  return validateActiveRun(skeleton);
}
