import type {
  BalanceContentEntry,
  CompiledContentPack,
  ItemContentEntry,
  MonsterContentEntry,
  TrapContentEntry,
  VaultContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, heroPerception, type ActorState } from './actor-model.js';
import { deriveActorStats } from './attributes.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { itemLightSources } from './equipment.js';
import type { DungeonFeature } from './feature-model.js';
import { createDemoRun } from './fixture.js';
import { addGeneratedFloor } from './floor-integration.js';
import { generateFloor } from './generate-floor.js';
import { createClassicTheme } from './generation-mask.js';
import { allocateFloorSeed } from './generation-random.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import {
  tileIndex,
  type ActiveRun,
  type FloorSnapshot,
  type OpaqueId,
  type Point,
  type TileId,
} from './model.js';
import { refreshKnowledge } from './perception.js';
import { createEncounterRunDecisions, recordReachedEncounterDepths } from './population-gates.js';
import { validateActiveRun } from './save-schema.js';
import { tileDefinition } from './terrain.js';
import { computeFieldOfView, isVisible } from './visibility.js';

const WIDTH = 80;
const HEIGHT = 25;
const FLOOR_ID = 'floor.gameplay-demo';

export interface GameplayDemoIds {
  readonly hero: 'hero.gameplay-demo';
  readonly rat: 'monster.cave-rat.1';
  readonly beetle: 'monster.training-beetle.1';
  readonly door: 'feature.gameplay-demo.door';
  readonly chest: 'feature.gameplay-demo.chest';
  readonly lockedDoor: 'feature.gameplay-demo.locked-door';
  readonly secret: 'feature.gameplay-demo.secret';
  readonly trap: 'feature.gameplay-demo.trap';
  readonly ashenPotion: 'item.gameplay-demo.ashen-potion';
  readonly arrows: 'item.gameplay-demo.arrows';
  readonly bow: 'item.gameplay-demo.bow';
  readonly crimsonPotion: 'item.gameplay-demo.crimson-potion';
  readonly lantern: 'item.gameplay-demo.lantern';
  readonly armor: 'item.gameplay-demo.leather-armor';
  readonly oil: 'item.gameplay-demo.oil';
  readonly ring: 'item.gameplay-demo.ring';
  readonly scroll: 'item.gameplay-demo.scroll';
  readonly shield: 'item.gameplay-demo.shield';
  readonly sword: 'item.gameplay-demo.sword';
  readonly torch: 'item.gameplay-demo.torch';
  readonly ration: 'item.gameplay-demo.travel-ration';
  readonly lockpick: 'item.gameplay-demo.lockpick';
  readonly key: 'item.gameplay-demo.iron-key';
}

export interface GameplayDemoRun {
  readonly run: ActiveRun;
  readonly ids: GameplayDemoIds;
}

const IDS: GameplayDemoIds = {
  hero: 'hero.gameplay-demo',
  rat: 'monster.cave-rat.1',
  beetle: 'monster.training-beetle.1',
  door: 'feature.gameplay-demo.door',
  chest: 'feature.gameplay-demo.chest',
  lockedDoor: 'feature.gameplay-demo.locked-door',
  secret: 'feature.gameplay-demo.secret',
  trap: 'feature.gameplay-demo.trap',
  ashenPotion: 'item.gameplay-demo.ashen-potion',
  arrows: 'item.gameplay-demo.arrows',
  bow: 'item.gameplay-demo.bow',
  crimsonPotion: 'item.gameplay-demo.crimson-potion',
  lantern: 'item.gameplay-demo.lantern',
  armor: 'item.gameplay-demo.leather-armor',
  oil: 'item.gameplay-demo.oil',
  ring: 'item.gameplay-demo.ring',
  scroll: 'item.gameplay-demo.scroll',
  shield: 'item.gameplay-demo.shield',
  sword: 'item.gameplay-demo.sword',
  torch: 'item.gameplay-demo.torch',
  ration: 'item.gameplay-demo.travel-ration',
  lockpick: 'item.gameplay-demo.lockpick',
  key: 'item.gameplay-demo.iron-key',
};

function ordered<T>(values: readonly T[], id: (value: T) => string): readonly T[] {
  return [...values].sort((left, right) =>
    id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0,
  );
}

