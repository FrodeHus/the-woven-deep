import type { CompiledContentPack, EncounterContentEntry, FallenChampionTemplateContentEntry } from '@woven-deep/content';
import { heroPerception } from './actor-model.js';
import { advanceBosses } from './boss-behavior.js';
import { advanceFallenHeroEncounters, createFallenHeroRunDecisions, placeFallenHeroEncounters } from './champion.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { preservesRequiredRoutes } from './connectivity.js';
import { createDemoRun } from './fixture.js';
import { applyGroupLeaderOutcomes, coordinateGroups } from './group-behavior.js';
import { createUnknownKnowledge } from './knowledge.js';
import { allocateIdentificationMap } from './identification.js';
import type { ActiveRun, CommandResult, DomainEvent, FloorSnapshot, PublicEvent, TileId } from './model.js';
import type { FallenHeroStandingSnapshot, GroupPopulation, SwarmPopulation } from './population-model.js';
import { placePopulation } from './population-placement.js';
import { refreshKnowledge } from './perception.js';
import { projectDomainEvents } from './event-projection.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { decodeActiveRun, encodeActiveRun } from './save-codec.js';
import { validateActiveRun } from './save-schema.js';
import { stableJson } from './stable-json.js';
import { advanceSwarms, resolveSwarmSpawnAction } from './swarm-behavior.js';

const WIDTH = 19;
const HEIGHT = 13;

export const POPULATION_REPLAY_BOUNDARIES = [
  'before-group-relay', 'before-source-spawn', 'before-leader-death', 'before-boss-threshold',
  'before-boss-re-entry', 'before-champion-encounter', 'before-reward-creation',
] as const;

export interface PopulationDemoRecord {
  readonly boundary: typeof POPULATION_REPLAY_BOUNDARIES[number];
  readonly command: PopulationDemoCommand;
  readonly commandResult: CommandResult;
  readonly authoritativeEvents: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly projection: GameplayProjection;
}

export interface PopulationDemoResult {
  readonly initial: ActiveRun;
  readonly state: ActiveRun;
  readonly records: readonly PopulationDemoRecord[];
}

export interface PopulationDemoScenario {
  readonly seed: number;
  readonly reloadMask: number;
  readonly relayMemberIndex: number;
  readonly bossHealthPercent: number;
  readonly recoveryElapsed: number;
}

export interface PopulationDemoCommand {
  readonly type: 'population-demo-transition';
  readonly boundary: typeof POPULATION_REPLAY_BOUNDARIES[number];
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly scenario: PopulationDemoScenario;
}

function encounter(pack: CompiledContentPack, model: EncounterContentEntry['model']): EncounterContentEntry {
  const result = pack.entries.find((entry): entry is EncounterContentEntry => entry.kind === 'encounter' && entry.model === model);
  if (!result) throw new Error(`population fixture requires a ${model} encounter`);
  return result;
}

function championTemplate(pack: CompiledContentPack): FallenChampionTemplateContentEntry {
  const result = pack.entries.find((entry): entry is FallenChampionTemplateContentEntry => entry.kind === 'fallen-champion-template');
  if (!result) throw new Error('population fixture requires a fallen-champion-template');
  return result;
}

