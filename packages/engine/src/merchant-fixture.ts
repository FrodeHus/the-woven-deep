import type { CompiledContentPack, MerchantEncounterContentEntry } from '@woven-deep/content';
import { heroPerception, type ActorState } from './actor-model.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { createDemoRun } from './fixture.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import { createUnknownKnowledge } from './knowledge.js';
import type { MerchantPopulation } from './merchant-model.js';
import type {
  ActiveRun, CommandResult, DomainEvent, FloorSnapshot, GameCommand, PublicEvent, TileId,
} from './model.js';
import { refreshKnowledge } from './perception.js';
import { placePopulation } from './population-placement.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { rollDie } from './random.js';
import { replayCommands } from './replay.js';
import { decodeActiveRun, encodeActiveRun } from './save-codec.js';
import { validateActiveRun } from './save-schema.js';
import { compareCodeUnits, stableJson } from './stable-json.js';
import { movementBlockReason } from './terrain.js';

const WIDTH = 19;
const HEIGHT = 13;
const HOME_FLOOR_ID = 'floor.merchant-demo';
const AWAY_FLOOR_ID = 'floor.merchant-away';
const SWORD_ITEM_ID = 'item.merchant-demo.sword';
const RING_ITEM_ID = 'item.merchant-demo.ring';

export const MERCHANT_REPLAY_BOUNDARIES = [
  'before-open', 'before-buy', 'before-sell', 'before-identify', 'before-close',
  'before-warning', 'before-provoke', 'before-death', 'before-refusal',
  'before-return', 'before-departure',
] as const;

export interface MerchantDemoRecord {
  readonly boundary: typeof MERCHANT_REPLAY_BOUNDARIES[number];
  readonly command: GameCommand;
  readonly commandResult: CommandResult;
  readonly authoritativeEvents: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly projection: GameplayProjection;
}

export interface MerchantDemoResult {
  readonly initial: ActiveRun;
  readonly state: ActiveRun;
  readonly records: readonly MerchantDemoRecord[];
}

export interface MerchantDemoInput {
  readonly boundary: typeof MERCHANT_REPLAY_BOUNDARIES[number];
  readonly command: GameCommand;
}

function merchantEncounterEntry(pack: CompiledContentPack): MerchantEncounterContentEntry {
  const entry = pack.entries.find((candidate): candidate is MerchantEncounterContentEntry =>
    candidate.kind === 'encounter' && candidate.model === 'merchant');
  if (!entry) throw new Error('merchant fixture requires a merchant encounter');
  return entry;
}

function demoFloor(run: ActiveRun, floorId: string, depth: number): FloorSnapshot {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, index): TileId => {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    return x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 0 : 1;
  });
  const base: FloorSnapshot = {
    ...run.floors[0]!, floorId, width: WIDTH, height: HEIGHT, depth, tiles, entities: [],
    stairUp: null, stairDown: null, vaults: [], placementSlots: [],
    knowledge: createUnknownKnowledge(tiles.length), lights: [],
  };
  const hero = run.actors[0]!;
  const actor = { ...hero, floorId };
  return {
    ...base,
    knowledge: refreshKnowledge({
      floor: base, hero: heroPerception(run.hero, actor),
      actors: new Map([[actor.actorId, actor]]),
    }).knowledge,
  };
}

function merchantOnFloor(run: ActiveRun, floorId: string): MerchantPopulation {
  const population = run.populations.find((candidate): candidate is MerchantPopulation =>
    candidate.model === 'merchant' && candidate.floorId === floorId);
  if (!population) throw new Error(`merchant fixture requires a merchant on ${floorId}`);
  return population;
}

function adjacentFreeCell(run: ActiveRun, floorId: string, target: Readonly<{ x: number; y: number }>,
  excludedActorId: string): Readonly<{ x: number; y: number }> {
  const floor = run.floors.find((candidate) => candidate.floorId === floorId)!;
  const occupied = new Set(run.actors
    .filter((actor) => actor.actorId !== excludedActorId && actor.floorId === floorId && actor.health > 0)
    .map((actor) => `${actor.x}:${actor.y}`));
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (movementBlockReason(floor.tiles[y * floor.width + x]!) !== undefined) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`merchant fixture cannot stand adjacent to ${target.x}:${target.y}`);
}