function contentEntry<T extends CompiledContentPack['entries'][number]>(
  pack: CompiledContentPack,
  id: string,
  kind: T['kind'],
): T {
  const entry = pack.entries.find((candidate) => candidate.id === id);
  if (!entry || entry.kind !== kind)
    throw new Error(`gameplay fixture requires ${kind} content ${id}`);
  return entry as T;
}

function distance(left: Point, right: Point): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function cellKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

function rowMajorCells(
  floor: FloorSnapshot,
  predicate: (point: Point, tile: TileId) => boolean,
): readonly Point[] {
  const cells: Point[] = [];
  for (let index = 0; index < floor.tiles.length; index += 1) {
    const point = { x: index % floor.width, y: Math.floor(index / floor.width) };
    if (predicate(point, floor.tiles[index]!)) cells.push(point);
  }
  return cells;
}

function selectActorCells(
  floor: FloorSnapshot,
  blocked: ReadonlySet<string>,
  preferredHero: Point,
  beetleCells: ReadonlySet<string>,
): Readonly<{
  hero: Point;
  rat: Point;
  beetle: Point;
}> {
  const candidates = rowMajorCells(
    floor,
    (point, tile) =>
      tileDefinition(tile).walkable && tile !== 4 && tile !== 5 && !blocked.has(cellKey(point)),
  );
  for (const hero of candidates.filter(
    (candidate) => cellKey(candidate) === cellKey(preferredHero),
  )) {
    const visible = computeFieldOfView({
      width: floor.width,
      height: floor.height,
      tiles: floor.tiles,
      origin: hero,
      radius: 7,
    });
    const rat = candidates.find(
      (candidate) =>
        candidate !== hero &&
        distance(hero, candidate) >= 3 &&
        distance(hero, candidate) <= 6 &&
        isVisible(visible, tileIndex(floor, candidate.x, candidate.y)!),
    );
    if (!rat) continue;
    const beetle = candidates.find(
      (candidate) =>
        candidate !== hero &&
        candidate !== rat &&
        beetleCells.has(cellKey(candidate)) &&
        distance(hero, candidate) >= 6 &&
        distance(hero, candidate) <= 7,
    );
    if (beetle) return { hero, rat, beetle };
  }
  throw new Error(
    'generated gameplay floor cannot satisfy actor distance and line-of-sight constraints',
  );
}

function selectSecretCell(floor: FloorSnapshot, near: Point): Point {
  const wallCells = rowMajorCells(floor, (_point, tile) => tile === 0);
  const walkable = (x: number, y: number): boolean => {
    const index = tileIndex(floor, x, y);
    return index !== undefined && tileDefinition(floor.tiles[index]!).walkable;
  };
  const secret = wallCells.find(
    ({ x, y }) =>
      distance({ x, y }, near) <= 2 &&
      ((walkable(x - 1, y) && walkable(x + 1, y)) || (walkable(x, y - 1) && walkable(x, y + 1))),
  );
  if (!secret)
    throw new Error('generated gameplay floor requires a wall suitable for a secret passage');
  return secret;
}

function monsterActor(
  definition: MonsterContentEntry,
  actorId: OpaqueId,
  point: Point,
  lastKnownHero: Point,
  balance: BalanceContentEntry,
): ActorState {
  return {
    actorId,
    contentId: definition.id,
    playerControlled: false,
    floorId: FLOOR_ID,
    ...point,
    attributes: definition.attributes,
    health: definition.health,
    maxHealth: definition.health,
    weave: 0,
    maxWeave: 0,
    energy: balance.readinessThreshold,
    speed: definition.speed,
    reactionReady: true,
    disposition: definition.disposition,
    awareActorIds: [IDS.hero],
    conditions: [],
    equipment: emptyEquipment(),
    behaviorId: definition.behaviorId,
    behaviorState: {
      intent: 'approach',
      goal: { type: 'cell', floorId: FLOOR_ID, ...lastKnownHero },
      lastKnownTargets: [
        {
          targetActorId: IDS.hero,
          floorId: FLOOR_ID,
          ...lastKnownHero,
          observedAt: 0,
          source: 'sound',
          observerActorId: actorId,
        },
      ],
      investigation: { floorId: FLOOR_ID, ...lastKnownHero, startedAt: 0, expiresAt: null },
    },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
  };
}

