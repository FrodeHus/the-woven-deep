import type { CompiledContentPack, EncounterContentEntry } from '@woven-deep/content';
import { heroPerception } from './actor-model.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { createDemoRun } from './fixture.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import { createUnknownKnowledge } from './knowledge.js';
import type { MerchantPopulation } from './merchant-model.js';
import type {
  ActiveRun,
  CommandResult,
  DomainEvent,
  FloorSnapshot,
  GameCommand,
  PublicEvent,
  TileId,
} from './model.js';
import { refreshKnowledge } from './perception.js';
import { placePopulation } from './population-placement.js';
import type { BossPopulation, GroupPopulation, SwarmPopulation } from './population-model.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { expandLegacySeed, nextUint32 } from './random.js';
import { replayCommands } from './replay.js';
import { finalizeRun } from './run-finalize.js';
import { createInMemoryRunRecordRepository } from './run-record-repository.js';
import { recordFloorEntered } from './run-metrics.js';
import type { HallRecord, LifetimeDeltas } from './run-records-model.js';
import { decodeActiveRun, encodeActiveRun } from './save-codec.js';
import { validateActiveRun } from './save-schema.js';
import { compareCodeUnits, stableJson } from './stable-json.js';
import { movementBlockReason } from './terrain.js';

const WIDTH = 19;
const HEIGHT = 13;
const HOME_FLOOR_ID = 'floor.run-records-demo';
const BOSS_FLOOR_ID = 'floor.run-records-boss-demo';
const HOME_DEPTH = 4;
const BOSS_DEPTH = 5;
const HERO_WEAPON_ID = 'item.run-records-demo.sword';

export const RUN_RECORDS_REPLAY_BOUNDARIES = [
  'before-group-fight',
  'before-swarm',
  'before-boss',
  'before-trade',
  'before-merchant-attack',
  'before-death',
  'before-finalize',
] as const;

export type RunRecordsBoundary = (typeof RUN_RECORDS_REPLAY_BOUNDARIES)[number];

/** Boundaries whose transition is a persisted player command; `before-finalize` is finalization. */
const COMMAND_BOUNDARIES = RUN_RECORDS_REPLAY_BOUNDARIES.filter(
  (boundary) => boundary !== 'before-finalize',
);

export interface RunRecordsDemoRecord {
  readonly boundary: RunRecordsBoundary;
  readonly command: GameCommand;
  readonly commandResult: CommandResult;
  readonly authoritativeEvents: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly projection: GameplayProjection;
}

export interface RunRecordsDemoResult {
  readonly initial: ActiveRun;
  readonly state: ActiveRun;
  readonly records: readonly RunRecordsDemoRecord[];
  readonly finalization: Readonly<{
    record: HallRecord;
    deltas: LifetimeDeltas;
    events: readonly DomainEvent[];
  }> | null;
}

export interface RunRecordsDemoInput {
  readonly boundary: RunRecordsBoundary;
  readonly command: GameCommand;
}

/**
 * Resolves a demo fixture's encounter by explicit content id (not "first of model"), so added
 * content packs can never perturb which encounter the fixed-depth demo selects.
 */
function encounter(pack: CompiledContentPack, id: string): EncounterContentEntry {
  const result = pack.entries.find(
    (entry): entry is EncounterContentEntry => entry.kind === 'encounter' && entry.id === id,
  );
  if (!result) throw new Error(`run-records fixture requires the ${id} encounter`);
  return result;
}

function demoFloor(run: ActiveRun, floorId: string, depth: number): FloorSnapshot {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, index): TileId => {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    return x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 0 : 1;
  });
  const base: FloorSnapshot = {
    ...run.floors[0]!,
    floorId,
    width: WIDTH,
    height: HEIGHT,
    depth,
    tiles,
    entities: [],
    stairUp: null,
    stairDown: null,
    vaults: [],
    placementSlots: [],
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
  };
  const hero = run.actors[0]!;
  const actor = { ...hero, floorId };
  return {
    ...base,
    knowledge: refreshKnowledge({
      floor: base,
      hero: heroPerception(run.hero, actor),
      actors: new Map([[actor.actorId, actor]]),
    }).knowledge,
  };
}