function heroItem(itemId: string, contentId: string, identified: boolean, actorId: string): ItemInstance {
  return {
    itemId, contentId, quantity: 1, condition: 100, enchantment: null, identified,
    charges: null, fuel: null, enabled: null, location: { type: 'backpack', actorId },
  };
}

/**
 * Builds the merchant milestone exit fixture: two production Lampwright placements on separate
 * demo floors with the hero standing beside the home-floor merchant, carrying one sellable
 * weapon and one unidentified ring. Eligibility flags are explicit demo input; authored YAML
 * content is untouched and both placements run through the production placement path.
 */
export function createMerchantDemoRun(pack: CompiledContentPack): ActiveRun {
  const encounter = merchantEncounterEntry(pack);
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const home = demoFloor(base, HOME_FLOOR_ID, 2);
  const away = demoFloor(base, AWAY_FLOOR_ID, 3);
  let run: ActiveRun = {
    ...base,
    contentHash: pack.hash,
    runId: 'run.merchant-demo',
    identification: identified.identification,
    rng: identified.rng,
    activeFloorId: HOME_FLOOR_ID,
    actors: base.actors.map((actor) => ({ ...actor, floorId: HOME_FLOOR_ID, x: 9, y: 6 })),
    floors: [away, home].sort((left, right) => compareCodeUnits(left.floorId, right.floorId)),
    encounterDecisions: pack.entries.filter((entry) => entry.kind === 'encounter')
      .sort((left, right) => compareCodeUnits(left.id, right.id))
      .map((entry) => ({
        encounterId: entry.id, baseProbability: entry.runAppearanceChance, protectionBonus: 0,
        effectiveProbability: entry.runAppearanceChance, eligible: true, reachedEligibleDepth: false,
        encountered: false, instancesCreated: 0,
      })),
  };
  for (const floorId of [HOME_FLOOR_ID, AWAY_FLOOR_ID]) {
    const placement = placePopulation({
      run, floor: run.floors.find((floor) => floor.floorId === floorId)!,
      content: pack, forcedEncounterId: encounter.id,
    });
    if (placement.status !== 'placed') {
      throw new Error(`merchant fixture could not place ${encounter.id} on ${floorId}: ${placement.reason}`);
    }
    run = {
      ...run,
      actors: [...run.actors, ...placement.createdActors]
        .sort((left, right) => compareCodeUnits(left.actorId, right.actorId)),
      populations: [...run.populations, placement.population]
        .sort((left, right) => compareCodeUnits(left.populationId, right.populationId)),
      items: [...run.items, ...placement.createdItems]
        .sort((left, right) => compareCodeUnits(left.itemId, right.itemId)),
      floors: run.floors.map((floor) => floor.floorId === placement.floor.floorId ? placement.floor : floor),
      encounterDecisions: placement.encounterDecisions,
      rng: {
        ...run.rng, encounters: placement.nextEncounterState,
        ...(placement.nextMerchantStockState === null ? {} : { 'merchant-stock': placement.nextMerchantStockState }),
      },
    };
  }
  const heroId = run.hero.actorId;
  const homeMerchant = merchantOnFloor(run, HOME_FLOOR_ID);
  const merchantActor = run.actors.find((actor) => actor.actorId === homeMerchant.actorId)!;
  const heroCell = adjacentFreeCell(run, HOME_FLOOR_ID, merchantActor, heroId);
  run = {
    ...run,
    actors: run.actors.map((actor) => actor.actorId === heroId ? { ...actor, ...heroCell } : actor),
    items: [
      ...run.items,
      heroItem(SWORD_ITEM_ID, 'item.iron-sword', true, heroId),
      heroItem(RING_ITEM_ID, 'item.etched-ring', false, heroId),
    ].sort((left, right) => compareCodeUnits(left.itemId, right.itemId)),
  };
  const hero = run.actors.find((actor) => actor.actorId === heroId)!;
  const homeFloor = run.floors.find((floor) => floor.floorId === HOME_FLOOR_ID)!;
  const knowledge = refreshKnowledge({
    floor: homeFloor, hero: heroPerception(run.hero, hero),
    actors: new Map(run.actors.filter((actor) => actor.floorId === HOME_FLOOR_ID)
      .map((actor) => [actor.actorId, actor] as const)),
  }).knowledge;
  run = {
    ...run,
    floors: run.floors.map((floor) => floor.floorId === HOME_FLOOR_ID ? { ...floor, knowledge } : floor),
  };
  validateActiveRun(run);
  validateContentBoundRun(run, pack);
  validateMerchantInvariants(run, pack);
  return run;
}