function demoFloor(run: ActiveRun, floorId: string, depth: number, withArena: boolean): FloorSnapshot {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, index): TileId => {
    const x = index % WIDTH; const y = Math.floor(index / WIDTH);
    return x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 0 : 1;
  });
  const base: FloorSnapshot = {
    ...run.floors[0]!, floorId, width: WIDTH, height: HEIGHT, depth, tiles, entities: [],
    stairUp: null, stairDown: null, vaults: withArena ? [{ placementId: 'vault.population-demo', vaultId: 'vault.lampwright-cache',
      x: 12, y: 1, width: 6, height: 11, rotation: 0, reflected: false, entrances: [{ x: 12, y: 6 }] }] : [],
    placementSlots: withArena ? [{ slotId: 'slot.champion', vaultPlacementId: 'vault.population-demo', kind: 'monster',
      required: false, tags: ['side-arena', 'fallen-hero'], x: 16, y: 3 },
    { slotId: 'slot.echo', vaultPlacementId: 'vault.population-demo', kind: 'monster',
      required: false, tags: ['side-arena', 'fallen-hero'], x: 16, y: 9 }] : [],
    knowledge: createUnknownKnowledge(tiles.length), lights: [],
  };
  const hero = run.actors[0]!;
  const actor = { ...hero, floorId };
  return { ...base, knowledge: refreshKnowledge({ floor: base, hero: heroPerception(run.hero, actor),
    actors: new Map([[actor.actorId, actor]]) }).knowledge };
}

function standing(rank: number): FallenHeroStandingSnapshot {
  const hallRecordId = `hall.population-demo-${rank}`;
  return { rank, hallRecordId, heroName: rank === 1 ? 'Ada' : 'Bryn', portraitGlyph: '@', classTags: ['fighter'],
    attributes: { might: 18 - rank, agility: 12, vitality: 16, wits: 10, resolve: 14 },
    equippedItemContentIds: ['item.iron-sword'], signatureAbilityIds: ['spell.ember-bolt'], deathDepth: 5,
    sourceContentHash: 'b'.repeat(64), heirloom: { contentId: 'item.iron-sword',
      sourceItemId: `item.population-demo-original-${rank}`, enchantment: null, condition: 81,
      charges: null, fuel: null, qualityRank: 2, displayName: `${rank === 1 ? "Ada's" : "Bryn's"} Iron Sword`,
      glyph: ')', color: '#d8d8d8', originatingHallRecordId: hallRecordId } };
}

function publishPlacement(run: ActiveRun, placement: Extract<ReturnType<typeof placePopulation>, { status: 'placed' }>): ActiveRun {
  return { ...run, actors: [...run.actors, ...placement.createdActors].sort((a, b) => a.actorId.localeCompare(b.actorId)),
    populations: [...run.populations, placement.population].sort((a, b) => a.populationId.localeCompare(b.populationId)),
    floors: run.floors.map((floor) => floor.floorId === placement.floor.floorId ? placement.floor : floor),
    encounterDecisions: placement.encounterDecisions,
    rng: { ...run.rng, encounters: placement.nextEncounterState } };
}