function publishPlacement(
  run: ActiveRun,
  placement: Extract<ReturnType<typeof placePopulation>, { status: 'placed' }>,
): ActiveRun {
  return {
    ...run,
    actors: [...run.actors, ...placement.createdActors].sort((a, b) =>
      compareCodeUnits(a.actorId, b.actorId),
    ),
    populations: [...run.populations, placement.population].sort((a, b) =>
      compareCodeUnits(a.populationId, b.populationId),
    ),
    items: [...run.items, ...placement.createdItems].sort((a, b) =>
      compareCodeUnits(a.itemId, b.itemId),
    ),
    features: [...run.features, ...placement.createdFeatures].sort((a, b) =>
      compareCodeUnits(a.featureId, b.featureId),
    ),
    floors: run.floors.map((floor) =>
      floor.floorId === placement.floor.floorId ? placement.floor : floor,
    ),
    encounterDecisions: placement.encounterDecisions,
    rng: {
      ...run.rng,
      encounters: placement.nextEncounterState,
      ...(placement.nextMerchantStockState === null
        ? {}
        : { 'merchant-stock': placement.nextMerchantStockState }),
    },
  };
}

function heroWeapon(actorId: string): ItemInstance {
  return {
    itemId: HERO_WEAPON_ID,
    contentId: 'item.iron-sword',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'equipped', actorId, slot: 'main-hand' },
  };
}

function place(
  run: ActiveRun,
  floorId: string,
  encounterId: string,
  pack: CompiledContentPack,
): ActiveRun {
  const placement = placePopulation({
    run,
    floor: run.floors.find((floor) => floor.floorId === floorId)!,
    content: pack,
    forcedEncounterId: encounterId,
  });
  if (placement.status !== 'placed') {
    throw new Error(
      `run-records fixture could not place ${encounterId} on ${floorId}: ${placement.reason}`,
    );
  }
  return publishPlacement(run, placement);
}

/**
 * Builds the run-records milestone exit fixture: a home floor (depth 4) carrying a forced leader
 * group, a swarm, and a travelling merchant, plus a boss floor (depth 5) carrying a rare boss. The
 * hero wields an equipped iron sword so the fallen-hero heirloom roll has an eligible instance.
 * Eligibility overrides are explicit demo input; authored YAML content is untouched and every
 * placement runs through the production placement path.
 */
export function createRunRecordsDemoRun(pack: CompiledContentPack): ActiveRun {
  const group = encounter(pack, 'encounter.beetle-patrol');
  const swarm = encounter(pack, 'encounter.rat-brood');
  const boss = encounter(pack, 'encounter.ashen-warden');
  const merchant = encounter(pack, 'encounter.travelling-lampwright');
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const home = demoFloor(base, HOME_FLOOR_ID, HOME_DEPTH);
  const bossFloor = demoFloor(base, BOSS_FLOOR_ID, BOSS_DEPTH);
  let run: ActiveRun = {
    ...base,
    contentHash: pack.hash,
    runId: 'run.run-records-demo',
    identification: identified.identification,
    rng: identified.rng,
    activeFloorId: HOME_FLOOR_ID,
    actors: base.actors.map((actor) => ({
      ...actor,
      floorId: HOME_FLOOR_ID,
      x: 9,
      y: 6,
      health: 100_000,
      maxHealth: 100_000,
    })),
    floors: [home, bossFloor].sort((left, right) => compareCodeUnits(left.floorId, right.floorId)),
    encounterDecisions: pack.entries
      .filter((entry): entry is EncounterContentEntry => entry.kind === 'encounter')
      .sort((left, right) => compareCodeUnits(left.id, right.id))
      .map((entry) => ({
        encounterId: entry.id,
        baseProbability: entry.runAppearanceChance,
        protectionBonus: 0,
        effectiveProbability: entry.runAppearanceChance,
        eligible: true,
        reachedEligibleDepth: false,
        encountered: false,
        instancesCreated: 0,
      })),
  };
  run = place(run, HOME_FLOOR_ID, group.id, pack);
  run = place(run, HOME_FLOOR_ID, swarm.id, pack);
  run = place(run, HOME_FLOOR_ID, merchant.id, pack);
  run = place(run, BOSS_FLOOR_ID, boss.id, pack);

  // Force a leader onto the group even when the authored leaderChance did not roll one.
  const groupPopulation = run.populations.find(
    (population): population is GroupPopulation => population.model === 'group',
  )!;
  if (groupPopulation.leaderActorId === null) {
    const leaderId = groupPopulation.livingMemberIds[0]!;
    run = {
      ...run,
      populations: run.populations.map((population) =>
        population.populationId === groupPopulation.populationId
          ? { ...groupPopulation, leaderActorId: leaderId, bonusActive: true }
          : population,
      ),
      actors: run.actors.map((actor) =>
        actor.actorId === leaderId
          ? { ...actor, populationPresentation: { ...actor.populationPresentation!, leader: true } }
          : actor,
      ),
    };
  }

  const heroId = run.hero.actorId;
  run = {
    ...run,
    items: [...run.items, heroWeapon(heroId)].sort((a, b) => compareCodeUnits(a.itemId, b.itemId)),
    actors: run.actors.map((actor) =>
      actor.actorId === heroId
        ? { ...actor, equipment: { ...actor.equipment, 'main-hand': HERO_WEAPON_ID } }
        : actor,
    ),
  };
  run = recordFloorEntered(run, HOME_DEPTH);
  validateRunRecordsInvariants(run, pack);
  return run;
}