/** Merchant milestone save invariants, checked after every fixture command. */
export function validateMerchantInvariants(run: ActiveRun, pack: CompiledContentPack): void {
  validateActiveRun(run);
  validateContentBoundRun(run, pack);
  if (!Number.isSafeInteger(run.hero.currency) || run.hero.currency < 0) {
    throw new Error('merchant invariant: hero currency must be a non-negative safe integer');
  }
  const factionIds = run.reputations.map((entry) => entry.factionId);
  if (new Set(factionIds).size !== factionIds.length
    || stableJson(factionIds) !== stableJson([...factionIds].sort(compareCodeUnits))) {
    throw new Error('merchant invariant: reputations must be sorted and unique by faction');
  }
  const merchants = run.populations.filter((population): population is MerchantPopulation =>
    population.model === 'merchant');
  const living = new Set(run.actors.filter((actor) => actor.health > 0).map((actor) => actor.actorId));
  const stockByPopulation = new Map<string, string[]>();
  for (const item of run.items) {
    if (item.location.type !== 'merchant-stock') continue;
    const owned = stockByPopulation.get(item.location.populationId) ?? [];
    owned.push(item.itemId);
    stockByPopulation.set(item.location.populationId, owned);
  }
  for (const merchant of merchants) {
    if (stableJson(merchant.stockItemIds)
      !== stableJson([...new Set(merchant.stockItemIds)].sort(compareCodeUnits))) {
      throw new Error(`merchant invariant: ${merchant.populationId} stock ids must be sorted and unique`);
    }
    const held = (stockByPopulation.get(merchant.populationId) ?? []).sort(compareCodeUnits);
    if (stableJson(held) !== stableJson([...merchant.stockItemIds])) {
      throw new Error(`merchant invariant: ${merchant.populationId} stock ids and item locations diverged`);
    }
    const serviceIds = merchant.services.map((service) => service.serviceId);
    if (new Set(serviceIds).size !== serviceIds.length) {
      throw new Error(`merchant invariant: ${merchant.populationId} service ids must be unique`);
    }
    for (const service of merchant.services) {
      if (service.remainingUses < 0 || !Number.isSafeInteger(service.remainingUses)) {
        throw new Error(`merchant invariant: ${merchant.populationId} service uses must stay non-negative`);
      }
      if (stableJson(service.tierIds) !== stableJson([...new Set(service.tierIds)].sort(compareCodeUnits))) {
        throw new Error(`merchant invariant: ${merchant.populationId} service tiers must be sorted and unique`);
      }
    }
    if (merchant.lifecycle === 'departed' || merchant.lifecycle === 'dead') {
      if (merchant.stockItemIds.length > 0 || merchant.livingMemberIds.length > 0
        || living.has(merchant.actorId)) {
        throw new Error(`merchant invariant: ${merchant.populationId} is gone but still owns an actor or stock`);
      }
    }
  }
  if (run.activeTrade !== null) {
    const active = merchants.filter((merchant) =>
      merchant.populationId === run.activeTrade!.merchantPopulationId);
    if (active.length !== 1) {
      throw new Error('merchant invariant: the active trade must reference exactly one merchant');
    }
  }
}

/**
 * The eleven-boundary exit sequence: open, buy, sell, identify, close, cross departure warnings,
 * provoke the home merchant with a production attack, kill it, get refused by the same-faction
 * away merchant, return home, and observe the off-floor departure. The refusal boundary is the
 * only command expected to resolve as invalid (`merchant.refuses`).
 */
