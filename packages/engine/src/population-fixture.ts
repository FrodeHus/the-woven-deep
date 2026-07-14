import type { CompiledContentPack, EncounterContentEntry, FallenChampionTemplateContentEntry } from '@woven-deep/content';
import { heroPerception } from './actor-model.js';
import { advanceBosses } from './boss-behavior.js';
import { advanceFallenHeroEncounters, createFallenHeroRunDecisions, placeFallenHeroEncounters } from './champion.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { createDemoRun } from './fixture.js';
import { applyGroupLeaderOutcomes, coordinateGroups } from './group-behavior.js';
import { createUnknownKnowledge } from './knowledge.js';
import { allocateIdentificationMap } from './identification.js';
import type { ActiveRun, DomainEvent, FloorSnapshot, PublicEvent, TileId } from './model.js';
import type { FallenHeroStandingSnapshot, GroupPopulation, SwarmPopulation } from './population-model.js';
import { placePopulation } from './population-placement.js';
import { refreshKnowledge } from './perception.js';
import { projectDomainEvents } from './event-projection.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { decodeActiveRun, encodeActiveRun } from './save-codec.js';
import { validateActiveRun } from './save-schema.js';
import { stableJson } from './stable-json.js';
import { resolveSwarmSpawnAction } from './swarm-behavior.js';

const WIDTH = 19;
const HEIGHT = 13;

export const POPULATION_REPLAY_BOUNDARIES = [
  'before-group-relay', 'before-source-spawn', 'before-leader-death', 'before-boss-threshold',
  'before-boss-re-entry', 'before-champion-encounter', 'before-reward-creation',
] as const;

export interface PopulationDemoRecord {
  readonly boundary: typeof POPULATION_REPLAY_BOUNDARIES[number];
  readonly commandResult: Readonly<{ status: 'applied'; worldTime: number }>;
  readonly authoritativeEvents: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly projection: GameplayProjection;
}