/** Run-records milestone save invariants, checked after every fixture transition. */
export function validateRunRecordsInvariants(run: ActiveRun, pack: CompiledContentPack): void {
  validateActiveRun(run);
  validateContentBoundRun(run, pack);
  const metrics = run.metrics;
  for (const [name, value] of Object.entries(metrics)) {
    if (name === 'killsByModel') continue;
    if (!Number.isSafeInteger(value as number) || (value as number) < 0) {
      throw new Error(`run-records invariant: metric ${name} must be a non-negative safe integer`);
    }
  }
  const modelSum =
    metrics.killsByModel.individual +
    metrics.killsByModel.group +
    metrics.killsByModel.swarm +
    metrics.killsByModel.boss;
  if (metrics.kills < modelSum) {
    throw new Error('run-records invariant: kills must be at least the killsByModel sum');
  }
  const heroDead = run.actors.find((actor) => actor.actorId === run.hero.actorId)!.health <= 0;
  if (heroDead !== (run.conclusion !== null)) {
    throw new Error('run-records invariant: dead hero must have exactly a non-null conclusion');
  }
}

function merchantOnFloor(run: ActiveRun): MerchantPopulation {
  const population = run.populations.find(
    (candidate): candidate is MerchantPopulation => candidate.model === 'merchant',
  );
  if (!population) throw new Error('run-records fixture requires a merchant');
  return population;
}

function freeCellAround(
  run: ActiveRun,
  floorId: string,
  target: Readonly<{ x: number; y: number }>,
  excludedActorId: string,
): Readonly<{ x: number; y: number }> {
  const floor = run.floors.find((candidate) => candidate.floorId === floorId)!;
  const occupied = new Set(
    run.actors
      .filter(
        (actor) =>
          actor.actorId !== excludedActorId && actor.floorId === floorId && actor.health > 0,
      )
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (movementBlockReason(floor.tiles[y * floor.width + x]!) !== undefined) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`run-records fixture cannot find a free cell around ${target.x}:${target.y}`);
}

/** A combat stream whose next d20 roll is a natural 20, guaranteeing the following attack hits. */
function combatCritState(state: ActiveRun): ActiveRun {
  const sides = 20;
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  for (let seed = 1; seed < 100_000; seed += 1) {
    const rigged = expandLegacySeed(seed);
    const step = nextUint32(rigged);
    if (step.value < limit && (step.value % sides) + 1 === sides) {
      return { ...state, rng: { ...state.rng, combat: rigged } };
    }
  }
  throw new Error('run-records fixture could not rig a combat critical hit');
}

/** Positions the hero adjacent to the target and rigs a guaranteed critical hit for an attack. */
function prepareHeroAttack(
  state: ActiveRun,
  targetActorId: string,
  targetHealth: number | null,
): ActiveRun {
  const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
  const target = state.actors.find((actor) => actor.actorId === targetActorId);
  if (!target) throw new Error(`run-records fixture attack target ${targetActorId} is missing`);
  if (target.floorId !== hero.floorId) {
    throw new Error(`run-records fixture attack target ${targetActorId} is off the hero floor`);
  }
  const destination = freeCellAround(state, hero.floorId, hero, targetActorId);
  const positioned: ActiveRun = {
    ...state,
    actors: state.actors.map((actor) =>
      actor.actorId === state.hero.actorId
        ? { ...actor, energy: 100 }
        : actor.actorId === targetActorId
          ? {
              ...actor,
              ...destination,
              ...(targetHealth === null
                ? {}
                : { health: targetHealth, maxHealth: Math.max(actor.maxHealth, targetHealth) }),
            }
          : actor,
    ),
  };
  return combatCritState(positioned);
}

/** Fixture floor change: only production `hero.moved` events relocate the hero cell itself. */
function moveHeroToFloor(state: ActiveRun, floorId: string): ActiveRun {
  const depth = state.floors.find((floor) => floor.floorId === floorId)?.depth;
  if (depth === undefined)
    throw new Error(`run-records fixture cannot enter unknown floor ${floorId}`);
  return recordFloorEntered(
    {
      ...state,
      activeFloorId: floorId,
      activeFloorEnteredAt: state.worldTime,
      actors: state.actors.map((actor) =>
        actor.actorId === state.hero.actorId ? { ...actor, floorId } : actor,
      ),
    },
    depth,
  );
}