export function merchantDemoCommands(initial: ActiveRun): readonly MerchantDemoInput[] {
  const home = merchantOnFloor(initial, HOME_FLOOR_ID);
  const away = merchantOnFloor(initial, AWAY_FLOOR_ID);
  const buyItemId = home.stockItemIds[0];
  if (buyItemId === undefined) throw new Error('merchant fixture requires home stock to buy');
  let expectedRevision = initial.revision;
  return MERCHANT_REPLAY_BOUNDARIES.map((boundary, index) => {
    const common = {
      commandId: `command.merchant-demo-${String(index + 1).padStart(2, '0')}`,
      expectedRevision,
    };
    const command: GameCommand = boundary === 'before-open'
      ? { ...common, type: 'trade-open', merchantActorId: home.actorId }
      : boundary === 'before-buy'
        ? { ...common, type: 'trade-buy', merchantPopulationId: home.populationId, itemId: buyItemId, quantity: 1 }
        : boundary === 'before-sell'
          ? { ...common, type: 'trade-sell', merchantPopulationId: home.populationId, itemId: SWORD_ITEM_ID, quantity: 1 }
          : boundary === 'before-identify'
            ? {
              ...common, type: 'trade-service', merchantPopulationId: home.populationId,
              serviceId: 'merchant-service.identify', targetItemId: RING_ITEM_ID,
            }
            : boundary === 'before-close'
              ? { ...common, type: 'trade-close', merchantPopulationId: home.populationId }
              : boundary === 'before-provoke' || boundary === 'before-death'
                ? { ...common, type: 'attack', targetActorId: home.actorId }
                : boundary === 'before-refusal'
                  ? { ...common, type: 'trade-open', merchantActorId: away.actorId }
                  : { ...common, type: 'wait' };
    if (boundary !== 'before-refusal') expectedRevision += 1;
    return { boundary, command };
  });
}

function prepareCommandAttack(state: ActiveRun, targetActorId: string, targetHealth: number): ActiveRun {
  const target = state.actors.find((actor) => actor.actorId === targetActorId);
  if (!target) throw new Error(`merchant fixture attack target ${targetActorId} does not exist`);
  const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
  if (target.floorId !== hero.floorId) {
    throw new Error(`merchant fixture attack target ${targetActorId} is off the hero floor`);
  }
  const destination = adjacentFreeCell(state, hero.floorId, hero, targetActorId);
  let combatState = state.rng.combat;
  for (let candidate = 1; candidate < 100_000; candidate += 1) {
    const proposed = [candidate, 2, 3, 4] as const;
    if (rollDie(proposed, 20).value === 20) {
      combatState = proposed;
      break;
    }
  }
  return {
    ...state,
    actors: state.actors.map((actor) => actor.actorId === state.hero.actorId
      ? { ...actor, energy: 100 }
      : actor.actorId === targetActorId
        ? {
          ...actor, ...destination, health: targetHealth,
          maxHealth: Math.max(actor.maxHealth, targetHealth),
        }
        : actor),
    rng: { ...state.rng, combat: combatState },
  };
}

/**
 * Fixture floor change. The hero keeps its (x, y) cell forever: the persisted command log
 * back-derives a hero position chain, so only production `hero.moved` events may relocate it.
 */
function moveHeroToFloor(state: ActiveRun, floorId: string, worldTime: number): ActiveRun {
  if (worldTime < state.worldTime) throw new Error('merchant fixture cannot reverse world time');
  return {
    ...state,
    worldTime,
    activeFloorId: floorId,
    activeFloorEnteredAt: worldTime,
    actors: state.actors.map((actor) => actor.actorId === state.hero.actorId
      ? { ...actor, floorId } : actor),
  };
}

