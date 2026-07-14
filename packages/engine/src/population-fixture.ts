import type { CompiledContentPack, EncounterContentEntry, FallenChampionTemplateContentEntry } from '@woven-deep/content';
import { heroPerception } from './actor-model.js';
import { createFallenHeroRunDecisions, placeFallenHeroEncounters } from './champion.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { preservesRequiredRoutes } from './connectivity.js';
import { createDemoRun } from './fixture.js';
import { createUnknownKnowledge } from './knowledge.js';
import { allocateIdentificationMap } from './identification.js';
import type { ActiveRun, CommandResult, DomainEvent, FloorSnapshot, GameCommand, PublicEvent, TileId } from './model.js';
import type { FallenHeroStandingSnapshot, GroupPopulation, SwarmPopulation } from './population-model.js';
import { placePopulation } from './population-placement.js';
import { refreshKnowledge } from './perception.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { replayCommands } from './replay.js';
import { decodeActiveRun, encodeActiveRun } from './save-codec.js';
import { validateActiveRun } from './save-schema.js';
import { compareCodeUnits, stableJson } from './stable-json.js';
import { resolveSwarmSpawnAction } from './swarm-behavior.js';
import { movementBlockReason } from './terrain.js';
import { rollDie } from './random.js';

const WIDTH = 19;
const HEIGHT = 13;

export const POPULATION_REPLAY_BOUNDARIES = [
  'before-group-relay', 'before-source-spawn', 'before-leader-death', 'before-boss-threshold',
  'before-boss-re-entry', 'before-champion-encounter', 'before-champion-defeat',
  'before-echo-defeat', 'before-reward-creation',
] as const;