function prepareBoundary(
  state: ActiveRun,
  boundary: RunRecordsBoundary,
  _pack: CompiledContentPack,
): ActiveRun {
  if (boundary === 'before-group-fight') {
    const group = state.populations.find(
      (population): population is GroupPopulation => population.model === 'group',
    )!;
    return prepareHeroAttack(state, group.leaderActorId!, 1);
  }
  if (boundary === 'before-swarm') {
    const swarm = state.populations.find(
      (population): population is SwarmPopulation => population.model === 'swarm',
    )!;
    return prepareHeroAttack(state, swarm.sourceActorId, 1);
  }
  if (boundary === 'before-boss') {
    const boss = state.populations.find(
      (population): population is BossPopulation => population.model === 'boss',
    )!;
    const bossActor = state.actors.find((actor) => actor.actorId === boss.actorId)!;
    // Bring the boss just above its first phase threshold so one non-lethal hit crosses it.
    const threshold = Math.floor(bossActor.maxHealth * 0.65) + 5;
    const relocated = moveHeroToFloor(state, boss.floorId);
    return prepareHeroAttack(relocated, boss.actorId, threshold);
  }
  if (boundary === 'before-trade') {
    const home = moveHeroToFloor(state, HOME_FLOOR_ID);
    const merchant = merchantOnFloor(home);
    const merchantActor = home.actors.find((actor) => actor.actorId === merchant.actorId)!;
    const cell = freeCellAround(home, HOME_FLOOR_ID, merchantActor, home.hero.actorId);
    return {
      ...home,
      actors: home.actors.map((actor) =>
        actor.actorId === home.hero.actorId ? { ...actor, ...cell } : actor,
      ),
    };
  }
  if (boundary === 'before-merchant-attack') {
    // Dismiss the modal trade session (client-transient) before the production attack, then
    // provoke the merchant with a non-lethal critical hit so it flees rather than dies.
    const merchant = merchantOnFloor(state);
    const dismissed = { ...state, activeTrade: null };
    return prepareHeroAttack(dismissed, merchant.actorId, null);
  }
  if (boundary === 'before-death') {
    // A surviving hostile group member lands a fatal opportunity attack as the 1-HP hero steps
    // away, crediting the killer inside the same transition.
    const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
    const killer = state.actors.find(
      (actor) =>
        actor.actorId !== hero.actorId &&
        actor.floorId === hero.floorId &&
        actor.health > 0 &&
        actor.populationId !== null &&
        state.populations.find((population) => population.populationId === actor.populationId)
          ?.model === 'group',
    );
    if (!killer)
      throw new Error('run-records fixture requires a surviving group member to fell the hero');
    const east = { x: hero.x + 1, y: hero.y };
    const withKiller = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, health: 1 }
          : actor.actorId === killer.actorId
            ? {
                ...actor,
                ...east,
                reactionReady: true,
                awareActorIds: [hero.actorId],
                disposition: 'hostile' as const,
              }
            : { ...actor, reactionReady: false },
      ),
    };
    return combatCritState(withKiller);
  }
  return state;
}

function boundaryCommand(
  state: ActiveRun,
  boundary: RunRecordsBoundary,
  index: number,
): GameCommand {
  const common = {
    commandId: `command.run-records-demo-${String(index + 1).padStart(2, '0')}`,
    expectedRevision: state.revision,
  };
  if (boundary === 'before-group-fight') {
    const group = state.populations.find(
      (population): population is GroupPopulation => population.model === 'group',
    )!;
    return { ...common, type: 'attack', targetActorId: group.leaderActorId! };
  }
  if (boundary === 'before-swarm') {
    const swarm = state.populations.find(
      (population): population is SwarmPopulation => population.model === 'swarm',
    )!;
    return { ...common, type: 'attack', targetActorId: swarm.sourceActorId };
  }
  if (boundary === 'before-boss') {
    const boss = state.populations.find(
      (population): population is BossPopulation => population.model === 'boss',
    )!;
    return { ...common, type: 'attack', targetActorId: boss.actorId };
  }
  if (boundary === 'before-trade') {
    const merchant = merchantOnFloor(state);
    return { ...common, type: 'trade-open', merchantActorId: merchant.actorId };
  }
  if (boundary === 'before-merchant-attack') {
    const merchant = merchantOnFloor(state);
    return { ...common, type: 'attack', targetActorId: merchant.actorId };
  }
  // before-death: the hero steps west, provoking a fatal opportunity attack.
  return { ...common, type: 'move', direction: 'west' };
}

