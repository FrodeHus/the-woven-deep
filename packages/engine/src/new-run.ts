import type { CompiledContentPack, ItemContentEntry, VaultContentEntry } from '@woven-deep/content';
import type { BaseAttributes, EquipmentSlot } from './actor-model.js';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { addGeneratedFloor } from './floor-integration.js';
import { generateFloor } from './generate-floor.js';
import type { ClassicThemeSettings } from './generation-model.js';
import { createClassicTheme } from './generation-mask.js';
import { allocateFloorSeed } from './generation-random.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId, Uint32State } from './model.js';
import { createEncounterRunDecisions } from './population-gates.js';
import { deriveRngStreams, isNonZeroState } from './random.js';
import { encodeRunSeed } from './run-records-model.js';
import { emptyRunMetrics } from './run-metrics.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

export const NEW_RUN_FLOOR_WIDTH = 80;
export const NEW_RUN_FLOOR_HEIGHT = 25;
export const NEW_RUN_FLOOR_THEME_SETTINGS: ClassicThemeSettings = {
  ambient: { color: [19, 23, 31], strength: 7 },
};
const WIDTH = NEW_RUN_FLOOR_WIDTH;
const HEIGHT = NEW_RUN_FLOOR_HEIGHT;
const FIRST_FLOOR_ID = 'floor.depth-01';

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
};

function itemContentEntry(pack: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = pack.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item') {
    throw new Error(`createNewRun requires item content ${contentId}`);
  }
  return entry;
}

function heroItemId(contentId: OpaqueId): OpaqueId {
  return `item.hero.${contentId.slice('item.'.length)}`;
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
    fuel: overrides.fuel ?? (light ? light.fuelCapacity : null),
    enabled: overrides.enabled ?? (light ? false : null),
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

  const allocation = allocateFloorSeed(initializedRng.generation);
  const vaults = pack.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
  const generated = generateFloor({
    floorId: FIRST_FLOOR_ID,
    floorSeed: allocation.floorSeed,
    depth: 1,
    width: WIDTH,
    height: HEIGHT,
    theme: createClassicTheme(WIDTH, HEIGHT, NEW_RUN_FLOOR_THEME_SETTINGS),
    vaults,
  });
  const stairUp = generated.floor.stairUp;
  if (stairUp === null) throw new Error('internal invariant: generated first floor must have a stair-up');

  const heroActorId: OpaqueId = 'hero.guest';
  let equipment = emptyEquipment();
  const equippedItems: ItemInstance[] = [];
  for (const equippedEntry of hero.equipped) {
    const definition = itemContentEntry(pack, equippedEntry.contentId);
    if (!definition.equipment) {
      throw new Error(`createNewRun requires equippable item content ${equippedEntry.contentId}`);
    }
    const itemId = heroItemId(equippedEntry.contentId);
    equipment = { ...equipment, [equippedEntry.slot]: itemId };
    equippedItems.push(instantiateHeroItem(
      definition,
      itemId,
      { type: 'equipped', actorId: heroActorId, slot: equippedEntry.slot },
      equippedEntry.enabled === undefined ? {} : { enabled: equippedEntry.enabled },
    ));
  }

  const backpackItems: ItemInstance[] = hero.backpack.map((backpackEntry) => {
    const definition = itemContentEntry(pack, backpackEntry.contentId);
    const itemId = heroItemId(backpackEntry.contentId);
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
    floorId: FIRST_FLOOR_ID,
    x: stairUp.x,
    y: stairUp.y,
    attributes: hero.attributes,
    health: 20,
    maxHealth: 20,
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
    activeFloorId: FIRST_FLOOR_ID,
    activeFloorEnteredAt: 0,
    floors: [],
    recentCommands: [],
    encounterDecisions: gates.decisions,
    populations: [],
    fallenHeroStandings: [],
    fallenHeroDecisions: [],
    conqueredChampionRecordIds: [],
    metrics: emptyRunMetrics(),
    conclusion: null,
  };

  return addGeneratedFloor(skeleton, generated, allocation, { content: pack });
}