export interface PopulationDemoRecord {
  readonly boundary: typeof POPULATION_REPLAY_BOUNDARIES[number];
  readonly command: GameCommand;
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

export interface PopulationDemoInput {
  readonly boundary: typeof POPULATION_REPLAY_BOUNDARIES[number];
  readonly command: GameCommand;
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
    if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) return 0;
    if (!withArena) return 1;
    if (x === 1 && y === 6) return 4;
    if (x === 10 && y === 6) return 5;
    return y === 6 || (x >= 12 && x <= 17 && y >= 1 && y <= 11) ? 1 : 0;
  });
  const base: FloorSnapshot = {
    ...run.floors[0]!, floorId, width: WIDTH, height: HEIGHT, depth, tiles, entities: [],
    stairUp: withArena ? { x: 1, y: 6 } : null, stairDown: withArena ? { x: 10, y: 6 } : null,
    vaults: withArena ? [{ placementId: 'vault.population-demo', vaultId: 'vault.lampwright-cache',
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
  return { ...run, actors: [...run.actors, ...placement.createdActors].sort((a, b) => compareCodeUnits(a.actorId, b.actorId)),
    populations: [...run.populations, placement.population].sort((a, b) => compareCodeUnits(a.populationId, b.populationId)),
    floors: run.floors.map((floor) => floor.floorId === placement.floor.floorId ? placement.floor : floor),
    encounterDecisions: placement.encounterDecisions,
    rng: { ...run.rng, encounters: placement.nextEncounterState } };
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
    actors: base.actors.map((actor) => ({ ...actor, floorId: populationFloor.floorId, x: 1, y: 6,
      health: 100_000, maxHealth: 100_000 })),
    floors: [populationFloor, bossFloor].sort((left, right) => compareCodeUnits(left.floorId, right.floorId)),
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
    actors: [...run.actors, ...fallen.actors].sort((a, b) => compareCodeUnits(a.actorId, b.actorId)),
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
  const relationships = run.actors.flatMap((left, leftIndex) => run.actors.slice(leftIndex + 1).map((right) => ({
    leftActorId: left.actorId < right.actorId ? left.actorId : right.actorId,
    rightActorId: left.actorId < right.actorId ? right.actorId : left.actorId,
    relationship: 'friendly' as const,
  }))).sort((left, right) => compareCodeUnits(left.leftActorId, right.leftActorId)
    || compareCodeUnits(left.rightActorId, right.rightActorId));
  run = { ...run, relationships, rng: { ...run.rng,
    encounters: [seedWord, (seedWord ^ 0x9e3779b9) >>> 0, Math.imul(seedWord, 0x85ebca6b) >>> 0,
      Math.imul(seedWord ^ 0xc2b2ae35, 0x27d4eb2f) >>> 0] } };
  validatePopulationInvariants(run, pack);
  return run;
}

export function validatePopulationInvariants(run: ActiveRun, pack: CompiledContentPack): void {
  validateActiveRun(run); validateContentBoundRun(run, pack);
  for (const floor of run.floors) {
    const requiredPoints = [floor.stairUp, floor.stairDown,
      ...floor.placementSlots.filter((slot) => slot.kind === 'objective')]
      .filter((point): point is { x: number; y: number } => point !== null);
    const blockedPoints = run.actors.filter((actor) => actor.floorId === floor.floorId && actor.health > 0
      && actor.populationId !== null).map((actor) => ({ x: actor.x, y: actor.y }));
    if (!preservesRequiredRoutes({ width: floor.width, height: floor.height, tiles: floor.tiles,
      requiredPoints, blockedPoints })) throw new Error('population invariant: required route is disconnected');
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
  return { seed, reloadMask: mixed & 0x1ff, relayMemberIndex: (mixed >>> 9) % 3,
    bossHealthPercent: 1 + ((mixed >>> 11) % 20), recoveryElapsed: 20 + ((mixed >>> 16) % 81) };
}

export function shrinkPopulationScenario(seed: number): readonly number[] {
  const values: number[] = [];
  for (let current = Math.floor(seed / 2); current > 0; current = Math.floor(current / 2)) values.push(current);
  if (seed !== 0) values.push(0);
  return [...new Set(values)];
}

export function populationDemoCommands(initial: ActiveRun, scenario: PopulationDemoScenario): readonly PopulationDemoInput[] {
  const targetFor = (boundary: typeof POPULATION_REPLAY_BOUNDARIES[number]) => {
    if (boundary === 'before-leader-death') {
      return initial.populations.find((population): population is GroupPopulation => population.model === 'group')!.leaderActorId!;
    }
    if (boundary === 'before-boss-threshold') {
      return initial.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!.sourceActorId;
    }
    if (boundary === 'before-champion-defeat') {
      return initial.populations.find((population) => population.model === 'champion')!.actorId;
    }
    if (boundary === 'before-echo-defeat') return initial.populations.find((population) => population.model === 'echo')!.actorId;
    if (boundary === 'before-reward-creation') return initial.populations.find((population) => population.model === 'boss')!.actorId;
    return null;
  };
  return POPULATION_REPLAY_BOUNDARIES.map((boundary, index) => {
    const common = { commandId: `command.population-demo-${String(index + 1).padStart(2, '0')}`,
      expectedRevision: initial.revision + index };
    const targetActorId = targetFor(boundary);
    return { boundary, scenario, command: targetActorId === null
      ? { ...common, type: 'wait' as const }
      : { ...common, type: 'attack' as const, targetActorId } };
  });
}

function prepareCommandAttack(state: ActiveRun, targetActorId: string): ActiveRun {
  const target = state.actors.find((actor) => actor.actorId === targetActorId);
  if (!target) throw new Error(`population fixture attack target ${targetActorId} does not exist`);
  const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
  if (target.floorId !== hero.floorId) throw new Error(`population fixture attack target ${targetActorId} is off the hero floor`);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId)!;
  const occupied = new Set(state.actors.filter((actor) => actor.actorId !== state.hero.actorId
    && actor.actorId !== targetActorId && actor.floorId === floor.floorId && actor.health > 0)
    .map((actor) => `${actor.x}:${actor.y}`));
  let destination: Readonly<{ x: number; y: number }> | null = null;
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = hero.x + dx; const y = hero.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height
      || movementBlockReason(floor.tiles[y * floor.width + x]!) !== undefined || occupied.has(`${x}:${y}`)) continue;
    destination = { x, y }; break;
  }
  if (destination === null) throw new Error(`population fixture cannot place attack target ${targetActorId}`);
  let combatState = state.rng.combat;
  for (let candidate = 1; candidate < 100_000; candidate += 1) {
    const proposed = [candidate, 2, 3, 4] as const;
    if (rollDie(proposed, 20).value === 20) { combatState = proposed; break; }
  }
  return { ...state,
    actors: state.actors.map((actor) => actor.actorId === state.hero.actorId ? { ...actor, energy: 100 }
      : actor.actorId === targetActorId ? { ...actor, ...destination!, health: 1 } : actor),
    rng: { ...state.rng, combat: combatState } };
}