function prepareMerchantDemoBoundary(state: ActiveRun, input: MerchantDemoInput): ActiveRun {
  const { boundary } = input;
  if (boundary === 'before-warning') {
    const departures = state.populations
      .filter((population): population is MerchantPopulation => population.model === 'merchant')
      .map((population) => population.departureAt);
    const target = Math.min(...departures) - 1001;
    if (target < state.worldTime) throw new Error('merchant fixture warning window has already passed');
    return { ...state, worldTime: target };
  }
  if (boundary === 'before-provoke') {
    return prepareCommandAttack(state, merchantOnFloor(state, HOME_FLOOR_ID).actorId, 100);
  }
  if (boundary === 'before-death') {
    return prepareCommandAttack(state, merchantOnFloor(state, HOME_FLOOR_ID).actorId, 1);
  }
  if (boundary === 'before-refusal') {
    const away = merchantOnFloor(state, AWAY_FLOOR_ID);
    const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
    const cell = adjacentFreeCell(state, AWAY_FLOOR_ID, hero, away.actorId);
    const relocated = {
      ...state,
      actors: state.actors.map((actor) => actor.actorId === away.actorId ? { ...actor, ...cell } : actor),
    };
    return moveHeroToFloor(relocated, AWAY_FLOOR_ID, state.worldTime);
  }
  if (boundary === 'before-return') {
    const away = merchantOnFloor(state, AWAY_FLOOR_ID);
    const target = away.departureAt - 101;
    if (target < state.worldTime) throw new Error('merchant fixture departure window has already passed');
    return moveHeroToFloor(state, HOME_FLOOR_ID, target);
  }
  if (boundary === 'before-departure') {
    const away = merchantOnFloor(state, AWAY_FLOOR_ID);
    const target = away.departureAt - 1;
    if (target < state.worldTime) throw new Error('merchant fixture departure deadline has already passed');
    return { ...state, worldTime: target };
  }
  return state;
}

export function resolveMerchantDemoCommand(state: ActiveRun, input: MerchantDemoInput,
  pack: CompiledContentPack): Readonly<{
    state: ActiveRun; result: CommandResult; authoritativeEvents: readonly DomainEvent[];
    publicEvents: readonly PublicEvent[]; projection: GameplayProjection;
  }> {
  const prepared = prepareMerchantDemoBoundary(state, input);
  const replay = replayCommands(prepared, [input.command], { content: pack });
  const step = replay.steps[0]!;
  const recorded = replay.state.recentCommands.find((entry) => entry.command.commandId === input.command.commandId);
  if (step.result.status === 'applied' && !recorded) {
    throw new Error(`merchant demo command ${input.command.commandId} was not persisted`);
  }
  if (replay.state.worldTime < state.worldTime) {
    throw new Error(`merchant fixture time reversed at ${input.boundary}`);
  }
  validateMerchantInvariants(replay.state, pack);
  return {
    state: replay.state, result: step.result, authoritativeEvents: recorded?.events ?? [],
    publicEvents: step.events, projection: projectGameplayState({ state: replay.state, content: pack }),
  };
}

export function runMerchantDemo(pack: CompiledContentPack,
  reloadBefore: ReadonlySet<number> = new Set()): MerchantDemoResult {
  const initial = createMerchantDemoRun(pack);
  let state = initial;
  const records: MerchantDemoRecord[] = [];
  for (const [index, input] of merchantDemoCommands(initial).entries()) {
    if (reloadBefore.has(index)) state = decodeActiveRun(encodeActiveRun(state));
    const resolved = resolveMerchantDemoCommand(state, input, pack);
    state = resolved.state;
    if (input.boundary === 'before-refusal') {
      if (resolved.result.status !== 'invalid' || resolved.result.reason !== 'merchant.refuses') {
        throw new Error(`merchant demo expected a same-faction refusal, got ${stableJson(resolved.result)}`);
      }
    } else if (resolved.result.status !== 'applied') {
      throw new Error(`merchant demo command ${input.command.commandId} was rejected: ${stableJson(resolved.result)}`);
    }
    records.push({
      boundary: input.boundary, command: input.command, commandResult: resolved.result,
      authoritativeEvents: resolved.authoritativeEvents, publicEvents: resolved.publicEvents,
      projection: resolved.projection,
    });
  }
  return { initial, state, records };
}

export function merchantDemoEquivalent(left: MerchantDemoResult, right: MerchantDemoResult): boolean {
  return encodeActiveRun(left.state) === encodeActiveRun(right.state)
    && stableJson(left.records) === stableJson(right.records);
}