function firstFreeCell(run: ActiveRun, floorId: string, ignoredActorId: string): Readonly<{ x: number; y: number }> {
  const floor = run.floors.find((candidate) => candidate.floorId === floorId)!;
  const occupied = new Set(run.actors.filter((actor) => actor.floorId === floorId && actor.health > 0
    && actor.actorId !== ignoredActorId).map((actor) => `${actor.x},${actor.y}`));
  for (let y = 1; y < floor.height - 1; y += 1) {
    for (let x = 1; x < floor.width - 1; x += 1) {
      if (floor.tiles[y * floor.width + x] === 1 && !occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  throw new Error(`population fixture has no free cell on ${floorId}`);
}

/** Builds the milestone exit fixture. Eligibility overrides are explicit test/demo input; authored YAML is untouched. */
export function createPopulationDemoRun(pack: CompiledContentPack, scenarioSeed = 0): ActiveRun {
  const group = encounter(pack, 'group'); const swarm = encounter(pack, 'swarm'); const boss = encounter(pack, 'boss');
  const template = championTemplate(pack);
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const standings = [standing(1), standing(2)];
  const selected = createFallenHeroRunDecisions({ standings, conqueredChampionRecordIds: [], template,
    state: base.rng['population-gates'] });
  const populationFloor = demoFloor(base, 'floor.population-demo', 4, false);
  const bossFloor = demoFloor(base, 'floor.population-boss-demo', 5, true);
  let run: ActiveRun = { ...base, contentHash: pack.hash, activeFloorId: populationFloor.floorId,
    actors: base.actors.map((actor) => ({ ...actor, floorId: populationFloor.floorId })),
    floors: [populationFloor, bossFloor].sort((left, right) => left.floorId.localeCompare(right.floorId)),
    fallenHeroStandings: standings, fallenHeroDecisions: selected.decisions.map((decision) => ({
      ...decision, retained: true, ...(decision.role === 'echo' ? { gateRoll: 0 } : {}) })),
    identification: identified.identification,
    rng: { ...identified.rng, 'population-gates': selected.state },
    encounterDecisions: pack.entries.filter((entry): entry is EncounterContentEntry => entry.kind === 'encounter')
      .sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({ encounterId: entry.id,
        baseProbability: entry.runAppearanceChance, protectionBonus: 0, effectiveProbability: entry.runAppearanceChance,
        eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 0 })) };
  for (const definition of [group, swarm]) {
    const placement = placePopulation({ run, floor: run.floors.find((floor) => floor.floorId === populationFloor.floorId)!,
      content: pack, forcedEncounterId: definition.id });
    if (placement.status !== 'placed') throw new Error(`population fixture could not place ${definition.id}: ${placement.reason}`);
    run = publishPlacement(run, placement);
  }
  const bossPlacement = placePopulation({ run, floor: run.floors.find((floor) => floor.floorId === bossFloor.floorId)!,
    content: pack, forcedEncounterId: boss.id });
  if (bossPlacement.status !== 'placed') throw new Error(`population fixture could not place ${boss.id}: ${bossPlacement.reason}`);
  run = publishPlacement(run, bossPlacement);
  const fallen = placeFallenHeroEncounters({ run,
    floor: run.floors.find((floor) => floor.floorId === bossFloor.floorId)!, content: pack });
  run = { ...run, floors: run.floors.map((floor) => floor.floorId === fallen.floor.floorId ? fallen.floor : floor),
    actors: [...run.actors, ...fallen.actors].sort((a, b) => a.actorId.localeCompare(b.actorId)),
    populations: fallen.populations, fallenHeroDecisions: fallen.decisions };
  const groupPopulation = run.populations.find((population): population is GroupPopulation => population.model === 'group')!;
  if (groupPopulation.leaderActorId === null) {
    const leaderId = groupPopulation.livingMemberIds[0]!;
    run = { ...run, populations: run.populations.map((population) => population.populationId === groupPopulation.populationId
      ? { ...groupPopulation, leaderActorId: leaderId, bonusActive: true } : population),
    actors: run.actors.map((actor) => actor.actorId === leaderId ? { ...actor,
      populationPresentation: { ...actor.populationPresentation!, leader: true } } : actor) };
  }
  const seedWord = (scenarioSeed >>> 0) || 0x6d2b79f5;
  run = { ...run, rng: { ...run.rng, encounters: [seedWord, (seedWord ^ 0x9e3779b9) >>> 0,
    Math.imul(seedWord, 0x85ebca6b) >>> 0, Math.imul(seedWord ^ 0xc2b2ae35, 0x27d4eb2f) >>> 0] } };
  validatePopulationInvariants(run, pack);
  return run;
}

export function validatePopulationInvariants(run: ActiveRun, pack: CompiledContentPack): void {
  validateActiveRun(run); validateContentBoundRun(run, pack);
  for (const floor of run.floors) {
    const requiredPoints = [floor.stairUp, floor.stairDown, ...floor.vaults.flatMap((vault) => vault.entrances)]
      .filter((point): point is { x: number; y: number } => point !== null);
    if (!preservesRequiredRoutes({ width: floor.width, height: floor.height, tiles: floor.tiles,
      requiredPoints, blockedPoints: [] })) throw new Error('population invariant: required route is disconnected');
  }
  const living = new Set(run.actors.filter((actor) => actor.health > 0).map((actor) => actor.actorId));
  const memberships = new Set<string>();
  for (const population of run.populations) {
    if (population.createdAt > run.worldTime) throw new Error('population invariant: creation is in the future');
    for (const actorId of population.livingMemberIds) {
      if (!living.has(actorId)) throw new Error(`population invariant: ${actorId} is not living`);
      if (memberships.has(actorId)) throw new Error(`population invariant: ${actorId} has duplicate membership`);
      memberships.add(actorId);
      const actor = run.actors.find((candidate) => candidate.actorId === actorId)!;
      if (actor.floorId !== population.floorId) throw new Error('population invariant: member is on the wrong floor');
    }
    if (population.model === 'group' && population.sharedKnowledge.some((memory) => memory.source === 'group')) {
      throw new Error('population invariant: shared knowledge lost its legitimate observation source');
    }
    if (population.model === 'boss' && new Set(population.crossedPhaseIds).size !== population.crossedPhaseIds.length) {
      throw new Error('population invariant: boss phase repeated');
    }
    const definition = pack.entries.find((entry) => entry.id === population.encounterId);
    if (population.model === 'swarm' && definition?.kind === 'encounter' && definition.model === 'swarm') {
      const livingChildren = population.livingMemberIds.filter((actorId) => actorId !== population.sourceActorId).length;
      const livingFloorActors = run.actors.filter((actor) => actor.floorId === population.floorId && actor.health > 0).length;
      if (livingChildren > definition.definition.maximumLivingChildren
        || population.livingMemberIds.length > definition.definition.maximumLivingMembers
        || livingFloorActors > definition.definition.maximumFloorActors) {
        throw new Error('population invariant: swarm cap exceeded');
      }
    }
  }
  const champions = run.populations.filter((population) => population.model === 'champion');
  if (champions.length > 1) throw new Error('population invariant: Champion is not a singleton');
  const echoRecords = run.populations.filter((population) => population.model === 'echo').map((population) => population.hallRecordId);
  if (new Set(echoRecords).size !== echoRecords.length) throw new Error('population invariant: Echo record repeated');
  if (run.items.filter((item) => item.heirloom !== undefined).length > 1) throw new Error('population invariant: heirloom repeated');
  const template = pack.entries.find((entry) => entry.kind === 'fallen-champion-template');
  if (template && echoRecords.length > template.maximumEchoesPerRun) throw new Error('population invariant: Echo run cap exceeded');
  if (run.items.some((item) => item.heirloom !== undefined && echoRecords.includes(item.heirloom.originatingHallRecordId))) {
    throw new Error('population invariant: Echo owns an heirloom');
  }
  for (const population of run.populations.filter((candidate) => candidate.model === 'boss' && candidate.rewardCreated)) {
    if (run.items.filter((item) => item.itemId === `item.reward.${population.populationId}.unique`).length !== 1) {
      throw new Error('population invariant: boss unique reward is not a singleton');
    }
  }
}

export function populationDemoScenario(seed: number): PopulationDemoScenario {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('population scenario seed must be non-negative');
  const mixed = Math.imul((seed ^ (seed >>> 16)) >>> 0, 0x45d9f3b) >>> 0;
  return { seed, reloadMask: mixed & 0x7f, relayMemberIndex: (mixed >>> 7) % 3,
    bossHealthPercent: 1 + ((mixed >>> 11) % 20), recoveryElapsed: 20 + ((mixed >>> 16) % 81) };
}

export function shrinkPopulationScenario(seed: number): readonly number[] {
  const values: number[] = [];
  for (let current = Math.floor(seed / 2); current > 0; current = Math.floor(current / 2)) values.push(current);
  if (seed !== 0) values.push(0);
  return [...new Set(values)];
}

export function populationDemoCommands(initial: ActiveRun, scenario: PopulationDemoScenario): readonly PopulationDemoCommand[] {
  return POPULATION_REPLAY_BOUNDARIES.map((boundary, index) => ({ type: 'population-demo-transition', boundary,
    commandId: `command.population-demo-${String(index + 1).padStart(2, '0')}`, expectedRevision: initial.revision + index,
    scenario }));
}

function inactiveSnapshot(state: ActiveRun, activeFloorId: string) {
  const floorIds = new Set(state.floors.filter((floor) => floor.floorId !== activeFloorId).map((floor) => floor.floorId));
  return { actors: state.actors.filter((actor) => floorIds.has(actor.floorId)),
    populations: state.populations.filter((population) => floorIds.has(population.floorId)) };
}

export function resolvePopulationDemoCommand(state: ActiveRun, command: PopulationDemoCommand,
  pack: CompiledContentPack): Readonly<{ state: ActiveRun; result: CommandResult; authoritativeEvents: readonly DomainEvent[];
    publicEvents: readonly PublicEvent[]; projection: GameplayProjection }> {
  if (command.expectedRevision !== state.revision) return { state,
    result: { status: 'rejected', commandId: command.commandId, revision: state.revision, turn: state.turn,
      reason: 'stale_revision' }, authoritativeEvents: [], publicEvents: [],
    projection: projectGameplayState({ state, content: pack }) };
  let transition: Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
  if (command.boundary === 'before-group-relay') {
    const group = state.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    const observers = group.livingMemberIds.map((actorId) => state.actors.find((actor) => actor.actorId === actorId)!)
      .sort((a, b) => a.actorId.localeCompare(b.actorId));
    const observer = observers[command.scenario.relayMemberIndex % observers.length]!;
    const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
    const primed = { ...state, actors: state.actors.map((actor) => actor.actorId === observer.actorId ? { ...actor,
      behaviorState: { ...actor.behaviorState, lastKnownTargets: [{ targetActorId: hero.actorId, floorId: hero.floorId,
        x: hero.x, y: hero.y, observedAt: state.worldTime, source: 'sight' as const,
        observerActorId: actor.actorId }] } } : actor) };
    transition = coordinateGroups({ state: primed, content: pack, eventId: command.commandId });
  } else if (command.boundary === 'before-source-spawn') {
    let current = state; const events: DomainEvent[] = [];
    for (let attempt = 0; attempt < 16 && !events.some((event) => event.type === 'swarm.cap-reached'); attempt += 1) {
      const swarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
      const ready = { ...current, worldTime: swarm.nextSpawnAt,
        actors: current.actors.map((actor) => actor.actorId === swarm.sourceActorId ? { ...actor, energy: 100 } : actor) };
      const spawned = resolveSwarmSpawnAction({ state: ready, content: pack, sourceActorId: swarm.sourceActorId,
        eventId: command.commandId });
      current = spawned.state; events.push(...spawned.events);
    }
    if (!events.some((event) => event.type === 'swarm.cap-reached')) throw new Error('population demo did not reach a swarm cap');
    const swarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    const killed = { ...current, actors: current.actors.map((actor) => actor.actorId === swarm.sourceActorId
      ? { ...actor, health: 0 } : actor) };
    const shutdown = advanceSwarms({ state: killed, content: pack, eventId: command.commandId });
    transition = { state: shutdown.state, events: [...events, ...shutdown.events] };
  } else if (command.boundary === 'before-leader-death') {
    const group = state.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    transition = applyGroupLeaderOutcomes({ state: { ...state, actors: state.actors.map((actor) => actor.actorId === group.leaderActorId
      ? { ...actor, health: 0 } : actor) }, content: pack, eventId: command.commandId });
  } else if (command.boundary === 'before-boss-threshold') {
    const boss = state.populations.find((population) => population.model === 'boss')!;
    const heroCell = firstFreeCell(state, boss.floorId, state.hero.actorId);
    const threshold = { ...state, activeFloorId: boss.floorId, activeFloorEnteredAt: state.worldTime,
      actors: state.actors.map((actor) => actor.actorId === state.hero.actorId
        ? { ...actor, floorId: boss.floorId, x: heroCell.x, y: heroCell.y }
        : actor.actorId === boss.actorId ? { ...actor,
          health: Math.max(1, Math.floor(actor.maxHealth * command.scenario.bossHealthPercent / 100)) } : actor) };
    transition = advanceBosses({ state: threshold, content: pack, eventId: command.commandId });
  } else if (command.boundary === 'before-boss-re-entry') {
    const frozen = inactiveSnapshot(state, state.activeFloorId);
    const exited = advanceBosses({ state: { ...state, activeFloorId: 'floor.inactive' }, content: pack,
      eventId: command.commandId }).state;
    transition = advanceBosses({ state: { ...exited, activeFloorId: state.activeFloorId,
      worldTime: state.worldTime + command.scenario.recoveryElapsed,
      activeFloorEnteredAt: state.worldTime + command.scenario.recoveryElapsed }, content: pack,
      eventId: command.commandId });
    if (stableJson(inactiveSnapshot(transition.state, state.activeFloorId)) !== stableJson(frozen)) {
      throw new Error('population fixture inactive actors, populations, or timers advanced');
    }
  } else if (command.boundary === 'before-champion-encounter') {
    transition = advanceFallenHeroEncounters({ state, content: pack, eventId: command.commandId });
  } else {
    const defeated = { ...state, actors: state.actors.map((actor) => actor.populationId !== null
      && state.populations.some((population) => population.populationId === actor.populationId
        && (population.model === 'boss' || population.model === 'champion' || population.model === 'echo'))
      ? { ...actor, health: 0 } : actor) };
    const boss = advanceBosses({ state: defeated, content: pack, eventId: command.commandId });
    const fallen = advanceFallenHeroEncounters({ state: boss.state, content: pack, eventId: command.commandId });
    transition = { state: fallen.state, events: [...boss.events, ...fallen.events] };
  }
  if (transition.state.worldTime < state.worldTime) throw new Error(`population fixture time reversed at ${command.boundary}`);
  const result = { status: 'applied', commandId: command.commandId, revision: state.revision + 1,
    turn: state.turn + 1 } as const;
  const next = { ...transition.state, revision: result.revision, turn: result.turn };
  validatePopulationInvariants(next, pack);
  const publicEvents = projectDomainEvents({ state: next, content: pack, heroId: next.hero.actorId,
    events: transition.events });
  return { state: next, result, authoritativeEvents: transition.events, publicEvents,
    projection: projectGameplayState({ state: next, content: pack }) };
}

export function runPopulationDemo(pack: CompiledContentPack, reloadBefore: ReadonlySet<number> = new Set(),
  scenario: PopulationDemoScenario = populationDemoScenario(0)): PopulationDemoResult {
  const initial = createPopulationDemoRun(pack, scenario.seed); let state = initial; const records: PopulationDemoRecord[] = [];
  for (const [index, command] of populationDemoCommands(initial, scenario).entries()) {
    if (reloadBefore.has(index)) state = decodeActiveRun(encodeActiveRun(state));
    const resolved = resolvePopulationDemoCommand(state, command, pack); state = resolved.state;
    if (resolved.result.status !== 'applied') throw new Error(`population demo command ${command.commandId} was rejected`);
    records.push({ boundary: command.boundary, command, commandResult: resolved.result,
      authoritativeEvents: resolved.authoritativeEvents, publicEvents: resolved.publicEvents,
      projection: resolved.projection });
  }
  return { initial, state, records };
}

export function populationDemoEquivalent(left: PopulationDemoResult, right: PopulationDemoResult): boolean {
  return encodeActiveRun(left.state) === encodeActiveRun(right.state) && stableJson(left.records) === stableJson(right.records);
}