export interface PopulationDemoResult {
  readonly initial: ActiveRun;
  readonly state: ActiveRun;
  readonly records: readonly PopulationDemoRecord[];
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
export function createPopulationDemoRun(pack: CompiledContentPack): ActiveRun {
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
  validatePopulationInvariants(run, pack);
  return run;
}

export function validatePopulationInvariants(run: ActiveRun, pack: CompiledContentPack): void {
  validateActiveRun(run); validateContentBoundRun(run, pack);
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

function record(boundary: PopulationDemoRecord['boundary'], state: ActiveRun, pack: CompiledContentPack,
  events: readonly DomainEvent[]): PopulationDemoRecord {
  return { boundary, commandResult: { status: 'applied', worldTime: state.worldTime }, authoritativeEvents: events,
    publicEvents: projectDomainEvents({ state, content: pack, heroId: state.hero.actorId, events }),
    projection: projectGameplayState({ state, content: pack }) };
}

export function runPopulationDemo(pack: CompiledContentPack, reloadBefore: ReadonlySet<number> = new Set()): PopulationDemoResult {
  const initial = createPopulationDemoRun(pack); let state = initial; const records: PopulationDemoRecord[] = [];
  const apply = (boundary: PopulationDemoRecord['boundary'], index: number,
    transition: (current: ActiveRun) => Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>) => {
    if (reloadBefore.has(index)) state = decodeActiveRun(encodeActiveRun(state));
    const previousTime = state.worldTime;
    const result = transition(state); state = result.state;
    if (state.worldTime < previousTime) throw new Error(`population fixture time reversed at ${boundary}`);
    validatePopulationInvariants(state, pack);
    records.push(record(boundary, state, pack, result.events));
  };
  apply('before-group-relay', 0, (current) => {
    const group = current.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    const leader = current.actors.find((actor) => actor.actorId === group.leaderActorId)!;
    const hero = current.actors.find((actor) => actor.actorId === current.hero.actorId)!;
    const primed = { ...current, actors: current.actors.map((actor) => actor.actorId === leader.actorId ? { ...actor,
      behaviorState: { ...actor.behaviorState, lastKnownTargets: [{ targetActorId: hero.actorId, floorId: hero.floorId,
        x: hero.x, y: hero.y, observedAt: current.worldTime, source: 'sight' as const, observerActorId: actor.actorId }] } } : actor) };
    return coordinateGroups({ state: primed, content: pack, eventId: 'event.population-demo.relay' });
  });
  apply('before-source-spawn', 1, (current) => {
    const swarm = current.populations.find((population): population is SwarmPopulation => population.model === 'swarm')!;
    const source = current.actors.find((actor) => actor.actorId === swarm.sourceActorId)!;
    const ready = { ...current, worldTime: swarm.nextSpawnAt, actors: current.actors.map((actor) => actor.actorId === source.actorId
      ? { ...actor, energy: 100 } : actor) };
    return resolveSwarmSpawnAction({ state: ready, content: pack, sourceActorId: source.actorId,
      eventId: 'event.population-demo.spawn' });
  });
  apply('before-leader-death', 2, (current) => {
    const group = current.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    const defeated = { ...current, actors: current.actors.map((actor) => actor.actorId === group.leaderActorId
      ? { ...actor, health: 0 } : actor) };
    return applyGroupLeaderOutcomes({ state: defeated, content: pack, eventId: 'event.population-demo.leader' });
  });
  apply('before-boss-threshold', 3, (current) => {
    const boss = current.populations.find((population) => population.model === 'boss')!;
    const heroCell = firstFreeCell(current, boss.floorId, current.hero.actorId);
    const threshold = { ...current, activeFloorId: boss.floorId, activeFloorEnteredAt: current.worldTime,
      actors: current.actors.map((actor) => actor.actorId === current.hero.actorId
        ? { ...actor, floorId: boss.floorId, x: heroCell.x, y: heroCell.y }
        : actor.actorId === boss.actorId ? { ...actor, health: Math.max(1, Math.floor(actor.maxHealth * 0.25)) } : actor) };
    return advanceBosses({ state: threshold, content: pack, eventId: 'event.population-demo.phase' });
  });
  apply('before-boss-re-entry', 4, (current) => {
    const frozen = current.populations.filter((population) => population.floorId !== current.activeFloorId);
    const exited = advanceBosses({ state: { ...current, activeFloorId: 'floor.inactive' }, content: pack,
      eventId: 'event.population-demo.exit' }).state;
    const result = advanceBosses({ state: { ...exited, activeFloorId: current.activeFloorId,
      worldTime: current.worldTime + 40, activeFloorEnteredAt: current.worldTime + 40 }, content: pack,
      eventId: 'event.population-demo.reentry' });
    const stillFrozen = result.state.populations.filter((population) => population.floorId !== current.activeFloorId);
    if (stableJson(stillFrozen) !== stableJson(frozen)) throw new Error('population fixture inactive floor advanced');
    return result;
  });
  apply('before-champion-encounter', 5, (current) => ({ state: current, events: [] }));
  apply('before-reward-creation', 6, (current) => {
    const defeated = { ...current, actors: current.actors.map((actor) => actor.populationId !== null
      && current.populations.some((population) => population.populationId === actor.populationId
        && (population.model === 'boss' || population.model === 'champion' || population.model === 'echo'))
      ? { ...actor, health: 0 } : actor) };
    const boss = advanceBosses({ state: defeated, content: pack, eventId: 'event.population-demo.boss-reward' });
    const fallen = advanceFallenHeroEncounters({ state: boss.state, content: pack,
      eventId: 'event.population-demo.fallen-reward' });
    return { state: fallen.state, events: [...boss.events, ...fallen.events] };
  });
  return { initial, state, records };
}

export function populationDemoEquivalent(left: PopulationDemoResult, right: PopulationDemoResult): boolean {
  return encodeActiveRun(left.state) === encodeActiveRun(right.state) && stableJson(left.records) === stableJson(right.records);
}