function preparePopulationDemoBoundary(state: ActiveRun, input: PopulationDemoInput,
  pack: CompiledContentPack): ActiveRun {
  const { boundary, command, scenario } = input;
  if (boundary === 'before-group-relay') {
    const group = state.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    const observers = group.livingMemberIds.map((actorId) => state.actors.find((actor) => actor.actorId === actorId)!)
      .sort((a, b) => compareCodeUnits(a.actorId, b.actorId));
    const observer = observers[scenario.relayMemberIndex % observers.length]!;
    const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
    return { ...state, actors: state.actors.map((actor) => actor.actorId === observer.actorId ? { ...actor,
      behaviorState: { ...actor.behaviorState, lastKnownTargets: [{ targetActorId: hero.actorId, floorId: hero.floorId,
        x: hero.x, y: hero.y, observedAt: state.worldTime, source: 'sight' as const,
        observerActorId: actor.actorId }] } } : actor) };
  }
  if (boundary === 'before-source-spawn') {
    let current = state;
    const definition = encounter(pack, 'swarm');
    if (definition.model !== 'swarm') throw new Error('population fixture requires swarm content');
    const initialSwarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    current = { ...current,
      actors: current.actors.map((actor) => actor.actorId === initialSwarm.sourceActorId
        ? { ...actor, x: 17, y: 11, awareActorIds: [], behaviorState: { ...actor.behaviorState,
          goal: null, lastKnownTargets: [], investigation: null } } : actor),
      floors: current.floors.map((floor) => floor.floorId === initialSwarm.floorId ? { ...floor,
        entities: floor.entities.map((entity) => entity.entityId === initialSwarm.sourceActorId
          ? { ...entity, x: 17, y: 11 } : entity) } : floor) };
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const swarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
      const livingChildren = swarm.livingMemberIds.filter((actorId) => actorId !== swarm.sourceActorId).length;
      if (livingChildren >= definition.definition.maximumLivingChildren) break;
      const readyAt = Math.max(current.worldTime, swarm.nextSpawnAt, current.activeFloorEnteredAt + 1);
      current = { ...current, worldTime: readyAt,
        actors: current.actors.map((actor) => actor.actorId === swarm.sourceActorId
          ? { ...actor, energy: 100 } : actor),
        populations: current.populations.map((population) => population.populationId === swarm.populationId
          ? { ...swarm, nextSpawnAt: readyAt } : population) };
      current = resolveSwarmSpawnAction({ state: current, content: pack,
        sourceActorId: swarm.sourceActorId, eventId: `${command.commandId}.fixture` }).state;
    }
    const swarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    const livingChildren = swarm.livingMemberIds.filter((actorId) => actorId !== swarm.sourceActorId).length;
    if (livingChildren < definition.definition.maximumLivingChildren) {
      throw new Error('population fixture could not prepare the swarm cap');
    }
    const removedChildId = [...swarm.livingMemberIds]
      .filter((actorId) => actorId !== swarm.sourceActorId).sort().at(-1)!;
    current = { ...current,
      actors: current.actors.filter((actor) => actor.actorId !== removedChildId),
      floors: current.floors.map((floor) => floor.floorId === swarm.floorId
        ? { ...floor, entities: floor.entities.filter((entity) => entity.entityId !== removedChildId) } : floor),
      populations: current.populations.map((population) => population.populationId === swarm.populationId
        ? { ...swarm, spawnedCount: swarm.spawnedCount - 1,
          livingMemberIds: swarm.livingMemberIds.filter((actorId) => actorId !== removedChildId) }
        : population) };
    const preparedSwarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    const readyAt = Math.max(current.worldTime, current.activeFloorEnteredAt + 1);
    return { ...current, worldTime: readyAt,
      actors: current.actors.map((actor) => actor.actorId === preparedSwarm.sourceActorId
        ? { ...actor, energy: 1_000 } : actor),
      populations: current.populations.map((population) => population.populationId === preparedSwarm.populationId
        ? { ...preparedSwarm, nextSpawnAt: readyAt, emittedCapLevels: [] } : population) };
  }
  if (boundary === 'before-leader-death') {
    const group = state.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    const swarm = state.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    const readyAt = Math.max(state.worldTime, state.activeFloorEnteredAt + 1);
    const ready = { ...state, worldTime: readyAt,
      actors: state.actors.map((actor) => actor.actorId === swarm.sourceActorId ? { ...actor, energy: 1_000 } : actor),
      populations: state.populations.map((population) => population.populationId === swarm.populationId
        ? { ...swarm, nextSpawnAt: readyAt, emittedCapLevels: [] } : population) };
    return prepareCommandAttack(ready, group.leaderActorId!);
  }
  if (boundary === 'before-boss-threshold') {
    const swarm = state.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    return prepareCommandAttack(state, swarm.sourceActorId);
  }
  if (boundary === 'before-boss-re-entry') {
    const boss = state.populations.find((population) => population.model === 'boss')!;
    const enteredAt = state.worldTime + scenario.recoveryElapsed;
    return { ...state, worldTime: enteredAt, activeFloorId: boss.floorId, activeFloorEnteredAt: enteredAt,
      actors: state.actors.map((actor) => actor.actorId === state.hero.actorId
        ? { ...actor, floorId: boss.floorId }
        : actor.actorId === boss.actorId ? { ...actor,
          health: Math.max(1, Math.floor(actor.maxHealth * scenario.bossHealthPercent / 100)) } : actor),
      populations: state.populations.map((population) => population.populationId === boss.populationId
        ? { ...boss, lastFloorExitAt: state.worldTime } : population) };
  }
  if (boundary === 'before-champion-defeat') return prepareCommandAttack(state,
    state.populations.find((population) => population.model === 'champion')!.actorId);
  if (boundary === 'before-echo-defeat') return prepareCommandAttack(state,
    state.populations.find((population) => population.model === 'echo')!.actorId);
  if (boundary === 'before-reward-creation') return prepareCommandAttack(state,
    state.populations.find((population) => population.model === 'boss')!.actorId);
  return state;
}