export function resolveRunRecordsDemoCommand(
  state: ActiveRun,
  boundary: RunRecordsBoundary,
  index: number,
  pack: CompiledContentPack,
): Readonly<{
  state: ActiveRun;
  command: GameCommand;
  result: CommandResult;
  authoritativeEvents: readonly DomainEvent[];
  publicEvents: readonly PublicEvent[];
  projection: GameplayProjection;
}> {
  const prepared = prepareBoundary(state, boundary, pack);
  const command = boundaryCommand(prepared, boundary, index);
  const replay = replayCommands(prepared, [command], { content: pack });
  const step = replay.steps[0]!;
  const recorded = replay.state.recentCommands.find(
    (entry) => entry.command.commandId === command.commandId,
  );
  if (step.result.status === 'applied' && !recorded) {
    throw new Error(`run-records demo command ${command.commandId} was not persisted`);
  }
  validateRunRecordsInvariants(replay.state, pack);
  return {
    state: replay.state,
    command,
    result: step.result,
    authoritativeEvents: recorded?.events ?? [],
    publicEvents: step.events,
    projection: projectGameplayState({ state: replay.state, content: pack }),
  };
}

/** Finalizes the concluded run through `finalizeRun` with a fresh in-memory repository lifetime. */
export function finalizeRunRecordsDemo(
  state: ActiveRun,
  pack: CompiledContentPack,
): Readonly<{
  state: ActiveRun;
  record: HallRecord;
  deltas: LifetimeDeltas;
  events: readonly DomainEvent[];
}> {
  const repository = createInMemoryRunRecordRepository();
  const finalized = finalizeRun({ run: state, content: pack, lifetime: repository.lifetime() });
  validateRunRecordsInvariants(finalized.run, pack);
  return {
    state: finalized.run,
    record: finalized.record,
    deltas: finalized.deltas,
    events: finalized.events,
  };
}

/**
 * Runs the automated run-records exit demonstration. Optionally reloads the encoded save before the
 * named boundaries (including `before-finalize`), so continuous and fully split execution can be
 * proven byte-identical.
 */
export function runRunRecordsDemo(
  pack: CompiledContentPack,
  reloadBefore: ReadonlySet<number> = new Set(),
): RunRecordsDemoResult {
  const initial = createRunRecordsDemoRun(pack);
  let state = initial;
  const records: RunRecordsDemoRecord[] = [];
  for (const [index, boundary] of COMMAND_BOUNDARIES.entries()) {
    if (reloadBefore.has(index)) state = decodeActiveRun(encodeActiveRun(state));
    const resolved = resolveRunRecordsDemoCommand(state, boundary, index, pack);
    state = resolved.state;
    if (boundary === 'before-merchant-attack') {
      if (resolved.result.status !== 'applied') {
        throw new Error(
          `run-records demo merchant attack was rejected: ${stableJson(resolved.result)}`,
        );
      }
    } else if (resolved.result.status !== 'applied') {
      throw new Error(
        `run-records demo command ${resolved.command.commandId} was rejected: ${stableJson(resolved.result)}`,
      );
    }
    records.push({
      boundary,
      command: resolved.command,
      commandResult: resolved.result,
      authoritativeEvents: resolved.authoritativeEvents,
      publicEvents: resolved.publicEvents,
      projection: resolved.projection,
    });
  }
  if (state.conclusion === null) throw new Error('run-records demo did not conclude the run');
  const finalizeIndex = RUN_RECORDS_REPLAY_BOUNDARIES.indexOf('before-finalize');
  if (reloadBefore.has(finalizeIndex)) state = decodeActiveRun(encodeActiveRun(state));
  const finalization = finalizeRunRecordsDemo(state, pack);
  return {
    initial,
    state: finalization.state,
    records,
    finalization: {
      record: finalization.record,
      deltas: finalization.deltas,
      events: finalization.events,
    },
  };
}

export function runRecordsDemoEquivalent(
  left: RunRecordsDemoResult,
  right: RunRecordsDemoResult,
): boolean {
  return (
    encodeActiveRun(left.state) === encodeActiveRun(right.state) &&
    stableJson(left.records) === stableJson(right.records) &&
    stableJson(left.finalization?.record) === stableJson(right.finalization?.record) &&
    stableJson(left.finalization?.deltas) === stableJson(right.finalization?.deltas) &&
    stableJson(left.finalization?.events) === stableJson(right.finalization?.events)
  );
}