function item(
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
    // `fuel`/`enabled` overrides only apply to light items -- content-bound validation rejects a
    // non-light item carrying either. Gate the override on `light` itself (mirrors
    // `instantiateHeroItem` in new-run.ts), not just its absence, so a caller that mistakenly
    // passes an override for a non-light item still gets ignored rather than propagated.
    fuel: light ? (overrides.fuel ?? light.fuelCapacity) : null,
    enabled: light ? (overrides.enabled ?? false) : null,
    location,
  };
}

function initialDiscovery(): Readonly<{
  discoveredByActorIds: readonly OpaqueId[];
  progressByActorId: Readonly<Record<OpaqueId, number>>;
  attemptedContextKeys: readonly string[];
}> {
  return { discoveredByActorIds: [], progressByActorId: {}, attemptedContextKeys: [] };
}

export function createGameplayDemoRun(pack: CompiledContentPack): GameplayDemoRun {
  const balance = contentEntry<BalanceContentEntry>(pack, 'balance.core-gameplay', 'balance');
  const ratDefinition = contentEntry<MonsterContentEntry>(pack, 'monster.cave-rat', 'monster');
  const beetleDefinition = contentEntry<MonsterContentEntry>(
    pack,
    'monster.training-beetle',
    'monster',
  );
  const trapDefinition = contentEntry<TrapContentEntry>(pack, 'trap.rusty-dart', 'trap');
  const vaults = pack.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');

  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const encounters = pack.entries.filter((entry) => entry.kind === 'encounter');
  const gates = createEncounterRunDecisions({
    encounters,
    protectionBonuses: [],
    state: identified.rng['population-gates'],
  });
  const initialized = {
    ...base,
    identification: identified.identification,
    rng: { ...identified.rng, 'population-gates': gates.state },
    encounterDecisions: gates.decisions,
  };
  const allocation = allocateFloorSeed(initialized.rng.generation);
  const generated = generateFloor({
    floorId: FLOOR_ID,
    floorSeed: allocation.floorSeed,
    depth: 2,
    width: WIDTH,
    height: HEIGHT,
    theme: createClassicTheme(WIDTH, HEIGHT, { ambient: { color: [0, 0, 0], strength: 0 } }),
    vaults,
    requiredVaultId: 'vault.lampwright-cache',
  });

  const door = rowMajorCells(generated.floor, (_point, tile) => tile === 2)[0];
  if (!door) throw new Error('generated gameplay floor requires a closed door');
  const trapSlot = generated.floor.placementSlots.find((slot) => slot.kind === 'trap');
  const trap = trapSlot
    ? { x: trapSlot.x, y: trapSlot.y }
    : rowMajorCells(generated.floor, (_point, tile) => tileDefinition(tile).walkable)[0];
  if (!trap) throw new Error('generated gameplay floor requires a trap cell');

  const occupiedFeatureCells = new Set([door, trap].map(cellKey));
  const doorApproach = rowMajorCells(
    generated.floor,
    (point, tile) =>
      tileDefinition(tile).walkable &&
      !occupiedFeatureCells.has(cellKey(point)) &&
      distance(point, door) === 1,
  )[0];
  if (!doorApproach)
    throw new Error('generated gameplay floor requires a walkable approach to its door');
  const secret = selectSecretCell(generated.floor, doorApproach);
  const featureCells = new Set([door, secret, trap].map(cellKey));
  // The hero opens and steps onto the terrain `door` cell, then fights from there for the rest
  // of the scripted run, so the locked chest and door sit on that cell's far (east) side. Keeping
  // them east of the door leaves the rat's north-west approach corridor clear, so the melee
  // scripting is undisturbed, and the hero ends adjacent to both to pick them after combat.
  const lockCells = rowMajorCells(
    generated.floor,
    (point, tile) =>
      tileDefinition(tile).walkable &&
      distance(point, door) === 1 &&
      point.x > door.x &&
      !featureCells.has(cellKey(point)),
  ).slice(0, 2);
  if (lockCells.length !== 2)
    throw new Error('generated gameplay floor requires two lock feature cells beside its door');
  const [chestCell, lockedDoorCell] = lockCells as [Point, Point];
  const reservedCells = new Set([...featureCells, cellKey(chestCell), cellKey(lockedDoorCell)]);
  const demonstrationVault = generated.floor.vaults.find(
    (placement) => placement.vaultId === 'vault.lampwright-cache',
  );
  if (!demonstrationVault)
    throw new Error('generated gameplay floor requires the lampwright cache');
  const beetleCells = new Set(
    rowMajorCells(
      generated.floor,
      (point, tile) =>
        tileDefinition(tile).walkable &&
        point.x >= demonstrationVault.x &&
        point.x < demonstrationVault.x + demonstrationVault.width &&
        point.y >= demonstrationVault.y &&
        point.y < demonstrationVault.y + demonstrationVault.height,
    ).map(cellKey),
  );
  const positions = selectActorCells(generated.floor, reservedCells, doorApproach, beetleCells);
  const occupied = new Set([
    ...reservedCells,
    cellKey(positions.hero),
    cellKey(positions.rat),
    cellKey(positions.beetle),
  ]);
  const floorItemCells = rowMajorCells(
    generated.floor,
    (point, tile) => tileDefinition(tile).walkable && !occupied.has(cellKey(point)),
  ).slice(0, 4);
  if (floorItemCells.length !== 4)
    throw new Error('generated gameplay floor requires four item cells');

  const heroAttributes = { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 } as const;
  const heroStats = deriveActorStats({
    attributes: heroAttributes,
    formulas: balance.formulas,
    equipmentModifiers: [],
    conditionModifiers: [],
  });
  const hero: ActorState = {
    actorId: IDS.hero,
    contentId: 'hero.adventurer',
    playerControlled: true,
    floorId: FLOOR_ID,
    ...positions.hero,
    attributes: heroAttributes,
    health: Math.max(1, heroStats.maxHealth - 8),
    maxHealth: heroStats.maxHealth,
    weave: heroStats.maxWeave,
    maxWeave: heroStats.maxWeave,
    energy: balance.readinessThreshold,
    speed: 100,
    reactionReady: true,
    disposition: 'friendly',
    awareActorIds: [IDS.rat],
    conditions: [],
    equipment: { ...emptyEquipment(), 'main-hand': IDS.sword, 'off-hand': IDS.lantern },
    behaviorId: null,
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
  };
  const actors = ordered(
    [
      hero,
      monsterActor(ratDefinition, IDS.rat, positions.rat, positions.hero, balance),
      monsterActor(beetleDefinition, IDS.beetle, positions.beetle, positions.hero, balance),
    ],
    (actor) => actor.actorId,
  );

  const backpack = (actorId: OpaqueId = IDS.hero) => ({ type: 'backpack' as const, actorId });
  const equipped = (slot: 'main-hand' | 'off-hand') => ({
    type: 'equipped' as const,
    actorId: IDS.hero,
    slot,
  });
  const onFloor = (point: Point) => ({ type: 'floor' as const, floorId: FLOOR_ID, ...point });
  const items = ordered(
    [
      item(
        contentEntry(pack, 'item.ashen-potion', 'item'),
        IDS.ashenPotion,
        onFloor(floorItemCells[0]!),
      ),
      item(contentEntry(pack, 'item.wooden-arrows', 'item'), IDS.arrows, backpack(), {
        quantity: 12,
      }),
      item(contentEntry(pack, 'item.hunting-bow', 'item'), IDS.bow, backpack()),
      item(contentEntry(pack, 'item.crimson-potion', 'item'), IDS.crimsonPotion, backpack(), {
        quantity: 2,
      }),
      item(contentEntry(pack, 'item.brass-lantern', 'item'), IDS.lantern, equipped('off-hand'), {
        fuel: 1800,
        enabled: true,
      }),
      item(contentEntry(pack, 'item.leather-armor', 'item'), IDS.armor, backpack()),
      item(contentEntry(pack, 'item.lamp-oil', 'item'), IDS.oil, backpack(), { quantity: 4 }),
      item(contentEntry(pack, 'item.etched-ring', 'item'), IDS.ring, onFloor(floorItemCells[1]!), {
        enchantment: { enchantmentId: 'enchantment.guard', modifiers: { defense: 1 } },
      }),
      item(
        contentEntry(pack, 'item.ember-scroll', 'item'),
        IDS.scroll,
        onFloor(floorItemCells[2]!),
      ),
      item(contentEntry(pack, 'item.wooden-shield', 'item'), IDS.shield, backpack()),
      item(contentEntry(pack, 'item.iron-sword', 'item'), IDS.sword, equipped('main-hand')),
      item(contentEntry(pack, 'item.pitch-torch', 'item'), IDS.torch, onFloor(floorItemCells[3]!)),
      item(contentEntry(pack, 'item.travel-ration', 'item'), IDS.ration, backpack(), {
        quantity: 2,
      }),
      item(contentEntry(pack, 'item.lockpick', 'item'), IDS.lockpick, backpack(), { quantity: 3 }),
      item(contentEntry(pack, 'item.iron-key', 'item'), IDS.key, backpack()),
    ],
    (candidate) => candidate.itemId,
  );

  const features = ordered<DungeonFeature>(
    [
      {
        featureId: IDS.door,
        type: 'door',
        floorId: FLOOR_ID,
        ...door,
        contentId: null,
        coverTileId: 2,
        state: 'closed',
      },
      {
        featureId: IDS.chest,
        type: 'chest',
        floorId: FLOOR_ID,
        ...chestCell,
        contentId: null,
        coverTileId: generated.floor.tiles[tileIndex(generated.floor, chestCell.x, chestCell.y)!]!,
        state: 'locked',
        lock: { difficulty: 12, keyContentId: null },
        lootTableId: 'loot-table.early-provisions',
        lootContentId: null,
      },
      {
        featureId: IDS.lockedDoor,
        type: 'door',
        floorId: FLOOR_ID,
        ...lockedDoorCell,
        contentId: null,
        coverTileId:
          generated.floor.tiles[tileIndex(generated.floor, lockedDoorCell.x, lockedDoorCell.y)!]!,
        state: 'locked',
        lock: { difficulty: 15, keyContentId: 'item.iron-key' },
      },
      {
        featureId: IDS.secret,
        type: 'secret',
        floorId: FLOOR_ID,
        ...secret,
        contentId: null,
        coverTileId: 0,
        state: 'hidden',
        discoveryDifficulty: 18,
        discovery: initialDiscovery(),
      },
      {
        featureId: IDS.trap,
        type: 'trap',
        floorId: FLOOR_ID,
        ...trap,
        contentId: trapDefinition.id,
        coverTileId: generated.floor.tiles[tileIndex(generated.floor, trap.x, trap.y)!]!,
        state: 'armed',
        discoveryDifficulty: trapDefinition.discoveryDifficulty,
        discovery: initialDiscovery(),
      },
    ],
    (feature) => feature.featureId,
  );

  const transitional: ActiveRun = {
    ...initialized,
    contentHash: pack.hash,
    runId: 'run.gameplay-demo',
    hero: {
      actorId: IDS.hero,
      name: 'Ada',
      sightRadius: 12,
      backpackCapacity: 12,
      currency: balance.startingCurrency,
      classTags: [],
      statModifiers: {},
    },
    actors,
    items,
    features,
    survival: { ...initialized.survival, hungerReserve: balance.hungerMaximum },
    activeFloorId: FLOOR_ID,
    activeFloorEnteredAt: 0,
  };
  const inserted = addGeneratedFloor(transitional, generated, allocation, { content: pack });
  const activeFloor = inserted.floors.find((floor) => floor.floorId === FLOOR_ID)!;
  const actorPositions = new Map(
    inserted.actors
      .filter((actor) => actor.floorId === FLOOR_ID)
      .map((actor) => [actor.actorId, actor] as const),
  );
  const knowledge = refreshKnowledge({
    floor: activeFloor,
    hero: heroPerception(inserted.hero, hero),
    actors: actorPositions,
    additionalLights: itemLightSources({ run: inserted, content: pack, floorId: FLOOR_ID }),
  }).knowledge;
  const run = validateActiveRun({
    ...inserted,
    encounterDecisions: recordReachedEncounterDepths({
      decisions: inserted.encounterDecisions,
      encounters,
      reachedDepths: inserted.floors.map((floor) => floor.depth),
    }),
    floors: inserted.floors.map((floor) =>
      floor.floorId === FLOOR_ID ? { ...floor, knowledge } : floor,
    ),
  });
  validateContentBoundRun(run, pack);
  return { run, ids: IDS };
}