export function resolvePopulationDemoCommand(state: ActiveRun, input: PopulationDemoInput,
  pack: CompiledContentPack): Readonly<{ state: ActiveRun; result: CommandResult; authoritativeEvents: readonly DomainEvent[];
    publicEvents: readonly PublicEvent[]; projection: GameplayProjection }> {
  const prepared = preparePopulationDemoBoundary(state, input, pack);
  const replay = replayCommands(prepared, [input.command], { content: pack });
  const step = replay.steps[0]!;
  const recorded = replay.state.recentCommands.find((entry) => entry.command.commandId === input.command.commandId);
  const authoritativeEvents = recorded?.events ?? [];
  if (step.result.status === 'applied' && !recorded) {
    throw new Error(`population demo command ${input.command.commandId} was not persisted`);
  }
  if (replay.state.worldTime < state.worldTime) throw new Error(`population fixture time reversed at ${input.boundary}`);
  validatePopulationInvariants(replay.state, pack);
  return { state: replay.state, result: step.result, authoritativeEvents,
    publicEvents: step.events, projection: projectGameplayState({ state: replay.state, content: pack }) };
}

export function runPopulationDemo(pack: CompiledContentPack, reloadBefore: ReadonlySet<number> = new Set(),
  scenario: PopulationDemoScenario = populationDemoScenario(0)): PopulationDemoResult {
  const initial = createPopulationDemoRun(pack, scenario.seed); let state = initial; const records: PopulationDemoRecord[] = [];
  for (const [index, input] of populationDemoCommands(initial, scenario).entries()) {
    if (reloadBefore.has(index)) state = decodeActiveRun(encodeActiveRun(state));
    const resolved = resolvePopulationDemoCommand(state, input, pack); state = resolved.state;
    if (resolved.result.status !== 'applied') throw new Error(`population demo command ${input.command.commandId} was rejected`);
    records.push({ boundary: input.boundary, command: input.command, commandResult: resolved.result,
      authoritativeEvents: resolved.authoritativeEvents, publicEvents: resolved.publicEvents,
      projection: resolved.projection });
  }
  return { initial, state, records };
}

export function populationDemoEquivalent(left: PopulationDemoResult, right: PopulationDemoResult): boolean {
  return encodeActiveRun(left.state) === encodeActiveRun(right.state) && stableJson(left.records) === stableJson(right.records);
}
